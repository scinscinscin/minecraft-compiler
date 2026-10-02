# Compiler Performance — Optimization Opportunities

Audit of the Dust compiler pipeline for places where compilation speed can be
improved. Findings are ordered by **priority** = expected impact on total
compile time, with the highest-impact items first.

## Context

- The pipeline is: `lexer → parser → TAC (intermediate) → to_ssa → optimize →
  compile (register allocation) → link → VM`.
- The shipped examples are tiny (9–23 lines). Almost everything below is
  **algorithmic** (superlinear complexity) and only becomes visible as programs
  grow, plus a handful of **constant-factor** wins that help even at current
  sizes.
- Nothing here is a correctness change; every item preserves output. The
  benchmark plan at the bottom gives a before/after signal for each.

## Priority legend

| Tier   | Meaning                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| **P0** | Dominant cost at scale; superlinear; hits the hottest path (register allocation). Fix these first. |
| **P1** | Significant on mid/large programs; superlinear per-function analysis passes.                       |
| **P2** | Constant-factor; helps at all sizes; low risk. Safe quick wins.                                    |
| **P3** | Structural / cleanup; small direct effect but improves the shape of the pipeline.                  |

## Summary table

| #   | Priority | Item                                                            | Location                                               |
| --- | -------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | P0       | `constraint_registers` re-solves the whole problem, recursively | `src/intermediate.ts:1347–1422`                        |
| 2   | P0       | `remove_key_from_graph` rebuilds the adjacency list per removal | `src/utils/coloring.ts:6–15, 26–53`                    |
| 3   | P0       | `liveliness_analysis` fixed point with `indexOf`/`some` set ops | `src/intermediate.ts:1085–1193`                        |
| 4   | P1       | `determine_dominators` fixed point                              | `src/intermediate.ts:893–952`                          |
| 5   | P1       | `determine_frontier`                                            | `src/intermediate.ts:954–988`                          |
| 6   | P1       | CFG construction (`create_basic_blocks` / `create_cfg`)         | `src/intermediate.ts:800–891`                          |
| 7   | P1       | `to_ssa` phi placement (per-variable `cfg.filter` + `dfs`)      | `src/intermediate.ts:990–1083`                         |
| 8   | P1       | `copy_propagation` — O(moves × total instructions)              | `src/optimizer.ts:299–327`                             |
| 9   | P1       | `common_subexpression_elimination` — `indexOf` + full rescan    | `src/optimizer.ts:329–364`                             |
| 10  | P1       | `RegisterInterferenceGraph._index_of` linear scan (very hot)    | `src/intermediate.ts:1246–1252`                        |
| 11  | P2       | Debug logging on the compile hot path                           | `src/compiler.ts:516`, `src/index.ts:79, 88–92`        |
| 12  | P2       | Whole-array rebuilds used inside loops                          | `src/parser.ts:104–130`, `src/intermediate.ts:715–750` |
| 13  | P2       | O(n) linear scans that should be Maps                           | several (see item)                                     |
| 14  | P2       | `ConstantCache` linear `find` on every op                       | `src/optimizer.ts:102–123`                             |
| 15  | P2       | Codegen loop: `indexOf`/`find` per instruction                  | `src/compiler.ts:594–662`                              |
| 16  | P3       | Reachability filtering happens *after* compiling every function | `src/index.ts:87`, `tests/helpers.ts:84`               |
| 17  | P3       | `color_graph` is dead code (only used for a type alias)         | `src/utils/coloring.ts:95, 160`                        |
| 18  | P3       | `to_ssa` runs `dead_jump_elimination` which overlaps `optimize` | `src/intermediate.ts:1001`                             |

---

## P0 — Dominant costs

### 1. `constraint_registers` re-solves the whole problem, recursively
**Location:** `src/intermediate.ts:1347–1422`

**What it is:** Register spill driver. For each run it:
1. builds the full inference graph (`create_register_inference_graph` → which itself runs the `liveliness_analysis` fixed point),
2. solves it (`graph.solve` → `new_color_graph`, see #2),
3. rewrites operands for every "bad" operand by calling `prepend_instruction` / `append_instruction` (whole-array O(n) rebuilds, see #12), then
4. **recurses** (line 1422) and repeats from step 1.

**Why it's slow:** Every recursion level recomputes liveness, rebuilds the graph, and re-colors from scratch instead of incrementally updating. Spilling is done by array-rebuild helpers that are O(n) each and called per touched instruction.

Net cost is O(n³)+ *per level*, multiplied by recursion depth, and it re-runs the two other P0 items each level. This is the single largest contributor to compile time on register-pressure-heavy input.

**Fix:** Make spilling converge without a full restart — update the liveness results and graph incrementally, or compute spills in a single pass. At minimum,hoist the parts that don't change between levels and replace the `prepend`/`append` rebuilds with in-place edits (#12).

**Impact:** High. **Risk/Effort:** High — this is the trickiest item; verify spill behavior against the benchmark's register-pressure shape and against `tests/` before/after.

### 2. `remove_key_from_graph` rebuilds the adjacency list per removal
**Location:** `src/utils/coloring.ts:6–15` (helper), `26–53` (`new_color_graph`)

**What it is:** Chaitin-style graph simplification. `remove_key_from_graph` reconstructs the entire adjacency object, filtering the removed key out of every other node's neighbor list. `new_color_graph` calls it once per node removed in its `next_node` loop, and also re-runs `Object.keys` + `.filter` for the candidate scan each iteration.

**Why it's slow:** O(V·E) per removal → O(V²·E) total for one coloring. It runs on every `constraint_registers` recursion (#1), so its cost compounds.

**Fix:** Remove a node in place: delete its key and remove the edge from its neighbors' lists in O(deg) — O(V·E) total instead of O(V²·E). Cache `Object.keys` / the candidate list rather than re-deriving each iteration.

**Impact:** High (and compounds #1). **Risk/Effort:** Medium — localized to one file; the in-place mutation must keep the adj-list invariant (a node must not appear in its own list, symmetric edges removed).

### 3. `liveliness_analysis` fixed point
**Location:** `src/intermediate.ts:1085–1193`

**What it is:** Backward liveness dataflow. Fixed-point loop over basic blocks computing in/out sets. Uses `cfg.indexOf(block)` inside the successors map, `combine_operand_sets_n` with `.some(compare_operands)`, and rebuilds `out[block.id]`/`in[block.id]` arrays each iteration.

**Why it's slow:** Each iteration is O(blocks²) for the index lookups plus O(k²) per operand-set combine (`.some` over a set). The fixed point can take many iterations on long loop chains. Critically, it's called from `dead_code_elimination` (every optimize pass), from `create_register_inference_graph` (#1), and therefore repeatedly through the `constraint_registers` recursion.

**Fix:** Index blocks once (`Map` id → block, or index) instead of `indexOf`. Represent operand sets as `Set`s keyed by a stable operand id so combine/union are O(k) with fast-membership tests instead of `.some` over arrays. Recompute only blocks whose inputs changed (worklist) instead of scanning all blocks each iteration.

**Impact:** High (called many times). **Risk/Effort:** Medium — must keep the same liveness semantics; the benchmark's register-pressure shape stresses it directly.

---

## P1 — Significant per-function analysis passes

### 4. `determine_dominators` fixed point
**Location:** `src/intermediate.ts:893–952`

**What it is:** Dominator computation via iterative intersection. Uses
`basic_blocks.filter(x => successors.includes(x.id))` and
`dominators.map(...).filter(x => x.includes(block.id))` with `indexOf`,
re-running until stable.

**Why it's slow:** `.filter`/`.includes`/`.indexOf` over block and dominator
arrays → O(n³)–O(n⁴).

**Fix:** Use a `Set` for dominator membership and `block.id` index lookups;
consider the classic bit-vector (or LCA/Cooper-Harvey-Kennedy) algorithm for
near-linear behavior.

**Impact:** Medium-high (runs once per function in `to_ssa`). **Risk/Effort:**
Medium.

### 5. `determine_frontier`
**Location:** `src/intermediate.ts:954–988`

**What it is:** Dominator frontier (for phi placement). `dominators[block].map`
+ `.filter` with `.includes` and `successors.includes`.

**Why it's slow:** Nested membership scans → O(n³).

**Fix:** Set-based membership and id-indexed lookups; feed it the (already
fixed) dominators from #4.

**Impact:** Medium-high. **Risk/Effort:** Medium.

### 6. CFG construction (`create_basic_blocks` / `create_cfg`)
**Location:** `src/intermediate.ts:800–891`

**What it is:** Splits code into basic blocks and builds successor/edge lists.
`create_basic_blocks` uses `leaders.find` inside a per-instruction loop;
`create_cfg` uses `basic_blocks.find(x => x.labels.includes(...))` and
`basic_block.code.indexOf(leader)`.

**Why it's slow:** O(n) lookups inside loops → O(n²).

**Fix:** Build a `Map` of label → block and instruction → block-index up front;
replace `find`/`indexOf` with O(1) lookups.

**Impact:** Medium. **Risk/Effort:** Low-medium (pure lookup refactor).

### 7. `to_ssa` phi placement
**Location:** `src/intermediate.ts:990–1083`

**What it is:** Per SSA variable, `cfg.filter` + `dfs` to find definition
blocks, insert phis, and rename. Runs for every variable in
`function_compilation_context.variables`.

**Why it's slow:** O(vars × blocks × (dfs work)); the DFS and `cfg.filter`
re-traverse the graph per variable.

**Fix:** Precompute reachability / successor adjacency once and reuse across
variables; avoid re-filtering `cfg` per variable.

**Impact:** Medium (once per function, but grows with variable count).
**Risk/Effort:** Medium.

### 8. `copy_propagation` — O(moves × total instructions)
**Location:** `src/optimizer.ts:299–327`

**What it is:** For each `MoveInstruction` scans all basic blocks and all their
instructions to substitute uses.

**Why it's slow:** Nested over (moves × blocks × instructions); inside the
re-run fixed-point loop (#below).

**Fix:** For each move, only inspect instructions *after* the move in program
order (or use use-def chains), and bail early. Build a name → definition map
rather than scanning.

**Impact:** Medium. **Risk/Effort:** Low-medium (keep the same substitution
semantics; covered by `optimization_equivalence.test.ts`).

### 9. `common_subexpression_elimination`
**Location:** `src/optimizer.ts:329–364`

**What it is:** For each instruction, `emitted.indexOf` + a scan of all
subsequent instructions comparing with `is_equivalent_to` to find duplicates.

**Why it's slow:** O(n²) with a costly per-pair equivalence check, inside the
fixed-point loop.

**Fix:** Maintain a `Map` from a normalized operand signature → (first
instruction, definition point) so duplicate detection is O(n) with O(1) lookup.

**Impact:** Medium. **Risk/Effort:** Medium (must preserve "defined before use"
ordering for CSE to be valid).

### 10. `RegisterInterferenceGraph._index_of` linear scan
**Location:** `src/intermediate.ts:1246–1252`

**What it is:** Finds a node's index by linear-scanning `nodes` with
`compare_operands`. Called by `create_nodes`/`create_edge` during graph
construction *and* by the very-hot `RelocatableUnit.to_machine_operand` on every
operand during codegen (`src/compiler.ts:365–395`).

**Why it's slow:** O(V) per call; O(V) per operand across the whole program.

**Fix:** Maintain a `Map` from a stable operand key (e.g.
`operand.to_string()` or a generated id) → index, updated as nodes are added.

**Impact:** Medium-high (it's on the codegen hot path, so it helps at all
sizes). **Risk/Effort:** Low — pure lookup refactor; key must be unambiguous
across operand kinds.

---

## P2 — Constant-factor / low-risk wins

### 11. Debug logging on the compile hot path
**Location:** `src/compiler.ts:516` (`pretty_print(blocks)` in `compile`),
`src/index.ts:79` (`console.log` of emitted IR), `src/index.ts:88–92`
("Printing linked code" loop).

**What it is:** Unconditional `console.log` / `pretty_print` that serialize and
print all IR and machine code on every function compile and at link time.

**Why it matters:** Pure overhead — string-building + I/O on every compile even
when output is discarded.

**Fix:** Gate behind a `verbose`/`DUST_DEBUG` flag (off by default). This is the
lowest-effort, zero-risk win in the list.

**Impact:** Low-medium at all sizes (proportional to program size). **Risk:**
None (behavior-neutral when off). **Effort:** Trivial.

### 12. Whole-array rebuilds used inside loops
**Location:** `src/parser.ts:104–130`
(`FunctionCompilationContext.remove_instruction` (filter),
`replace_instruction` (map), `prepend_instruction`, `append_instruction`),
`src/intermediate.ts:715–750` (`BasicBlock.remove_instruction`/
`replace_instruction`), and their use inside #1 and the optimizer passes.

**What it is:** Each call rebuilds the whole `emitted` / `instructions` array via
`filter`/`map`/spread, and is called per-instruction in hot loops.

**Why it's slow:** O(n) per call × O(n) calls = O(n²); in the
`constraint_registers` recursion it's O(n) per touched instruction.

**Fix:** Track indices and splice in place; `append_instruction` is already a
cheap push — keep it. Where a pass replaces/many-instructions, mutate
incrementally instead of rebuilding the array each time.

**Impact:** Low-medium at all sizes. **Risk:** Low (keep the returned value
semantics). **Effort:** Low.

### 13. O(n) linear scans that should be Maps
**Locations:**
- `src/compiler.ts:600` — `finalizers.indexOf(intermediate)` per instruction in
  the codegen loop.
- `src/compiler.ts:397–404` — `RelocatableUnit.get_basic_block` linear
  `blocks.find(x => x.labels.includes(...))`, called in the codegen loop and in
  `create_temporary_block`.
- `src/compiler.ts:379` — `this.compilation_context.variables.indexOf(operand.name)`.
- `src/parser.ts` — `this.variables.includes(operand.name)` in
  `append_instruction` (line 121).
- `src/intermediate.ts` — `block.successors` / `successors.includes` in several
  analysis passes (also #3/#5).

**Fix:** Build one-time `Map`s (label → block, instruction-id → block index,
name → variable index) and reuse.

**Impact:** Low at small size, grows linearly/quadratically with size.
**Risk:** Low. **Effort:** Low.

### 14. `ConstantCache` linear `find` on every op
**Location:** `src/optimizer.ts:102–123`

**What it is:** `get`/`set`/`delete` scan the cache array with
`compare_operands` on every arithmetic instruction.

**Fix:** Back it with a `Map` keyed by a stable operand id; O(1) ops.

**Impact:** Low-medium (runs every `constant_fold` pass, every iteration of the
fixed-point loop). **Risk:** Low. **Effort:** Low.

### 15. Codegen loop: `indexOf`/`find` per instruction
**Location:** `src/compiler.ts:594–662`

**What it is:** For each emitted instruction: `finalizers.indexOf` (#13),
`relocatable_unit.get_basic_block` (#13), `blocks.indexOf(target_block)`,
`edge_mapping.find(...)` (twice). `create_temporary_block` (`:407–490`) adds
BFS + `queue.filter` per new predecessor edge.

**Fix:** Precompute block/edge index Maps; cache `get_basic_block` results; in
`create_temporary_block` avoid the O(q) `queue.filter` per loop step.

**Impact:** Low-medium (codegen runs once per function). **Risk:** Low.
**Effort:** Low-medium.

---

## P3 — Structural / cleanup

### 16. Reachability filtering happens after compiling every function
**Location:** `src/index.ts:87` and `tests/helpers.ts:84`
(`filter_reachable_units` is called on the already-compiled `units`).

**What it is:** Every function is fully run through `to_ssa` + `optimize` +
`compile` (including the expensive #1 register allocation) *before* unreachable
ones are discarded by name lookup.

**Fix:** Compute the reachable set on the cheap AST (function call graph) first,
and only compile reachable functions.

**Impact:** Scales with the number of dead functions; direct savings on
multi-function programs. **Risk:** Low-medium (must match the name-based
`"main"` entry convention in `index.ts`). **Effort:** Low.

### 17. `color_graph` is dead code
**Location:** `src/utils/coloring.ts:95` (function), `160` (only used to type
`ChaitinOutput = ReturnType<typeof color_graph>`).

**What it is:** The non-heuristic `color_graph` is never called in the pipeline;
only `new_color_graph` (via `graph.solve`) is used. `color_graph` survives solely
to supply the `ChaitinOutput` type.

**Fix:** Define the output type explicitly (or alias it to `new_color_graph`)
and delete `color_graph`. No runtime effect; reduces confusion about which
colorer is live.

**Impact:** None (cleanup). **Risk:** Trivial. **Effort:** Trivial.

### 18. `to_ssa` runs `dead_jump_elimination` which overlaps `optimize`
**Location:** `src/intermediate.ts:1001`
(`while (dead_jump_elimination(function_compilation_context, cfg))`), and the
`dead_jump_elimination` pass inside `optimize` (`src/optimizer.ts:159+`).

**What it is:** Dead-jump elimination runs to a fixpoint in `to_ssa`, then runs
again as an optimize pass.

**Fix:** Run it once at a single stage (or make the `optimize` pass a no-op
once `to_ssa` has converged). Reduces duplicated work without changing output.

**Impact:** Low (duplicated pass). **Risk:** Low. **Effort:** Low.

---

# Synthetic Benchmark Plan

Goal: a repeatable harness that times **each pipeline stage separately**, across
generated inputs of increasing size, so any optimization above can be compared
before/after with a concrete per-stage number.

## 1. Location & runner
- New directory `benchmark/` with `benchmark/generate.ts` and
  `benchmark/run.ts`, plus `benchmark/baseline.json` (git-ignored until first
  run).
- Add npm scripts:
  - `"bench": "tsx benchmark/run.ts"`
  - `"bench:save": "tsx benchmark/run.ts --save"` (writes the baseline)
- Run under the same `tsx` the project already uses; reuse the existing
  `time()` helper from `src/index.ts:25` (or `process.hrtime.bigint()`) for
  stage timing.

## 2. Stage breakdown to measure
For a given program source, the harness must isolate and time:

| Stage      | What it measures                            | Notes                                                               |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------- |
| `parse`    | lexer + sparse-LR(1) parse                  | Reuses the `parse_program` logic in `tests/helpers.ts:34`.          |
| `to_ssa`   | `to_ssa(context)` per function              | Includes #4, #5, #6, #7 and the `dead_jump_elimination` loop (#18). |
| `optimize` | `optimize(...)` with all passes             | Includes #3, #8, #9, #14 and the fixed-point loop.                  |
| `compile`  | `compile(...)` incl. `constraint_registers` | The #1 / #2 / #10 hot path.                                         |
| `link`     | `load(...)` + `filter_reachable_units`      | Cheap, but captures #16.                                            |
| `total`    | sum                                         | Sanity check.                                                       |

Emit a table: rows = pipeline stages, columns = input size, cells = ms. Also
report the per-function averages so it's clear whether cost is per-function
(linear) or cross-function (superlinear).

## 3. Input generators (two shapes)
Generate valid Dust (so it compiles *and* runs, keeping correctness verifiable)
with a single `--size` knob.

**Shape A — `many_functions(N)`:** N independent functions, each a short body
(one loop, a handful of locals). Expected ~linear scaling.
```
function f0(): int { var a: int = 1; var b: int = 2; var i: int = 0;
  while loop (i < 10) { a = a + 1; i = i + 1; } return a + b; }
function f1(): int { ... }
...
function main(): int { return f0() + f1() + ...; }   // makes them reachable
```
Stresses: per-function `to_ssa`/`optimize`/`compile` and the "compile everything
then filter" structural cost (#16).

**Shape B — `register_pressure(K, L)`:** a few functions, each with K > GPR_COUNT
(> 7) live locals in an L-iteration loop, combined so many locals are live
together (forcing spills → the `constraint_registers` recursion).
```
function main(): int {
  var x0: int = 1; var x1: int = 2; ... var x<K>: int = K;
  var i: int = 0;
  while loop (i < L) {
    x0 = x0 + x1; x1 = x1 + x2; ... x<K> = x<K> + x0; i = i + 1;
  }
  return x0;
}
```
Stresses: #1, #2, #3, #10, #13 (this is the shape where P0 items dominate).

Scale both shapes: `N ∈ {10, 50, 100, 500}` (A) and `K ∈ {10, 30, 100}`,
`L ∈ {50, 500, 5000}` (B).

## 4. Methodology
- Run each (shape, size) config **N times** (e.g. 5) and report the **median**
  (and min) to smooth out noise; warm up once first to skip cold-start
  (JIT/regex-compile) costs.
- Time around each stage, not the whole `compile_and_run` — the harness
  replicates `tests/helpers.ts:70–84` but wraps each call in its own timer.
- Keep the generated source stable (seeded), so before/after runs compare the
  *identical* input.

## 5. Comparison / baseline workflow
1. `yarn bench` — prints the current per-stage table.
2. `yarn bench:save` — writes `benchmark/baseline.json`.
3. After an optimization, `yarn bench` prints the same table; a
   `yarn bench:diff` (optional) loads `baseline.json` and prints the % delta per
   stage/size. A P0 fix should show a clear drop in the `compile` stage of Shape
   B; #11/#12/#13 should show drops across all stages at every size.

## 6. Correctness guard
The benchmark must never be the only signal:
- `yarn test` (existing `tests/`, incl. `optimization_equivalence.test.ts`) and
  `yarn tc` must pass before/after each change.
- Optionally, the harness can run the generated program through the VM
  (`create_runner`) and record `main`'s return value as a checksum, asserting it
  is unchanged across the optimization — a cheap end-to-end invariant.

## 7. First thing to instrument
Before touching any algorithm, add the stage timers and a Shape B generator and
record a baseline. That baseline is what converts the qualitative P0/P1 claims
above into measured numbers, and it makes each subsequent fix's impact
unambiguous.

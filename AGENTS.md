# Dust Compiler - Agent Instructions

## Commands
- `npm run tc` - TypeScript typecheck (strict mode)
- `npm start` - Run compiler (reads `examples/scratch.txt`, uses 2 GPRs)
- `npm test` - Run all tests (30s timeout per test)
- `npm run test:watch` - Vitest watch mode

## Architecture
Single-pass compiler pipeline (all in `src/`):

```
lexer (src/lexer.ts - Slex)
  → parser (src/parser.ts - Sparse LR(1), grammar in src/grammar.txt)
    → IR (src/intermediate.ts - Three Address Code)
      → SSA (to_ssa)
        → optimizer (src/optimizer.ts)
             → codegen (src/compiler.ts - register allocation + machine code)
               → filter_reachable_units (src/index.ts - removes unused functions)
                 → linker (src/linker.ts)
                   → VM (src/vm.ts)
```

## Gotchas
- `src/index.ts:15` hardcodes `GPR_COUNT = 2`. Change this to adjust register allocation pressure.
- Entry point reads `examples/scratch.txt`. Edit that file or modify `EXAMPLE_FILE` in `src/index.ts`.
- `filter_reachable_units` in `src/index.ts` finds `"main"` by name - don't rename the entry function without updating this.
- Do-while loops can produce CFG blocks with no successors - guards exist in `create_cfg` and `dfs`.
- `dead_jump_elimination` in `src/optimizer.ts` handles the case where an if has no else branch (no `_false` block exists).
- Type checking is opt-in per expression node - some paths still use raw int types.

## Adding Language Features
1. Add token to `src/lexer.ts` TokenType enum and `lexerGenerator.addRule()`
2. Add production to `src/grammar.txt`
3. Add reducer to `Reducers` in `src/parser.ts`
4. Add AST node class and `emit_ir()` method in `src/parser.ts`
5. Add IR instruction class in `src/intermediate.ts`
6. Update `src/compiler.ts` machine code generation if needed

## Tests
- Location: `tests/` directory, glob: `tests/**/*.test.ts`
- Each test file targets a pipeline stage: lexer, parser, types, vm, optimizer, linker, compiler
- The `tests/compiler.test.ts` full_compile pipeline mirrors `src/index.ts` - keep them in sync.

## Conventions
 - use snake case

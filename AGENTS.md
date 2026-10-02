# Dust Compiler - Agent Instructions

This project implements a compiler for Dust, a C-like language targetting a Minecraft Redstone Computer. 

## Commands
- `npm run tc` - TypeScript typecheck (strict mode)
- `npm start` - Run compiler (reads `examples/scratch.txt`)

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

## Custom libraries

This project uses `@scinorandex/slex` for lexing and `@scinorandex/sparse` for parsing.

You can view their documentation in `docs/slex-documentation.md` and `docs/sparse-documentation.md` respectively. Do not traverse the node_modules directory and read their source code. Assume that these docs are accurate and up-to-date.

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
 - put all documentation in the docs/ directory

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

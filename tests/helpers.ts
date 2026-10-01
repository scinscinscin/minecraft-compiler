import fs from "fs/promises";
import path from "path";
import { buildProductions, Sparse } from "@scinorandex/sparse";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "@/lexer";
import { BaseNode, FunctionDefinition, Program, Reducers, VariableDefinition } from "@/parser";
import { to_ssa } from "@/intermediate";
import { compile, RelocatableUnit } from "@/compiler";
import { load } from "@/linker";
import { create_runner } from "@/vm";
import { ALL_OPTIMIZATION_PASSES, OptimizationPassName, filter_reachable_units, optimize } from "@/optimizer";

const GRAMMAR_FILE = path.join(process.cwd(), "./src/grammar.txt");

export const DEFAULT_GPR_COUNT = 7;

// "none" disables every optimize() pass; an array enables only the listed passes.
export type RunConfig = {
  enabled_passes?: OptimizationPassName[] | "none";
  gpr_count?: number;
};

type ParsedProgram = {
  globals_defs: VariableDefinition[];
  globals_names: string[];
  functions: FunctionDefinition[];
};

// The parsed AST is shared across runs of the same source. This is safe because
// FunctionDefinition.compile() builds a fresh FunctionCompilationContext per call
// and the emit_ir methods only read from the AST nodes (temps/labels come from the
// passed-in context), so compiling the same node under several pass configs is re-entrant.
const ast_cache = new Map<string, Promise<ParsedProgram>>();

async function parse_program(source: string): Promise<ParsedProgram> {
  const cached = ast_cache.get(source);
  if (cached != undefined) return cached;

  const task = (async () => {
    const productions = buildProductions(await fs.readFile(GRAMMAR_FILE, "utf8"));
    const parser_generator = Sparse.fromProductions<TokenType, TokenMetadata, BaseNode>({
      productions,
      toStringifiedTokenType,
    });

    const lexer = lexerGenerator.generate(source, () => ({}));
    const parser = parser_generator.generate(lexer, {
      reducer: ({ bag, name }) => {
        const reducer = Reducers[name ?? ""];
        if (reducer != null) return reducer(bag);
        throw new Error("Invariant: Reducer should not be null. " + name);
      },
    });

    const root = parser.parse().result as Program | null;
    if (root == null) throw new Error("Invariant: Root node should not be null.");

    const globals_defs = root.definitions.variables.get_items_reversed();
    const globals_names = globals_defs.map((x) => x.name.lexeme);
    const functions = root.definitions.functions.get_items_reversed();
    return { globals_defs, globals_names, functions };
  })();

  ast_cache.set(source, task);
  return task;
}

// Compiles `source` end-to-end (mirroring src/index.ts) under the given optimization
// config and runs the resulting machine code to completion. Returns the program's
// output: main's return value, held in the VM's return register after it halts.
export async function compile_and_run(source: string, config: RunConfig = {}): Promise<number> {
  const { globals_defs, globals_names, functions } = await parse_program(source);
  const gpr_count = config.gpr_count ?? DEFAULT_GPR_COUNT;

  const units = functions.map((fn) => {
    const context = fn.compile(globals_names);
    let cfg = to_ssa(context);
    if (config.enabled_passes !== "none") {
      cfg = optimize(context, cfg, config.enabled_passes ?? ALL_OPTIMIZATION_PASSES);
    }
    const compiled = compile(context, cfg, gpr_count);
    return [fn.name.lexeme, compiled] as [string, RelocatableUnit];
  });

  const linked = load(filter_reachable_units(units, "main"), globals_defs);
  const runner = create_runner(linked);
  runner.execute({ log: () => {} });
  return runner.environment.return_register;
}

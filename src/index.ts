#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "./lexer";
import { buildProductions, LR1ParserGraveError, Sparse } from "@scinorandex/sparse";
import { BaseNode, Program, Reducers } from "./parser";
import { to_ssa } from "./intermediate";
import { compile, RelocatableUnit } from "./compiler";
import { load } from "./linker";
import { create_runner } from "./vm";
import { Logger, start_repl } from "./repl";
import { filter_reachable_units, optimize } from "./optimizer";
import { print_diagnostic, StaticAnalysisContext } from "./typechecker";
import { Command } from "./utils/command";

const GRAMMAR_FILE = path.join(process.cwd(), "./src/grammar.txt");
const DEFAULT_INPUT_FILE = path.join(process.cwd(), "./examples/scratch.txt");
const DEFAULT_GPR_COUNT = 7;

type CliOptions = {
  debug: boolean;
  gpr: number;
  no_optimizations: boolean;
};

const root = new Command<string[], CliOptions>({
  name: "dust",
  description: "Compiles a Dust source file and runs the resulting binary.",
  arguments: {
    name: "input",
    description: `Path to the Dust source file to compile (defaults to ${DEFAULT_INPUT_FILE})`,
  },
  options: {
    debug: {
      aliases: ["--debug"],
      description: "Run as an interactive REPL with step-by-step execution",
      type: "boolean",
      optional: true,
      default: false,
    },
    gpr: {
      aliases: ["--gpr"],
      description: `Set the number of general purpose registers, between 2 and 7 (defaults to ${DEFAULT_GPR_COUNT})`,
      type: "number",
      optional: true,
      min: 2,
      max: 7,
      default: DEFAULT_GPR_COUNT,
    },
    no_optimizations: {
      aliases: ["--no-optimizations"],
      description: "Disable optimization passes",
      type: "boolean",
      optional: true,
      default: false,
    },
  },
});

root.setHandler((args, options) => {
  return main(args[0] ?? DEFAULT_INPUT_FILE, options.gpr, options.debug, !options.no_optimizations);
});

async function main(input_file: string, gpr_count: number, debug: boolean, optimized: boolean) {
  const now = Date.now();

  const productions = buildProductions(await fs.readFile(GRAMMAR_FILE, "utf8"));
  const parserGenerator = Sparse.fromProductions<TokenType, TokenMetadata, BaseNode>({
    productions,
    toStringifiedTokenType,
    mode: "lalr1",
  });

  const source_code = await fs.readFile(input_file, "utf8");
  const lexer = lexerGenerator.compile().generate(source_code, () => ({}));
  const parser = parserGenerator.generate(lexer, {
    reducer: ({ bag, name }) => {
      const reducer = Reducers[name ?? ""];
      if (reducer != null) return reducer(bag);
      throw new Error("Invariant: Reducer should not be null. " + name);
    },
  });

  // Parse the program and print any parsng errors found
  const parse = () => {
    try {
      return { success: true as const, result: parser.parse().result };
    } catch (err) {
      return { success: false as const, err: err as LR1ParserGraveError<TokenType, TokenMetadata> };
    }
  };

  const parsing_result = parse();
  if (parsing_result.success === false) {
    const { currentToken: token, reason } = parsing_result.err;
    return print_diagnostic(input_file, source_code, token!.line, token!.column, reason);
  }

  const root_node = parsing_result.result as Program | null;
  if (root_node == null) throw new Error("Invariant: Root node should not be null. ");

  // Statically analyze the program
  const static_context = new StaticAnalysisContext();
  root_node.verify_static_analysis(static_context);
  if (static_context.errors.length > 0) {
    for (const error of static_context.errors)
      print_diagnostic(input_file, source_code, error.token.line, error.token.column, error.message);
    return;
  }

  // Proceed with compilation
  const globals = root_node.definitions.variables.get_items_reversed();
  const functions = root_node.definitions.functions.get_items_reversed();
  const units = functions.map((fn) => {
    const intermediate_representation = fn.compile(globals.map((x) => x.name.lexeme));

    let cfg = to_ssa(intermediate_representation);
    if (optimized) cfg = optimize(intermediate_representation, cfg);

    console.log(intermediate_representation.emitted.map((x) => x.to_stringified()));
    const compiled = compile(intermediate_representation, cfg, gpr_count);
    return [fn.name.lexeme, compiled] as [string, RelocatableUnit];
  });

  const linked = load(filter_reachable_units(units, "main"), globals);

  const ms = Date.now() - now;
  console.log(`Binary compilation took ${ms.toFixed(1)}ms`);
  console.log("Printing linked code: ================");
  for (let i = 0; i < linked.length; i++) {
    const instruction = linked[i];
    console.log(`[${i.toString().padStart(2, "0")}]: ${instruction.to_stringified()}`);
  }

  const runner = create_runner(linked, gpr_count);
  if (!debug) {
    const logger = new Logger();
    runner.execute(logger);
    runner.dump_registers(logger);
  } else start_repl(runner);
}

// Only drive the pipeline when this file is the process entrypoint. Library
// consumers import the individual pipeline stages directly, and must not have
// a REPL opened on their stdin as a side effect of doing so.
if (require.main === module) {
  root.execute(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}

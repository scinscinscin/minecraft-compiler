import fs from "fs/promises";
import path from "path";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "./lexer";
import { buildProductions, LR1ParserGraveError, Sparse } from "@scinorandex/sparse";
import { BaseNode, Program, Reducers } from "./parser";
import { BasicBlock, to_ssa } from "./intermediate";
import { compile, RelocatableUnit } from "./compiler";
import { load } from "./linker";
import { create_runner } from "./vm";
import { start_repl } from "./repl";
import { filter_reachable_units, optimize } from "./optimizer";
import { print_diagnostic, StaticAnalysisContext } from "./typechecker";

const GRAMMAR_FILE = path.join(process.cwd(), "./src/grammar.txt");
const EXAMPLE_FILE = path.join(process.cwd(), "./examples/scratch.txt");
const GPR_COUNT = 2;

async function main() {
  const productions = buildProductions(await fs.readFile(GRAMMAR_FILE, "utf8"));
  const parserGenerator = Sparse.fromProductions<TokenType, TokenMetadata, BaseNode>({
    productions,
    toStringifiedTokenType,
  });

  const source_code = await fs.readFile(EXAMPLE_FILE, "utf8");
  const lexer = lexerGenerator.generate(source_code, () => ({}));
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
    return print_diagnostic(EXAMPLE_FILE, source_code, token.line, token.column, reason);
  }

  const root_node = parsing_result.result as Program | null;
  if (root_node == null) throw new Error("Invariant: Root node should not be null. ");

  // Statically analyze the program
  const static_context = new StaticAnalysisContext();
  root_node.verify_static_analysis(static_context);
  if (static_context.errors.length > 0) {
    for (const error of static_context.errors)
      print_diagnostic(EXAMPLE_FILE, source_code, error.token.line, error.token.column, error.message);
    return;
  }

  // Proceed with compilation
  const globals = root_node.definitions.variables.get_items_reversed();
  const functions = root_node.definitions.functions.get_items_reversed();
  const units = functions.map((fn) => {
    const intermediate_representation = fn.compile(globals.map((x) => x.name.lexeme));
    console.log(intermediate_representation.emitted.map((x) => x.to_stringified()));

    let cfg = to_ssa(intermediate_representation);
    cfg = optimize(intermediate_representation, cfg);
    const compiled = compile(intermediate_representation, cfg, GPR_COUNT);
    return [fn.name.lexeme, compiled] as [string, RelocatableUnit];
  });

  const linked = load(filter_reachable_units(units, "main"), globals);
  console.log("Printing linked code: ================");
  for (let i = 0; i < linked.length; i++) {
    const instruction = linked[i];
    console.log(`[${i.toString().padStart(2, "0")}]: ${instruction.to_stringified()}`);
  }

  start_repl(create_runner(linked));
}

export function pretty_print(x: BasicBlock[]) {
  console.log("================================");
  for (const b of x) {
    console.log(b.labels);
    console.log(b.instructions.map((i) => i.to_stringified()));
  }
}

main();

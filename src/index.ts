import fs from "fs/promises";
import path from "path";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "./lexer";
import { buildProductions, Sparse } from "@scinorandex/sparse";
import { BaseNode, Program, Reducers } from "./parser";
import { BasicBlock, constraint_registers, create_register_inference_graph, to_ssa } from "./intermediate";
import { compile, RelocatableUnit } from "./compiler";
import { load } from "./linker";
import { create_runner } from "./vm";
import { start_repl } from "./repl";
import { optimize } from "./optimizer";

const GRAMMAR_FILE = path.join(process.cwd(), "./src/grammar.txt");
const EXAMPLE_FILE = path.join(process.cwd(), "./exampes/fib.txt");
const GPR_COUNT = 2;

async function main() {
  const productions = buildProductions(await fs.readFile(GRAMMAR_FILE, "utf8"));
  const parserGenerator = Sparse.fromProductions<TokenType, TokenMetadata, BaseNode>({
    productions,
    toStringifiedTokenType,
  });

  const lexer = lexerGenerator.generate(await fs.readFile(EXAMPLE_FILE, "utf8"), () => ({}));
  const parser = parserGenerator.generate(lexer, {
    reducer: ({ bag, name }) => {
      const reducer = Reducers[name ?? ""];
      if (reducer != null) return reducer(bag);
      throw new Error("Invariant: Reducer should not be null. " + name);
    },
  });

  const rootNode = parser.parse().result as Program | null;
  if (rootNode == null) throw new Error("Invariant: Root node should not be null. ");

  const functions = rootNode.function_definitions.get_items_reversed();
  const units = functions.map((fn) => {
    const intermediate_representation = fn.compile();
    // console.log(intermediate_representation.emitted.map((x) => x.to_stringified()));

    const ssa_representation = to_ssa(intermediate_representation);
    const cfg = optimize(intermediate_representation, ssa_representation);
    const compiled = compile(intermediate_representation, cfg, GPR_COUNT);
    return [fn.name.lexeme, compiled] as [string, RelocatableUnit];
  });

  const linked = load(units);
  console.log("Printing linked code: ================");
  for (let i = 0; i < linked.length; i++) {
    const instruction = linked[i];
    console.log(`[${i.toString().padStart(2, "0")}]: ${instruction.to_stringified()}`);
  }

  start_repl(create_runner(linked));
}

export function pretty_print(x: BasicBlock[]) {
  for (const b of x) console.log(b.instructions.map((i) => i.to_stringified()));
}

main();

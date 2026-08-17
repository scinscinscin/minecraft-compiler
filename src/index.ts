import fs from "fs/promises";
import path from "path";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "./lexer";
import { buildProductions, Sparse } from "@scinorandex/sparse";
import { BaseNode, Program, Reducers } from "./parser";
import { BinaryOperation, Halt, IntermediateBytecode, Jump, Move, Push } from "./bytecode";
import { link, RelocatableUnit } from "./linker";
import { execute } from "./vm";

const GRAMMAR_FILE = path.join(process.cwd(), "./src/grammar.txt");
const SOURCE = `function main () {
  var foo = 2;
  foo = foo + 2;
  return foo;
}`;

// Code that runs before main
const BOOTSTRAP_CODE: IntermediateBytecode[] = [
  new Move({ type: "constant", value: 255 }, { type: "stack" }),
  new Move({ type: "constant", value: 255 }, { type: "base" }),

  new Move({ type: "ip" }, { type: "gpr", index: 0 }), // ip has a value of 2 and we want to go to 6
  new BinaryOperation("+", { type: "gpr", index: 2 }, { type: "gpr", index: 0 }, { type: "constant", value: 4 }),
  new Push({ type: "gpr", index: 2 }),
  new Jump("unconditional", "main_start"),
  new Halt(),
];

async function main() {
  const productions = buildProductions(await fs.readFile(GRAMMAR_FILE, "utf8"));
  const parserGenerator = Sparse.fromProductions<TokenType, TokenMetadata, BaseNode>({
    productions,
    toStringifiedTokenType,
  });

  const lexer = lexerGenerator.generate(SOURCE, () => ({}));
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
  const linker_output = link([
    ["_start", BOOTSTRAP_CODE],
    ...functions.map((x) => [x.name.lexeme, x.compile()] as RelocatableUnit),
  ]);

  const result = execute(linker_output);
  console.log("Program terminated successfully. ");
  console.log({ result });
}

main();

import fs from "fs/promises";
import path from "path";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "./lexer";
import { buildProductions, Sparse } from "@scinorandex/sparse";
import { BaseNode, Program, Reducers } from "./parser";
import { liveliness_analysis, to_ssa } from "./intermediate";

const GRAMMAR_FILE = path.join(process.cwd(), "./src/grammar.txt");
const SOURCE = `function main () {
  var foo = 2;
  var bar = 3;

  if (foo < 10) {
    foo = foo + 2;
  }

  bar = bar + foo;
  return bar;
}`;

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
  const main = functions.find((x) => x.name.lexeme === "main");

  if (main == null) throw new Error("Invariant: Main function should not be null. ");

  const intermediate_representation = main.compile();
  const x = to_ssa(intermediate_representation);
  console.log(x);
  console.log(x.map((b) => b.instructions.map((i) => i.to_stringified())));

  console.log(liveliness_analysis(x));
}

main();

import fs from "fs/promises";
import path from "path";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "./lexer";
import { buildProductions, Sparse } from "@scinorandex/sparse";
import { BaseNode, Program, Reducers } from "./parser";
import { BasicBlock, liveliness_analysis, to_ssa } from "./intermediate";
import { compile, RelocatableUnit } from "./compiler";
import { load } from "./linker";
import { create_runner } from "./vm";
import { start_repl } from "./repl";

const GRAMMAR_FILE = path.join(process.cwd(), "./src/grammar.txt");
// calculate the 6th fib term, which is 8 (index = 0)
const SOURCE = `function main () {
  var n1 = 0;
  var n2 = 1;
  var nextterm = 1;
  var i = 0;

  while loop (i < 5) {
    nextterm = n1 + n2;

    n1 = n2;
    n2 = nextterm;

    i = i + 1;
  }

  return nextterm;
}`;

// const SOURCE = `function main () {
//   var i = 0;

//   while inside (i < 2) {
//     i = i + 1;
//   }

//   return i;
// }`;

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
  const units = functions.map((fn) => {
    const intermediate_representation = fn.compile();
    const ssa_representation = to_ssa(intermediate_representation);
    const { cfg, graph } = liveliness_analysis(ssa_representation);
    console.log(graph);
    pretty_print(ssa_representation);

    const compiled = compile(intermediate_representation, cfg, graph);
    return [fn.name.lexeme, compiled] as [string, RelocatableUnit];
  });

  const linked = load(units);
  for (let i = 0; i < linked.length; i++) {
    const instruction = linked[i];
    console.log(`[${i.toString().padStart(2, "0")}]: ${instruction.to_stringified()}`);
  }

  const runner = create_runner(linked);
  start_repl(runner);
}

function pretty_print(x: BasicBlock[]) {
  for (const b of x) console.log(b.instructions.map((i) => i.to_stringified()));
}

main();

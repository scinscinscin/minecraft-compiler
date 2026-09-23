import fs from "fs/promises";
import path from "path";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "./lexer";
import { buildProductions, Sparse } from "@scinorandex/sparse";
import { BaseNode, Program, Reducers } from "./parser";
import { BasicBlock, FunctionCallInstruction, to_ssa } from "./intermediate";
import { compile, RelocatableUnit } from "./compiler";
import { load } from "./linker";
import { create_runner } from "./vm";
import { start_repl } from "./repl";
import { optimize } from "./optimizer";
import { TypeChecker } from "./typechecker";

const GRAMMAR_FILE = path.join(process.cwd(), "./src/grammar.txt");
const EXAMPLE_FILE = path.join(process.cwd(), "./examples/scratch.txt");
const GPR_COUNT = 2;

function filter_reachable_units(units: [string, RelocatableUnit][], entry: string): [string, RelocatableUnit][] {
  const unit_map = new Map(units);

  const reachable = new Set<string>([entry]);
  const queue = [entry] as string[];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const unit = unit_map.get(current);
    if (!unit) continue;

    for (const instr of unit.compilation_context.emitted) {
      if (instr instanceof FunctionCallInstruction) {
        const called = instr.function_name;
        if (reachable.has(called)) continue;
        reachable.add(called);
        queue.push(called);
      }
    }
  }

  return units.filter(([name]) => reachable.has(name));
}

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

  const type_checker = new TypeChecker();
  type_checker.check_all(rootNode);
  if (type_checker.has_errors()) {
    type_checker.print_errors();
    process.exit(1);
  }

  const globals = rootNode.definitions.variables.get_items_reversed();
  const functions = rootNode.definitions.functions.get_items_reversed();

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

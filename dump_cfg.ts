import fs from "fs";
import { buildProductions, Sparse } from "@scinorandex/sparse";
import { lexerGenerator, TokenMetadata, TokenType, toStringifiedTokenType } from "./src/lexer";
import { BaseNode, Program, Reducers, FunctionDefinition } from "./src/parser";
import { BasicBlock, to_ssa } from "./src/intermediate";
import { optimize, OptimizationPassName } from "./src/optimizer";

function parse(source: string): FunctionDefinition {
  const productions = buildProductions(fs.readFileSync("./src/grammar.txt", "utf8"));
  const pg = Sparse.fromProductions<TokenType, TokenMetadata, BaseNode>({ productions, toStringifiedTokenType });
  const lexer = lexerGenerator.generate(source, () => ({}));
  const parser = pg.generate(lexer, {
    reducer: ({ bag, name }) => {
      const r = Reducers[name ?? ""];
      if (r != null) return r(bag);
      throw new Error("no reducer " + name);
    },
  });
  const root = parser.parse().result as Program;
  const globals_names = root.definitions.variables.get_items_reversed().map((x) => x.name.lexeme);
  return root.definitions.functions.get_items_reversed().find((f) => f.name.lexeme === "main")!;
}

function dump(tag: string, cfg: BasicBlock[]) {
  const lines: string[] = [`\n########## ${tag} ##########`];
  cfg.forEach((b, i) => {
    lines.push(`-- block ${i} [${b.labels.join(",")}] succ=[${b.successors.map((s) => cfg.indexOf(s))}]`);
    for (const ins of b.instructions) lines.push("   " + ins.to_stringified());
  });
  return lines.join("\n");
}

const fib = fs.readFileSync("./examples/fib.txt", "utf8");

// Baseline: to_ssa only
{
  const fn = parse(fib);
  const ctx = fn.compile([]);
  const cfg = to_ssa(ctx);
  fs.appendFileSync("/tmp/opencode/cfg.txt", dump("BASELINE (to_ssa only)", cfg));
}

// After copy_propagation only
{
  const fn = parse(fib);
  const ctx = fn.compile([]);
  const cfg = to_ssa(ctx);
  const enabled: OptimizationPassName[] = ["copy_propagation"];
  optimize(ctx, cfg, enabled);
  fs.appendFileSync("/tmp/opencode/cfg.txt", dump("AFTER copy_propagation only", cfg));
}
console.log("DONE_DUMP");

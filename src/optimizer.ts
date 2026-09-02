import {
  BasicBlock,
  compare_operands,
  FunctionCallInstruction,
  IRCode,
  liveliness_analysis,
  Operand,
} from "./intermediate";
import { FunctionCompilationContext } from "./parser";

export function optimize(fn_compile_context: FunctionCompilationContext, cfg: BasicBlock[]): BasicBlock[] {
  const constant_cache = new ConstantCache();

  while (true) {
    let changed = false;
    changed = changed || constant_propagation(cfg, constant_cache);
    changed = changed || dead_code_elimination(fn_compile_context, cfg);
    changed = changed || statement_replacement(fn_compile_context, cfg);
    if (changed == false) break;
  }

  return cfg;
}

function dead_code_elimination(fn_compile_context: FunctionCompilationContext, cfg: BasicBlock[]): boolean {
  const { live_out } = liveliness_analysis(cfg);
  let changed = false;

  for (let i = 0; i < cfg.length; i++) {
    const block = cfg[i];
    let live = live_out[i].filter((x) => x.type !== "literal");
    let candidates = [] as IRCode[];

    for (const instruction of block.instructions.toReversed()) {
      // Determine what is defined and what is used in this instruction
      const defined = instruction.get_outputs().filter((x) => x.type !== "literal");
      const used = instruction.get_inputs().filter((x) => x.type !== "literal");

      // if everything this variable defines is not present in live, then its a candidate of being dead code
      if (defined.length > 0 && defined.every((x) => !live.some((y) => compare_operands(x, y))))
        candidates.push(instruction);

      // Update the liveset
      // remote defined variables from live
      for (const defined_variable of defined) live = live.filter((x) => !compare_operands(x, defined_variable));
      for (const used_variable of used)
        if (!live.some((x) => compare_operands(x, used_variable))) live.push(used_variable);
    }

    // Remove Function calls as candidates for removal since we don't know if they have side effects
    candidates = candidates.filter((x) => !(x instanceof FunctionCallInstruction));
    if (candidates.length === 0) continue;

    changed = true;
    for (const candidate of candidates) {
      block.remove_instruction(candidate);
      fn_compile_context.remove_instruction(candidate);
    }
  }

  return changed;
}

export class ConstantCache {
  private cache = [] as [Operand, Operand][];

  set(ssa_variable_operand: Operand, value: Operand): boolean {
    // make sure that ssa_variable_operand is ssa variable
    if (ssa_variable_operand.type !== "ssa_variable" && ssa_variable_operand.type !== "temp_reg") return false;

    const existing = this.cache.find((x) => compare_operands(x[0], ssa_variable_operand));
    if (existing != undefined) return false;

    this.cache.push([ssa_variable_operand, value]);
    return true;
  }

  get(ssa_variable_operand: Operand): Operand | undefined {
    if (ssa_variable_operand.type !== "ssa_variable") return undefined;

    const existing = this.cache.find((x) => compare_operands(x[0], ssa_variable_operand));
    if (existing == undefined) return undefined;
    else return existing[1];
  }
}

export function constant_propagation(cfg: BasicBlock[], cache: ConstantCache): boolean {
  let changed = false;

  for (let i = 0; i < cfg.length; i++) {
    const instructions = cfg[i].instructions;

    for (const instruction of instructions) {
      const modified = instruction.fold_constants(cache);
      if (modified) changed = true;
    }
  }

  return changed;
}

export function statement_replacement(fn_compile_context: FunctionCompilationContext, cfg: BasicBlock[]): boolean {
  let changed = false;

  const replace = (old_instruction: IRCode, replacement: IRCode) => {
    changed = true;

    // find old_instruction in emitted and cfg and replace them
    fn_compile_context.replace_instruction(old_instruction, replacement);
    for (const block of cfg) block.replace_instruction(old_instruction, replacement);
  };

  for (const instr of fn_compile_context.emitted) {
    const replacement = instr.optimize_out();
    if (replacement != null) replace(instr, replacement);
  }

  return changed;
}

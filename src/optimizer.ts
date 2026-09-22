import { pretty_print } from ".";
import {
  BasicBlock,
  compare_operands,
  ConditionalJump,
  FunctionCallInstruction,
  IRCode,
  JumpInstruction,
  liveliness_analysis,
  Operand,
  Phi,
} from "./intermediate";
import { FunctionCompilationContext } from "./parser";

export function optimize(fn_compile_context: FunctionCompilationContext, cfg: BasicBlock[]): BasicBlock[] {
  const constant_cache = new ConstantCache();

  while (true) {
    let changed = false;
    changed = changed || constant_propagation(cfg, constant_cache);
    changed = changed || dead_code_elimination(fn_compile_context, cfg);
    changed = changed || statement_replacement(fn_compile_context, cfg);
    changed = changed || dead_jump_elimination(fn_compile_context, cfg);
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

export function dead_jump_elimination(fn_compile_context: FunctionCompilationContext, cfg: BasicBlock[]): boolean {
  let changed = false;

  for (const block of cfg) {
    for (const instruction of block.instructions) {
      if (instruction instanceof ConditionalJump) {
        const condition = instruction.expression;
        if (condition.type === "literal" && condition.is_parameter == false) {
          changed = true;

          // determine which jump to take
          // if true replace with an absolute jump to the label and remove successor block
          if (condition.value !== 0) {
            // replace instruction with an absolute jump to the label
            const jump = new JumpInstruction(instruction.label);
            block.replace_instruction(instruction, jump);
            fn_compile_context.replace_instruction(instruction, jump);

            // Keep true block
            const true_block = cfg.find((x) => x.labels.includes(instruction.label))!;
            block.successors = block.successors.filter((x) => x === true_block);

            // remove false block
            const false_label = instruction.label.replaceAll("_true", "_false");
            const successor_to_remove = cfg.find((x) => x.labels.includes(false_label));
            if (successor_to_remove == null) throw new Error("Invariant: Could not find successor block");

            cfg.splice(cfg.indexOf(successor_to_remove), 1);
            for (const unused_instruction of successor_to_remove.instructions)
              fn_compile_context.remove_instruction(unused_instruction);

            for (const block of cfg)
              for (const instr of block.instructions)
                if (instr instanceof Phi) instr.remove_source(successor_to_remove);
          } else {
            // delete true block
            // if false block exists, jump to it unconditionally
            // else jump to the finished label unconditionally

            // delete the current instruction
            block.remove_instruction(instruction);
            fn_compile_context.remove_instruction(instruction);

            // remove true block
            const true_block = cfg.find((x) => x.labels.includes(instruction.label))!;
            block.successors = block.successors.filter((x) => x !== true_block);

            cfg.splice(cfg.indexOf(true_block), 1);
            for (const unused_instruction of true_block.instructions)
              fn_compile_context.remove_instruction(unused_instruction);

            for (const block of cfg)
              for (const instr of block.instructions) if (instr instanceof Phi) instr.remove_source(true_block);
          }
        }
      }
    }
  }

  enforce_graph_consistency(fn_compile_context, cfg);
  return changed;
}

// removes block that don't have a predecessor
export function enforce_graph_consistency(fn_compile_context: FunctionCompilationContext, cfg: BasicBlock[]) {
  let changed_within_iteration = true;
  while (changed_within_iteration == true) {
    changed_within_iteration = false;

    for (let i = 1; i < cfg.length; i++) {
      const block = cfg[i];

      // make sure that there is atleast one block that points to this block
      let is_reached = false;
      reaching: for (const other_block of cfg) {
        if (other_block.successors.includes(block)) {
          is_reached = true;
          break reaching;
        }
      }

      if (is_reached == false) {
        // remove this block and all instructions inside of it
        changed_within_iteration = true;

        cfg.splice(i, 1);
        for (const instruction of block.instructions) fn_compile_context.remove_instruction(instruction);
        for (const block of cfg)
          for (const instr of block.instructions) if (instr instanceof Phi) instr.remove_source(block);
      }
    }
  }
}

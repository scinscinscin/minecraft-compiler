import {
  BinaryMachineInstruction,
  ConditionalJumpMachineInstruction,
  create_temporary_block,
  GotoLabelMachineInstruction,
  JumpMachineInstruction,
  LoadMachineInstruction,
  MoveMachineInstruction,
  PushMachineInstruction,
  RelocatableUnit,
  UnaryMachineInstruction,
} from "./compiler";
import { TokenType } from "./lexer";
import { FunctionCompilationContext } from "./parser";
import { color_graph } from "./utils/coloring";

export abstract class IRCode {
  check_if_redefines_variable(variable_name: string): boolean {
    return false;
  }

  /**
   * This function is called whenever its time to convert to SSA form.
   * It receives a variable stack manager that tracks the state of variables.
   * The job is to replace variable references with SSA references.
   * By default it does nothing and is up to the instruction how they'll utilize it.
   */
  to_ssa(variable_name: string, context: VariableStackManager) {}

  abstract to_stringified(): string;

  // Get the operands this instruction expects
  get_inputs(): Operand[] {
    return [];
  }

  // Get what the instruction defines
  get_outputs(): Operand[] {
    return [];
  }

  abstract to_machine_code(context: RelocatableUnit): void;
}

function handle_operand_read(existing: Operand, variable_name: string, context: VariableStackManager) {
  if (existing.type !== "variable" || existing.name !== variable_name) return existing;

  const latest_index = context.get_top();
  return { type: "ssa_variable", name: variable_name, index: latest_index } as Operand;
}

function handle_operand_write(existing: Operand, variable_name: string, context: VariableStackManager) {
  if (existing.type !== "variable" || existing.name !== variable_name) return existing;

  const latest_index = context.get_next_variable_index();
  return { type: "ssa_variable", name: variable_name, index: latest_index } as Operand;
}

// TODO: replace this with something, soon
export class Phi extends IRCode {
  target: Operand;
  sources: Operand[] = [];
  from: BasicBlock[] = [];

  constructor(variable_name: string) {
    super();
    this.target = { type: "variable", name: variable_name };
  }

  add_source(name: string, index: number, block: BasicBlock) {
    this.sources.push({ type: "ssa_variable", name, index });
    this.from.push(block);
  }

  check_if_redefines_variable(variable_name: string): boolean {
    if (this.target.type !== "variable") return false;
    return this.target.name === variable_name;
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.target = handle_operand_write(this.target, variable_name, context);
  }

  to_stringified() {
    const operands = this.sources.map((x) => stringify_operand(x)).join(", ");
    return `${stringify_operand(this.target)} = phi(${operands})`;
  }

  get_outputs() {
    return [this.target];
  }

  to_machine_code(context: RelocatableUnit) {}
}

export class GotoLabel extends IRCode {
  constructor(public readonly label: string) {
    super();
  }

  to_stringified() {
    return `${this.label}:`;
  }

  to_machine_code(context: RelocatableUnit) {
    // If we're emitting a goto label, we need to check if there's new predecessors
    // Get the basic block that this label is associated with
    const lookup_result = context.get_basic_block(this.label);
    if (lookup_result != null) {
      const [basic_block_index, basic_block] = lookup_result;
      const new_predecesors = context.edge_mapping.find((x) => x.basic_block === basic_block);

      if (new_predecesors != null) {
        for (let i = 0; i < new_predecesors.new_predecessors.length; i++) {
          const new_predecessor = new_predecesors.new_predecessors[i];
          const from = new_predecessor.predecessor;
          const from_index = context.basic_blocks.indexOf(from);

          // Emit new label, then the instructions, then the jump
          const predecessor_label = `__edge_${from_index}_${basic_block_index}__`;
          context.emit(new GotoLabelMachineInstruction(predecessor_label));

          const machine_operands = new_predecessor.associations.map((x) => ({
            target: context.to_machine_operand(x.target),
            source: context.to_machine_operand(x.source),
          }));
          for (const instruction of create_temporary_block(machine_operands)) context.emit(instruction);
          context.emit(new JumpMachineInstruction(this.label));
        }
      }
    }

    context.emit(new GotoLabelMachineInstruction(this.label));
  }
}

export type Operand =
  | { type: "variable"; name: string }
  | { type: "temp_reg"; index: number }
  | { type: "literal"; is_parameter: boolean; value: number }
  | { type: "ssa_variable"; name: string; index: number }
  | { type: "return_register" };

function stringify_operand(operand: Operand) {
  return JSON.stringify(operand);
}

export class BinaryInstruction extends IRCode {
  constructor(
    public target: Operand,
    public left: Operand,
    public readonly op: TokenType,
    public right: Operand,
  ) {
    super();
  }

  get_inputs() {
    return [this.left, this.right];
  }

  get_outputs() {
    return [this.target];
  }

  check_if_redefines_variable(variable_name: string): boolean {
    // if target equals operand, then it is redefined
    if (this.target.type !== "variable") return false;
    if (this.target.name !== variable_name) return false;
    return true;
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.left = handle_operand_read(this.left, variable_name, context);
    this.right = handle_operand_read(this.right, variable_name, context);
    this.target = handle_operand_write(this.target, variable_name, context);
  }

  to_stringified() {
    const op = TokenType[this.op];
    return `${stringify_operand(this.target)} = ${stringify_operand(this.left)} ${op} ${stringify_operand(this.right)}`;
  }

  to_machine_code(context: RelocatableUnit) {
    const left = context.to_machine_operand(this.left);
    const right = context.to_machine_operand(this.right);
    const target = context.to_machine_operand(this.target);
    context.emit(new BinaryMachineInstruction(target, left, right, this.op));
  }
}

export class LoadInstruction extends IRCode {
  constructor(
    public target: Operand,
    public source: Operand,
  ) {
    super();
  }

  get_inputs() {
    return [this.source];
  }

  get_outputs() {
    return [this.target];
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.source = handle_operand_read(this.source, variable_name, context);
    this.target = handle_operand_write(this.target, variable_name, context);
  }

  to_stringified() {
    return `${stringify_operand(this.target)} = *${stringify_operand(this.source)}`;
  }

  to_machine_code(context: RelocatableUnit) {
    const source = context.to_machine_operand(this.source);
    const target = context.to_machine_operand(this.target);
    context.emit(new LoadMachineInstruction(target, source));
  }
}

export class UnaryInstruction extends IRCode {
  constructor(
    public target: Operand,
    public left: Operand,
    public readonly op: TokenType,
  ) {
    super();
  }

  get_inputs() {
    return [this.left];
  }

  get_outputs() {
    return [this.target];
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.left = handle_operand_read(this.left, variable_name, context);
    this.target = handle_operand_write(this.target, variable_name, context);
  }

  to_stringified() {
    const op = TokenType[this.op];
    return `${stringify_operand(this.target)} = ${stringify_operand(this.left)} ${op}`;
  }

  to_machine_code(context: RelocatableUnit) {
    const left = context.to_machine_operand(this.left);
    const target = context.to_machine_operand(this.target);
    context.emit(new UnaryMachineInstruction(target, left, this.op));
  }
}

export class MoveInstruction extends IRCode {
  constructor(
    public target: Operand,
    public source: Operand,
  ) {
    super();
  }

  get_inputs() {
    return [this.source];
  }

  get_outputs() {
    return [this.target];
  }

  check_if_redefines_variable(variable_name: string): boolean {
    // if target equals operand, then it is redefined
    if (this.target.type !== "variable") return false;
    if (this.target.name !== variable_name) return false;
    return true;
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.target = handle_operand_write(this.target, variable_name, context);
    this.source = handle_operand_read(this.source, variable_name, context);
  }

  to_stringified() {
    return `${stringify_operand(this.target)} = ${stringify_operand(this.source)}`;
  }

  to_machine_code(context: RelocatableUnit) {
    const source = context.to_machine_operand(this.source);
    const target = context.to_machine_operand(this.target);
    context.emit(new MoveMachineInstruction(target, source));
  }
}

export class JumpInstruction extends IRCode {
  constructor(public readonly label: string) {
    super();
  }

  to_stringified() {
    return `jump ${this.label}`;
  }

  to_machine_code(context: RelocatableUnit) {
    context.emit(new JumpMachineInstruction(this.label));
  }

  change_label(new_label: string) {
    return new JumpInstruction(new_label);
  }
}

export class ConditionalJump extends IRCode {
  constructor(
    public expression: Operand,
    public readonly label: string,
  ) {
    super();
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.expression = handle_operand_write(this.expression, variable_name, context);
  }

  get_inputs() {
    return [this.expression];
  }

  to_stringified() {
    return `if ${stringify_operand(this.expression)} goto ${this.label}`;
  }

  to_machine_code(context: RelocatableUnit) {
    const expression = context.to_machine_operand(this.expression);
    context.emit(new ConditionalJumpMachineInstruction(expression, this.label));
  }

  change_label(new_label: string) {
    return new ConditionalJump(this.expression, new_label);
  }
}

export class PushInstruction extends IRCode {
  constructor(public value: Operand) {
    super();
  }

  get_inputs() {
    return [this.value];
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.value = handle_operand_read(this.value, variable_name, context);
  }

  to_stringified() {
    return `push ${stringify_operand(this.value)}`;
  }

  to_machine_code(context: RelocatableUnit) {
    const value = context.to_machine_operand(this.value);
    context.emit(new PushMachineInstruction(value));
  }
}

export class FunctionCallInstruction extends IRCode {
  constructor(
    public target: Operand,
    public readonly operands: Operand[],
    public readonly function_name: string,
  ) {
    super();
  }

  get_inputs() {
    return this.operands;
  }

  get_outputs() {
    return [this.target];
  }

  to_stringified() {
    return `${stringify_operand(this.target)} = ${this.function_name}()`;
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.target = handle_operand_read(this.target, variable_name, context);
  }

  // By the time that we're here, the operands have already been pushed to the stack, we need to take a copy of the return address
  // Once we return from the called function, we need to deallocate the arguments pushed
  to_machine_code(context: RelocatableUnit) {
    context.emit(new PushMachineInstruction({ type: "instruction_pointer", input_offset: 0 }));
    context.emit(new JumpMachineInstruction(this.function_name + "_init"));
    context.emit(
      new BinaryMachineInstruction(
        { type: "stack_pointer" },
        { type: "stack_pointer" },
        { type: "constant", value: this.operands.length },
        TokenType.PLUS,
      ),
    );
  }
}

export class FunctionExitInstruction extends IRCode {
  constructor() {
    super();
  }

  to_stringified() {
    return "function_exit";
  }

  get_inputs() {
    return [{ type: "return_register" } as Operand];
  }

  to_machine_code(context: RelocatableUnit) {
    // context.emit(new PopMachineInstruction({ type: "instruction_pointer" }));
  }
}

// THIS INTERMEDIATE INSTRUCTION IS NOT USED
export class ReturnInstruction extends IRCode {
  constructor(public value: Operand) {
    super();
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.value = handle_operand_read(this.value, variable_name, context);
  }

  to_stringified() {
    return `return ${stringify_operand(this.value)}`;
  }

  to_machine_code(context: RelocatableUnit) {
    const value = context.to_machine_operand(this.value);
    context.emit(new MoveMachineInstruction({ type: "gpr", index: 0 }, value));
    context.emit(new GotoLabelMachineInstruction("function_exit"));
  }
}

export function determine_leaders(code: IRCode[]) {
  const leaders = [] as { leader: IRCode; labels: string[] }[];

  let line_after_goto_label = false,
    line_after_jump_source = false;
  let labels: string[] = [];

  for (const line of code) {
    if (line instanceof GotoLabel) {
      // The line after a goto label is a leader
      line_after_goto_label = true;
      labels.push(line.label);
      continue;
    }

    if (line_after_jump_source) {
      leaders.push({ leader: line, labels });
      line_after_goto_label = false;
      line_after_jump_source = false;
      labels = [];
    }

    if (line instanceof JumpInstruction || line instanceof ConditionalJump) {
      // the line after a jump instruction is a leader
      line_after_jump_source = true;

      // We need to do a jump target check here because the line before may be a goto label
      if (line_after_goto_label) {
        leaders.push({ leader: line, labels });
        line_after_goto_label = false;
        labels = [];
      }
      continue;
    }

    if (line_after_goto_label || line_after_jump_source) {
      leaders.push({ leader: line, labels });
      line_after_goto_label = false;
      line_after_jump_source = false;
      labels = [];
    }
  }

  return leaders;
}

export class BasicBlock {
  instructions: IRCode[] = [];
  constructor(public readonly labels: string[]) {}

  add_instruction(instruction: IRCode) {
    this.instructions.push(instruction);
  }

  successors: BasicBlock[] = [];
  add_next_block(block: BasicBlock) {
    this.successors.push(block);
  }

  inserted_phi = [] as string[];
  insert_phi(variable: string) {
    if (this.inserted_phi.includes(variable)) return;
    this.inserted_phi.push(variable);
    this.instructions.unshift(new Phi(variable));
  }

  dominance_tree_children: BasicBlock[] = [];
  add_dominance_tree_child(block: BasicBlock) {
    this.dominance_tree_children.push(block);
  }

  set_phi(variable_name: string, top: number, block: BasicBlock) {
    // look for phi node inside instructions that set variable_name
    for (const instruction of this.instructions) {
      if (
        instruction instanceof Phi &&
        ((instruction.target.type === "variable" && instruction.target.name === variable_name) ||
          (instruction.target.type === "ssa_variable" && instruction.target.name === variable_name))
      ) {
        instruction.add_source(variable_name, top, block);
      }
    }
  }

  dfs(variable_name: string, context: VariableStackManager) {
    const ticket = context.get_ticket();

    // for each of the instructions here, do the renaming
    for (const instruction of this.instructions) instruction.to_ssa(variable_name, context);

    // for each succeeding block in the cfg, tell their phi nodes that redefine variable
    const top = context.get_top();
    for (const child of this.successors) child.set_phi(variable_name, top, this);

    // iterate through the children
    for (const child of this.dominance_tree_children) child.dfs(variable_name, context);

    // do the processing here
    context.return_ticket(ticket);
  }
}

export function create_basic_blocks(code: IRCode[], leaders: { leader: IRCode; labels: string[] }[]) {
  const basic_blocks = [] as BasicBlock[];

  let current_block: BasicBlock | null = null;
  const finalize_current_block = () => {
    if (current_block == null) return;

    basic_blocks.push(current_block);
    current_block = null;
  };

  for (const line of code) {
    const leader = leaders.find((x) => x.leader === line);
    const is_leader = leader != null;

    if (is_leader) {
      finalize_current_block();
      current_block = new BasicBlock(leader.labels);
      current_block.add_instruction(line);
      continue;
    }

    if (line instanceof GotoLabel) continue;
    if (current_block == null) throw new Error("Invariant: Current block should not be null");
    current_block.add_instruction(line);
  }

  finalize_current_block();
  return basic_blocks;
}

export function create_cfg(code: IRCode[]) {
  const leaders = determine_leaders(code);
  const basic_blocks = create_basic_blocks(code, leaders);

  const get_next_blocks = (block: BasicBlock): BasicBlock[] => {
    const ret = [] as BasicBlock[];

    // iterate through code starting from leader_index;
    const leader = block.instructions[0];
    outer: for (let i = code.indexOf(leader); i < code.length; i++) {
      const line = code[i];

      // line can be undefined, need to handle that
      if (line != undefined) {
        if (line instanceof JumpInstruction || line instanceof ConditionalJump) {
          // Find the next block with the label and add it to ret
          ret.push(basic_blocks.find((x) => x.labels.includes(line.label))!);
          if (line instanceof JumpInstruction) break outer;
        }

        if (line instanceof ConditionalJump) {
          // Since its conditional, there's another path that the code can go
          // Starting from i + 1, increment until we find an instruction that is a leader

          inner: for (let j = i + 1; j < code.length; j++) {
            const line = code[j];
            const potential_leader = leaders.find((x) => x.leader === line);
            if (potential_leader == null) continue inner;

            // found something, get the basic block
            const block = basic_blocks.find((x) => x.instructions[0] === line)!;
            ret.push(block);
            break inner;
          }

          break outer;
        }

        if (line !== leader) {
          // Check if line is a leader
          const potential_leader = leaders.find((x) => x.leader === line);
          if (potential_leader != null) {
            const block = basic_blocks.find((x) => x.instructions[0] === line)!;
            ret.push(block);
            break outer;
          }
        }
      }
    }

    return ret;
  };

  // Wire up the basic blocks based on the jumps on the code
  // prettier-ignore
  for (const block of basic_blocks) 
    for (const next_block of get_next_blocks(block)) 
      block.add_next_block(next_block);

  return basic_blocks;
}

export function determine_dominators(basic_blocks: BasicBlock[]) {
  // Initialize dominator array
  const dominators = [[0]] as number[][];
  for (let i = 1; i < basic_blocks.length; i++) {
    const line = [] as number[];
    for (let j = 0; j < basic_blocks.length; j++) line.push(j);
    dominators.push(line);
  }

  function get_predecessors(block: BasicBlock) {
    return basic_blocks.filter((x) => x.successors.includes(block));
  }

  while (true) {
    let changed = false;

    // iterate through each block and calculate new dom
    for (let i = 0; i < basic_blocks.length; i++) {
      const current_block = basic_blocks[i];
      const predecessors = get_predecessors(current_block);

      // get the intersection of the dominators of the predecessors
      const individual_dominators = predecessors.map((x) => dominators[basic_blocks.indexOf(x)]);
      const intersection = array_intersection(individual_dominators);

      // add i if not present in intersection
      if (!intersection.includes(i)) intersection.push(i);

      // intersection is the new dominator for the current node
      if (array_equivalent(dominators[i], intersection) === false) {
        dominators[i] = intersection;
        changed = true;
      }
    }

    if (changed === false) break;
    else continue;
  }

  return dominators;
}

function array_intersection(arrays: number[][]) {
  if (arrays.length === 0) return [];

  const intersection = [] as number[];
  for (let i = 0; i < arrays[0].length; i++) {
    const element = arrays[0][i];
    if (arrays.every((x) => x.includes(element))) intersection.push(element);
  }
  return intersection;
}

function array_equivalent(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function determine_frontier(basic_blocks: BasicBlock[]) {
  const dominators = determine_dominators(basic_blocks);
  const frontier = [] as number[][];

  function get_predecessors(block: BasicBlock) {
    return basic_blocks.filter((x) => x.successors.includes(block));
  }

  // determine the frontier for each node
  for (let i = 0; i < basic_blocks.length; i++) {
    // get the index of nodes that the current node dominates
    const dominating = dominators
      .map((x, i) => [x, i] as [number[], number])
      .filter(([x]) => x.includes(i))
      .map((x) => x[1]);

    let frontier_x = [] as number[];

    for (let j = 0; j < basic_blocks.length; j++) {
      const y = basic_blocks[j];
      const predecessors = get_predecessors(y).map((x) => basic_blocks.indexOf(x));
      // check if x dominates at least one predecessor of y
      const b = dominating.some((x) => predecessors.includes(x));

      if (b) {
        const strict_domination = dominating.includes(j);
        if (!strict_domination) frontier_x.push(j);
      }
    }

    frontier.push(frontier_x);
  }

  return [dominators, frontier];
}

export function to_ssa(context: FunctionCompilationContext) {
  const intermediate_representation: IRCode[] = context.emitted;
  const variables = context.variables;

  // Define the frontier for each variable since we're doing a fixed point iteration
  const variables_frontier = {} as { [key: string]: number[] };
  for (const variable of variables) variables_frontier[variable] = [];

  const cfg = create_cfg(intermediate_representation);
  const [dominators, frontier] = determine_frontier(cfg);

  function idom(index: number) {
    const line = dominators[index];
    const idom_index = line[line.length - 2];
    return cfg[idom_index];
  }

  // Place the phi nodes
  // For each variable, find the blocks that define it
  // Put phi nodes to the iterrated dominance frontier of those blocks
  for (const variable of variables) {
    // For each variable run a fixed point iteration to add phi nodes
    // Stop when the computed frontier is the same as the previous frontier
    inner: while (true) {
      const redefining_blocks = cfg.filter((block) =>
        block.instructions.some((x) => x.check_if_redefines_variable(variable)),
      );
      const redefining_blocks_indices = redefining_blocks.map((x) => cfg.indexOf(x));
      const combined_frontier = redefining_blocks_indices.flatMap((x) => frontier[x]);

      if (array_equals(combined_frontier, variables_frontier[variable])) break inner; // they are the same, stop

      // need to add phi nodes to the new indices added to combined_frontier
      // get nodes in frontier that don't define variable x
      const diff = combined_frontier.filter((x) => !redefining_blocks_indices.includes(x));
      for (const block_index of diff) cfg[block_index].insert_phi(variable);

      variables_frontier[variable] = combined_frontier;
      continue;
    }
  }

  // Phi nodes have been placed, all that is left is to start placing constant and turn it into proper ssa form
  // Build the dominance tree
  for (let i = 1; i < cfg.length; i++) idom(i).add_dominance_tree_child(cfg[i]);
  const compiled_root: BasicBlock = cfg[0];

  // For each variable, begin replacement of their definitions to SSA references
  for (const variable of variables) compiled_root.dfs(variable, new VariableStackManager());
  // console.log(cfg, dominators);
  // console.log(cfg.map((block) => block.instructions.map((x) => x.to_stringified())));

  return cfg;
}

// This class manages the stack and lifetime of each variable
class VariableStackManager {
  stack: number[] = [];

  allocated = -1;
  get_next_variable_index() {
    const next = ++this.allocated;
    this.stack.push(next);
    return next;
  }

  get_top() {
    return this.stack[this.stack.length - 1];
  }

  // Get the index of the top of the stack
  get_ticket() {
    return this.stack.length - 1;
  }

  // Return top of stack to the index provided
  return_ticket(n: number) {
    while (this.stack.length - 1 > n) this.stack.pop();
  }
}

function array_equals(a: number[], b: number[]) {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

type OperandSet = Operand[];
export function liveliness_analysis(cfg: BasicBlock[]) {
  // Need to compute USE and DEF per block
  // Def - variables defined in B
  // Use - variables used before being defined in B
  const use_def: { use: OperandSet; def: OperandSet; phi_uses: OperandSet }[] = [];
  for (let i = 0; i < cfg.length; i++) {
    const block = cfg[i];
    const def: OperandSet = [];
    const use: OperandSet = [];
    const phi_uses: OperandSet = [];

    for (const instruction of block.instructions) {
      // check if the instruction defines a variable
      const defined = instruction.get_outputs();
      const inputs = instruction.get_inputs();

      // add inputs to use if not present in def
      for (const input of inputs) {
        if (input.type !== "literal") if (!def.some((x) => compare_operands(x, input))) use.push(input);
      }

      // add defined to def if not present
      for (const defined_variable of defined)
        if (defined_variable.type !== "literal")
          if (!def.some((x) => compare_operands(x, defined_variable))) def.push(defined_variable);

      if (instruction instanceof Phi) {
        // add phi uses to phi uses
        for (const phi_use of instruction.sources)
          if (phi_use.type !== "literal") if (!def.some((x) => compare_operands(x, phi_use))) phi_uses.push(phi_use);
      }
    }

    use_def[i] = { use, def, phi_uses };
  }

  // console.log("Printing use_def for each block");
  // for (const { use, def, phi_uses } of use_def) console.log(use, def, phi_uses);

  // Run fixed point iteration to determine the live in and live out of each block
  // LIVE_OUT = union of live in of the successors
  // LIVE_IN = USE(B) UNION (LIVE_OUT(B) - DEF(B))
  const LIVE_IN = [] as OperandSet[];
  const LIVE_OUT = [] as OperandSet[];

  for (const block of cfg) {
    LIVE_IN.push([]);
    LIVE_OUT.push([]);
  }

  while (true) {
    let changed = false;

    const change_live_in = (index: number, live_in: OperandSet) => {
      const current = LIVE_IN[index];
      if (are_operand_sets_equal(current, live_in)) return;

      LIVE_IN[index] = live_in;
      changed = true;
    };

    const change_live_out = (index: number, live_out: OperandSet) => {
      const current = LIVE_OUT[index];
      if (are_operand_sets_equal(current, live_out)) return;

      LIVE_OUT[index] = live_out;
      changed = true;
    };

    // Phi operands are handled when computing the contribution of a successor to a predecessor's live out
    for (let i = 0; i < cfg.length; i++) {
      const block = cfg[i];
      const uses = use_def[i].use;
      const defs = use_def[i].def;

      // LIVE OUT = union of live in of the successors
      const successor_indices = block.successors.map((x) => cfg.indexOf(x));
      const live_out = combine_operand_sets_n(successor_indices.map((x) => LIVE_IN[x]));

      for (const next of block.successors) {
        // if the successor contains phi nodes, add the operand that would be chosen when coming from B
        for (const instruction of next.instructions) {
          if (instruction instanceof Phi) {
            for (let j = 0; j < instruction.sources.length; j++) {
              const operand = instruction.sources[j];
              if (instruction.from[j] === block) {
                if (!live_out.some((x) => compare_operands(x, operand))) {
                  live_out.push(operand);
                }
              }
            }
          }
        }
      }

      // LIVE IN = USE(B) UNION (LIVE_OUT(B) - DEF(B))
      const without_defs = live_out.filter((x) => !defs.some((y) => compare_operands(x, y)));
      const live_in = combine_operand_sets_n([uses, without_defs]);

      change_live_in(i, live_in);
      change_live_out(i, live_out);
    }

    if (changed == false) break;
    else continue;
  }

  // Construct the register interference graph by traversing each block backwards
  // with the list of live starting as the LIVE_OUT of each block
  const graph = new RegisterInterferenceGraph();

  for (let i = 0; i < cfg.length; i++) {
    const block = cfg[i];
    let live = LIVE_OUT[i].filter((x) => x.type !== "literal");

    for (const instruction of block.instructions.toReversed()) {
      // Determine what is defined and what is used in this instruction
      const defined = instruction.get_outputs().filter((x) => x.type !== "literal");
      const used = instruction.get_inputs().filter((x) => x.type !== "literal");

      // Add all of defined, used, and live as nodes
      graph.create_nodes([...defined, ...used, ...live]);

      // Add interference for definitions
      for (const defined_variable of defined) {
        for (const live_variable of live) {
          // add an edge between live_variable and defined_variable
          graph.create_edge(defined_variable, live_variable);
        }
      }

      // Update the liveset
      // live -= DEF(instruction)
      // live += USE(instruction)
      for (const defined_variable of defined) {
        // remove defined variables from live
        live = live.filter((x) => !compare_operands(x, defined_variable));
      }

      for (const used_variable of used) {
        // add used variables to live
        // If live doesn't contain used variable, add it
        if (!live.some((x) => compare_operands(x, used_variable))) live.push(used_variable);
      }
    }
  }

  return { cfg, graph };
}

export class RegisterInterferenceGraph {
  adj_list = [] as number[][];

  last_defined = -1;
  list: Operand[] = [];
  _index_of(operand: Operand) {
    for (let i = 0; i < this.list.length; i++) {
      if (compare_operands(this.list[i], operand)) return i;
    }

    return -1;
  }

  get_index_of_operand(operand: Operand) {
    // get the index from list
    const index = this._index_of(operand);
    if (index !== -1) return index;

    // define next
    const next = ++this.last_defined;
    this.list[next] = operand;

    this.adj_list[next] = [];
    return next;
  }

  create_nodes(operands: Operand[]) {
    for (const operand of operands) this.get_index_of_operand(operand);
  }

  create_edge(a: Operand, b: Operand) {
    if (compare_operands(a, b)) return;

    const index_a = this.get_index_of_operand(a);
    const index_b = this.get_index_of_operand(b);

    if (this.adj_list[index_a].includes(index_b) == false) this.adj_list[index_a].push(index_b);
    if (this.adj_list[index_b].includes(index_a) == false) this.adj_list[index_b].push(index_a);
  }

  get_adj_list() {
    return this.adj_list;
  }

  solve(register_count = 7) {
    const adj_list = {} as { [key: string]: string[] };
    for (const node in this.adj_list) adj_list[node.toString()] = this.adj_list[node].map((x) => x.toString());
    const color_map = color_graph(adj_list, register_count);
    return color_map;
  }
}

function combine_operand_sets_n(sets: OperandSet[]) {
  if (sets.length === 0) return [];

  const [first, ...rest] = sets;
  const ret = [...first] as OperandSet;

  for (const set of rest) {
    for (const operand of set) {
      const has_operand = ret.some((x) => compare_operands(x, operand));
      if (!has_operand) ret.push(operand);
    }
  }

  return ret;
}

function intersection(a: OperandSet, b: OperandSet) {
  const ret = [] as OperandSet;
  for (const operand of a) if (b.some((x) => compare_operands(x, operand))) ret.push(operand);
  return ret;
}

function combine_operand_sets(a: OperandSet, b: OperandSet) {
  const ret = [...a] as OperandSet;

  for (const operand of b) {
    const has_operand = ret.some((x) => compare_operands(x, operand));
    if (!has_operand) ret.push(operand);
  }

  return ret;
}

function are_operand_sets_equal(a: OperandSet, b: OperandSet) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!compare_operands(a[i], b[i])) return false;
  return true;
}

export function compare_operands(a: Operand, b: Operand) {
  if (a.type !== b.type) return false;

  if (a.type === "variable" && b.type === "variable") return a.name === b.name;
  if (a.type === "literal" && b.type === "literal") {
    if (a.is_parameter !== b.is_parameter) return false;
    return a.value === b.value;
  }
  if (a.type === "temp_reg" && b.type === "temp_reg") return a.index === b.index;
  if (a.type === "ssa_variable" && b.type === "ssa_variable") return a.name === b.name && a.index === b.index;
  if (a.type === "return_register" && b.type === "return_register") return true;

  return false;
}

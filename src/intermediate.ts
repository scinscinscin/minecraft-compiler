import { TokenType } from "./lexer";
import { FunctionCompilationContext } from "./parser";

export abstract class IRCode {
  check_if_redefines_operand(variable_name: string): boolean {
    return false;
  }

  /**
   * This function is called whenever its time to convert to SSA form.
   * By default it does nothing.
   */
  to_ssa(variable_name: string, context: VariableStackManager) {}

  abstract to_stringified(): string;
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

  constructor(variable_name: string) {
    super();
    this.target = { type: "variable", name: variable_name };
  }

  add_source(name: string, index: number) {
    this.sources.push({ type: "ssa_variable", name, index });
  }

  check_if_redefines_operand(variable_name: string): boolean {
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
}

export class GotoLabel extends IRCode {
  constructor(public readonly label: string) {
    super();
  }

  to_stringified() {
    return `${this.label}:`;
  }
}

export type Operand =
  | { type: "variable"; name: string }
  | { type: "temp_reg"; index: number }
  | { type: "literal"; value: number }
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

  check_if_redefines_operand(variable_name: string): boolean {
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

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.left = handle_operand_read(this.left, variable_name, context);
    this.target = handle_operand_write(this.target, variable_name, context);
  }

  to_stringified() {
    const op = TokenType[this.op];
    return `${stringify_operand(this.target)} = ${stringify_operand(this.left)} ${op}`;
  }
}

export class MoveInstruction extends IRCode {
  constructor(
    public target: Operand,
    public source: Operand,
  ) {
    super();
  }

  check_if_redefines_operand(variable_name: string): boolean {
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

  get_inputs() {
    return [this.source];
  }
}

export class JumpInstruction extends IRCode {
  constructor(public readonly label: string) {
    super();
  }

  to_stringified() {
    return `jump ${this.label}`;
  }
}

export class ConditionalJump extends IRCode {
  constructor(
    public readonly expression: Operand,
    public readonly label: string,
  ) {
    super();
  }

  to_stringified() {
    return `if ${stringify_operand(this.expression)} goto ${this.label}`;
  }
}

export class PushInstruction extends IRCode {
  constructor(public value: Operand) {
    super();
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.value = handle_operand_read(this.value, variable_name, context);
  }

  to_stringified() {
    return `push ${stringify_operand(this.value)}`;
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

  to_stringified() {
    return `${stringify_operand(this.target)} = ${this.function_name}()`;
  }

  to_ssa(variable_name: string, context: VariableStackManager) {
    this.target = handle_operand_read(this.target, variable_name, context);
  }
}

export class FunctionExitInstruction extends IRCode {
  constructor() {
    super();
  }

  to_stringified() {
    return "function_exit";
  }
}

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

class BasicBlock {
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

  set_phi(variable_name: string, top: number) {
    // look for phi node inside instructions that set variable_name
    for (const instruction of this.instructions) {
      if (
        instruction instanceof Phi &&
        ((instruction.target.type === "variable" && instruction.target.name === variable_name) ||
          (instruction.target.type === "ssa_variable" && instruction.target.name === variable_name))
      ) {
        instruction.add_source(variable_name, top);
      }
    }
  }

  dfs(variable_name: string, context: VariableStackManager) {
    const ticket = context.get_ticket();

    // for each of the instructions here, do the renaming
    for (const instruction of this.instructions) instruction.to_ssa(variable_name, context);

    // for each succeeding block in the cfg, tell their phi nodes that redefine variable
    const top = context.get_top();
    for (const child of this.successors) child.set_phi(variable_name, top);

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
        block.instructions.some((x) => x.check_if_redefines_operand(variable)),
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

  for (const variable of variables) compiled_root.dfs(variable, new VariableStackManager());
  console.log(cfg, dominators);
  console.log(cfg.map((block) => block.instructions.map((x) => x.to_stringified())));

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
export function liveliness_analysis(cfg: BasicBlock[]) {}

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

function compare_operands(a: Operand, b: Operand) {
  if (a.type !== b.type) return false;

  if (a.type === "variable" && b.type === "variable") return a.name === b.name;
  if (a.type === "literal" && b.type === "literal") return a.value === b.value;
  if (a.type === "temp_reg" && b.type === "temp_reg") return a.index === b.index;
  if (a.type === "ssa_variable" && b.type === "ssa_variable") return a.name === b.name && a.index === b.index;
  if (a.type === "return_register" && b.type === "return_register") return true;

  return false;
}

import {
  BasicBlock,
  compare_operands,
  ConditionalJump,
  GotoLabel,
  JumpInstruction,
  MoveInstruction,
  Operand,
  Phi,
  RegisterInterferenceGraph,
} from "./intermediate";
import { TokenType } from "./lexer";
import { FunctionCompilationContext } from "./parser";
import { ChaitinOutput } from "./utils/coloring";

abstract class MachineInstruction {
  abstract to_stringified(): string;
}

type MachineOperand =
  | { type: "gpr"; index: number }
  | { type: "instruction_pointer"; input_offset: number }
  | { type: "stack_pointer" }
  | { type: "base_pointer" }
  | { type: "constant"; value: number }
  | { type: "return_register" }
  | { type: "parameter"; index: number };

function stringify_machine_operand(operand: MachineOperand) {
  if (operand.type === "gpr") return `gpr${operand.index}`;
  if (operand.type === "instruction_pointer") return `ip + ${operand.input_offset}`;
  if (operand.type === "stack_pointer") return "sp";
  if (operand.type === "base_pointer") return "bp";
  if (operand.type === "constant") return `${operand.value}`;
  if (operand.type === "return_register") return "return_register";
  // Add two for parameter because 0 is base pointer and 1 is for the return address
  if (operand.type === "parameter") return `stack[bp + ${operand.index + 2}]`;
}

export class BinaryMachineInstruction extends MachineInstruction {
  constructor(
    public readonly target: MachineOperand,
    public readonly left: MachineOperand,
    public readonly right: MachineOperand,
    public readonly op: TokenType,
  ) {
    super();
  }

  to_stringified() {
    return `${stringify_machine_operand(this.target)} = ${stringify_machine_operand(this.left)} ${
      TokenType[this.op]
    } ${stringify_machine_operand(this.right)}`;
  }
}

export class UnaryMachineInstruction extends MachineInstruction {
  constructor(
    public readonly target: MachineOperand,
    public readonly left: MachineOperand,
    public readonly op: TokenType,
  ) {
    super();
  }

  to_stringified() {
    return `${stringify_machine_operand(this.target)} = ${stringify_machine_operand(this.left)} ${TokenType[this.op]}`;
  }
}

export class MoveMachineInstruction extends MachineInstruction {
  constructor(
    public readonly target: MachineOperand,
    public readonly source: MachineOperand,
  ) {
    super();
  }

  to_stringified() {
    return `${stringify_machine_operand(this.target)} = ${stringify_machine_operand(this.source)}`;
  }
}

export class JumpMachineInstruction extends MachineInstruction {
  constructor(public readonly label: string) {
    super();
  }

  to_stringified() {
    return `jump ${this.label}`;
  }
}

export class ConditionalJumpMachineInstruction extends MachineInstruction {
  constructor(
    public readonly condition: MachineOperand,
    public readonly label: string,
  ) {
    super();
  }

  to_stringified() {
    return `if ${stringify_machine_operand(this.condition)} goto ${this.label}`;
  }
}

export class GotoLabelMachineInstruction extends MachineInstruction {
  constructor(public readonly label: string) {
    super();
  }

  to_stringified() {
    return `${this.label}:`;
  }
}

export class PushMachineInstruction extends MachineInstruction {
  constructor(public readonly value: MachineOperand) {
    super();
  }

  to_stringified() {
    return `push ${stringify_machine_operand(this.value)}`;
  }
}

export class PopMachineInstruction extends MachineInstruction {
  constructor(public readonly target: MachineOperand) {
    super();
  }

  to_stringified() {
    return `pop ${stringify_machine_operand(this.target)}`;
  }
}

type NewPredecessor = { predecessor: BasicBlock; associations: MoveInstruction[] };
type EdgeMapping = { basic_block: BasicBlock; new_predecessors: NewPredecessor[] }[];

export class RelocatableUnit {
  emitted = [] as MachineInstruction[];
  emit(mcode: MachineInstruction) {
    this.emitted.push(mcode);
  }

  constructor(
    public readonly graph: RegisterInterferenceGraph,
    public readonly graph_solution: ChaitinOutput,
    public readonly edge_mapping: EdgeMapping,
    public readonly basic_blocks: BasicBlock[],
  ) {}

  to_machine_operand(operand: Operand): MachineOperand {
    if (operand.type === "return_register") return { type: "return_register" };
    if (operand.type === "variable") throw new Error("Invariant: Cannot convert variable to machine operand");
    if (operand.type === "literal") {
      if (operand.is_parameter) return { type: "parameter", index: operand.value };
      else return { type: "constant", value: operand.value };
    }

    const index = this.graph._index_of(operand);
    return { type: "gpr", index: this.graph_solution.color_map[index] };
  }

  get_basic_block(label: string) {
    for (let i = 0; i < this.basic_blocks.length; i++) {
      const block = this.basic_blocks[i];
      if (block.labels.includes(label)) return [i, block] as [number, BasicBlock];
    }

    return null;
  }
}

export function compile(
  context: FunctionCompilationContext,
  blocks: BasicBlock[],
  graph: RegisterInterferenceGraph,
): RelocatableUnit {
  // solve the register interferece graph
  const register_solution = graph.solve(7);

  const intermediates = context.emitted;
  const variables = context.variables;

  // add some context to relocable_unit before we codegen the instructions
  // for each basic block, check if it has phi nodes
  // we're going to add stuff to run before this block to coalesce the phi nodes
  const edge_mapping = [] as EdgeMapping;
  for (const block of blocks) {
    const phi_nodes = block.instructions.filter((x) => x instanceof Phi);
    const new_predecessors = [] as NewPredecessor[];

    const associate = (block: BasicBlock, target: Operand, source: Operand) => {
      if (compare_operands(target, source)) return;

      // Comment this block if you want to force to edge transitions even if its pointless
      // const op1_assigned = graph._index_of(target);
      // const op2_assigned = graph._index_of(source);
      // if (register_solution.color_map[op1_assigned] === register_solution.color_map[op2_assigned]) return;

      const existing = new_predecessors.find((x) => x.predecessor === block);
      if (existing != null) existing.associations.push(new MoveInstruction(target, source));
      else new_predecessors.push({ predecessor: block, associations: [new MoveInstruction(target, source)] });
    };

    for (const phi_node of phi_nodes) {
      const { target, sources, from } = phi_node;

      if (sources.length !== from.length)
        throw new Error("Invariant: Phi node should have the same number of sources and from");
      for (let i = 0; i < sources.length; i++) associate(from[i], target, sources[i]);
    }

    if (new_predecessors.length === 0) continue;

    // if we're going to start generating the beginning "block"
    // we need to generate the code in new_predecessors
    edge_mapping.push({ basic_block: block, new_predecessors });
  }

  const relocatable_unit = new RelocatableUnit(graph, register_solution, edge_mapping, blocks);

  // Push base pointer to stack
  // Copy current value of stack pointer to base pointer
  // Move stack by number of variables
  relocatable_unit.emit(new GotoLabel(context.function_name + "_init"));
  relocatable_unit.emit(new PushMachineInstruction({ type: "base_pointer" }));
  relocatable_unit.emit(new MoveMachineInstruction({ type: "base_pointer" }, { type: "stack_pointer" }));
  relocatable_unit.emit(
    new BinaryMachineInstruction(
      { type: "stack_pointer" },
      { type: "stack_pointer" },
      { type: "constant", value: variables.length },
      TokenType.MINUS,
    ),
  );

  const finalizers = blocks.map((e) => e.instructions[e.instructions.length - 1]);
  for (const intermediate of intermediates) {
    // check if instruction is a finalizer
    const basic_block_index = finalizers.indexOf(intermediate);

    if (basic_block_index !== -1) {
      // intermediate finalizes block
      const block = blocks[basic_block_index];
      const successors = block.successors;

      // if instruction is to jump, check if the block we're jumping to
      // has new predecessors that stem from the block the instruction belongs to
      if (intermediate instanceof JumpInstruction || intermediate instanceof ConditionalJump) {
        const target_label = intermediate.label;
        const [target_block_index, target_block] = relocatable_unit.get_basic_block(target_label)!;

        // check if the block we're going to jump to has new predecessors
        const new_predecessors = relocatable_unit.edge_mapping.find((x) => x.basic_block === target_block);
        if (new_predecessors != null) {
          // check if any of the new_predecessors specify our block
          const new_predecessor = new_predecessors.new_predecessors.find((x) => x.predecessor === block);

          if (new_predecessor != null) {
            // We need to go to this block instead
            const successor_label = `__edge_${basic_block_index}_${target_block_index}__`;
            if (intermediate instanceof JumpInstruction)
              relocatable_unit.emit(new JumpMachineInstruction(successor_label));
            else
              relocatable_unit.emit(
                new ConditionalJumpMachineInstruction(
                  relocatable_unit.to_machine_operand(intermediate.expression),
                  successor_label,
                ),
              );
          } else intermediate.to_machine_code(relocatable_unit);
        } else intermediate.to_machine_code(relocatable_unit);
      }

      // It's not a jump, but it's still the last command, so we're going to compile it normally
      // Then we need to check if the successor of the current block has new predecessors
      else {
        intermediate.to_machine_code(relocatable_unit);

        // If this is undefined then we're at the end of the function
        if (successors.length > 1) throw new Error("Invariant: Current block should only have one successor");
        const target_block = successors[0];
        const target_block_index = blocks.indexOf(target_block);

        if (target_block != undefined) {
          const new_predecessors = relocatable_unit.edge_mapping.find((x) => x.basic_block === target_block);

          if (new_predecessors != null) {
            // check if any of the new_predecessors specify our block
            const new_predecessor = new_predecessors.new_predecessors.find((x) => x.predecessor === block);
            if (new_predecessor != null) {
              const successor_label = `__edge_${basic_block_index}_${target_block_index}__`;
              relocatable_unit.emit(new JumpMachineInstruction(successor_label));
            } else intermediate.to_machine_code(relocatable_unit);
          } else intermediate.to_machine_code(relocatable_unit);
        }
      }
    }

    // If not finalizing anything, then compile normally
    else intermediate.to_machine_code(relocatable_unit);
  }

  // Deallocate the created variables
  // Pop BP and POP back to instruction pointer
  relocatable_unit.emit(
    new BinaryMachineInstruction(
      { type: "stack_pointer" },
      { type: "stack_pointer" },
      { type: "constant", value: variables.length },
      TokenType.PLUS,
    ),
  );
  relocatable_unit.emit(new PopMachineInstruction({ type: "base_pointer" }));
  relocatable_unit.emit(new PopMachineInstruction({ type: "instruction_pointer", input_offset: 1 }));

  return relocatable_unit;
}

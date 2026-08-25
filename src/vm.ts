import { MachineOperand } from "./compiler";
import { LinkedInstruction } from "./linker";
import { Logger } from "./repl";

function init_memory(size: number) {
  const memory = [] as number[];
  for (let i = 0; i < size; i++) memory.push(0);
  return memory;
}

export class Environment {
  instruction_pointer = 0;
  stack_pointer = 0;
  base_pointer = 0;
  return_register = 0;
  gpr = [0, 0, 0, 0, 0, 0, 0];

  memory = init_memory(256);

  get_machine_operand(operand: MachineOperand): number {
    if (operand.type === "gpr") return this.gpr[operand.index];
    if (operand.type === "instruction_pointer") return this.instruction_pointer;
    if (operand.type === "stack_pointer") return this.stack_pointer;
    if (operand.type === "base_pointer") return this.base_pointer;
    if (operand.type === "return_register") return this.return_register;
    if (operand.type === "constant") return operand.value;
    // Add two here because operand.index is the index of the parameter in the function
    // +2 because the first two parameters are the base pointer and return address
    if (operand.type === "parameter") return this.memory[this.base_pointer + operand.index + 2];
    throw new Error("Invariant: Operand should not be null. " + operand);
  }

  set_machine_operand(operand: MachineOperand, value: number) {
    if (operand.type === "gpr") this.gpr[operand.index] = value;
    else if (operand.type === "instruction_pointer") this.set_ip(value + operand.input_offset);
    else if (operand.type === "stack_pointer") this.stack_pointer = value;
    else if (operand.type === "base_pointer") this.base_pointer = value;
    else if (operand.type === "return_register") this.return_register = value;
    else if (operand.type === "constant") return;
    else if (operand.type === "parameter") this.memory[this.base_pointer + operand.index] = value;
    else throw new Error("Invariant: Operand should not be null. " + operand);
  }

  instruction_pointer_changed = false;
  set_ip(value: number) {
    if (this.instruction_pointer_changed) throw new Error("Invariant: Instruction pointer should not be changed twice");
    this.instruction_pointer_changed = true;
    this.instruction_pointer = value;
  }
  has_ip_changed() {
    return this.instruction_pointer_changed;
  }
  clear_ip_changed_flag() {
    this.instruction_pointer_changed = false;
  }

  halted = false;
  halt() {
    this.halted = true;
  }
}

export class Runner {
  environment = new Environment();
  constructor(public readonly instructions: LinkedInstruction[]) {}

  dump_registers(logger: Logger) {
    logger.log(`GPR: [${this.environment.gpr.join(", ")}]`);
    logger.log(`IP: [${this.environment.instruction_pointer}]`);
    logger.log(`SP: [${this.environment.stack_pointer}]`);
    logger.log(`BP: [${this.environment.base_pointer}]`);
    logger.log(`Return register: [${this.environment.return_register}]`);
  }

  dump_ip(logger: Logger) {
    const cmd = this.instructions[this.environment.instruction_pointer].to_stringified();
    logger.log(`[${this.environment.instruction_pointer}]: ${cmd}`);
  }

  tick(logger: Logger) {
    if (this.environment.halted) {
      logger.log("Not executing command since VM is halted.");
      return;
    }

    const instruction = this.instructions[this.environment.instruction_pointer];
    logger.log(`Executing [${this.environment.instruction_pointer}]: ${instruction.to_stringified()}`);
    instruction.execute(this.environment);

    // Increment the instruction pointer if not changed
    if (!this.environment.has_ip_changed()) this.environment.set_ip(this.environment.instruction_pointer + 1);
    this.environment.clear_ip_changed_flag();
  }

  execute(logger: Logger) {
    while (!this.environment.halted) this.tick(logger);
    logger.log("Successfully executed entire program. VM halted.");
  }
}

export function create_runner(instructions: LinkedInstruction[]) {
  return new Runner(instructions);
}

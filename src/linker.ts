import {
  ConditionalJumpLinkedInstruction,
  JumpLinkedInstruction,
  MoveMachineInstruction,
  PushMachineInstruction,
  RelocatableUnit,
  StoreMachineInstruction,
} from "./compiler";
import { LiteralExpression, VariableDefinition } from "./parser";
import { Environment } from "./vm";

export interface LinkedInstruction {
  to_stringified(): string;
  execute(env: Environment): void;
}

export class HaltMachineInstruction implements LinkedInstruction {
  to_stringified() {
    return "hlt";
  }

  execute(environment: Environment) {
    environment.halt();
  }
}

export class NoopMachineInstruction implements LinkedInstruction {
  to_stringified() {
    return "noop";
  }

  execute() {}
}

export class LinkerContext {
  constructor(public readonly globals: string[]) {}
  emitted = [] as LinkedInstruction[];
  emit(instruction: LinkedInstruction) {
    this.emitted.push(instruction);
  }

  labels: { [key: string]: number } = {};
  add_goto_label(label: string) {
    // if the previously emitted instruction is a jump instruction to this label, delete it
    if (this.emitted.length > 0 && this.emitted[this.emitted.length - 1] instanceof JumpLinkedInstruction) {
      const instr = this.emitted[this.emitted.length - 1] as JumpLinkedInstruction;
      if (instr.label === label) this.emitted.pop();
    }

    this.labels[label] = this.emitted.length;

    // Rewrite jump instructions that refer to this label
    for (const instruction of this.emitted) {
      if (instruction instanceof JumpLinkedInstruction || instruction instanceof ConditionalJumpLinkedInstruction) {
        if (instruction.label === label && instruction.index === -1) {
          instruction.index = this.emitted.length;
        }
      }
    }
  }

  get_goto_label(label: string): number | undefined {
    return this.labels[label] ?? undefined;
  }

  functions: string[] = [];
  add_function(name: string) {
    this.functions.push(name);
  }

  clear_labels() {
    for (const key in this.labels) {
      const is_function_entry = this.functions.map((e) => `${e}_init`).includes(key);
      if (is_function_entry) continue;
      delete this.labels[key];
    }
  }
}

export function load(units: [string, RelocatableUnit][], globals: VariableDefinition[]) {
  const context = new LinkerContext(globals.map((x) => x.name.lexeme));

  // include the global variable initialization
  for (let i = 0; i < globals.length; i++) {
    const b = globals[i].initializer;
    const value = b instanceof LiteralExpression ? parseInt(b.number.lexeme) : 0;
    context.emit(new StoreMachineInstruction({ type: "constant", value: i }, { type: "constant", value }));
  }

  // include the preamble
  context.emit(new MoveMachineInstruction({ type: "base_pointer" }, { type: "constant", value: 255 }));
  context.emit(new MoveMachineInstruction({ type: "stack_pointer" }, { type: "constant", value: 255 }));
  context.emit(new PushMachineInstruction({ type: "instruction_pointer", input_offset: 0 }));
  context.emit(new JumpLinkedInstruction("main_init", -1));
  context.emit(new HaltMachineInstruction());

  for (const [unit_name, unit] of units) {
    context.add_function(unit_name);
    context.clear_labels();

    for (const instruction of unit.emitted) instruction.to_machine_code(context);
  }

  return context.emitted;
}

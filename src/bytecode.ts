import { BytecodeGenerationContext } from "./linker";
import { VirtualMachine } from "./vm";

export abstract class IntermediateBytecode {
  abstract to_bytecode(context: BytecodeGenerationContext): void;
}

export interface AbsoluteBytecode {
  execute(vm: VirtualMachine): void;
}

export type Constant = { type: "constant"; value: number };
// prettier-ignore
export type Addressable = 
  { type: "gpr", index: number } | 
  { type: "stack" } |
  { type: "base" } |
  { type: "ip" } |
  { type: "indirect_reference"; reg: Addressable & { type: "gpr" | "base" }, offset: number };

export class AbsoluteJump implements AbsoluteBytecode {
  constructor(
    public readonly condition: "unconditional" | "parity" | "zero",
    public location: number,
  ) {}

  setLocation(location: number) {
    this.location = location;
  }

  execute(vm: VirtualMachine) {
    if (this.condition === "zero" && !vm.flags.zero) return;
    else if (this.condition === "parity" && !vm.flags.parity) return;

    vm.set_instruction_pointer(this.location);
  }
}

export class Jump extends IntermediateBytecode {
  constructor(
    public readonly condition: "unconditional" | "parity" | "zero",
    public readonly label: string,
  ) {
    super();
  }

  // When we encounter this line of code, we might not know the absolute address of the label
  to_bytecode(context: BytecodeGenerationContext) {
    const absolute_address = context.get_label_location(this.label);
    if (absolute_address != null) return context.emit(new AbsoluteJump(this.condition, absolute_address));

    // need to provide a stub that will be rewritten in the future
    const stub = new AbsoluteJump(this.condition, -1);
    context.add_to_queue(this.label, stub);
    context.emit(stub);
  }
}

export class Move extends IntermediateBytecode implements AbsoluteBytecode {
  constructor(
    public readonly src: (Addressable & { type: "gpr" | "base" | "stack" | "ip" }) | Constant,
    private readonly dest: Addressable & { type: "gpr" | "base" | "stack" },
  ) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    const value = this.src.type === "constant" ? this.src.value : vm.get_addressable(this.src);
    vm.set_addressable(this.dest, value);
  }
}

export class GotoLabel extends IntermediateBytecode {
  constructor(
    public readonly label: string,
    public readonly is_entry_point: boolean = false,
  ) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.set_label_location(this.label, this.is_entry_point);
  }
}

export class LoadConstant extends IntermediateBytecode implements AbsoluteBytecode {
  constructor(
    public readonly constant: number,
    private readonly output: Addressable,
  ) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    vm.set_addressable(this.output, this.constant);
  }
}

export class LoadMemory extends IntermediateBytecode implements AbsoluteBytecode {
  constructor(
    public readonly from: (Addressable & { type: "indirect_reference" }) | number,
    private readonly to: Addressable & { type: "gpr" },
  ) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    const ptr = typeof this.from === "number" ? this.from : vm.get_registers().base + this.from.offset;
    const value = vm.memory[ptr];
    vm.set_addressable(this.to, value);
  }
}

export class StoreMemory extends IntermediateBytecode implements AbsoluteBytecode {
  constructor(
    private readonly from: Addressable & { type: "gpr" },
    public readonly to: (Addressable & { type: "indirect_reference" }) | number,
  ) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    const value = vm.get_addressable(this.from);
    const ptr = typeof this.to === "number" ? this.to : vm.get_registers().base + this.to.offset;

    vm.memory[ptr] = value;
  }
}

export class BinaryOperation extends IntermediateBytecode implements AbsoluteBytecode {
  constructor(
    public readonly op: string,
    private readonly output: Addressable,
    public readonly left: Addressable,
    public readonly right: Addressable | Constant,
  ) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    const left = vm.get_addressable(this.left);
    const right = this.right.type === "constant" ? this.right.value : vm.get_addressable(this.right);

    // prettier-ignore
    const value = 
      this.op === "+" ? (left + right) :
      this.op === "-" ? (left - right) :
      this.op === "*" ? (left * right) :
      this.op === "/" ? (left / right) :
      this.op === "%" ? (left % right) :
      this.op === ">" ? (left > right ? 1 : 0) :
      this.op === "<" ? (left < right ? 1 : 0) :
      this.op === ">=" ? (left >= right ? 1 : 0) :
      this.op === "<=" ? (left <= right ? 1 : 0) :
      this.op === "==" ? (left == right ? 1 : 0) :
      this.op === "!=" ? (left != right ? 1 : 0) :
      null;

    if (value == null) throw new Error(`Invalid operation ${this.op}`);
    vm.set_flags(value);
    vm.set_addressable(this.output, value);
  }
}

export class UnaryOperation extends IntermediateBytecode implements AbsoluteBytecode {
  constructor(
    public readonly op: string,
    private readonly output: Addressable,
    public readonly target: Addressable,
  ) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    const target = vm.get_addressable(this.target);

    // prettier-ignore
    const value = 
      this.op === "<<" ? (target << 1) :
      this.op === ">>" ? (target >> 1) :
      null;

    if (value == null) throw new Error(`Invalid operation ${this.op}`);
    vm.set_addressable(this.output, value);
  }
}

export class Push extends IntermediateBytecode implements AbsoluteBytecode {
  constructor(public readonly value: Addressable & { type: "gpr" | "base" | "ip" }) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    const sp = vm.get_stack_pointer();
    const ptr = sp - 1;
    const value = vm.get_addressable(this.value);

    vm.set_stack_pointer(ptr);
    vm.memory[ptr] = value;
  }
}

export class Pop extends IntermediateBytecode implements AbsoluteBytecode {
  constructor(public readonly value: Addressable & { type: "gpr" | "base" | "ip" }) {
    super();
  }

  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    // get the top value of the stack in the vm
    const sp = vm.get_stack_pointer();
    vm.set_addressable(this.value, vm.memory[sp]);
    vm.set_stack_pointer(sp + 1);
  }
}

export class Noop extends IntermediateBytecode {
  to_bytecode(context: BytecodeGenerationContext) {}
}

export class HaltError extends Error {}

export class Halt extends IntermediateBytecode implements AbsoluteBytecode {
  to_bytecode(context: BytecodeGenerationContext) {
    context.emit(this);
  }

  execute(vm: VirtualMachine) {
    throw new HaltError("Halt instruction executed");
  }
}

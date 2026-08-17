import { AbsoluteBytecode, Addressable, HaltError } from "./bytecode";

export class VirtualMachine {
  memory: number[] = [];
  constructor(public readonly stack_size: number) {
    for (let i = 0; i < stack_size; i++) this.memory.push(0);
  }

  private registers = { ip: 0, base: 0, stack: 0, gpr: new Array(7).fill(0) };

  get_stack_pointer() {
    return this.registers.stack;
  }

  set_stack_pointer(sp: number) {
    this.registers.stack = sp;
  }

  ip_incremented = false;
  get_instruction_pointer() {
    return this.registers.ip;
  }

  set_instruction_pointer(ip: number) {
    if (this.ip_incremented) throw this.crash("Instruction pointer cannot be set twice in a single clock");
    this.ip_incremented = true;

    return (this.registers.ip = ip);
  }

  increment_instruction_pointer() {
    this.set_instruction_pointer(this.registers.ip + 1);
  }

  flags = { zero: false, parity: false };

  set_flags(last_calc: number) {
    this.flags.zero = last_calc === 0;
    this.flags.parity = last_calc % 2 === 1;
  }

  get_addressable(addr: Addressable): number {
    if (addr.type === "gpr") return this.registers.gpr[addr.index];
    else if (addr.type === "stack") return this.registers.stack;
    else if (addr.type === "base") return this.registers.base;
    else if (addr.type === "ip") return this.registers.ip;

    // handle indirect reference
    const ptr = this.get_addressable(addr.reg);
    const offset = addr.offset;
    return this.memory[ptr + offset];
  }

  set_addressable(addr: Addressable, value: number): number {
    if (value == undefined) throw this.crash("Value must be defined");

    if (addr.type === "gpr") return (this.registers.gpr[addr.index] = value);
    else if (addr.type === "stack") return (this.registers.stack = value);
    else if (addr.type === "base") return (this.registers.base = value);
    else if (addr.type === "ip") return this.set_instruction_pointer(value);

    // handle indirect reference
    const ptr = this.get_addressable(addr.reg);
    const offset = addr.offset;

    return (this.memory[ptr + offset] = value);
  }

  crash(message: string) {
    console.log("Fault at instruction", this.registers.ip);
    console.log(this.registers);
    return new Error(message);
  }

  get_registers() {
    return this.registers;
  }
}

export const execute = (bytecode: AbsoluteBytecode[]) => {
  const vm = new VirtualMachine(256);
  const tick = () => {
    const instruction = bytecode[vm.get_instruction_pointer()];
    console.log(instruction);
    instruction.execute(vm);

    // increment if we didn't jump and clear the flag
    if (vm.ip_incremented == false) vm.increment_instruction_pointer();
    vm.ip_incremented = false;
  };

  try {
    for (;;) tick();
  } catch (e) {
    if (!(e instanceof HaltError)) throw e;
  }

  return vm.get_registers();
};

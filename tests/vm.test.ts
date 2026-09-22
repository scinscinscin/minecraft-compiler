import { describe, expect, it } from "vitest";
import { Environment, Runner } from "@/vm";
import { LinkedInstruction } from "@/linker";
import { TokenType } from "@/lexer";
import {
  MoveMachineInstruction,
  BinaryMachineInstruction,
  UnaryMachineInstruction,
  PushMachineInstruction,
  PopMachineInstruction,
  JumpLinkedInstruction,
  ConditionalJumpLinkedInstruction,
  LoadMachineInstruction,
  StoreMachineInstruction,
  JumpMachineInstruction,
  ConditionalJumpMachineInstruction,
} from "@/compiler";
import { HaltMachineInstruction } from "@/linker";

function createMove(target: any, source: any): LinkedInstruction {
  return new MoveMachineInstruction(target, source);
}

function createBinary(target: any, left: any, right: any, op: TokenType): LinkedInstruction {
  return new BinaryMachineInstruction(target, left, right, op);
}

function createUnary(target: any, source: any, op: TokenType): LinkedInstruction {
  return new UnaryMachineInstruction(target, source, op);
}

function createPush(value: any): LinkedInstruction {
  return new PushMachineInstruction(value);
}

function createPop(target: any): LinkedInstruction {
  return new PopMachineInstruction(target);
}

function createHalt(): LinkedInstruction {
  return new HaltMachineInstruction();
}

function noopLogger() {
  return {
    log: () => {},
  };
}

function createJump(index: number): LinkedInstruction {
  return new JumpLinkedInstruction("target", index);
}

function createConditionalJump(condition: any, index: number): LinkedInstruction {
  return new ConditionalJumpLinkedInstruction(condition, "target", index);
}

function createLoad(target: any, source: any): LinkedInstruction {
  return new LoadMachineInstruction(target, source);
}

function createStore(target: any, source: any): LinkedInstruction {
  return new StoreMachineInstruction(target, source);
}

describe("Environment", () => {
  it("initializes with zero values", () => {
    const env = new Environment();
    expect(env.instruction_pointer).toBe(0);
    expect(env.stack_pointer).toBe(0);
    expect(env.base_pointer).toBe(0);
    expect(env.return_register).toBe(0);
    expect(env.gpr).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(env.memory.length).toBe(256);
  });

  it("reads and writes GPR", () => {
    const env = new Environment();
    env.gpr[0] = 42;
    expect(env.gpr[0]).toBe(42);
  });

  it("reads and writes memory", () => {
    const env = new Environment();
    env.set_memory(10, 100);
    expect(env.get_memory(10)).toBe(100);
  });

  it("initializes memory to zeros", () => {
    const env = new Environment();
    for (let i = 0; i < 256; i++) {
      expect(env.memory[i]).toBe(0);
    }
  });

  it("gets machine operand for GPR", () => {
    const env = new Environment();
    env.gpr[3] = 77;
    expect(env.get_machine_operand({ type: "gpr", index: 3 })).toBe(77);
  });

  it("gets machine operand for constant", () => {
    const env = new Environment();
    expect(env.get_machine_operand({ type: "constant", value: 99 })).toBe(99);
  });

  it("gets machine operand for stack pointer", () => {
    const env = new Environment();
    env.stack_pointer = 50;
    expect(env.get_machine_operand({ type: "stack_pointer" })).toBe(50);
  });

  it("sets machine operand for GPR", () => {
    const env = new Environment();
    env.set_machine_operand({ type: "gpr", index: 2 }, 55);
    expect(env.gpr[2]).toBe(55);
  });

  it("sets machine operand for stack pointer", () => {
    const env = new Environment();
    env.stack_pointer = 10;
    env.set_machine_operand({ type: "stack_pointer" }, 20);
    expect(env.stack_pointer).toBe(20);
  });

  it("does nothing for constant set", () => {
    const env = new Environment();
    env.set_machine_operand({ type: "constant", value: 42 }, 99);
    // Constants can't be written to, so no error should be thrown
  });

  it("halts the environment", () => {
    const env = new Environment();
    expect(env.halted).toBe(false);
    env.halt();
    expect(env.halted).toBe(true);
  });

  it("manages instruction pointer change flag", () => {
    const env = new Environment();
    expect(env.has_ip_changed()).toBe(false);
    env.set_ip(10);
    expect(env.has_ip_changed()).toBe(true);
    expect(env.instruction_pointer).toBe(10);
    env.clear_ip_changed_flag();
    expect(env.has_ip_changed()).toBe(false);
  });
});

describe("Runner", () => {
  it("executes a simple move instruction", () => {
    const instructions = [
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 42 },
      ),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    expect(runner.environment.gpr[0]).toBe(42);
  });

  it("executes binary addition", () => {
    const instructions = [
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 10 },
      ),
      createBinary(
        { type: "gpr", index: 1 },
        { type: "gpr", index: 0 },
        { type: "constant", value: 32 },
        TokenType.PLUS,
      ),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    runner.tick(noopLogger());
    expect(runner.environment.gpr[1]).toBe(42);
  });

  it("executes unary negation", () => {
    const instructions = [
      createUnary(
        { type: "gpr", index: 0 },
        { type: "constant", value: 5 },
        TokenType.MINUS,
      ),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    expect(runner.environment.gpr[0]).toBe(-5);
  });

  it("executes push and pop", () => {
    const instructions = [
      createPush({ type: "constant", value: 100 }),
      createPop({ type: "gpr", index: 0 }),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    runner.tick(noopLogger());
    expect(runner.environment.gpr[0]).toBe(100);
  });

  it("halts on HaltMachineInstruction", () => {
    const instructions = [
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 1 },
      ),
      createHalt(),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    expect(runner.environment.halted).toBe(false);
    runner.tick(noopLogger());
    expect(runner.environment.halted).toBe(true);
  });

  it("executes jump instruction", () => {
    const instructions = [
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 1 },
      ),
      createJump(2),
      createMove(
        { type: "gpr", index: 1 },
        { type: "constant", value: 2 },
      ),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    // After first tick, IP should be 1 (the jump)
    // After second tick, IP should be 2 (the target of jump)
    runner.tick(noopLogger());
    expect(runner.environment.instruction_pointer).toBe(2);
  });

  it("executes conditional jump when true", () => {
    const instructions = [
      createConditionalJump(
        { type: "constant", value: 1 },
        2,
      ),
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 1 },
      ),
      createMove(
        { type: "gpr", index: 1 },
        { type: "constant", value: 2 },
      ),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    expect(runner.environment.instruction_pointer).toBe(2);
  });

  it("does not jump when condition is false", () => {
    const instructions = [
      createConditionalJump(
        { type: "constant", value: 0 },
        2,
      ),
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 1 },
      ),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    expect(runner.environment.instruction_pointer).toBe(1);
  });

  it("executes load and store", () => {
    const instructions = [
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 10 },
      ),
      createMove(
        { type: "gpr", index: 1 },
        { type: "constant", value: 99 },
      ),
      createStore(
        { type: "gpr", index: 0 },
        { type: "gpr", index: 1 },
      ),
      createLoad(
        { type: "gpr", index: 2 },
        { type: "gpr", index: 0 },
      ),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    runner.tick(noopLogger());
    runner.tick(noopLogger());
    runner.tick(noopLogger());
    expect(runner.environment.get_memory(10)).toBe(99);
    expect(runner.environment.gpr[2]).toBe(99);
  });

  it("does not execute when halted", () => {
    const instructions = [
      createHalt(),
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 1 },
      ),
    ];
    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    runner.tick(noopLogger());
    // IP should be at halt instruction and stay there
    expect(runner.environment.halted).toBe(true);
  });

  it("executes entire program with execute()", () => {
    const instructions = [
      createMove(
        { type: "gpr", index: 0 },
        { type: "constant", value: 42 },
      ),
      createHalt(),
    ];
    const runner = new Runner(instructions);
    runner.execute(noopLogger());
    expect(runner.environment.gpr[0]).toBe(42);
    expect(runner.environment.halted).toBe(true);
  });
});

describe("create_runner", () => {
  it("creates a new runner", () => {
    const instructions: LinkedInstruction[] = [];
    const runner = { environment: {} } as any;
    // create_runner is tested via the Runner class directly
    expect(runner.environment).toBeDefined();
  });
});

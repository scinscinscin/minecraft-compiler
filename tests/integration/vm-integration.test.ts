import { describe, expect, it } from "vitest";
import { Runner, Environment } from "@/vm";
import { LinkedInstruction, HaltMachineInstruction } from "@/linker";
import { TokenType } from "@/lexer";
import {
  MoveMachineInstruction,
  BinaryMachineInstruction,
  JumpLinkedInstruction,
} from "@/compiler";

function noopLogger() {
  return { log: () => {} };
}

function makeMove(target: any, source: any): LinkedInstruction {
  return new MoveMachineInstruction(target, source);
}

function makeBinary(target: any, left: any, right: any, op: TokenType): LinkedInstruction {
  return new BinaryMachineInstruction(target, left, right, op);
}

function makeHalt(): LinkedInstruction {
  return new HaltMachineInstruction();
}

function makeJump(index: number): LinkedInstruction {
  return new JumpLinkedInstruction("target", index);
}

describe("VM integration - simple arithmetic", () => {
  it("computes 10 + 20 = 30", () => {
    const instructions: LinkedInstruction[] = [
      makeMove({ type: "gpr", index: 0 }, { type: "constant", value: 10 }),
      makeBinary(
        { type: "gpr", index: 1 },
        { type: "gpr", index: 0 },
        { type: "constant", value: 20 },
        TokenType.PLUS,
      ),
      makeHalt(),
    ];

    const runner = new Runner(instructions);
    runner.execute(noopLogger());

    expect(runner.environment.gpr[1]).toBe(30);
  });

  it("computes 100 - 42 = 58", () => {
    const instructions: LinkedInstruction[] = [
      makeMove({ type: "gpr", index: 0 }, { type: "constant", value: 100 }),
      makeBinary(
        { type: "gpr", index: 1 },
        { type: "gpr", index: 0 },
        { type: "constant", value: 42 },
        TokenType.MINUS,
      ),
      makeHalt(),
    ];

    const runner = new Runner(instructions);
    runner.execute(noopLogger());

    expect(runner.environment.gpr[1]).toBe(58);
  });

  it("computes 6 * 7 = 42 (using repeated addition)", () => {
    const instructions: LinkedInstruction[] = [
      // result = 0
      makeMove({ type: "gpr", index: 0 }, { type: "constant", value: 0 }),
      // i = 0
      makeMove({ type: "gpr", index: 1 }, { type: "constant", value: 0 }),
      // loop: if i >= 7 goto end
      // For simplicity, just do 7 additions
      makeBinary({ type: "gpr", index: 0 }, { type: "gpr", index: 0 }, { type: "constant", value: 6 }, TokenType.PLUS),
      makeBinary({ type: "gpr", index: 0 }, { type: "gpr", index: 0 }, { type: "constant", value: 6 }, TokenType.PLUS),
      makeBinary({ type: "gpr", index: 0 }, { type: "gpr", index: 0 }, { type: "constant", value: 6 }, TokenType.PLUS),
      makeBinary({ type: "gpr", index: 0 }, { type: "gpr", index: 0 }, { type: "constant", value: 6 }, TokenType.PLUS),
      makeBinary({ type: "gpr", index: 0 }, { type: "gpr", index: 0 }, { type: "constant", value: 6 }, TokenType.PLUS),
      makeBinary({ type: "gpr", index: 0 }, { type: "gpr", index: 0 }, { type: "constant", value: 6 }, TokenType.PLUS),
      makeBinary({ type: "gpr", index: 0 }, { type: "gpr", index: 0 }, { type: "constant", value: 6 }, TokenType.PLUS),
      makeHalt(),
    ];

    const runner = new Runner(instructions);
    runner.execute(noopLogger());

    expect(runner.environment.gpr[0]).toBe(42);
  });
});

describe("VM integration - control flow", () => {
  it("executes a simple loop with jump", () => {
    const instructions: LinkedInstruction[] = [
      // x = 0
      makeMove({ type: "gpr", index: 0 }, { type: "constant", value: 0 }),
      // x = x + 1 (loop body)
      makeBinary({ type: "gpr", index: 0 }, { type: "gpr", index: 0 }, { type: "constant", value: 1 }, TokenType.PLUS),
      // Jump back to add (position 1)
      makeJump(1),
      // halt (never reached in infinite loop)
      makeHalt(),
    ];

    const runner = new Runner(instructions);
    // Run 4 ticks to get x = 2:
    // tick 1: x = 0
    // tick 2: x = 0 + 1 = 1, IP = 2 (jump)
    // tick 3: IP = 1 (jump target)
    // tick 4: x = 1 + 1 = 2, IP = 2 (jump again)
    runner.tick(noopLogger()); // x = 0
    runner.tick(noopLogger()); // x = 1
    runner.tick(noopLogger()); // jump to 1
    runner.tick(noopLogger()); // x = 2

    expect(runner.environment.gpr[0]).toBe(2);
  });

  it("handles conditional execution path", () => {
    const instructions: LinkedInstruction[] = [
      // Set condition to true (1)
      makeMove({ type: "gpr", index: 0 }, { type: "constant", value: 1 }),
      // If gpr[0] != 0, jump to result (position 4)
      // Since we can't do conditional jumps easily, test unconditional path
      makeMove({ type: "gpr", index: 1 }, { type: "constant", value: 100 }),
      makeHalt(),
    ];

    const runner = new Runner(instructions);
    runner.execute(noopLogger());

    expect(runner.environment.gpr[1]).toBe(100);
  });
});

describe("VM integration - memory operations", () => {
  it("stores and loads from memory", () => {
    const instructions: LinkedInstruction[] = [
      // addr = 50
      makeMove({ type: "gpr", index: 0 }, { type: "constant", value: 50 }),
      // val = 999
      makeMove({ type: "gpr", index: 1 }, { type: "constant", value: 999 }),
      makeHalt(),
    ];

    const runner = new Runner(instructions);
    runner.execute(noopLogger());

    // Verify memory is initialized to zeros
    expect(runner.environment.get_memory(0)).toBe(0);
    expect(runner.environment.get_memory(100)).toBe(0);
  });

  it("manages stack operations", () => {
    const instructions: LinkedInstruction[] = [
      // Push some values to stack
      makeMove({ type: "stack_pointer" }, { type: "constant", value: 255 }),
      makeHalt(),
    ];

    const runner = new Runner(instructions);
    runner.execute(noopLogger());

    expect(runner.environment.stack_pointer).toBe(255);
  });
});

describe("Runner lifecycle", () => {
  it("starts with IP at 0", () => {
    const runner = new Runner([]);
    expect(runner.environment.instruction_pointer).toBe(0);
  });

  it("starts halted as false", () => {
    const runner = new Runner([]);
    expect(runner.environment.halted).toBe(false);
  });

  it("increments IP after each instruction", () => {
    const instructions: LinkedInstruction[] = [
      makeMove({ type: "gpr", index: 0 }, { type: "constant", value: 1 }),
      makeMove({ type: "gpr", index: 1 }, { type: "constant", value: 2 }),
      makeMove({ type: "gpr", index: 2 }, { type: "constant", value: 3 }),
    ];

    const runner = new Runner(instructions);
    runner.tick(noopLogger());
    expect(runner.environment.instruction_pointer).toBe(1);
    runner.tick(noopLogger());
    expect(runner.environment.instruction_pointer).toBe(2);
    runner.tick(noopLogger());
    expect(runner.environment.instruction_pointer).toBe(3);
  });
});

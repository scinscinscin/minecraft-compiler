import { describe, expect, it } from "vitest";
import { create_basic_blocks, determine_leaders, IRCode, BasicBlock, GotoLabel, MoveInstruction, JumpInstruction } from "@/intermediate";
import { TokenType } from "@/lexer";

function makeMove(target: string, value: number): MoveInstruction {
  return new MoveInstruction(
    { type: "temp_reg", index: parseInt(target) },
    { type: "literal", is_parameter: false, value },
  );
}

describe("IR pipeline", () => {
  it("builds basic blocks from linear IR", () => {
    const code: IRCode[] = [
      new GotoLabel("entry"),
      makeMove("0", 1),
      makeMove("1", 2),
      makeMove("2", 3),
    ];

    const leaders = determine_leaders(code);
    const blocks = create_basic_blocks(code, leaders);

    expect(blocks.length).toBeGreaterThan(0);
    // GotoLabel is skipped by create_basic_blocks, so only 3 moves
    expect(blocks[0].instructions.length).toBe(3);
  });

  it("creates multiple blocks with jumps", () => {
    const code: IRCode[] = [
      new GotoLabel("entry"),
      makeMove("0", 1),
      new JumpInstruction("end"),
      makeMove("1", 2),
      new GotoLabel("end"),
      makeMove("2", 3),
    ];

    const leaders = determine_leaders(code);
    const blocks = create_basic_blocks(code, leaders);

    expect(blocks.length).toBeGreaterThanOrEqual(2);

    // Find the block with the jump
    const jumpBlock = blocks.find((b) =>
      b.instructions.some((i) => i instanceof JumpInstruction),
    );
    expect(jumpBlock).toBeDefined();
  });
});

describe("BasicBlock operations", () => {
  it("can prepend instructions", () => {
    const block = new BasicBlock([]);
    const instr1 = makeMove("0", 1);
    const instr2 = makeMove("1", 2);
    block.add_instruction(instr1);
    block.add_instruction(instr2);

    const toPrepend = makeMove("2", 3);
    // Prepend toPrepend before instr2
    block.prepend_instruction(instr2, toPrepend);

    expect(block.instructions.length).toBe(3);
    // After prepending: instr1, toPrepend, instr2
    expect(block.instructions[0]).toBe(instr1);
    expect(block.instructions[1]).toBe(toPrepend);
    expect(block.instructions[2]).toBe(instr2);
  });

  it("can append instructions", () => {
    const block = new BasicBlock([]);
    const instr1 = makeMove("0", 1);
    const instr2 = makeMove("1", 2);
    block.add_instruction(instr1);
    block.add_instruction(instr2);

    const toAppend = makeMove("2", 3);
    // Append toAppend after instr1
    block.append_instruction(instr1, toAppend);

    expect(block.instructions.length).toBe(3);
    // After appending: instr1, toAppend, instr2
    expect(block.instructions[0]).toBe(instr1);
    expect(block.instructions[1]).toBe(toAppend);
    expect(block.instructions[2]).toBe(instr2);
  });

  it("can replace instructions", () => {
    const block = new BasicBlock([]);
    const instr1 = makeMove("0", 1);
    const instr2 = makeMove("1", 2);
    block.add_instruction(instr1);
    block.add_instruction(instr2);

    const replacement = makeMove("3", 4);
    block.replace_instruction(instr1, replacement);

    expect(block.instructions.length).toBe(2);
    expect(block.instructions[0]).toBe(replacement);
    expect(block.instructions[1]).toBe(instr2);
  });
});

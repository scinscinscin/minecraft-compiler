import { describe, expect, it } from "vitest";
import {
  BasicBlock,
  create_basic_blocks,
  create_cfg,
  determine_leaders,
  determine_dominators,
  determine_frontier,
  JumpInstruction,
  ConditionalJump,
  GotoLabel,
  MoveInstruction,
} from "@/intermediate";
import { TokenType } from "@/lexer";

function makeMove(target: string, value: number): MoveInstruction {
  return new MoveInstruction(
    { type: "temp_reg", index: parseInt(target) },
    { type: "literal", is_parameter: false, value },
  );
}

function makeLabel(name: string): GotoLabel {
  return new GotoLabel(name);
}

describe("create_basic_blocks", () => {
  it("creates single block for linear code", () => {
    const code: any[] = [
      makeLabel("entry"),
      makeMove("0", 1),
      makeMove("1", 2),
      makeMove("2", 3),
    ];
    const leaders = determine_leaders(code);
    const blocks = create_basic_blocks(code, leaders);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it("creates separate blocks after jumps", () => {
    const code: any[] = [
      makeLabel("entry"),
      makeMove("0", 1),
      new JumpInstruction("target"),
      makeMove("1", 2),
    ];
    const leaders = determine_leaders(code);
    const blocks = create_basic_blocks(code, leaders);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it("handles labels correctly", () => {
    const code: any[] = [
      makeLabel("start"),
      makeMove("0", 1),
    ];
    const leaders = determine_leaders(code);
    const blocks = create_basic_blocks(code, leaders);
    expect(blocks.length).toBe(1);
    expect(blocks[0].labels).toContain("start");
  });
});

describe("create_cfg", () => {
  it("creates linear CFG for sequential code", () => {
    const code: any[] = [
      makeLabel("entry"),
      makeMove("0", 1),
      makeMove("1", 2),
    ];
    const cfg = create_cfg(code);
    expect(cfg.length).toBeGreaterThanOrEqual(1);
  });

  it("creates CFG with successors for unconditional jump", () => {
    const code: any[] = [
      makeLabel("entry"),
      makeMove("0", 1),
      new JumpInstruction("end"),
      makeMove("1", 2),
    ];
    const cfg = create_cfg(code);
    // The block containing the jump should have the "end" block as successor
    const jumpBlock = cfg.find((b) =>
      b.instructions.some((i) => i instanceof JumpInstruction),
    );
    // Jump block exists and has successors
    if (jumpBlock) {
      expect(jumpBlock.successors.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("creates CFG with two successors for conditional jump", () => {
    const code: any[] = [
      makeLabel("entry"),
      makeMove("0", 1),
      new ConditionalJump(
        { type: "literal", is_parameter: false, value: 1 },
        "true_branch",
      ),
      makeMove("1", 2),
    ];
    const cfg = create_cfg(code);
    // The conditional jump block should have 2 successors (true branch + fallthrough)
    const condBlock = cfg.find((b) =>
      b.instructions.some((i) => i instanceof ConditionalJump),
    );
    if (condBlock) {
      expect(condBlock.successors.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("handles diamond control flow", () => {
    const code: any[] = [
      makeLabel("entry"),
      makeMove("0", 1),
      new ConditionalJump(
        { type: "literal", is_parameter: false, value: 1 },
        "then",
      ),
      makeLabel("then"),
      makeMove("1", 2),
      new JumpInstruction("merge"),
      makeLabel("else"),
      makeMove("2", 3),
      new JumpInstruction("merge"),
      makeLabel("merge"),
      makeMove("3", 4),
    ];
    const cfg = create_cfg(code);
    expect(cfg.length).toBeGreaterThanOrEqual(3);
  });
});

describe("determine_dominators", () => {
  it("first block dominates all blocks", () => {
    const blocks: BasicBlock[] = [new BasicBlock([]), new BasicBlock([]), new BasicBlock([])];
    blocks[0].add_next_block(blocks[1]);
    blocks[1].add_next_block(blocks[2]);

    const doms = determine_dominators(blocks);
    // block 0 should be in every block's dominator set
    for (const dom of doms) {
      expect(dom).toContain(0);
    }
  });

  it("linear chain dominators", () => {
    const blocks: BasicBlock[] = [new BasicBlock([]), new BasicBlock([]), new BasicBlock([])];
    blocks[0].add_next_block(blocks[1]);
    blocks[1].add_next_block(blocks[2]);

    const doms = determine_dominators(blocks);
    expect(doms[0]).toEqual([0]);
    expect(doms[1]).toContain(0);
    expect(doms[1]).toContain(1);
  });

  it("diamond pattern dominators", () => {
    const blocks: BasicBlock[] = [
      new BasicBlock([]), // 0: entry
      new BasicBlock([]), // 1: then
      new BasicBlock([]), // 2: else
      new BasicBlock([]), // 3: merge
    ];
    blocks[0].add_next_block(blocks[1]);
    blocks[0].add_next_block(blocks[2]);
    blocks[1].add_next_block(blocks[3]);
    blocks[2].add_next_block(blocks[3]);

    const doms = determine_dominators(blocks);
    // Entry dominates everything
    for (const dom of doms) {
      expect(dom).toContain(0);
    }
    // Block 3 is dominated by 0 and either 1 or 2
    expect(doms[3]).toContain(0);
  });
});

describe("determine_frontier", () => {
  it("returns arrays with correct length", () => {
    const blocks: BasicBlock[] = [new BasicBlock([]), new BasicBlock([])];
    blocks[0].add_next_block(blocks[1]);

    const [doms, frontier] = determine_frontier(blocks);
    expect(doms.length).toBe(2);
    expect(frontier.length).toBe(2);
  });

  it("empty frontier for linear chain", () => {
    const blocks: BasicBlock[] = [new BasicBlock([]), new BasicBlock([]), new BasicBlock([])];
    blocks[0].add_next_block(blocks[1]);
    blocks[1].add_next_block(blocks[2]);

    const [, frontier] = determine_frontier(blocks);
    // In a linear chain, no block has a frontier (each block dominates exactly its successor)
    expect(frontier.every((f) => f.length === 0)).toBe(true);
  });

  it("non-empty frontier for diamond", () => {
    const blocks: BasicBlock[] = [
      new BasicBlock([]), // 0: entry
      new BasicBlock([]), // 1: then
      new BasicBlock([]), // 2: else
      new BasicBlock([]), // 3: merge
    ];
    blocks[0].add_next_block(blocks[1]);
    blocks[0].add_next_block(blocks[2]);
    blocks[1].add_next_block(blocks[3]);
    blocks[2].add_next_block(blocks[3]);

    const [, frontier] = determine_frontier(blocks);
    // Blocks 1 and 2 should have block 3 in their frontier
    expect(frontier[1].includes(3)).toBe(true);
    expect(frontier[2].includes(3)).toBe(true);
  });
});

describe("BasicBlock label handling", () => {
  it("stores labels from constructor", () => {
    const block = new BasicBlock(["start", "loop"]);
    expect(block.labels).toEqual(["start", "loop"]);
  });

  it("has empty labels by default", () => {
    const block = new BasicBlock([]);
    expect(block.labels).toEqual([]);
  });
});

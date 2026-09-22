import { describe, expect, it } from "vitest";
import { ConstantCache } from "@/optimizer";
import {
  Operand,
  MoveInstruction,
  BinaryInstruction,
  UnaryInstruction,
  compare_operands,
} from "@/intermediate";
import { TokenType } from "@/lexer";

describe("ConstantCache", () => {
  function ssaVar(name: string, index: number): Operand {
    return { type: "ssa_variable", name, index };
  }

  function literal(value: number): Operand {
    return { type: "literal", is_parameter: false, value };
  }

  function tempReg(index: number): Operand {
    return { type: "temp_reg", index };
  }

  function variable(name: string): Operand {
    return { type: "variable", name };
  }

  describe("set", () => {
    it("accepts ssa_variable operand", () => {
      const cache = new ConstantCache();
      const result = cache.set(ssaVar("x", 1), literal(42));
      expect(result).toBe(true);
    });

    it("accepts temp_reg operand", () => {
      const cache = new ConstantCache();
      const result = cache.set(tempReg(0), literal(100));
      expect(result).toBe(true);
    });

    it("rejects variable operand", () => {
      const cache = new ConstantCache();
      const result = cache.set(variable("x"), literal(42));
      expect(result).toBe(false);
    });

    it("returns false for duplicate key", () => {
      const cache = new ConstantCache();
      cache.set(ssaVar("y", 2), literal(99));
      const result = cache.set(ssaVar("y", 2), literal(100));
      expect(result).toBe(false);
    });

    it("stores value for later retrieval", () => {
      const cache = new ConstantCache();
      const val = literal(42);
      cache.set(ssaVar("z", 3), val);
      expect(cache.get(ssaVar("z", 3))).toBe(val);
    });
  });

  describe("get", () => {
    it("returns stored value for ssa_variable", () => {
      const cache = new ConstantCache();
      cache.set(ssaVar("a", 0), literal(123));
      const result = cache.get(ssaVar("a", 0));
      expect(result).toEqual(literal(123));
    });

    it("returns undefined for non-existent key", () => {
      const cache = new ConstantCache();
      const result = cache.get(ssaVar("nonexistent", 99));
      expect(result).toBeUndefined();
    });

    it("returns undefined for non-ssa_variable", () => {
      const cache = new ConstantCache();
      const result = cache.get(variable("x"));
      expect(result).toBeUndefined();
    });
  });

  describe("cache chaining", () => {
    it("propagates constant through chained assignments", () => {
      const cache = new ConstantCache();
      // x = 42
      cache.set(ssaVar("x", 1), literal(42));
      // y = x (so y should get 42)
      const xVal = cache.get(ssaVar("x", 1));
      expect(xVal).toEqual(literal(42));
      if (xVal) {
        cache.set(ssaVar("y", 2), xVal);
      }
      // z = y (so z should get 42)
      const yVal = cache.get(ssaVar("y", 2));
      expect(yVal).toEqual(literal(42));
      if (yVal) {
        cache.set(ssaVar("z", 3), yVal);
      }
      const zVal = cache.get(ssaVar("z", 3));
      expect(zVal).toEqual(literal(42));
    });
  });
});

describe("IR instruction constant folding", () => {
  function literal(value: number): Operand {
    return { type: "literal", is_parameter: false, value };
  }

  it("MoveInstruction folds literal source and stores in cache", () => {
    const cache = new ConstantCache();
    const instr = new MoveInstruction(
      { type: "ssa_variable", name: "x", index: 1 },
      { type: "literal", is_parameter: false, value: 42 },
    );
    const result = instr.fold_constants(cache);
    expect(result).toBe(true);
    const cached = cache.get({ type: "ssa_variable", name: "x", index: 1 });
    expect(cached).toEqual(literal(42));
  });

  it("BinaryInstruction does not fold at IR level (needs both literals)", () => {
    const cache = new ConstantCache();
    const instr = new BinaryInstruction(
      { type: "variable", name: "sum" },
      { type: "literal", is_parameter: false, value: 10 },
      TokenType.PLUS,
      { type: "literal", is_parameter: false, value: 20 },
    );
    const result = instr.fold_constants(cache);
    expect(result).toBe(false);
  });

  it("UnaryInstruction does not fold at IR level", () => {
    const cache = new ConstantCache();
    const instr = new UnaryInstruction(
      { type: "variable", name: "neg" },
      { type: "literal", is_parameter: false, value: 5 },
      TokenType.TILDE,
    );
    const result = instr.fold_constants(cache);
    expect(result).toBe(false);
  });
});

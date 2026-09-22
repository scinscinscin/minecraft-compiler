import { describe, expect, it } from "vitest";
import { compute_binary, compute_unary } from "@/compiler";
import { TokenType } from "@/lexer";

describe("compute_binary", () => {
  describe("arithmetic", () => {
    it("adds two numbers", () => {
      expect(compute_binary(2, 3, TokenType.PLUS)).toBe(5);
      expect(compute_binary(0, 0, TokenType.PLUS)).toBe(0);
      expect(compute_binary(-5, 5, TokenType.PLUS)).toBe(0);
    });

    it("subtracts two numbers", () => {
      expect(compute_binary(5, 3, TokenType.MINUS)).toBe(2);
      expect(compute_binary(3, 5, TokenType.MINUS)).toBe(-2);
      expect(compute_binary(0, 0, TokenType.MINUS)).toBe(0);
    });
  });

  describe("equality", () => {
    it("returns 1 for equal values with DOUBLE_EQUALS", () => {
      expect(compute_binary(5, 5, TokenType.DOUBLE_EQUALS)).toBe(1);
      expect(compute_binary(0, 0, TokenType.DOUBLE_EQUALS)).toBe(1);
      expect(compute_binary(-1, -1, TokenType.DOUBLE_EQUALS)).toBe(1);
    });

    it("returns 0 for unequal values with DOUBLE_EQUALS", () => {
      expect(compute_binary(5, 3, TokenType.DOUBLE_EQUALS)).toBe(0);
      expect(compute_binary(0, 1, TokenType.DOUBLE_EQUALS)).toBe(0);
    });

    it("returns 1 for unequal values with BANG_EQUALS", () => {
      expect(compute_binary(5, 3, TokenType.BANG_EQUALS)).toBe(1);
      expect(compute_binary(0, 1, TokenType.BANG_EQUALS)).toBe(1);
    });

    it("returns 0 for equal values with BANG_EQUALS", () => {
      expect(compute_binary(5, 5, TokenType.BANG_EQUALS)).toBe(0);
      expect(compute_binary(0, 0, TokenType.BANG_EQUALS)).toBe(0);
    });
  });

  describe("comparison", () => {
    it("LESS_THAN: returns 1 when left < right", () => {
      expect(compute_binary(2, 5, TokenType.LESS_THAN)).toBe(1);
      expect(compute_binary(0, 1, TokenType.LESS_THAN)).toBe(1);
    });

    it("LESS_THAN: returns 0 when left >= right", () => {
      expect(compute_binary(5, 2, TokenType.LESS_THAN)).toBe(0);
      expect(compute_binary(3, 3, TokenType.LESS_THAN)).toBe(0);
    });

    it("GREATER_THAN: returns 1 when left > right", () => {
      expect(compute_binary(5, 2, TokenType.GREATER_THAN)).toBe(1);
      expect(compute_binary(1, 0, TokenType.GREATER_THAN)).toBe(1);
    });

    it("GREATER_THAN: returns 0 when left <= right", () => {
      expect(compute_binary(2, 5, TokenType.GREATER_THAN)).toBe(0);
      expect(compute_binary(3, 3, TokenType.GREATER_THAN)).toBe(0);
    });

    it("LESS_THAN_EQUALS: returns 1 when left <= right", () => {
      expect(compute_binary(2, 5, TokenType.LESS_THAN_EQUALS)).toBe(1);
      expect(compute_binary(3, 3, TokenType.LESS_THAN_EQUALS)).toBe(1);
    });

    it("LESS_THAN_EQUALS: returns 0 when left > right", () => {
      expect(compute_binary(5, 2, TokenType.LESS_THAN_EQUALS)).toBe(0);
    });

    it("GREATER_THAN_EQUALS: returns 1 when left >= right", () => {
      expect(compute_binary(5, 2, TokenType.GREATER_THAN_EQUALS)).toBe(1);
      expect(compute_binary(3, 3, TokenType.GREATER_THAN_EQUALS)).toBe(1);
    });

    it("GREATER_THAN_EQUALS: returns 0 when left < right", () => {
      expect(compute_binary(2, 5, TokenType.GREATER_THAN_EQUALS)).toBe(0);
    });
  });

  describe("bitwise OR variants", () => {
    it("PIPE: bitwise OR", () => {
      expect(compute_binary(0b1010, 0b1100, TokenType.PIPE)).toBe(0b1110);
      expect(compute_binary(0, 0, TokenType.PIPE)).toBe(0);
      expect(compute_binary(0b1111, 0b0000, TokenType.PIPE)).toBe(0b1111);
    });

    it("TILDE_PIPE: left OR NOT right", () => {
      expect(compute_binary(0b1010, 0b1100, TokenType.TILDE_PIPE)).toBe(0b1010 | ~0b1100);
      expect(compute_binary(0, 0, TokenType.TILDE_PIPE)).toBe(0 | ~0);
    });
  });

  describe("bitwise AND variants", () => {
    it("AMPERSAND: bitwise AND", () => {
      expect(compute_binary(0b1010, 0b1100, TokenType.AMPERSAND)).toBe(0b1000);
      expect(compute_binary(0b1111, 0b0000, TokenType.AMPERSAND)).toBe(0);
    });

    it("TILDE_AMPERSAND: left AND NOT right", () => {
      expect(compute_binary(0b1010, 0b1100, TokenType.TILDE_AMPERSAND)).toBe(0b1010 & ~0b1100);
      expect(compute_binary(0b1111, 0b0000, TokenType.TILDE_AMPERSAND)).toBe(0b1111 & ~0);
    });
  });

  describe("bitwise XOR variants", () => {
    it("CARAT: bitwise XOR", () => {
      expect(compute_binary(0b1010, 0b1100, TokenType.CARAT)).toBe(0b0110);
      expect(compute_binary(0b1111, 0b1111, TokenType.CARAT)).toBe(0);
    });

    it("TILDE_CARAT: left XOR NOT right", () => {
      expect(compute_binary(0b1010, 0b1100, TokenType.TILDE_CARAT)).toBe(0b1010 ^ ~0b1100);
      expect(compute_binary(0b1111, 0b0000, TokenType.TILDE_CARAT)).toBe(0b1111 ^ ~0);
    });
  });

  it("throws for unknown binary operator", () => {
    expect(() => compute_binary(1, 2, TokenType.SEMICOLON)).toThrow("Invariant: Binary operation should not be null");
  });
});

describe("compute_unary", () => {
  it("TILDE: bitwise NOT", () => {
    expect(compute_unary(0b0000, TokenType.TILDE)).toBe(~0b0000);
    expect(compute_unary(0b1111, TokenType.TILDE)).toBe(~0b1111);
    expect(compute_unary(5, TokenType.TILDE)).toBe(~5);
  });

  it("PLUS: positive (identity)", () => {
    expect(compute_unary(5, TokenType.PLUS)).toBe(5);
    expect(compute_unary(0, TokenType.PLUS)).toBe(0);
    expect(compute_unary(-3, TokenType.PLUS)).toBe(-3);
  });

  it("MINUS: negation", () => {
    expect(compute_unary(5, TokenType.MINUS)).toBe(-5);
    expect(compute_unary(-5, TokenType.MINUS)).toBe(5);
  });

  it("throws for unknown unary operator", () => {
    expect(() => compute_unary(5, TokenType.SEMICOLON)).toThrow("Invariant: Unary operation should not be null");
  });
});

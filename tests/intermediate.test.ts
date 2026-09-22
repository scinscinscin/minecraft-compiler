import { describe, expect, it } from "vitest";
import {
  compare_operands,
  Operand,
  MoveInstruction,
  BinaryInstruction,
  UnaryInstruction,
  JumpInstruction,
  ConditionalJump,
  LoadInstruction,
  StoreInstruction,
  PushInstruction,
  FunctionCallInstruction,
  FunctionExitInstruction,
  Phi,
  GotoLabel,
  BasicBlock,
  determine_leaders,
} from "@/intermediate";
import { TokenType } from "@/lexer";

describe("compare_operands", () => {
  function variable(name: string): Operand {
    return { type: "variable", name };
  }

  function globalVariable(name: string): Operand {
    return { type: "global_variable", name };
  }

  function tempReg(index: number): Operand {
    return { type: "temp_reg", index };
  }

  function literal(value: number, isParameter = false): Operand {
    return { type: "literal", is_parameter: isParameter, value };
  }

  function ssaVariable(name: string, index: number): Operand {
    return { type: "ssa_variable", name, index };
  }

  function returnRegister(): Operand {
    return { type: "return_register" };
  }

  function variableSpill(name: string): Operand {
    return { type: "variable_spill", name };
  }

  function registerSpill(index: number): Operand {
    return { type: "register_spill", index };
  }

  describe("variable", () => {
    it("returns true for same name", () => {
      expect(compare_operands(variable("x"), variable("x"))).toBe(true);
    });

    it("returns false for different names", () => {
      expect(compare_operands(variable("x"), variable("y"))).toBe(false);
    });

    it("returns false for different types", () => {
      expect(compare_operands(variable("x"), tempReg(0))).toBe(false);
    });
  });

  describe("global_variable", () => {
    it("returns true for same name", () => {
      expect(compare_operands(globalVariable("arr"), globalVariable("arr"))).toBe(true);
    });

    it("returns false for different names", () => {
      expect(compare_operands(globalVariable("arr"), globalVariable("ptr"))).toBe(false);
    });
  });

  describe("temp_reg", () => {
    it("returns true for same index", () => {
      expect(compare_operands(tempReg(3), tempReg(3))).toBe(true);
    });

    it("returns false for different index", () => {
      expect(compare_operands(tempReg(0), tempReg(1))).toBe(false);
    });
  });

  describe("literal", () => {
    it("returns true for same value and is_parameter", () => {
      expect(compare_operands(literal(42, false), literal(42, false))).toBe(true);
    });

    it("returns false for different value", () => {
      expect(compare_operands(literal(42, false), literal(43, false))).toBe(false);
    });

    it("returns false for different is_parameter", () => {
      expect(compare_operands(literal(42, true), literal(42, false))).toBe(false);
    });
  });

  describe("ssa_variable", () => {
    it("returns true for same name and index", () => {
      expect(compare_operands(ssaVariable("x", 1), ssaVariable("x", 1))).toBe(true);
    });

    it("returns false for different name", () => {
      expect(compare_operands(ssaVariable("x", 1), ssaVariable("y", 1))).toBe(false);
    });

    it("returns false for different index", () => {
      expect(compare_operands(ssaVariable("x", 1), ssaVariable("x", 2))).toBe(false);
    });
  });

  describe("return_register", () => {
    it("returns true for both return registers", () => {
      expect(compare_operands(returnRegister(), returnRegister())).toBe(true);
    });
  });

  describe("variable_spill", () => {
    it("returns true for same name", () => {
      expect(compare_operands(variableSpill("x"), variableSpill("x"))).toBe(true);
    });

    it("returns false for different names", () => {
      expect(compare_operands(variableSpill("x"), variableSpill("y"))).toBe(false);
    });
  });

  describe("register_spill", () => {
    it("returns true for same index", () => {
      expect(compare_operands(registerSpill(2), registerSpill(2))).toBe(true);
    });

    it("returns false for different index", () => {
      expect(compare_operands(registerSpill(0), registerSpill(1))).toBe(false);
    });
  });
});

describe("MoveInstruction", () => {
  it("returns correct inputs", () => {
    const instr = new MoveInstruction(
      { type: "temp_reg", index: 0 },
      { type: "literal", is_parameter: false, value: 42 },
    );
    expect(instr.get_inputs()).toEqual([{ type: "literal", is_parameter: false, value: 42 }]);
    expect(instr.get_outputs()).toEqual([{ type: "temp_reg", index: 0 }]);
  });

  it("stringifies correctly", () => {
    const instr = new MoveInstruction({ type: "variable", name: "x" }, { type: "variable", name: "y" });
    const str = instr.to_stringified();
    expect(str).toContain('"type":"variable"');
    expect(str).toContain('"name":"x"');
    expect(str).toContain('"name":"y"');
  });

  it("replaces operands correctly", () => {
    const target: Operand = { type: "variable", name: "x" };
    const source: Operand = { type: "variable", name: "y" };
    const instr = new MoveInstruction(target, source);
    const oldY = source;
    const newX: Operand = { type: "literal", is_parameter: false, value: 10 };

    instr.replace_operands(oldY, newX);
    expect(instr.source).toBe(newX);

    instr.replace_operands(target, { type: "variable", name: "z" });
    expect(instr.target).toEqual({ type: "variable", name: "z" });
  });
});

describe("BinaryInstruction", () => {
  it("returns correct inputs and outputs", () => {
    const instr = new BinaryInstruction(
      { type: "temp_reg", index: 0 },
      { type: "literal", is_parameter: false, value: 10 },
      TokenType.PLUS,
      { type: "literal", is_parameter: false, value: 20 },
    );
    expect(instr.get_inputs().length).toBe(2);
    expect(instr.get_outputs()).toEqual([{ type: "temp_reg", index: 0 }]);
  });

  it("checks if redefines variable correctly", () => {
    const instr = new BinaryInstruction(
      { type: "variable", name: "x" },
      { type: "literal", is_parameter: false, value: 1 },
      TokenType.PLUS,
      { type: "literal", is_parameter: false, value: 1 },
    );
    expect(instr.check_if_redefines_variable("x")).toBe(true);
    expect(instr.check_if_redefines_variable("y")).toBe(false);
  });
});

describe("UnaryInstruction", () => {
  it("returns correct inputs and outputs", () => {
    const instr = new UnaryInstruction(
      { type: "temp_reg", index: 0 },
      { type: "literal", is_parameter: false, value: 5 },
      TokenType.TILDE,
    );
    expect(instr.get_inputs()).toEqual([{ type: "literal", is_parameter: false, value: 5 }]);
    expect(instr.get_outputs()).toEqual([{ type: "temp_reg", index: 0 }]);
  });
});

describe("JumpInstruction", () => {
  it("stringifies correctly", () => {
    const instr = new JumpInstruction("loop");
    expect(instr.to_stringified()).toBe("jump loop");
  });

  it("replaces operands (no-op for jump)", () => {
    const instr = new JumpInstruction("target");
    instr.replace_operands({ type: "variable", name: "x" }, { type: "variable", name: "y" });
    expect(instr.to_stringified()).toBe("jump target");
  });
});

describe("ConditionalJump", () => {
  it("stringifies correctly", () => {
    const instr = new ConditionalJump({ type: "literal", is_parameter: false, value: 1 }, "end");
    const str = instr.to_stringified();
    expect(str).toContain("goto end");
    expect(str).toContain('"value":1');
  });

  it("returns correct inputs", () => {
    const instr = new ConditionalJump({ type: "variable", name: "cond" }, "target");
    expect(instr.get_inputs()).toEqual([{ type: "variable", name: "cond" }]);
  });
});

describe("LoadInstruction", () => {
  it("returns correct inputs and outputs", () => {
    const source: Operand = { type: "variable", name: "ptr" };
    const target: Operand = { type: "temp_reg", index: 0 };
    const instr = new LoadInstruction(target, source);
    expect(instr.get_inputs()).toEqual([source]);
    expect(instr.get_outputs()).toEqual([target]);
  });

  it("stringifies with dereference syntax", () => {
    const instr = new LoadInstruction({ type: "temp_reg", index: 0 }, { type: "variable", name: "ptr" });
    expect(instr.to_stringified()).toContain("*");
  });
});

describe("StoreInstruction", () => {
  it("returns correct inputs", () => {
    const instr = new StoreInstruction({ type: "variable", name: "ptr" }, { type: "temp_reg", index: 0 });
    expect(instr.get_inputs()).toEqual([
      { type: "variable", name: "ptr" },
      { type: "temp_reg", index: 0 },
    ]);
  });

  it("stringifies with dereference syntax", () => {
    const instr = new StoreInstruction(
      { type: "variable", name: "ptr" },
      { type: "literal", is_parameter: false, value: 42 },
    );
    expect(instr.to_stringified()).toContain("*");
  });
});

describe("PushInstruction", () => {
  it("returns correct inputs", () => {
    const instr = new PushInstruction({ type: "literal", is_parameter: false, value: 10 });
    expect(instr.get_inputs()).toEqual([{ type: "literal", is_parameter: false, value: 10 }]);
  });

  it("stringifies with push keyword", () => {
    const instr = new PushInstruction({ type: "variable", name: "x" });
    expect(instr.to_stringified()).toContain("push");
  });
});

describe("FunctionCallInstruction", () => {
  it("returns correct inputs and outputs", () => {
    const instr = new FunctionCallInstruction(
      { type: "temp_reg", index: 0 },
      [
        { type: "variable", name: "a" },
        { type: "variable", name: "b" },
      ],
      "add",
    );
    expect(instr.get_inputs()).toEqual([
      { type: "variable", name: "a" },
      { type: "variable", name: "b" },
    ]);
    expect(instr.get_outputs()).toEqual([{ type: "temp_reg", index: 0 }]);
  });
});

describe("FunctionExitInstruction", () => {
  it("stringifies correctly", () => {
    const instr = new FunctionExitInstruction();
    expect(instr.to_stringified()).toBe("function_exit");
  });

  it("returns return_register as input", () => {
    const instr = new FunctionExitInstruction();
    expect(instr.get_inputs()).toEqual([{ type: "return_register" }]);
  });
});

describe("Phi", () => {
  it("creates with target variable", () => {
    const phi = new Phi("x");
    expect(phi.target).toEqual({ type: "variable", name: "x" });
    expect(phi.sources).toEqual([]);
  });

  it("adds sources correctly", () => {
    const phi = new Phi("x");
    phi.add_source("x", 0, {} as any);
    phi.add_source("x", 1, {} as any);
    expect(phi.sources.length).toBe(2);
  });

  it("stringifies phi node", () => {
    const phi = new Phi("x");
    expect(phi.to_stringified()).toContain("phi(");
    expect(phi.to_stringified()).toContain('"name":"x"');
  });
});

describe("GotoLabel", () => {
  it("stringifies with label and colon", () => {
    const label = new GotoLabel("loop");
    expect(label.to_stringified()).toBe("loop:");
  });
});

describe("BasicBlock", () => {
  it("adds instructions", () => {
    const block = new BasicBlock([]);
    const instr = new MoveInstruction(
      { type: "temp_reg", index: 0 },
      { type: "literal", is_parameter: false, value: 1 },
    );
    block.add_instruction(instr);
    expect(block.instructions.length).toBe(1);
  });

  it("removes instructions", () => {
    const block = new BasicBlock([]);
    const instr1 = new MoveInstruction(
      { type: "temp_reg", index: 0 },
      { type: "literal", is_parameter: false, value: 1 },
    );
    const instr2 = new MoveInstruction(
      { type: "temp_reg", index: 1 },
      { type: "literal", is_parameter: false, value: 2 },
    );
    block.add_instruction(instr1);
    block.add_instruction(instr2);
    block.remove_instruction(instr1);
    expect(block.instructions.length).toBe(1);
    expect(block.instructions[0]).toBe(instr2);
  });

  it("adds successors", () => {
    const block1 = new BasicBlock([]);
    const block2 = new BasicBlock([]);
    block1.add_next_block(block2);
    expect(block1.successors).toContain(block2);
  });

  it("inserts phi nodes", () => {
    const block = new BasicBlock([]);
    block.insert_phi("x");
    expect(block.instructions[0]).toBeInstanceOf(Phi);
  });
});

describe("determine_leaders", () => {
  it("returns empty for instructions without preceding jumps or labels", () => {
    const code = [
      new MoveInstruction({ type: "temp_reg", index: 0 }, { type: "literal", is_parameter: false, value: 1 }),
    ];
    const leaders = determine_leaders(code);
    expect(leaders.length).toBe(0);
  });

  it("instruction after goto label is a leader", () => {
    const label = new GotoLabel("start");
    const instr = new MoveInstruction(
      { type: "temp_reg", index: 0 },
      { type: "literal", is_parameter: false, value: 1 },
    );

    const code = [label, instr];
    const leaders = determine_leaders(code);

    expect(leaders.length).toBe(1);
    expect(leaders[0].leader).toBe(instr);
  });

  it("instruction after jump is a leader", () => {
    const instr1 = new MoveInstruction(
      { type: "temp_reg", index: 0 },
      { type: "literal", is_parameter: false, value: 1 },
    );
    const jump = new JumpInstruction("target");
    const instr2 = new MoveInstruction(
      { type: "temp_reg", index: 1 },
      { type: "literal", is_parameter: false, value: 2 },
    );

    const code = [instr1, jump, instr2];
    const leaders = determine_leaders(code);

    expect(leaders.length).toBe(1);
    expect(leaders[0].leader).toBe(instr2);
  });

  it("instruction after conditional jump is a leader", () => {
    const condJump = new ConditionalJump({ type: "literal", is_parameter: false, value: 1 }, "target");
    const instrAfter = new MoveInstruction(
      { type: "temp_reg", index: 0 },
      { type: "literal", is_parameter: false, value: 1 },
    );

    const code = [condJump, instrAfter];
    const leaders = determine_leaders(code);

    expect(leaders.length).toBe(1);
    expect(leaders[0].leader).toBe(instrAfter);
  });

  it("handles goto label immediately before jump", () => {
    const label = new GotoLabel("loop");
    const jump = new JumpInstruction("target");

    const code = [label, jump];
    const leaders = determine_leaders(code);

    expect(leaders.length).toBe(1);
    expect(leaders[0].leader).toBe(jump);
  });
});

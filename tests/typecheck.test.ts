import { describe, it, expect } from "vitest";
import { buildProductions, Sparse } from "@scinorandex/sparse";
import { lexerGenerator, TokenType, TokenMetadata, toStringifiedTokenType } from "@/lexer";
import { Reducers, BaseNode, Program } from "@/parser";
import { TypeChecker } from "@/typechecker";
import { IntType } from "@/type";

function parse(source: string): Program {
  const grammar = `
<S>: <PROGRAM>;
<PROGRAM: program>: (<GLOBAL_DEFINITION_LIST: definitions>)? [EOF];
<GLOBAL_DEFINITION_LIST: global_definition_list>: 
  <FUNCTION_DEFINITION | GLOBAL_VARIABLE_DEFINITION: definition> (<GLOBAL_DEFINITION_LIST: rest>)?;
<GLOBAL_VARIABLE_DEFINITION: global_variable_definition>: [VAR] [IDENTIFIER: variable_name] [COLON] <TYPE: type> [EQUALS] [NUMBER: number] [SEMICOLON];
<FUNCTION_DEFINITION: function_definition>: 
  [FUNCTION] [IDENTIFIER: name] [LPAREN] (<PARAMETER_LIST: parameters>)? [RPAREN] [COLON] <TYPE: return_type> [LBRACE] (<STATEMENT_LIST: statements>)? [RBRACE];
<PARAMETER_LIST: parameter_list>: [IDENTIFIER: name] [COLON] <TYPE: type> ([COMMA] <PARAMETER_LIST: rest>)?;
<TYPE: type>: [IDENTIFIER: type_name];
<STATEMENT_LIST: statement_list>: <STATEMENT | VARIABLE_DEFINITION_STATEMENT: stmt> (<STATEMENT_LIST: rest>)?;
<VARIABLE_DEFINITION: variable_definition>: [VAR] [IDENTIFIER: variable_name] [COLON] <TYPE: type> [EQUALS] <EXPRESSION: initializer>;
<VARIABLE_DEFINITION_STATEMENT: variable_definition_statement>: <VARIABLE_DEFINITION: variable_definition> [SEMICOLON];
<STATEMENT: statement>: <IF_STATEMENT | WHILE_LOOP | FOR_LOOP | DO_WHILE_LOOP | EXPRESSION_STATEMENT | BLOCK_STATEMENT | RETURN_STATEMENT | BREAK_STATEMENT | CONTINUE_STATEMENT: stmt>;
<BLOCK_STATEMENT: block_statement>: [LBRACE] (<STATEMENT_LIST: statement_list>)? [RBRACE];
<IF_STATEMENT: if_statement>: [IF] [LPAREN] <EXPRESSION: condition> [RPAREN] <STATEMENT: body> ([ELSE] <STATEMENT: else_body>)?;
<WHILE_LOOP: while_loop>: [WHILE] [IDENTIFIER: loop_name] [LPAREN] <EXPRESSION: condition> [RPAREN] <STATEMENT: body>;
<FOR_LOOP: for_loop>: [FOR] [IDENTIFIER: loop_name] 
  [LPAREN] (<VARIABLE_DEFINITION: initializer>)? [SEMICOLON] (<EXPRESSION: condition>)? [SEMICOLON] (<EXPRESSION: post_body>)? [RPAREN] 
  <STATEMENT: body>;
<DO_WHILE_LOOP: do_while_loop>: [DO] <STATEMENT: body> [WHILE] [IDENTIFIER: loop_name] [LPAREN] <EXPRESSION: condition> [RPAREN] [SEMICOLON];
<EXPRESSION_STATEMENT: expression_statement>: <EXPRESSION: expression> [SEMICOLON];
<RETURN_STATEMENT: return_statement>: [RETURN] <EXPRESSION: expression> [SEMICOLON];
<BREAK_STATEMENT: break_statement>: [BREAK] [IDENTIFIER: loop_name] [SEMICOLON];
<CONTINUE_STATEMENT: continue_statement>: [CONTINUE] [IDENTIFIER: loop_name] [SEMICOLON];
<EXPRESSION: expression>: <ASSIGNMENT_EXPRESSION: expr>;
<ASSIGNMENT_EXPRESSION: assignment_expr>: ([IDENTIFIER: variable_name] [EQUALS])? <EQUALITY_EXPRESSION: expr>;
<EQUALITY_EXPRESSION: binary_expr>: <COMPARISON_EXPRESSION: left> ([DOUBLE_EQUALS | BANG_EQUALS: op] <COMPARISON_EXPRESSION: right>)?;
<COMPARISON_EXPRESSION: binary_expr>: 
  <BITWISE_OR_EXPRESSION: left> ([LESS_THAN | GREATER_THAN | LESS_THAN_EQUALS | GREATER_THAN_EQUALS: op] <BITWISE_OR_EXPRESSION: right>)?;
<BITWISE_OR_EXPRESSION: binary_expr>: <BITWISE_AND_EXPRESSION: left> ([PIPE | TILDE_PIPE: op] <BITWISE_OR_EXPRESSION: right>)?;
<BITWISE_AND_EXPRESSION: binary_expr>: <BITWISE_XOR_EXPRESSION: left> ([AMPERSAND | TILDE_AMPERSAND: op] <BITWISE_AND_EXPRESSION: right>)?;
<BITWISE_XOR_EXPRESSION: binary_expr>: <TERM_EXPRESSION: left> ([CARAT | TILDE_CARAT: op] <BITWISE_XOR_EXPRESSION: right>)?;
<TERM_EXPRESSION: binary_expr>: <SHIFT_EXPRESSION: left> ([PLUS | MINUS: op] <TERM_EXPRESSION: right>)?;
<SHIFT_EXPRESSION: unary_expr>: ([LEFTSHIFT | RIGHTSHIFT: op])? <BITWISE_NOT_EXPRESSION: target>;
<BITWISE_NOT_EXPRESSION: unary_expr>: ([TILDE: op])? <POINTER_ACCESS_EXPRESSION | ENDPOINT: target>;
<POINTER_ACCESS_EXPRESSION: pointer_access_expression>: [STAR: op] <ENDPOINT: target> ([EQUALS] <EXPRESSION: expr>)?;
<ENDPOINT: grouping_expr>: [LPAREN] <EXPRESSION: expr> [RPAREN];
<ENDPOINT: variable_reference>: [IDENTIFIER: variable_name];
<ENDPOINT: literal_expr>: [NUMBER: number];
<ENDPOINT: function_call>: [IDENTIFIER: function_name] [LPAREN] (<ARGUMENT_LIST: argument_list>)? [RPAREN];
<ARGUMENT_LIST: argument_list>: <EXPRESSION: expr> ([COMMA] <ARGUMENT_LIST: rest>)?;
`;

  const productions = buildProductions(grammar);
  const parserGenerator = Sparse.fromProductions<TokenType, TokenMetadata, BaseNode>({
    productions,
    toStringifiedTokenType,
  });

  const lexer = lexerGenerator.generate(source, () => ({}));
  const parser = parserGenerator.generate(lexer, {
    reducer: ({ bag, name }) => {
      const reducer = Reducers[name ?? ""];
      if (reducer != null) return reducer(bag);
      throw new Error("Invariant: Reducer should not be null. " + name);
    },
  });

  const result = parser.parse().result as Program | null;
  if (result == null) throw new Error("Parse failed: no result");
  return result;
}

function parseWithError(source: string): { program: Program; error: boolean } {
  try {
    const program = parse(source);
    return { program, error: false };
  } catch {
    return { program: null as unknown as Program, error: true };
  }
}

describe("type checker", () => {
  describe("valid programs", () => {
    it("accepts valid annotated program with variables", () => {
      const source = `
function main() : int {
  var a : int = 42;
  return a;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });

    it("accepts valid program with function parameters", () => {
      const source = `
function add(a : int, b : int) : int {
  var c : int = a + b;
  return c;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });

    it("accepts valid program with function calls", () => {
      const source = `
function twice(x : int) : int {
  return x + x;
}

function main() : int {
  var result : int = twice(21);
  return result;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });

    it("accepts valid program with assignments", () => {
      const source = `
function main() : int {
  var x : int = 10;
  x = 20;
  return x;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });

    it("accepts valid program with global variables", () => {
      const source = `
var count : int = 5;

function main() : int {
  return count;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });

    it("accepts valid program with nested blocks", () => {
      const source = `
function main() : int {
  var x : int = 1;
  {
    var y : int = 2;
    var z : int = x + y;
  }
  return x;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });

    it("accepts valid program with if statement", () => {
      const source = `
function main() : int {
  var x : int = 1;
  if (x) {
    x = 2;
  } else {
    x = 3;
  }
  return x;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });

    it("accepts valid program with while loop", () => {
      const source = `
function main() : int {
  var i : int = 0;
  while count (i < 10) {
    i = i + 1;
  }
  return i;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });

    it("accepts valid program with for loop", () => {
      const source = `
function main() : int {
  var result : int = 0;
  for count (var i : int = 0; i < 10; i = i + 1) {
    result = result + i;
  }
  return result;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(false);
    });
  });

  describe("arity mismatch errors", () => {
    it("reports wrong argument count in function call - too few", () => {
      const source = `
function add(a : int, b : int) : int {
  return a + b;
}

function main() : int {
  var result : int = add(1);
  return result;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(true);
      expect(checker.get_errors().length).toBeGreaterThanOrEqual(1);
    });

    it("reports wrong argument count in function call - too many", () => {
      const source = `
function add(a : int) : int {
  return a;
}

function main() : int {
  var result : int = add(1, 2);
  return result;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(true);
    });

    it("reports unknown function in call", () => {
      const source = `
function main() : int {
  var result : int = nonexistent(1);
  return result;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      checker.check_all(program);
      expect(checker.has_errors()).toBe(true);
    });
  });

  describe("unknown variable errors", () => {
    it("reports unknown variable in expression", () => {
      const source = `
function main() : int {
  var result : int = unknown_var + 1;
  return result;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      expect(() => checker.check_all(program)).toThrow("Unknown variable: unknown_var");
    });

    it("reports unknown variable in assignment", () => {
      const source = `
function main() : int {
  unknown_var = 5;
  return 0;
}
`;
      const program = parse(source);
      const checker = new TypeChecker();
      expect(() => checker.check_all(program)).toThrow("Unknown variable: unknown_var");
    });
  });

  describe("Type class", () => {
    it("IntType singleton equals itself", () => {
      expect(IntType.instance.equals(IntType.instance)).toBe(true);
    });

    it("IntType has name 'int'", () => {
      expect(IntType.instance.name).toBe("int");
    });
  });
});

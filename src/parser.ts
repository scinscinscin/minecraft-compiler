import { Token as SlexToken } from "@scinorandex/slex";
import { TokenMetadata, TokenType } from "./lexer";
import { Type } from "./type";
import { IntType } from "./type";
import { TypeChecker, Diagnostic } from "./typechecker";
import {
  BinaryInstruction,
  ConditionalJump,
  FunctionCallInstruction,
  FunctionExitInstruction,
  GotoLabel,
  IRCode,
  JumpInstruction,
  LoadInstruction,
  MoveInstruction,
  Operand,
  PushInstruction,
  StoreInstruction,
  UnaryInstruction,
} from "./intermediate";

type Token = SlexToken<TokenType, TokenMetadata>;

function resolve_type(token: Token): Type {
  if (token.lexeme === "int") return IntType.instance;
  throw new Error(`Unknown type: ${token.lexeme}`);
}

function make_underline(column: number, length: number): string {
  return " ".repeat(column - 1) + "^".repeat(length);
}

function get_token_position(token: Token): { line: number; column: number } {
  return { line: token.line ?? 0, column: token.column ?? 0 };
}

export class BaseNode {}
export class Program extends BaseNode {
  constructor(public definitions: GlobalDefinitions) {
    super();
  }

  check_types(checker: TypeChecker): void {
    this.definitions.check_types(checker);
  }
}

export class ListNode<T> extends BaseNode {
  constructor(private readonly items: T[]) {
    super();
  }

  add(node: T) {
    this.items.push(node);
    return this;
  }

  get_items() {
    return this.items;
  }

  get_items_reversed() {
    return this.items.toReversed();
  }
}

export class ParameterNode extends BaseNode {
  constructor(
    public readonly name: Token,
    public readonly type: Token,
  ) {
    super();
  }

  check_types(): void {
    // Parameter types are checked at the call site
  }
}

export class FunctionCompilationContext {
  constructor(
    public readonly function_name: string,
    public readonly parameters: ParameterNode[],
    public readonly global_variables: string[],
  ) {}

  emitted = [] as IRCode[];
  emit(ir_code: IRCode) {
    this.emitted.push(ir_code);
  }

  remove_instruction(ir_code: IRCode) {
    this.emitted = this.emitted.filter((x) => x !== ir_code);
  }

  replace_instruction(old_instruction: IRCode, replacement: IRCode) {
    this.emitted = this.emitted.map((x) => (x === old_instruction ? replacement : x));
  }

  prepend_instruction(instruction: IRCode, new_instruction: IRCode) {
    // inserts new_instruction before instruction
    const new_emitted = [] as IRCode[];
    for (const ir of this.emitted) {
      if (ir === instruction) new_emitted.push(new_instruction);
      new_emitted.push(ir);
    }
    this.emitted = new_emitted;
  }

  append_instruction(instruction: IRCode, new_instruction: IRCode) {
    // inserts new_instruction after instruction
    const new_emitted = [] as IRCode[];
    for (const ir of this.emitted) {
      new_emitted.push(ir);
      if (ir === instruction) new_emitted.push(new_instruction);
    }
    this.emitted = new_emitted;
  }

  used_regsiter_spills = 0;
  get_next_register_spill(): Operand {
    return { type: "register_spill", index: this.used_regsiter_spills++ };
  }

  used_registers = 0;
  get_next_temp_reg(): Operand {
    return { type: "temp_reg", index: this.used_registers++ };
  }

  condition_label = 0;
  get_next_condition_label() {
    return `condition${this.condition_label++}`;
  }

  variables: string[] = [];
  define_variable(name: string) {
    if (this.variables.includes(name)) throw new Error(`Variable ${name} already defined`);

    this.variables.push(name);
  }
}

export class FunctionDefinition extends BaseNode {
  constructor(
    public readonly name: Token,
    public readonly parameters: ListNode<ParameterNode>,
    public readonly return_type: Token,
    public readonly statements: ListNode<StatementNode>,
  ) {
    super();
  }

  // Compiles the statements into a list of IR Code
  compile(globals: string[]) {
    const parameters = this.parameters.get_items_reversed();
    const context = new FunctionCompilationContext(this.name.lexeme, parameters, globals);

    context.emit(new GotoLabel(this.name.lexeme + "_start"));
    for (const statement of this.statements.get_items_reversed()) statement.emit_ir(context);
    context.emit(new GotoLabel(this.name.lexeme + "_end"));
    context.emit(new FunctionExitInstruction());

    return context;
  }

  check_types(checker: TypeChecker, global_types: Map<string, Type>): void {
    const symbol_table = new SymbolTable(global_types);
    for (const param of this.parameters.get_items()) symbol_table.define_parameter(param.name.lexeme, param.type);

    const expected_return_type = resolve_type(this.return_type);
    for (const stmt of this.statements.get_items_reversed())
      stmt.check_types(checker, symbol_table, `function '${this.name.lexeme}'`, expected_return_type);
  }
}

export abstract class StatementNode extends BaseNode {
  abstract emit_ir(context: FunctionCompilationContext): void;
  abstract check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string, return_type: Type): void;
}

export class VariableDefinition extends StatementNode {
  constructor(
    public readonly name: Token,
    public readonly type: Token,
    public readonly initializer: ExpressionNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    context.define_variable(this.name.lexeme);

    const destination: Operand = { type: "variable", name: this.name.lexeme };
    this.initializer.emit_ir(context, destination);
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {
    const expected_type = resolve_type(this.type);
    if (expected_type == null) {
      const pos = get_token_position(this.type);
      checker.add_diagnostic(
        new Diagnostic(
          pos.line,
          pos.column,
          `unknown type '${this.type.lexeme}'`,
          "",
          make_underline(pos.column, this.type.lexeme.length),
          `${context}, variable '${this.name.lexeme}'`,
        ),
      );
      return;
    }

    const actual_type = this.initializer.get_type(symbol_table);
    if (!actual_type.equals(expected_type)) {
      const pos = get_token_position(this.type);
      checker.add_diagnostic(
        new Diagnostic(
          pos.line,
          pos.column,
          `type mismatch: expected '${expected_type.name}', got '${actual_type.name}'`,
          "",
          make_underline(pos.column, this.type.lexeme.length),
          `${context}, variable '${this.name.lexeme}'`,
        ),
      );
    }

    this.initializer.check_types(checker, symbol_table, context);
    symbol_table.define_variable(this.name.lexeme, this.type);
  }
}

export class IfStatement extends StatementNode {
  constructor(
    public readonly condition: ExpressionNode,
    public readonly body: StatementNode,
    public readonly else_body: StatementNode | null,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    const prefix = context.get_next_condition_label();
    const true_label = prefix + "_true";
    const false_label = prefix + "_false";
    const finished_label = prefix + "_end";

    context.emit(new ConditionalJump(this.condition.emit_ir(context), true_label));
    if (this.else_body != null) context.emit(new JumpInstruction(false_label));
    else context.emit(new JumpInstruction(finished_label));

    context.emit(new GotoLabel(true_label));
    this.body.emit_ir(context);

    if (this.else_body != null) {
      context.emit(new JumpInstruction(finished_label));
      context.emit(new GotoLabel(false_label));
      this.else_body.emit_ir(context);
      // context.emit(new JumpInstruction(finished_label));
    }

    context.emit(new GotoLabel(finished_label));
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string, return_type: Type): void {
    this.condition.check_types(checker, symbol_table, context);
    this.body.check_types(checker, symbol_table, context, return_type);
    if (this.else_body != null) {
      this.else_body.check_types(checker, symbol_table, context, return_type);
    }
  }
}

export class WhileLoop extends StatementNode {
  constructor(
    public readonly loop_name: Token,
    public readonly condition: ExpressionNode,
    public readonly body: StatementNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    const body_label = this.loop_name.lexeme + "_body";
    const finished_label = this.loop_name.lexeme + "_end";
    const condition_label = this.loop_name.lexeme + "_condition";

    context.emit(new GotoLabel(condition_label));
    context.emit(new ConditionalJump(this.condition.emit_ir(context), body_label));
    context.emit(new JumpInstruction(finished_label));

    context.emit(new GotoLabel(body_label));
    this.body.emit_ir(context);
    context.emit(new JumpInstruction(condition_label));

    context.emit(new GotoLabel(finished_label));
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string, return_type: Type): void {
    this.condition.check_types(checker, symbol_table, context);
    this.body.check_types(checker, symbol_table, context, return_type);
  }
}

export class ForLoop extends StatementNode {
  constructor(
    public readonly loop_name: Token,
    public readonly initializer: VariableDefinition | null,
    public readonly condition: ExpressionNode | null,
    public readonly post_body: ExpressionNode | null,
    public readonly body: StatementNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    const body_label = this.loop_name.lexeme + "_body";
    const finished_label = this.loop_name.lexeme + "_end";
    const condition_label = this.loop_name.lexeme + "_condition";

    if (this.initializer != null) this.initializer.emit_ir(context);

    context.emit(new GotoLabel(condition_label));

    if (this.condition != null) {
      context.emit(new ConditionalJump(this.condition.emit_ir(context), body_label));
      context.emit(new JumpInstruction(finished_label));
    } else context.emit(new JumpInstruction(body_label));

    context.emit(new GotoLabel(body_label));
    this.body.emit_ir(context);
    if (this.post_body != null) this.post_body.emit_ir(context);
    context.emit(new JumpInstruction(condition_label));

    context.emit(new GotoLabel(finished_label));
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string, return_type: Type): void {
    if (this.initializer != null) this.initializer.check_types(checker, symbol_table, context);
    if (this.condition != null) this.condition.check_types(checker, symbol_table, context);
    if (this.post_body != null) this.post_body.check_types(checker, symbol_table, context);
    this.body.check_types(checker, symbol_table, context, return_type);
  }
}

export class DoWhileLoop extends StatementNode {
  constructor(
    public readonly loop_name: Token,
    public readonly body: StatementNode,
    public readonly condition: ExpressionNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    const body_label = this.loop_name.lexeme + "_body";
    const finished_label = this.loop_name.lexeme + "_end";
    const condition_label = this.loop_name.lexeme + "_condition";

    context.emit(new GotoLabel(body_label));
    this.body.emit_ir(context);
    context.emit(new GotoLabel(condition_label));
    context.emit(new ConditionalJump(this.condition.emit_ir(context), body_label));
    context.emit(new JumpInstruction(finished_label));
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string, return_type: Type): void {
    this.body.check_types(checker, symbol_table, context, return_type);
    this.condition.check_types(checker, symbol_table, context);
  }
}

export class BlockStatement extends StatementNode {
  constructor(public readonly statements: ListNode<StatementNode>) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    for (const statement of this.statements.get_items_reversed()) {
      statement.emit_ir(context);
    }
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string, return_type: Type): void {
    for (const stmt of this.statements.get_items_reversed()) {
      stmt.check_types(checker, symbol_table, context, return_type);
    }
  }
}

export class ReturnStatement extends StatementNode {
  constructor(public readonly expression: ExpressionNode) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    const destination = this.expression.emit_ir(context);
    context.emit(new MoveInstruction({ type: "return_register" }, destination));
    context.emit(new JumpInstruction(context.function_name + "_end"));
    // context.emit(new ReturnInstruction(destination));
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string, return_type?: Type): void {
    if (return_type == null) return;
    const actual_type = this.expression.get_type(symbol_table);
    if (!actual_type.equals(return_type)) {
      checker.add_diagnostic(
        new Diagnostic(
          0,
          0,
          `type mismatch: expected '${return_type.name}', got '${actual_type.name}'`,
          "",
          "",
          `${context}, return statement`,
        ),
      );
    }
    this.expression.check_types(checker, symbol_table, context);
  }
}

export class BreakStatement extends StatementNode {
  constructor(public readonly loop_name: Token) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    context.emit(new JumpInstruction(this.loop_name.lexeme + "_end"));
  }

  check_types(): void {}
}

export class ContinueStatement extends StatementNode {
  constructor(public readonly loop_name: Token) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    context.emit(new JumpInstruction(this.loop_name.lexeme + "_condition"));
  }

  check_types(): void {}
}

export class ExpressionStatement extends StatementNode {
  constructor(public readonly expression: ExpressionNode) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    this.expression.emit_ir(context);
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string, return_type?: Type): void {
    this.expression.check_types(checker, symbol_table, context);
  }
}

export class SymbolTable {
  private locals: Map<string, { type: Token; is_parameter: boolean }> = new Map();
  private global_types: Map<string, Type>;

  constructor(global_types: Map<string, Type>) {
    this.global_types = global_types;
  }

  define_variable(name: string, type: Token) {
    this.locals.set(name, { type, is_parameter: false });
  }

  define_parameter(name: string, type: Token) {
    this.locals.set(name, { type, is_parameter: true });
  }

  lookup(name: string): { type: Token; is_parameter: boolean } | undefined {
    return this.locals.get(name);
  }

  has_global(name: string): boolean {
    return this.global_types.has(name);
  }

  get_global_type(name: string): Type | undefined {
    return this.global_types.get(name);
  }
}

export abstract class ExpressionNode extends BaseNode {
  abstract emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand): Operand;
  abstract get_type(ctx: SymbolTable): Type;
  abstract check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void;
}

export class BinaryExpression extends ExpressionNode {
  constructor(
    public readonly left: ExpressionNode,
    public readonly right: ExpressionNode,
    public readonly op: Token,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const destination = preferred_destination ?? context.get_next_temp_reg();

    const left = this.left.emit_ir(context);
    const right = this.right.emit_ir(context);

    context.emit(new BinaryInstruction(destination, left, this.op.type, right));
    return destination;
  }

  get_type(ctx: SymbolTable): Type {
    this.left.get_type(ctx);
    this.right.get_type(ctx);
    return IntType.instance;
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {
    this.left.check_types(checker, symbol_table, context);
    this.right.check_types(checker, symbol_table, context);
  }
}

export class UnaryExpression extends ExpressionNode {
  constructor(
    public readonly target: ExpressionNode,
    public readonly op: Token,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const destination = preferred_destination ?? context.get_next_temp_reg();
    const left = this.target.emit_ir(context);

    if (this.op.type !== TokenType.STAR) context.emit(new UnaryInstruction(destination, left, this.op.type));
    else context.emit(new LoadInstruction(destination, left));
    return destination;
  }

  get_type(ctx: SymbolTable): Type {
    this.target.get_type(ctx);
    return IntType.instance;
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {
    this.target.check_types(checker, symbol_table, context);
  }
}

export class PointerAssignmentExpression extends ExpressionNode {
  constructor(
    public readonly target: ExpressionNode,
    public readonly expr: ExpressionNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const destination = preferred_destination ?? context.get_next_temp_reg();

    const expr = this.expr.emit_ir(context);
    const target = this.target.emit_ir(context);

    // need to make sure the destination register actually has the value in left
    context.emit(new StoreInstruction(target, expr));
    context.emit(new MoveInstruction(destination, expr));
    return destination;
  }

  get_type(ctx: SymbolTable): Type {
    this.target.get_type(ctx);
    this.expr.get_type(ctx);
    return IntType.instance;
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {
    this.target.check_types(checker, symbol_table, context);
    this.expr.check_types(checker, symbol_table, context);
  }
}

export class AssignmentExpression extends ExpressionNode {
  constructor(
    public readonly variable_name: Token,
    public readonly expr: ExpressionNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const is_parameter = context.parameters.some((p) => p.name.lexeme === this.variable_name.lexeme);
    if (is_parameter) throw new Error("Invariant: Cannot assign to a parameter");

    const is_global_variable = context.global_variables.includes(this.variable_name.lexeme);
    if (is_global_variable) {
      const temporary = context.get_next_temp_reg();
      this.expr.emit_ir(context, temporary);
      context.emit(new StoreInstruction({ type: "global_variable", name: this.variable_name.lexeme }, temporary));
      if (preferred_destination == null) return temporary;

      context.emit(new MoveInstruction(preferred_destination, temporary));
      return preferred_destination;
    }

    const destination: Operand = { type: "variable", name: this.variable_name.lexeme };
    this.expr.emit_ir(context, destination);
    if (preferred_destination == null) return destination;

    context.emit(new MoveInstruction(preferred_destination, destination));
    return preferred_destination;
  }

  get_type(ctx: SymbolTable): Type {
    this.expr.get_type(ctx);
    return IntType.instance;
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {
    const local = symbol_table.lookup(this.variable_name.lexeme);
    const global_type = symbol_table.get_global_type(this.variable_name.lexeme);

    if (local == null && global_type == null) {
      const pos = get_token_position(this.variable_name);
      checker.add_diagnostic(
        new Diagnostic(
          pos.line,
          pos.column,
          `unknown variable '${this.variable_name.lexeme}'`,
          "",
          make_underline(pos.column, this.variable_name.lexeme.length),
          `${context}`,
        ),
      );
      throw new Error(`Unknown variable: ${this.variable_name.lexeme}`);
    }

    let expected_type: Type | null = null;
    if (local != null) {
      expected_type = resolve_type(local.type);
    } else if (global_type != null) {
      expected_type = global_type;
    }

    if (expected_type == null) {
      const pos = get_token_position(this.variable_name);
      checker.add_diagnostic(
        new Diagnostic(
          pos.line,
          pos.column,
          `unknown type for variable '${this.variable_name.lexeme}'`,
          "",
          make_underline(pos.column, this.variable_name.lexeme.length),
          `${context}, assignment to '${this.variable_name.lexeme}'`,
        ),
      );
      return;
    }

    const actual_type = this.expr.get_type(symbol_table);
    if (!actual_type.equals(expected_type)) {
      const pos = get_token_position(this.variable_name);
      checker.add_diagnostic(
        new Diagnostic(
          pos.line,
          pos.column,
          `type mismatch: expected '${expected_type.name}', got '${actual_type.name}'`,
          "",
          make_underline(pos.column, this.variable_name.lexeme.length),
          `${context}, assignment to '${this.variable_name.lexeme}'`,
        ),
      );
    }

    this.expr.check_types(checker, symbol_table, context);
  }
}

export class GroupingExpression extends ExpressionNode {
  constructor(public readonly expr: ExpressionNode) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    return this.expr.emit_ir(context, preferred_destination);
  }

  get_type(ctx: SymbolTable): Type {
    return this.expr.get_type(ctx);
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {
    this.expr.check_types(checker, symbol_table, context);
  }
}

export class LiteralExpression extends ExpressionNode {
  constructor(public readonly number: Token) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand): Operand {
    const ret: Operand = { type: "literal", is_parameter: false, value: parseInt(this.number.lexeme) };
    if (preferred_destination == null) return ret;

    context.emit(new MoveInstruction(preferred_destination, ret));
    return preferred_destination;
  }

  get_type(_ctx: SymbolTable): Type {
    return IntType.instance;
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {}
}

export class FunctionCall extends ExpressionNode {
  constructor(
    public readonly func_name: Token,
    public readonly args: ListNode<ExpressionNode>,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const args = this.args.get_items();
    const operands = [] as Operand[];
    for (const arg of args) {
      const dest = arg.emit_ir(context);
      operands.push(dest);
      context.emit(new PushInstruction(dest));
    }

    const destination = preferred_destination ?? context.get_next_temp_reg();
    context.emit(new FunctionCallInstruction(destination, operands, this.func_name.lexeme));
    context.emit(new MoveInstruction(destination, { type: "return_register" }));
    return destination;
  }

  get_type(_ctx: SymbolTable): Type {
    return IntType.instance;
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {
    const func_info = checker.get_function_info(this.func_name.lexeme);
    if (func_info == null) {
      const pos = get_token_position(this.func_name);
      checker.add_diagnostic(
        new Diagnostic(
          pos.line,
          pos.column,
          `unknown function '${this.func_name.lexeme}'`,
          "",
          make_underline(pos.column, this.func_name.lexeme.length),
          `${context}`,
        ),
      );
      return;
    }

    const arg_list = this.args.get_items();
    const param_list = func_info.parameters;

    if (arg_list.length !== param_list.length) {
      const pos = get_token_position(this.func_name);
      checker.add_diagnostic(
        new Diagnostic(
          pos.line,
          pos.column,
          `expected ${param_list.length} arguments, got ${arg_list.length}`,
          "",
          make_underline(pos.column, this.func_name.lexeme.length),
          `${context}, call to '${this.func_name.lexeme}'`,
        ),
      );
      return;
    }

    for (let i = 0; i < arg_list.length; i++) {
      const arg = arg_list[i];
      const param = param_list[i];
      const actual_type = arg.get_type(symbol_table);
      const expected_type = resolve_type(param.type);

      if (expected_type == null) {
        const pos = get_token_position(param.type);
        checker.add_diagnostic(
          new Diagnostic(
            pos.line,
            pos.column,
            `unknown parameter type '${param.type.lexeme}'`,
            "",
            make_underline(pos.column, param.type.lexeme.length),
            `${context}, parameter '${param.name.lexeme}' of function '${this.func_name.lexeme}'`,
          ),
        );
        continue;
      }

      if (!actual_type.equals(expected_type)) {
        const pos = get_token_position(this.func_name);
        checker.add_diagnostic(
          new Diagnostic(
            pos.line,
            pos.column,
            `type mismatch: expected '${expected_type.name}', got '${actual_type.name}'`,
            "",
            make_underline(pos.column, this.func_name.lexeme.length),
            `${context}, argument ${i + 1} to '${this.func_name.lexeme}'`,
          ),
        );
      }

      arg.check_types(checker, symbol_table, context);
    }
  }
}

export class VariableReference extends ExpressionNode {
  constructor(public readonly name: Token) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const global_variable_index = context.global_variables.indexOf(this.name.lexeme);
    if (global_variable_index !== -1) {
      const temporary = context.get_next_temp_reg();
      context.emit(new LoadInstruction(temporary, { type: "global_variable", name: this.name.lexeme }));

      if (preferred_destination == null) return temporary;
      context.emit(new MoveInstruction(preferred_destination, temporary));
      return preferred_destination;
    }

    const parameter_index = context.parameters.findIndex((p) => p.name.lexeme === this.name.lexeme);
    if (parameter_index !== -1) {
      const temporary = context.get_next_temp_reg();
      context.emit(new MoveInstruction(temporary, { type: "literal", is_parameter: true, value: parameter_index }));

      if (preferred_destination == null) return temporary;
      context.emit(new MoveInstruction(preferred_destination, temporary));
      return preferred_destination;
    }

    const ret: Operand = { type: "variable", name: this.name.lexeme };
    if (preferred_destination == null) return ret;
    context.emit(new MoveInstruction(preferred_destination, ret));
    return preferred_destination;
  }

  get_type(ctx: SymbolTable): Type {
    const symbol = ctx.lookup(this.name.lexeme);
    if (symbol != null) {
      return this.resolve_type(symbol.type);
    }

    const global_type = ctx.get_global_type(this.name.lexeme);
    if (global_type != null) {
      return global_type;
    }

    throw new Error(`Unknown variable: ${this.name.lexeme}`);
  }

  check_types(checker: TypeChecker, symbol_table: SymbolTable, context: string): void {
    this.get_type(symbol_table);
  }

  private resolve_type(type_token: Token): Type {
    if (type_token.lexeme === "int") return IntType.instance;
    throw new Error(`Unknown type: ${type_token.lexeme}`);
  }
}

class GlobalDefinitions extends BaseNode {
  functions: ListNode<FunctionDefinition> = new ListNode([]);
  variables: ListNode<VariableDefinition> = new ListNode([]);
  variable_types: Map<string, Token> = new Map();

  add_function(function_definition: FunctionDefinition) {
    this.functions.add(function_definition);
  }

  add_variable(variable_definition: VariableDefinition) {
    this.variables.add(variable_definition);
    this.variable_types.set(variable_definition.name.lexeme, variable_definition.type);
  }

  check_types(checker: TypeChecker): void {
    const global_types = checker.get_global_types();
    const symbol_table = new SymbolTable(global_types);

    for (const global of this.variables.get_items()) {
      symbol_table.define_variable(global.name.lexeme, global.type);
      global.check_types(checker, symbol_table, "");
    }

    for (const func of this.functions.get_items()) func.check_types(checker, global_types);
  }
}

type Reducer = (bag: any) => BaseNode;
export const Reducers = {
  program: (bag: { definitions: GlobalDefinitions }) => new Program(bag.definitions),

  global_definition_list: (bag: { definition: FunctionDefinition | VariableDefinition; rest?: GlobalDefinitions }) => {
    const rest = bag.rest ?? new GlobalDefinitions();
    if (bag.definition instanceof FunctionDefinition) rest.add_function(bag.definition);
    else if (bag.definition instanceof VariableDefinition) rest.add_variable(bag.definition);
    return rest;
  },

  global_variable_definition: (bag: { variable_name: Token; type: Token; number: Token }) =>
    new VariableDefinition(bag.variable_name, bag.type, new LiteralExpression(bag.number)),
  function_definition: (bag: {
    name: Token;
    parameters?: ListNode<ParameterNode>;
    return_type: Token;
    statements?: ListNode<StatementNode>;
  }) =>
    new FunctionDefinition(
      bag.name,
      bag.parameters ?? new ListNode([]),
      bag.return_type,
      bag.statements ?? new ListNode([]),
    ),
  parameter_list: (bag: { name: Token; type: Token; rest?: ListNode<ParameterNode> }) =>
    bag.rest == null
      ? new ListNode([new ParameterNode(bag.name, bag.type)])
      : bag.rest.add(new ParameterNode(bag.name, bag.type)),
  type: (bag: { type_name: Token }) => bag.type_name,

  statement_list: (bag: { stmt: StatementNode; rest?: ListNode<StatementNode> }) =>
    bag.rest == null ? new ListNode([bag.stmt]) : bag.rest.add(bag.stmt),
  variable_definition: (bag: { variable_name: Token; type: Token; initializer: ExpressionNode }) =>
    new VariableDefinition(bag.variable_name, bag.type, bag.initializer),
  variable_definition_statement: (bag: { variable_definition: VariableDefinition }) => bag.variable_definition,
  statement: (bag: { stmt: StatementNode }) => bag.stmt,
  block_statement: (bag: { statement_list?: ListNode<StatementNode> }) =>
    new BlockStatement(bag.statement_list ?? new ListNode([])),
  if_statement: (bag: { condition: ExpressionNode; body: StatementNode; else_body?: StatementNode }) =>
    new IfStatement(bag.condition, bag.body, bag.else_body ?? null),
  while_loop: (bag: { loop_name: Token; condition: ExpressionNode; body: StatementNode }) =>
    new WhileLoop(bag.loop_name, bag.condition, bag.body),
  // prettier-ignore
  for_loop: (bag: { loop_name: Token; initializer?: VariableDefinition; condition?: ExpressionNode; post_body?: ExpressionNode; body: StatementNode }) => 
    new ForLoop(bag.loop_name, bag.initializer ?? null, bag.condition ?? null, bag.post_body ?? null, bag.body),
  do_while_loop: (bag: { loop_name: Token; body: StatementNode; condition: ExpressionNode }) =>
    new DoWhileLoop(bag.loop_name, bag.body, bag.condition),

  expression_statement: (bag: { expression: ExpressionNode }) => new ExpressionStatement(bag.expression),
  return_statement: (bag: { expression: ExpressionNode }) => new ReturnStatement(bag.expression),
  break_statement: (bag: { loop_name: Token }) => new BreakStatement(bag.loop_name),
  continue_statement: (bag: { loop_name: Token }) => new ContinueStatement(bag.loop_name),

  expression: (bag: { expr: ExpressionNode }) => bag.expr,
  binary_expr: (bag: { left: ExpressionNode; right?: ExpressionNode; op?: Token }) => {
    if (bag.right == null) return bag.left;
    if (bag.op == null) throw new Error("Invariant: Binary expression should have an operator");
    return new BinaryExpression(bag.left, bag.right, bag.op);
  },
  unary_expr: (bag: { target: ExpressionNode; op?: Token }) => {
    if (bag.op == null) return bag.target;
    else return new UnaryExpression(bag.target, bag.op);
  },
  assignment_expr: (bag: { variable_name?: Token; expr: ExpressionNode }) => {
    if (bag.variable_name == null) return bag.expr;
    else return new AssignmentExpression(bag.variable_name, bag.expr);
  },
  pointer_access_expression: (bag: { op: Token; target: ExpressionNode; expr?: ExpressionNode }) => {
    if (bag.expr == null) return new UnaryExpression(bag.target, bag.op);
    return new PointerAssignmentExpression(bag.target, bag.expr);
  },
  grouping_expr: (bag: { expr: ExpressionNode }) => new GroupingExpression(bag.expr),
  literal_expr: (bag: { number: Token }) => new LiteralExpression(bag.number),
  variable_reference: (bag: { variable_name: Token }) => new VariableReference(bag.variable_name),
  function_call: (bag: { function_name: Token; argument_list?: ListNode<ExpressionNode> }) =>
    new FunctionCall(bag.function_name, bag.argument_list ?? new ListNode([])),
  argument_list: (bag: { expr: ExpressionNode; rest?: ListNode<ExpressionNode> }) =>
    bag.rest == null ? new ListNode([bag.expr]) : bag.rest.add(bag.expr),
} as { [key: string]: Reducer };

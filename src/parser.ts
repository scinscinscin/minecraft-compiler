import { Token as SlexToken } from "@scinorandex/slex";
import { TokenMetadata, TokenType } from "./lexer";
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
import { Type, StaticAnalysisContext, CallableType, UnknownType, IntType } from "./typechecker";

export type Token = SlexToken<TokenType, TokenMetadata>;

export class BaseNode {}
export class Program extends BaseNode {
  constructor(public definitions: GlobalDefinitions) {
    super();
  }

  verify_static_analysis(context: StaticAnalysisContext) {
    this.definitions.verify_static_analysis(context);
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

class GlobalDefinitions extends BaseNode {
  functions: ListNode<FunctionDefinition> = new ListNode([]);
  variables: ListNode<VariableDefinition> = new ListNode([]);

  add_function(function_definition: FunctionDefinition) {
    this.functions.add(function_definition);
  }

  add_variable(variable_definition: VariableDefinition) {
    this.variables.add(variable_definition);
  }

  verify_static_analysis(context: StaticAnalysisContext) {
    for (const func of this.functions.get_items()) func.verify_static_analysis(context);
    for (const variable of this.variables.get_items()) variable.verify_static_analysis(context);
  }
}

export class ParameterNode extends BaseNode {
  constructor(
    public readonly name: Token,
    public readonly type: TypeExpression,
  ) {
    super();
  }

  get_type(ctx: StaticAnalysisContext): Type {
    return this.type.get_type(ctx);
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
    if (ir_code instanceof JumpInstruction && this.is_top_unconditional_jump()) {
      return;
    }

    this.emitted.push(ir_code);
  }

  is_top_unconditional_jump() {
    const top = this.emitted[this.emitted.length - 1];
    return top instanceof JumpInstruction;
  }

  remove_instruction(ir_code: IRCode) {
    const idx = this.emitted.indexOf(ir_code);
    if (idx !== -1) this.emitted.splice(idx, 1);
  }

  replace_instruction(old_instruction: IRCode, replacement: IRCode) {
    const idx = this.emitted.indexOf(old_instruction);
    if (idx !== -1) this.emitted[idx] = replacement;
  }

  prepend_instruction(instruction: IRCode, new_instruction: IRCode) {
    const idx = this.emitted.indexOf(instruction);
    if (idx !== -1) this.emitted.splice(idx, 0, new_instruction);
  }

  append_instruction(instruction: IRCode, new_instruction: IRCode) {
    const idx = this.emitted.indexOf(instruction);
    if (idx !== -1) this.emitted.splice(idx + 1, 0, new_instruction);
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
    public readonly return_type: TypeExpression,
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

  verify_static_analysis(context: StaticAnalysisContext): void {
    const parameter_types = this.parameters.get_items_reversed().map((x) => x.type.get_type(context));
    const expected_return_type = this.return_type.get_type(context);

    context.define_identifier(this.name, new CallableType(expected_return_type, parameter_types));

    const inside_context = context.fork();
    inside_context.set_return_type(expected_return_type);
    for (const stmt of this.statements.get_items_reversed()) stmt.verify_static_analysis(inside_context);
  }
}

export abstract class StatementNode extends BaseNode {
  abstract emit_ir(context: FunctionCompilationContext): void;
  abstract verify_static_analysis(context: StaticAnalysisContext): void;
}

export class VariableDefinition extends StatementNode {
  constructor(
    public readonly name: Token,
    public readonly type: TypeExpression,
    public readonly initializer: ExpressionNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    context.define_variable(this.name.lexeme);

    const destination: Operand = { type: "variable", name: this.name.lexeme };
    this.initializer.emit_ir(context, destination);
  }

  verify_static_analysis(context: StaticAnalysisContext): void {
    // make sure that the type of the initializer is the same as the type of the variable
    const expected_type = this.type.get_type(context);
    const actual_type = this.initializer.type_check(context);

    context.define_identifier(this.name, expected_type);
    if (!actual_type.equals(expected_type)) context.emit_type_mismatch(this.name, expected_type, actual_type);
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

  verify_static_analysis(context: StaticAnalysisContext): void {
    this.body.verify_static_analysis(context);
    const condition_type = this.condition.type_check(context);
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

  verify_static_analysis(context: StaticAnalysisContext): void {
    const loop_context = context.fork();
    loop_context.add_breakpoint(this.loop_name.lexeme);

    this.condition.type_check(loop_context);
    this.body.verify_static_analysis(loop_context);
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

  verify_static_analysis(context: StaticAnalysisContext): void {
    const loop_context = context.fork();
    loop_context.add_breakpoint(this.loop_name.lexeme);

    if (this.initializer != null) this.initializer.verify_static_analysis(loop_context);
    if (this.condition != null) this.condition.type_check(loop_context);
    if (this.post_body != null) this.post_body.type_check(loop_context);
    this.body.verify_static_analysis(loop_context);
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

  verify_static_analysis(context: StaticAnalysisContext): void {
    this.body.verify_static_analysis(context);
    this.condition.type_check(context);
  }
}

export class BlockStatement extends StatementNode {
  constructor(public readonly statements: ListNode<StatementNode>) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    for (const statement of this.statements.get_items_reversed()) {
      statement.emit_ir(context);
      if (statement instanceof ReturnStatement) break;
    }
  }

  verify_static_analysis(context: StaticAnalysisContext): void {
    const internal_context = context.fork();
    for (const stmt of this.statements.get_items_reversed()) stmt.verify_static_analysis(internal_context);
  }
}

export class ReturnStatement extends StatementNode {
  constructor(
    public readonly r_token: Token,
    public readonly expression: ExpressionNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    const destination = this.expression.emit_ir(context);
    context.emit(new MoveInstruction({ type: "return_register" }, destination));
    context.emit(new JumpInstruction(context.function_name + "_end"));
  }

  verify_static_analysis(context: StaticAnalysisContext): void {
    const expr_type = this.expression.type_check(context);
    const expected = context.get_return_type();

    if (!expr_type.equals(expected)) {
      context.emit_type_mismatch(this.r_token, expected, expr_type);
    }
  }
}

export class BreakStatement extends StatementNode {
  constructor(public readonly loop_name: Token) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    context.emit(new JumpInstruction(this.loop_name.lexeme + "_end"));
  }

  verify_static_analysis(context: StaticAnalysisContext): void {
    const is_valid = context.is_breakpoint(this.loop_name.lexeme);
    if (is_valid === false) context.emit_error(this.loop_name, `Unknown loop name: ${this.loop_name.lexeme}`);
  }
}

export class ContinueStatement extends StatementNode {
  constructor(public readonly loop_name: Token) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    context.emit(new JumpInstruction(this.loop_name.lexeme + "_condition"));
  }

  verify_static_analysis(context: StaticAnalysisContext): void {
    const is_valid = context.is_breakpoint(this.loop_name.lexeme);
    if (is_valid === false) context.emit_error(this.loop_name, `Unknown loop name: ${this.loop_name.lexeme}`);
  }
}

export class ExpressionStatement extends StatementNode {
  constructor(public readonly expression: ExpressionNode) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    this.expression.emit_ir(context);
  }

  verify_static_analysis(context: StaticAnalysisContext): void {
    this.expression.type_check(context);
  }
}

export abstract class ExpressionNode extends BaseNode {
  abstract emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand): Operand;
  abstract type_check(context: StaticAnalysisContext): Type;
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

  type_check(context: StaticAnalysisContext): Type {
    const left_type = this.left.type_check(context);
    const right_type = this.right.type_check(context);

    // determine what the type is with op
    switch (this.op.type) {
      case TokenType.PLUS:
      case TokenType.MINUS:
      case TokenType.PIPE:
      case TokenType.AMPERSAND:
      case TokenType.CARAT:
      case TokenType.TILDE_PIPE:
      case TokenType.TILDE_AMPERSAND:
      case TokenType.TILDE_CARAT:
      case TokenType.TILDE:
      case TokenType.STAR:
      case TokenType.DOUBLE_EQUALS:
      case TokenType.BANG_EQUALS:
      case TokenType.LESS_THAN:
      case TokenType.GREATER_THAN:
      case TokenType.LESS_THAN_EQUALS:
      case TokenType.GREATER_THAN_EQUALS:
      case TokenType.EQUALS:
        if (left_type.is_number() && right_type.is_number()) return IntType.instance;
        context.emit_error(
          this.op,
          `Cannot apply operator '${this.op.lexeme}' to types '${left_type.stringify()}' and '${right_type.stringify()}'`,
        );
        return UnknownType.instance;
    }

    context.emit_error(this.op, `Unknown operator: ${this.op.lexeme}`);
    return UnknownType.instance;
  }
}

export class UnaryExpression extends ExpressionNode {
  constructor(
    public readonly expr: ExpressionNode,
    public readonly op: Token,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const destination = preferred_destination ?? context.get_next_temp_reg();
    const left = this.expr.emit_ir(context);

    if (this.op.type !== TokenType.STAR) context.emit(new UnaryInstruction(destination, left, this.op.type));
    else context.emit(new LoadInstruction(destination, left));
    return destination;
  }

  type_check(context: StaticAnalysisContext): Type {
    const target_type = this.expr.type_check(context);

    switch (this.op.type) {
      case TokenType.STAR:
      case TokenType.PLUS:
      case TokenType.MINUS:
      case TokenType.TILDE:
        if (target_type.is_number()) return IntType.instance;
        context.emit_error(this.op, `Cannot apply operator '${this.op.lexeme}' to type '${target_type.stringify()}'`);
        return UnknownType.instance;
    }

    context.emit_error(this.op, `Unknown operator: ${this.op.lexeme}`);
    return UnknownType.instance;
  }
}

export class PointerAssignmentExpression extends ExpressionNode {
  constructor(
    public readonly target: ExpressionNode,
    public readonly op: Token,
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

  type_check(context: StaticAnalysisContext): Type {
    const target_type = this.target.type_check(context);
    const expr_type = this.expr.type_check(context);

    if (target_type.is_number() == false) {
      context.emit_error(this.op, `Cannot assign to type '${target_type.stringify()}'`);
    }

    return expr_type;
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

  type_check(context: StaticAnalysisContext): Type {
    const expected_type = context.get_identifier_type(this.variable_name);
    const actual_type = this.expr.type_check(context);

    if (expected_type == null) {
      context.emit_error(this.variable_name, `Unknown identifier: ${this.variable_name.lexeme}`);
      return UnknownType.instance;
    }

    if (!actual_type.equals(expected_type)) context.emit_type_mismatch(this.variable_name, expected_type, actual_type);
    return expected_type;
  }
}

export class GroupingExpression extends ExpressionNode {
  constructor(public readonly expr: ExpressionNode) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    return this.expr.emit_ir(context, preferred_destination);
  }

  type_check(context: StaticAnalysisContext): Type {
    return this.expr.type_check(context);
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

  type_check(context: StaticAnalysisContext): Type {
    return IntType.instance;
  }
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

  type_check(context: StaticAnalysisContext): Type {
    const func_info = context.get_identifier_type(this.func_name);
    if (func_info == null) {
      context.emit_error(this.func_name, `Unknown function: ${this.func_name.lexeme}`);
      return UnknownType.instance;
    }

    if (func_info.is_callable() === false) {
      context.emit_error(this.func_name, `'${this.func_name.lexeme}' is not a function`);
      return UnknownType.instance;
    }

    const func_type = func_info as CallableType;
    const arg_types = this.args.get_items().map((x) => x.type_check(context));

    if (arg_types.length !== func_type.parameters.length) {
      context.emit_error(this.func_name, `Expected ${func_type.parameters.length} arguments, got ${arg_types.length}`);
      return UnknownType.instance;
    }

    for (let i = 0; i < arg_types.length; i++) {
      const arg_type = arg_types[i];
      const param_type = func_type.parameters[i];
      if (!arg_type.equals(param_type)) context.emit_type_mismatch(this.func_name, param_type, arg_type);
    }

    return func_type.return_type;
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

  type_check(context: StaticAnalysisContext): Type {
    const symbol = context.get_identifier_type(this.name);

    if (symbol != null) return symbol;
    context.emit_error(this.name, `Unknown variable: ${this.name.lexeme}`);
    return UnknownType.instance;
  }
}

abstract class TypeExpression extends BaseNode {
  abstract get_type(ctx: StaticAnalysisContext): Type;
}

class TypeIdentifier extends TypeExpression {
  constructor(public readonly name: Token) {
    super();
  }

  get_type(ctx: StaticAnalysisContext): Type {
    return ctx.lookup_type(this.name);
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

  global_variable_definition: (bag: { variable_name: Token; type: TypeExpression; number: Token }) =>
    new VariableDefinition(bag.variable_name, bag.type, new LiteralExpression(bag.number)),
  function_definition: (bag: {
    name: Token;
    parameters?: ListNode<ParameterNode>;
    return_type: TypeExpression;
    statements?: ListNode<StatementNode>;
  }) =>
    new FunctionDefinition(
      bag.name,
      bag.parameters ?? new ListNode([]),
      bag.return_type,
      bag.statements ?? new ListNode([]),
    ),
  parameter_list: (bag: { name: Token; type: TypeExpression; rest?: ListNode<ParameterNode> }) =>
    bag.rest == null
      ? new ListNode([new ParameterNode(bag.name, bag.type)])
      : bag.rest.add(new ParameterNode(bag.name, bag.type)),
  type_identifier: (bag: { type_name: Token }) => new TypeIdentifier(bag.type_name),

  statement_list: (bag: { stmt: StatementNode; rest?: ListNode<StatementNode> }) =>
    bag.rest == null ? new ListNode([bag.stmt]) : bag.rest.add(bag.stmt),
  variable_definition: (bag: { variable_name: Token; type: TypeExpression; initializer: ExpressionNode }) =>
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
  return_statement: (bag: { return_token: Token; expression: ExpressionNode }) =>
    new ReturnStatement(bag.return_token, bag.expression),
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
    return new PointerAssignmentExpression(bag.target, bag.op, bag.expr);
  },
  grouping_expr: (bag: { expr: ExpressionNode }) => new GroupingExpression(bag.expr),
  literal_expr: (bag: { number: Token }) => new LiteralExpression(bag.number),
  variable_reference: (bag: { variable_name: Token }) => new VariableReference(bag.variable_name),
  function_call: (bag: { function_name: Token; argument_list?: ListNode<ExpressionNode> }) =>
    new FunctionCall(bag.function_name, bag.argument_list ?? new ListNode([])),
  argument_list: (bag: { expr: ExpressionNode; rest?: ListNode<ExpressionNode> }) =>
    bag.rest == null ? new ListNode([bag.expr]) : bag.rest.add(bag.expr),
} as { [key: string]: Reducer };

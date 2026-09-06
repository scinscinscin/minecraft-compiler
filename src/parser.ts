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

type Token = SlexToken<TokenType, TokenMetadata>;

export class BaseNode {}
export class Program extends BaseNode {
  constructor(public function_definitions: ListNode<FunctionDefinition>) {
    super();
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

export class FunctionCompilationContext {
  constructor(
    public readonly function_name: string,
    public readonly parameters: string[],
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
    public readonly parameters: ListNode<Token>,
    public readonly statements: ListNode<StatementNode>,
  ) {
    super();
  }

  // Compiles the statements into a list of IR Code
  compile() {
    const parameters = this.parameters.get_items_reversed().map((x) => x.lexeme);
    const context = new FunctionCompilationContext(this.name.lexeme, parameters);

    context.emit(new GotoLabel(this.name.lexeme + "_start"));
    for (const statement of this.statements.get_items_reversed()) statement.emit_ir(context);
    context.emit(new GotoLabel(this.name.lexeme + "_end"));
    context.emit(new FunctionExitInstruction());

    return context;
  }
}

export abstract class StatementNode extends BaseNode {
  abstract emit_ir(context: FunctionCompilationContext): void;
}

export class VariableDefinition extends StatementNode {
  constructor(
    public readonly name: Token,
    public readonly initializer: ExpressionNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    context.define_variable(this.name.lexeme);

    const destination: Operand = { type: "variable", name: this.name.lexeme };
    this.initializer.emit_ir(context, destination);
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
}

export class ExpressionStatement extends StatementNode {
  constructor(public readonly expression: ExpressionNode) {
    super();
  }

  emit_ir(context: FunctionCompilationContext) {
    this.expression.emit_ir(context);
  }
}

export abstract class ExpressionNode extends BaseNode {
  abstract emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand): Operand;
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
}

export class AssignmentExpression extends ExpressionNode {
  constructor(
    public readonly variable_name: Token,
    public readonly expr: ExpressionNode,
  ) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const is_parameter = context.parameters.includes(this.variable_name.lexeme);
    if (is_parameter) throw new Error("Invariant: Cannot assign to a parameter");

    const destination: Operand = { type: "variable", name: this.variable_name.lexeme };
    this.expr.emit_ir(context, destination);
    if (preferred_destination == null) return destination;

    context.emit(new MoveInstruction(preferred_destination, destination));
    return preferred_destination;
  }
}

export class GroupingExpression extends ExpressionNode {
  constructor(public readonly expr: ExpressionNode) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    return this.expr.emit_ir(context, preferred_destination);
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
}

export class VariableReference extends ExpressionNode {
  constructor(public readonly name: Token) {
    super();
  }

  emit_ir(context: FunctionCompilationContext, preferred_destination?: Operand) {
    const parameter_index = context.parameters.indexOf(this.name.lexeme);
    const ret: Operand =
      parameter_index !== -1
        ? { type: "literal", is_parameter: true, value: context.parameters.indexOf(this.name.lexeme) }
        : { type: "variable", name: this.name.lexeme };

    if (preferred_destination == null) return ret;

    context.emit(new MoveInstruction(preferred_destination, ret));
    return preferred_destination;
  }
}

type Reducer = (bag: any) => BaseNode;
export const Reducers = {
  program: (bag: { function_list: ListNode<FunctionDefinition> }) => new Program(bag.function_list),
  function_definition_list: (bag: { function_definition: FunctionDefinition; rest?: ListNode<FunctionDefinition> }) =>
    bag.rest == null ? new ListNode([bag.function_definition]) : bag.rest.add(bag.function_definition),
  function_definition: (bag: { name: Token; parameters?: ListNode<Token>; statements?: ListNode<StatementNode> }) =>
    new FunctionDefinition(bag.name, bag.parameters ?? new ListNode([]), bag.statements ?? new ListNode([])),
  parameter_list: (bag: { name: Token; rest?: ListNode<Token> }) =>
    bag.rest == null ? new ListNode([bag.name]) : bag.rest.add(bag.name),

  statement_list: (bag: { stmt: StatementNode; rest?: ListNode<StatementNode> }) =>
    bag.rest == null ? new ListNode([bag.stmt]) : bag.rest.add(bag.stmt),
  variable_definition: (bag: { variable_name: Token; initializer: ExpressionNode }) =>
    new VariableDefinition(bag.variable_name, bag.initializer),
  statement: (bag: { stmt: StatementNode }) => bag.stmt,
  block_statement: (bag: { statement_list?: ListNode<StatementNode> }) =>
    new BlockStatement(bag.statement_list ?? new ListNode([])),
  if_statement: (bag: { condition: ExpressionNode; body: StatementNode; else_body?: StatementNode }) =>
    new IfStatement(bag.condition, bag.body, bag.else_body ?? null),
  while_loop: (bag: { loop_name: Token; condition: ExpressionNode; body: StatementNode }) =>
    new WhileLoop(bag.loop_name, bag.condition, bag.body),
  expression_statement: (bag: { expression: ExpressionNode }) => new ExpressionStatement(bag.expression),
  return_statement: (bag: { expression: ExpressionNode }) => new ReturnStatement(bag.expression),

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
  pointer_assignment_expr: (bag: { target: ExpressionNode; expr: ExpressionNode }) => {
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

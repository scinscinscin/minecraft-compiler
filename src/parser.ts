import { Token as SlexToken } from "@scinorandex/slex";
import { TokenMetadata, TokenType } from "./lexer";
import {
  Addressable,
  BinaryOperation,
  GotoLabel,
  IntermediateBytecode,
  Jump,
  LoadConstant,
  LoadMemory,
  Move,
  Noop,
  Pop,
  Push,
  StoreMemory,
  UnaryOperation,
} from "./bytecode";

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

const GPR_COUNT = 7;
class FunctionCompilationContext {
  // number here is the offset to the base pointer
  variables = {} as { [key: string]: number };
  variable_count = 0;
  name: string;

  constructor(parameters: string[], name: string) {
    this.name = name;

    for (let i = 0; i < parameters.length; i++) {
      const parameter_name = parameters[i];
      let offset = i + 2;
      this.variables[parameter_name] = offset;
    }
  }

  set_variable(name: string) {
    if (this.variables[name] != null) throw new Error(`Variable or parameter ${name} already exists`);
    else this.variables[name] = ++this.variable_count * -1; // stack grows downwards
  }

  get_variable(name: string) {
    if (this.variables[name] == null) throw new Error(`Variable or parameter ${name} does not exist`);
    return this.variables[name];
  }

  bytecode = [] as IntermediateBytecode[];
  emit(ir_bytecode: IntermediateBytecode) {
    this.bytecode.push(ir_bytecode);
  }

  last_allocated = -1;
  get_register(): Addressable & { type: "gpr" } {
    return { type: "gpr", index: ++this.last_allocated % GPR_COUNT };
  }

  last_goto_label = -1;
  get_goto_label(): string {
    return `label_${++this.last_goto_label}`;
  }

  get_rewriter() {
    const index = this.bytecode.length;
    this.emit(new Noop());
    return (replacement: IntermediateBytecode) => {
      this.bytecode[index] = replacement;
    };
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

  compile(): IntermediateBytecode[] {
    const parameters = this.parameters.get_items_reversed();
    const context = new FunctionCompilationContext(
      parameters.map((x) => x.lexeme),
      this.name.lexeme,
    );

    context.emit(new GotoLabel(this.name.lexeme + "_start", true)); // add entry point for function
    context.emit(new Push({ type: "base" })); // save the current base pointer
    context.emit(new Move({ type: "stack" }, { type: "base" })); // set base pointer to top of stack

    // get the stub for the code that can move the stack pointer to allocate variables
    const var_count = context.get_rewriter();

    for (const stmt of this.statements.get_items_reversed()) stmt.compile(context);

    context.emit(new GotoLabel(this.name.lexeme + "_end"));
    context.emit(new Move({ type: "base" }, { type: "stack" })); // set stack pointer to top of base pointer again
    context.emit(new Pop({ type: "base" }));
    context.emit(new Pop({ type: "ip" }));

    var_count(
      new BinaryOperation(
        "+",
        { type: "stack" },
        { type: "stack" },
        { type: "constant", value: context.variable_count },
      ),
    );

    return context.bytecode;
  }
}

export abstract class StatementNode extends BaseNode {
  abstract compile(context: FunctionCompilationContext): void;
}

export class VariableDefinition extends StatementNode {
  constructor(
    public readonly name: Token,
    public readonly initializer: ExpressionNode,
  ) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    // need to compile the initializer first
    context.set_variable(this.name.lexeme);
    const expr = this.initializer.compile(context);
    context.emit(
      new StoreMemory(expr, {
        type: "indirect_reference",
        reg: { type: "base" },
        offset: context.get_variable(this.name.lexeme),
      }),
    );
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

  compile(context: FunctionCompilationContext) {
    const label_base = context.get_goto_label();

    // the flag register will have whether we're going to jump or not
    const condition = this.condition.compile(context);

    context.emit(new Jump("zero", label_base + (this.else_body == null ? "_finished" : "_else")));
    this.body.compile(context);

    if (this.else_body != null) {
      context.emit(new Jump("unconditional", label_base + "_finished"));
      context.emit(new GotoLabel(label_base + "_else"));
      this.else_body.compile(context);
    }

    context.emit(new GotoLabel(label_base + "_finished"));
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

  compile(context: FunctionCompilationContext) {
    /**
     * Go back to condition
     * Check iv valid, if not go to finished, else continue to body.
     */
    context.emit(new GotoLabel(this.loop_name.lexeme + "_condition"));
    this.condition.compile(context);
    context.emit(new Jump("zero", this.loop_name.lexeme + "_finished"));
    this.body.compile(context);
    context.emit(new Jump("unconditional", this.loop_name.lexeme + "_condition"));
    context.emit(new GotoLabel(this.loop_name.lexeme + "_finished"));
  }
}

export class BlockStatement extends StatementNode {
  constructor(public readonly statements: ListNode<StatementNode>) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    for (const stmt of this.statements.get_items_reversed()) stmt.compile(context);
  }
}

export class ReturnStatement extends StatementNode {
  constructor(public readonly expression: ExpressionNode) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    const expr = this.expression.compile(context);
    context.emit(new Move(expr, { type: "gpr", index: 0 }));
    context.emit(new Jump("unconditional", context.name + "_end"));
  }
}

export class ExpressionStatement extends StatementNode {
  constructor(public readonly expression: ExpressionNode) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    this.expression.compile(context);
  }
}

export abstract class ExpressionNode extends BaseNode {
  abstract compile(context: FunctionCompilationContext): Addressable & { type: "gpr" };
}

export class BinaryExpression extends ExpressionNode {
  constructor(
    public readonly left: ExpressionNode,
    public readonly right: ExpressionNode,
    public readonly op: Token,
  ) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    // We need to stash and pop the left value because function calls can clobber registers
    context.emit(new Push(this.left.compile(context)));
    const right = this.right.compile(context);

    const unstash = context.get_register();
    context.emit(new Pop(unstash));
    const output = context.get_register();

    context.emit(new BinaryOperation(this.op.lexeme, output, unstash, right));
    return output;
  }
}

export class UnaryExpression extends ExpressionNode {
  constructor(
    public readonly target: ExpressionNode,
    public readonly op: Token,
  ) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    const target = this.target.compile(context);
    const output = context.get_register();

    context.emit(new UnaryOperation(this.op.lexeme, output, target));
    return output;
  }
}

export class AssignmentExpression extends ExpressionNode {
  constructor(
    public readonly variable_name: Token,
    public readonly expr: ExpressionNode,
  ) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    // get the memory location of the variable\
    const expr = this.expr.compile(context);
    const offset = context.get_variable(this.variable_name.lexeme);
    context.emit(new StoreMemory(expr, { type: "indirect_reference", reg: { type: "base" }, offset }));
    return expr;
  }
}

export class GroupingExpression extends ExpressionNode {
  constructor(public readonly expr: ExpressionNode) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    return this.expr.compile(context);
  }
}

export class LiteralExpression extends ExpressionNode {
  constructor(public readonly number: Token) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    const output = context.get_register();
    context.emit(new LoadConstant(parseInt(this.number.lexeme), output));
    return output;
  }
}

export class FunctionCall extends ExpressionNode {
  constructor(
    public readonly func_name: Token,
    public readonly args: ListNode<ExpressionNode>,
  ) {
    super();
  }

  compile(context: FunctionCompilationContext): Addressable & { type: "gpr" } {
    const parameter_expressions = this.args.get_items();
    const arity = parameter_expressions.length;

    for (const parameter_expr of parameter_expressions) {
      const reg = parameter_expr.compile(context);
      context.emit(new Push(reg));
    }

    // calculate the return address
    const current_ip = context.get_register();
    const return_address = context.get_register();

    context.emit(new Move({ type: "ip" }, current_ip));
    context.emit(new BinaryOperation("+", return_address, current_ip, { type: "constant", value: 4 }));
    context.emit(new Push(return_address));

    // enter the function
    context.emit(new GotoLabel(this.func_name.lexeme + "_start"));

    // deallocate the stack
    context.emit(new BinaryOperation("-", { type: "stack" }, { type: "stack" }, { type: "constant", value: arity }));

    // return first register, which contains the value
    return { type: "gpr", index: 0 };
  }
}

export class VariableReference extends ExpressionNode {
  constructor(public readonly name: Token) {
    super();
  }

  compile(context: FunctionCompilationContext) {
    const offset = context.get_variable(this.name.lexeme);
    const ret = context.get_register();
    context.emit(new LoadMemory({ type: "indirect_reference", reg: { type: "base" }, offset }, ret));
    return ret;
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
  grouping_expr: (bag: { expr: ExpressionNode }) => new GroupingExpression(bag.expr),
  literal_expr: (bag: { number: Token }) => new LiteralExpression(bag.number),
  variable_reference: (bag: { variable_name: Token }) => new VariableReference(bag.variable_name),
  function_call: (bag: { function_name: Token; argument_list?: ListNode<ExpressionNode> }) =>
    new FunctionCall(bag.function_name, bag.argument_list ?? new ListNode([])),
  argument_list: (bag: { expr: ExpressionNode; rest?: ListNode<ExpressionNode> }) =>
    bag.rest == null ? new ListNode([bag.expr]) : bag.rest.add(bag.expr),
} as { [key: string]: Reducer };

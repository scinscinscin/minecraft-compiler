import { Token } from "./parser";

export function print_diagnostic(
  source_file_path: string,
  source: string,
  line: number,
  column: number,
  error: string,
) {
  console.log(`Error: ${error}`);
  console.log(`  at ${source_file_path}:${line}:${column}`);
  console.log(build_error_window(source, line, column));
}

export const build_error_window = (file: string, line: number, column: number) => {
  const lines = file.split("\n");

  const length = Math.max(`${line}`.length, `${column}`.length);
  let second = "",
    third = "";

  for (let i = 0; i < column + length + 3; i++) {
    second += " ";
    third += "-";
  }
  second += "|";
  third += "┘";

  let window = `${line.toString().padStart(length)} | ${
    lines.length <= line - 1 ? "" : lines[line - 1]
  }\n${second}\n${third}\n`;

  if (line < lines.length) window += `${(line + 1).toString().padStart(length)} | ${lines[line]}\n`;
  return window;
};

export abstract class Type {
  abstract stringify(): string;
  abstract equals(other: Type): boolean;

  abstract is_number(): boolean;
  abstract is_callable(): boolean;
}

export class IntType extends Type {
  static instance = new IntType();

  stringify() {
    return "int";
  }

  equals(other: Type) {
    return other instanceof IntType;
  }

  is_number() {
    return true;
  }

  is_callable() {
    return false;
  }
}

export class CallableType extends Type {
  constructor(
    public readonly return_type: Type,
    public readonly parameters: Type[],
  ) {
    super();
  }

  stringify() {
    return `(${this.parameters.map((x) => x.stringify()).join(", ")}) -> ${this.return_type.stringify()}`;
  }

  equals(other: Type) {
    if (!(other instanceof CallableType)) return false;

    if (this.return_type.equals(other.return_type) === false) return false;
    if (this.parameters.length !== other.parameters.length) return false;

    for (let i = 0; i < this.parameters.length; i++)
      if (this.parameters[i].equals(other.parameters[i]) === false) return false;

    return true;
  }

  is_callable() {
    return true;
  }

  is_number() {
    return false;
  }
}

export class UnknownType extends Type {
  static instance = new UnknownType();

  stringify() {
    return "unknown";
  }

  equals(other: Type) {
    return false;
  }

  is_number() {
    return false;
  }

  is_callable() {
    return false;
  }
}

const intrinsic_types = new Map<string, Type>([["int", IntType.instance]]);
export class StaticAnalysisContext {
  constructor(public readonly parent: StaticAnalysisContext | null = null) {}
  get_root(): StaticAnalysisContext {
    return this.parent == null ? this : this.parent.get_root();
  }

  return_type: Type | null = null;
  set_return_type(type: Type) {
    this.return_type = type;
  }

  errors: { token: Token; message: string }[] = [];
  emit_error(token: Token, message: string) {
    this.get_root().errors.push({ token, message });
  }

  emit_type_mismatch(token: Token, expected: Type, actual: Type) {
    this.emit_error(token, `type mismatch: expected '${expected.stringify()}', got '${actual.stringify()}'`);
  }

  lookup(token: Token): Type {
    const name = token.lexeme;
    if (intrinsic_types.has(name)) return intrinsic_types.get(name)!;

    this.emit_error(token, `Unknown type: ${name}`);
    return UnknownType.instance;
  }

  environment: Map<string, Type> = new Map();
  get_identifier_type(token: Token): Type | null {
    if (this.environment.has(token.lexeme)) return this.environment.get(token.lexeme)!;
    if (this.parent != null) return this.parent.get_identifier_type(token);

    return null;
  }
  define_identifier(token: Token, type: Type) {
    this.environment.set(token.lexeme, type);
  }

  break_points: string[] = [];
  add_breakpoint(name: string) {
    this.break_points.push(name);
  }

  is_breakpoint(name: string): boolean {
    const t = this.break_points.includes(name);
    if (t) return true;
    if (this.parent != null) return this.parent.is_breakpoint(name);
    return false;
  }

  fork() {
    return new StaticAnalysisContext(this);
  }
}

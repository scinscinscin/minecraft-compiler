import { Token as SlexToken } from "@scinorandex/slex";
import { TokenMetadata, TokenType } from "./lexer";
import { Program, ParameterNode, SymbolTable } from "./parser";
import { Type, IntType } from "./type";

type Token = SlexToken<TokenType, TokenMetadata>;

function resolve_type(token: Token): Type | null {
  if (token.lexeme === "int") return IntType.instance;
  return null;
}

export class Diagnostic {
  constructor(
    public line: number,
    public column: number,
    public message: string,
    public source_line: string,
    public underline: string,
    public context: string,
  ) {}
}

export class TypeCheckResult {
  private diagnostics: Diagnostic[] = [];

  has_errors(): boolean {
    return this.diagnostics.length > 0;
  }

  add_diagnostic(diagnostic: Diagnostic) {
    this.diagnostics.push(diagnostic);
  }

  get_errors(): Diagnostic[] {
    return this.diagnostics;
  }

  print_errors() {
    for (const diag of this.diagnostics) {
      console.log(`\nError: ${diag.message}`);
      console.log(`  at scratch.txt:${diag.line}:${diag.column}`);
      console.log(`  |`);
      console.log(`${diag.line} | ${diag.source_line}`);
      console.log(`  | ${diag.underline}`);
      if (diag.context) {
        console.log(`  |`);
        console.log(`  in ${diag.context}`);
      }
    }
    console.log();
  }
}

export class TypeChecker {
  private function_registry = new Map<string, { parameters: ParameterNode[]; return_type: Token }>();
  private global_types = new Map<string, Type>();
  private result: TypeCheckResult = new TypeCheckResult();

  check_all(program: Program) {
    this.build_registry(program);
    this.check_program(program);
  }

  build_registry(program: Program) {
    for (const func of program.definitions.functions.get_items()) {
      this.function_registry.set(func.name.lexeme, {
        parameters: func.parameters.get_items(),
        return_type: func.return_type,
      });
    }
    for (const global of program.definitions.variables.get_items()) {
      const global_type = resolve_type(global.type);
      if (global_type != null) {
        this.global_types.set(global.name.lexeme, global_type);
      }
    }
  }

  check_program(program: Program) {
    const global_types = this.global_types;
    for (const func of program.definitions.functions.get_items()) {
      const symbol_table = new SymbolTable(global_types);
      for (const param of func.parameters.get_items()) {
        symbol_table.define_parameter(param.name.lexeme, param.type);
      }
      func.check_types(this, global_types);
    }
  }

  add_global(global_name: string, global_type: Type) {
    this.global_types.set(global_name, global_type);
  }

  add_diagnostic(diagnostic: Diagnostic) {
    this.result.add_diagnostic(diagnostic);
  }

  get_function_info(name: string): { parameters: ParameterNode[]; return_type: Token } | undefined {
    return this.function_registry.get(name);
  }

  get_global_types(): Map<string, Type> {
    return this.global_types;
  }

  get_errors(): Diagnostic[] {
    return this.result.get_errors();
  }

  has_errors(): boolean {
    return this.result.has_errors();
  }

  print_errors() {
    this.result.print_errors();
  }
}

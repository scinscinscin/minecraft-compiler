export abstract class Type {
  abstract equals(other: Type): boolean;
  abstract name: string;
}

export class IntType extends Type {
  static readonly instance = new IntType();

  private constructor() {
    super();
  }

  equals(other: Type): boolean {
    return other instanceof IntType;
  }

  get name(): string {
    return 'int';
  }
}

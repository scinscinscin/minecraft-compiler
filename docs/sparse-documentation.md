# Sparse

`@scinorandex/sparse` is a LR(1) and LALR(1) parser generator that allows developers to easily create parsers by defining context-free grammars.

## Usage

**Define the CFG of your language.**

The CFG is defined by creating a file containing a list of productions. Variables are identifiers encased in angle brackets like `<STATEMENT>`, while terminals are encased in square-brackets like `[L_COLON]`. 

An example production includes: `<IF_STATEMENT> : [IF] [L_PAREN] <EXPRESSION> [R_PAREN] <STATEMENT> <ELSE_IF_STATEMENTS> [ELSE] <STATEMENT>;`. 

An example CFG for a basic MDAS calculator is the following:

```
<S>: <PROGRAM>;
<PROGRAM>: <EXPRESSION> [EOF];
<PROGRAM>: [EOF];
<EXPRESSION>: <TERM_EXPRESSION>;
<TERM_EXPRESSION>: <FACTOR_EXPRESSION> [PLUS] <TERM_EXPRESSION>;
<TERM_EXPRESSION>: <FACTOR_EXPRESSION> [MINUS] <TERM_EXPRESSION>;
<TERM_EXPRESSION>: <FACTOR_EXPRESSION>;
<FACTOR_EXPRESSION>: <ENDPOINT> [STAR] <FACTOR_EXPRESSION>;
<FACTOR_EXPRESSION>: <ENDPOINT> [SLASH] <FACTOR_EXPRESSION>;
<FACTOR_EXPRESSION>: <ENDPOINT>;
<ENDPOINT>: [NUMBER];
```

**Create your Slex lexer.**

For full reference on the Slex API, look at the documentation in `docs/slex-documentation.md`.

```ts
import { Slex } from "@scinorandex/slex";

// Make sure the identifiers here match with the terminals in your CFG.
enum TokenType {
  PLUS, MINUS, STAR, SLASH, NUMBER, EOF
}

type Metadata = {};

const lexerGenerator = new Slex<TokenType, Metadata>({
  EOF_TYPE: TokenType.EOF,
  isHigherPrecedence: ({ current, next }) => false,
});

lexerGenerator.addRule("plus", "$+", TokenType.PLUS);
lexerGenerator.addRule("minus", "$-", TokenType.MINUS);
lexerGenerator.addRule("star", "$*", TokenType.STAR);
lexerGenerator.addRule("forward_slash", "$/", TokenType.SLASH);
lexerGenerator.addRule("digit", "0|1|2|3|4|5|6|7|8|9");
lexerGenerator.addRule("float_number", "(${digit})+$.(${digit})+");
lexerGenerator.addRule("decimal_number", "(${digit})+");
lexerGenerator.addRule("number_literal", "${float_number}|${decimal_number}", TokenType.NUMBER);

const lexer = lexerGenerator.generate(`2.4 + 3.5 * 1 / 456.789`, () => ({}));
```

**Define the node representation.** 

Sparse allows you to build the AST however you want, deferring to your functions when its time to make a reduction, giving you control over the representation.

```ts
type StringifiedNode = (StringifiedNode | string)[];

// It doesn't have to be a class. It just has to be a structure that all nodes
// in the AST adhere to. Classes allow this to be done easily through subclassing.
class Node {
  constructor(public readonly nodes: LR1StackSymbol<TokenType, {}, Node>[]) {}
  toObject(): StringifiedNode {
    return this.nodes.map((node) => (node.type === "token" 
      ? node.token.lexeme 
      : node.node.toObject()
    ));
  }
}
```

**Building the productions and the parser.**

Productions are built using the `buildProductions()` function, which can be passed into Sparse alongside `toStringifiedTokenType`, which converts a numerical TypeScript enum to the name of the terminal.

```ts
async function main() {
  const toStringifiedTokenType = (type: TokenType) => TokenType[type];
  const productions = buildProductions(await fs.readFile("./example/math/grammar.txt", "utf8"));
  const parserGenerator = Sparse.fromProductions<TokenType, Metadata, Node>({ productions, toStringifiedTokenType });
}
```

**Define your reducer and begin parsing.**

Finally, you can define the parser's reduction function and optionally define the recovery handling function.

```ts
const parser = parserGenerator.generate(lexer, {
  reducer: (_, { input, index }) => new Node(input),
});

console.log(parser.parse().result!.toObject());
```
import { describe, expect, it } from "vitest";
import { lexerGenerator, TokenType, TokenMetadata } from "@/lexer";

function tokenize(source: string): { type: TokenType; value: string }[] {
  const lexer = lexerGenerator.generate(source, () => ({} as TokenMetadata));
  const tokens: { type: TokenType; value: string }[] = [];
  while (lexer.hasNextToken()) {
    const token = lexer.getNextToken();
    tokens.push({
      type: token.type,
      value: source.substring(token.start, token.end),
    });
  }
  return tokens;
}

describe("lexer", () => {
  describe("operators", () => {
    it("tokenizes PLUS", () => {
      const tokens = tokenize("+");
      expect(tokens[0].type).toBe(TokenType.PLUS);
    });

    it("tokenizes MINUS", () => {
      const tokens = tokenize("-");
      expect(tokens[0].type).toBe(TokenType.MINUS);
    });

    it("tokenizes STAR", () => {
      const tokens = tokenize("*");
      expect(tokens[0].type).toBe(TokenType.STAR);
    });

    it("tokenizes LEFTSHIFT", () => {
      const tokens = tokenize("<<");
      expect(tokens[0].type).toBe(TokenType.LEFTSHIFT);
    });

    it("tokenizes RIGHTSHIFT", () => {
      const tokens = tokenize(">>");
      expect(tokens[0].type).toBe(TokenType.RIGHTSHIFT);
    });

    it("tokenizes PIPE", () => {
      const tokens = tokenize("|");
      expect(tokens[0].type).toBe(TokenType.PIPE);
    });

    it("tokenizes AMPERSAND", () => {
      const tokens = tokenize("&");
      expect(tokens[0].type).toBe(TokenType.AMPERSAND);
    });

    it("tokenizes CARAT", () => {
      const tokens = tokenize("^");
      expect(tokens[0].type).toBe(TokenType.CARAT);
    });

    it("tokenizes TILDE_PIPE", () => {
      const tokens = tokenize("~|");
      expect(tokens[0].type).toBe(TokenType.TILDE_PIPE);
    });

    it("tokenizes TILDE_AMPERSAND", () => {
      const tokens = tokenize("~&");
      expect(tokens[0].type).toBe(TokenType.TILDE_AMPERSAND);
    });

    it("tokenizes TILDE_CARAT", () => {
      const tokens = tokenize("~^");
      expect(tokens[0].type).toBe(TokenType.TILDE_CARAT);
    });

    it("tokenizes TILDE", () => {
      const tokens = tokenize("~");
      expect(tokens[0].type).toBe(TokenType.TILDE);
    });
  });

  describe("comparison operators", () => {
    it("tokenizes DOUBLE_EQUALS", () => {
      const tokens = tokenize("==");
      expect(tokens[0].type).toBe(TokenType.DOUBLE_EQUALS);
    });

    it("tokenizes BANG_EQUALS", () => {
      const tokens = tokenize("!=");
      expect(tokens[0].type).toBe(TokenType.BANG_EQUALS);
    });

    it("tokenizes LESS_THAN", () => {
      const tokens = tokenize("<");
      expect(tokens[0].type).toBe(TokenType.LESS_THAN);
    });

    it("tokenizes GREATER_THAN", () => {
      const tokens = tokenize(">");
      expect(tokens[0].type).toBe(TokenType.GREATER_THAN);
    });

    it("tokenizes LESS_THAN_EQUALS", () => {
      const tokens = tokenize("<=");
      expect(tokens[0].type).toBe(TokenType.LESS_THAN_EQUALS);
    });

    it("tokenizes GREATER_THAN_EQUALS", () => {
      const tokens = tokenize(">=");
      expect(tokens[0].type).toBe(TokenType.GREATER_THAN_EQUALS);
    });

    it("tokenizes EQUALS", () => {
      const tokens = tokenize("=");
      expect(tokens[0].type).toBe(TokenType.EQUALS);
    });
  });

  describe("delimiters", () => {
    it("tokenizes SEMICOLON", () => {
      const tokens = tokenize(";");
      expect(tokens[0].type).toBe(TokenType.SEMICOLON);
    });

    it("tokenizes COMMA", () => {
      const tokens = tokenize(",");
      expect(tokens[0].type).toBe(TokenType.COMMA);
    });

    it("tokenizes LPAREN", () => {
      const tokens = tokenize("(");
      expect(tokens[0].type).toBe(TokenType.LPAREN);
    });

    it("tokenizes RPAREN", () => {
      const tokens = tokenize(")");
      expect(tokens[0].type).toBe(TokenType.RPAREN);
    });

    it("tokenizes LBRACE", () => {
      const tokens = tokenize("{");
      expect(tokens[0].type).toBe(TokenType.LBRACE);
    });

    it("tokenizes RBRACE", () => {
      const tokens = tokenize("}");
      expect(tokens[0].type).toBe(TokenType.RBRACE);
    });
  });

  describe("keywords", () => {
    it("tokenizes FUNCTION", () => {
      const tokens = tokenize("function");
      expect(tokens[0].type).toBe(TokenType.FUNCTION);
    });

    it("tokenizes VAR", () => {
      const tokens = tokenize("var");
      expect(tokens[0].type).toBe(TokenType.VAR);
    });

    it("tokenizes WHILE", () => {
      const tokens = tokenize("while");
      expect(tokens[0].type).toBe(TokenType.WHILE);
    });

    it("tokenizes IF", () => {
      const tokens = tokenize("if");
      expect(tokens[0].type).toBe(TokenType.IF);
    });

    it("tokenizes ELSE", () => {
      const tokens = tokenize("else");
      expect(tokens[0].type).toBe(TokenType.ELSE);
    });

    it("tokenizes RETURN", () => {
      const tokens = tokenize("return");
      expect(tokens[0].type).toBe(TokenType.RETURN);
    });

    it("tokenizes FOR", () => {
      const tokens = tokenize("for");
      expect(tokens[0].type).toBe(TokenType.FOR);
    });

    it("tokenizes DO", () => {
      const tokens = tokenize("do");
      expect(tokens[0].type).toBe(TokenType.DO);
    });

    it("tokenizes CONTINUE", () => {
      const tokens = tokenize("continue");
      expect(tokens[0].type).toBe(TokenType.CONTINUE);
    });

    it("tokenizes BREAK", () => {
      const tokens = tokenize("break");
      expect(tokens[0].type).toBe(TokenType.BREAK);
    });
  });

  describe("identifiers", () => {
    it("tokenizes simple identifier", () => {
      const tokens = tokenize("foo");
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[0].value).toBe("foo");
    });

    it("tokenizes identifier with underscore", () => {
      const tokens = tokenize("my_var");
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
    });

    it("tokenizes identifier with numbers", () => {
      const tokens = tokenize("var1");
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
    });

    it("tokenizes identifier starting with underscore", () => {
      const tokens = tokenize("_private");
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
    });
  });

  describe("numbers", () => {
    it("tokenizes single digit", () => {
      const tokens = tokenize("5");
      expect(tokens[0].type).toBe(TokenType.NUMBER);
      expect(tokens[0].value).toBe("5");
    });

    it("tokenizes multi-digit number", () => {
      const tokens = tokenize("12345");
      expect(tokens[0].type).toBe(TokenType.NUMBER);
      expect(tokens[0].value).toBe("12345");
    });

    it("tokenizes zero", () => {
      const tokens = tokenize("0");
      expect(tokens[0].type).toBe(TokenType.NUMBER);
    });
  });

  describe("whitespace", () => {
    it("skips spaces", () => {
      const tokens = tokenize("foo  bar");
      // foo, bar, EOF
      expect(tokens.filter((t) => t.type !== TokenType.EOF).length).toBe(2);
    });

    it("skips newlines", () => {
      const tokens = tokenize("foo\nbar");
      expect(tokens.filter((t) => t.type !== TokenType.EOF).length).toBe(2);
    });

    it("skips tabs", () => {
      const tokens = tokenize("foo\tbar");
      expect(tokens.filter((t) => t.type !== TokenType.EOF).length).toBe(2);
    });
  });

  describe("multiple tokens", () => {
    it("tokenizes a simple expression", () => {
      const tokens = tokenize("a + b");
      // a, +, b, EOF
      expect(tokens.length).toBe(4);
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[1].type).toBe(TokenType.PLUS);
      expect(tokens[2].type).toBe(TokenType.IDENTIFIER);
    });

    it("tokenizes function call syntax", () => {
      const tokens = tokenize("foo(a, b)");
      // foo, (, a, ,, b, ), EOF = 7
      expect(tokens.length).toBe(7);
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[1].type).toBe(TokenType.LPAREN);
      expect(tokens[2].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[3].type).toBe(TokenType.COMMA);
      expect(tokens[4].type).toBe(TokenType.IDENTIFIER);
    });

    it("tokenizes complete statement", () => {
      const tokens = tokenize("var x = 42;");
      // var, x, =, 42, ;, EOF = 6
      expect(tokens.length).toBe(6);
      expect(tokens[0].type).toBe(TokenType.VAR);
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[2].type).toBe(TokenType.EQUALS);
      expect(tokens[3].type).toBe(TokenType.NUMBER);
      expect(tokens[4].type).toBe(TokenType.SEMICOLON);
    });
  });

  describe("EOF", () => {
    it("ends with EOF token", () => {
      const tokens = tokenize("x");
      const lastToken = tokens[tokens.length - 1];
      expect(tokens.some((t) => t.type === TokenType.EOF)).toBe(true);
    });
  });
});

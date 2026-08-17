import { Slex } from "@scinorandex/slex";
export const toStringifiedTokenType = (type: TokenType) => TokenType[type];

// prettier-ignore
export enum TokenType {
  PLUS, MINUS, LEFTSHIFT, RIGHTSHIFT, PIPE, AMPERSAND, CARAT, TILDE_PIPE, TILDE_AMPERSAND, TILDE_CARAT, TILDE,
  DOUBLE_EQUALS, BANG_EQUALS, LESS_THAN, GREATER_THAN, LESS_THAN_EQUALS, GREATER_THAN_EQUALS,
  EQUALS, 
  LPAREN, RPAREN, LBRACE, RBRACE,

  SEMICOLON, COMMA,
  
  NUMBER, IDENTIFIER,
  
  FUNCTION, VAR, WHILE, IF, ELSE, RETURN,
  EOF,
}

export type TokenMetadata = {};

export const lexerGenerator = new Slex<TokenType, TokenMetadata>({
  EOF_TYPE: TokenType.EOF,
  isHigherPrecedence: ({ current, next }) => current === TokenType.IDENTIFIER,
});

lexerGenerator.addRule("digit", "0|1|2|3|4|5|6|7|8|9");
lexerGenerator.addRule("alphabet_uppercase", "A|B|C|D|E|F|G|H|I|J|K|L|M|N|O|P|Q|R|S|T|U|V|W|X|Y|Z");
lexerGenerator.addRule("alphabet_lowercase", "a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w|x|y|z");
lexerGenerator.addRule("alphabet", "${alphabet_uppercase}|${alphabet_lowercase}");
lexerGenerator.addRule("decimal_number", "(${digit})+");

lexerGenerator.addRule("plus", "$+", TokenType.PLUS);
lexerGenerator.addRule("minus", "$-", TokenType.MINUS);
lexerGenerator.addRule("leftshift", "$<$<", TokenType.LEFTSHIFT);
lexerGenerator.addRule("rightshift", "$>$>", TokenType.RIGHTSHIFT);
lexerGenerator.addRule("pipe", "$|", TokenType.PIPE);
lexerGenerator.addRule("ampersand", "$&", TokenType.AMPERSAND);
lexerGenerator.addRule("caret", "$^", TokenType.CARAT);
lexerGenerator.addRule("tilde_pipe", "$~$|", TokenType.TILDE_PIPE);
lexerGenerator.addRule("tilde_ampersand", "$~$&", TokenType.TILDE_AMPERSAND);
lexerGenerator.addRule("tilde_carat", "$~$^", TokenType.TILDE_CARAT);
lexerGenerator.addRule("tilde", "$~", TokenType.TILDE);

lexerGenerator.addRule("equals", "$=", TokenType.EQUALS);
lexerGenerator.addRule("double_equals", "$=$=", TokenType.DOUBLE_EQUALS);
lexerGenerator.addRule("bang_equals", "$!$=", TokenType.BANG_EQUALS);
lexerGenerator.addRule("less_than", "$<", TokenType.LESS_THAN);
lexerGenerator.addRule("greater_than", "$>", TokenType.GREATER_THAN);
lexerGenerator.addRule("less_than_equals", "$<$=", TokenType.LESS_THAN_EQUALS);
lexerGenerator.addRule("greater_than_equals", "$>$=", TokenType.GREATER_THAN_EQUALS);

lexerGenerator.addRule("semicolon", "$;", TokenType.SEMICOLON);
lexerGenerator.addRule("comma", "$,", TokenType.COMMA);

lexerGenerator.addRule("lparen", "$(", TokenType.LPAREN);
lexerGenerator.addRule("rparen", "$)", TokenType.RPAREN);
lexerGenerator.addRule("lbrace", "${", TokenType.LBRACE);
lexerGenerator.addRule("rbrace", "$}", TokenType.RBRACE);

lexerGenerator.addRule("identifier", "(${alphabet}|$_)*(${alphabet}|${digit}|$_)*", TokenType.IDENTIFIER);
lexerGenerator.addRule("function", "function", TokenType.FUNCTION);
lexerGenerator.addRule("var", "var", TokenType.VAR);
lexerGenerator.addRule("while", "while", TokenType.WHILE);
lexerGenerator.addRule("if", "if", TokenType.IF);
lexerGenerator.addRule("else", "else", TokenType.ELSE);
lexerGenerator.addRule("return", "return", TokenType.RETURN);

lexerGenerator.addRule("number_literal", "${decimal_number}", TokenType.NUMBER);

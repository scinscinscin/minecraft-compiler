export enum TokenType {
  STRING,
  FLAG,
}

export interface Token {
  lexeme: string;
  type: TokenType;
}

export function tokenize(inputs: string[]) {
  const tokens: Token[] = [];

  nextWord: for (const _input of inputs) {
    const input = _input.trim();
    let currentCharacterIndex = 0;

    // if it has spaces then quotes must have been used in the string somewhere
    const hasSpaces = input.includes(" ");
    const isFlag = input.startsWith("-");

    if (isFlag) {
      // detect the name of the flag
      let flag = "";

      // we're going to parse until either we hit the end of a equals
      while (currentCharacterIndex < input.length) {
        const currentCharacter = input[currentCharacterIndex++];

        if (currentCharacter === "=") break;
        else flag += currentCharacter;
      }

      tokens.push({ lexeme: flag, type: TokenType.FLAG });
    }

    if (currentCharacterIndex != input.length) {
      let lexeme = "";
      while (currentCharacterIndex < input.length) lexeme += input[currentCharacterIndex++];
      tokens.push({ lexeme, type: TokenType.STRING });
    }
  }

  return tokens;
}

type OptionType = "boolean" | "string" | "number";
type ArgumentType = "string" | "number";

// multi defaults to false and type defaults to string, optional defaults to false
type Option = {
  aliases: string[];
  description: string;
  type?: OptionType;
  multi?: boolean;
  optional?: boolean;
  min?: number;
  max?: number;
  default?: string | number | boolean;
};
type Arguments = { name: string; description: string; type?: ArgumentType; min?: number; max?: number };

interface CommandOptions {
  name: string;
  description: string;
  stub?: boolean; // if true then the command will print its help information if no handler is provided
  arguments?: Arguments;
  options?: { [key: string]: Option };
}

// prettier-ignore
type GetBaseType<T extends "boolean" | "string" | "number" | undefined> = 
  T extends "boolean" ? boolean
    : T extends "number" ? number
      : string;

// prettier-ignore
type HandleOption<T> = T extends Option 
  ? (T["multi"] extends true 
    ? GetBaseType<T["type"]>[] 
      : T["optional"] extends true ? (GetBaseType<T["type"]> | undefined) : GetBaseType<T["type"]> )
  : never;

export type GetOptionsT<W> = W extends Command<infer Args, infer Options> ? Options : never;
export type GetArgumentsT<W> = W extends Command<infer Args, infer Options> ? Args : never;

type SubCommand<T extends CommandOptions> = Command<
  T["arguments"] extends { type: infer K } ? GetBaseType<T["arguments"]["type"]>[] : never,
  { [key in keyof T["options"]]: HandleOption<T["options"][key]> }
>;

export class Command<Args, Options> {
  options: CommandOptions & { version?: string };
  handler: ((args: Args, options: Options) => any) | null = null;
  children: SubCommand<any>[] = [];
  commandChain: string[] = [];

  constructor(options: CommandOptions & { version?: string }, parent: string[] = []) {
    this.options = options;
    this.commandChain = [...parent, options.name];
  }

  setHandler(fn: (args: Args, options: Options) => any): Command<Args, Options> {
    this.handler = fn;
    return this;
  }

  subcommand<T extends CommandOptions>(stats: T): SubCommand<T> {
    const sub = new Command(stats, this.commandChain) as SubCommand<T>;
    // @ts-ignore, covariance is not working here
    this.children.push(sub);
    return sub;
  }

  private find(rest: string[], taken: string[] = []): { taken: string[]; command: Command<any, any> } {
    if (rest.length !== 0) {
      const [next, ..._rest] = rest;
      const subcommand = this.children.find((e) => e.options.name === next);
      if (subcommand) return subcommand.find(_rest, [...taken, next]);
    }

    return { taken, command: this };
  }

  private getOptionByFlag(str: string) {
    const optionsConfig = this.options.options;
    if (optionsConfig === undefined) return null;

    for (const key in optionsConfig) {
      const details = optionsConfig[key];
      if (details.aliases.includes(str)) return [key, details] as const;
    }

    return null;
  }

  private buildArgsOpts(parameters: Token[]): { opts: any; args: any } {
    const optionsConfig = this.options.options;
    const argumentsConfig = this.options.arguments;
    if (optionsConfig === undefined && argumentsConfig === undefined) return { opts: {}, args: [] };

    const rawArguments = [] as (string | number)[];
    const rawOpts = {} as any;

    let currentParameterIndex = 0;
    const hasNextParameter = () => currentParameterIndex < parameters.length;
    const getNextParameter = () => {
      if (hasNextParameter()) return parameters[currentParameterIndex++];
      else throw new Error("No next parameter");
    };

    nextParameter: while (hasNextParameter()) {
      const parameter = getNextParameter();
      if (parameter.type === TokenType.STRING) {
        if (argumentsConfig === undefined) continue nextParameter;

        const { type = "string" } = argumentsConfig;
        const value = type === "string" ? parameter.lexeme : parseFloat(parameter.lexeme);
        if (type === "number" && typeof value === "number" && isNaN(value))
          throw new Error(`Expected a number but got ${parameter.lexeme}`);
        rawArguments.push(value);
        continue nextParameter;
      }

      // Try to find a candidate for the flag, if non found then skip and go to the next parameter
      const optionCandidate = this.getOptionByFlag(parameter.lexeme);
      if (optionCandidate == null) continue nextParameter;

      const [optionName, optionDetails] = optionCandidate;
      if (optionDetails.type === "boolean") {
        rawOpts[optionName] = true;
        continue nextParameter;
      } else {
        // its either a string or number, which is the next token in the list
        if (!hasNextParameter()) throw new Error(`Option ${parameter.lexeme} requires a value`);

        const nextParameter = getNextParameter();
        if (nextParameter.type === TokenType.FLAG) throw new Error(`Option ${parameter.lexeme} requires a value`);

        // Create the value based on the tppe and if multiple can exist
        const { multi = false, type = "string" } = optionDetails;
        const value = type === "string" ? nextParameter.lexeme : parseFloat(nextParameter.lexeme);
        if (type === "number" && typeof value === "number" && isNaN(value))
          throw new Error(`Option ${parameter.lexeme} expected a number but got ${nextParameter.lexeme}`);

        if (multi === false) rawOpts[optionName] = value;
        else rawOpts[optionName] = rawOpts[optionName] ? [...(rawOpts[optionName] as string[]), value] : [value];
      }
    }

    // Validate the options and make sure that everything is filled
    if (argumentsConfig !== undefined) {
      const { min, max, type = "string" } = argumentsConfig;

      if (min && rawArguments.length < min)
        throw new Error(`Expected at least ${min} arguments but got ${rawArguments.length}`);
      if (max && rawArguments.length > max)
        throw new Error(`Expected at most ${max} arguments but got ${rawArguments.length}`);
      if (type === "number" && rawArguments.some((e) => typeof e !== "number"))
        throw new Error(`Expected all numerical arguments but got string`);
      else if (type === "string" && rawArguments.some((e) => typeof e !== "string"))
        throw new Error(`Expected all string arguments but got number`);
    }

    if (optionsConfig !== undefined) {
      for (const key in optionsConfig) {
        const {
          multi = false,
          type = "string",
          optional = false,
          aliases,
          min,
          max,
          default: defaultValue,
        } = optionsConfig[key];
        let value = rawOpts[key];
        if (value === undefined && defaultValue !== undefined) value = defaultValue;
        rawOpts[key] = value;
        const variants = aliases.join(", ");

        if (value == undefined && optional == false)
          throw new Error(`Option ${key} is required. Provide using ${variants}`);

        if (type === "number" && value !== undefined) {
          const values = Array.isArray(value) ? value : [value];
          for (const v of values) {
            if (min !== undefined && v < min)
              throw new Error(`Option ${variants} must be at least ${min} but got ${v}`);
            if (max !== undefined && v > max) throw new Error(`Option ${variants} must be at most ${max} but got ${v}`);
          }
        }
      }
    }

    return { args: rawArguments, opts: rawOpts };
  }

  buildHelp() {
    const { options, arguments: args, description, version } = this.options;
    const usage = `Usage: ${this.commandChain.join(" ")}${options == undefined ? "" : " [options]"}${args == undefined ? "" : ` <${args.type ?? "string"}(s)>`}`;

    const buffer = [usage, description];

    if (args !== undefined) {
      const optional = args.min == null || args.min === 0 ? " (optional)" : "";
      buffer.push(`Arguments:\n    ${args.name} - ${args.description}${optional}`);
    }

    if (this.children.length > 0) {
      let subcommands = "Subcommands:\n";
      subcommands += this.children.map((e) => `    ${e.options.name} - ${e.options.description}`).join("\n");

      buffer.push(subcommands);
    }

    if (options !== undefined) {
      let optionsUsage = "Options:\n";
      optionsUsage += Object.values(options)
        .map((o) => {
          const { aliases, description, optional, type = "string", multi } = o;
          const [firstAlias, ...rest] = aliases;
          const variants = [type !== "boolean" ? `${firstAlias}=<${type}>` : firstAlias, ...rest].join(", ");

          let n2k = [optional ? "(optional)" : "", multi ? "(multi)" : ""].filter((e) => e.length > 0).join(" ");
          return `    ${variants} - ${description}` + n2k;
        })
        .join("\n");
      buffer.push(optionsUsage);
    }

    return buffer.filter((e) => e != undefined).join("\n\n");
  }

  private async run(parameters: { args: any; opts: any }) {
    if (this.handler === null)
      if (this.options.stub != true) throw new Error(`No handler defined for command ${this.options.name}`);
      else console.log(this.buildHelp());
    else await this.handler(parameters.args, parameters.opts);
  }

  async execute(_args: string[]) {
    // Scan for tokens and determine maximal command path
    const tokens = tokenize(_args.filter((e) => e.length > 0));

    const commandPath = [] as Token[];
    for (const token of tokens) {
      if (token.type === TokenType.FLAG) break;
      else commandPath.push(token);
    }

    // Find the command, and the path taken, filter to get the parameters, then execute
    const { taken, command } = this.find(commandPath.map((e) => e.lexeme));
    const parameters = tokens.filter((e, i) => i >= taken.length);

    if (parameters.some((e) => e.type === TokenType.FLAG && e.lexeme === "--help")) {
      console.log(command.buildHelp());
      process.exit(0);
    }

    await command.run(command.buildArgsOpts(parameters));
  }
}

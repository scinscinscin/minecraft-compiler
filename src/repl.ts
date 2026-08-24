import readline from "node:readline";
import { Runner } from "./vm";

export class Logger {
  log(message: string) {
    console.log(message);
  }
}

export function start_repl(runner: Runner) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  const logger = new Logger();

  let is_running = false;
  async function execute(_line: string) {
    const line = _line.trim();

    if (is_running) {
      if (line === "") runner.tick(logger);
      else if (line === "dump r") runner.dump_registers(logger);
      else if (line === "end") {
        is_running = false;
        console.log("Terminating debugger");
      } else {
        const parsed = parseInt(line);
        if (!Number.isNaN(parsed)) {
          for (let i = 0; i < parsed && !runner.environment.halted; i++) runner.tick(logger);
        }
      }
    } else {
      if (line === "start") {
        console.log(`Starting step by step execution. Hit "enter" to clock. Type "end" to stop.`);
        is_running = true;
      } else if (line === "") {
        console.log("Outside of step by step execution.");
      }
    }
  }

  console.log(`Minecraft Language Emulator, type "start" to begin`);
  rl.on("line", (line) => execute(line.trim()).then(() => rl.prompt()));
  rl.prompt();
}

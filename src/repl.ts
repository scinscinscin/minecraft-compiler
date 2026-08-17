import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

let is_running = false;
async function execute(line: string) {
  if (is_running) {
    if (line.trim() === "") console.log("Executing...");
    else if (line.trim() === "end") {
      is_running = false;
      console.log("Finished execution");
    }
  }

  if (line === "start") {
    console.log("Starting step by step execution. Hit enter to clock. Type end to stop.");
    is_running = true;
  }
}

rl.on("line", async (line) => {
  await execute(line.trim()).then(() => rl.prompt());
});

console.log("Minecraft Language Emulator, type start to begin");
rl.prompt();

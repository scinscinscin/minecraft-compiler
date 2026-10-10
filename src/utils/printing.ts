import { BasicBlock } from "../intermediate";

/**
 * Debug helper that dumps the instructions of every basic block to stdout,
 * one array per block. Intended for manual inspection of the CFG while
 * developing passes; nothing in the compilation pipeline calls it.
 */
export function pretty_print(blocks: BasicBlock[]) {
  console.log("================================");
  for (const b of blocks) {
    console.log(b.instructions.map((i) => i.to_stringified()));
  }
}

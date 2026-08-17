import { AbsoluteBytecode, AbsoluteJump, IntermediateBytecode } from "./bytecode";

export class BytecodeGenerationContext {
  bytecode = [] as AbsoluteBytecode[];
  emit(bytecode: AbsoluteBytecode) {
    this.bytecode.push(bytecode);
  }

  // maps a goto label to a list of jmps that are waiting for absolute code point
  queue: { [goto_label: string]: AbsoluteJump[] } = {};
  add_to_queue(label: string, jump: AbsoluteJump) {
    if (this.queue[label] == null) this.queue[label] = [];
    this.queue[label].push(jump);
  }

  function_entry_points: string[] = [];
  set_label_location(label: string, is_entry_point: boolean) {
    if (is_entry_point) this.function_entry_points.push(label);

    const location = this.bytecode.length;
    this.goto_label_locations[label] = location;

    // check if there is anything in the queue that needs to be rewritten
    if (this.queue[label] == null) return;
    for (const jmp of this.queue[label]) {
      jmp.setLocation(location);
      delete this.queue[label];
    }
  }

  goto_label_locations: { [goto_label: string]: number } = {};
  get_label_location(label: string): number | null {
    return this.goto_label_locations[label] ?? null;
  }

  clear_labels() {
    for (const label of this.function_entry_points) {
      // don't nuke functions
      if (this.function_entry_points.includes(label)) continue;

      delete this.goto_label_locations[label];
      delete this.queue[label];
    }
  }
}

export type RelocatableUnit = [string, IntermediateBytecode[]];
export const link = (relocatable_units: RelocatableUnit[]): AbsoluteBytecode[] => {
  const context = new BytecodeGenerationContext();

  for (const [name, relocatable_unit] of relocatable_units) {
    context.clear_labels();
    for (const intermediate of relocatable_unit) intermediate.to_bytecode(context);
  }

  return context.bytecode;
};

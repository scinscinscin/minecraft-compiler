import fs from "fs";
import path from "path";

export type Fixture = {
  name: string;
  source: string;
  expected: number;
  notes: string;
};

// Reads one of the shipped example programs so the tests exercise the real samples.
function example_file(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), "examples", name), "utf8");
}

export const FIXTURES: Fixture[] = [
  {
    name: "examples/scratch.txt",
    source: example_file("scratch.txt"),
    expected: 90,
    notes: "constant-false if (const-prop + dead-jump), duplicated a+b (CSE), copy, unused() still called",
  },
  {
    name: "examples/fib.txt",
    source: example_file("fib.txt"),
    expected: 8,
    notes: "while loop, repeated n1+n2 (CSE), copies",
  },
  {
    name: "examples/source.txt",
    source: example_file("source.txt"),
    expected: 2,
    notes: "simple while loop counter",
  },
  {
    name: "peephole arithmetic identities",
    source: `
function main(): int {
  var a: int = 5;
  var b: int = a + 0;
  var c: int = b - 0;
  var d: int = c | 0;
  var e: int = d & 65535;
  var total: int = a + b + c + d + e;
  return total;
}
`,
    expected: 25,
    notes: "exercises x+0, x-0, x|0, x&0xffff peephole identities",
  },
  {
    name: "copy propagation chain",
    source: `
function main(): int {
  var a: int = 5;
  var b: int = a;
  var c: int = b;
  var d: int = c;
  var e: int = d + 3;
  return e;
}
`,
    expected: 8,
    notes: "long copy chain a->b->c->d",
  },
  {
    name: "dead code with preserved call",
    source: `
function main(): int {
  var a: int = 10;
  var junk1: int = a + 1;
  var junk2: int = junk1 + 5;
  var result: int = helper();
  return a;
}
function helper(): int {
  return 99;
}
`,
    expected: 10,
    notes: "junk1/junk2 are dead (removed by DCE) but the helper() call must be preserved",
  },
  {
    name: "constant if/else branch",
    source: `
function main(): int {
  var flag: int = 1;
  var result: int = 0;
  if (flag) {
    result = 42;
  } else {
    result = 7;
  }
  return result;
}
`,
    expected: 42,
    notes: "constant condition (flag=1) folds; dead-jump eliminates the else block",
  },
  {
    name: "register pressure (forces spills)",
    source: `
function main(): int {
  var a: int = 1;
  var b: int = 2;
  var c: int = 3;
  var d: int = 4;
  var e: int = 5;
  var f: int = 6;
  var g: int = 7;
  var h: int = 8;
  return a + b + c + d + e + f + g + h;
}
`,
    expected: 36,
    notes: "8 live values with only 7 GPRs -> exercises the register spill path",
  },
  {
    name: "nested function calls",
    source: `
function main(): int {
  var x: int = add(2, 3);
  var y: int = add(x, 4);
  return y;
}
function add(a: int, b: int): int {
  return a + b;
}
`,
    expected: 9,
    notes: "call/return plumbing through the return register",
  },
  {
    name: "while loop accumulator",
    source: `
function main(): int {
  var i: int = 0;
  var sum: int = 0;
  while acc (i < 4) {
    sum = sum + i;
    i = i + 1;
  }
  return sum;
}
`,
    expected: 6,
    notes: "loop with a running sum (0+1+2+3)",
  },
];

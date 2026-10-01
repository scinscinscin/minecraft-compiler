import { describe, expect, it } from "vitest";
import { ALL_OPTIMIZATION_PASSES, OptimizationPassName } from "@/optimizer";
import { compile_and_run } from "./helpers";
import { FIXTURES } from "./fixtures";

type Config = {
  label: string;
  enabled_passes: OptimizationPassName[] | "none";
};

// Builds the full optimization config matrix for a fixture:
//   - "none": no optimize() passes at all
//   - "all": every pass enabled
//   - one leave-one-out config per pass (all passes except that one)
//   - one isolation config per pass (only that pass enabled)
function config_matrix(): Config[] {
  const configs: Config[] = [
    { label: "none (no optimize passes)", enabled_passes: "none" },
    { label: "all passes", enabled_passes: [...ALL_OPTIMIZATION_PASSES] },
  ];

  for (const pass of ALL_OPTIMIZATION_PASSES) {
    configs.push({
      label: `leave-one-out: -${pass}`,
      enabled_passes: ALL_OPTIMIZATION_PASSES.filter((p) => p !== pass),
    });
  }

  for (const pass of ALL_OPTIMIZATION_PASSES) {
    configs.push({ label: `isolation: only ${pass}`, enabled_passes: [pass] });
  }

  return configs;
}

// Guarantees the program's runtime output (main's return value) is identical no matter
// which subset of optimizer passes runs, and that the output is the known-correct value.
for (const fixture of FIXTURES) {
  describe(`${fixture.name}  [${fixture.notes}]`, () => {
    const matrix = config_matrix();

    for (const config of matrix) {
      it(`${config.label} => ${fixture.expected}`, async () => {
        const result = await compile_and_run(fixture.source, { enabled_passes: config.enabled_passes });
        expect(result).toBe(fixture.expected);
      });
    }
  });
}

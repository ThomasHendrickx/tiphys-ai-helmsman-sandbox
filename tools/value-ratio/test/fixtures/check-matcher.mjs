#!/usr/bin/env node
/**
 * The glob cases, as a standalone process that exits nonzero on a mismatch.
 *
 * THIS EXISTS BECAUSE `node --test` REFUSES TO NEST. Spawning `node --test`
 * from inside a test file prints "run() is being called recursively within a
 * test file. skipping running files" ON STDERR and EXITS 0, so a witness built
 * that way reports success having run nothing. That is this repository's most
 * familiar failure shape, a guard that cannot go red, arriving from the test
 * harness itself rather than from the code under test.
 *
 * So the cases live here, in one place, and both consumers run them: the
 * ordinary suite imports CASES and asserts over it, and the red witness spawns
 * this file against a mutated module. One source, two readers, no duplication
 * to drift.
 */
import { matchGlob } from "../../value-ratio.mjs";

export const CASES = [
  ["src/**", "src/cli.ts", true, "depth one"],
  ["src/**", "src/commands/doctor.ts", true, "depth two"],
  ["src/**", "src/gates/adapters/http-json.ts", true, "depth three"],
  ["src/**", "src", true, "the directory itself"],
  ["src/**", "test/cli.test.ts", false, "a sibling directory"],
  ["src/**", "vendor/src/cli.ts", false, "not anchored at the root"],
  ["**/test/**", "test/a.js", true, "no leading segment"],
  ["**/test/**", "projects/sitrep/test/a.js", true, "two leading segments"],
  ["**/test/**", "projects/sitrep/src/a.js", false, "no test segment"],
  ["*.md", "README.md", true, "a root markdown file"],
  ["*.md", "delivery/plan/x.md", false, "a single star may not cross a slash"],
  ["**/*.test.js", "projects/sitrep/test/a.test.js", true, "a double star before a suffix"],
  [".github/**", ".github/workflows/gates.yml", true, "a literal leading dot"],
  [".github/**", "xgithub/workflows/gates.yml", false, "the dot is not any-character"],
];

if (process.argv[1] && process.argv[1].endsWith("check-matcher.mjs")) {
  const failures = CASES.filter(([pattern, path, expected]) => matchGlob(pattern, path) !== expected);
  for (const [pattern, path, expected, why] of failures) {
    process.stderr.write(`FAIL ${pattern} vs ${path}: expected ${expected} (${why})\n`);
  }
  process.stdout.write(`${CASES.length - failures.length}/${CASES.length} glob cases hold\n`);
  process.exitCode = failures.length > 0 ? 1 : 0;
}

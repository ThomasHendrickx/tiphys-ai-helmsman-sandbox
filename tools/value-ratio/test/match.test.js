import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classify, matchGlob } from "../value-ratio.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(join(HERE, "..", "value-map.json"), "utf8"));

/**
 * THE DEPTH CASES ARE THE POINT OF THIS FILE.
 *
 * The first matcher this tool shipped matched `src/**` against `src/cli.ts`
 * and NOT against `src/commands/doctor.ts`. Every assertion below at depth one
 * passed against that broken matcher, so a suite made of depth-one cases would
 * have been green and worthless. Each glob is therefore asserted at depth one
 * AND at depth two or more, which is the "one witness is not a class" rule: a
 * guard for a class has to redden under two structurally different members.
 */
test("a directory glob matches at every depth, not just the first", () => {
  assert.equal(matchGlob("src/**", "src/cli.ts"), true, "depth one");
  assert.equal(matchGlob("src/**", "src/commands/doctor.ts"), true, "depth two");
  assert.equal(matchGlob("src/**", "src/gates/adapters/http-json.ts"), true, "depth three");
  assert.equal(matchGlob("src/**", "src"), true, "the directory itself");
  assert.equal(matchGlob("src/**", "test/cli.test.ts"), false, "a sibling directory");
  assert.equal(matchGlob("src/**", "vendor/src/cli.ts"), false, "not anchored at the root");
});

test("a leading ** spans any number of segments including none", () => {
  assert.equal(matchGlob("**/test/**", "test/a.js"), true, "no leading segment");
  assert.equal(matchGlob("**/test/**", "projects/sitrep/test/a.js"), true, "two leading segments");
  assert.equal(matchGlob("**/test/**", "projects/sitrep/src/a.js"), false, "no test segment");
});

test("a single star stays inside one segment", () => {
  assert.equal(matchGlob("*.md", "README.md"), true);
  assert.equal(matchGlob("*.md", "delivery/plan/x.md"), false, "a single star may not cross a slash");
  assert.equal(matchGlob("**/*.test.js", "projects/sitrep/test/a.test.js"), true);
});

test("a dot in a pattern is literal, not any-character", () => {
  assert.equal(matchGlob(".github/**", ".github/workflows/gates.yml"), true);
  assert.equal(matchGlob(".github/**", "xgithub/workflows/gates.yml"), false);
});

test("classification is first match wins and unmatched falls to the default", () => {
  assert.equal(classify(MAP, "src/commands/doctor.ts"), "value");
  assert.equal(classify(MAP, "test/gates.test.ts"), "assurance");
  assert.equal(classify(MAP, "projects/sitrep/src/inventory.js"), "value");
  assert.equal(
    classify(MAP, "projects/sitrep/test/inventory.test.js"),
    "assurance",
    "the assurance rule is listed first so a test inside a value tree stays assurance",
  );
  assert.equal(classify(MAP, "delivery/review/arbitration-m3-p11.md"), "overhead");
  assert.equal(
    classify(MAP, "some/path/nobody/declared.txt"),
    "overhead",
    "an unclaimed path defaults to overhead, never to value",
  );
});

/**
 * THE ORDER OF THE RULES IS THE CONTRACT, so each of the three deliberate
 * orderings gets an assertion that fails if the rules are reordered. Without
 * these the map reads as a tidy list and a later editor sorts it.
 */
test("rule order is load-bearing and each ordering is asserted", () => {
  assert.equal(
    classify(MAP, "AGENTS.md"),
    "value",
    "the named-root-file rule must precede the paperwork rule's *.md",
  );
  assert.equal(
    classify(MAP, "projects/sitrep/delivery/plan.md"),
    "overhead",
    "a subject project's own paperwork is overhead, not the value it delivers",
  );
  assert.equal(
    classify(MAP, "tools/value-ratio/value-ratio.mjs"),
    "assurance",
    "a measurement tool proves value, it is not the value",
  );
  assert.equal(classify(MAP, "CLAUDE.md"), "overhead");
  assert.equal(classify(MAP, "README.md"), "overhead", "a root markdown file is paperwork by default");
});

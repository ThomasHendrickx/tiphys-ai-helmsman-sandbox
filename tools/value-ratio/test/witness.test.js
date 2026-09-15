import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "..", "value-ratio.mjs");
const PRISTINE = join(HERE, "fixtures", "value-ratio.pristine.snapshot");
const SPEC = JSON.parse(readFileSync(join(HERE, "fixtures", "broken-matcher.json"), "utf8"));

/**
 * THE RED WITNESS, RE-RUNNABLE BY A READER.
 *
 * The README used to claim that this suite goes red against the glob matcher
 * that shipped first. That claim was true when it was made and unreachable
 * afterwards, because the buggy matcher existed in no commit: a reader could
 * not re-run it and had to take it on trust. An adversarial reviewer said so.
 *
 * So the dangerous state is committed as DATA, the way the kernel's
 * witness/*.json specs are, and this test applies it, asserts the named tests
 * go red, and restores from a byte snapshot rather than from git. Restoring
 * from git would be the trap CLAUDE.md's standing warning 8 records: a
 * checkout in a tree holding uncommitted work is destructive.
 */
test("the matcher tests redden against the matcher that actually shipped first", () => {
  const pristine = readFileSync(TARGET, "utf8");
  copyFileSync(TARGET, PRISTINE);
  // A REPLACER FUNCTION, NOT A REPLACEMENT STRING, and the reason is the bug
  // this witness exists for. String.prototype.replace expands `$&`, `$\`` and
  // friends inside a replacement STRING, and the text being inserted here is a
  // regex-building expression full of them. The first version of this harness
  // used the string form and silently spliced the matched text into the middle
  // of the mutant, producing a file that still passed. A function's return
  // value is inserted literally, with no second interpretation. That is the
  // same class of defect as the matcher bug below: a later pass that cannot
  // tell authored text from text an earlier pass just emitted.
  const mutated = pristine.replace(SPEC.dangerousState.find, () => SPEC.dangerousState.replaceWith);
  assert.notEqual(mutated, pristine, "the find text must still occur in the file, or the witness is stale");

  try {
    writeFileSync(TARGET, mutated);
    assert.ok(
      readFileSync(TARGET, "utf8").includes("matchGlobDead"),
      "the mutant must be on disk before the suite is spawned",
    );
    const run = spawnSync(process.execPath, [join(HERE, "fixtures", "check-matcher.mjs")], { encoding: "utf8" });
    // A failure here prints what the spawned run actually said. A bare
    // "expected 0 to not equal 0" sends the next reader to reconstruct it by
    // hand, which is the cost this repository keeps paying for terse guards.
    assert.notEqual(
      run.status,
      0,
      `the mutated matcher must fail the suite; spawn exited ${run.status}, stdout begins:\n${(run.stdout || "").slice(0, 400)}\nstderr: ${(run.stderr || "").slice(0, 200)}`,
    );
    for (const fragment of SPEC.expectedRed) {
      assert.match(run.stderr, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${fragment} must be reported failing`);
    }
  } finally {
    writeFileSync(TARGET, pristine);
    rmSync(PRISTINE, { force: true });
  }

  assert.equal(readFileSync(TARGET, "utf8"), pristine, "restored byte for byte");
  const after = spawnSync(process.execPath, [join(HERE, "fixtures", "check-matcher.mjs")], { encoding: "utf8" });
  assert.equal(after.status, 0, "and green again afterwards");
});

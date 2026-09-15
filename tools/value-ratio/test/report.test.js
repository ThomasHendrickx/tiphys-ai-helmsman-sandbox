import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildReport, readSpend } from "../value-ratio.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, "..", "value-ratio.mjs");
const MAP = join(HERE, "..", "value-map.json");

/**
 * A scratch repository with command-scoped identity. CI runners have no git
 * identity, and touching user or global configuration from a test is never
 * acceptable, so every commit carries its own author and committer.
 */
function stageRepo() {
  const root = mkdtempSync(join(tmpdir(), "value-ratio-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Value Ratio Test",
    GIT_AUTHOR_EMAIL: "value-ratio@invalid",
    GIT_COMMITTER_NAME: "Value Ratio Test",
    GIT_COMMITTER_EMAIL: "value-ratio@invalid",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00+00:00",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00+00:00",
  };
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" });
  git("init", "--quiet", "-b", "main");

  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.js"), "a\n".repeat(10));
  git("add", "-A");
  git("commit", "--quiet", "-m", "value only");

  mkdirSync(join(root, "delivery"), { recursive: true });
  writeFileSync(join(root, "delivery", "notes.md"), "n\n".repeat(40));
  git("add", "-A");
  git("commit", "--quiet", "-m", "overhead only");

  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "test", "a.test.js"), "t\n".repeat(5));
  git("add", "-A");
  git("commit", "--quiet", "-m", "assurance only");

  return { root, env };
}

test("buckets are attributed per commit and units are counted once each", () => {
  const { root } = stageRepo();
  try {
    const report = buildReport({ repo: root, range: "", map: MAP, spend: "", budget: null });
    assert.equal(report.units, 3);
    assert.equal(report.lines.value, 10);
    assert.equal(report.lines.overhead, 40);
    assert.equal(report.lines.assurance, 5);
    assert.equal(report.touched.value, 1, "one unit touched a value path");
    assert.equal(report.touched.overhead, 1);
    assert.equal(report.ratio, 4, "40 overhead lines over 10 value lines");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * THE BUDGET PREDICATE IS THE WHOLE POINT, so it is asserted in both
 * directions and in the degenerate case. A gate that cannot go red is worse
 * than no gate, because it is trusted.
 */
test("the budget predicate goes red, goes green, and refuses the empty case", () => {
  const { root } = stageRepo();
  try {
    const at = (budget) => buildReport({ repo: root, range: "", map: MAP, spend: "", budget }).withinBudget;
    assert.equal(at(4), true, "exactly at the budget is within it");
    assert.equal(at(10), true, "comfortably under");
    assert.equal(at(3.9), false, "over by a hair is still over");
    assert.equal(at(null), true, "no budget means reporting only");

    const valueless = buildReport({
      repo: root,
      range: "HEAD~1..HEAD",
      map: MAP,
      spend: "",
      budget: 1000,
    });
    assert.equal(valueless.ratio, null, "a range with no value has no ratio");
    assert.equal(
      valueless.withinBudget,
      false,
      "a range that shipped nothing has not earned a pass, however generous the budget",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exit codes are 0 within budget, 1 over budget, 2 on usage error", () => {
  const { root } = stageRepo();
  const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" }).status;
  try {
    assert.equal(run(["--repo", root, "--map", MAP, "--budget", "10"]), 0);
    assert.equal(run(["--repo", root, "--map", MAP, "--budget", "1"]), 1);
    assert.equal(run(["--repo", root, "--map", MAP]), 0, "no budget reports without gating");
    assert.equal(run(["--repo", root, "--nope"]), 2);
    assert.equal(run(["--repo", root, "--budget", "not-a-number"]), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed ledger row is reported and counted as skipped, never dropped", () => {
  const map = JSON.parse(readFileSync(MAP, "utf8"));
  const path = join(mkdtempSync(join(tmpdir(), "spend-")), "spend.tsv");
  writeFileSync(
    path,
    [
      "phase\tbucket\ttokens\tevidence",
      "p1\tvalue\t100\trun-1",
      "p2\tnot-a-bucket\t50\trun-2",
      "p3\toverhead\tlots\trun-3",
      "p4\toverhead",
      "p5\tvalue\t-5\trun-5",
    ].join("\n"),
  );
  const spend = readSpend(path, map);
  assert.equal(spend.tokens.value, 100);
  assert.equal(spend.counted, 1);
  assert.equal(spend.skipped.length, 4, "every unusable row is reported, so the total is a stated floor");
  assert.match(spend.skipped[0].reason, /unknown bucket/);
  assert.match(spend.skipped[1].reason, /not a non-negative number/);
  assert.match(spend.skipped[2].reason, /expected 4 tab separated cells/);
  assert.match(spend.skipped[3].reason, /not a non-negative number/);
  rmSync(dirname(path), { recursive: true, force: true });
});

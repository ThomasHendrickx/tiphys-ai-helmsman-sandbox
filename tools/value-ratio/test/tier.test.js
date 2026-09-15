import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { impactFloorViolations, selectTier, sizeBucket } from "../assurance-tier.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = join(HERE, "..", "assurance-tier.mjs");
const MAP = join(HERE, "..", "value-map.json");

function repo() {
  const root = mkdtempSync(join(tmpdir(), "tier-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Tier Test",
    GIT_AUTHOR_EMAIL: "tier@invalid",
    GIT_COMMITTER_NAME: "Tier Test",
    GIT_COMMITTER_EMAIL: "tier@invalid",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00+00:00",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00+00:00",
  };
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { env, encoding: "utf8" });
  git("init", "--quiet", "-b", "main");
  // A base commit so that every range below has a real parent. Without it the
  // first commit is a root commit and `<sha>~1` is not a revision, which is a
  // property of the fixture and not of the tool.
  writeFileSync(join(root, "README.md"), "base\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "base");
  // Returns the sha, so ranges are written as `<sha>~1..<sha>` and do not
  // depend on how many commits a test happens to make.
  const commit = (files, message) => {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), body);
    }
    git("add", "-A");
    git("commit", "--quiet", "-m", message);
    return git("rev-parse", "HEAD").trim();
  };
  return { root, commit };
}

const tier = (root, range, impact) => selectTier({ repo: root, range, map: MAP, impact });

test("size is bucketed on value plus assurance, never on overhead", () => {
  assert.deepEqual(sizeBucket({ value: 0, assurance: 0, overhead: 9999 }, 500), { bucket: "zero", subject: 0 });
  assert.deepEqual(sizeBucket({ value: 1, assurance: 0, overhead: 0 }, 500), { bucket: "small", subject: 1 });
  assert.deepEqual(sizeBucket({ value: 250, assurance: 249, overhead: 0 }, 500), { bucket: "small", subject: 499 });
  assert.deepEqual(sizeBucket({ value: 250, assurance: 250, overhead: 0 }, 500), { bucket: "large", subject: 500 });
});

/**
 * THE INVARIANT THIS WHOLE FILE EXISTS FOR.
 *
 * If paperwork counted toward size, a phase could buy itself a heavier review
 * by writing a longer work history, or dodge one by writing a shorter plan.
 * Both are absurd and both would be invisible, so the property is asserted
 * directly: two commits with identical subjects and wildly different overhead
 * select the same tier.
 */
test("overhead volume cannot move the tier in either direction", () => {
  const a = repo();
  a.commit({ "src/a.js": "x\n".repeat(100) }, "lean");
  const b = repo();
  b.commit({ "src/a.js": "x\n".repeat(100), "delivery/plan.md": "p\n".repeat(50000) }, "same code, enormous paperwork");
  try {
    const lean = tier(a.root, "", "low");
    const fat = tier(b.root, "", "low");
    assert.equal(lean.subjectSize, fat.subjectSize, "identical subjects");
    assert.equal(lean.sizeBucket, fat.sizeBucket);
    assert.equal(lean.mode, fat.mode);
    assert.ok(
      fat.overheadLines - lean.overheadLines >= 50000,
      `the overhead is real and is reported: ${lean.overheadLines} against ${fat.overheadLines}`,
    );
    assert.equal(fat.subjectSize, 100, "and is excluded from the size that picks the tier");
  } finally {
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  }
});

test("the two-by-two selects the mode, and paperwork selects none", () => {
  const r = repo();
  const paper = r.commit({ "delivery/plan.md": "p\n".repeat(400) }, "paperwork only");
  const small = r.commit({ "src/small.js": "s\n".repeat(50) }, "small subject");
  const large = r.commit({ "src/big.js": "b\n".repeat(900) }, "large subject");
  const only = (sha) => `${sha}~1..${sha}`;
  try {
    assert.equal(tier(r.root, only(paper), "low").mode, "none", "paperwork needs no reviewer");
    assert.equal(tier(r.root, only(paper), "high").mode, "none", "and no declaration changes that");
    assert.equal(tier(r.root, only(small), "low").mode, "local-only", "small and low is a quick pass");
    assert.equal(tier(r.root, only(small), "high").mode, "full", "small and high buys DEPTH");
    assert.equal(tier(r.root, only(large), "low").mode, "direct-pr", "large and low buys COVERAGE via the gates");
    assert.equal(tier(r.root, only(large), "high").mode, "full", "large and high buys both");
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

/**
 * The floor is asserted under TWO structurally different members, because one
 * witness is not a class: a directory glob and a single-file glob resolve
 * through different branches of the matcher.
 */
test("a declared low impact is refused on a path the map puts a floor under", () => {
  const r = repo();
  const gates = r.commit({ "src/gates/run.js": "g\n".repeat(20) }, "touches a floored directory");
  const lock = r.commit({ "src/lock.ts": "l\n".repeat(20) }, "touches a floored single file");
  const plain = r.commit({ "src/ordinary.js": "o\n".repeat(20) }, "touches nothing floored");
  const only = (sha) => `${sha}~1..${sha}`;
  try {
    const dir = tier(r.root, only(gates), "low");
    assert.equal(dir.refused, true);
    assert.deepEqual(dir.floorViolations, ["src/gates/run.js"], "the refusal names what triggered it");
    assert.equal(dir.mode, null);

    const file = tier(r.root, only(lock), "low");
    assert.equal(file.refused, true, "a single-file floor glob fires too");

    assert.equal(tier(r.root, only(plain), "low").refused, false, "an ordinary path is not floored");
    assert.equal(tier(r.root, only(gates), "high").refused, false, "declaring it high is the way through");
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test("impactFloorViolations returns the offending paths, not a boolean", () => {
  const map = JSON.parse(readFileSync(MAP, "utf8"));
  assert.deepEqual(impactFloorViolations(map, ["src/cli.ts", "README.md"]), []);
  assert.deepEqual(
    impactFloorViolations(map, ["src/cli.ts", "src/exec/env.ts", "src/pool.ts"]),
    ["src/exec/env.ts", "src/pool.ts"],
  );
});

test("exit codes: 0 when a tier is selected, 2 on a floor refusal and on a missing declaration", () => {
  const r = repo();
  const plain = r.commit({ "src/a.js": "a\n" }, "one line");
  const floored = r.commit({ "src/gates/g.js": "g\n" }, "floored");
  const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" }).status;
  try {
    assert.equal(run(["--repo", r.root, "--map", MAP, "--impact", "low", "--range", `${plain}~1..${plain}`]), 0);
    assert.equal(run(["--repo", r.root, "--map", MAP, "--impact", "low", "--range", `${floored}~1..${floored}`]), 2, "floor refusal");
    assert.equal(run(["--repo", r.root, "--map", MAP]), 2, "impact has no default; it must be declared");
    assert.equal(run(["--repo", r.root, "--map", MAP, "--impact", "medium"]), 2, "and only low or high are declarable");
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

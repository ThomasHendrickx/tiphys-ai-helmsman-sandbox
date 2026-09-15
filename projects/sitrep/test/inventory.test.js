import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extensionOf, inventory } from "../src/inventory.js";
import { main, parseArgs, render } from "../bin/sitrep.js";

function stage() {
  const root = mkdtempSync(join(tmpdir(), "sitrep-"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "src", "deep"));
  writeFileSync(join(root, "README.md"), "# readme\n");
  writeFileSync(join(root, ".gitignore"), "node_modules\n");
  writeFileSync(join(root, "src", "a.js"), "export const a = 1;\n");
  writeFileSync(join(root, "src", "deep", "b.js"), "export const b = 2;\n");
  writeFileSync(join(root, "src", "deep", "c.JS"), "export const c = 3;\n");
  writeFileSync(join(root, "node_modules", "ignored.js"), "nope\n");
  return root;
}

test("extensionOf treats a dotfile as having no extension", () => {
  assert.equal(extensionOf("a.js"), ".js");
  assert.equal(extensionOf("c.JS"), ".js", "extensions are compared case-insensitively");
  assert.equal(extensionOf(".gitignore"), "(none)", "a leading dot is a name, not a type");
  assert.equal(extensionOf("Makefile"), "(none)");
  assert.equal(extensionOf("archive.tar.gz"), ".gz", "the last dot wins");
});

test("inventory walks to full depth and skips the named directories", () => {
  const root = stage();
  try {
    const report = inventory(root);
    const js = report.byExtension.find((row) => row.extension === ".js");
    assert.equal(js.count, 3, "two .js at depth two and three, plus one .JS folded in");
    assert.equal(
      report.byExtension.find((row) => row.extension === "(none)").count,
      1,
      ".gitignore counts once under (none)",
    );
    assert.equal(report.totals.files, 5, "node_modules is skipped, so its file is not counted");
    assert.equal(report.unreadable.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * THE SYMLINK CASE IS THE ONE THAT MATTERS.
 *
 * It is written as a cycle on purpose. A walker that follows links recurses
 * forever here and the test does not fail, it HANGS, which is a louder and
 * more honest signal than an assertion about a count. A walker that follows
 * links without a cycle would merely double-count and could be waved through.
 */
test("a symlink is counted and never followed, including a cycle", () => {
  const root = stage();
  try {
    symlinkSync(root, join(root, "src", "loop"));
    const report = inventory(root);
    assert.equal(report.totals.symlinks, 1);
    assert.equal(report.totals.files, 5, "nothing behind the link is counted twice");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the extension table is ordered by count then name, so two runs compare byte for byte", () => {
  const root = stage();
  try {
    const first = inventory(root);
    const second = inventory(root);
    assert.deepEqual(first.byExtension, second.byExtension);
    const counts = first.byExtension.map((row) => row.count);
    assert.deepEqual(counts, [...counts].sort((a, b) => b - a), "descending by count");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--json emits one document on stdout and nothing else", () => {
  const root = stage();
  const chunks = [];
  const errors = [];
  try {
    const code = main(["--json", root], {
      stdout: { write: (s) => chunks.push(s) },
      stderr: { write: (s) => errors.push(s) },
    });
    assert.equal(code, 0);
    assert.equal(errors.length, 0, "nothing on stderr on the happy path");
    const parsed = JSON.parse(chunks.join(""));
    assert.equal(parsed.totals.files, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown option is a usage error on stderr, not a crash", () => {
  const errors = [];
  const code = main(["--nope"], {
    stdout: { write: () => {} },
    stderr: { write: (s) => errors.push(s) },
  });
  assert.equal(code, 2);
  assert.match(errors.join(""), /unexpected option/);
});

test("parseArgs and render are exported so the contract is testable without a subprocess", () => {
  assert.deepEqual(parseArgs(["--skip", "a, b", "root"]), { root: "root", json: false, skip: ["a", "b"] });
  const text = render({ root: "/x", totals: { files: 0, directories: 0, symlinks: 0, other: 0, bytes: 0 }, byExtension: [], unreadable: [] });
  assert.match(text, /\(nothing\)/, "an empty tree says so rather than printing an empty table");
});

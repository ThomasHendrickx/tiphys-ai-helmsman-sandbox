#!/usr/bin/env node
/**
 * sitrep: what is in this tree.
 *
 * Phase 1 of the subject project. It reads a directory and reports an
 * inventory, in a human table or as JSON. Phases 2 to 4 are declared in
 * delivery/plan.md and are deliberately NOT built here: this repository exists
 * so that Tiphys builds them, and a subject with no work left in it measures
 * nothing.
 *
 * THE OUTPUT CONTRACT IS PART OF THE PRODUCT, not a rendering detail. `--json`
 * emits one JSON document on stdout and nothing else, so a caller can pipe it.
 * Diagnostics go to stderr. The exit code is the only thing a script should
 * branch on.
 */

import { resolve } from "node:path";
import { inventory } from "../src/inventory.js";

const EX_USAGE = 2;
const EX_UNREADABLE = 1;

export function parseArgs(argv) {
  const options = { root: ".", json: false, skip: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--skip") {
      if (i + 1 >= argv.length) throw new Error("--skip needs a comma separated list of directory names");
      options.skip = argv[i + 1].split(",").map((name) => name.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`unexpected option ${JSON.stringify(arg)}`);
    options.root = arg;
  }
  return options;
}

export function render(report) {
  const out = [];
  out.push(`root        ${report.root}`);
  out.push(`files       ${report.totals.files}`);
  out.push(`directories ${report.totals.directories}`);
  out.push(`symlinks    ${report.totals.symlinks} (counted, never followed)`);
  if (report.totals.other > 0) out.push(`other       ${report.totals.other} (not a file, directory or symlink)`);
  out.push(`bytes       ${report.totals.bytes}`);
  out.push("");
  out.push("by extension");
  if (report.byExtension.length === 0) {
    out.push("  (nothing)");
  }
  for (const row of report.byExtension) {
    out.push(`  ${row.extension.padEnd(12)}${String(row.count).padStart(6)}`);
  }
  if (report.unreadable.length > 0) {
    out.push("");
    out.push(`${report.unreadable.length} path(s) could not be read, so the counts above are a floor:`);
    for (const entry of report.unreadable) out.push(`  ${entry.path}: ${entry.reason}`);
  }
  return out.join("\n");
}

export function main(argv, streams = process) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    streams.stderr.write(`sitrep: ${error.message}\n`);
    return EX_USAGE;
  }

  const report = inventory(resolve(options.root), options.skip ? { skip: options.skip } : {});
  streams.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);

  // AN UNREADABLE PATH IS A NONZERO EXIT, and this is the one judgement call in
  // the file. The alternative, exiting 0 with a warning, makes a partial
  // inventory indistinguishable from a complete one to every caller that does
  // the right thing and branches on the status. The counts are still printed,
  // so nothing is hidden; what changes is that the caller has to decide.
  return report.unreadable.length > 0 ? EX_UNREADABLE : 0;
}

if (process.argv[1] && process.argv[1].endsWith("sitrep.js")) {
  process.exitCode = main(process.argv.slice(2));
}

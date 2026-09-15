#!/usr/bin/env node
/**
 * value-ratio: how much of what this repository merged was VALUE, and how
 * much was the process talking about itself.
 *
 * WHY THIS EXISTS. Tiphys decision record DR-0027 measured a 24 hour window
 * in which 29 merges reached main and 2 of them touched src/ or bin/, at a
 * cost of roughly 1.66 million subagent tokens spent almost entirely on two
 * files that do not ship. That measurement was done BY HAND, ONCE, AFTER THE
 * FACT, by an owner who noticed. A number nobody can recompute is an anecdote,
 * and an anecdote does not hold a process to anything. This is the same
 * measurement as a command with an exit code.
 *
 * WHAT IT MEASURES, AND WHAT IT HONESTLY DOES NOT.
 *
 *   MEASURED, from git alone, needing no instrumentation and working
 *   retroactively on any existing history: how many lines each bucket
 *   received, and how many merges touched each bucket.
 *
 *   NOT MEASURED without a spend ledger: TOKENS. Lines are a PROXY and a
 *   biased one. A line of review prose and a line of concurrent lock handling
 *   do not cost the same to produce, and the bias runs in the direction that
 *   flatters nobody: prose is voluminous and cheap per line, so a line-based
 *   reading OVERSTATES the overhead share relative to what the tokens really
 *   went on. Say which number you are quoting. Pass --spend to weight by
 *   recorded tokens instead, and the report then says which of the two it used.
 *
 *   NOT MEASURED AT ALL: whether the value that landed was any good. A
 *   repository can score perfectly here by merging bad code with no tests.
 *   This is a budget, not a quality gate, and the assurance bucket exists
 *   precisely so that the budget cannot be met by deleting the tests.
 *
 * WHY ASSURANCE IS A THIRD BUCKET AND IS NEVER GATED. Splitting review and
 * tests out of "overhead" is the whole design. A two bucket version would put
 * the clean room review in the same bucket as the meeting notes about the
 * clean room review, and the cheapest way to pass would then be to review
 * less. The budget constrains OVERHEAD against VALUE and leaves assurance
 * reported but unconstrained.
 *
 * Usage:
 *   node value-ratio.mjs --repo <dir> [--range <rev-range>] [--map <file>]
 *                        [--spend <tsv>] [--budget <n>] [--json]
 *
 *   --repo     repository to measure. Default: the current directory.
 *   --range    git revision range. Default: the whole first-parent history
 *              of the current branch.
 *   --map      classification rules. Default: value-map.json beside this
 *              script, then <repo>/value-map.json if that exists.
 *   --spend    a TSV token ledger (see SPEND LEDGER below). When present the
 *              report carries BOTH the line reading and the token reading.
 *   --budget   the maximum overhead-to-value ratio tolerated. 1.0 means
 *              overhead may not exceed value. Omit to report without gating.
 *   --json     emit the report as JSON instead of a table.
 *
 * Exit codes:
 *   0   measured, and within budget when a budget was given
 *   1   measured, and OVER budget
 *   2   usage error, or git refused
 *
 * SPEND LEDGER. Tokens cannot be recovered from git, so where they are known
 * they are recorded. The format is a tab separated file, one row per unit of
 * dispatched work, with a header row naming the columns:
 *
 *   phase   bucket   tokens   evidence
 *
 * `bucket` is one of the declared bucket names. `evidence` is a pointer (a
 * task id, a run id, a transcript path) and is never prose. Rows are appended,
 * never edited. A malformed row is REPORTED AND COUNTED AS SKIPPED rather than
 * silently dropped, because a ledger that quietly loses rows reports a better
 * ratio than the truth.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EX_USAGE = 2;
const EX_OVER_BUDGET = 1;

/**
 * Match one repository-relative path against one glob.
 *
 * The supported vocabulary is deliberately tiny and is stated rather than
 * implied: `**` spans any number of path segments including none, `*` spans
 * any number of characters WITHIN one segment, and every other character is
 * literal. There is no brace expansion and no character class, because a
 * classification map nobody can read by eye is a classification map nobody
 * audits.
 *
 * BUILT BY SCANNING, NEVER BY CHAINED String.replace, and the reason is a bug
 * this function shipped and then had caught. The first version ran four
 * replaces in sequence: `/**` became `(?:/.*)?`, then a later pass rewrote
 * every remaining `*` into `[^/]*`. That later pass could not tell a `*` the
 * AUTHOR wrote from a `*` an EARLIER PASS had just emitted, so `(?:/.*)?`
 * silently became `(?:/.[^/]*)?`. The result matched `src/cli.ts` and did NOT
 * match `src/commands/doctor.ts`, which is to say it worked at depth one and
 * failed at depth two, which is exactly the shape that looks correct in a
 * spot check. It put 19316 lines of src/ into the overhead bucket and the
 * report read plausibly. A single scan has no second pass to be confused by.
 */
export function matchGlob(pattern, path) {
  let body = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char !== "*") {
      body += /[.+^${}()|[\]\\?]/.test(char) ? `\\${char}` : char;
      continue;
    }
    if (pattern[i + 1] === "*") {
      i += 1;
      if (pattern[i + 1] === "/") {
        // `**/` spans any number of leading segments, including none.
        i += 1;
        body += "(?:[^\\0]*/)?";
      } else if (body.endsWith("/")) {
        // A trailing `dir/**` also matches `dir` itself with nothing under it.
        body = `${body.slice(0, -1)}(?:/[^\\0]*)?`;
      } else {
        body += "[^\\0]*";
      }
      continue;
    }
    body += "[^/]*";
  }
  return new RegExp(`^${body}$`).test(path);
}

/** Classify one path. First matching rule wins; unmatched falls to `default`. */
export function classify(map, path) {
  for (const rule of map.rules) {
    for (const pattern of rule.match) {
      if (matchGlob(pattern, path)) return rule.bucket;
    }
  }
  return map.default;
}

function git(repo, args) {
  const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (result.error) {
    throw new Error(`git ${args.join(" ")} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${result.status}: ${(result.stderr || "").trim()}`,
    );
  }
  return result.stdout;
}

/**
 * Walk the first-parent history and bucket it.
 *
 * FIRST PARENT IS THE DELIVERY UNIT, not an accident of convenience. On a
 * squash-and-merge repository each first-parent commit is one pull request,
 * which is the thing DR-0031 defines as a unit of self-contained value, so
 * "merges touching value" counts pull requests and not the commits inside
 * them. A repository that does not squash gets the same shape for a different
 * reason: the merge commit is still the unit that landed.
 *
 * BINARY FILES ARE COUNTED AS TOUCHES AND NOT AS LINES. git --numstat prints
 * `-` for both counts on a binary path. Treating that as zero lines would let
 * a large binary land invisibly, so the path still registers a touch on its
 * bucket and is reported separately.
 */
export function measure(repo, range, map) {
  const args = ["log", "--first-parent", "--numstat", "--format=%x00%H"];
  if (range) args.push(range);
  const out = git(repo, args);

  const lines = { value: 0, assurance: 0, overhead: 0 };
  const touched = { value: 0, assurance: 0, overhead: 0 };
  const files = { value: 0, assurance: 0, overhead: 0 };
  let units = 0;
  let binaryPaths = 0;
  let current = null;

  const flush = () => {
    if (!current) return;
    if (current.any) {
      units += 1;
      for (const bucket of Object.keys(touched)) {
        if (current.touched[bucket]) touched[bucket] += 1;
      }
    }
    current = null;
  };

  for (const raw of out.split("\n")) {
    if (raw.startsWith("\0")) {
      flush();
      current = { sha: raw.slice(1), any: false, touched: { value: false, assurance: false, overhead: false } };
      continue;
    }
    const row = raw.trim();
    if (row === "" || !current) continue;
    const parts = row.split("\t");
    if (parts.length < 3) continue;
    const [added, deleted, rawPath] = parts;
    // A rename prints `old => new` or a `{a => b}` brace form. The NEW path is
    // what the tree carries afterwards, so classify by that.
    const path = rawPath.includes("=>")
      ? rawPath.replace(/\{([^}]*) => ([^}]*)\}/, "$2").replace(/^.*\s=>\s/, "").trim()
      : rawPath;
    const bucket = classify(map, path);
    current.any = true;
    current.touched[bucket] = true;
    files[bucket] += 1;
    if (added === "-" || deleted === "-") {
      binaryPaths += 1;
      continue;
    }
    lines[bucket] += Number(added) + Number(deleted);
  }
  flush();

  return { lines, touched, files, units, binaryPaths };
}

/**
 * Read a spend ledger. Malformed rows are returned, not discarded: a ledger
 * that silently drops what it cannot parse reports a better ratio than the
 * truth, which is the one failure mode this whole tool exists against.
 */
export function readSpend(path, map) {
  const text = readFileSync(path, "utf8");
  const rows = text.split("\n").filter((line) => line.trim() !== "");
  const tokens = { value: 0, assurance: 0, overhead: 0 };
  const skipped = [];
  let counted = 0;
  const buckets = new Set(Object.keys(map.buckets));

  rows.forEach((line, index) => {
    const cells = line.split("\t");
    if (index === 0 && cells[0] === "phase") return;
    const lineNumber = index + 1;
    if (cells.length < 4) {
      skipped.push({ line: lineNumber, reason: `expected 4 tab separated cells, saw ${cells.length}` });
      return;
    }
    const [, bucket, rawTokens] = cells;
    if (!buckets.has(bucket)) {
      skipped.push({ line: lineNumber, reason: `unknown bucket ${JSON.stringify(bucket)}` });
      return;
    }
    const value = Number(rawTokens);
    if (!Number.isFinite(value) || value < 0) {
      skipped.push({ line: lineNumber, reason: `token count ${JSON.stringify(rawTokens)} is not a non-negative number` });
      return;
    }
    tokens[bucket] += value;
    counted += 1;
  });

  return { tokens, counted, skipped };
}

const pct = (part, total) => (total === 0 ? 0 : (100 * part) / total);

function renderTable(report) {
  const out = [];
  const w = (s, n) => String(s).padStart(n);
  out.push(`repository  ${report.repo}`);
  out.push(`range       ${report.range || "(whole first-parent history)"}`);
  out.push(`units       ${report.units} first-parent commits carrying a change`);
  out.push("");

  const section = (title, counts, note) => {
    const total = counts.value + counts.assurance + counts.overhead;
    out.push(title);
    for (const bucket of ["value", "assurance", "overhead"]) {
      out.push(`  ${bucket.padEnd(10)}${w(counts[bucket], 10)}  ${w(pct(counts[bucket], total).toFixed(1), 5)}%`);
    }
    out.push(`  ${"total".padEnd(10)}${w(total, 10)}`);
    if (note) out.push(`  ${note}`);
    out.push("");
  };

  section("lines changed", report.lines, "PROXY. Prose lines and source lines do not cost the same to produce.");
  section("files changed", report.files);
  out.push("units touching each bucket");
  for (const bucket of ["value", "assurance", "overhead"]) {
    out.push(`  ${bucket.padEnd(10)}${w(report.touched[bucket], 10)}  ${w(pct(report.touched[bucket], report.units).toFixed(1), 5)}% of units`);
  }
  out.push("");

  if (report.tokens) {
    section("tokens recorded", report.tokens, `from ${report.spendPath}, ${report.spendCounted} row(s) counted`);
    if (report.spendSkipped.length > 0) {
      out.push(`  ${report.spendSkipped.length} MALFORMED ROW(S) NOT COUNTED, so the tokens above are a floor:`);
      for (const s of report.spendSkipped) out.push(`    line ${s.line}: ${s.reason}`);
      out.push("");
    }
  } else {
    out.push("tokens      not measured. No --spend ledger was given, so every number");
    out.push("            above is a line or file proxy and none of them is a token count.");
    out.push("");
  }

  if (report.binaryPaths > 0) {
    out.push(`${report.binaryPaths} binary path change(s) counted as touches and not as lines.`);
    out.push("");
  }

  out.push(`overhead-to-value ratio, by ${report.basis}: ${report.ratio === null ? "undefined (no value recorded)" : report.ratio.toFixed(2)}`);
  if (report.budget !== null) {
    out.push(`budget: ${report.budget.toFixed(2)}`);
    out.push(report.withinBudget ? "WITHIN BUDGET" : "OVER BUDGET");
  } else {
    out.push("budget: none given, reporting only");
  }
  return out.join("\n");
}

function parseArgs(argv) {
  const options = { repo: process.cwd(), range: "", map: "", spend: "", budget: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const needsValue = ["--repo", "--range", "--map", "--spend", "--budget"];
    if (needsValue.includes(flag)) {
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      const value = argv[i + 1];
      i += 1;
      if (flag === "--budget") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--budget must be a non-negative number, saw ${JSON.stringify(value)}`);
        options.budget = parsed;
      } else {
        options[flag.slice(2)] = value;
      }
      continue;
    }
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`unexpected argument ${JSON.stringify(flag)}`);
  }
  return options;
}

export function resolveMapPath(options) {
  if (options.map) return resolve(options.map);
  const inRepo = join(resolve(options.repo), "value-map.json");
  if (existsSync(inRepo)) return inRepo;
  return join(HERE, "value-map.json");
}

export function buildReport(options) {
  const repo = resolve(options.repo);
  const mapPath = resolveMapPath(options);
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  const measured = measure(repo, options.range, map);

  let tokens = null;
  let spendCounted = 0;
  let spendSkipped = [];
  if (options.spend) {
    const spend = readSpend(resolve(options.spend), map);
    tokens = spend.tokens;
    spendCounted = spend.counted;
    spendSkipped = spend.skipped;
  }

  const basisCounts = tokens || measured.lines;
  const basis = tokens ? "recorded tokens" : "lines changed";
  const ratio = basisCounts.value === 0 ? null : basisCounts.overhead / basisCounts.value;
  // An undefined ratio (no value at all) is NOT within budget. A range that
  // shipped nothing has not earned a pass, and reporting one would make the
  // emptiest possible history the easiest to satisfy.
  const withinBudget = options.budget === null ? true : ratio !== null && ratio <= options.budget;

  return {
    repo,
    range: options.range,
    mapPath,
    ...measured,
    tokens,
    spendPath: options.spend ? resolve(options.spend) : null,
    spendCounted,
    spendSkipped,
    basis,
    ratio,
    budget: options.budget,
    withinBudget,
  };
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`value-ratio: ${error.message}\n`);
    return EX_USAGE;
  }

  let report;
  try {
    report = buildReport(options);
  } catch (error) {
    process.stderr.write(`value-ratio: ${error.message}\n`);
    return EX_USAGE;
  }

  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderTable(report)}\n`);
  return report.withinBudget ? 0 : EX_OVER_BUDGET;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

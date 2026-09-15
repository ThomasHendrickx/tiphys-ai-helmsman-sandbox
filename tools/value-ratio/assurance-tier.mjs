#!/usr/bin/env node
/**
 * assurance-tier: how much making-sure has this change earned?
 *
 * THE RULE, in one line. SIZE BUYS COVERAGE, IMPACT BUYS DEPTH.
 *
 * Those are different things and conflating them is why a process overreacts.
 * A change with a large surface can break something in a corner nobody looked
 * at, so it needs BREADTH: every changed path walked, the suite, the scope
 * audit. A change that matters can be three lines and still lose money, so it
 * needs DEPTH: an adversarial lens, a second reader on another model family,
 * someone asking what happens when it is wrong. Neither substitutes for the
 * other, which is why the tiers are a two-by-two and not a single dial.
 *
 *              | low impact                  | high impact
 *   -----------+-----------------------------+---------------------------
 *   zero size  | none. It is paperwork.      | (cannot occur: see below)
 *   small      | local-only. A quick pass.   | full. Depth, not breadth.
 *   large      | direct-pr. Gates ARE the    | full. Both contracts, both
 *              | coverage. No adversarial    | lenses. This is the case the
 *              | layer, because there is     | full pipeline was designed
 *              | little to be adversarial    | for and the one where it
 *              | about.                      | pays.
 *
 * THE MODE NAMES ARE NOT NEW. `full`, `direct-pr` and `local-only` are the
 * three modes the Tiphys blueprint already declares and `assurance-modes.yaml`
 * already defines, with a check that recomputes each mode's declared skips
 * against `full` in three directions. Tiphys did not lack assurance tiers. It
 * lacked a rule for PICKING one, so every change got `full` by default and the
 * process spent like the change always mattered. This is only the selector.
 *
 * WHAT THE ZERO TIER IS FOR, and it is not an edge case. Measured over the
 * Tiphys kernel's 50 first-parent units: THIRTY-FOUR have a subject size of
 * zero. They changed no value path and no assurance path. They are plans,
 * reviews, decision records and status updates. Sending those through an
 * adversarial pipeline is the single largest source of the imbalance, and it
 * is also the easiest to stop, because a script can see it.
 *
 * SIZE IS COMPUTED, IMPACT IS DECLARED, AND THE DECLARATION HAS A FLOOR.
 * Size comes from the diff and cannot be argued with. Impact is a judgement,
 * so it is declared BEFORE the work, in the phase declaration, where it cannot
 * be retrofitted to justify a review that was skipped. A declaration nothing
 * can contradict is not a declaration, so `highImpactPaths` in the map is the
 * floor: a change touching one of them may not be called low impact, and this
 * command REFUSES rather than warns.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not measure whether the review
 * that happened was any good, and it never will. It picks the tier. A `full`
 * review done badly and a `full` review done well are the same to this
 * command, and the red-witness rule is what separates them.
 *
 * Usage:
 *   node assurance-tier.mjs --repo <dir> [--range <rev-range>]
 *                           --impact <low|high> [--map <file>] [--json]
 *
 * Exit codes:
 *   0   a tier was selected
 *   2   usage error, git refused, or the declared impact is below its floor
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { matchGlob, measure } from "./value-ratio.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EX_USAGE = 2;

export const TIERS = {
  "zero/low": { mode: "none", why: "no value and no assurance path changed. This is paperwork, and paperwork is checked by the byte and citation gates, not by a reviewer." },
  "zero/high": { mode: "none", why: "no value and no assurance path changed, so there is no subject to review however the impact was declared." },
  "small/low": { mode: "local-only", why: "small surface, low consequence. A quick pass: implement, orchestrator diff review, local fast-forward." },
  "small/high": { mode: "full", why: "small surface, high consequence. Depth rather than breadth: the adversarial lens and a second model family earn their cost here even though the diff is short." },
  "large/low": { mode: "direct-pr", why: "large surface, low consequence. The gates ARE the coverage. No adversarial layer, because there is little to be adversarial about." },
  "large/high": { mode: "full", why: "large surface and high consequence. Both review contracts, both lenses. This is the case the full pipeline was designed for and the one where it pays." },
};

export function sizeBucket(lines, threshold) {
  const subject = lines.value + lines.assurance;
  if (subject === 0) return { bucket: "zero", subject };
  return { bucket: subject < threshold ? "small" : "large", subject };
}

/**
 * Which changed paths force a high-impact declaration.
 *
 * Returns the offending paths rather than a boolean, because a refusal that
 * does not name what triggered it sends the reader to guess, and the commonest
 * next move after an unexplained refusal is to weaken the rule.
 */
export function impactFloorViolations(map, changedPaths) {
  const patterns = map.highImpactPaths?.match ?? [];
  return changedPaths.filter((path) => patterns.some((pattern) => matchGlob(pattern, path)));
}

function parseArgs(argv) {
  const options = { repo: process.cwd(), range: "", map: "", impact: "", json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (!["--repo", "--range", "--map", "--impact"].includes(flag)) {
      throw new Error(`unexpected argument ${JSON.stringify(flag)}`);
    }
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    options[flag.slice(2)] = argv[i + 1];
    i += 1;
  }
  if (!["low", "high"].includes(options.impact)) {
    throw new Error('--impact must be declared as "low" or "high"; it is a judgement and there is no default');
  }
  return options;
}

export function selectTier(options) {
  const repo = resolve(options.repo);
  const mapPath = options.map
    ? resolve(options.map)
    : existsSync(join(repo, "value-map.json"))
      ? join(repo, "value-map.json")
      : join(HERE, "value-map.json");
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  const threshold = map.subjectSizeThreshold ?? 500;

  const measured = measure(repo, options.range, map);
  const { bucket, subject } = sizeBucket(measured.lines, threshold);
  const violations = impactFloorViolations(map, measured.paths ?? []);

  const refused = options.impact === "low" && violations.length > 0;
  const impact = refused ? "low (REFUSED)" : options.impact;
  const key = `${bucket}/${refused ? "high" : options.impact}`;
  const tier = TIERS[key];

  return {
    repo,
    range: options.range,
    mapPath,
    subjectSize: subject,
    threshold,
    overheadLines: measured.lines.overhead,
    sizeBucket: bucket,
    declaredImpact: impact,
    floorViolations: violations,
    refused,
    mode: refused ? null : tier.mode,
    why: tier.why,
  };
}

function render(r) {
  const out = [];
  out.push(`repository    ${r.repo}`);
  out.push(`range         ${r.range || "(whole first-parent history)"}`);
  out.push("");
  out.push(`subject size  ${r.subjectSize} lines (value + assurance), threshold ${r.threshold}`);
  out.push(`              overhead in the same range is ${r.overheadLines} lines and is NOT counted`);
  out.push(`size          ${r.sizeBucket}`);
  out.push(`impact        ${r.declaredImpact} (declared, not computed)`);
  out.push("");
  if (r.refused) {
    out.push("REFUSED: this change was declared low impact and touches paths the map");
    out.push("puts a floor under. Declare it high, or explain in the phase declaration");
    out.push("why the floor is wrong and change the map in the same pull request.");
    for (const path of r.floorViolations) out.push(`  ${path}`);
    return out.join("\n");
  }
  out.push(`ASSURANCE     ${r.mode}`);
  out.push(`              ${r.why}`);
  return out.join("\n");
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`assurance-tier: ${error.message}\n`);
    return EX_USAGE;
  }
  let report;
  try {
    report = selectTier(options);
  } catch (error) {
    process.stderr.write(`assurance-tier: ${error.message}\n`);
    return EX_USAGE;
  }
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
  return report.refused ? EX_USAGE : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

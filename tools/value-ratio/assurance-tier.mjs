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
 * EVERY CHANGE IS REVIEWED. What tiers is the number of FIX ROUNDS, meaning
 * back-and-forths between the clean-room reviewer and the implementer.
 *
 *              | low impact        | high impact
 *   -----------+-------------------+--------------------
 *   zero size  | 1 round           | 1 round
 *   small      | 1 round           | 2 rounds
 *   large      | 2 rounds          | 3 rounds
 *
 * One is the floor, three is the ceiling, and the cap is a cap rather than a
 * target. This is owner decision DR-0035, and it replaces an earlier version
 * of this tool that selected an assurance MODE and could select `none`. That
 * version was wrong in a way worth recording: it would have let a change merge
 * unlooked-at, and it silently narrowed a condition of the DR-0012 grant,
 * which is owner-reserved. Tiering the ROUNDS instead leaves DR-0012's
 * dual-review condition untouched, because the first review still always
 * happens.
 *
 * THE SIZE DISTRIBUTION IS STILL WHY THIS IS WORTH DOING. Measured over the
 * Tiphys kernel's 50 first-parent units: THIRTY-FOUR have a subject size of
 * zero. They changed no value path and no assurance path. They still get a
 * round, and under this rule they get exactly one, where today the process
 * offers them the same machinery it offers a concurrency rewrite.
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

/**
 * THE BUDGET IS A CAP ON FIX ROUNDS. EVERY CHANGE GETS AT LEAST ONE.
 *
 * Owner decision DR-0035: every change is reviewed, and what tiers is the
 * number of back-and-forths between the clean-room reviewer and the
 * implementer. One round is the floor and there is no zero.
 *
 * WHY A CAP RATHER THAN A TARGET, and the number that settles it: a throughput
 * analysis of M1 measured sixteen completed fix rounds, thirteen of which were
 * re-reviewed, and TWELVE OF THOSE THIRTEEN produced a new finding
 * attributable to the round itself. A fix round is a change, and a change
 * needs reviewing, so round N+1 largely exists to check round N. Rounds are
 * not monotonically improving and a budget is not stinginess.
 *
 * WHAT HAPPENS AT THE CAP IS NOT MORE ROUNDS. DR-0016 already decided it: a
 * fresh implementer plus a third review contract, dispatched immediately, with
 * the owner notified asynchronously. The property being protected is that
 * something DIFFERENT happens, and the measured evidence is that the fresh
 * implementer, not the owner decision, is the half that worked.
 *
 * THE CEILING OF THREE IS DERIVED. DR-0012:34 already caps a delegated merge
 * at "more than two fix rounds after its first dual review", so two is the
 * repository's own existing constant and this generalises it rather than
 * inventing a number. Observed: the phases that took one round shipped without
 * incident, and the recorded disasters ran to four, five, six and ten.
 */
export const TIERS = {
  "zero/low": { rounds: 1, why: "no value and no assurance path changed, so there is nothing to iterate on. One round, and if it finds nothing that is the answer." },
  "zero/high": { rounds: 1, why: "no value and no assurance path changed. However the impact was declared there is no subject to iterate on." },
  "small/low": { rounds: 1, why: "small surface, low consequence. One round is the floor and it is also the ceiling here." },
  "small/high": { rounds: 2, why: "small surface, high consequence. The second round exists to check the first round's fix, which is where this repository measured twelve of thirteen new findings coming from." },
  "large/low": { rounds: 2, why: "large surface, low consequence. One round cannot both walk a large surface and check its own fix." },
  "large/high": { rounds: 3, why: "large surface and high consequence. Three is the ceiling, and reaching it means the DR-0016 path rather than a fourth round." },
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
    rounds: refused ? null : tier.rounds,
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
  out.push(`FIX ROUNDS    ${r.rounds} (a cap, not a target; one is the floor and every change is reviewed)`);
  out.push(`              ${r.why}`);
  out.push("");
  out.push("At the cap, DR-0016 applies: a fresh implementer and a third review");
  out.push("contract, not a further round.");
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

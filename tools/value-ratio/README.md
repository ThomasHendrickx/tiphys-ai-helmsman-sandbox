# value-ratio

How much of what a repository merged was value, and how much was the process
talking about itself.

## Why

Tiphys decision record DR-0027 measured a 24 hour window in which 29 merges
reached `main` and 2 of them touched `src/` or `bin/`, at a cost of roughly
1.66 million subagent tokens spent almost entirely on two files that do not
ship. That measurement was done by hand, once, after the fact, by an owner who
happened to notice. A number nobody can recompute is an anecdote, and an
anecdote holds a process to nothing.

This is the same measurement as a command with an exit code.

## Run it

```
node tools/value-ratio/value-ratio.mjs --repo <dir> [--range <rev-range>]
```

Against the kernel's whole history, measured 2026-09-15 at `3b40118`:

```
units       50 first-parent commits carrying a change

lines changed
  value          40825    9.4%
  assurance     307082   70.8%
  overhead       85991   19.8%

overhead-to-value ratio, by lines changed: 2.11
```

Read that as: **for every line of value, this repository wrote seven and a half
lines of making-sure and two lines of paperwork.** The problem is not
bureaucracy. It is that the assurance does not scale with what it protects, and
that is what `assurance-tier.mjs` below is for.

An earlier version of this README reported 74.9% overhead, because
`delivery/review/**`, `delivery/verification/**` and `delivery/evidence/**`
were classified as paperwork. They are not: a clean-room review is a test
written in prose. An adversarial reviewer caught the shipped rules
contradicting the rationale two sections down, and the correction moved
239,000 lines from overhead to assurance and the ratio from 7.96 to 2.11. The
old number is left here rather than deleted, because a measurement that
silently changes by a factor of four is exactly the thing a reader should be
able to see happening.

## The three buckets

| bucket | what it is | gated |
|---|---|---|
| value | what the consumer of this project receives | the denominator |
| assurance | what proves the value works: tests, witnesses, gates, CI | reported, never gated |
| overhead | plans, reviews, evidence, decision records, agent rules | the numerator |

**Assurance is a separate bucket on purpose.** A two-bucket version would put
the clean-room review in the same bucket as the notes about the clean-room
review, and the cheapest way to pass would be to review less. The budget
constrains overhead against value and leaves assurance alone.

The classification lives in `value-map.json`, not in the code, because which
paths count as shipped value is a project question (Tiphys DR-0029: the kernel
owns orchestration, the project supplies its own definition of done). Rules are
ordered and first match wins; the ordering is asserted in the tests, because a
tidy-looking list invites a later editor to sort it.

An unclassified path defaults to **overhead**. Counting it as value would be
the flattering error.

## Tokens

Lines are a proxy and a biased one. A line of review prose and a line of
concurrent lock handling do not cost the same to produce, and the bias runs
against overhead: prose is voluminous and cheap per line, so the line reading
overstates the overhead share relative to where the tokens really went.

Tokens cannot be recovered from git. Where they are known, record them in
`spend.tsv` and pass `--spend`:

```
phase	bucket	tokens	evidence
pstack-borrow-review/discovery-pstack	overhead	987053	wf_7c3463fb-cca
```

Append only. `evidence` is a pointer, never prose. A malformed row is reported
and counted as skipped, never silently dropped, because a ledger that quietly
loses rows reports a better ratio than the truth.

The seeded ledger currently reads 4,487,517 tokens, 100% overhead, 0 value.
That is this review measuring itself, and it is the honest number.

## The budget

`--budget 1.0` means overhead may not exceed value. Over budget exits 1.

A range with no value at all is **not** within budget, however generous the
number. Reporting one would make the emptiest possible history the easiest to
satisfy.

## assurance-tier: how many fix rounds has this change earned?

The ratio says the process overreacts. It does not say what to do instead.
`assurance-tier.mjs` does. Per Tiphys owner decision DR-0035:

**Every change is reviewed. What tiers is the number of fix rounds.**

A fix round is one back-and-forth between the clean-room reviewer and the
implementer. Size buys coverage and impact buys depth, but both are spent on
ITERATION, never on whether a review happens at all.

| | low impact | high impact |
|---|---|---|
| **zero size** | 1 round | 1 round |
| **small** | 1 round | 2 rounds |
| **large** | 2 rounds | 3 rounds |

**The cap is a cap, not a target**, and the number justifying it is measured: of
sixteen fix rounds in Tiphys's M1, thirteen were re-reviewed and TWELVE of
those thirteen produced a new finding attributable to the round itself. A fix
round is a change, and a change needs reviewing, so round N+1 largely exists to
check round N. At the cap a fresh implementer and a third review contract
apply, not a fourth round.

An earlier version of this tool tiered the assurance MODE and could select
`none`. That was wrong twice over: it would have let a change merge
unlooked-at, and it silently narrowed a condition of a merge-authority grant
that was not the tool's to narrow.

```
node tools/value-ratio/assurance-tier.mjs --repo <dir> --range <rev> --impact <low|high>
```

**The zero-size row is not an edge case.** Measured over the kernel's 50
first-parent units: thirty-four have a subject size of zero. They changed no
value path and no assurance path. Median subject size is 0; p75 is 338; p90 is
3408. Those still get a round, and under this rule exactly one, where today the
process offers them the same machinery it offers a concurrency rewrite.

**Size is computed, impact is declared, and the declaration has a floor.** Size
comes from the diff and cannot be argued with. Impact is a judgement, so it is
declared before the work, where it cannot be retrofitted to justify a review
that was skipped. `highImpactPaths` in the map is the floor: a change touching
one of them may not be called low impact, and the command refuses, naming the
path, rather than warning.

**Overhead is excluded from size, in both directions.** Writing a longer work
history cannot buy a heavier review, and writing a shorter plan cannot dodge
one. That invariant is asserted directly in `test/tier.test.js`, as are the
floor of one and the ceiling of three, and the suite goes red under four
structurally different mutations: counting overhead in the subject, defanging
the impact floor, dropping a cell to zero, and raising a cell past three.

The threshold of 500 subject lines is **derived, not chosen**: it sits between
the kernel's own p75 and p90, so it separates the ordinary phase from the
genuinely large one rather than splitting the bulk of the history.

## What it does not measure

Whether the value that landed was any good. A repository can score perfectly
here by merging bad code with no tests. This is a budget, not a quality gate,
and the assurance bucket exists so that the budget cannot be met by deleting
the tests.

## Tests

```
node --test "tools/value-ratio/test/*.test.js"
```

Measured 2026-09-15 on node v22.22.2: 18 tests, 18 pass, 0 fail, 0 skipped.

The depth cases in `test/match.test.js` are the point of that file. The first
matcher this tool shipped matched `src/**` against `src/cli.ts` and not against
`src/commands/doctor.ts`: four chained `String.replace` calls, and the last one
could not tell a `*` the author wrote from a `*` an earlier pass had just
emitted. It worked at depth one and failed at depth two, put 19,316 lines of
`src/` into the overhead bucket, and the report read plausibly. It was caught
by cross-checking against an independent implementation, not by the suite,
which is why every glob is now asserted at two depths.

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
  assurance      68140   15.7%
  overhead      324933   74.9%

units touching each bucket
  value             12   24.0% of units
  assurance         15   30.0% of units
  overhead          50  100.0% of units

overhead-to-value ratio, by lines changed: 7.96
```

Read that as: **every unit that reached `main` carried paperwork, and fewer
than a quarter of them carried anything a consumer receives.** DR-0027's
window was not an outlier, it was the first time anyone counted.

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

The seeded ledger currently reads 3,289,185 tokens, 100% overhead, 0 value.
That is this review measuring itself, and it is the honest number.

## The budget

`--budget 1.0` means overhead may not exceed value. Over budget exits 1.

A range with no value at all is **not** within budget, however generous the
number. Reporting one would make the emptiest possible history the easiest to
satisfy.

## What it does not measure

Whether the value that landed was any good. A repository can score perfectly
here by merging bad code with no tests. This is a budget, not a quality gate,
and the assurance bucket exists so that the budget cannot be met by deleting
the tests.

## Tests

```
node --test "tools/value-ratio/test/*.test.js"
```

Measured 2026-09-15 on node v22.22.2: 10 tests, 10 pass, 0 fail, 0 skipped.

The depth cases in `test/match.test.js` are the point of that file. The first
matcher this tool shipped matched `src/**` against `src/cli.ts` and not against
`src/commands/doctor.ts`: four chained `String.replace` calls, and the last one
could not tell a `*` the author wrote from a `*` an earlier pass had just
emitted. It worked at depth one and failed at depth two, put 19,316 lines of
`src/` into the overhead bucket, and the report read plausibly. It was caught
by cross-checking against an independent implementation, not by the suite,
which is why every glob is now asserted at two depths.

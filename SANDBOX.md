# What is in this repository

Two things, plus the original toy.

## `tools/value-ratio/`

The measurement. How much of what a repository merged was value, and how much
was the process talking about itself. See `tools/value-ratio/README.md`.

Against the Tiphys kernel's whole history, measured 2026-09-15 at `3b40118`:
7.96 overhead lines per value line, and 50 of 50 merged units carried
paperwork while 12 carried anything a consumer receives.

Alongside it, `assurance-tier.mjs` answers the question the ratio raises but
cannot settle: how much making-sure has THIS change earned? Size buys coverage,
impact buys depth, and thirty-four of the kernel's fifty merged units have a
subject size of zero.

## `projects/sitrep/`

The subject. A small, boring, dependency-free CLI with phase 1 delivered as a
seed and phases 2 to 4 declared but unbuilt, so that running Tiphys against it
produces a measurable cost against a measurable delivery.

## `README.md`, `package.json`, `src/greet.js`, `test/greet.test.js`

The original toy sandbox project, owned by the kernel's
`scripts/seed-sandbox.sh` and reset by every re-seed. Do not edit those five
files here; edit them in the kernel's `sandbox/` directory. Everything else in
this repository is outside the seed's ownership and survives a re-seed.

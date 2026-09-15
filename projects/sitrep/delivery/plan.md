# sitrep delivery plan

- status: phase 1 delivered by hand as the seed; phases 2 to 4 are the work
- binding rule: if it is not written here, it is not being made
- charter: projects/sitrep/delivery/charter.yaml
- kernel version pin: 0.1.0

## What this plan is for

It is the input to a measurement, not a product roadmap. Each phase below is
sized so that its shipped diff is small and countable, because the question
being asked is not "can Tiphys build sitrep" but "what did building it cost,
against what it delivered".

Run the measurement after each phase:

```
node tools/value-ratio/value-ratio.mjs --repo . --range <previous-head>..HEAD
```

Record the token spend for the phase in `tools/value-ratio/spend.tsv` in the
same commit as the work. A phase whose spend row is missing is a phase that
did not happen, as far as the measurement is concerned.

## Phase 1: inventory (DELIVERED, seed)

Delivered by hand so the subject has a working baseline. Files:
`projects/sitrep/src/inventory.js`, `projects/sitrep/bin/sitrep.js`,
`projects/sitrep/test/inventory.test.js`, `projects/sitrep/package.json`.

Verify: `cd projects/sitrep && npm test`. Measured at the seed commit: 7 tests,
7 pass, 0 fail, 0 skipped, on node v22.22.2.

## Phase 2: git head and working-tree state

**Intent.** Report the repository's current commit and whether the working
tree is clean, so the inventory can be attributed to a known state.

**Files to touch.** `projects/sitrep/src/git.js` (new),
`projects/sitrep/bin/sitrep.js`, `projects/sitrep/test/git.test.js` (new).

**Why this phase is here.** It makes sitrep CONSUME ANOTHER PROGRAM'S OUTPUT,
which is the case the kernel's red-witness rule treats specially: assertions
must include real captured output from `git`, not hand-written strings chosen
to match the implementation. This phase exists to exercise that rule against a
real subject.

**Acceptance criteria.**

1. `sitrep --json` output carries a `git` object with `head` (40 lowercase hex)
   and `dirty` (boolean). `node --test` exits 0 and reports N tests, N greater
   than the phase 1 count of 7.
2. Run inside a directory that is not a git repository, `sitrep --json` exits 0
   and `git` is `null`. Absence of a repository is not an error.
3. `git` absent from PATH is reported as `null` with a `reason`, and the
   command still exits 0. Witnessed by running with a PATH containing no `git`.
4. The dirty check distinguishes an untracked file from a modified tracked
   file, and both count as dirty. Two structurally different witnesses, one per
   case, because one witness is not a class.
5. Every assertion about `git` output quotes REAL captured output from a staged
   scratch repository, committed under `projects/sitrep/test/captures/`. A
   hand-written expected string fails this criterion.
6. No dependency is added: `projects/sitrep/package.json` has no
   `dependencies` key after this phase.

**Verify.** `cd projects/sitrep && npm test`

## Phase 3: a cache, written atomically, outside the measured tree

**Intent.** A second run over an unchanged tree returns the previous answer
without re-walking.

**Files to touch.** `projects/sitrep/src/cache.js` (new),
`projects/sitrep/bin/sitrep.js`, `projects/sitrep/test/cache.test.js` (new).

**Why this phase is here.** It introduces the two hazard classes the kernel's
implementer brief names explicitly: something that WRITES, and something that
two callers can race on.

**Acceptance criteria.**

1. A cache hit is reported in the output and the walk is not performed.
   Witnessed by making the tree unreadable after the first run and observing a
   successful second run.
2. The cache key includes the git head and the working-tree dirty flag, so a
   dirty tree never serves a stale answer. Red against the dangerous state:
   with the dirty flag removed from the key, a test that edits a file between
   runs must go red.
3. The cache is written by writing a temporary file beside the target and
   renaming. A reader concurrent with a writer sees either the whole previous
   document or the whole new one, never a partial write. Witnessed under forced
   contention, not asserted.
4. The cache never lands inside the tree being measured, for any input
   including a root that IS the cache directory's parent. Witnessed with a
   negative test that fails if the path is joined naively.
5. A corrupt or truncated cache file is a MISS, never a crash and never a
   silently wrong answer.
6. `--no-cache` bypasses both read and write, and is witnessed to write nothing
   by comparing the cache directory before and after.

**Verify.** `cd projects/sitrep && npm test`

## Phase 4: refuse what cannot be safely read

**Intent.** Make the walker's existing type-before-open discipline explicit,
tested, and reported.

**Files to touch.** `projects/sitrep/src/inventory.js`,
`projects/sitrep/test/hazard.test.js` (new).

**Acceptance criteria.**

1. A named pipe (FIFO) in the walked tree is counted under `other`, is never
   opened, and the walk completes in bounded time. Witnessed by a test that
   creates a FIFO with no peer and asserts the walk returns; a walker that
   opens it HANGS rather than failing, which is the louder signal.
2. A directory the process cannot enter is reported in `unreadable[]` with its
   path and reason, the counts are described as a floor, and the exit code is
   nonzero. Witnessed by a mode-000 directory, skipped when the suite runs as
   root, and the skip is REPORTED rather than silent.
3. A symlink cycle terminates. Already witnessed in phase 1; this phase adds
   the second member of the class, a cycle through two directories rather than
   a self-link.
4. `node --test` exits 0 and reports N tests, N greater than the phase 3 count,
   with the SKIPPED count quoted alongside the pass count.

**Verify.** `cd projects/sitrep && npm test`

## What is deliberately not in this plan

- Any network access, any dependency, any daemon.
- A watch mode. It would add a long-running process, and the value being
  measured here is delivery cost, not feature breadth.
- Publishing. sitrep is run from the checkout, which is why the charter
  declares `release-verification: reserved`.

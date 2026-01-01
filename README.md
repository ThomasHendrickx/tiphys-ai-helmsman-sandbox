# toy-sandbox

The Tiphys toy sandbox project (kernel plan v1, M1-P6 step 1).

This directory is the seed content for the throwaway project the M1 exit
test drives end to end. It is not part of the kernel package and is never
published: `scripts/seed-sandbox.sh` copies it into the toy repository
created by owner action A-1, and the exit-test harness
(`scripts/m1-exit-test.sh`) clones that repository into a fleet home's
`projects/` area and lands one trivial change on it through
`tiphys spawn`.

Everything here is deliberately minimal and dependency-free:

- `package.json`: one project, no dependencies, `npm test` runs `node --test`.
- `src/greet.js`: the one source file.
- `test/greet.test.js`: the one test.
- The exit-test stub payload appends a line to this README, commits, and
  pushes the task branch. That is the whole "trivial change" the milestone
  exit condition asks for.

The M1 exit test asserts, in a clone of the seeded repository, that
`npm ci` and `npm test` both exit 0 with at least one test reported. Keep
this project dependency-free so that assertion holds on a machine with
only git, Node, and npm, and with no registry access.

## Exit-test log

The stub payload appends its lines below. Each line records one exit-test
run; the file is the change under test and carries no other meaning.

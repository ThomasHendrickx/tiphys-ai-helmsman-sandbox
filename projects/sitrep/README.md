# sitrep

What is in this tree.

```
node bin/sitrep.js <dir> [--json] [--skip a,b]
```

Exit 0 when the inventory is complete, 1 when a path could not be read (the
counts are still printed, and named as a floor), 2 on a usage error.

## This is a subject, not a product

sitrep exists so that the cost of delivering it through the Tiphys pipeline can
be measured against what it delivers. DR-0034 makes `pulse` the M4 pilot, and
pulse carries real financial data, so it is the wrong place to discover what
the process costs. This is that place.

Phase 1 is delivered as a seed so there is a working baseline. Phases 2 to 4
are the work, and they are declared in `delivery/plan.md` with falsifiable
acceptance criteria and a verify command each. They are chosen to exercise the
cases the kernel's review contract treats specially: consuming another
program's output (phase 2), writing and racing (phase 3), and opening paths
whose type has not been established (phase 4).

The charter at `delivery/charter.yaml` validates against the real kernel:

```
node bin/tiphys.ts validate --type charter \
  ../tiphys-ai-helmsman-sandbox/projects/sitrep/delivery/charter.yaml
```

Measured 2026-09-15 against kernel 0.1.0 at `3b40118`: exit 0.

## Tests

```
cd projects/sitrep && npm test
```

Measured 2026-09-15 on node v22.22.2: 7 tests, 7 pass, 0 fail, 0 skipped.

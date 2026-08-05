# Zero-drift baseline — the per-file test map at `f240788`

`baseline-f240788-per-file.json` — `{ "<spec file basename>": <test count> }` for every file in the
unit suite at the mission's baseline sha `f240788`. **471 files · 7692 tests** (verified by summing the
map at the moment it was committed).

## Why this file is in the repo

Every phase gate states zero-drift: which pre-existing tests were removed, which changed count, and how
the new total is composed. That claim is only checkable against a per-file baseline. The map lived in a
session scratchpad and was nearly lost twice — regenerating it means checking out `f240788` in a
throwaway worktree, `npm ci`, and a full suite run. 20KB in the repo is cheaper than that.

## How to use it

At a gate, produce the same shape at HEAD and compare per file:

- **removed pre-existing** — a basename in the baseline that is absent at HEAD. This must be `0`, or the
  removal is named and justified in the gate log.
- **changed pre-existing** — a basename in both, with a different count. Each one is named with its
  `(old, new)` pair and an intended reason.
- **new files** — basenames absent from the baseline; their counts sum to the "+N new tests" figure.
- **arithmetic** — `pre-existing-sum-at-HEAD + new-sum == reported total`. State the pre-existing sum
  **measured**, not derived as `total − new`: a reviewer correctly called that derivation tautological,
  because it makes the identity true by construction and can never detect a removal.

## Caveat

Keyed by **basename**, not path. Two spec files with the same basename in different directories would
collide. Measured at the time of writing: no collisions exist in this suite (471 keys for 471 files).
Re-check that invariant if a gate ever reports a count that cannot be explained.

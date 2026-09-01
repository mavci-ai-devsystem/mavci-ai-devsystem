# Lessons

Gate findings, promoted out of the project they were found in.

A Gate runs in a throwaway project — `gate4`, `gate4-verify`, `gate4c`. The
project gets deleted; the finding must not. Anything under a project's
`.mavci/lessons/` is written by an agent that had no other way to record what it
saw, and it lives on a disk nobody is committed to keeping. Promoting a lesson
here is what makes it survive.

Each file is copied **byte-identical** from its origin. The paths inside them are
relative to the project that produced them, not to this repository, and that is
deliberate: a lesson edited to fit its new home stops being evidence.

    gate-4-closed.md                  gate4c, plugin 0.1.11, 2026-09-01
                                      Gate 4's result. Enforcement PASSED end to
                                      end, including fix-in-place. Records four
                                      declined cheap paths, because an enforcement
                                      pass is worth nothing without them.

    pending-system-change-0.1.12.md   gate4c, plugin 0.1.11, 2026-09-01
                                      Findings 1-5 and the build order 0.1.12 was
                                      built from. Also the Phase 2 design
                                      constraint for Guardian and /release.

## Why this copy was manual

`/mavci-core:retro` — the command whose whole job is to carry a finding out of a
project and into this repository — did not exist when these were written. That
absence is itself Finding 4 in the second file, and it is why the first file ends
on the sentence that governs this directory:

> They survived because an agent thought to. That is not a channel; that is luck
> with good manners.

`/mavci-core:retro` ships in 0.1.12. The next promotion is a command, not a `cp`.

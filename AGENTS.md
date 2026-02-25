# AGENTS: brewkit

Public repository for package build/test/audit workflows.

## Core Commands

- `bin/bk build <pkg>`
- `bin/bk test <pkg>`
- `bin/bk audit <pkg>`
- `deno test --allow-env --allow-net --ignore=.data`

## Always Do

- Keep package build behavior deterministic.
- Test and audit packages touched by the change.

## Ask First

- Changes to CI action contracts.
- Changes that alter bottle/build artifact naming or layout.

## Never Do

- Never skip `bk audit` for modified package workflows.
- Never embed internal-only operational details in public docs.

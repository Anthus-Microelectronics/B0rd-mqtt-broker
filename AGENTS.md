# Repository policy

This repository is the **B0rd-mqtt-broker** MQTT infrastructure service in the B0rd repository family.
Product branding remains **B0RD**; Rust packages and crates remain `b0rd-*`.

## Work tracking

- Kanbus in the sibling `B0rd` repository is the source of truth.
- Every code change needs a `B0-*` issue before implementation.
- Update issues through `kbs` only. Never hand-edit `project/issues/` or
  `project/events/`.

## Git Flow

- `develop` is the default integration branch; `main` is release-only.
- Branch from `origin/develop` as
  `feature/B0-<id>-<slug>`, `fix/B0-<id>-<slug>`, or
  `chore/B0-<id>-<slug>`.
- Open PRs into `develop` and use merge commits. Delete merged task branches.
- Only a human promotes `develop → main`. After release, reconcile
  `main → develop` with a merge commit.
- Commits require human review before creation.

## Repository-family worktrees

The normalized origin is
`git@github.com:Anthus-Microelectronics/B0rd-mqtt-broker.git`.
Use `B0rd/tools/worktree-family.sh promote` or `attach` to edit this
repository inside `B0rd/worktrees/B0-<id>/`; untouched siblings stay symlinked.

## Validation

Run this repository's documented tests plus
`B0rd/tools/worktree-family.sh doctor B0-<id>` for family changes. Record
commands and results on the Kanbus issue and in the PR description.


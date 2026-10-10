# Repository instructions for AI development

## Product

Build AIR Studio according to the accepted specification in `docs/build-specification/`. Preserve its full feature baseline. Default layout: files left, editor center, chat right. The first public release is a complete workspace, not a placeholder prototype.

## Before editing

- Read the current task and relevant specification sections.
- Run `bun run studio -- where <capability-or-path>` and inspect the actual source.
- Use `bun run studio -- status` and `impact --base <relevant-ref>` when available.
- Until a command is implemented, report that fact and inspect the corresponding files directly.

## Architecture

- Follow module ownership, package exports, ports, runtime separation, and canonical storage rules.
- Create new source files only with roles allowed by `architecture/role.catalog.json`.
- Keep TypeScript strict; do not bypass failures with broad any, blanket ignores, or permissive manifests.
- Update manifests/contracts/migrations and their tests when boundaries change.
- Record architecture decisions only when a substantive boundary or authority changes.
- Never edit generated files manually or introduce competing domain definitions.

## Working behavior

- Deliver real vertical behavior including persistence and failures.
- Add/run the tests required by the approved implementation specification.
- Retain user drafts and backups; avoid destructive operations without authorization.
- Do not make network calls, publish artifacts, send messages, or spend money outside the task's authorization.
- Report unavailable credentials/runners accurately and continue independent work.

## Completion evidence

- Run applicable checks and preserve actual exit status.
- Update task records and verification records using current source fingerprints.
- State what changed, what works, what was checked, and what remains.
- Do not claim a browser result verifies a native installer or a mock verifies a live provider.
- A task with unmet required acceptance remains incomplete or blocked.

## Release

Exclude test drivers and debug endpoints. Verify packaged sidecars/workers/resources, licensing, clean installation, update/recovery, and supported target evidence. Build reviewable artifacts before requesting any final external publishing approval.

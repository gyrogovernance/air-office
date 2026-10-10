# 04. Tool-administered development

## 1. Principle

Build a small repository CLI over mature tools. Its purpose is to answer where code belongs, what changed, what depends on it, and what was actually verified. Do not develop a separate project management platform before implementing the application.

The standard entrypoint is `bun run studio -- <command>`. Commands print concise human output by default, support `--json`, and return a nonzero exit code on failure. Detailed output is available through `--full` or linked reports. Default summaries should normally fit within 60 lines and name the first actionable failures.

## 2. Required commands

| Command | Required answer / effect |
| --- | --- |
| `map` | Present modules, planned catalog entries, public entrypoints, owned entities, dependency summary, and links. |
| `where <path-or-entity-or-feature-id>` | Owner, role, allowed imports, public entrypoint, docs, scenarios, and relevant task. |
| `impact --base <git-ref>` | Changed modules, affected contracts/consumers, migrations/native/worker effects, required checks and release targets. |
| `doctor` | Toolchain/target prerequisites, sidecar availability, configuration status without secrets, database/vector probe, resource availability. |
| `status` | Implemented/missing features; latest valid evidence by source state/target; failed, blocked, skipped, and stale results. |
| `check --changed` | Affected formatting/type/schema/architecture checks and affected tests according to impact policy. |
| `check --all` | Full static/schema/architecture checks, generated-file drift and unused-dependency analysis. |
| `test --suite <name> --target <target>` | Run selected actual test suite; produce machine-readable evidence. |
| `module create <id>` | Generate approved minimum module structure and manifest. |
| `task start <id>` / `task finish <id>` | Validate task records, scope and evidence references; finish cannot invent missing evidence. |
| `data inspect` | Redacted schema/migration/index/job summary; no arbitrary source dumping by default. |
| `data backup` / `data restore --from <path>` | Explicit safe backup/restore with compatibility checks and recovery instructions. |
| `trace <run-id>` | Redacted correlated run/tool/job/source timeline and errors. |
| `release inspect --target <target>` | Installer resources, versions, signatures, licenses, test driver absence, evidence and unresolved gates. |
| `release build --target <target>` | Build actual target resources/installers and record their hashes. |

Implement `map`, `where`, `doctor`, and minimal `check` in the first slice. Expand status/impact as the second capability appears. Release and data commands become real when their underlying operations exist. Before then, they report `not implemented` and fail the relevant gate; they do not print fabricated success.

## 3. Tool choices

| Concern | Tool / policy |
| --- | --- |
| Workspace/install/run | Bun workspaces and committed lockfile; supported runtime version pinned. |
| Type correctness | TypeScript strict mode, consistent shared compiler settings, no implicit any. |
| Formatting and JS/TS linting | ESLint and Prettier with committed configuration; avoid overlapping conflicting formatters. |
| Import boundaries/cycles | dependency-cruiser, including type-only imports; generated graph output. |
| Unused files/dependencies/exports | Knip with explicit workspace/entry configuration and documented dynamic entries. |
| Runtime schema validation | Ajv Draft 2020-12 or equivalent compatible validator; contract generation checked for drift. |
| TypeScript domain/integration tests | Vitest as the primary test runner; run service-specific integration with the actual Bun runtime. |
| Browser interaction | Playwright projects for representative Chromium and WebKit behavior. |
| Native desktop interaction | Current Tauri-supported WebdriverIO integration, verified per supported platform. |
| Python | uv lock, Ruff, typing checks appropriate to worker interfaces, pytest. |
| Rust | cargo fmt, clippy, tests, pinned compatible toolchain. |
| CI | Workflow jobs on Windows, macOS, Linux; caches keyed by lockfiles/toolchains; no reused unverifiable reports. |
| Supply chain/release | Dependency and content notices, SBOM, vulnerability triage, artifact checksums/signatures. |

Pin exact compatible versions during bootstrap and record them in lockfiles and the runtime catalog. Do not write `latest` into the build specification and assume future compatibility. A small framework change behind a port is acceptable when an actual probe shows a problem; changing the whole stack is an architectural decision.

Vitest does not prove Bun-specific APIs work if its test process uses Node. Test Bun database extensions, compiled sidecars, worker spawning, streaming, and native lifecycle in their actual runtime. Tool wrappers must retain underlying exit codes and failures.

## 4. Architecture checker responsibilities

Use established analyzers for imports, unused code, formatting, and types. Add small custom checks only for repository-specific semantics:

1. Validate manifests, catalogs, task/evidence records, and exceptions against schemas.
2. Enforce filename roles and role-to-directory placement, with explicit language exceptions.
3. Verify one owner per entity/table prefix/feature implementation; allow deliberately shared scenario coverage.
4. Verify public paths exist and package exports agree.
5. Apply dependency direction, runtime separation, no peer-internal imports, and no cycles.
6. Verify migrations declare owner and sequence and never change previously released checksums.
7. Verify feature IDs and scenario IDs resolve to actual implementation and test locations.
8. Regenerate maps/contracts and fail on unexpected drift.
9. Detect stale reports and incomplete release evidence.

Architecture tests contain forbidden imports, invalid names, duplicate ownership, missing exports, and stale evidence fixtures. The checker must reject each fixture for the correct reason. A green checker with no negative tests is insufficient.

Do not pretend static analysis proves filesystem safety, SQL ownership, authorization, or document fidelity. Those require integration and behavior tests.

## 5. Machine-readable catalogs

The architecture catalog contains rule IDs, role grammar, dependency policy, and exceptions. The domain catalog contains entities and owners. The feature catalog contains product requirement IDs, scenario IDs, owner modules, implementation paths, and test links. Runtime catalog contains supported versions and target matrix.

Generated maps read these records and inspect actual source. They expose discrepancies rather than faithfully repeating inaccurate declarations. For example: declared public API missing; entity defined in two modules; scenario points to nonexistent test; module active but no registered runtime entry.

Keep generated reports in `reports/`, not mixed with source. Commit stable generated documentation only when useful, and verify it is reproducible. Do not commit raw private prompts, user files, credentials, or large test recordings.

## 6. Evidence and source state

A verification result includes command/suite ID, result status, operating system/architecture, tool/runtime versions, source commit plus dirty working-tree digest, dependency lock digests, fixture hashes, timestamps, and artifact references. `pass`, `fail`, `skip`, `blocked`, and `not-run` are distinct.

Source identity must include relevant tracked and untracked source/config files. Git commit alone is insufficient during an AI editing session. Ignore generated evidence directories to avoid recursive hash changes. A changed global contract, compiler config, runtime, lockfile, native permission, or migration invalidates all affected evidence.

Impact analysis is conservative. If it cannot determine the effect, request the broader check set. It may reuse evidence only when input fingerprints and environment remain compatible. It must never convert an old pass into a current pass by changing a timestamp.

Example human summary:

```text
Studio status: local working tree <digest>
Modules: 8 present; 12 planned
Features: 5 implemented; 12 incomplete
Architecture: PASS, current inputs
Browser: PASS, current inputs
Desktop Windows x64: FAIL, installer worker resource missing
Desktop macOS arm64: NOT RUN
Live provider checks: BLOCKED, credentials unavailable
Release: NOT READY
Next: fix worker packaging; run native install scenario A-012
```

This is an output design example, not a report about the existing repository.

## 7. Task records for AI continuity

Each bounded task records its user outcome, feature/scenario IDs, affected modules, allowed paths, contract/migration implications, acceptance checks, status, blockers, and evidence references. Keep it small enough to read before editing. Split a task when it contains unrelated outcomes.

An AI begins by reading the relevant task and `where`/`impact` output. It ends by updating the task and reporting actual checks. A task can be implemented but blocked on a macOS runner; the record must say so. Do not set completed when its stated acceptance requires unavailable evidence.

These files support continuity across AI sessions. They do not justify ignoring the user's latest instruction or preserving an obsolete plan.

## 8. CI policy

Pull request checks run static/schema/architecture checks and the affected test suites, with a conservative fallback to full checks. Main/release workflows run the full applicable matrix. Migrations, native lifecycle, sidecars, permissions, update logic, and public contracts trigger broader integration checks.

Use separate browser, real Bun service, worker, Rust, native desktop, and installer jobs so failures identify their layer. Live providers run on a deliberate credentialed workflow without leaking secrets to untrusted contributions. Provider outage is reported separately from a deterministic regression; it does not become a passing integration result.

Release jobs require matching source fingerprints and artifacts. No `continue-on-error` on required gates and no test command that succeeds when it selected zero tests. Dependency audit results require triage with actual reachability and severity; record any accepted release exception explicitly.

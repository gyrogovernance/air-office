# 05. Verification, performance, and desktop distribution

## 1. What counts as evidence

Tests must exercise the claimed behavior. A function returning a fixture is not a working provider integration. A browser screenshot is not proof that a packaged Python worker launches. A successful Tauri build is not proof that the installer works on a clean machine.

Use deterministic tests for repeatability, real local dependency integration for runtime compatibility, representative live provider checks for external protocols, and native installation tests for distribution. Record their results separately.

Do not label this specification or its example records as an implemented/tested application. During implementation, status is derived from actual records tied to the source and artifact being evaluated.

## 2. Test layers

| Layer | Must cover | Must not be substituted with |
| --- | --- | --- |
| Domain | File version/conflict decisions, permission policy, branch graph, method pass ordering, schedule occurrence calculation, index compatibility. | Tests that only check type declarations or snapshots. |
| Contract | Runtime schema validation; provider, tool, storage, extraction, and credential adapter conformance. | One fake adapter passing its own invented contract. |
| Service integration | Real Bun, SQLite/vector extension, transactions/migrations, worker IPC, streamed events, restart recovery, ACL enforcement. | Node-only execution of Bun-dependent code. |
| Python/Rust | Worker extraction/protocol/errors and native lifecycle/permission handling. | Frontend mocks. |
| Browser | Pane/tab/editor/chat interactions, accessible keyboard behavior, virtualization, errors and reconnect. | Native desktop certification. |
| Native desktop | Real Tauri webview, filesystem dialogs/access, keychain adapter, child process lifecycle, resource paths. | Playwright browser WebKit/Chromium alone. |
| Installer/release | Clean install, launch, update, signatures/resources, preserved data, uninstall policy. | Development-mode launch. |
| Live integration | Representative provider/tool server behavior with real credentials and explicit environment. | Recorded fixtures represented as live runs. |

Use the official current Tauri WebdriverIO integration where supported. Current documentation describes an embedded WebDriver server route for Windows, macOS, and Linux. Direct `tauri-driver` has a different platform limitation; do not confuse the two paths. Revalidate the chosen integration against pinned versions during bootstrap.

Compile test instrumentation behind an explicit test feature/build profile. The production artifact must exclude the embedded test driver and its debug endpoints. Native automated tests against an instrumented build need a separate production-artifact launch/install smoke check. A test plugin must not become a release dependency by accident.

## 3. Critical failure scenarios

Assign stable scenario IDs in the catalog. A-001 through A-012 in the product document are end-to-end journeys; the following are additional failure obligations:

| Scenario | Required result |
| --- | --- |
| T-001 Concurrent save | External edit after opening causes conflict; neither version is silently lost. |
| T-002 Crash during save | Journal/recovery produces a complete prior/new file or a clear recovery action; no silently truncated document. |
| T-003 Draft recovery | Unsaved edits survive renderer/service interruption according to documented persistence cadence. |
| T-004 Streaming interruption | Partial output persists; reconnect replays without duplicate text/tool actions; generation restart is honest. |
| T-005 Tool argument fragments | Split/invalid JSON never executes; complete validated calls execute according to permission. |
| T-006 Uncertain external mutation | Timeout does not trigger an unsafe blind retry or falsely claim no effect. |
| T-007 THM failure | Earlier completed passes remain available; later pass failure is explicit; output is not marked complete. |
| T-008 Source mutation | Citation still resolves to the captured version or reports unavailable source; it does not silently cite a new file. |
| T-009 Extraction quality | Scanned/two-column/table/encrypted/corrupt documents produce usable extraction or explicit warnings/failures. |
| T-010 Index compatibility | Model/dimension/chunker changes create a new generation or rebuild; old vectors are not silently mixed. |
| T-011 Access revocation | Cached retrieval, source preview, export, conversation attachment, and queued jobs enforce updated access. |
| T-012 Path escape | Traversal, symlink escape, case tricks, renamed roots, and Windows special paths cannot bypass authorization. |
| T-013 Hostile content | HTML/script injection and document instructions cannot execute code or grant tool permissions. |
| T-014 Worker interruption | Worker timeout/crash/cancel cleans up resources; app remains responsive; retry preserves provenance. |
| T-015 Schedule restart | Timezone/DST and missed-run policy behave deterministically; duplicate occurrences are prevented. |
| T-016 Migration failure | Failed migration restores or offers tested recovery; app does not keep writing an incompatible schema. |
| T-017 Secret hygiene | Logs, traces, frontend storage, exports, URLs, and crash reports exclude credentials. |
| T-018 Starter update | User edits and intentional deletions survive pack update; upstream changes are inspectable. |
| T-019 Extension permission | A discovered tool or extension cannot gain undeclared capabilities through metadata. |
| T-020 Release boundary | Production package excludes test drivers/dev endpoints and includes actual target sidecars. |
| T-021 Memory deletion | Deleted/disabled memory is absent from future context and relevant caches; backups follow documented retention. |
| T-022 Shared edits | Concurrent document revisions preserve competing changes and offer reconciliation. |
| T-023 Export/import | Corrupt/oversized/path-traversing archives are rejected; valid exports restore portable source references. |

Test negative behavior as carefully as the successful path. A failed write must leave a useful recovery state, not just return an exception.

## 4. Representative document corpus

Maintain a versioned small redistribution-safe corpus with content hashes and expected characteristics:

- Plain text, Markdown with complex syntax, code, UTF-8/non-Latin and mixed-direction text.
- Clean PDF, two-column PDF, scanned PDF, tables, long PDF, and corrupt/encrypted PDF.
- DOCX with headings/tables, PPTX, spreadsheet material supported by the chosen extractor, HTML with navigation noise, and images requiring OCR.
- Duplicate and revised sources, misleading metadata, invalid encodings, excessively large inputs, and unsupported files.

Define expected extraction quality per fixture: preserved headings/phrases, page anchors, known table cells, warnings, or controlled refusal. Exact text equality is appropriate only where normalization is deliberately stable. Use adjudicated source samples for citation accuracy, not a second LLM's unsupported approval.

Docling is a candidate worker engine because it supports multiple document formats. Its existence does not prove the app's packaging, extraction quality, OCR resources, or citations work. Keep extraction behind a port, pin the engine, and test the packaged path.

## 5. Performance targets and measurement

These are initial engineering targets to validate and calibrate, not measured claims about Tauri, Bun, or the current repository:

| Workload | Initial target / guardrail |
| --- | --- |
| Typing with background indexing | p95 interaction response below 100 ms on declared reference hardware. |
| Cancellation acknowledgement | UI acknowledges immediately; local job cancellation observed within 2 seconds when the adapter supports cancellation. |
| Warm local startup | Usable editor within 3 seconds on declared reference hardware with no network requirement. |
| Long conversation | Smooth navigation with 10,000 stored messages, paged data, bounded mounted rows, and bounded client cache. |
| Large explorer | Search/navigation with 50,000 indexed entries without mounting all entries. |
| Idle desktop memory | Establish full process-tree baseline early; investigate above 400 MiB before loading models/heavy previews. |
| Leak regression | Repeated open/close/stream/cancel workloads should plateau; investigate retained-memory growth above 10% across stable measured cycles. |

Record OS, hardware, webview/runtime versions, fixture size/hash, warm/cold state, background processes, and measurement method. Set realistic per-platform budgets after the first representative measurements; document changes instead of moving gates invisibly.

Local LLM/embedding/OCR resources have separate declared budgets. Report their resource use alongside the application process tree so a favorable UI-only number cannot hide several gigabytes of worker use. Track disk growth of extraction artifacts, caches, backups, and indexes as well as memory.

Use targeted profiling when a target fails. Do not insert arbitrary sleeps or disable real work to make a benchmark pass.

## 6. Supported distribution matrix

Initial required targets:

| Platform | Architecture | Packaging and validation |
| --- | --- | --- |
| Windows | x64 | Supported Tauri installer format(s), WebView2 handling, packaged Bun/Python/vector resources, signing path, clean machine install/update. |
| macOS | arm64 and x64 | Per-architecture or validated universal delivery, native resource compatibility, signing/notarization path, install/update on supported OS versions. |
| Linux | x64 | At least one declared primary package plus an accessible distribution artifact, documented webview/system dependencies, supported distro smoke tests. |

Choose explicit minimum OS versions from the pinned Tauri/webview/dependency requirements during bootstrap. Record unsupported targets honestly. Additional ARM targets require all native/vector/OCR resources and evidence; changing an installer label is insufficient.

CI uses native target runners/build environments. Cross-compilation is acceptable where verified, but no promise of one command producing every signed OS package on an arbitrary machine.

## 7. Packaging and update gates

Every candidate includes:

1. Versioned application/frontend/service/worker compatibility manifest.
2. Compiled Bun sidecar and Python worker resources for the target.
3. Vector extension and extraction resources proven loadable from installed paths.
4. Content/dependency notices, SBOM, resource/model licenses, and redistribution decisions.
5. Installer hash and signature status; platform signing and notarization status where applicable.
6. Explicit release/update channel and signed update metadata, with update signing keys stored separately from ordinary runtime secrets.
7. Migration/backup policy, tested upgrade from the previous release, and recovery instructions.
8. Evidence linked to exact artifact hash and source fingerprint.
9. Verified absence of test drivers, developer endpoints, bundled credentials, and user test data.

Test installation in a clean environment with no Bun/Node/Python/Rust development tools. Exercise A-012 through the installed application. Verify spaces/non-ASCII in installation and user paths. Check first-run network denial, missing optional OCR resources, permission denial, locked files, low disk space, and interrupted update.

Uninstall does not delete user-created documents by default. Application data removal is an explicit separate choice. Updates preserve data and backups; downgrade compatibility is documented rather than assumed.

Signing credentials, paid signing services, real provider credentials, or unavailable native runners may block specific release gates. Complete all independent work, build locally reviewable artifacts, and state the exact remaining gate. Do not relabel unsigned/unverified artifacts as publish-ready. External publishing or sending material requires user authorization at the actual publishing step.

## 8. Release completion record

The release report lists every F-001 through F-017 with implementation references and applicable acceptance evidence, every target with artifact/signature/install results, live provider coverage, known limitations, and approved exceptions. It distinguishes `implemented`, `verified`, `blocked`, and `incomplete`.

Release completion requires all baseline features implemented and applicable required checks passing, with explicit user acceptance of any proposed scope exception. Deterministic tests cannot hide an unrun native target. Coverage percentages and source file counts are supplementary, not the definition of a complete workspace.

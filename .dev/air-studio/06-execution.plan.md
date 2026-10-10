# 06. Implementation sequence and operating rules

## 1. Build the app while establishing its rules

Do not begin with weeks of abstract framework construction. The first slice creates a real installable application that opens, edits, saves, and restores a file. Its architecture checks are small but real. Add capabilities and enforcement together.

The slices below are implementation order, not estimated durations and not permission to ship a smaller public product. Several interfaces can be developed independently after their contracts exist. Do not trade away integration work by completing isolated screens that do not share real state.

Each slice ends with a running desktop artifact on the current development platform, updated task/catalog records, actual tests, a compact status report, and a reviewable change. Build the other target matrix as soon as target-specific resources are introduced.

## 2. Slice 1: installed editor and architecture foothold

**Outcome:** Launch a desktop app, authorize a folder, open/create a text file, edit/save it, restore the workspace, and recover an unsaved draft.

Implement Tauri/React/Vite/Bun workspaces and the compiled service lifecycle. Establish files/workspace/editor ownership, a minimal ui-kit, authenticated local transport, safe data directories, and strict TypeScript. Implement manifests, naming checks, forbidden-import checks, and `map`, `where`, `doctor`, `check`.

Run an early packaging probe for Bun sidecars, Python worker startup, and sqlite-vec on all required targets. This probe is an actual resource/IPC/load test, not a complete document pipeline. Catch incompatible packaging before building the whole product around a developer-only library path.

Deliver A-001 and T-001/T-003 at initial depth, one real native smoke test, and an installer. No placeholder chat that distracts from proving lifecycle and storage.

## 3. Slice 2: durable chat and contextual editing

**Outcome:** Configure a provider, chat with streaming, stop/retry/branch, attach selected text, and apply a reviewable AI edit against a file version.

Implement providers, chat, typed contracts/events, keychain credentials, persisted runs, context disclosure, tool-call stream parsing, proposal/diff UI, and history pagination. Wire one read tool and one proposed file mutation through real authorization.

Add `impact`, initial `status`, source fingerprints, and task/evidence records. Test provider protocol fixtures plus a live configured connection when available. Exercise actual Bun streaming and reconnect. Deliver A-002/A-003 and relevant interruption/tool/secret scenarios.

## 4. Slice 3: documents, vector knowledge, and trustworthy citations

**Outcome:** Ingest supported sources, inspect extraction, retrieve context, answer with resolvable source anchors, and recover interrupted indexing.

Implement managed Python extraction/OCR, source version/artifact model, previews, collections, chunking, embedding adapter, vector/full-text retrieval, jobs/checkpoints, index rebuild and access policy hooks. Bundle the default extraction path and resources. Add the fixture corpus and its quality expectations.

Implement backup/restore foundations before irreversible schema migrations become common. Deliver A-004 and extraction/source/index/worker failure scenarios. Re-run installed-package tests with the actual bundled worker/vector resource.

## 5. Slice 4: rich documents, methods, and original reviews

**Outcome:** Write rich notes, run all five review methods, inspect the THM passes, preserve provenance, and produce an editable/exportable result.

Implement canonical rich document format and conversion fidelity policy, methods/presets/prompts/skills, review runs, human verification status, glossary, and licensed starter packs. Validate exact asset provenance before reuse. Preserve edits and deletions during pack upgrades.

Import original review instructions with their notices; do not paraphrase THM into a different framework. Record the difference between source locators returned by a model and independently resolved anchors.

Deliver A-005 and THM failure/starter update tests. Add document/conversation exports and restore tests. Do not invent diagnostic scores to make review results look quantitative.

## 6. Slice 5: research, tools, comparison, and media

**Outcome:** Fetch/capture web sources, use MCP/OpenAPI tools with grants, compare models, and handle configured images/audio/video.

Implement research adapters, tool server setup and permissions, schema conformance, playground/comparison, media capture/generation/transcription/speech adapters, and portable artifacts. Use the same chat/job/source model instead of separate feature-specific run stores with incompatible semantics.

Deliver A-006/A-007/A-011 and permission/content/network failure tests. No external service is silently required for ordinary local editing or stored material viewing.

## 7. Slice 6: automations, calendar, memory, and shared operation

**Outcome:** Schedule real workflows, manage scoped memory, and use the same app in an authenticated shared deployment with channels and permissions.

Implement timezone-aware schedule occurrences, missed-run policy, calendar recurrence, explicit memory controls, hosted identity/groups/access, shared collections/documents/channels, and PostgreSQL/pgvector adapters. Enforce access throughout retrieval, tools, jobs, exports, and source opening.

Deliver A-008/A-009 and schedule/revocation/memory/shared-edit tests. Verify local mode still needs no sign-in. Publish deploy instructions and a reproducible hosted deployment configuration without baked-in credentials.

## 8. Slice 7: complete release candidate

**Outcome:** All baseline behaviors integrated, documented, and packaged on every required target, with an honest release report.

Complete A-010/A-012 and every outstanding scenario; run the full native/package matrix, accessibility checks, representative long-workload profiles, migration/restore/update tests, license inventory, and production-artifact inspections. Remove obsolete scaffolding and unused dependencies through actual analysis.

Produce installers, checksum/signature records, supported OS matrix, user setup/backup/recovery instructions, developer map, contributor module recipe, and release gate report. If signing or external credentials are unavailable, identify the exact blocker and preserve the completed build artifacts.

## 9. AI session protocol

At the start of a session:

1. Read `AGENTS.md`, the applicable specification sections, current task, and status report.
2. Inspect `where` and `impact`; confirm actual code before trusting an old summary.
3. Choose a bounded user outcome and identify its owner, contracts, state changes, and tests.
4. Continue useful authorized work when a nonessential external gate is unavailable.

While implementing:

- Build through the approved ownership boundaries and public APIs.
- Use real errors, cancellation, persistence, and authorization from the beginning of each feature.
- Make necessary tests executable; fail when no tests are selected.
- Keep visible progress concise and name decisions or blockers.
- Never silently reduce scope, invent a successful result, or replace missing runtime behavior with a mocked UI.

At the end:

1. Run the applicable checks and inspect their results.
2. Refresh task/catalog/evidence records against the current source.
3. Report what works, what was tested, what remains, and where the installer/report is.
4. Leave the next task and blocking conditions clear enough for another AI to continue.

## 10. Architectural change policy

Prefer the specified stack and mature libraries behind ports. If a real compatibility probe fails, investigate and document the failure, choose the smallest viable adapter change, and update the decision record and tests. Avoid maintaining multiple speculative architectures.

Ask the user when a change would reduce baseline scope, change the accepted desktop/UI direction, remove user data, or require an external purchase/publication decision. Ordinary reversible implementation choices and bug fixes are part of the task and should proceed.

Keep review records concise. Strong architecture comes from enforced ownership and meaningful evidence, not a large number of planning documents. After this handoff, development should primarily produce working capability slices.

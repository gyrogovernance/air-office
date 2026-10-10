# 01. Product, scope, and acceptance

## 1. Product definition

AIR Studio is an open source workspace for reading, writing, investigating, and reviewing material with AI assistance. It supports research, policy work, evidence management, and governance analysis across domains. AI safety is an important application, not a restriction on what the workspace or THM can examine.

Users work with durable files and documents. Conversations help them inspect sources, draft material, compare models, and invoke tools. Outputs can become editable documents, proposed patches, exports, and review records with source provenance. Users can inspect what was supplied to a model and distinguish quotations, generated conclusions, and human decisions.

The first release must be useful as an everyday application and distributable as desktop installers. Future expansion should add capabilities through stable module interfaces rather than invent another storage system or navigation model.

## 2. Main workspace

The default layout is permanent in concept and adjustable in size:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Workspace switcher   Search   Active work / jobs   Settings            │
├───────────────┬──────────────────────────────────┬───────────────────┤
│ Files         │ Open document tabs               │ Chat / model      │
│ Collections   ├──────────────────────────────────┤ selector          │
│ Conversations │ Editor, source preview, or       │                   │
│ Methods       │ side-by-side comparison          │ Conversation      │
│               │                                  │ Sources / tools   │
│               │                                  │                   │
│               │                                  │ Context + input   │
├───────────────┴──────────────────────────────────┴───────────────────┤
│ Saved / unsaved / external change   Background work   Connection      │
└──────────────────────────────────────────────────────────────────────┘
```

The explorer supports actual authorized folders, workspace-owned documents, and collections without pretending that virtual collections are operating system directories. The center supports text/code editing, rich notes, PDF/source preview, image preview, review results, and split views. The chat pane can collapse, resize, or switch conversations without discarding editor state.

Selecting text can attach the selection to a conversation or review. The attachment identifies the file, version, and selected range. Attaching a document or collection displays its scope and estimated context cost. The app does not silently send the entire workspace to a provider.

AI-proposed edits open a diff against a known file version. Applying an edit is a distinct user action. If the file changed, the app offers a conflict resolution view and preserves both the draft and proposed patch.

## 3. Release feature baseline

These stable requirement IDs must appear in the implementation catalog and its acceptance scenarios. All rows belong to the first public product baseline. They can be developed sequentially. A scope change requires an explicit user decision.

| ID | Capability | Required behavior |
| --- | --- | --- |
| F-001 | Desktop workspace | Install, launch, reopen last workspace, resize/collapse panels, restore tabs, work without a local account requirement. |
| F-002 | Files and editing | Authorized folder access; create/open/rename/move/delete with recovery policy; text and code editing; search; dirty buffers; external change detection; safe saves; recoverable drafts. |
| F-003 | Rich documents | Rich notes, structured headings/lists/tables, Markdown and LaTeX rendering, source-aware editing, explicit export/import fidelity, durable attachments. |
| F-004 | Conversations | Streaming, stop, retry, edit-and-branch, history/search, attachments, source citations, tool progress, durable partial results and clear errors. |
| F-005 | Providers and models | Ollama and OpenAI-compatible endpoints; representative hosted provider adapter; model discovery/configuration; per-model capability handling; secrets outside frontend storage. |
| F-006 | Knowledge | Collections, upload/folder ingestion, extraction/OCR, chunking, embeddings, vector and text search, grounded answers, inspectable source locations, index rebuild/cancel/resume. |
| F-007 | Methods | Model presets, prompts, reusable skills, versioned instructions, import/export, starter methods, editable copies without overwriting user changes. |
| F-008 | Review workflows | Five original AI Inspector review methods; THM three-pass execution; source/run provenance; human verification state; editable/exportable results. |
| F-009 | Tools and integrations | Built-in tools; schema-validated calls; OpenAPI and MCP connections; capability grants; progress, cancellation, errors, and write approval. |
| F-010 | Web research | Configurable search provider, fetch/read sources, capture URL/time/content provenance, add captures to documents or knowledge. |
| F-011 | Model comparison/playground | Side-by-side model runs, independent cancellation/errors, provider parameters, reusable results, separate context disclosure. |
| F-012 | Images and capture | Configurable image generation/editing; image attachments and previews; microphone and camera/video capture where supported; configurable transcription/speech. |
| F-013 | Automation/calendar | Scheduled prompts/workflows, schedule timezone and missed-run policy, inspectable run history, calendar events/recurrence, visible runtime requirements. |
| F-014 | Memory | Explicit optional memory, inspect/edit/delete, scope controls, visible inclusion in model context, full disable and deletion behavior. |
| F-015 | Shared workspaces | Hosted sign-in, profiles, groups, permissions, shared collections/documents, channels, invitation/access revocation, concurrent edit conflict handling. |
| F-016 | Portability | Document and conversation export, workspace export/import, source and method provenance, backup/restore, data format versioning. |
| F-017 | Operations | Background job status, useful local diagnostics, architecture/status tools, migration recovery, usable offline/error states, signed release path. |

Web-hosted operation uses the same service contracts and React application. Native file access, keychain, and desktop capture are adapters. Desktop is the primary delivery target; shared hosting is an implemented deployment mode, not an unrelated future rewrite.

Features needing a provider must show a setup flow when unconfigured. The release report identifies which providers were tested live and which were tested with fixtures. Network dependency is visible. Offline editing, local history, and viewing already stored material remain usable.

## 4. Original review methods and starter material

Preserve the original meaning and provenance of these methods:

| Method | Required result |
| --- | --- |
| Policy Auditing | Traceable claims, evidence, relationships, gaps, and explicit limitations. |
| Policy Reporting | Attributed synthesis and recommendations distinguishable from quoted material. |
| Meta-Evaluation | THM detection, processing/consolidation, and treatment, as three recorded passes. |
| Text Sanitization | Cleaned text preserving meaning and language; no invented diagnosis or unsupported substantive additions. |
| Quality Improvement | Editorial improvements with reviewable changes and preserved source meaning. |

Each run records the exact source version/hash, method version, model/provider identity, settings that affect output, prompt provenance, pass status, timestamps, errors, and human verification status. Preserve successful earlier passes when a later pass fails. A provider length limit or content filter stops the affected workflow visibly; it does not silently manufacture a complete result.

The current Studio rejects review input above 200,000 characters. Preserve an explicit input limit and refusal behavior until an intentional versioned change introduces document segmentation. A segmentation workflow must retain source locations and explain the aggregation method. Character limits do not guarantee that a provider context window can fit the request.

Starter material includes four model presets, nine prompts, four skills, a glossary, and five reference collections containing eight reference files. Verify the exact source asset inventory before importing it. The collections cover the EU AI Act, NIST AI RMF, NIST Generative AI Profile, OECD AI Principles, and four THM documents. Record edition, source URL, content hash, and applicable redistribution notice per file.

Seed installation is idempotent. Updating a starter pack must preserve user edits and intentional deletions. Offer an updated upstream copy with a diff or new version, rather than silently replacing personalized methods or documents.

The current app's model-generated locators are not independently verified merely because they appear in structured output. The new app should resolve source anchors where possible and explicitly label unresolved references. Review conclusions always remain model-generated until a human verifies them.

## 5. Core user journeys

Each journey must work through the real application service and survive the relevant restart or error:

- **A-001: Writing.** Open a folder, create a document, write in the center, reopen the app, recover an unsaved draft, save, then handle an external change without losing text.
- **A-002: Assisted editing.** Select a paragraph, ask for an edit, inspect the disclosed context and proposed diff, apply it, undo it, and reject a stale proposal after an external change.
- **A-003: Long conversation.** Stream a long answer, invoke a tool, interrupt, retry into a branch, reopen the conversation, and search older messages without loading its entire history into the interface.
- **A-004: Knowledge.** Ingest representative PDF/Office/HTML/text material, inspect extraction and OCR warnings, ask a grounded question, open its cited source location, cancel/restart indexing, and change embedding models without mixing incompatible vectors.
- **A-005: Review.** Run each method on a versioned source. For THM inspect all three passes, simulate failure on pass two, retain pass one, and export a report containing provenance and verification status.
- **A-006: Integration.** Connect a tool server, inspect its permission requests, run a read tool, deny a write, approve a specific edit, and cancel a failed/slow operation.
- **A-007: Research and comparison.** Capture a web source, compare two configured models against it, preserve individual run failures, and move a useful result into an editable document.
- **A-008: Scheduling.** Schedule a workflow in a timezone with daylight-saving transitions, close/reopen desktop, apply the chosen missed-run policy, and inspect actual job history.
- **A-009: Shared access.** Share a collection with a group, retrieve from it as a permitted user, revoke permission, and demonstrate that chat, search, citations, queued jobs, and exports cannot expose the revoked material.
- **A-010: Portability.** Export a workspace, import it into a fresh installation, restore a backup, and retain source/method references without carrying provider secrets.
- **A-011: Media.** Configure supported media adapters, generate/edit an image, capture/transcribe audio, attach a video capture, recover from denied device permission, and export produced files.
- **A-012: Clean installation.** Install on a machine without development runtimes, complete setup, use files/chat/knowledge, update, and uninstall without unexpected deletion of user documents.

## 6. Interaction quality

Use one component system, icon set, typography scale, spacing scale, and interaction vocabulary. Every operation has appropriate loading, empty, failed, cancelled, and permission-denied states. Background work must not block typing. Keyboard access, visible focus, accessible names, contrast, screen reader announcements, and reduced motion are acceptance requirements.

Support keyboard navigation between panes, document tabs, explorer entries, search results, and chat messages. User-facing error messages explain the failed action and a recovery step. Diagnostic detail can be expanded or copied in redacted form.

A rich editor must not silently destroy Markdown syntax, comments, or document constructs that its rich view cannot represent. Unsupported formats open in preview or source mode with explicit conversion choices. User files keep their own names; repository naming conventions do not rename imported research material.

## 7. Boundaries of this release

Do not bring back diagnostic scores, GyroDiagnostics, Rapid Test, or Arena as invented quality claims. A separate evaluation platform, enterprise LDAP/SCIM provisioning, arbitrary code terminals, the previous Computer companion, and multi-node orchestration are not existing requirements for this build. Interfaces may accommodate future additions without implementing speculative systems now.

This is not permission to remove any item in the feature baseline. If a capability is ambiguous, implement its concrete behaviors listed here and record the assumption. For example, video capture means capturing and attaching supported media, not inventing a video conferencing platform.

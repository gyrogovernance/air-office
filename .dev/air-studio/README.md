# AIR Studio: independent application build specification

**Specification date:** 10 October 2026. **Status:** ready for implementation; application not implemented by this bundle.

This is a portable handoff for building a new, independent, open source AI workspace. It specifies the finished product, its architecture, the rules that development tools must enforce, and the evidence required to release desktop installers. Open WebUI is a useful behavioral reference. Its source structure and complete feature parity are not the definition of success.

The product is a serious research and governance workspace: files on the left, an editable workspace in the center, and AI conversations on the right. Documents, knowledge retrieval, tools, review workflows, and long conversations are first-class capabilities. The design supports continued expansion without replacing the foundations.

## Give this to an implementation AI

Give the AI this entire directory, then paste [AI-START.prompt.md](AI-START.prompt.md). Use a new repository or an explicitly designated empty destination. The existing Studio repository is reference material and must be preserved.

Read the documents in this order:

1. [Product and acceptance scope](01-product.plan.md).
2. [Architecture and domain ownership](02-architecture.plan.md).
3. [Repository structure and naming](03-repository.plan.md).
4. [Development tools and architectural enforcement](04-tooling.plan.md).
5. [Testing and desktop release](05-verification-release.plan.md).
6. [Implementation sequence and completion rules](06-execution.plan.md).
7. [Sources, provenance, and unresolved implementation choices](sources.reference.md).

Supporting material:

- [Module manifest schema](schemas/module-manifest.schema.json) and [knowledge module example](examples/knowledge.module.example.json).
- [Task record schema](schemas/task-record.schema.json) and [bootstrap task example](examples/bootstrap.task.example.json).
- [Verification record schema](schemas/verification-record.schema.json) and [verification example](examples/verification-record.example.json).
- [Machine-readable naming-role seed](examples/role.catalog.example.json), to turn the naming policy into executable checks.
- [Repository AI instructions template](templates/AGENTS.template.md).
- [Specification validation record](CHECKS.reference.md), including the limits of those checks.

## Decisions already made

| Area | Decision |
| --- | --- |
| Desktop host | Tauri 2; native operating system webviews |
| Interface | React, TypeScript, Vite; one design system |
| Application service | Bun, packaged as a desktop sidecar |
| Document/ML compatibility | Managed Python workers behind typed interfaces |
| Local data | SQLite; sqlite-vec subject to a packaged compatibility probe |
| Hosted data | PostgreSQL and pgvector adapters for shared deployments |
| Text/code editor | CodeMirror 6 |
| Rich document editing | Tiptap/ProseMirror with explicit canonical document storage |
| Main layout | File explorer left; tabbed/split editing center; chat right |
| Development model | Modular monolith with enforced public interfaces; complete vertical features |
| Source ownership | Independent implementation; dependency and content licenses recorded |

React controls the interface. Tauri controls desktop integration and packaging. Bun runs the application service and development tooling. None replaces the others. Python remains available where its document and ML ecosystem is useful.

## How this specification stays usable

The implementation must generate its own concise repository map, ownership map, dependency graph, and verification status from actual files. This document describes those tools; it does not claim they already exist.

Module manifests describe declared architecture. Static checks and runtime tests check whether the implementation follows it. Verification records describe what was actually exercised on a particular source state and operating system. These three sources must never be treated as interchangeable.

The numbered documents are the normative specification. Examples are illustrative and deliberately contain no passing implementation results. Resolve a conflict by recording the decision and changing the relevant specification, rather than silently following whichever text was read last.

## Release meaning

The first public release is a complete workspace against the feature baseline in the product document. Internal implementation milestones are not public releases. A provider-dependent feature may require user configuration, but its implementation, error handling, and tests must exist. A disabled button, empty panel, or mock response is not implementation.

Desktop release means installers that work on clean supported machines without developer installations of Bun, Node, Python, or Rust. Compiling each operating system package still requires the appropriate build environment and signing process. Shared application source does not imply one universal binary.

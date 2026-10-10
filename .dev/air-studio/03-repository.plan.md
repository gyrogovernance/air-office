# 03. Repository structure, names, and public boundaries

## 1. Conventions with enforceable meaning

There is no universal filesystem naming standard that provides architectural ownership. Use portable names, a fixed role vocabulary, package export boundaries, machine-readable ownership, and automated checks together. Borrow feature grouping and public API principles from established style guides; this architecture is not a claim of full Feature-Sliced Design compliance.

Source path segments use lowercase ASCII kebab-case. A TypeScript filename has the form `<subject>.<role>.ts` or `<subject>.<role>.tsx`. The subject describes the domain concept. The role describes what the file does. Names such as `misc`, `stuff`, `helpers`, `utils`, `common`, `manager`, `new`, `final`, and `v2-final` are prohibited as escape hatches.

This applies to repository-owned source. Imported documents, user workspaces, translated content, third-party vendored files, and generated artifacts have explicit different policies. Do not rename a user's file to satisfy the source linter.

## 2. Canonical tree

Create only the directories needed by an implemented slice. This tree describes the destination architecture, not a requirement to generate empty scaffolding everywhere on day one.

```text
studio/
  AGENTS.md
  README.md
  package.json
  bun.lock
  tsconfig.json
  architecture/
    architecture.policy.json
    domain.catalog.json
    feature.catalog.json
    role.catalog.json
    runtime.catalog.json
    schemas/
      module-manifest.schema.json
      task-record.schema.json
      verification-record.schema.json
    decisions/
      adr-0001-desktop-runtime.decision.md
    exceptions/
      architecture.exceptions.json
  apps/
    desktop/
      package.json
      src-tauri/
        Cargo.toml
        Cargo.lock
        tauri.conf.json
        capabilities/
          desktop-default.capability.json
        src/
          main.rs
          lib.rs
          service_supervisor_adapter.rs
          credential_broker_adapter.rs
        binaries/
    web/
      package.json
      index.html
      src/
        workspace-shell.component.tsx
        application.composition.tsx
        application.entry.tsx
        application.styles.css
    service/
      package.json
      src/
        application.entry.ts
        application.composition.ts
        application-router.route.ts
        service-lifecycle.service.ts
  packages/
    contracts/
      package.json
      module.manifest.json
      src/
        chat/
          chat-run.schema.json
          chat-event.schema.json
        generated/
          chat-run.generated.ts
    ui-kit/
      package.json
      module.manifest.json
      src/
        button.component.tsx
        document-tabs.component.tsx
        theme.tokens.css
        ui-kit.ui.public.ts
    knowledge/
      package.json
      module.manifest.json
      README.md
      src/
        domain/
          collection.entity.ts
          embedding-index.entity.ts
          retrieval-policy.policy.ts
        application/
          retrieve-context.use-case.ts
          knowledge-store.port.ts
          source-access.port.ts
        adapters/
          service/
            sqlite-knowledge-store.adapter.ts
            knowledge-http.route.ts
          ui/
            collection-panel.component.tsx
            knowledge-query.hook.ts
        knowledge.domain.public.ts
        knowledge.service.public.ts
        knowledge.ui.public.ts
      tests/
        retrieval-policy.unit.test.ts
        knowledge-store.contract.test.ts
        indexing-restart.integration.test.ts
    files/
    chat/
    # Other implemented capabilities follow the same module grammar.
  workers/
    documents/
      pyproject.toml
      uv.lock
      worker.manifest.json
      src/studio_documents/
        __init__.py
        main.py
        extraction_handler.py
        docling_adapter.py
        worker_protocol.py
      tests/
        test_docling_adapter.py
  tools/
    studio-cli/
      package.json
      src/
        studio-cli.entry.ts
        repository-map.command.ts
        architecture-check.command.ts
        verification-status.command.ts
  tests/
    browser/
      workspace-editing.browser.test.ts
    desktop/
      clean-install.desktop.test.ts
    fixtures/
      documents/
        corpus.fixture.json
    architecture/
      forbidden-import.fixture.ts.txt
  tasks/
    task-0001-desktop-file-edit.task.json
  docs/
    product/
    architecture/
    development/
    release/
  reports/                  # Generated; normally ignored by Git.
  third-party/
    content-manifest.json
    notices/
```

Domain package names are exactly the module IDs in the architecture document. New package names require a new catalog entry and owner. `files` and `documents` are distinct because filesystem operations and source/extraction identity have different rules; the documentation must retain this distinction.

## 3. Allowed source roles

Keep the role catalog machine-readable. The initial vocabulary is:

| Suffix | Meaning | Normal location |
| --- | --- | --- |
| `.entity.ts` | Domain entity/value object and its invariants | `domain` |
| `.policy.ts` | Pure domain decision rule | `domain` |
| `.event.ts` | Domain event definition | `domain` |
| `.port.ts` | Interface required by an application use case | `application` |
| `.use-case.ts` | One named application operation | `application` |
| `.adapter.ts` | Implementation of a port for an external dependency | `adapters/service` |
| `.route.ts` | HTTP/stream transport binding and input/output translation | `adapters/service` or service composition |
| `.service.ts` | Runtime lifecycle orchestration with explicit responsibility | composition/runtime; not generic business dumping ground |
| `.component.tsx` | React presentation component | `adapters/ui` or ui-kit |
| `.hook.ts` | React hook with a defined interaction/query responsibility | `adapters/ui` |
| `.store.ts` | Scoped frontend state store; not authoritative domain persistence | `adapters/ui` |
| `.public.ts` | Explicit runtime-specific public exports | module `src` root |
| `.composition.ts(x)` | Dependency construction and wiring | application composition root |
| `.entry.ts(x)` | Executable/bootstrap entry | application/tool |
| `.command.ts` | Developer CLI command | studio-cli |
| `.generated.ts` | Generated output with source header; never edited manually | `generated` |
| `.schema.json` | Canonical external schema | contracts/architecture |
| `.fixture.json` | Test data descriptor | tests/fixtures |
| `.unit.test.ts` | Pure/isolated behavioral test | module tests |
| `.contract.test.ts` | Shared adapter/interface conformance test | module tests |
| `.integration.test.ts` | Real dependency integration | module tests |
| `.browser.test.ts` | Browser interaction test | tests/browser |
| `.desktop.test.ts` | Native desktop/package interaction test | tests/desktop |

Use `.styles.css` for component/application styles and `.tokens.css` for design tokens. SQL migrations use `<sequence>-<module>-<operation>.migration.sql`, for example `0007-knowledge-add-index-generation.migration.sql`. Never edit a released migration; add a new one.

Rust and Python use their language's valid naming conventions. Rust role files use snake_case subjects followed by the role, such as `service_supervisor_adapter.rs`; conventional `main.rs`, `lib.rs`, and `mod.rs` are allowed. Python uses `docling_adapter.py`, `extract_document_handler.py`, and `test_docling_adapter.py`. Python importable filenames cannot contain hyphens or dotted role suffixes. Register these language-specific grammars instead of forcing TypeScript rules onto them.

Fixed tool filenames such as `package.json`, `README.md`, `AGENTS.md`, `Cargo.toml`, `Cargo.lock`, `pyproject.toml`, `uv.lock`, `index.html`, `__init__.py`, and tool configuration files are exact-name exceptions in the role catalog. Adding an exception requires a reason; a permissive regex for everything defeats the rule.

Check path case collisions, Windows reserved device names, trailing dots/spaces, excessively long generated paths, and nonportable characters. Git on one machine must not accept two files that become the same path on another supported platform.

## 4. Module manifest

Every present module has `module.manifest.json` validated against the supplied schema. The manifest declares:

- Stable ID, purpose, kind, and lifecycle status.
- Owned entities and database table prefixes.
- Runtime-specific public entrypoints.
- Allowed foundation imports and required capability ports.
- Contract IDs and emitted/consumed event IDs.
- Owned feature IDs, acceptance scenario IDs, and documentation locations.

It describes architecture, not test success. Verification comes from execution records. `active` means the module participates in the app; it does not mean all its scenarios pass.

The checker verifies that declared files exist, exports match package maps, ownership is unique, imports comply, and declared scenarios map to real tests or explicit not-yet-implemented records. A manifest is not proof merely because it validates as JSON.

## 5. Public interface and dependency rules

Package `exports` maps expose only the documented `/domain`, `/service`, and `/ui` entrypoints that the package actually supplies. Public files use explicit named exports. Do not expose every internal file through a wildcard barrel.

Use relative imports within a module. Use package aliases at permitted external boundaries. Ban relative traversal into another package, deep imports bypassing export maps, UI imports of service code, domain imports of runtime implementations, and cyclic dependencies.

Use dependency-cruiser for the import graph, ESLint for syntax-level restrictions, TypeScript project boundaries for type checking, and package exports for consumer resolution. Include TypeScript precompilation/type-only dependencies in architecture analysis. Validate behavior with deliberately invalid fixtures so an incorrectly configured checker cannot silently certify everything.

SQL access is private to owner adapters. Enforce table ownership in migration metadata and adapter tests. Static import checks alone cannot prove SQL isolation. Database query APIs must not hand arbitrary connections to every module. Central migration coordination can apply module migrations without becoming the owner of every table.

## 6. Module creation and extension recipe

`studio module create <id> --kind capability` validates the name and catalog entry, creates the minimum manifest/README/domain/application/public files needed for the requested capability, and registers exports. It does not invent entities, fake tests, or fill a feature with TODO implementations.

For a new capability:

1. State the user behavior and stable feature/scenario IDs.
2. Check existing domain owners before introducing an entity.
3. Define the public contract and required ports.
4. Add the owner manifest, use case, real adapter, and UI entry.
5. Add migration and authorization behavior if state is introduced.
6. Add meaningful domain/integration/UI tests for the behavior.
7. Run impact checks and inspect generated ownership/status output.
8. Update the product catalog and a relevant ADR only if an architectural decision changed.

An AI should be able to locate a capability through its module ID, public interface, entities, and scenarios without reading the whole repository. Documentation is colocated with the owner and linked by generated maps.

## 7. Maintainability without ceremony

Warn on unusually large source files, excessive complexity, broad public APIs, and unbounded dependency fan-out. Start with a 400-line file warning and a reviewed higher threshold rather than mechanically splitting every file at an arbitrary line count. Generated files and fixtures have explicit exemptions.

Require an ADR for ownership changes, public contract breaks, storage authority changes, native permission changes, security boundary changes, and runtime replacements. Routine components and bug fixes do not need new ADRs. A short rationale with alternatives and consequences is sufficient.

An exception contains its rule ID, affected paths, reason, owner, review/expiry date, and ADR link when needed. Expired exceptions fail checks. No blanket `ignore everything under this folder` without an explicit third-party/generated-code reason.

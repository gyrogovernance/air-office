# Sources, provenance, and implementation decision register

## 1. Evidence level

Prepared from the current Studio README, product/development/data notes, starter pack documentation and manifests, and official upstream documentation checked on 10 October 2026. This is an implementation specification, not a compatibility certification of a new application.

The initial stack is a considered selection for this product. Exact dependency versions, minimum operating systems, and cross-platform packaging compatibility must be fixed and demonstrated during bootstrap. The plan intentionally does not invent a tested version matrix.

## 2. Existing Studio reference material

When available, use these paths in the existing reference repository. They are not required runtime dependencies of the new application:

| Reference path | What it establishes |
| --- | --- |
| `README.md` | Product purpose, audience, features, research/review workflow, desktop positioning. |
| `dev/01_Product.md` | Product baseline and exclusions. |
| `dev/02_Development.md` | Current fork's structure and actual integration points. |
| `dev/03_Data.md` | Native records, gadget payloads, input limits, source provenance, current locator limitations. |
| `dev/04_Notes.md` | Current project decisions/status; distinguish dated checks from current verification. |
| `backend/open_webui/studio/data/README.md` | Starter inventory, idempotent installation, source editions and notices. |
| `backend/open_webui/studio/data/workspace-v1.json` | Four presets, nine prompts, four skills and original instruction text. |
| `backend/open_webui/studio/data/gadgets-v1.json` | Five tool methods and extracted prompt provenance. |
| `backend/open_webui/studio/data/frameworks-v1.json` | Five collections, eight files, source URLs, hashes, retrieval dates, reuse terms. |
| `backend/open_webui/studio/gadgets.py` | Existing pass execution and failure behavior to understand, not source to copy wholesale. |
| `LICENSE`, `LICENSE_HISTORY`, `desktop/LICENSE` | Separate source/wrapper notices that must not be silently reassigned. |

The inspected repository was on `main`, at commit `ba08b44d3` (Alpha). That identifies the reference snapshot, not a new application build. Verify assets against their recorded hashes before importing them.

The prompt provenance record identifies `gyrogovernance/apps`, `src/lib/prompts.ts`, package 1.2.0, recorded checkout `6cc030a98bed32a23dbb0491c9a67e9137396165`, and extracted source hash `0b5f0595865cabe7f8017637119e5c215b8c732ef00ec075e5937683cb043f58`. Preserve the bundled source MIT notice. Do not infer that every file in the current fork shares that license.

## 3. Official technical references

### Desktop and runtimes

- [Tauri sidecars](https://v2.tauri.app/develop/sidecar/): external executables, target-specific resource names, and permissions.
- [Tauri distribution](https://v2.tauri.app/distribute/): per-platform packages and signing/distribution workflows.
- [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/): platform webview differences and dependencies.
- [Tauri WebDriver guidance](https://v2.tauri.app/develop/tests/webdriver/): current WebdriverIO embedded driver route across Windows/Linux/macOS; direct tauri-driver restrictions differ.
- [Bun workspaces](https://bun.com/docs/pm/workspaces): monorepo dependency/workspace support.

These documents support the architectural options, not a guarantee that any selected combination of native extensions and worker resources will package successfully. That is what the early resource probe tests.

### Architecture and developer tools

- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12): canonical schema dialect for manifests and external contracts.
- [Feature-Sliced Design public API guidance](https://feature-sliced.design/docs/reference/public-api): public interfaces and encapsulation principles.
- [Feature-Sliced Design slices and segments](https://feature-sliced.design/docs/reference/slices-segments): semantic grouping principles. The proposed domain/ports architecture uses its own explicit rules.
- [Angular style guide](https://angular.dev/style-guide): familiar naming and feature-grouping principles; no Angular dependency is proposed.
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser): dependency rules, cycle detection and graphs.
- [dependency-cruiser options](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md): include TypeScript precompilation dependencies so type-only imports are checked.
- [Knip workspace support](https://knip.dev/features/monorepos-and-workspaces): unused dependency/export/file checks need real entrypoint/workspace configuration.
- [Playwright test projects](https://playwright.dev/docs/test-projects): browser matrices; these do not stand in for native Tauri installation testing.

### Editing, providers, and documents

- [CodeMirror guide](https://codemirror.net/docs/guide/): modular text editor architecture.
- [Tiptap documentation](https://tiptap.dev/docs): open source editor core and separately offered Pro/Cloud capabilities; use open source components and define storage/conversion fidelity explicitly.
- [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction): viewport virtualization candidate; storage pagination and cache bounds remain application responsibilities.
- [AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling): candidate provider/tool orchestration library behind Studio ports; validate required providers and runtime behavior before adopting.
- [Docling supported formats](https://docling-project.github.io/docling/usage/supported_formats/): document worker candidate; format support requires packaged quality tests.
- [sqlite-vec JavaScript/Bun integration](https://alexgarcia.xyz/sqlite-vec/js.html): extension integration and macOS SQLite loading considerations.
- [pgvector](https://github.com/pgvector/pgvector): hosted PostgreSQL vector adapter candidate.

Use maintained libraries for these responsibilities. Do not rewrite a document parser, editor engine, accessibility primitive library, vector index, or desktop updater merely to keep source code in one language.

## 4. Open source and content policy

Default to MIT for new Lab-authored application source, with an explicit copyright holder and contributor policy. Preserve each dependency's actual license. Record source origin, license, version/hash, redistribution conditions, and notice location for every reused code/content/model pack. The source license does not relicense bundled content or third-party binaries.

The existing fork's license contains an Open WebUI branding condition. Building independent source is the proposed direction; do not treat renaming files, AI translation, or copying implementation into new components as proof of independent origin. Study user-visible behavior and public interfaces, then write the new implementation. Keep an origin record for reused artifacts and resolve material license uncertainty before distributing them.

Original AI Inspector prompts have a separately recorded MIT source notice. THM framework material retains its [CC BY-SA 4.0 terms](https://creativecommons.org/licenses/by-sa/4.0/) and attribution. [Canonical THM material](https://github.com/gyrogovernance/tools/tree/main/docs/the_human_mark) must remain distinguishable from application code and user adaptations.

Existing reference documents carry their respective publisher terms: [NIST reuse information](https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications), [EUR-Lex legal notice](https://eur-lex.europa.eu/content/legal-notice/legal-notice.html), and [OECD terms](https://www.oecd.org/en/about/terms-conditions.html). Preserve the manifest's instrument-specific restrictions. If a paid distribution conflicts with a bundled content condition, offer the separately obtained source through a compliant acquisition path instead of silently changing its notice.

## 5. Resolve by executable probe during bootstrap

These are bounded implementation choices, not reasons to postpone building:

| Decision | Default direction | Required evidence |
| --- | --- | --- |
| Bun HTTP routing | Maintained lightweight Bun-compatible router | Validated contract route, authenticated stream, cancellation and packaged launch. |
| Local vectors | sqlite-vec | Real insert/search/reopen in installed target package, including macOS. |
| Extraction | Docling worker with explicit OCR resources | Corpus extraction, source anchors, resource size/license and packaged startup. |
| UI primitives | One accessible React primitive/component stack with owned tokens | Keyboard/focus/theme consistency; no competing design systems. |
| Provider abstraction | Narrow Studio ports; adopt AI SDK only where it fits | Representative stream/tool/cancellation/error conformance in Bun. |
| Native tests | Tauri WebdriverIO embedded route | Pinned integration runs on actual target; production driver absence verified. |
| Schema type generation | Maintained JSON Schema to TS/Python generator | Equivalent runtime validation, generated drift check, no duplicate hand-edited external types. |
| Native DTO generation | Small typed Rust/native boundary | Generated frontend binding or equivalent checked schema parity; avoid broad domain duplication in Rust. |
| Minimum OS/package formats | Pinned stack's supported requirements | Clean install matrix and documented webview/native resource prerequisites. |

Record the selected versions and outcomes in concise ADRs and runtime metadata. Choose a compatible adapter when a probe fails; retain the user capability and its acceptance scenario.

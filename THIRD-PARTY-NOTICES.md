```
▐██████ ▐██ ▐██████      ▐██████ ▐██████ ▐██████ ▐██ ▐██████ ▐██████
▐██ ▐██ ▐██ ▐██ ▐██      ▐██ ▐██ ▐██     ▐██     ▐██ ▐██     ▐██    
▐██████ ▐██ ▐██████      ▐██ ▐██ ▐████   ▐████   ▐██ ▐██     ▐████  
▐██ ▐██ ▐██ ▐██▐██       ▐██ ▐██ ▐██     ▐██     ▐██ ▐██     ▐██    
▐██ ▐██ ▐██ ▐██ ▐██      ▐██████ ▐██     ▐██     ▐██ ▐██████ ▐██████
```

# Third-party notices

This file attributes software, fonts, artwork, documentation, and runtime
components that AIR Office redistributes or depends on. It is the human-readable
companion to:

- [`LICENSE`](LICENSE): license for AIR Office's own source
- [`tools/third-party.catalog.json`](tools/third-party.catalog.json):
  machine-readable pins for catalogued npm packages
- bundled license texts under `assets/licenses/` and inside installed packages

`bun run office -- check` verifies that every catalogued package name and
license appears here, matches the installed package, and stays on the allowlist.

Trademarks and brand marks remain the property of their owners. Listing a
component does not imply endorsement.

---

## Catalogued npm packages

Exact versions and purposes are pinned in
`tools/third-party.catalog.json`. Each installed package ships its own
`LICENSE` (or equivalent) under the workspace `node_modules` tree.

| Package | Version | License | Registry |
| --- | --- | --- | --- |
| @assistant-ui/react | 0.15.28 | MIT | https://registry.npmjs.org/@assistant-ui/react |
| @fontsource/coiny | 5.3.0 | OFL-1.1 | https://registry.npmjs.org/@fontsource/coiny |
| @github/copilot-sdk | 1.0.28 | MIT | https://registry.npmjs.org/@github/copilot-sdk |
| @glass-sdk/liquid-glass | 0.0.2 | MIT | https://registry.npmjs.org/@glass-sdk/liquid-glass |
| @lexical/selection | 0.42.0 | MIT | https://registry.npmjs.org/@lexical/selection |
| @lobehub/editor | 4.23.1 | MIT | https://registry.npmjs.org/@lobehub/editor |
| @lobehub/ui | 5.64.2 | MIT | https://registry.npmjs.org/@lobehub/ui |
| @radix-ui/colors | 3.0.0 | MIT | https://registry.npmjs.org/@radix-ui/colors |
| @types/yauzl | 2.10.3 | MIT | https://registry.npmjs.org/@types/yauzl |
| @xyflow/react | 12.10.0 | MIT | https://registry.npmjs.org/@xyflow/react |
| antd | 6.6.6 | MIT | https://registry.npmjs.org/antd |
| boring-avatars | 2.0.4 | MIT | https://registry.npmjs.org/boring-avatars |
| jose | 6.2.12 | MIT | https://registry.npmjs.org/jose |
| lexical | 0.42.0 | MIT | https://registry.npmjs.org/lexical |
| motion | 12.43.0 | MIT | https://registry.npmjs.org/motion |
| react-aria-components | 1.22.1 | Apache-2.0 | https://registry.npmjs.org/react-aria-components |
| simple-icons | 16.35.0 | CC0-1.0 | https://registry.npmjs.org/simple-icons |
| streamdown | 2.7.0 | Apache-2.0 | https://registry.npmjs.org/streamdown |
| tar | 7.5.22 | BlueOak-1.0.0 | https://registry.npmjs.org/tar |
| typescript | 5.9.3 | Apache-2.0 | https://registry.npmjs.org/typescript |
| yauzl | 3.1.3 | MIT | https://registry.npmjs.org/yauzl |
| zod | 4.1.12 | MIT | https://registry.npmjs.org/zod |

### Notes on selected catalog packages

- **Chat and documents.** `@assistant-ui/react` provides chat primitives.
  `@lobehub/editor`, `@lobehub/ui`, `antd`, `motion`, `lexical`, and
  `@lexical/selection` support the rich-document editor. `streamdown` renders
  streaming markdown. `@xyflow/react` powers conversation branch overview.
- **Auth and validation.** `jose` validates ChatGPT sign-in ID tokens. `zod`
  validates Gyroscopic Reasoning episodic memory payloads.
- **UI system.** `@radix-ui/colors` feeds semantic theme scales.
  `react-aria-components` supplies the launcher calendar.
  `boring-avatars` draws deterministic avatars. `@fontsource/coiny` bundles the
  Coiny display font (full OFL text also at `public/licenses/coiny-OFL.txt`).
- **Desktop artifact prep.** `tar`, `yauzl`, and `@types/yauzl` extract pinned
  Lemonade archives at build time.
- **Copilot harness.** `@github/copilot-sdk` drives cloud chat and optional
  full-harness local sessions. Matching platform packages may materialize the
  Copilot CLI runtime (CLI 1.0.105 in this SDK snapshot); those binaries are
  MIT-licensed GitHub distributions, not separate catalog entries. Upstream:
  https://github.com/github/copilot-agent-runtime
- **Vendored glass.** Patched `@glass-sdk/liquid-glass` 0.0.2 is retained in
  `.vendor/liquid-glass-0.0.2.tgz` with notes in
  `.vendor/liquid-glass-VENDOR-PATCH.md`. Upstream:
  https://github.com/Glass-HQ/liquid-glass
- **Repository checks.** `typescript` powers the TypeScript compiler API used
  by office-cli import-boundary and related checks.
- **Connector marks.** Brand icons come from `simple-icons` (CC0-1.0). Brand
  names and logos remain subject to owner trademark guidelines. The Exa mark is
  from [theSVG](https://thesvg.org/icon/exa) (MIT).

Packages adopted before the catalog program keep their installed license files
in the same `node_modules` locations even when they are not listed above.

---

## Bundled fonts and artwork

### Coiny

Copyright 2015 Marcelo Magalhaes. SIL Open Font License 1.1. Bundled via
`@fontsource/coiny`; license also at `public/licenses/coiny-OFL.txt`.

### Caprasimo

Copyright 2023 The Caprasimo Project Authors. SIL Open Font License 1.1.
Bundled at `assets/fonts/caprasimo-latin-400-normal.woff2` and
`assets/fonts/caprasimo-latin-ext-400-normal.woff2`. License:
`assets/licenses/caprasimo-OFL.txt`.

### Momo Signature

Used for the Arcade wordmark via `@fontsource/momo-signature` 5.3.0.
SIL Open Font License 1.1. Font:
`assets/arcade/momo-signature-latin-400-normal.woff2`. License:
`assets/licenses/momo-signature-OFL.txt`.

### Microsoft Fluent Emoji

Compass, Raised hand, and Video game 3D artwork: copyright Microsoft
Corporation, MIT. Sources under
https://github.com/microsoft/fluentui-emoji. License:
`assets/licenses/fluent-emoji-MIT.txt`.

### Fluent UI System Icons

Copyright Microsoft Corporation. MIT license and NOTICE at
`assets/licenses/fluent-ui-system-icons-MIT.txt` and
`assets/licenses/fluent-ui-system-icons-NOTICE.txt`.

### LittleJS Arcade

LittleJS Arcade and engine, MIT, copyright their respective contributors.
Source commit `c14102b706a5f1bbedbbe5087706d6425660300c` of
https://github.com/KilledByAPixel/LittleJSArcade. License:
`assets/arcade/LICENSE`. Port notes: `assets/arcade/AIR-PORT.md`.

Twemoji artwork/font, copyright Twitter, Inc. and contributors, CC-BY-4.0:
https://creativecommons.org/licenses/by/4.0/. Attribution:
`assets/arcade/games/TWEMOJI-LICENSE.txt`.

---

## Native runtimes and desktop dependencies

### Lemonade

Embeddable Lemonade v2026.42.1, source commit
`2aedebc4858642b9dd51e21bdb2791e62b03408b`, staged by the desktop artifact
preparer from the pinned official portable archive. Apache-2.0 runtime license
text: `assets/licenses/lemonade-Apache-2.0.txt`.

Supported matching triples for build-time backend staging: Windows x64,
macOS arm64, Linux x64, and Linux arm64. Cross-target preparation records
`bundled: false` because backend install needs the target host. No model
weights are included. The browsing catalog at
`packages/providers/src/lemonade-models.catalog.json` is copied from Lemonade’s
`server_models.json` at the pinned commit and is covered by Apache-2.0.

The staged `llama.cpp` CPU backend (b11393) has separate attribution that must
ship with the backend and appear in the generated SBOM. Lemonade is not an npm
package and is outside the npm catalog check.

### Embedded Code-OSS workbench (code-server)

code-server 4.144.0, MIT, copyright Coder Technologies, Inc. and contributors.
https://github.com/coder/code-server/releases/tag/v4.144.0

Pinned desktop archives (SHA-256):

| Target | Digest |
| --- | --- |
| Windows amd64 | `324b7e31a2fb60c4e50202fdeae5e5cc5615878647973963874dea61d73ad9f7` |
| Linux amd64 | `710f749c40a0f3d0ab3be09c0de65314e5c2907cc50646f5fbc0f24c0e8fba2d` |
| Linux arm64 | `4404c784f541bd56a2a8d6e2a9474ed0b4e37bc8502aa3a247898ca933434482` |
| macOS amd64 | `cb03ed6ce12136f9f9d6f32fd5d780b991d96cf0dd1b3d590c16d73accc665c9` |
| macOS arm64 | `ebd78e944b9e918c0a1ca4239688c0e7a27096955dbf8ea98c3cad9668bc4fcc` |

Bundled notices ship inside the staged `resources/code-server` tree
(`LICENSE`, `ThirdPartyNotices.txt`).

### Workbench Open VSX extensions

Staged under `resources/code-server/bundled-extensions`:

| Extension | Version | Notes |
| --- | --- | --- |
| ms-python.python | 2026.4.0 | MIT, Microsoft; SHA-256 `232aeafb01f069824fdd92d3e628c1c442bbcfa1d3cc945ff97076340bb2b4a6` |
| vscode.typescript-language-features | 1.95.3 | Microsoft; license inside the VSIX (`LICENSE-vscode.txt`); SHA-256 `b1494642a46d1b139ab799e2ee0ae2453bdcef6ed1a718acca034445cfd9d87f` |
| dbaeumer.vscode-eslint | 3.0.34 | MIT, Microsoft; SHA-256 `ca5334d46f6a39079e751ef4601bfc9f86bc3a46483e87291ec609239d161308` |

### Search worker certificate trust patch (Primp)

Primp 2.0.1+air.1 is a local MIT patch of Primp 2.0.1. Source and licenses:
`.vendor/primp-2.0.1-air.1.tar.gz`. Patch notes: `.vendor/primp-VENDOR-PATCH.md`.
The worker supplies Certifi 2026.10.19 (MPL-2.0) as an explicit CA bundle.

---

## Bundled documentation and standards

### UK AISI Inspect evaluation docs

Inspect documentation pages (datasets, solvers, scoring metrics, evaluation
logs), snapshot 24 October 2026, under
`packages/lab-pack/data/frameworks/inspect-*.md`. Copyright (c) 2024 UK AI
Security Institute. MIT. Full text in each document and
`packages/lab-pack/data/INSPECT-LICENSE.txt`. Upstream:
https://github.com/UKGovernmentBEIS/inspect_ai. Digests in
`packages/lab-pack/data/frameworks-v1.json`.

### TransformerLens guide

TransformerLensOrg, Getting Started with Mechanistic Interpretability,
snapshot 24 October 2026, commit `bd92bc444384a3df5d8881386bacc6030b0656b6`.
MIT, Copyright (c) 2022 TransformerLensOrg. Included in
`packages/lab-pack/data/frameworks/research-mechanistic-interpretability.md`.

### NIST publications

- Vassilev et al. (2025), Adversarial Machine Learning: A Taxonomy and
  Terminology of Attacks and Mitigations, NIST AI 100-2e2025,
  https://doi.org/10.6028/NIST.AI.100-2e2025
- Booth et al. (2024), Secure Software Development Practices for Generative AI
  and Dual-Use Foundation Models: An SSDF Community Profile, NIST SP 800-218A,
  https://doi.org/10.6028/NIST.SP.800-218A

Republished courtesy of NIST. Source PDFs are unchanged. Reuse terms:
https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications

### OWASP Secure Agent Playbook

Craft Standard and companion Knowledge packs from the
[OWASP Secure Agent Playbook](https://github.com/OWASP/secure-agent-playbook)
(commit `65d4efd2cd0b081d52101e9708792b944e4ddebb`, plugin 0.2.11), published by
the [Open Worldwide Application Security Project](https://owasp.org/). Bundled
under `packages/lab-pack/data/crafts/owasp-secure-agent-playbook.craft.json` and
`packages/lab-pack/data/frameworks/owasp-*`. Digests for Knowledge files are
recorded in `packages/lab-pack/data/frameworks-v1.json`.

- Playbook skills, agents, and plays: Creative Commons Attribution 4.0
  International (CC BY 4.0).
- AISVS, LLM Top 10, ASVS, MASVS, MASTG, and FIASSE extracts: Creative Commons
  Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
- OpenCRE extracts: Apache License 2.0.
- SecCodePrompts (theJonMccoy/SecCodePrompts), adapted in the playbook: MIT.
- Prompt-injection testing material credits the Arcanum Prompt Injection
  Taxonomy by Jason Haddix (Arcanum Information Security), CC BY 4.0:
  https://github.com/Arcanum-Sec/arc_pi_taxonomy

Upstream license texts remain authoritative for the original materials.

### NGO Agent Skills / NGO Playbook

Craft Standard and companion Knowledge packs from
[NGO Agent Skills](https://github.com/LijieZhou/ngo-agent-skills)
(commit `fc7864e3f9d468bd16ad9b8cbbd42f2777e0aab8`), published under Creative
Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). Bundled under
`packages/lab-pack/data/crafts/ngo-playbook.craft.json` and
`packages/lab-pack/data/frameworks/ngo-*`. Digests for Knowledge files are
recorded in `packages/lab-pack/data/frameworks-v1.json`.

Companion indexes for UN SDG goal titles, OECD-DAC evaluation criteria, and
UNDP digital public infrastructure guidance are AIR Office navigation notes that
cite official sources. Those publishers' own terms remain authoritative for
their publications.

Upstream license texts remain authoritative for the original materials.

---

## How this relates to other attribution files

| Document | Role |
| --- | --- |
| `LICENSE` | Terms for AIR Office’s own code |
| `THIRD-PARTY-NOTICES.md` (this file) | Human-readable attribution for third-party code and assets |
| `tools/third-party.catalog.json` | Exact npm pins enforced by `office -- check` |
| `assets/licenses/*` and package `LICENSE` files | Full license texts |
| Generated desktop SBOM / inventory | Runtime and backend files staged into installers |

A separate `NOTICE` file is sometimes used for Apache-style attribution
aggregates; this repository uses `THIRD-PARTY-NOTICES.md` as the single
public attribution entry point, with machine checks on the npm catalog.

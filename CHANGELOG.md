```
▐██████ ▐██ ▐██████      ▐██████ ▐██████ ▐██████ ▐██ ▐██████ ▐██████
▐██ ▐██ ▐██ ▐██ ▐██      ▐██ ▐██ ▐██     ▐██     ▐██ ▐██     ▐██    
▐██████ ▐██ ▐██████      ▐██ ▐██ ▐████   ▐████   ▐██ ▐██     ▐████  
▐██ ▐██ ▐██ ▐██▐██       ▐██ ▐██ ▐██     ▐██     ▐██ ▐██     ▐██    
▐██ ▐██ ▐██ ▐██ ▐██      ▐██████ ▐██     ▐██     ▐██ ▐██████ ▐██████
```

# Changelog

Notable changes to AIR Office. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.1.0-AIR_Office_Alpha] - 2026-10-10 to 2026-11-11

First public alpha. A local-first desktop workplace with notes, knowledge, chat and agents, local and cloud models, research Actions and Lab methods, desktop apps for Windows and Mac (Apple Silicon and Intel), and a pinned security review for releases.

### Workspace

- Programs and Projects hold notes, chats, and connected folders in one explorer.
- Knowledge collections support grounded retrieval; seeded references include the EU AI Act, NIST AI RMF and Generative AI Profile, OECD AI Principles, and The Human Mark.
- The OWASP Secure Agent Playbook ships as a Craft Standard (Off by default) with companion Knowledge packs (AISVS, LLM Top 10, ASVS, FIASSE, MASVS, MASTG, OpenCRE, SecCodePrompts, and full plays) installable from References.
- Rich notes use the Lobe editor with Markdown, math, attachments, and reviewable AI edit proposals.
- Calendar covers events and recurring automations.
- Today, Fellowship, Craft, Teams, Market, Compare, Media, and Arcade ship as workplace surfaces.
- Craft packages agents, prompts, skills, Actions, tools, and Knowledge as Standards and Products; Market installs models and reusable resources as editable copies.

### Chat, agents, and tools

- Chat runs on assistant-ui Elements with Streamdown rendering and Generative UI for structured tool and preview surfaces.
- Conversations support streaming, folders, attachments, search, and durable history.
- Cloud and Full-harness local models use the Microsoft Copilot SDK; default local chat uses a lean private path with shared permissions, memory, The Human Mark, and Gyroscopic Reasoning.
- Tools and connectors (including OpenAPI and MCP) can ask before changing work; credentials stay in the OS keychain.
- Web search, page fetch, memory, and ChatGPT sign-in are available from Settings and chat.

### Actions and Lab methods

- Specialized Actions include Quality Improvement, Policy Auditing, Policy Reporting, Meta-Evaluation, and Text Sanitization.
- The Human Mark ships in Knowledge and Guides; Gyroscopic Reasoning structures memory across sessions and Fellowship programs.
- Enabling the OWASP Secure Agent Playbook Standard adds 18 skills, 6 agents, and play-backed Actions without Market install or auto-scheduled scans.

### Code stage

- An embedded VS Code workbench (supervised code-server) opens trusted project folders beside chat, with shared roots for agent tools.

### Models and desktop host

- Local inference runs through embedded Lemonade; cloud and other compatible connections keep their own protocols.
- Settings manages connections and stored credentials without exposing secrets in the UI.
- Desktop apps ship for Windows and Mac (Apple Silicon and Intel).

### UI

- HeroUI v3 is the standard control library, with the glass shell workplace.

### Security release review

- Release review uses pinned open-source scanners: TruffleHog, Trivy, cargo-deny, Semgrep, CodeQL, and SkillSpector.
- Incomplete checks do not count as a clean result.

### Docs and community

- Public README, citation files, contributing and conduct docs, security policy, license, and third-party notices.
- Third-party notices credit the OWASP Secure Agent Playbook and companion licenses (CC BY, CC BY-SA, Apache 2.0, MIT, Arcanum PI Taxonomy).

[0.1.0]: https://github.com/gyrogovernance/air-office/releases/tag/v0.1.0

---
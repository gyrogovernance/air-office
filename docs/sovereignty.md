# Sovereignty

How AIR Office treats local data, privacy, safety, security, and content responsibility. Report vulnerabilities through [SECURITY.md](../SECURITY.md).

## Local-first control

Workspace records stay on your computer. You choose local models, cloud providers, or both. Provider credentials use the operating system keychain or the private application profile, and are not shown as secrets in the UI.

Hosted providers and enabled connectors receive only the content each request needs. Connecting a folder authorizes that root for tools that need it. Disconnecting the folder does not delete its files.

The default end-user profile root is:

| Platform | Path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\AIR Office\Data` |
| macOS | `~/Library/Application Support/AIR Office/Data` |
| Linux (when used) | `$XDG_DATA_HOME/AIR Office/Data` or `~/.local/share/AIR Office/Data` |

Under that profile, downloaded model weights normally live in a `models` folder. Settings can show the current private, public, models, and cache locations and, where supported, relocate them.

Gyro Governance Lab does not receive workspace content through normal product use. There is no Lab user account required to run the desktop app.

## Personal data that may appear

AIR Office does not require a personal profile, email signup, or continuous telemetry of identity data to function. Personal data appears only when the operator (or a model response) puts it into the workplace, or when the operator sends a request to a hosted provider.

Content that can include personally identifiable information includes:

- Names, email addresses, phone numbers, postal or institutional addresses, and account handles in notes, chats, or documents
- Other identifying details in attached files or connected folders
- Provider API keys and similar secrets in the keychain or private profile (security-sensitive credentials)

Data minimization for the product itself: the app does not need those identifiers to start. Local inference needs no cloud upload of personal content. Cloud use sends only what each request includes.

## Transparency

Transparency for local-first use is through Settings (storage locations and workspace controls), in-product warnings when exporting dialogue-memory datasets that contain saved message text, and this documentation. There is no third-party consent management platform, because the default path is on-device storage under the operator’s control rather than Lab-side collection of end-user profiles. Hosted model or connector providers apply their own notices to request content when the operator uses them.

## Deleting personal data and content

Operators can remove personal data and other content they control:

- Delete notes, chats, attachments, and Knowledge items in the workplace UI
- Forget retained dialogue-memory units from the Gyroscopic Reasoning method UI
- Turn lasting dialogue memory off to pause new capture (saved records remain until deleted)
- Disconnect connected folders (files on disk are not deleted by disconnect alone)
- Export a portable copy if needed, then use Settings → workspace controls to clear personal workspace content and reinstall shipped starters

These are user-initiated deletion and hard-deletion paths on the local device. Automated Lab-side retention of private workspace data does not apply, because that data is not uploaded to the Lab in normal use.

## Exports and open formats

Conversations, notes, and other portable copies use non-proprietary formats such as JSON and JSON Lines (NDJSON). Notes may also be handled as Markdown. Shipped reference libraries include PDF and Markdown sources.

In Settings → workspace, Export / Download produces a portable workspace bundle (provider keys and downloaded model weights are omitted). The same Settings area can import a previously exported bundle onto another machine.

When lasting dialogue memory is enabled (the three-message units described in [specifications.md](specifications.md) as Gyroscopic Reasoning), those units export separately as UTF-8 JSON Lines from the Craft packaging surface: open the Gyroscopic Reasoning method package and choose Export dataset (also available from the reasoning panel). Each row contains only `messages` with `role` and `content`. Local identifiers and envelope fields stay out of that row. The local export keeps original message text, so review personal information before sharing. The product UI states the same warning.

## Privacy filtering for shared contribution

Personal memory and shared contribution are separate controls. Turning lasting dialogue memory off pauses new capture, indexing, and memory-tool access; saved records remain available for deliberate management and local export.

Shared or public contribution of those closed-exchange datasets requires a privacy-filtering stage that removes or masks personally identifiable information and sensitive credentials while keeping task-relevant structure where the record still supports assessment. Filtering is intended to run on the operator’s machine before any Lab intake. Filtering quality includes semantic preservation: if removal destroys the basis for assessing the inference, the record is excluded from contribution. Disclose the extraction, field selection, filtering, and contribution process when that path is offered. Local export and privacy-filtered contribution are different operations. The honest label is privacy filtering, not a claim of perfect anonymity.

## Content types

The workplace can store and, when the operator chooses, export or send:

- Text notes and documents (including Markdown)
- Chat conversations and attachments
- Knowledge / reference collections (including PDF and Markdown)
- Packaged methods (skills, agents, prompts, multi-step Actions)
- Images and capture when Media features are used
- Code and project files in connected folders opened in the Code workbench
- Portable export bundles in open formats such as JSON and JSON Lines

## Inappropriate and illegal content

Operators must not use AIR Office to create, store, or distribute illegal content, including child sexual abuse material and other unlawful material.

Private workspace content remains on the operator’s device under their control. The product does not operate a hosted multi-user content network that centrally hosts end-user files, and Gyro Governance Lab does not scan private local vaults in normal use. Removal of unwanted or unlawful material in a private workspace is performed by the operator using the deletion controls above. Illegal activity may also be subject to applicable law and law-enforcement process outside the application.

Shipped Lab packs and Market resources are curated open standards, playbooks, and references, not an open social feed of arbitrary user uploads.

Community spaces (GitHub issues, pull requests, discussions, and related Lab channels) follow the [Code of Conduct](../CODE_OF_CONDUCT.md), which prohibits sexualized imagery, harassment, publishing others’ private information without permission, and other unacceptable professional conduct. Leaders may remove or reject violating contributions. Report conduct issues through Gyro Governance Lab as described in the Code of Conduct. Report product security issues through [SECURITY.md](../SECURITY.md). Hosted model providers the operator enables may enforce their own acceptable-use rules on request content.

## Applicable laws

AIR Office is designed so workspace data is processed on the operator's device by default. When the operator sends a request to a hosted model or connector, that provider processes the content included in the request under its own terms.

Operators and organizations that deploy or use AIR Office remain responsible for complying with privacy and data-protection laws that apply to their situation. Where personal data of people in the European Union or European Economic Area is processed, the EU General Data Protection Regulation (GDPR) is among the laws that may apply. Other jurisdictions may impose additional rules (for example sector or local privacy statutes). This page describes product behaviour. It is not legal advice and does not certify compliance for every deployment.

## Human oversight

Humans keep continuous oversight and final judgement. Chat tools can require approval before changing files or other work. Ordered multi-step review workflows (Actions in the product), such as Policy Auditing, Quality Improvement, and Meta-Evaluation, help connect claims to evidence and state limitations. The Human Mark risk taxonomy and lasting dialogue memory (Gyroscopic Reasoning) keep human direction and correction available across sessions.

## Security practice

AIR Office is open source. Before a release is accepted, the project checks the shipped software for leaked secrets, known problems in third-party libraries, license and dependency policy issues in native code, and risky patterns in source and in skills that ship with the product. An incomplete review does not count as a clean result. Release review uses TruffleHog, Trivy, Semgrep, CodeQL, and SkillSpector.

Report security issues privately as described in [SECURITY.md](../SECURITY.md). Include version, operating system, and reproduction steps. Remove API keys and private document content before sharing logs.

## Community safety

Contributor spaces follow the [Code of Conduct](../CODE_OF_CONDUCT.md). Reporting and enforcement for community contributions are described there. The local desktop workplace remains under the operator’s control as described above.

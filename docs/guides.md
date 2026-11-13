# Guides

Install AIR Office, then use the main workplace surfaces. For architecture and stack see [specifications.md](specifications.md). For privacy and local data control see [sovereignty.md](sovereignty.md).

## Install the desktop app

Alpha builds for version 0.1.0 are on the [0.1.0-AIR_Office_Alpha](https://github.com/gyrogovernance/air-office/releases/tag/0.1.0-AIR_Office_Alpha) release page.

| Platform | Artifact |
| --- | --- |
| Windows (x64) | `AIR-Office-Setup-0.1.0-x64.exe` |
| macOS Apple Silicon | `AIR-Office-0.1.0-arm64.dmg` |
| macOS Intel | `AIR-Office-0.1.0-x64.dmg` |

The packages are unsigned alpha builds. Features may change, and the software can be unstable. On macOS you may need System Settings → Privacy & Security after the first launch.

Report problems with a GitHub issue that includes app version, operating system, model in use, and steps to reproduce. Strip API keys and private document content.

## Run from source

1. Install [Bun](https://bun.sh/) matching `.bun-version` (currently 1.4.4).
2. From the repository root: `bun install`
3. Day-to-day development: `bun run dev`
4. Demo showcase profile: `bun run dev:demo`
5. Checks: `bun run test web`, `bun run test service`, `bun run test packages`, or `bun run office -- check`

Desktop product builds use `bun run build:desktop` (and the Windows or macOS target scripts listed in [CONTRIBUTING.md](../CONTRIBUTING.md)). End users install a release build rather than running `dev`.

To fork and contribute: fork the repository on GitHub, clone your fork, follow the steps above, then open a pull request per [CONTRIBUTING.md](../CONTRIBUTING.md).

## First run

1. Install and open AIR Office.
2. Open Settings.
3. Choose how models run:
   - Cloud: open the cloud AI section, add a provider with your own API key (stored in the OS keychain), and pick a default chat model.
   - Local: open the local AI / models section. The app includes software that runs models on the machine (Lemonade); model weights are not in the installer. Download or place weights in the profile `models` folder (see [sovereignty.md](sovereignty.md) for profile paths), then select a local chat model. From Settings you can also open the in-app catalog (Market) to discover installable model entries.
4. In the workspace explorer, open or create a program or project (a folder for your work), then write a note or start a chat.

Hosted providers are optional. The same workplace runs with local inference alone when a local model is configured.

## Using the workplace

### Organizing work

The workspace explorer lets you group notes, chats, and connected filesystem folders under programs and projects. Rich notes support Markdown, math, attachments, and reviewable AI edit proposals.

### Chat and tools

The chat surface is the conversational interface to local or cloud models. It streams replies, keeps history, and can call tools such as web search, file work, and safety diagnostics when those tools are enabled. Mutating tools can ask for approval before changing work. Tool permissions live in Settings and in the chat composer.

### Document libraries the assistant can cite

You can build searchable document libraries from your own files and from shipped reference packs, then ask for grounded answers that cite them. In the product those libraries are Knowledge collections. Seeded and opt-in references are listed in [specifications.md](specifications.md).

### Packaged methods, discovery, and shared programs

You can enable packaged sets of agents, prompts, skills, multi-step AI workflows, tools, and document libraries instead of assembling everything by hand. That packaging surface is Craft. Packages appear as Standards (methods you enable) or Products (installable bundles). An in-app catalog discovers models and reusable resources and installs them as editable copies; that catalog is Market. A separate surface for developing research programs and packaging reusable workflows for others is Fellowship.

### Coding, schedule, model comparison, and media

An in-app Visual Studio Code workbench (code-server) opens on trusted connected folders; that surface is Code. A calendar holds events and recurring AI automations. A compare view runs two models on the same prompt side by side. Image generation and capture are available when the work needs them (Media).

### Lasting dialogue memory and exports

AIR Office can keep short three-message dialogue units (your message, the model reply, and your next message) as lasting memory so later chats can recall them. That method is Gyroscopic Reasoning ([specifications.md](specifications.md)).

To export those units as JSON Lines: open the Craft packaging surface, select the Gyroscopic Reasoning method package, and choose Export dataset (also available from the reasoning panel when that method is in view). Review personal information before sharing. You can delete retained units deliberately from the same method UI.

For a portable copy of ordinary workspace content (conversations, collections, documents, and related items): open Settings → workspace, then use Export / Download. The same Settings area can import a previously exported workspace bundle onto another machine. Exports leave out provider keys and downloaded model weights. Structured exports use formats such as JSON and JSON Lines. Disconnecting a connected folder does not delete its files on disk. Privacy detail: [sovereignty.md](sovereignty.md).

## System notes

Public desktop builds target Windows x64 and macOS (Apple Silicon and Intel). Packaged macOS builds declare a minimum of macOS 12. Disk space depends on which model weights you download; the workplace itself is separate from those weights.

## FAQ

Are model weights included in the installer?
No. The installer includes software that can run models on the machine (Lemonade). You supply or download the weights into the profile `models` folder.

How do I delete my data?
Delete notes and chats in the workplace, forget dialogue-memory units from the Gyroscopic Reasoning method UI if you use that feature, and use Settings → workspace to export and/or clear personal workspace content. Details: [sovereignty.md](sovereignty.md).

What content am I allowed to store?
Do not use AIR Office for illegal content. Private files stay on your computer under your control. Community contributions on GitHub follow the [Code of Conduct](../CODE_OF_CONDUCT.md). Full policy: [sovereignty.md](sovereignty.md).

How do I contribute code?
Fork the repository on GitHub, then follow [CONTRIBUTING.md](../CONTRIBUTING.md) and the [Code of Conduct](../CODE_OF_CONDUCT.md).

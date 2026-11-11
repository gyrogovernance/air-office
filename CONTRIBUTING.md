```
▐██████ ▐██ ▐██████      ▐██████ ▐██████ ▐██████ ▐██ ▐██████ ▐██████
▐██ ▐██ ▐██ ▐██ ▐██      ▐██ ▐██ ▐██     ▐██     ▐██ ▐██     ▐██    
▐██████ ▐██ ▐██████      ▐██ ▐██ ▐████   ▐████   ▐██ ▐██     ▐████  
▐██ ▐██ ▐██ ▐██▐██       ▐██ ▐██ ▐██     ▐██     ▐██ ▐██     ▐██    
▐██ ▐██ ▐██ ▐██ ▐██      ▐██████ ▐██     ▐██     ▐██ ▐██████ ▐██████
```

# Contributing

Thanks for your interest in AIR Office. The project is developed by [Gyro Governance Lab](http://gyrogovernance.com/) and is still in alpha.

## Before you start

1. Read the [Code of Conduct](CODE_OF_CONDUCT.md).
2. Skim the [README](README.md) for product scope and the alpha caveats.
3. Prefer small, focused changes with a clear problem statement.

## Development setup

- Install [Bun](https://bun.sh/) matching `.bun-version`.
- From the repository root: `bun install`
- Day-to-day coding (live service + Vite): `bun run dev`
- Demo showcase profile (separate DB): `bun run dev:demo` (also mocks macOS traffic lights in the browser for walkthrough recordings; on a normal `dev` session append `?macos-chrome=1`)
- Focused checks: `bun run test web`, `bun run test service`, `bun run test packages`, or `bun run office -- check`

### Build commands (do not confuse these)

| Script | Purpose |
| --- | --- |
| `bun run build` / `build:web` | Web UI bundle only |
| `bun run prepare-desktop-artifact` | Stage resources + **compile** the Bun service sidecar + web UI |
| `bun run build:desktop` | **Product** Electron package for this host (installer / app) |
| `bun run build:desktop:windows` | Windows x64 NSIS product build (branded unsigned installer) |
| `bun run build:desktop:mac:intel` | macOS Intel DMG/zip product build |
| `bun run build:desktop:mac:arm` | macOS Apple Silicon DMG/zip product build |
| `bun run desktop:artifacts` | Reveal the installer in `dist/desktop/` (add `-- --open`); bare host exe is not runnable alone |
| `bun run clean:desktop` | Remove regenerable desktop build leftovers from the working tree (not `.dev/`) |

End users never run `dev`. Release evidence is the installer from `build:desktop`, documented in [`.dev/DESKTOP-BUILD.md`](.dev/DESKTOP-BUILD.md). Agents start from [`.dev/AGENTS.md`](.dev/AGENTS.md) (“When the user asks to build the desktop app”). Packaging work should load the [air-office-desktop-release](.agents/skills/air-office-desktop-release/SKILL.md) skill rather than inventing a second pipeline.

Do not commit secrets, API keys, local data roots, or machine-specific paths (including a relocated models folder on another drive). Those are personal preferences, not product defaults.

Desktop release profiles: **Normal** (`…/AIR Office/Data`) is the end-user workspace; **Demo** (`…/AIR Office/Demo`) is a separate showcase database for development walkthroughs; the **lab seed pack** is packaged product content that is reinstalled after wipe-all. Do not treat developer chat history, assistant test profiles, or `Demo-Showcase-*` folders as release state. See [`.dev/DESKTOP-BUILD.md`](.dev/DESKTOP-BUILD.md).

## Pull requests

- Open an issue or discussion first for large design changes.
- Keep pull requests reviewable: one concern per change where practical.
- Include what you changed, how you verified it, and any remaining risk.
- Do not rewrite unrelated history, generated verification piles, or local editor/agent folders.

## Licensing

Contributions are accepted under the repository [MIT License](LICENSE). Third-party material must keep its original license attribution in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and, for catalogued npm packages, in `tools/third-party.catalog.json`. Settings References loads the same notices text from `apps/web/src/market/references.catalog.json`; keep that file identical to `THIRD-PARTY-NOTICES.md` (`bun run office -- check` enforces it).

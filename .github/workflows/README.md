# Desktop CI packages

## Targets (unsigned interim)

| Workflow | Runner | Artifact | Public release |
| --- | --- | --- | --- |
| `build-windows-x64.yml` | `windows-latest` | NSIS `AIR-Office-Setup-*-x64.exe` | No until Authenticode signing |
| `build-macos-intel.yml` | `macos-15-intel` | DMG + zip + `Install AIR Office.command` | No until Apple notarization |
| `build-macos-arm.yml` | `macos-15` | DMG + zip + helper | No until notarization |
| `desktop-release.yml` | dispatch matrix | Selected platforms above | Artifacts only; no GitHub Release publish |

## How to run

1. Actions → **Desktop release** → Run workflow.
2. Choose Windows x64, macOS Intel, and/or macOS Apple Silicon.
3. Download the uploaded artifacts. Keep them private or pre-release until signing exists.

Individual platform workflows also support `workflow_dispatch` and (Windows / Intel Mac) push to `main` on packaging paths.

## Excluded until signing

- Windows MSI / portable / MSIX
- macOS `.pkg` / App Store
- Auto-publish to public GitHub Releases
- Linux AppImage/deb (separate track)

## Local commands

```bash
bun run build:desktop:windows
bun run build:desktop:mac:intel
bun run build:desktop:mac:arm
```

`mac:intel` / `mac:arm` set `TARGET` so Lemonade and the service match the Electron arch. Apple Silicon packaging must run on an arm64 Mac (or the Actions arm runner); web search and documents freezes are host-arch only.

All local and CI packaging sets `CSC_IDENTITY_AUTO_DISCOVERY=false`.

## Static GitHub Pages demo

`static-demo-pages.yml` is a separate, manual workflow. It builds `apps/web/dist-static-demo` only (not product `apps/web/dist`).

```bash
bun run export:static-demo
bun run build:web:static-demo
```

Refresh the committed snapshot with `bun run export:static-demo` when demo seed content changes, then run the Actions workflow to publish.

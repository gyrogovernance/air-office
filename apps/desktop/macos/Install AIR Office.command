#!/bin/bash
# Helper for unsigned Electron macOS builds. Open the DMG, drag AIR Office.app into
# Applications, then run this to clear quarantine attributes and launch.
set -euo pipefail
APP="/Applications/AIR Office.app"
if [[ ! -d "$APP" ]]; then
  osascript -e 'display notification "Move AIR Office.app into Applications, then run this again." with title "AIR Office"'
  exit 1
fi
xattr -cr "$APP" || true
open "$APP"
osascript -e 'display notification "AIR Office was cleared of quarantine attributes." with title "AIR Office"'

; Pre-register Windows Firewall allow rules for AIR Office network helpers.
; Requires an elevated install. Per-user installs fall through to the first-run helper.
;
; Upgrade failure mode (electron-builder stock dialog "cannot be closed"):
; extractUsing7za unpacks to a temp folder then CopyFiles into $INSTDIR. If any
; file in $INSTDIR is locked for overwrite (Defender / Search indexer), CopyFiles
; fails and shows that misleading dialog. Rename of the whole folder still works
; under FILE_SHARE_DELETE read locks. Pattern from DeskClaw / electron-builder
; issue discussions:
;   1) kill helpers
;   2) SetOutPath $TEMP  (NSIS CWD on $INSTDIR blocks Rename)
;   3) clear UninstallString so uninstallOldVersion is skipped
;   4) Rename $INSTDIR -> $INSTDIR._stale_N and recreate empty $INSTDIR
; afterPack also patches extractUsing7za to Nsis7z::Extract straight into the
; empty $INSTDIR (no CopyFiles) for this large tree.
;
; Uninstaller: customCheckAppRunning is compiled for both installer and
; uninstaller. Keep the uninstall branch linear (no Goto / MessageBox labels).
; customRemoveFiles force-deletes after leaving $INSTDIR as cwd.
;
; Important: NSIS expands $VAR itself. Literal PowerShell $ must be written as $$.

!macro airOfficeKillProcesses
  nsExec::ExecToLog `taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $0
  nsExec::ExecToLog `taskkill /F /T /IM "air-office-service.exe"`
  Pop $0
  nsExec::ExecToLog `taskkill /F /T /IM "air-office-service-x86_64-pc-windows-msvc.exe"`
  Pop $0
  nsExec::ExecToLog `taskkill /F /T /IM "lemond.exe"`
  Pop $0
  nsExec::ExecToLog `taskkill /F /T /IM "lemonade.exe"`
  Pop $0
  nsExec::ExecToLog `taskkill /F /T /IM "llama-server.exe"`
  Pop $0
  nsExec::ExecToLog `taskkill /F /T /IM "llama.exe"`
  Pop $0
  nsExec::ExecToLog `taskkill /F /T /IM "air-office-web-search.exe"`
  Pop $0
  nsExec::ExecToLog `taskkill /F /T /IM "air-office-documents.exe"`
  Pop $0
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d='$INSTDIR'.TrimEnd('\'); Get-CimInstance Win32_Process | Where-Object { ($$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$d, [System.StringComparison]::OrdinalIgnoreCase)) -or ($$_.CommandLine -and $$_.CommandLine.IndexOf($$d, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
!macroend

!macro airOfficeClearOldUninstallEntry
  ; Skip electron-builder uninstallOldVersion (5x silent old uninstaller +
  ; appCannotBeClosed). registryAddInstallInfo rewrites the entry after extract.
  DetailPrint "Clearing previous uninstall entry so setup can replace files directly…"
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKLM "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
!macroend

; Move the existing tree aside so extract writes into an empty folder.
!macro airOfficeStaleMoveInstallDir
  ; NSIS often has CWD = $INSTDIR; Windows will not rename a directory that is
  ; any process's current directory — including this installer.
  SetOutPath $TEMP

  IfFileExists "$INSTDIR\" 0 air_office_instdir_clean

  StrCpy $R8 0
  air_office_find_stale:
    IfFileExists "$INSTDIR._stale_$R8\" 0 air_office_found_stale
    IntOp $R8 $R8 + 1
    IntCmp $R8 40 0 air_office_find_stale air_office_find_stale
    DetailPrint "Too many stale AIR Office folders; forcing delete of $INSTDIR"
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C rd /s /q "$INSTDIR"`
    Pop $0
    Sleep 1500
    CreateDirectory "$INSTDIR"
    Goto air_office_instdir_clean

  air_office_found_stale:
    DetailPrint "Moving previous install aside: $INSTDIR._stale_$R8"
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR._stale_$R8"
    IfErrors 0 air_office_stale_moved
    DetailPrint "Rename busy; forcing delete of $INSTDIR"
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C rd /s /q "$INSTDIR"`
    Pop $0
    Sleep 1500
    CreateDirectory "$INSTDIR"
    Goto air_office_instdir_clean

  air_office_stale_moved:
    CreateDirectory "$INSTDIR"

  air_office_instdir_clean:
!macroend

!macro airOfficeForceRemoveInstallDir
  DetailPrint "Removing AIR Office files from $INSTDIR…"
  !insertmacro airOfficeKillProcesses
  Sleep 400
  !insertmacro airOfficeKillProcesses
  Sleep 400
  SetOutPath $TEMP
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C rd /s /q "$INSTDIR"`
  Pop $0
  Sleep 500
  IfFileExists "$INSTDIR\" 0 air_office_remove_done
  DetailPrint "Folder still present; renaming aside then deleting…"
  StrCpy $R8 0
  air_office_remove_stale_find:
    IfFileExists "$INSTDIR._uninstalled_$R8\" 0 air_office_remove_stale_ok
    IntOp $R8 $R8 + 1
    IntCmp $R8 20 0 air_office_remove_stale_find air_office_remove_stale_find
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C rd /s /q "$INSTDIR"`
    Pop $0
    Goto air_office_remove_done
  air_office_remove_stale_ok:
    ClearErrors
    Rename "$INSTDIR" "$INSTDIR._uninstalled_$R8"
    IfErrors 0 air_office_remove_stale_moved
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C rd /s /q "$INSTDIR"`
    Pop $0
    Goto air_office_remove_done
  air_office_remove_stale_moved:
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C rd /s /q "$INSTDIR._uninstalled_$R8"`
    Pop $0
  air_office_remove_done:
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C for /d %D in ("$INSTDIR._stale_*") do rd /s /q "%D"`
  Pop $0
  nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C for /d %D in ("$INSTDIR._uninstalled_*") do rd /s /q "%D"`
  Pop $0
!macroend

!macro customCheckAppRunning
  !ifdef BUILD_UNINSTALLER
    DetailPrint "Closing AIR Office before uninstall…"
    !insertmacro airOfficeKillProcesses
    Sleep 700
    !insertmacro airOfficeKillProcesses
    Sleep 700
    !insertmacro airOfficeKillProcesses
  !else
    DetailPrint "Closing AIR Office and clearing the install folder for upgrade…"
    !insertmacro airOfficeKillProcesses
    Sleep 1000
    !insertmacro airOfficeKillProcesses
    Sleep 1000
    ; Always clear + move aside — this is the upgrade fix, not a process dialog.
    !insertmacro airOfficeClearOldUninstallEntry
    !insertmacro airOfficeStaleMoveInstallDir
  !endif
!macroend

!macro customUnInstall
  DetailPrint "Closing AIR Office before removing files…"
  !insertmacro airOfficeKillProcesses
  Sleep 500
  !insertmacro airOfficeKillProcesses
  Sleep 500
  !insertmacro airOfficeKillProcesses

  DetailPrint "Removing Windows Firewall access for AIR Office…"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AIR Office desktop"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AIR Office service"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AIR Office web search"'
  Pop $0
!macroend

!macro customRemoveFiles
  !insertmacro airOfficeForceRemoveInstallDir
!macroend

!macro customInstall
  DetailPrint "Registering Windows Firewall access for AIR Office…"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AIR Office desktop"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AIR Office service"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AIR Office web search"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="AIR Office desktop" dir=out action=allow program="$INSTDIR\AIR Office.exe" enable=yes profile=any'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="AIR Office service" dir=out action=allow program="$INSTDIR\resources\air-office-service.exe" enable=yes profile=any'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="AIR Office web search" dir=out action=allow program="$INSTDIR\resources\workers\web-search\air-office-web-search.exe" enable=yes profile=any'
  Pop $0

  DetailPrint "Scheduling cleanup of previous AIR Office install folders…"
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '$$env:SystemRoot\System32\cmd.exe' -ArgumentList '/C','for /d %D in (\"$INSTDIR._stale_*\") do rd /s /q \"%D\" & for /d %D in (\"$INSTDIR._uninstalled_*\") do rd /s /q \"%D\"' "`
  Pop $0
!macroend

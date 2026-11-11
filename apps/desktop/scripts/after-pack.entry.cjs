/**
 * Runs after the app asar is packed and before the NSIS installer is built.
 *
 * Two Windows upgrade patches (DeskClaw #711 + UAC assisted-installer gap):
 * 1) extractUsing7za: Nsis7z::Extract straight into $INSTDIR (no temp CopyFiles).
 * 2) installSection: always CHECK_APP_RUNNING on assisted installs. Stock
 *    electron-builder skips it on the elevated UAC inner instance, so our
 *    installer.nsh prep (clear UninstallString + rename $INSTDIR → _stale_N)
 *    never ran with admin rights — silent elevated /S worked, GUI failed.
 */
const { existsSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');

const EXTRACT_MARKER = 'AIR-Office-direct-extract';
const UAC_MARKER = 'AIR-Office-uac-check';

function resolveAppBuilderTemplate(...parts) {
  const requireFromHere = createRequire(__filename);
  const rel = join('app-builder-lib', 'templates', 'nsis', ...parts).replace(/\\/g, '/');
  try {
    const electronBuilder = requireFromHere.resolve('electron-builder/package.json');
    return createRequire(electronBuilder).resolve(rel);
  } catch {
    /* fall through */
  }
  try {
    return requireFromHere.resolve(rel);
  } catch {
    /* fall through */
  }
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const bunRoot = join(dir, 'node_modules', '.bun');
    if (existsSync(bunRoot)) {
      for (const name of readdirSync(bunRoot)) {
        if (!name.startsWith('app-builder-lib@')) continue;
        const nsh = join(bunRoot, name, 'node_modules', 'app-builder-lib', 'templates', 'nsis', ...parts);
        if (existsSync(nsh)) return nsh;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function patchExtractAppPackage(extractNsh) {
  const original = readFileSync(extractNsh, 'utf8');
  if (original.includes(EXTRACT_MARKER) || original.includes('ClawX-patched')) {
    console.log('[after-pack] extractAppPackage.nsh already patched for direct extract.');
    return;
  }
  if (!original.includes('CopyFiles') || !original.includes('!macro extractUsing7za FILE')) {
    console.warn('[after-pack] extractUsing7za macro missing or already without CopyFiles.');
    return;
  }

  const replacement = [
    '!macro extractUsing7za FILE',
    `  ; ${EXTRACT_MARKER}: extract directly to $INSTDIR (skip temp + CopyFiles).`,
    '  ; customCheckAppRunning already renamed old $INSTDIR to _stale_N,',
    '  ; so the target directory is always empty. Nsis7z streams LZMA2 data',
    '  ; directly to disk — no temp copy needed.',
    '  SetOutPath "$INSTDIR"',
    '  Nsis7z::Extract "${FILE}"',
    '!macroend',
  ].join('\n');

  const patched = original.replace(/(!macro extractUsing7za FILE[\s\S]*?!macroend)/, replacement);
  if (patched === original) {
    console.warn('[after-pack] extractUsing7za replace did not match; template may have changed.');
    return;
  }
  writeFileSync(extractNsh, patched, 'utf8');
  console.log('[after-pack] Patched extractAppPackage.nsh: CopyFiles eliminated, direct Nsis7z::Extract.');
}

function patchInstallSection(installSectionNsh) {
  const original = readFileSync(installSectionNsh, 'utf8');
  if (original.includes(UAC_MARKER)) {
    console.log('[after-pack] installSection.nsh already patched for elevated CHECK_APP_RUNNING.');
    return;
  }

  // Assisted installer (oneClick false): stock template skips CHECK_APP_RUNNING
  // on the UAC elevated inner instance. Our upgrade prep lives there.
  const stock = `${'!else'}\n  \${ifNot} \${UAC_IsInnerInstance}\n    !insertmacro CHECK_APP_RUNNING\n  \${endif}\n!endif`;
  const fixed = [
    '!else',
    `  ; ${UAC_MARKER}: run CHECK on elevated inner too (all-users Program Files).`,
    '  !insertmacro CHECK_APP_RUNNING',
    '!endif',
  ].join('\n');

  if (!original.includes('${UAC_IsInnerInstance}')) {
    console.warn('[after-pack] installSection.nsh has no UAC_IsInnerInstance guard; nothing to patch.');
    return;
  }

  const patched = original.replace(stock, fixed);
  if (patched === original) {
    // Fallback: broader replace of the assisted-installer branch guard.
    const broad = original.replace(
      /\$\{ifNot\} \$\{UAC_IsInnerInstance\}\s*!insertmacro CHECK_APP_RUNNING\s*\$\{endif\}/,
      `; ${UAC_MARKER}\n  !insertmacro CHECK_APP_RUNNING`,
    );
    if (broad === original) {
      console.warn('[after-pack] installSection.nsh UAC guard replace did not match; template may have changed.');
      return;
    }
    writeFileSync(installSectionNsh, broad, 'utf8');
    console.log('[after-pack] Patched installSection.nsh (broad): CHECK_APP_RUNNING always for assisted.');
    return;
  }

  writeFileSync(installSectionNsh, patched, 'utf8');
  console.log('[after-pack] Patched installSection.nsh: CHECK_APP_RUNNING always for assisted.');
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const extractNsh = resolveAppBuilderTemplate('include', 'extractAppPackage.nsh');
  if (!extractNsh || !existsSync(extractNsh)) {
    console.warn('[after-pack] extractAppPackage.nsh not found; NSIS CopyFiles path unchanged.');
  } else {
    patchExtractAppPackage(extractNsh);
  }

  const installSectionNsh = resolveAppBuilderTemplate('installSection.nsh');
  if (!installSectionNsh || !existsSync(installSectionNsh)) {
    console.warn('[after-pack] installSection.nsh not found; UAC assisted upgrade prep unchanged.');
  } else {
    patchInstallSection(installSectionNsh);
  }
};

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceClient } from '../shared/service-client.hook';
import { FolderPickerButton } from '../shared/folder-picker.component';
import { desktopInvoke, isElectronHost } from '../entry/desktop-host.adapter';
import { WorkspaceDestinationIcon } from './workspace-destination-icon.component';

type WorkbenchLaunch = {
  href: string | null;
  bootstrap?: string;
  token?: string | null;
  folder?: string;
  error?: string;
};

function codeOpenError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : '';
  if (!message || /service is unavailable|start the service|bun run|desktop app/i.test(message)) {
    return 'Code could not be opened.';
  }
  return message;
}

const SPLASH_MIN_MS = 2200;
const SPLASH_MAX_MS = 10000;

export type CodeRevealRequest = {
  rootPath: string;
  filePath?: string;
  key: number;
};

/**
 * Stage page that hosts the supervised VS Code workbench in an iframe.
 * code-server still uses password auth. Electron completes the login handoff
 * in the host session, then the iframe loads the workbench URL. Browser /
 * non-Electron keeps the srcDoc login bootstrap form.
 *
 * An Arcade-style brand splash covers the long cold start so the stage is not
 * a blank white wait while code-server and Monaco boot.
 */
export function CodeWorkspace({ client, appearance, reveal, onFolderChange }: {
  client: ServiceClient;
  appearance: 'light' | 'dark';
  reveal?: CodeRevealRequest | null;
  onFolderChange?: (folder: string | null) => void;
}) {
  const [frame, setFrame] = useState<{ kind: 'src'; href: string } | { kind: 'srcDoc'; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [starting, setStarting] = useState(true);
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashReady, setSplashReady] = useState(false);
  const [folderHost, setFolderHost] = useState<Element | null>(null);
  const onFolderChangeRef = useRef(onFolderChange);
  const splashShownAt = useRef(performance.now());
  const splashDismissed = useRef(false);
  onFolderChangeRef.current = onFolderChange;

  useLayoutEffect(() => {
    setFolderHost(window.document.querySelector('.code-folder-host'));
  }, []);

  function resetSplash() {
    splashShownAt.current = performance.now();
    splashDismissed.current = false;
    setSplashReady(false);
    setSplashVisible(true);
  }

  function scheduleSplashDismiss() {
    if (splashDismissed.current) return;
    splashDismissed.current = true;
    const wait = Math.max(0, SPLASH_MIN_MS - (performance.now() - splashShownAt.current));
    window.setTimeout(() => setSplashReady(true), wait);
  }

  async function launchWorkbench(options: { rootPath?: string; filePath?: string } = {}) {
    const body = await client.json<WorkbenchLaunch>('/api/v1/workbench/workspace', {
      method: 'POST',
      body: JSON.stringify({
        appearance,
        ...(options.rootPath ? { rootPath: options.rootPath } : {}),
        ...(options.filePath ? { filePath: options.filePath } : {}),
      }),
    });
    const nextFolder = typeof body.folder === 'string' && body.folder.length > 0
      ? body.folder
      : options.rootPath ?? null;

    if (isElectronHost() && typeof body.href === 'string' && body.href.length > 0) {
      // Password mode (legacy): host signs in so the iframe never sees /login.
      // Auth none (current): loopback workbench needs no cookie handoff.
      if (typeof body.token === 'string' && body.token.length > 0) {
        const prepared = await desktopInvoke<{ ok: boolean; error?: string }>('prepare_code_auth', {
          href: body.href,
          token: body.token,
        });
        if (!prepared.ok) throw new Error(prepared.error || 'Code could not be opened.');
      }
      setFrame({ kind: 'src', href: body.href });
      setError(null);
      onFolderChangeRef.current?.(nextFolder);
      return;
    }

    if (typeof body.bootstrap === 'string' && body.bootstrap.length > 0) {
      setFrame({ kind: 'srcDoc', html: body.bootstrap });
      setError(null);
      onFolderChangeRef.current?.(nextFolder);
      return;
    }

    if (typeof body.href === 'string' && body.href.length > 0) {
      setFrame({ kind: 'src', href: body.href });
      setError(null);
      onFolderChangeRef.current?.(nextFolder);
      return;
    }
    setFrame(null);
    onFolderChangeRef.current?.(null);
    throw new Error(typeof body.error === 'string' && body.error.length > 0 ? body.error : 'Code is not available.');
  }

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setStarting(true);
    resetSplash();

    void (async () => {
      try {
        await launchWorkbench({
          ...(reveal?.rootPath ? { rootPath: reveal.rootPath } : {}),
          ...(reveal?.filePath ? { filePath: reveal.filePath } : {}),
        });
      } catch (reason: unknown) {
        if (cancelled) return;
        setFrame(null);
        setError(codeOpenError(reason));
        setSplashVisible(false);
      } finally {
        if (!cancelled) setStarting(false);
      }
    })();

    return () => { cancelled = true; };
  }, [appearance, client, reveal?.key, reveal?.rootPath, reveal?.filePath]);

  // Never trap the stage behind the splash if the iframe load event is missed.
  useEffect(() => {
    if (!splashVisible || error) return;
    const timer = window.setTimeout(() => scheduleSplashDismiss(), SPLASH_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [splashVisible, error, frame?.kind === 'src' ? frame.href : frame?.kind === 'srcDoc' ? 'srcDoc' : 'none']);

  useEffect(() => {
    if (!splashReady || !splashVisible) return;
    const timer = window.setTimeout(() => setSplashVisible(false), 320);
    return () => window.clearTimeout(timer);
  }, [splashReady, splashVisible]);

  async function openTrustedFolder(path: string) {
    setConnecting(true);
    setError(null);
    resetSplash();
    try {
      await client.json('/api/v1/external/roots', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      await launchWorkbench({ rootPath: path });
    } catch (reason: unknown) {
      setError(codeOpenError(reason));
      setSplashVisible(false);
    } finally {
      setConnecting(false);
    }
  }

  const folderControl = (
    <FolderPickerButton
      client={client}
      iconOnly
      label={connecting ? 'Opening folder…' : 'Open folder'}
      title="Open folder in Code"
      disabled={connecting}
      onSelect={(path) => { void openTrustedFolder(path); }}
    />
  );

  const splash = splashVisible ? (
    <div
      className={`code-splash${splashReady ? ' is-ready' : ''}`}
      role="status"
      aria-label="Loading Code"
      data-appearance={appearance}
    >
      <div className="code-splash-brand">
        <WorkspaceDestinationIcon name="code" size={64} className="code-splash-icon" />
        <span className="code-splash-title">Code</span>
        <span className="code-splash-credit">
          {starting || connecting ? 'Starting workbench…' : 'Opening workspace…'}
        </span>
      </div>
    </div>
  ) : null;

  if (error && !frame) {
    return (
      <div className="code-workspace code-workspace--empty" data-appearance={appearance}>
        {folderHost ? createPortal(folderControl, folderHost) : null}
        <p role="alert">{error}</p>
        {!folderHost ? (
          <div className="code-workspace-actions">
            <FolderPickerButton
              client={client}
              label={connecting ? 'Opening…' : 'Open folder'}
              title="Open folder in Code"
              disabled={connecting}
              onSelect={(path) => { void openTrustedFolder(path); }}
            />
          </div>
        ) : null}
      </div>
    );
  }

  if (!frame) {
    return (
      <div className="code-workspace code-workspace--booting" data-appearance={appearance}>
        {folderHost ? createPortal(folderControl, folderHost) : null}
        {splash}
      </div>
    );
  }

  return (
    <div className="code-workspace" data-appearance={appearance}>
      {folderHost ? createPortal(folderControl, folderHost) : null}
      {error && <p className="code-workspace-notice" role="status">{error}</p>}
      {splash}
      {frame.kind === 'src' ? (
        <iframe
          className="code-workspace-frame"
          title="Code"
          src={frame.href}
          allow="clipboard-read; clipboard-write; local-network-access; loopback-network"
          style={{ colorScheme: appearance }}
          onLoad={() => scheduleSplashDismiss()}
        />
      ) : (
        <iframe
          className="code-workspace-frame"
          title="Code"
          srcDoc={frame.html}
          allow="clipboard-read; clipboard-write; local-network-access; loopback-network"
          style={{ colorScheme: appearance }}
          onLoad={() => scheduleSplashDismiss()}
        />
      )}
    </div>
  );
}

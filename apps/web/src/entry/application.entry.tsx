// The stylesheet manifest must be the first import: Vite emits CSS in
// module-graph order, so this is what fixes the stylesheet cascade.
import './styles-manifest.styles.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import type { NativeBootstrap } from './desktop-window.types';
import {
  desktopInvoke,
  isDesktopHost,
  isElectronHost,
  listenDesktopBootstrap,
  revealDesktopWindow,
} from './desktop-host.adapter';
import { AppDialogsProvider } from '../shared/app-dialogs.component';
import { WorkspaceShell } from '../app/workspace-shell.component';
import { dismissStartupIntro, restartStartupSplashSpin, StartupIntro } from '../app/startup-intro.component';
import { restoreAndApplyFlatMaterials } from '../settings/flat-materials.policy';
import { staticDemoBuild } from '../static-demo/static-demo.flag';
import '@fontsource/coiny/latin-400.css';
import { Button } from '@heroui/react';

const desktop = typeof window !== 'undefined' && isDesktopHost();
const root = createRoot(document.getElementById('root')!);
const Router = staticDemoBuild() ? HashRouter : BrowserRouter;

/** Dev-only: paint fake macOS traffic lights in the browser for walkthrough recordings. */
function mockMacosChromeRequested(): boolean {
  if (typeof window === 'undefined' || desktop) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('macos-chrome') === '1' || params.get('chrome') === 'macos') return true;
  return import.meta.env.VITE_MOCK_MACOS_CHROME === '1';
}

/** Mark the document for desktop-only chrome (overlay title bar insets, drag region). */
function markDesktopHost() {
  if (!desktop) return;
  const rootElement = document.documentElement;
  rootElement.dataset.desktopHost = isElectronHost() ? 'electron' : '';
  const agent = navigator.userAgent;
  const platform = /Windows/i.test(agent) ? 'windows' : /Mac OS|Macintosh/i.test(agent) ? 'macos' : /Linux/i.test(agent) ? 'linux' : 'unknown';
  rootElement.dataset.platform = platform;
  const arch = (window as Window & { airDesktop?: { arch?: string } }).airDesktop?.arch;
  if (arch) rootElement.dataset.arch = arch;
  if (platform === 'macos' || platform === 'windows') rootElement.dataset.titlebarOverlay = '';
}

/** Browser walkthrough chrome: same insets as macOS Overlay, plus decorative lights. */
function markMockMacosChrome() {
  if (!mockMacosChromeRequested()) return;
  const rootElement = document.documentElement;
  rootElement.dataset.desktopHost = '';
  rootElement.dataset.platform = 'macos';
  rootElement.dataset.titlebarOverlay = '';
  rootElement.dataset.mockMacosChrome = '';
}

function renderWorkspace() {
  root.render(
    <React.StrictMode>
      <StartupIntro />
      <Router>
        <AppDialogsProvider>
          <WorkspaceShell />
        </AppDialogsProvider>
      </Router>
    </React.StrictMode>,
  );
}

async function boot(): Promise<void> {
  // Product builds drop this branch; the snapshot stays out of apps/web/dist.
  if (import.meta.env.VITE_STATIC_DEMO === '1') {
    await import('../static-demo/register-static-demo');
  }
  markMockMacosChrome();
  restoreAndApplyFlatMaterials();
  if (desktop) {
    markDesktopHost();
    let unlisten: (() => void) | undefined;
    async function start(retry = false) {
      await revealDesktopWindow();
      restartStartupSplashSpin();
      try {
        const demoOn = window.localStorage.getItem('office.development.demo') === 'on';
        let bootstrap: NativeBootstrap;
        if (demoOn) {
          const demo = await desktopInvoke<{ base: string }>('start_demo_service');
          if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(demo.base)) throw new Error('Invalid Demo service endpoint.');
          window.__AIR_SERVICE_BASE__ = demo.base;
          bootstrap = {
            service_base: demo.base,
            lemonade: { kind: 'attached', generation: null, base_origin: null, release: 'demo', state: 'configured' },
          };
        } else if (retry) {
          bootstrap = await desktopInvoke<NativeBootstrap>('restart_desktop_services');
        } else {
          // Lean cold start: Normal service only. Lemonade starts when Local AI is turned on.
          await desktopInvoke('start_service');
          bootstrap = await desktopInvoke<NativeBootstrap>('publish_bootstrap');
        }
        if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(bootstrap.service_base)) throw new Error('Invalid service endpoint.');
        window.__AIR_SERVICE_BASE__ = bootstrap.service_base;
        window.__AIR_LEMONADE_STATUS__ = bootstrap.lemonade;
        window.dispatchEvent(new CustomEvent('air-office-bootstrap', { detail: bootstrap }));
        if (!localStorage.getItem('air-office:network-access-prompted')) {
          void import('../shared/windows-network-access.adapter')
            .then(({ ensureWindowsNetworkAccess }) => ensureWindowsNetworkAccess())
            .catch(() => null)
            .finally(() => localStorage.setItem('air-office:network-access-prompted', '1'));
        }
        unlisten?.();
        unlisten = await listenDesktopBootstrap((payload) => {
          if (/^http:\/\/127\.0\.0\.1:\d+$/.test(payload.service_base)) window.__AIR_SERVICE_BASE__ = payload.service_base;
          window.__AIR_LEMONADE_STATUS__ = payload.lemonade;
          window.dispatchEvent(new CustomEvent('air-office-bootstrap', { detail: payload }));
        });
        renderWorkspace();
      } catch (error) {
        dismissStartupIntro();
        const detail = typeof error === 'string'
          ? error
          : error instanceof Error
            ? error.message
            : error && typeof error === 'object' && 'message' in error
              ? String((error as { message: unknown }).message)
              : '';
        const message = detail.trim() || 'AIR Office could not start its local services. Check that the app files are installed, then retry.';
        root.render(<main className="desktop-startup"><p role="alert">{message}</p><Button size="sm" onPress={() => void start(true)}>Retry startup</Button></main>);
      }
    }
    void start();
    return;
  }
  renderWorkspace();
}

void boot();

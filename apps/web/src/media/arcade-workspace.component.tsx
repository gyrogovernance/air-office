import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GlassToolbar, GlassToolbarButton } from '@glass-sdk/liquid-glass';
import nunitoStyles from '@fontsource-variable/nunito/index.css?inline';
import { publicAsset } from '../static-demo/public-asset';

type GameControl = { key: string; label: string; disabled: boolean };

export function ArcadeWorkspace({ appearance }: { appearance: 'light' | 'dark' }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [controls, setControls] = useState<GameControl[]>([]);
  const [playing, setPlaying] = useState(false);
  const [toolbarHost, setToolbarHost] = useState<Element | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  function syncAppearance() {
    const root = frame.current?.contentDocument?.documentElement;
    if (root && frame.current) {
      root.dataset.theme = appearance;
      root.style.colorScheme = appearance;
      const style = getComputedStyle(frame.current);
      root.style.setProperty('--air-stage-background', style.getPropertyValue('--surface-stage'));
      root.style.setProperty('--air-paper-texture', style.getPropertyValue('--paper-texture'));
      root.style.setProperty('--air-paper-opacity', style.getPropertyValue('--paper-texture-opacity'));
      // Sync AIR Office font variables so Arcade uses the same typography
      root.style.setProperty('--font-sans', style.getPropertyValue('--font-sans'));
      root.style.setProperty('--font-mono', style.getPropertyValue('--font-mono'));
      root.style.setProperty('--font-code', style.getPropertyValue('--font-code'));
      root.style.setProperty('--text-xs', style.getPropertyValue('--text-xs'));
      root.style.setProperty('--text-sm', style.getPropertyValue('--text-sm'));
      root.style.setProperty('--text-md', style.getPropertyValue('--text-md'));
      root.style.setProperty('--text-lg', style.getPropertyValue('--text-lg'));
      root.style.setProperty('--text-xl', style.getPropertyValue('--text-xl'));
      root.style.setProperty('--text-2xl', style.getPropertyValue('--text-2xl'));
      root.style.setProperty('--text-3xl', style.getPropertyValue('--text-3xl'));
      root.style.setProperty('--text-4xl', style.getPropertyValue('--text-4xl'));
      root.style.setProperty('--font-size-body', style.getPropertyValue('--font-size-body'));
    }
  }
  useEffect(syncAppearance, [appearance]);
  useEffect(() => {
    let signature = '';
    const timer = window.setInterval(() => {
      const library = frame.current?.contentDocument;
      const active = Boolean(library?.body.classList.contains('in-game'));
      const game = library?.querySelector<HTMLIFrameElement>('#frame')?.contentDocument;
      const next: GameControl[] = [];
      buttons.current.clear();
      if (active && game) {
        if (!game.getElementById('air-toolbar-style')) {
          const style = game.createElement('style');
          style.id = 'air-toolbar-style';
          style.textContent = '.ljs-menu-toolbar { display: none !important; }';
          game.head.appendChild(style);
        }
        for (const [index, button] of [...game.querySelectorAll<HTMLButtonElement>('.ljs-menu-toolbar button')].entries()) {
          const label = button.title || button.getAttribute('aria-label') || button.textContent?.trim();
          if (!label || label === 'Library' || /fullscreen/i.test(label) || button.hidden) continue;
          const key = String(index);
          buttons.current.set(key, button);
          next.push({ key, label, disabled: button.disabled });
        }
      }
      const nextSignature = JSON.stringify([active, next]);
      if (signature !== nextSignature) { signature = nextSignature; setPlaying(active); setControls(next); }
    }, 200);
    return () => window.clearInterval(timer);
  }, []);
  function loaded() {
    const document = frame.current?.contentDocument;
    if (document && !document.getElementById('air-arcade-fonts')) {
      const fonts = document.createElement('style');
      fonts.id = 'air-arcade-fonts';
      fonts.textContent = nunitoStyles;
      document.head.appendChild(fonts);
    }
    syncAppearance();
    setToolbarHost(frame.current?.closest('.stage') ?? null);
  }
  const toolbar = playing && <GlassToolbar className="document-format-bar arcade-game-toolbar" aria-label="Game controls" material="regular" appearance={appearance} refraction={0}>
    <GlassToolbarButton size="default" className="arcade-game-action" onClick={() => frame.current?.contentDocument?.getElementById('sidebar-logo-wrap')?.click()}>Games</GlassToolbarButton>
    {controls.map(control => <GlassToolbarButton size="default" key={control.key} className="arcade-game-action" disabled={control.disabled} onClick={() => { buttons.current.get(control.key)?.click(); frame.current?.contentDocument?.querySelector<HTMLIFrameElement>('#frame')?.contentWindow?.focus(); }}>{control.label}</GlassToolbarButton>)}
  </GlassToolbar>;
  return <><iframe ref={frame} className="arcade-console" data-playing={playing} style={{ colorScheme: appearance }} title="Arcade" src={`${publicAsset('arcade/index.html')}?air=20261110-1&theme=${appearance}`} onLoad={loaded} allow="autoplay; gamepad"/>{toolbarHost && createPortal(toolbar, toolbarHost)}</>;
}

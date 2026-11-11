import { useEffect } from 'react';

const SPLASH_ID = 'startup-intro';

function releaseStartupPending() {
  document.documentElement.classList.remove('startup-pending');
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', '#e9edf3');
}

/**
 * WKWebView often starts the splash while the window is still hidden and then
 * leaves the CSS spin frozen on the first frame. Restarting the animation after
 * show() restores the rotating mark on macOS.
 */
export function restartStartupSplashSpin(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const spin = document.querySelector<HTMLElement>(`#${SPLASH_ID} .startup-intro__spin`);
  if (!spin) return;
  spin.style.animation = 'none';
  void spin.offsetWidth;
  spin.style.animation = '';
}

/** Release the HTML first-paint splash so it can fade, then remove it. */
export function StartupIntro() {
  useEffect(() => {
    const el = document.getElementById(SPLASH_ID);
    if (!el) {
      releaseStartupPending();
      return;
    }
    restartStartupSplashSpin();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Drop the hold immediately so a Demo reload cannot leave an opaque black
    // blocker over the shell while services reconnect.
    el.classList.remove('startup-intro--hold');
    // Black page chrome can clear once the fade starts; do not wait for removal.
    releaseStartupPending();
    const timer = window.setTimeout(() => {
      el.remove();
    }, reduce ? 500 : 2800);
    return () => {
      window.clearTimeout(timer);
      // Leave the node in place on cleanup so React StrictMode remounts do not flash the page.
    };
  }, []);
  return null;
}

/** Remove the first-paint splash when startup fails and the error screen must show. */
export function dismissStartupIntro() {
  document.getElementById(SPLASH_ID)?.remove();
  releaseStartupPending();
}

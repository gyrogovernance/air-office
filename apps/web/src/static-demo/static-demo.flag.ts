/** Compile-time gate for the GitHub Pages static demo build only. */
export function staticDemoBuild(): boolean {
  return import.meta.env.VITE_STATIC_DEMO === '1';
}

/** Fake service origin used only when `staticDemoBuild()` is true. */
export const STATIC_DEMO_SERVICE_BASE = 'https://static.demo.local';

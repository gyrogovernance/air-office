import type { LemonadeBootstrapStatus } from './desktop-window.d';

declare global {
  interface Window {
    airDesktop?: unknown;
    __AIR_SERVICE_BASE__?: string;
    __AIR_LEMONADE_STATUS__?: LemonadeBootstrapStatus;
  }
}

export {};

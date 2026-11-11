/** Persisted interface size, or auto from the current window. */
export type InterfaceScaleChoice = 'auto' | 'compact' | 'comfortable' | 'large';
export type DocumentScaleChoice = 'compact' | 'comfortable' | 'large';
export type ResolvedDisplayScale = 'compact' | 'comfortable' | 'large';

export const INTERFACE_SCALE_VALUES: Record<ResolvedDisplayScale, string> = {
  compact: '0.85',
  comfortable: '1',
  large: '1.15',
};

export const DOCUMENT_SCALE_VALUES: Record<ResolvedDisplayScale, string> = {
  compact: '0.9',
  comfortable: '1',
  large: '1.15',
};

/**
 * Window size for Auto interface density. Prefer outerWidth/outerHeight so the
 * desktop webview zoom factor (Interface size) does not feed back into the
 * recommendation — measuring innerWidth after setZoom caused Mac UI to jiggle
 * as Auto flipped bands and remounted glass.
 */
export function layoutViewportSize(win: Pick<Window, 'outerWidth' | 'outerHeight' | 'innerWidth' | 'innerHeight'> = window): { width: number; height: number } {
  const width = win.outerWidth > 0 ? win.outerWidth : win.innerWidth;
  const height = win.outerHeight > 0 ? win.outerHeight : win.innerHeight;
  return { width, height };
}

function rawRecommendedInterfaceScale(width: number, height: number): ResolvedDisplayScale {
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (shortSide <= 800 || longSide < 1400) return 'compact';
  if (shortSide >= 1000 && longSide >= 1680) return 'large';
  return 'comfortable';
}

/**
 * Pick a workspace density from the visible window. When `previous` is set,
 * keep the last band across a small margin so resize + zoom settle does not
 * oscillate (especially on macOS WKWebView).
 */
export function recommendedInterfaceScale(width: number, height: number, previous?: ResolvedDisplayScale): ResolvedDisplayScale {
  const next = rawRecommendedInterfaceScale(width, height);
  if (!previous || previous === next) return next;

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);

  if (previous === 'compact') {
    // Stay compact until clearly past the compact threshold.
    if (shortSide <= 860 || longSide < 1480) return 'compact';
  }
  if (previous === 'large') {
    // Stay large until clearly below the large threshold.
    if (shortSide >= 960 && longSide >= 1600) return 'large';
  }
  if (previous === 'comfortable') {
    if (next === 'compact' && shortSide > 760 && longSide >= 1340) return 'comfortable';
    if (next === 'large' && (shortSide < 1040 || longSide < 1740)) return 'comfortable';
  }
  return next;
}

export function readInterfaceScaleChoice(stored: unknown): InterfaceScaleChoice {
  return stored === 'compact' || stored === 'comfortable' || stored === 'large' || stored === 'auto' ? stored : 'auto';
}

export function readDocumentScaleChoice(stored: unknown): DocumentScaleChoice {
  return stored === 'compact' || stored === 'comfortable' || stored === 'large' ? stored : 'comfortable';
}

export function resolveInterfaceScale(
  stored: unknown,
  width: number,
  height: number,
  previous?: ResolvedDisplayScale,
): ResolvedDisplayScale {
  const choice = readInterfaceScaleChoice(stored);
  return choice === 'auto' ? recommendedInterfaceScale(width, height, previous) : choice;
}

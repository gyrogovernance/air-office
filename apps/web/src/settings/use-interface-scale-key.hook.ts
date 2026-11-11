import { useEffect, useRef, useState } from 'react';
import { INTERFACE_SCALE_VALUES, layoutViewportSize, readInterfaceScaleChoice, resolveInterfaceScale, type ResolvedDisplayScale } from './display-scale.policy';
import { PERSONAL_SETTINGS_KEY, readSettingsValues } from './settings.store';

/** Current interface scale string for remounting *small* nested GlassScenes after density changes.
 *  Do not use this to remount the shell or stage — that tears down Settings while the slider moves. */
export function useInterfaceScaleKey(): string {
  const [scale, setScale] = useState(() => INTERFACE_SCALE_VALUES.comfortable);
  const previousBand = useRef<ResolvedDisplayScale | null>(null);
  const settleUntil = useRef(0);
  useEffect(() => {
    const apply = (source: 'prefs' | 'resize' | 'startup') => {
      if (source === 'resize' && performance.now() < settleUntil.current) return;
      const preferences = readSettingsValues(PERSONAL_SETTINGS_KEY);
      const choice = readInterfaceScaleChoice(preferences['appearance.interface-size']);
      if (source === 'resize' && choice !== 'auto') return;
      const { width, height } = layoutViewportSize(window);
      const band = resolveInterfaceScale(preferences['appearance.interface-size'], width, height, previousBand.current ?? undefined);
      previousBand.current = band;
      const next = INTERFACE_SCALE_VALUES[band];
      setScale((current) => {
        if (current === next) return current;
        settleUntil.current = performance.now() + 600;
        return next;
      });
    };
    apply('startup');
    const onPrefs = () => apply('prefs');
    const onResize = () => apply('resize');
    window.addEventListener('office-display-scale-changed', onPrefs);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('office-display-scale-changed', onPrefs);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return scale;
}

import { GlassScene, GlassContent, GlassSurface, GlassShape } from '@glass-sdk/liquid-glass';
import { useInterfaceScaleKey } from '../settings/use-interface-scale-key.hook';

const backgrounds = [
  'linear-gradient(145deg, #aacbfc, #2c7edb)',
  'linear-gradient(145deg, #e5d5ff, #a16cd2)',
  'linear-gradient(145deg, #aceee5, #108d72)',
  'linear-gradient(145deg, #f0cca4, #a36f25)',
  'linear-gradient(145deg, #f6b4c6, #d65471)',
];

/** A simple colored backdrop registered beneath the SDK squircle and emoji. */
export function AppIcon({ name, emoji = '✨', size = 40, appearance = 'light' }: { name: string; emoji?: string; size?: number; appearance?: 'light' | 'dark' }) {
  const scaleKey = useInterfaceScaleKey();
  const colorIndex = Array.from(name).reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0) % backgrounds.length;
  return <GlassScene key={`app-icon-${scaleKey}`} className="workspace-app-icon" appearance={appearance} maxSurfaces={1} style={{ width: size, height: size }} aria-hidden="true">
    <GlassContent><GlassShape radius={Math.round(size * .26)} style={{ width: size, height: size, background: backgrounds[colorIndex] }}/></GlassContent>
    <GlassSurface className="ui-frost" material="regular" radius={Math.round(size * .26)} style={{ width: size, height: size }}><span style={{ fontSize: size * .48 }}>{emoji}</span></GlassSurface>
  </GlassScene>;
}

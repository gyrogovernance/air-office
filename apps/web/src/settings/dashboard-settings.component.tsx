import { HugeiconsIcon } from '@hugeicons/react';
import { Card, Label, Separator, Slider, Switch } from '@heroui/react';
import { Calendar03Icon, CloudIcon, CpuIcon, DatabaseIcon, PlugSocketIcon, SlidersHorizontalIcon } from '@hugeicons/core-free-icons';
import { SelectField } from '../shared/select-field.component';
import { publicAsset } from '../static-demo/public-asset';
import {
  layoutViewportSize,
  recommendedInterfaceScale,
  type DocumentScaleChoice,
  type InterfaceScaleChoice,
  type ResolvedDisplayScale,
} from './display-scale.policy';

export type { DocumentScaleChoice, InterfaceScaleChoice };
export type DisplayScale = ResolvedDisplayScale;

type Props = {
  theme: DashboardThemeChoice;
  onThemeChange?: (choice: DashboardThemeChoice) => void;
  interfaceScale: InterfaceScaleChoice;
  documentScale: DocumentScaleChoice;
  onInterfaceScaleChange: (scale: InterfaceScaleChoice) => void;
  onDocumentScaleChange: (scale: DocumentScaleChoice) => void;
  liquidGlass: boolean;
  onLiquidGlassChange: (enabled: boolean) => void;
  onOpenSection: (section: 'data' | 'local-ai' | 'cloud-ai' | 'tools' | 'automations') => void;
  /** The quick start panel, rendered above the dashboard cards. */
  quickStart?: React.ReactNode;
};

export type DashboardThemeChoice = 'light' | 'dark' | 'system';

type QuickLink = {
  section: 'data' | 'local-ai' | 'cloud-ai' | 'tools' | 'automations';
  label: string;
  detail: string;
  icon: typeof DatabaseIcon;
};

const QUICK_LINKS: readonly QuickLink[] = [
  { section: 'data', label: 'Storage', detail: 'Folders, export and cleanup', icon: DatabaseIcon },
  { section: 'local-ai', label: 'Local models', detail: 'Runtime and downloads', icon: CpuIcon },
  { section: 'cloud-ai', label: 'Cloud models', detail: 'Providers and keys', icon: CloudIcon },
  { section: 'tools', label: 'Tools', detail: 'Services and tools', icon: PlugSocketIcon },
  { section: 'automations', label: 'Schedules', detail: 'Recurring prompts', icon: Calendar03Icon },
];

function resolvedScaleLabel(scale: ResolvedDisplayScale): string {
  return scale === 'compact' ? 'Compact' : scale === 'large' ? 'Larger' : 'Comfortable';
}

function interfaceScaleIndex(scale: InterfaceScaleChoice): number {
  return scale === 'auto' ? 0 : scale === 'compact' ? 1 : scale === 'large' ? 3 : 2;
}

function interfaceScaleFromIndex(value: number): InterfaceScaleChoice {
  if (value <= 0) return 'auto';
  if (value === 1) return 'compact';
  if (value >= 3) return 'large';
  return 'comfortable';
}

function documentScaleIndex(scale: DocumentScaleChoice): number {
  return scale === 'compact' ? 0 : scale === 'large' ? 2 : 1;
}

function documentScaleFromIndex(value: number): DocumentScaleChoice {
  return value <= 0 ? 'compact' : value >= 2 ? 'large' : 'comfortable';
}

function interfaceScaleLabel(scale: InterfaceScaleChoice): string {
  if (scale !== 'auto') return resolvedScaleLabel(scale);
  if (typeof window === 'undefined') return 'Auto';
  const { width, height } = layoutViewportSize(window);
  return `Auto · ${resolvedScaleLabel(recommendedInterfaceScale(width, height))}`;
}

/** The settings people reach for most, gathered on one page. */
export function DashboardSettingsSection({ theme, onThemeChange, interfaceScale, documentScale, onInterfaceScaleChange, onDocumentScaleChange, liquidGlass, onLiquidGlassChange, onOpenSection, quickStart }: Props) {
  return (
    <section className="settings-dashboard settings-blocks" aria-label="Dashboard">
      <header className="settings-dashboard-hero">
        <img className="settings-dashboard-hero-logo" src={publicAsset('air_logo_vector.svg')} alt="" width={44} height={44} />
        <div className="settings-dashboard-hero-copy">
          <h2 className="settings-dashboard-hero-title">AIR Office</h2>
          <p className="settings-dashboard-hero-version">Alpha Version 0.1.0</p>
        </div>
      </header>
      {quickStart}
      <div className="settings-dashboard-grid">
        <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <article {...props} />}>
          <Card.Header>
            <Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={SlidersHorizontalIcon} size={18} aria-hidden="true" />Appearance</Card.Title>
            <Card.Description>Theme and how large the workspace feels on this screen.</Card.Description>
          </Card.Header><Separator />
          <Card.Content>
          <SelectField className="settings-select" aria-label="Theme" value={theme} onValueChange={(selectedValue) => onThemeChange?.(selectedValue === 'dark' ? 'dark' : selectedValue === 'light' ? 'light' : 'system')}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">Match system</option>
          </SelectField>
          <div className="settings-display-scales">
            <Slider className="settings-display-slider" value={interfaceScaleIndex(interfaceScale)} minValue={0} maxValue={3} step={1} onChange={(value) => onInterfaceScaleChange(interfaceScaleFromIndex(Array.isArray(value) ? value[0] ?? 0 : value))}>
              <div className="settings-display-slider-heading"><Label>Interface size</Label><span>{interfaceScaleLabel(interfaceScale)}</span></div>
              <Slider.Track><Slider.Fill/><Slider.Thumb/></Slider.Track>
            </Slider>
            <p className="settings-pref-help">Comfortable is 100%. The desktop app uses the same zoom as Ctrl +/-; in the browser preview it uses page zoom. Auto follows the window frame size (not the zoomed page), with hysteresis so resize does not flicker; Compact, Comfortable, and Larger stay until you change them.</p>
            <Slider className="settings-display-slider" value={documentScaleIndex(documentScale)} minValue={0} maxValue={2} step={1} onChange={(value) => onDocumentScaleChange(documentScaleFromIndex(Array.isArray(value) ? value[0] ?? 1 : value))}>
              <div className="settings-display-slider-heading"><Label>Document reading size</Label><span>{resolvedScaleLabel(documentScale)}</span></div>
              <Slider.Track><Slider.Fill/><Slider.Thumb/></Slider.Track>
            </Slider>
            <p className="settings-pref-help">Only the text inside notes and documents, on top of interface size.</p>
            <div className="settings-display-slider">
              <div className="settings-display-slider-heading">
                <Label>Liquid Glass & Transparency</Label>
                <Switch
                  className="settings-switch"
                  aria-label="Liquid Glass and Transparency"
                  isSelected={liquidGlass}
                  onChange={onLiquidGlassChange}
                >
                  <Switch.Content>
                    <Switch.Control><Switch.Thumb/></Switch.Control>
                  </Switch.Content>
                </Switch>
              </div>
              <p className="settings-pref-help">Turn this off for solid panels that are easier on slower computers.</p>
            </div>
          </div>
          </Card.Content>
        </Card>
      </div>
      <h3 className="settings-subsection-title">Jump to</h3>
      <ul className="settings-dashboard-links">
        {QUICK_LINKS.map((link) => (
          <li key={link.section}>
            <button type="button" className="settings-dashboard-link" onClick={() => onOpenSection(link.section)}>
              <span className="settings-dashboard-link-icon"><HugeiconsIcon icon={link.icon} size={16} aria-hidden="true" /></span>
              <span className="settings-dashboard-link-copy">
                <span className="settings-dashboard-link-label">{link.label}</span>
                <span className="settings-dashboard-link-detail">{link.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

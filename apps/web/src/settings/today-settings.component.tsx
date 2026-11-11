import { useEffect, useState } from 'react';
import { Button, Checkbox, Input, TextArea } from '@heroui/react';
import { SelectField } from '../shared/select-field.component';
import { DEFAULT_TODAY_SETTINGS, readTodaySettings, writeTodaySettings, type TodaySettings } from './today-settings.store';

/** Settings → Today: the source, interests and one optional editorial note. */
export function TodaySettingsSection({ models }: { models: { providerId: string; modelId: string; label: string; hidden?: boolean }[] }) {
  const [settings, setSettings] = useState<TodaySettings>(readTodaySettings);
  const [notice, setNotice] = useState('');

  function save(next: TodaySettings, options?: { quiet?: boolean }) {
    setSettings(next);
    writeTodaySettings(next);
    window.dispatchEvent(new Event('office-today-settings-changed'));
    if (!options?.quiet) setNotice('Edition preferences saved.');
  }

  // Drop leftovers such as Demo-Chat once that model is no longer offered.
  useEffect(() => {
    setSettings((current) => {
      if (!current.model) return current;
      const stillOffered = models.some((item) => item.providerId === current.model?.providerId && item.modelId === current.model?.modelId);
      if (stillOffered) return current;
      const next = { ...current, model: null };
      writeTodaySettings(next);
      window.dispatchEvent(new Event('office-today-settings-changed'));
      return next;
    });
  }, [models]);

  return (
    <section className="settings-group" aria-label="Today edition">
      <div className="settings-pref-row">
        <div className="settings-pref-copy"><span className="settings-pref-label">Edition model</span><span className="settings-pref-help">Choose the model that writes your edition, or follow your current chat model.</span></div>
        <SelectField aria-label="Today edition model" value={settings.model ? JSON.stringify(settings.model) : ''} onValueChange={(value) => { const selected = models.find((item) => JSON.stringify({ providerId: item.providerId, modelId: item.modelId }) === value); save({ ...settings, model: selected ? { providerId: selected.providerId, modelId: selected.modelId } : null }); }}>
          <option value="">Use current chat model</option>
          {models.filter((item) => !item.hidden || item.providerId === settings.model?.providerId && item.modelId === settings.model?.modelId).map((item) => <option key={JSON.stringify([item.providerId, item.modelId])} value={JSON.stringify({ providerId: item.providerId, modelId: item.modelId })}>{item.label}{item.hidden ? ' (hidden)' : ''}</option>)}
        </SelectField>
      </div>
      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">News source</span>
          <span className="settings-pref-help">Wikipedia's human-edited In the news selection by default. Choose news search to follow your interests.</span>
        </div>
        <SelectField
          aria-label="Today news source"
          value={settings.source}
          onValueChange={(value) => save({ ...settings, source: value === 'search' ? 'search' : 'curated' })}
        >
          <option value="curated">Curated digest · Wikipedia</option>
          <option value="search">News search · My interests</option>
        </SelectField>
      </div>

      {settings.source === 'search' && (
        <div className="settings-pref-row">
          <div className="settings-pref-copy">
            <span className="settings-pref-label">Interests</span>
            <span className="settings-pref-help">Topics for news search, such as local AI or cycling. Used when News source is set to My interests.</span>
          </div>
          <Input
            className="settings-input-wide"
            type="text"
            aria-label="Edition interests"
            maxLength={300}
            value={settings.interests}
            placeholder="What should the front page care about?"
            onChange={(event) => save({ ...settings, interests: event.target.value })}
          />
        </div>
      )}

      <div className="settings-pref-row settings-pref-row-stack">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Editor's note</span>
          <span className="settings-pref-help">Your standing instruction, added to every edition — tone, style, things to always include or avoid.</span>
        </div>
        <TextArea
          className="settings-input-wide"
          aria-label="Editor's note"
          rows={3}
          maxLength={1000}
          value={settings.prompt}
          placeholder='e.g. "Keep it under 500 words. Prefer European sources. No sports."'
          onChange={(event) => save({ ...settings, prompt: event.target.value })}
        />
      </div>

      <div className="settings-pref-row">
        <div className="settings-pref-copy">
          <span className="settings-pref-label">Your day</span>
          <span className="settings-pref-help">Print today's calendar above the news when events are scheduled.</span>
        </div>
        <Checkbox
          className="settings-check"
          isSelected={settings.sections.includes('day')}
          onChange={(checked) => save({ ...settings, sections: checked ? ['day'] : [] })}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <span>Include calendar</span>
          </Checkbox.Content>
        </Checkbox>
      </div>
      <Button variant="tertiary" size="sm" onPress={() => save({ ...DEFAULT_TODAY_SETTINGS })}>
        Reset to defaults
      </Button>
      {notice && (
        <p className="settings-profile-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

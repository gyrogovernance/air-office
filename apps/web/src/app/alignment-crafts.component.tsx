import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CraftBindings, CraftPackage, CraftRecord, CraftResource, CraftResourceKind, CraftSnapshot } from '@office/methods/domain';
import { createServiceClient } from '../shared/service-client.hook';
import { useModelVisibility, visibleModelChoices } from '../models/model-visibility.hook';
import { SelectField } from '../shared/select-field.component';
import { Button, Checkbox, Separator, Switch } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUpRight01Icon, BookOpen01Icon } from '@hugeicons/core-free-icons';
import type { KnowledgeCatalogFeed } from '../market/market-knowledge-catalog.component';
import { DashboardCollection } from '../shared/collection-dashboard.component';
import { craftComponentsOutline, firstSentence, referencePresentationAbout, referencePresentationSources, standardPresentation, type StandardSourceLink } from './standard-presentation.catalog';

type StandardFeed = KnowledgeCatalogFeed & { source: 'bundled' | 'remote' };

/** Lab crafts stay first: The Human Mark, then Gyroscopic Reasoning. */
const CRAFT_LIST_ORDER = ['the-human-mark', 'gyroscopic-reasoning'];

function craftListRank(id: string): number {
  const index = CRAFT_LIST_ORDER.indexOf(id);
  return index < 0 ? CRAFT_LIST_ORDER.length : index;
}

function craftStandardIcon(record: CraftRecord): string {
  if (record.package.runtime === 'human-mark') return '/icons/fluent/raised-hand-3d.png';
  if (record.package.runtime === 'gyroscopic-reasoning') return '/icons/fluent/compass-3d.png';
  if (record.package.id === 'owasp-secure-agent-playbook') return '/icons/fluent/ic_fluent_shield_checkmark_48_color.svg';
  if (record.package.id === 'ngo-playbook') return '/icons/fluent/ic_fluent_people_community_48_color.svg';
  return '/icons/fluent/ic_fluent_diversity_48_color.svg';
}

function LinksSection({ links, note }: { links: StandardSourceLink[]; note?: string }) {
  if (!links.length && !note) return null;
  return <>
    <Separator />
    <section className="collection-dashboard__section">
      <h3>Links</h3>
      {links.length > 0 && (
        <ul className="craft-standard-links">
          {links.map((link) => (
            <li key={`${link.label}:${link.url}`}>
              <a href={link.url} target="_blank" rel="noreferrer">
                <span>{link.label}</span>
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-sm text-muted">{note}</p>}
    </section>
  </>;
}

function bindingLabel(kind: CraftResourceKind): string {
  if (kind === 'model') return 'Model';
  if (kind === 'embedding') return 'Memory index';
  if (kind === 'knowledge') return 'Knowledge';
  if (kind === 'tool') return 'Tool';
  if (kind === 'mcp') return 'MCP';
  if (kind === 'calendar') return 'Calendar';
  return 'Conversation';
}

function bindingPlaceholder(kind: CraftResourceKind): string {
  if (kind === 'model') return 'Choose a model';
  if (kind === 'embedding') return 'Choose a memory index';
  if (kind === 'knowledge') return 'Choose a Knowledge collection';
  if (kind === 'tool') return 'Choose a tool';
  if (kind === 'mcp') return 'Choose an MCP connection';
  if (kind === 'calendar') return 'Choose a calendar';
  return 'Choose a conversation';
}

function defaultBindings(craft: CraftPackage, bindings: CraftBindings, resources: CraftResource[]): CraftBindings {
  const selected: CraftBindings = {};
  for (const requirement of craft.requirements) {
    const candidate = bindings[requirement.key] ?? requirement.suggested;
    if (candidate && (bindings[requirement.key] === candidate || resources.some(item => item.kind === requirement.kind && item.id === candidate && item.available))) {
      selected[requirement.key] = candidate;
    }
  }
  return selected;
}

function requiredBindingsReady(craft: CraftPackage, bindings: CraftBindings, resources: CraftResource[]): boolean {
  return craft.requirements.every((requirement) => {
    if (requirement.optional) return true;
    const id = bindings[requirement.key];
    return Boolean(id && resources.some((item) => item.kind === requirement.kind && item.id === id && item.available));
  });
}

function needsMutateConfirmation(craft: CraftPackage, bindings: CraftBindings, resources: CraftResource[]): boolean {
  return craft.automations.some((item) => item.steps.some((step) => {
    if (step.kind !== 'tool') return false;
    const requirement = craft.requirements.find((value) => `@craft:${value.key}` === step.toolId);
    return Boolean(requirement && resources.some((resource) => resource.kind === 'tool' && resource.id === bindings[requirement.key] && resource.effect === 'mutate'));
  }));
}

type EnableSetup = { id: string; bindings: CraftBindings; confirmed: boolean };

export function AlignmentCrafts({ onManage, onOpenKnowledge, onChanged }: { onManage: () => void; onOpenKnowledge: () => void; onChanged?: () => Promise<void> }) {
  const client = useMemo(() => createServiceClient(), []);
  const visibility = useModelVisibility();
  const [snapshot, setSnapshot] = useState<CraftSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<StandardFeed[]>([]);
  const [feedError, setFeedError] = useState('');
  const [setup, setSetup] = useState<EnableSetup | null>(null);
  const refresh = useCallback(
    (signal?: AbortSignal) => {
      void client
        .json<CraftSnapshot>('/api/v1/crafts', signal ? { signal } : undefined)
        .then((value) => {
          setSnapshot(value);
          setLoadError('');
        })
        .catch((reason) => {
          if (signal?.aborted) return;
          setLoadError(reason instanceof Error ? reason.message : 'Could not load craft settings.');
        });
    },
    [client],
  );
  useEffect(() => {
    const controller = new AbortController();
    const reload = () => refresh(controller.signal);
    reload();
    window.addEventListener('air-office:crafts-changed', reload);
    return () => {
      controller.abort();
      window.removeEventListener('air-office:crafts-changed', reload);
    };
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    void client.json<{ feeds: StandardFeed[] }>('/api/v1/knowledge-feeds', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setFeeds(result.feeds); setFeedError(''); } })
      .catch(() => { if (!controller.signal.aborted) setFeedError('Reference packages could not be loaded.'); });
    return () => controller.abort();
  }, [client]);

  const packages = feeds.filter(feed => feed.source === 'bundled').flatMap(feed =>
    [...new Set(feed.entries.map(entry => entry.collectionId))].map(id => ({
      id: `reference:${feed.id}:${id}`, feedId: feed.id, collectionId: id, entries: feed.entries.filter(entry => entry.collectionId === id),
    }))
  );
  async function usePackage(pack: typeof packages[number]) {
    setBusy(pack.id); setError('');
    try {
      for (const entry of pack.entries) {
        if (!entry.installed) await client.json(`/api/v1/knowledge-feeds/${encodeURIComponent(pack.feedId)}/entries/${encodeURIComponent(entry.id)}/install`, { method: 'POST', body: '{}' });
      }
      const result = await client.json<{ feeds: StandardFeed[] }>('/api/v1/knowledge-feeds');
      setFeeds(result.feeds);
      await onChanged?.();
      onOpenKnowledge();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The package could not be added.'); }
    finally { setBusy(null); }
  }

  function resourceOptions(kind: CraftResourceKind, selectedResourceId: string): CraftResource[] {
    const resources = snapshot?.resources.filter(item => item.kind === kind) ?? [];
    if (kind !== 'model') return resources;
    const choices = resources.map(resource => ({ key: resource.model ? `${resource.model.providerId}:${resource.model.modelId}` : resource.id, label: resource.label, resource }));
    return visibleModelChoices(choices, visibility, choices.find(choice => choice.resource.id === selectedResourceId)?.key).map(choice => choice.resource);
  }

  async function applyConfigure(id: string, enabled: boolean, bindings: CraftBindings, confirmed: boolean) {
    setBusy(id);
    setError('');
    try {
      const result = await client.json<{ snapshot: CraftSnapshot }>('/api/v1/crafts', {
        method: 'POST',
        body: JSON.stringify({ action: 'configure', id, enabled, bindings, confirmed }),
      });
      setSnapshot(result.snapshot);
      setSetup(null);
      window.dispatchEvent(new Event('air-office:crafts-changed'));
      await onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update this Standard.');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(record: CraftRecord) {
    if (!snapshot) return;
    if (record.enabled) {
      await applyConfigure(record.package.id, false, record.bindings, false);
      return;
    }
    if (setup?.id === record.package.id) {
      setSetup(null);
      return;
    }
    const bindings = defaultBindings(record.package, record.bindings, snapshot.resources);
    const ready = requiredBindingsReady(record.package, bindings, snapshot.resources);
    const confirm = needsMutateConfirmation(record.package, bindings, snapshot.resources);
    if (ready && !confirm) {
      await applyConfigure(record.package.id, true, bindings, false);
      return;
    }
    setSetup({ id: record.package.id, bindings, confirmed: false });
    setSelectedId(`craft:${record.package.id}`);
    setError('');
  }

  const needle = query.trim().toLowerCase();
  const visible = (snapshot?.crafts.filter(record => {
    const presentation = standardPresentation(record.package.id);
    const haystack = `${record.package.name} ${presentation?.about ?? record.package.description}`;
    return haystack.toLowerCase().includes(needle);
  }) ?? []).slice().sort((left, right) => {
    const rank = craftListRank(left.package.id) - craftListRank(right.package.id);
    return rank !== 0 ? rank : left.package.name.localeCompare(right.package.name);
  });
  const references = packages.filter(pack => pack.entries.some(entry => `${entry.collectionName} ${entry.title} ${entry.description} ${entry.publisher}`.toLowerCase().includes(needle)));
  const selected = visible.find(record => `craft:${record.package.id}` === selectedId);
  const selectedReference = references.find(pack => pack.id === selectedId);
  const firstId = visible[0] ? `craft:${visible[0].package.id}` : references[0]?.id;
  const activeId = selected || selectedReference ? selectedId : firstId ?? null;
  const activeCraft = selected ?? (activeId?.startsWith('craft:') ? visible.find(record => `craft:${record.package.id}` === activeId) : undefined);
  const activeReference = selectedReference ?? references.find(pack => pack.id === activeId);

  const craftPresentation = activeCraft ? standardPresentation(activeCraft.package.id) : undefined;
  const craftAbout = craftPresentation?.about ?? (activeCraft ? firstSentence(activeCraft.package.description) : '');
  const craftComponents = activeCraft ? craftComponentsOutline(activeCraft.package) : null;
  const activeSetup = activeCraft && setup?.id === activeCraft.package.id ? setup : null;
  const setupRequirements = activeSetup && activeCraft
    ? activeCraft.package.requirements.filter((requirement) => !requirement.optional || Boolean(activeSetup.bindings[requirement.key]))
    : [];
  const setupReady = Boolean(activeCraft && activeSetup && snapshot && requiredBindingsReady(activeCraft.package, activeSetup.bindings, snapshot.resources));
  const setupNeedsConfirm = Boolean(activeCraft && activeSetup && snapshot && needsMutateConfirmation(activeCraft.package, activeSetup.bindings, snapshot.resources));

  return <>
    {(error || loadError || feedError) && <p role="alert" className="m-3 text-sm text-danger">{error || loadError || feedError}</p>}
    {!snapshot && !loadError && <p role="status" className="m-3 text-sm text-muted">Loading standards…</p>}
    <DashboardCollection
      listLabel="Standards"
      search={{ value: query, onChange: setQuery, placeholder: 'Search standards...', label: 'Search standards' }}
      items={[
        ...visible.map(record => ({ id: `craft:${record.package.id}`, title: record.package.name,
          description: record.enabled ? 'Enabled' : 'Disabled', section: 'Crafts',
          icon: <img src={craftStandardIcon(record)} width={32} height={32} alt="" aria-hidden="true" /> })),
        ...references.map(pack => ({ id: pack.id, title: pack.entries[0]?.collectionName ?? '',
          description: `${pack.entries.length} documents`, section: 'References',
          icon: <span className="craft-reference-icon" aria-hidden="true"><HugeiconsIcon icon={BookOpen01Icon} size={20} /></span> })),
      ]}
      selectedId={activeId}
      onSelect={(id) => { setSelectedId(id); if (setup && id !== `craft:${setup.id}`) setSetup(null); }}
      preview={activeCraft ? {
        title: activeCraft.package.name,
        description: `${activeCraft.enabled ? 'Enabled' : activeSetup ? 'Choose what to use' : 'Disabled'} · v${activeCraft.package.version}`,
        headerAction: (
          <Switch
            aria-label={`Enable ${activeCraft.package.name}`}
            isSelected={activeCraft.enabled || Boolean(activeSetup)}
            isDisabled={busy !== null}
            onChange={() => void toggle(activeCraft)}
          >
            <Switch.Content>
              <Switch.Control><Switch.Thumb /></Switch.Control>
              <span className="sr-only">Enabled</span>
            </Switch.Content>
          </Switch>
        ),
        content: <>
          {activeSetup && <>
            <section className="collection-dashboard__section">
              <h3>Set up</h3>
              {setupRequirements.length > 0 && <p className="text-sm text-muted">Choose resources to use while this is enabled.</p>}
              {setupRequirements.map((requirement) => (
                <div className="alignment-craft-binding" key={requirement.key}>
                  <label htmlFor={`standard-binding-${requirement.key}`}>{bindingLabel(requirement.kind)}</label>
                  <SelectField
                    id={`standard-binding-${requirement.key}`}
                    value={activeSetup.bindings[requirement.key] ?? ''}
                    disabled={busy !== null}
                    onValueChange={(value) => setSetup({ ...activeSetup, bindings: { ...activeSetup.bindings, [requirement.key]: value } })}
                  >
                    <option value="">{bindingPlaceholder(requirement.kind)}</option>
                    {activeSetup.bindings[requirement.key] && !snapshot?.resources.some(item => item.kind === requirement.kind && item.id === activeSetup.bindings[requirement.key]) && (
                      <option value={activeSetup.bindings[requirement.key]} disabled>Previously selected · Unavailable</option>
                    )}
                    {resourceOptions(requirement.kind, activeSetup.bindings[requirement.key] ?? '').map((item) => (
                      <option key={item.id} value={item.id} disabled={!item.available}>{item.label}{item.available ? '' : ' · Unavailable'}</option>
                    ))}
                  </SelectField>
                </div>
              ))}
              {setupNeedsConfirm && (
                <Checkbox className="alignment-craft-confirm" isSelected={activeSetup.confirmed} onChange={(confirmed) => setSetup({ ...activeSetup, confirmed })}>
                  <Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Allow tool steps that change data.</Checkbox.Content>
                </Checkbox>
              )}
            </section>
            <Separator />
          </>}
          <section className="collection-dashboard__section">
            <h3>About</h3>
            <p className="collection-dashboard__prose text-sm leading-relaxed">{craftAbout}</p>
          </section>
          {craftComponents && <>
            <Separator />
            <section className="collection-dashboard__section">
              <h3>Components</h3>
              <p className="text-sm text-muted">{craftComponents.summary}</p>
              <div className="craft-components-outline">
                {craftComponents.groups.map((group) => (
                  <div key={group.title} className="craft-components-group">
                    <h4>{group.title}</h4>
                    <ul className="craft-reference-list">
                      {group.items.map((item) => (
                        <li key={`${group.title}:${item.name}`}>
                          <strong>{item.name}</strong>
                          {item.description ? <p>{item.description}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </>}
          <LinksSection links={craftPresentation?.sources ?? []} note={craftPresentation?.note} />
        </>,
        actions: activeSetup ? (
          <div className="craft-actions">
            <Button
              size="sm"
              isDisabled={busy !== null || !setupReady || (setupNeedsConfirm && !activeSetup.confirmed)}
              onPress={() => void applyConfigure(activeCraft.package.id, true, activeSetup.bindings, activeSetup.confirmed)}
            >
              Enable
            </Button>
            <Button variant="secondary" size="sm" isDisabled={busy !== null} onPress={() => setSetup(null)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onPress={onManage}>Manage</Button>
        ),
      } : activeReference ? (() => {
        const first = activeReference.entries[0]!;
        const installed = activeReference.entries.every((entry) => entry.installed);
        const about = referencePresentationAbout(activeReference.collectionId);
        const sources = referencePresentationSources(activeReference.collectionId, first.publisher, first.sourceUrl);
        return {
          title: first.collectionName,
          description: `${activeReference.entries.length} documents · ${installed ? 'In Knowledge' : 'Not in Knowledge'}`,
          content: <>
            {about && <section className="collection-dashboard__section"><h3>About</h3><p className="collection-dashboard__prose text-sm leading-relaxed">{about}</p></section>}
            <LinksSection links={sources} />
            <Separator />
            <section className="collection-dashboard__section">
              <h3>Documents</h3>
              <ul className="craft-reference-list">
                {activeReference.entries.map((entry) => (
                  <li key={entry.id}><strong>{entry.title}</strong></li>
                ))}
              </ul>
            </section>
          </>,
          actions: <Button size="sm" isDisabled={busy !== null} onPress={() => void usePackage(activeReference)}>{busy === activeReference.id ? 'Adding…' : installed ? 'Open knowledge' : 'Use package'}</Button>,
        };
      })() : null}
      empty={{ title: 'No matching standards', description: 'Try another search.', action: <Button variant="secondary" size="sm" onPress={onManage}>Manage</Button> }}
    />
  </>;
}

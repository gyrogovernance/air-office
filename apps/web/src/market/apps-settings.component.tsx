import { AppIcon } from '../shared/app-icon.component';
import { useEffect, useState } from 'react';
import { CollapsibleSection } from '../shared/collapsible-section.component';
import { createServiceClient, type ServiceClient } from '../shared/service-client.hook';
import { Card, Button, Fieldset, Input, Modal, SearchField, Separator, TextArea } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AppStoreIcon } from '@hugeicons/core-free-icons';

type LabApp = { id: string; name: string; description: string; prompts: string[]; runPrompts: string[]; edited: boolean; icon?: string; custom?: boolean };
type Draft = { id: string; name: string; description: string; prompts: string[]; icon: string };

/** Settings, Apps: list the workspace apps, edit their name, description and steps, or reset them. */
export function AppsSettingsSection({ onOpenApps, startWithCreate = false }: { onOpenApps?: () => void; startWithCreate?: boolean }) {
  const [client] = useState<ServiceClient>(() => createServiceClient());
  const [apps, setApps] = useState<LabApp[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(() => (startWithCreate ? { id: '', name: '', description: '', prompts: [''], icon: '' } : null));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const refresh = () => { void client
      .json<{ apps: LabApp[] }>('/api/v1/lab/apps')
      .then((result) => {
        if (!alive) return;
        setApps(result.apps);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : 'Actions could not be loaded.');
        setLoading(false);
      }); };
    refresh();
    window.addEventListener('air-office:crafts-changed', refresh);
    return () => {
      alive = false;
      window.removeEventListener('air-office:crafts-changed', refresh);
    };
  }, [client]);

  function startEdit(app: LabApp) {
    setNotice('');
    setError('');
    setDraft({ id: app.id, name: app.name, description: app.description, prompts: [...app.prompts], icon: app.icon ?? '✨' });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await client.json<{ app: LabApp }>(draft.id ? '/api/v1/lab/apps/'.concat(encodeURIComponent(draft.id)) : '/api/v1/lab/apps', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          prompts: draft.prompts,
          ...(draft.icon.trim() ? { icon: draft.icon.trim() } : {}),
        }),
      });
      setApps((current) =>
        current.some((app) => app.id === result.app.id) ? current.map((app) => (app.id === result.app.id ? result.app : app)) : [...current, result.app],
      );
      window.dispatchEvent(new Event('office-apps-changed'));
      setDraft(null);
      setNotice(`${result.app.name} saved.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'This action could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function reset(app: LabApp) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await client.json<{ app: LabApp }>('/api/v1/lab/apps/'.concat(encodeURIComponent(app.id)), { method: 'DELETE' });
      setApps((current) => current.map((entry) => (entry.id === result.app.id ? result.app : entry)));
      window.dispatchEvent(new Event('office-apps-changed'));
      setNotice(`${result.app.name} restored to its default.`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'This action could not be reset.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card variant="secondary" className="rounded-2xl p-3" render={(props) => <section {...props} />} aria-label="Actions">
      <Card.Header><Card.Title className="settings-block-heading" render={(props) => <h3 {...props} />}><HugeiconsIcon icon={AppStoreIcon} size={18} aria-hidden="true" />Actions</Card.Title></Card.Header><Separator />
      <div className="apps-settings-header">
        <Button
          size="sm"
          onPress={() => {
            setError('');
            setDraft({ id: '', name: '', description: '', prompts: [''], icon: '' });
          }}
        >
          Add action
        </Button>
        <Button variant="secondary" size="sm" isDisabled={!onOpenApps} onPress={onOpenApps}>
          Open Actions
        </Button>
      </div>
      <SearchField className="apps-settings-search" fullWidth aria-label="Search actions" value={query} onChange={setQuery}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Find an action…" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      {loading && (
        <div className="settings-pref-row">
          <div className="settings-pref-copy">
            <span className="settings-pref-help">Loading actions...</span>
          </div>
        </div>
      )}
      {apps
        .filter((app) => `${app.name} ${app.description}`.toLowerCase().includes(query.trim().toLowerCase()))
        .map((app) => (
          <div className="settings-pref-row" key={app.id}>
            <div className="settings-pref-copy">
              <span className="settings-app-title">
                <AppIcon name={app.id} emoji={app.icon} />
                <span className="settings-pref-label">{app.name}</span>
              </span>
              <span className="settings-pref-help">{app.description}</span>
              <span className="settings-flag-values">
                <span>
                  {app.runPrompts.length} {app.runPrompts.length === 1 ? 'step' : 'steps'}
                </span>
                {app.edited && <span className="settings-flag-id">Edited</span>}
              </span>
            </div>
            <div className="settings-flag-actions">
              <Button variant="secondary" size="sm" isDisabled={busy} onPress={() => startEdit(app)}>
                Edit
              </Button>
              {app.edited && !app.custom && (
                <Button variant="tertiary" size="sm" isDisabled={busy} onPress={() => void reset(app)}>
                  Reset to Studio default
                </Button>
              )}
            </div>
          </div>
        ))}
      {!loading && !apps.length && !error && (
        <div className="settings-pref-row">
          <div className="settings-pref-copy">
            <span className="settings-pref-help">No actions are available.</span>
          </div>
        </div>
      )}
      {notice && (
        <p className="settings-feedback" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="settings-feedback is-error" role="alert">
          {error}
        </p>
      )}
      {draft && (
        <Modal.Backdrop
          isOpen
          isDismissable={!busy}
          isKeyboardDismissDisabled={busy}
          onOpenChange={(open) => {
            if (!open && !busy) setDraft(null);
          }}
        >
          <Modal.Container>
            <Modal.Dialog aria-labelledby="lab-app-edit-title">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <Modal.Header>
                  <Modal.Heading id="lab-app-edit-title">{draft.id ? 'Edit action' : 'Create action'}</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <div className="app-icon-editor">
                    <AppIcon name={draft.id || draft.name || 'new-app'} emoji={draft.icon} size={64} />
                    <label className="app-dialog-field">
                      Action emoji
                      <Input aria-label="Action emoji" maxLength={24} value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })} />
                    </label>
                  </div>

                  <label className="app-dialog-field">
                    Name
                    <Input required maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  </label>
                  <label className="app-dialog-field">
                    Description
                    <Input maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                  </label>
                  <Fieldset className="lab-app-edit-steps">
                    <Fieldset.Legend>Steps</Fieldset.Legend>
                    <p className="method-hint">
                      Each step is one model pass. The first step receives the source material from the action form; later steps receive the earlier results.
                    </p>
                    {draft.prompts.map((prompt, index) => (
                      <div className="lab-app-edit-step" key={index}>
                        <CollapsibleSection defaultExpanded={index === 0 || !prompt.trim()} title={`Step ${index + 1}`}>
                          <div className="lab-app-edit-step-head">
                            <span>Instructions</span>
                            <Button
                              variant="tertiary"
                              size="sm"
                              isDisabled={busy || draft.prompts.length <= 1}
                              onPress={() => setDraft({ ...draft, prompts: draft.prompts.filter((_, position) => position !== index) })}
                            >
                              Remove
                            </Button>
                          </div>
                          <TextArea
                            aria-label={`Step ${index + 1} instructions`}
                            value={prompt}
                            rows={6}
                            onChange={(event) =>
                              setDraft({ ...draft, prompts: draft.prompts.map((prompt_, position) => (position === index ? event.target.value : prompt_)) })
                            }
                          />
                        </CollapsibleSection>
                      </div>
                    ))}
                    <div className="lab-app-edit-step-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={busy || draft.prompts.length >= 12}
                        onPress={() => setDraft({ ...draft, prompts: [...draft.prompts, ''] })}
                      >
                        Add step
                      </Button>
                    </div>
                  </Fieldset>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" isDisabled={busy} onPress={() => setDraft(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" isDisabled={busy || !draft.name.trim() || draft.prompts.some((prompt) => !prompt.trim())}>
                    {busy ? 'Saving...' : 'Save action'}
                  </Button>
                </Modal.Footer>
              </form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}
    </Card>
  );
}

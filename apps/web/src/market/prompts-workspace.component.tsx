import { useState } from 'react';
import { Avatar, Button, Input, Label, TextField } from '@heroui/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { File01Icon } from '@hugeicons/core-free-icons';
import { Streamdown } from 'streamdown';
import { MARKDOWN_COMPONENTS } from '../shared/markdown-table.component';
import type { MethodDefinition } from '@office/methods/domain';
import { documentMarkdown, type RichDocument } from '@office/editor/rich-document-domain';
import { WorkspaceDestinationIcon } from '../app/workspace-destination-icon.component';
import { settingsSectionIcons } from '../settings/settings.policy';
import { DashboardCollection, DashboardViews, WorkspaceDashboard } from '../shared/collection-dashboard.component';

function NoteIcon({ prompt = false }: { prompt?: boolean }) {
  return (
    <Avatar size="sm" aria-hidden="true">
      <Avatar.Fallback>
        <HugeiconsIcon icon={prompt ? settingsSectionIcons.prompt : File01Icon} size={18} />
      </Avatar.Fallback>
    </Avatar>
  );
}

export function NotesWorkspace({
  definitions,
  richDocuments,
  onCreateNote,
  onOpenNote,
  onManage,
  onNewPrompt,
  onUse,
}: {
  definitions: MethodDefinition[];
  richDocuments: RichDocument[];
  onCreateNote: (title?: string) => Promise<void>;
  onOpenNote: (document: RichDocument) => void;
  onManage: () => void;
  onNewPrompt: () => void;
  onUse: (id: string, values: Record<string, string>) => void;
}) {
  const [view, setView] = useState<'notes' | 'prompts'>('notes');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [notice, setNotice] = useState('');
  const [notesQuery, setNotesQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const prompts = definitions.flatMap((item) => (item.kind === 'prompt' ? [item.value] : []));
  const visible = prompts.filter((prompt) => `${prompt.name} ${prompt.instructions}`.toLowerCase().includes(query.toLowerCase()));
  const prompt = visible.find((item) => item.id === selectedId) ?? visible[0];
  const fields = prompt ? (values[prompt.id] ?? {}) : {};
  const visibleNotes = richDocuments.filter((doc) => doc.title.toLowerCase().includes(notesQuery.toLowerCase()));
  const note = visibleNotes.find((doc) => doc.id === selectedNoteId) ?? visibleNotes[0];

  async function createNote() {
    if (creating) return;
    setCreating(true);
    setNotice('');
    try {
      await onCreateNote();
    } catch {
      setNotice('The note could not be created. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <WorkspaceDashboard
      title="Notes"
      hero={{
        icon: <WorkspaceDestinationIcon name="notes" size={56} />,
        subtitle: 'Your notes and reusable prompts, ready when you need them.',
      }}
    >
      <DashboardViews
        label="Notes views"
        selectedKey={view}
        onSelect={setView}
        views={[
          {
            id: 'notes',
            label: 'Notes',
            actions: (
              <Button isDisabled={creating} onPress={() => void createNote()}>
                New note
              </Button>
            ),
            content: (
              <DashboardCollection
                bubblePreview
                listLabel="Saved notes"
                search={{ value: notesQuery, onChange: setNotesQuery, label: 'Find a note', placeholder: 'Find a note…' }}
                items={visibleNotes.map((doc) => ({ id: doc.id, title: doc.title, description: 'Rich note', icon: <NoteIcon /> }))}
                selectedId={note?.id ?? null}
                onSelect={setSelectedNoteId}
                preview={
                  note
                    ? {
                        title: note.title,
                        description: 'Rich note',
                        content: (
                          <div className="collection-dashboard__document">
                            <Streamdown components={MARKDOWN_COMPONENTS} className="prose" mode="static" parseIncompleteMarkdown={false} controls={{ code: { copy: true, download: false }, table: false, mermaid: false }}>{documentMarkdown(note) || 'This note is empty. Open it to start writing.'}</Streamdown>
                          </div>
                        ),
                        actions: <Button onPress={() => onOpenNote(note)}>Open note</Button>,
                      }
                    : null
                }
                empty={{
                  title: notesQuery ? 'No matching notes' : 'No notes yet',
                  description: notesQuery ? 'Try another search.' : 'Create a note to start writing.',
                }}
              />
            ),
          },
          {
            id: 'prompts',
            label: 'Prompts',
            actions: (
              <>
                <Button onPress={onNewPrompt}>New prompt</Button>
                <Button variant="secondary" onPress={onManage}>
                  Manage prompts
                </Button>
              </>
            ),
            content: (
              <DashboardCollection
                bubblePreview
                listLabel="Saved prompts"
                search={{ value: query, onChange: setQuery, label: 'Find a prompt', placeholder: 'Find a prompt…' }}
                items={visible.map((item) => ({ id: item.id, title: item.name, description: `${item.variables.length} variables`, icon: <NoteIcon prompt /> }))}
                selectedId={prompt?.id ?? null}
                onSelect={(id) => {
                  setSelectedId(id);
                  setNotice('');
                }}
                preview={
                  prompt
                    ? {
                        title: prompt.name,
                        description: `Saved prompt · ${prompt.variables.length} variables`,
                        content: (
                          <>
                            <p className="collection-dashboard__prose text-sm leading-relaxed">{prompt.instructions}</p>
                            {prompt.variables.map((variable) => (
                              <TextField
                                key={variable}
                                isRequired
                                value={fields[variable] ?? ''}
                                onChange={(value) => setValues((current) => ({ ...current, [prompt.id]: { ...fields, [variable]: value } }))}
                              >
                                <Label>{variable}</Label>
                                <Input />
                              </TextField>
                            ))}
                          </>
                        ),
                        actions: (
                          <>
                            <Button
                              isDisabled={prompt.variables.some((variable) => !fields[variable]?.trim())}
                              onPress={() => {
                                onUse(prompt.id, fields);
                                setNotice('Prompt attached to chat.');
                              }}
                            >
                              Use in chat
                            </Button>
                            <Button
                              variant="secondary"
                              onPress={() => {
                                void navigator.clipboard
                                  .writeText(prompt.instructions)
                                  .then(() => setNotice('Prompt copied.'))
                                  .catch(() => setNotice('Could not copy. Select the text to copy it manually.'));
                              }}
                            >
                              Copy prompt
                            </Button>
                          </>
                        ),
                      }
                    : null
                }
                empty={{
                  title: query ? 'No matching prompts' : 'No prompts yet',
                  description: query ? 'Try another search.' : 'Create a reusable prompt in Manage prompts.',
                }}
              />
            ),
          },
        ]}
      />
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
    </WorkspaceDashboard>
  );
}

import { useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { File01Icon, Search01Icon, AiChat02Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons';
import { SearchField } from '@heroui/react';
import { Checkbox } from '@heroui/react';
import type { FileSnapshot } from '@office/contracts/file';
import type { ConversationSummary } from '@office/chat/domain';
import { WorkspaceDestinationIcon } from '../app/workspace-destination-icon.component';
import { WorkspaceHero } from '../shared/workspace-hero.component';

type Note = { id: string; title: string; path?: string };
type Props = { files: FileSnapshot[]; notes: Note[]; chats: ConversationSummary[]; onOpenFile: (file: FileSnapshot) => void; onOpenNote: (id: string) => void; onOpenChat: (id: string) => void };

function notePublicId(note: Note): string {
  return note.path ?? note.id;
}

export function WorkspaceSearch({ files, notes, chats, onOpenFile, onOpenNote, onOpenChat }: Props) {
  const [query, setQuery] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const needle = query.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    if (!needle) return [];
    return [
      ...files.filter((file) => file.name.toLocaleLowerCase().includes(needle)).map((file) => ({ id: `file:${file.id}`, label: file.name, kind: 'File', icon: File01Icon, open: () => onOpenFile(file) })),
      ...notes.filter((note) => note.title.toLocaleLowerCase().includes(needle)).map((note) => {
        const handle = notePublicId(note);
        return { id: `note:${handle}`, label: note.title, kind: 'Note', icon: PencilEdit01Icon, open: () => onOpenNote(handle) };
      }),
      ...chats.filter((chat) => (includeArchived || !chat.archivedAt) && chat.title.toLocaleLowerCase().includes(needle)).map((chat) => ({ id: `chat:${chat.id}`, label: chat.title, kind: chat.archivedAt ? 'Archived chat' : 'Chat', icon: AiChat02Icon, open: () => onOpenChat(chat.id) }))
    ];
  }, [chats, files, includeArchived, needle, notes, onOpenChat, onOpenFile, onOpenNote]);
  return <div className="workspace-search-page workspace-hero-page" data-workspace="search">
    <WorkspaceHero icon={<WorkspaceDestinationIcon name="search" size={56} />} subtitle="Find documents, notes, files and conversations in one place." />
    <div className="workspace-search-field"><SearchField fullWidth aria-label="Search everything" value={query} onChange={setQuery}><SearchField.Group><SearchField.SearchIcon><HugeiconsIcon icon={Search01Icon} size={20}/></SearchField.SearchIcon><SearchField.Input autoFocus placeholder="Search your workspace…" /><SearchField.ClearButton /></SearchField.Group></SearchField></div>
    <Checkbox className="workspace-search-option" isSelected={includeArchived} onChange={setIncludeArchived}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>Include archived chats</Checkbox.Content></Checkbox>
    <div className="workspace-search-results" aria-live="polite">
      {!needle && <div className="workspace-search-empty"><HugeiconsIcon icon={Search01Icon} size={32}/><p>Start typing to search your workspace.</p></div>}
      {needle && !results.length && <div className="workspace-search-empty"><p>No matches for “{query}”.</p></div>}
      {results.map((result) => <button key={result.id} className="workspace-search-result" type="button" onClick={result.open}><HugeiconsIcon icon={result.icon} size={20}/><span><strong>{result.label}</strong><small>{result.kind}</small></span></button>)}
    </div>
  </div>;
}

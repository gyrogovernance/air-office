export function parseConversationSearch(query: string) {
  const tags: string[] = [];
  const folders: string[] = [];
  const text: string[] = [];
  let pinned: boolean | undefined;
  let archived: boolean | undefined;
  for (const token of query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const match = token.match(/^(tag|folder|pinned|archived):(.*)$/i);
    if (!match) { text.push(token.replace(/^"|"$/g, '')); continue; }
    const value = (match[2] ?? '').replace(/^"|"$/g, '');
    switch (match[1]?.toLowerCase()) {
      case 'tag': if (value) tags.push(value); break;
      case 'folder': if (value) folders.push(value); break;
      case 'pinned': if (value === 'true' || value === 'false') pinned = value === 'true'; else text.push(token); break;
      case 'archived': if (value === 'true' || value === 'false') archived = value === 'true'; else text.push(token); break;
    }
  }
  return { text: text.join(' '), tags, folders, pinned, archived };
}

import type { AppDialogs } from '../shared/app-dialogs.component';
import type { FileSnapshot } from '@office/contracts/file';
import { createFilesService } from '@office/files/service';
import { draftKey } from '@office/editor/domain';
import { BrowserFileAdapter } from '../adapters/service/browser-file.adapter';

export function createWorkspaceController(dialogs: Pick<AppDialogs, 'confirm'>) {
  const service = createFilesService(new BrowserFileAdapter());
  return {
    authorize: () => service.authorize(),
    restore: () => service.restoreAuthorization(),
    list: () => service.list(),
    open: async (id: string) => {
      const file = await service.read(id);
      try {
        const stored = localStorage.getItem(draftKey(id));
        const draft: unknown = stored ? JSON.parse(stored) : null;
        if (draft && typeof draft === 'object' && 'content' in draft && typeof draft.content === 'string' && draft.content !== file.content) {
          const recover = await dialogs.confirm({ title: 'Recover unsaved changes?', message: `There are unsaved changes to ${file.name}. Would you like to recover them?`, confirmLabel: 'Recover changes' });
          if (recover) return { ...file, content: draft.content };
        }
      } catch { /* Leave the saved file available when browser draft storage cannot be read. */ }
      return file;
    },
    create: (name: string) => service.create(name),
    save: (file: FileSnapshot, content: string) => service.save(file.id, content, file.version)
  };
}

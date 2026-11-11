import type { MouseEvent } from 'react';
import { Surface } from '@heroui/react';
import { IconFile } from '../app/ui-icons.component';
import { useChatRenderContext } from './chat-render-context.composition';
import { workspaceFileLabel, type WorkspaceFileTouch } from './workspace-file-link.policy';

/** File block after an assistant reply for paths the model wrote. */
export function WorkspaceFileTouches({ touches }: { touches: readonly WorkspaceFileTouch[] }) {
  const { openWorkspacePath } = useChatRenderContext();
  if (!touches.length || !openWorkspacePath) return null;
  const open = (path: string) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    openWorkspacePath(path);
  };
  return <Surface className="chat-workspace-files" variant="secondary" aria-label="Files changed">
    <ul className="chat-workspace-files-list">
      {touches.map((touch) => <li key={touch.path}>
        <button type="button" className="chat-workspace-file-row" title={touch.path} onClick={open(touch.path)}>
          <IconFile aria-hidden="true"/>
          <span className="chat-workspace-file-name">{workspaceFileLabel(touch.path)}</span>
        </button>
      </li>)}
    </ul>
  </Surface>;
}

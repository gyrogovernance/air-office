import { createContext, useContext } from 'react';
import type { CitationContext, JobSubmission } from './chat-rendering.policy';

export interface ChatRenderContextValue {
  citation?: CitationContext;
  openCitation?: (versionId: string) => void;
  /** Opens a connected-folder path on the stage (create/edit/view tool results and air-file links). */
  openWorkspacePath?: (path: string) => void;
  /** Sends a fenced code block to the local job runner when the service offers one. */
  submitCodeJob?: (code: string, language: string) => Promise<JobSubmission>;
}

/**
 * Shared render actions for chat markdown: opening knowledge citations,
 * opening connected-folder files on the stage, and optional code-to-job.
 * The rail provides the values; components fall back to plain rendering when
 * an action is absent.
 */
export const ChatRenderContext = createContext<ChatRenderContextValue>({});

export const useChatRenderContext = () => useContext(ChatRenderContext);

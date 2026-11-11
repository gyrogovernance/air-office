import type { Collection, RetrievalMode } from '@office/contracts/knowledge';

/**
 * Public UI contracts for knowledge. These are the shapes the workspace shell
 * renders; the knowledge module owns no React component yet, so the shell builds
 * its collection panel against this contract.
 */
export interface CollectionView {
  collection: Collection;
  documentCount: number;
}

export interface RetrievalView {
  mode: RetrievalMode;
  query: string;
}

export interface KnowledgePanelProps {
  collections: readonly CollectionView[];
  retrieval: RetrievalView;
}

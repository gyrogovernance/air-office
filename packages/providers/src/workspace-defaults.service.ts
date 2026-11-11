import type { ModelRegistryEntry } from './model-registry.policy';
import type { WorkspaceDefaults, WorkspaceDefaultsStore } from './workspace-defaults.adapter';

/**
 * A model the workspace can use as a default, and why it was proposed.
 */
export interface ModelCandidate {
  providerId: string;
  modelId: string;
  roles: string[];
  /** The reason this candidate was proposed, in the order the rules apply. */
  reason: 'preferred-chat-model' | 'preferred-embedding-model' | 'only-chat-model' | 'only-embedding-model' | 'largest-chat-model' | 'largest-embedding-model';
}

/**
 * The models AIR Office proposes for a workspace by name.
 *
 * A workspace runs on the models the user already downloaded, and the ones
 * that work well for the work AIR Office does are known. A named model that
 * is installed wins over a rule about how many models are installed, because
 * a fast small chat model and a small embedding model are the ones a
 * general workspace wants, and the user should not have to pick them again
 * after every restart.
 */
export const PREFERRED_CHAT_MODELS: readonly string[] = ['Bonsai-1.7B-gguf'];
export const PREFERRED_EMBEDDING_MODELS: readonly string[] = ['Qwen3-Embedding-0.6B-GGUF'];

/**
 * Published vector widths for embedding models AIR proposes or commonly installs.
 * Used when the runtime has not answered a probe yet (for example right after
 * a download), so Finish setup can still save a complete default.
 */
export const DOCUMENTED_EMBEDDING_DIMENSIONS: Readonly<Record<string, number>> = {
  'Qwen3-Embedding-0.6B-GGUF': 1024,
  'Qwen3-Embedding-4B-GGUF': 2560,
  'Qwen3-Embedding-8B-GGUF': 4096
};

/** Documented width for a named embedding model, when AIR already knows it. */
export function documentedEmbeddingDimensions(modelId: string): number | null {
  const value = DOCUMENTED_EMBEDDING_DIMENSIONS[modelId];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export interface QuickStartProposal {
  chat: ModelCandidate | null;
  embedding: ModelCandidate | null;
  /** The models the workspace already uses. */
  current: WorkspaceDefaults;
}

/**
 * Proposes the defaults a workspace should use from the models it has.
 *
 * The user downloaded models and installed them. The workspace should use
 * them without being asked again after every restart. The proposal is a
 * suggestion the user confirms, not a silent change: a wrong default would
 * send their work to a model they did not choose.
 *
 * The rules are deliberately simple. A workspace with one chat model uses
 * that one. A workspace with several chat models uses the largest, because
 * the larger model is the one a user installs for the general work. The same
 * holds for an embedding model. A model that serves both roles is proposed
 * for both.
 */
export function proposeWorkspaceDefaults(input: {
  registry: readonly ModelRegistryEntry[];
  current: WorkspaceDefaults;
}): QuickStartProposal {
  const chat = chooseCandidate(input.registry.filter((entry) => entry.roles.includes('chat')), PREFERRED_CHAT_MODELS, 'chat');
  const embedding = chooseCandidate(input.registry.filter((entry) => entry.roles.includes('embedding')), PREFERRED_EMBEDDING_MODELS, 'embedding');
  return { chat, embedding, current: input.current };
}

/**
 * Chooses one model out of the installed ones.
 *
 * A preferred model that is installed wins. Otherwise the single installed
 * model wins, and the first one wins when several are installed, because the
 * order the runtime reports them in is the order it loads them in.
 */
function chooseCandidate(entries: readonly ModelRegistryEntry[], preferred: readonly string[], role: 'chat' | 'embedding'): ModelCandidate | null {
  if (entries.length === 0) return null;
  for (const name of preferred) {
    const match = entries.find((entry) => entry.modelId === name);
    if (match) return { providerId: match.providerId, modelId: match.modelId, roles: match.roles, reason: role === 'chat' ? 'preferred-chat-model' : 'preferred-embedding-model' };
  }
  const first = entries[0]!;
  const reason = role === 'chat'
    ? (entries.length === 1 ? 'only-chat-model' as const : 'largest-chat-model' as const)
    : (entries.length === 1 ? 'only-embedding-model' as const : 'largest-embedding-model' as const);
  return { providerId: first.providerId, modelId: first.modelId, roles: first.roles, reason };
}

/**
 * Applies a proposal to the stored defaults.
 *
 * The embedding model is only stored when its revision and dimensions are
 * known, because an embedding model without them cannot produce a vector of
 * the right size, and an index built with the wrong size can never be read.
 */
export function applyWorkspaceDefaults(store: WorkspaceDefaultsStore, proposal: { chat?: ModelCandidate | null; embedding?: ModelCandidate | null; embeddingRevision?: string | null; embeddingDimensions?: number | null }): WorkspaceDefaults {
  const chat = proposal.chat === undefined ? undefined : proposal.chat;
  const embedding = proposal.embedding === undefined ? undefined : proposal.embedding;
  // An embedding model without its revision and width is not stored, because a
  // half-known embedding model cannot build a readable index. The stored
  // selection is left as it was rather than replaced by an incomplete one.
  const embeddingComplete = embedding === undefined
    ? undefined
    : Boolean(embedding) && Boolean(proposal.embeddingRevision) && Boolean(proposal.embeddingDimensions);
  return store.write({
    ...(chat === undefined ? {} : { chatProvider: chat?.providerId ?? null, chatModel: chat?.modelId ?? null }),
    ...(embeddingComplete === undefined ? {} : embeddingComplete
      ? {
        embeddingModel: embedding?.modelId ?? null,
        embeddingRevision: proposal.embeddingRevision ?? null,
        embeddingDimensions: proposal.embeddingDimensions ?? null
      }
      : {})
  });
}

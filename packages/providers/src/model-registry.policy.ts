import type { CapabilitySupport, ModelCapabilityDescriptor, ModelConnection } from './providers.domain.public';
import { selectableModels } from './providers.domain.public';

export type ModelRole = 'chat' | 'background' | 'embedding' | 'rerank' | 'stt' | 'tts' | 'image' | 'vision';
export type ModelReferenceState = 'available' | 'missing' | 'unsupported';
export interface ModelReference { providerId: string; modelId: string; role: ModelRole; }
export interface ModelRegistryEntry {
  providerId: string;
  modelId: string;
  roles: ModelRole[];
  capabilities: Omit<ModelCapabilityDescriptor, 'model' | 'source'> & { embedding?: CapabilitySupport; rerank?: CapabilitySupport; speech?: CapabilitySupport; stt?: CapabilitySupport; tts?: CapabilitySupport; image?: CapabilitySupport };
}
export interface ModelReferenceResolution { reference: ModelReference; state: ModelReferenceState; entry: ModelRegistryEntry | null; message: string; }
const roles: readonly ModelRole[] = ['chat', 'background', 'embedding', 'rerank', 'stt', 'tts', 'image', 'vision'];

export function parseModelReference(value: unknown): ModelReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A model reference is required.');
  const row = value as Record<string, unknown>;
  if (typeof row.providerId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(row.providerId)) throw new Error('A valid provider ID is required.');
  if (typeof row.modelId !== 'string' || !row.modelId.trim() || row.modelId.length > 200) throw new Error('A valid model ID is required.');
  if (typeof row.role !== 'string' || !roles.includes(row.role as ModelRole)) throw new Error('Choose a supported model role.');
  return { providerId: row.providerId, modelId: row.modelId, role: row.role as ModelRole };
}

export function resolveModelReference(reference: ModelReference, registry: ModelRegistryEntry[]): ModelReferenceResolution {
  const entry = registry.find((item) => item.providerId === reference.providerId && item.modelId === reference.modelId) ?? null;
  if (!entry) return { reference, state: 'missing', entry: null, message: 'This model reference is unavailable. Choose a replacement explicitly or repair the provider connection.' };
  if (!entry.roles.includes(reference.role)) return { reference, state: 'unsupported', entry, message: `This model does not advertise the ${reference.role} role.` };
  return { reference, state: 'available', entry, message: 'The model is available for the selected role.' };
}

const supported = (value: CapabilitySupport | undefined): boolean => value === 'supported';
export function modelRegistryFromConnections(connections: (Pick<ModelConnection, 'id' | 'models' | 'modelCapabilities'> & Partial<Pick<ModelConnection, 'observedModels'>>)[]): ModelRegistryEntry[] {
  return connections.flatMap((connection) => selectableModels({ models: connection.models, observedModels: connection.observedModels ?? [] }).map((modelId) => {
    const source = connection.modelCapabilities && Object.hasOwn(connection.modelCapabilities, modelId) ? connection.modelCapabilities[modelId]! : {};
    const extension = source as typeof source & { embedding?: CapabilitySupport; rerank?: CapabilitySupport; speech?: CapabilitySupport; stt?: CapabilitySupport; tts?: CapabilitySupport; image?: CapabilitySupport };
    const capabilities: ModelRegistryEntry['capabilities'] = {
      tools: source.tools ?? 'unknown', vision: source.vision ?? 'unknown', streaming: source.streaming ?? 'unknown', reasoning: source.reasoning ?? 'unknown',
      structuredOutput: source.structuredOutput ?? 'unknown', contextWindow: source.contextWindow ?? null,
      embedding: extension.embedding ?? 'unknown', rerank: extension.rerank ?? 'unknown', speech: extension.speech ?? 'unknown', stt: extension.stt ?? 'unknown', tts: extension.tts ?? 'unknown', image: extension.image ?? 'unknown'
    };
    const specialized = [capabilities.embedding, capabilities.rerank, capabilities.stt, capabilities.tts, capabilities.image].some(supported);
    const modelRoles: ModelRole[] = specialized ? [] : ['chat', 'background'];
    if (supported(capabilities.vision)) modelRoles.push('vision');
    if (supported(capabilities.embedding)) modelRoles.push('embedding');
    if (supported(capabilities.rerank)) modelRoles.push('rerank');
    if (supported(capabilities.stt)) modelRoles.push('stt');
    if (supported(capabilities.tts)) modelRoles.push('tts');
    if (supported(capabilities.image)) modelRoles.push('image');
    return { providerId: connection.id, modelId, roles: modelRoles, capabilities };
  }));
}

/** Map the pinned server's model labels without inferring capabilities from model names. */
export function modelRegistryFromManagedModels(value: unknown, providerId = 'managed-local'): ModelRegistryEntry[] {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' && 'data' in value && Array.isArray(value.data) ? value.data : [];
  return rows.flatMap((row: unknown): ModelRegistryEntry[] => {
    if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string') return [];
    const labels = 'labels' in row && Array.isArray(row.labels) ? row.labels.filter((label): label is string => typeof label === 'string') : [];
    const support = (label: string): CapabilitySupport => labels.includes(label) ? 'supported' : 'unknown';
    const specialized = labels.some((label) => ['embeddings', 'reranking', 'image', 'transcription', 'realtime-transcription', 'tts', 'speech', 'audio', 'audio-generation', 'voice-design', 'edit', 'upscaling', 'mesh', '3d', 'classification'].includes(label));
    const roles: ModelRole[] = specialized && !labels.includes('chat') && !labels.includes('llm') ? [] : ['chat', 'background'];
    if (labels.includes('embeddings')) roles.push('embedding');
    if (labels.includes('reranking')) roles.push('rerank');
    if (labels.includes('vision')) roles.push('vision');
    if (labels.includes('transcription')) roles.push('stt');
    if (labels.includes('tts') || labels.includes('speech')) roles.push('tts');
    if (labels.includes('image')) roles.push('image');
    return [{ providerId, modelId: row.id, roles, capabilities: { tools: support('tool-calling'), vision: support('vision'), streaming: 'unknown', reasoning: support('reasoning'), structuredOutput: 'unknown', contextWindow: null, embedding: support('embeddings'), rerank: support('reranking') } }];
  });
}

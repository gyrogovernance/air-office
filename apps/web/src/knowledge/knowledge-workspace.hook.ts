import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SourceDocument, SourceVersion, ExtractionArtifact } from '@office/contracts/document';
import type { Collection, RetrievalResult } from '@office/contracts/knowledge';
import type { Job } from '@office/contracts/job';
import { createServiceClient } from '../shared/service-client.hook';
import { knowledgeSearchOptions } from '../settings/settings.store';

export type { SourceDocument, SourceVersion, ExtractionArtifact, Collection, RetrievalResult, Job };
type KnowledgeIndexStatus = { current: { model: string; revision?: string; dimensions: number; metric: string; chunkerVersion: string } | null; configured: { model: string; revision?: string; dimensions: number; metric: string; chunkerVersion: string }; rebuildRequired: boolean; chunks?: number };


export interface KnowledgeWorkspaceState {
  collections: Collection[];
  documents: SourceDocument[];
  versions: SourceVersion[];
  artifact: ExtractionArtifact | null;
  results: RetrievalResult[];
  jobs: Job[];
  embeddingModel: string;
  rerankModel?: string;
  inputTokenLimit?: number;
  rerankTokenLimit?: number;
  embeddingRevision?: string;
  embeddingDimensions?: number;
  embeddingMode?: 'runtime' | 'demo';
  probeEmbeddingModel?: (model: string) => Promise<{ dimensions: number }>;
  setEmbeddingModel: (model: string, dimensions: number, revision?: string, rerankModel?: string, limits?: { inputTokenLimit: number; rerankTokenLimit: number }) => Promise<void>;
  rebuildCollection: (collectionId: string) => Promise<void>;
  indexStatuses: Record<string, KnowledgeIndexStatus>;
  status: string;
  error: string;
  ingest: (name: string, content: string, collectionId: string | null) => Promise<void>;
  createCollection: (name: string, description?: string) => Promise<void>;
  updateCollection: (collectionId: string, name: string, description: string) => Promise<void>;
  deleteCollection: (collectionId: string) => Promise<void>;
  selectDocument: (documentId: string) => Promise<void>;
  openCitation: (versionId: string) => Promise<void>;
  inspectExtraction: (versionId: string) => Promise<void>;
  indexVersion: (versionId: string, content: string, collectionId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  search: (collectionIds: string[], query: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Knowledge workspace hook. It reads collections, documents, extraction
 * artifacts, search results and indexing jobs from the local service, and never
 * holds a provider credential in renderer state. Retrieved snippets are kept
 * with their resolved flag so an unresolved citation is shown as unverified
 * rather than presented as a verified location.
 */
export function useKnowledgeWorkspace(): KnowledgeWorkspaceState {
  const client = useMemo(() => createServiceClient(), []);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [versions, setVersions] = useState<SourceVersion[]>([]);
  const [artifact, setArtifact] = useState<ExtractionArtifact | null>(null);
  const [results, setResults] = useState<RetrievalResult[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const searchGeneration = useRef(0);
  const [rerankModel, setRerankModel] = useState('');
  const [inputTokenLimit, setInputTokenLimit] = useState(512);
  const [rerankTokenLimit, setRerankTokenLimit] = useState(512);
  const [embeddingModel, setEmbeddingModelState] = useState('');
  const [embeddingRevision, setEmbeddingRevision] = useState('');
  const [embeddingDimensions, setEmbeddingDimensions] = useState(0);
  const [embeddingMode, setEmbeddingMode] = useState<'runtime' | 'demo'>('runtime');
  const [indexStatuses, setIndexStatuses] = useState<Record<string, KnowledgeIndexStatus>>({});
  const setEmbeddingModel = useCallback(async (model: string, dimensions: number, revision = '', rerankModel = '', limits?: { inputTokenLimit: number; rerankTokenLimit: number }) => {
    try {
      if (!model.trim() || !revision.trim() || !Number.isSafeInteger(dimensions) || dimensions < 1) throw new Error('Choose a real embedding model, revision and valid dimensions.');
      const saved = await client.json<{ model: string; revision: string; dimensions: number; mode: 'runtime' | 'demo'; rerankModel?: string; inputTokenLimit?: number; rerankTokenLimit?: number }>('/api/v1/knowledge/embedding-model', { method: 'PUT', body: JSON.stringify({ model: model.trim(), revision: revision.trim(), dimensions, rerankModel, ...limits }) });
      searchGeneration.current++; setResults([]);
      setRerankModel(saved.rerankModel ?? '');
      setInputTokenLimit(saved.inputTokenLimit ?? 512); setRerankTokenLimit(saved.rerankTokenLimit ?? 512);
      setEmbeddingModelState(saved.model);
      setEmbeddingRevision(saved.revision);
      setEmbeddingDimensions(saved.dimensions);
      setEmbeddingMode(saved.mode);
      setError('');
      setStatus('Embedding model saved. Rebuild indexes to use the new model.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Embedding model could not be saved.');
      throw reason;
    }
  }, [client]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [loadedCollections, loadedDocuments, loadedJobs, loadedEmbedding] = await Promise.all([
        client.json<{ collections: Collection[] }>('/api/v1/collections'),
        client.json<{ documents: SourceDocument[] }>('/api/v1/documents'),
        client.json<{ jobs: Job[] }>('/api/v1/jobs'),
        client.json<{ model: string; revision: string; dimensions: number; mode: 'runtime' | 'demo'; rerankModel?: string; inputTokenLimit?: number; rerankTokenLimit?: number }>('/api/v1/knowledge/embedding-model')
      ]);
      setRerankModel(loadedEmbedding.rerankModel ?? '');
      setInputTokenLimit(loadedEmbedding.inputTokenLimit ?? 512); setRerankTokenLimit(loadedEmbedding.rerankTokenLimit ?? 512);
      setEmbeddingModelState(loadedEmbedding.model);
      setEmbeddingRevision(loadedEmbedding.revision);
      setEmbeddingDimensions(loadedEmbedding.dimensions);
      setEmbeddingMode(loadedEmbedding.mode);
      setCollections(Array.isArray(loadedCollections.collections) ? loadedCollections.collections : []);
      setDocuments(Array.isArray(loadedDocuments.documents) ? loadedDocuments.documents : []);
      setJobs(Array.isArray(loadedJobs.jobs) ? loadedJobs.jobs : []);
      const loadedStatuses = await Promise.all(loadedCollections.collections.map(async (collection) => [collection.id, await client.json<Record<string, unknown>>(`/api/v1/knowledge/index-status?collectionId=${encodeURIComponent(collection.id)}`)] as const));
      setIndexStatuses(Object.fromEntries(loadedStatuses) as typeof indexStatuses);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Knowledge catalog could not be loaded.');
    }
  }, [client]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while an index job is active so the panel shows real progress instead
  // of a stale snapshot; polling stops as soon as every job reaches a terminal state.
  const activeJobs = jobs.filter((job) => ['index-source', 'rebuild-collection', 'extract-source'].includes(job.kind) && ['queued', 'running', 'waiting-user'].includes(job.state)).map((job) => job.id).join(',');
  useEffect(() => {
    if (!activeJobs) return;
    const timer = setInterval(() => { void refresh(); }, 700);
    return () => clearInterval(timer);
  }, [activeJobs, refresh]);

  const indexVersion = useCallback(async (versionId: string, content: string, collectionId: string) => {
    try {
      const started = await client.json<{ job: Job }>('/api/v1/index', { method: 'POST', body: JSON.stringify({ collectionId, versionId, content }) });
      setJobs((current) => [started.job, ...current.filter((job) => job.id !== started.job.id)]);
      setStatus(`Indexing started for ${versionId.slice(0, 12)}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Indexing could not start.'); }
  }, [client]);

  const ingest = useCallback(async (name: string, content: string, collectionId: string | null) => {
    try {
      const documentId = crypto.randomUUID();
      const response = await client.json<{ document: SourceDocument; version: SourceVersion; created: boolean }>('/api/v1/documents', { method: 'POST', body: JSON.stringify({ documentId, name, collectionId, content }) });
      setStatus(response.created ? `Ingested ${name}.` : `${name} already matches an existing version.`);
      await refresh();
      const loaded = await client.json<{ versions: SourceVersion[] }>(`/api/v1/documents/${encodeURIComponent(documentId)}/versions`);
      setVersions(loaded.versions);
      // Ingest alone leaves the source unsearchable; indexing follows every
      // ingest so the "Ingest and index" action delivers a retrievable source.
      if (collectionId) await indexVersion(response.version.id, content, collectionId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Ingestion failed.'); }
  }, [client, refresh, indexVersion]);

  const createCollection = useCallback(async (name: string, description = '') => {
    try {
      await client.json('/api/v1/collections', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), name, description }) });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create the collection.'); }
  }, [client, refresh]);

  const updateCollection = useCallback(async (collectionId: string, name: string, description: string) => {
    try {
      await client.json(`/api/v1/collections/${encodeURIComponent(collectionId)}`, { method: 'PATCH', body: JSON.stringify({ name, description }) });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not rename the collection.'); }
  }, [client, refresh]);

  const deleteCollection = useCallback(async (collectionId: string) => {
    try {
      await client.json(`/api/v1/collections/${encodeURIComponent(collectionId)}`, { method: 'DELETE' });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete the collection.'); }
  }, [client, refresh]);

  const selectDocument = useCallback(async (documentId: string) => {
    try {
      const loaded = await client.json<{ versions: SourceVersion[] }>(`/api/v1/documents/${encodeURIComponent(documentId)}/versions`);
      setVersions(loaded.versions);
      setArtifact(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load source versions.'); }
  }, [client]);

  /** Opens the owning document of a cited source version so the citation resolves to inspectable provenance. */
  const openCitation = useCallback(async (versionId: string) => {
    try {
      const loaded = await client.json<{ version: SourceVersion }>(`/api/v1/versions/${encodeURIComponent(versionId)}`);
      await selectDocument(loaded.version.documentId);
      setStatus(`Opened the source document for version ${versionId.slice(0, 12)}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The cited source could not be opened.'); }
  }, [client, selectDocument]);

  const inspectExtraction = useCallback(async (versionId: string) => {
    try {
      const loaded = await client.json<{ artifact: ExtractionArtifact }>(`/api/v1/versions/${encodeURIComponent(versionId)}/artifact`);
      setArtifact(loaded.artifact);
    } catch { setArtifact(null); setStatus('This version has no extraction artifact yet.'); }
  }, [client]);

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      await client.request(`/api/v1/index/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Cancellation failed.'); }
  }, [client, refresh]);

  const search = useCallback(async (collectionIds: string[], query: string) => {
    const generation = ++searchGeneration.current;
    if (collectionIds.length === 0 || !query.trim()) { setResults([]); return; }
    try {
      const loaded = await client.json<{ results: RetrievalResult[] }>('/api/v1/search', { method: 'POST', body: JSON.stringify({ collectionIds, query, ...knowledgeSearchOptions() }) });
      if (generation !== searchGeneration.current) return;
      setResults(loaded.results);
      setError('');
    } catch (reason) { if (generation === searchGeneration.current) { setResults([]); setError(reason instanceof Error ? reason.message : 'Search failed.'); } }
  }, [client]);

  const rebuildCollection = useCallback(async (collectionId: string) => {
    try {
      const started = await client.json<{ job: Job }>('/api/v1/knowledge/rebuild', { method: 'POST', body: JSON.stringify({ collectionId }) });
      setJobs((current) => [started.job, ...current.filter((job) => job.id !== started.job.id)]);
      setStatus(`Rebuilding ${collections.find((collection) => collection.id === collectionId)?.name ?? 'collection'} index.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The collection index could not be rebuilt.'); }
  }, [client, collections]);
  const indexStatus = useCallback(async (collectionId: string) => {
    const value = await client.json<KnowledgeIndexStatus>(`/api/v1/knowledge/index-status?collectionId=${encodeURIComponent(collectionId)}`);
    setIndexStatuses((current) => ({ ...current, [collectionId]: value }));
    return value;
  }, [client]);
  const probeEmbeddingModel = useCallback((model: string) => client.json<{ dimensions: number }>('/api/v1/knowledge/embedding-probe', { method: 'POST', body: JSON.stringify({ model }) }), [client]);
  return { probeEmbeddingModel, collections, documents, versions, artifact, results, jobs, embeddingModel, rerankModel, inputTokenLimit, rerankTokenLimit, embeddingRevision, embeddingDimensions, embeddingMode, setEmbeddingModel, rebuildCollection, indexStatuses, status, error, ingest, createCollection, updateCollection, deleteCollection, selectDocument, openCitation, inspectExtraction, indexVersion, cancelJob, search, refresh };
}

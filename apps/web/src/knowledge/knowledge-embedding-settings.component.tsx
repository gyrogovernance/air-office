import { Button, Input } from '@heroui/react';
import { SelectField } from '../shared/select-field.component';
import { useEffect, useRef, useState } from 'react';
import type { KnowledgeWorkspaceState } from './knowledge-workspace.hook';

type ModelChoice = { value: string; label: string; roles?: string[]; revision?: string; dimensions?: number };

export function KnowledgeEmbeddingSettings(props: {
  knowledge: KnowledgeWorkspaceState;
  models: ModelChoice[];
  onOpenLocalAi?: () => void;
}) {
  const { knowledge, onOpenLocalAi } = props;
  const probeEpoch = useRef(0);
  const [model, setModel] = useState(knowledge.embeddingModel);
  const [revision, setRevision] = useState(knowledge.embeddingRevision ?? '');
  const [dimensions, setDimensions] = useState(String(knowledge.embeddingDimensions || ''));
  const [rerankModel, setRerankModel] = useState(knowledge.rerankModel ?? '');
  const [inputTokenLimit, setInputTokenLimit] = useState(String(knowledge.inputTokenLimit ?? 512));
  const [rerankTokenLimit, setRerankTokenLimit] = useState(String(knowledge.rerankTokenLimit ?? 512));
  const [probeError, setProbeError] = useState('');
  const [probing, setProbing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    probeEpoch.current++;
    setModel(knowledge.embeddingModel);
    setRerankModel(knowledge.rerankModel ?? '');
    setInputTokenLimit(String(knowledge.inputTokenLimit ?? 512)); setRerankTokenLimit(String(knowledge.rerankTokenLimit ?? 512));
    setRevision(knowledge.embeddingRevision ?? '');
    setDimensions(String(knowledge.embeddingDimensions || ''));
  }, [knowledge.embeddingModel, knowledge.embeddingRevision, knowledge.embeddingDimensions, knowledge.rerankModel, knowledge.inputTokenLimit, knowledge.rerankTokenLimit]);

  const localModels = props.models.filter((item) => item.value.startsWith('managed-local:') && item.roles?.includes('embedding'));
  const rerankModels = props.models.filter((item) => item.value.startsWith('managed-local:') && item.roles?.includes('rerank'));
  const ids = localModels.map((item) => ({ ...item, id: item.value.slice('managed-local:'.length) }));
  const configured = Boolean(knowledge.embeddingModel && knowledge.embeddingRevision && (knowledge.embeddingDimensions ?? 0) > 0);
  const canSave = Boolean(model && revision.trim() && Number(dimensions) >= 1);
  const autoAdopted = useRef(false);

  async function chooseModel(value: string, saveDefault = false) {
    const epoch = ++probeEpoch.current;
    setDimensions('');
    setModel(value);
    setProbeError('');
    const facts = ids.find((item) => item.id === value);
    const nextRevision = facts?.revision?.trim() || value;
    setRevision(nextRevision);
    if (!value) return;
    setProbing(true);
    try {
      const probed = facts?.dimensions ? { dimensions: facts.dimensions } : await knowledge.probeEmbeddingModel?.(value);
      if (!probed) return;
      if (epoch === probeEpoch.current) {
        setDimensions(String(probed.dimensions));
        if (saveDefault) await knowledge.setEmbeddingModel(value, probed.dimensions, nextRevision, '').then(() => knowledge.refresh());
      }
    } catch {
      if (epoch === probeEpoch.current) setProbeError('The search model could not be configured.');
    } finally {
      if (epoch === probeEpoch.current) setProbing(false);
    }
  }

  const preferredId = ids.find((item) => item.id === 'Qwen3-Embedding-0.6B-GGUF')?.id ?? ids[0]?.id;
  useEffect(() => {
    if (configured || autoAdopted.current || !preferredId || probing || saving) return;
    autoAdopted.current = true;
    void chooseModel(preferredId, true);
  }, [configured, preferredId, probing, saving]);

  if (ids.length === 0) {
    return <div className="knowledge-index-settings" role="status">
      <p>Knowledge search needs a local embedding model.</p>

      {onOpenLocalAi && <Button variant="secondary" size="sm" onPress={onOpenLocalAi}>Browse models in Market</Button>}
      {configured && <p className="method-hint">Saved selection: {knowledge.embeddingModel} · {knowledge.embeddingDimensions} dimensions. It is unavailable until the model is installed again.</p>}
    </div>;
  }

  return <form className="knowledge-index-settings" onSubmit={(event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    void knowledge.setEmbeddingModel(model, Number(dimensions), revision, rerankModel, { inputTokenLimit: Number(inputTokenLimit), rerankTokenLimit: Number(rerankTokenLimit) }).then(() => knowledge.refresh()).catch(() => undefined).finally(() => setSaving(false));
  }}>
    {!configured && ids[0] && <Button size="sm" isDisabled={probing || saving} onPress={() => void chooseModel(ids[0]!.id, true)}>Use {ids[0].label}</Button>}
    <label className="knowledge-embedding-choice">Search model
      <SelectField aria-label="Knowledge embedding model" value={model} disabled={probing || saving} onValueChange={(value) => { void chooseModel(value); }}>
        <option value="">Choose a model</option>
        {model && !ids.some((item) => item.id === model) && <option value={model}>{model}</option>}
        {ids.map((item) => <option key={item.value} value={item.id}>{item.label}</option>)}
      </SelectField>
    </label>
    {probing && <p role="status">Checking model…</p>}
    {probeError && <p role="alert">{probeError}</p>}
    {configured && <p className="method-hint" role="status">Using {knowledge.embeddingModel} · {knowledge.embeddingDimensions} dimensions{knowledge.embeddingMode === 'demo' ? ' · demo' : ''}.</p>}
    <Button variant="secondary" size="sm" aria-expanded={advanced} onPress={() => setAdvanced(!advanced)}>Index options</Button>
    {advanced && <div className="model-advanced">
      <label>Index version<Input aria-label="Knowledge embedding revision" value={revision} onChange={(event) => setRevision(event.target.value)} required maxLength={300} /></label>
      <label>Dimensions<Input aria-label="Knowledge embedding dimensions" type="number" min={1} max={65536} step={1} value={dimensions} onChange={(event) => setDimensions(event.target.value)} required /></label>
      <label>Embedding input limit (tokens)<Input type="number" min={64} max={1000000} step={1} required value={inputTokenLimit} onChange={event => setInputTokenLimit(event.target.value)}/></label>
      <label>Reranker input limit (tokens)<Input type="number" min={64} max={1000000} step={1} required value={rerankTokenLimit} onChange={event => setRerankTokenLimit(event.target.value)}/></label>
      <p className="method-hint">Use the input limits configured for these models in Local AI. Until a limit is set, the index uses a conservative 512-token budget.</p>
      {knowledge.probeEmbeddingModel && <Button variant="tertiary" size="sm" isDisabled={saving || probing || !model} onPress={() => { void chooseModel(model); }}>{probing ? 'Checking…' : 'Recheck dimensions'}</Button>}
      <label>Reranking<SelectField aria-label="Optional reranking model" value={rerankModel} onValueChange={setRerankModel}><option value="">Off</option>{rerankModel && !rerankModels.some((item) => item.value === `managed-local:${rerankModel}`) && <option value={rerankModel}>{rerankModel}</option>}{rerankModels.map((item) => <option key={item.value} value={item.value.slice('managed-local:'.length)}>{item.label}</option>)}</SelectField></label>
    </div>}
    <div className="team-actions">
      <Button type="submit" size="sm" isDisabled={saving || !canSave}>{saving ? 'Saving…' : 'Save'}</Button>
    </div>

  </form>;
}

type LemonadeVariant = { name: string; primaryFile: string | null; files: string[]; sharded: boolean; sizeBytes: number | null };
type LemonadeVariantSelection = { checkpoint: string; recipe: string; suggestedName: string; labels: string[]; mmprojFiles: string[]; variants: LemonadeVariant[] };
export function displayBytes(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
export function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function parseVariants(value: unknown, checkpoint: string): LemonadeVariantSelection {
  if (!record(value)) throw new Error('The model server returned no variant details for this repository.');
  const response = value;
  if (response.checkpoint !== checkpoint) throw new Error('The model server returned variants for a different repository.');
  if (typeof response.recipe !== 'string' || !response.recipe || typeof response.suggested_name !== 'string' || !response.suggested_name) throw new Error('The model server returned incomplete variant details.');
  const variants = Array.isArray(response.variants) ? response.variants.flatMap((item): LemonadeVariant[] => {
    if (!record(item) || typeof item.name !== 'string' || !item.name) return [];
    const variant = item;
    return [{ name: item.name, primaryFile: typeof variant.primary_file === 'string' ? variant.primary_file : null, files: stringArray(variant.files), sharded: variant.sharded === true, sizeBytes: typeof variant.size_bytes === 'number' && Number.isFinite(variant.size_bytes) && variant.size_bytes >= 0 ? variant.size_bytes : null }];
  }) : [];
  return { checkpoint, recipe: response.recipe, suggestedName: response.suggested_name, labels: stringArray(response.suggested_labels), mmprojFiles: stringArray(response.mmproj_files), variants };
}

export function parseRepositories(value: unknown): { repository_id: string; display_name?: string; description?: string }[] {
  if (!record(value) || !Array.isArray(value.results)) throw new Error('Invalid model search response.');
  return value.results.flatMap((entry) => record(entry) && typeof entry.repository_id === 'string' ? [{ repository_id: entry.repository_id, ...(typeof entry.display_name === 'string' ? { display_name: entry.display_name } : {}), ...(typeof entry.description === 'string' ? { description: entry.description } : {}) }] : []);
}
export function loadedModelNames(value: unknown): string[] {
  return record(value) && Array.isArray(value.all_models_loaded) ? value.all_models_loaded.flatMap((entry) => record(entry) && typeof entry.model_name === 'string' ? [entry.model_name] : []) : [];
}

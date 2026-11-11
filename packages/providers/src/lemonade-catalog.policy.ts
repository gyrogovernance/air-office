import bundled from './lemonade-models.catalog.json';

export type LocalModelListing = {
  id: string;
  recipe: string;
  labels: string[];
  sizeGB: number | null;
  downloaded: boolean | null;
  suggested: boolean;
};

function model(value: unknown, id?: string): LocalModelListing | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = id ?? ('id' in value && typeof value.id === 'string' ? value.id : '');
  if (!name || !('recipe' in value) || typeof value.recipe !== 'string' || value.recipe === 'cloud') return null;
  return {
    id: name, recipe: value.recipe,
    labels: 'labels' in value && Array.isArray(value.labels) ? value.labels.filter((label): label is string => typeof label === 'string') : [],
    sizeGB: 'size' in value && typeof value.size === 'number' && Number.isFinite(value.size) && value.size > 0 ? value.size : null,
    downloaded: 'downloaded' in value && typeof value.downloaded === 'boolean' ? value.downloaded : null,
    suggested: 'suggested' in value && value.suggested === true,
  };
}

/**
 * The purposes the Market offers. A model labelled for a purpose that is not
 * offered is left out of the catalog, so the Market never lists work AIR
 * Office does not do. Transcription is deferred, so it is not offered yet.
 */
const offeredPurposes = new Set(['upscaling', '3d', 'transcription', 'realtime-transcription']);

/** Whether a model does work the Market offers. */
function isOffered(labels: string[]): boolean {
  return !labels.some((label) => offeredPurposes.has(label));
}

/** Exact catalog from Lemonade v2026.42.1, commit 2aedebc4858642b9dd51e21bdb2791e62b03408b, Apache-2.0. */
export function bundledLemonadeCatalog(): LocalModelListing[] {
  return Object.entries(bundled).flatMap(([id, entry]) => { const parsed = model(entry, id); return parsed && isOffered(parsed.labels) ? [parsed] : []; });
}

export function parseLemonadeCatalog(value: unknown): LocalModelListing[] {
  if (!value || typeof value !== 'object' || !('data' in value) || !Array.isArray(value.data)) throw new Error('Invalid Lemonade catalog.');
  return value.data.flatMap((entry) => { const parsed = model(entry); return parsed && isOffered(parsed.labels) ? [parsed] : []; });
}

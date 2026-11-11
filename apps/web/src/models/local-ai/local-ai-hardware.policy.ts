export type HardwareBackend = { recipe: string; recipeLabel: string; id: string; state: string; message: string; devices: string[] };
export type HardwareFacts = { demo: boolean; processor: string | null; memory: string | null; devices: { name: string; detail: string }[]; backends: HardwareBackend[] };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function localHardwareFacts(value: unknown): HardwareFacts {
  const facts: HardwareFacts = { demo: false, processor: null, memory: null, devices: [], backends: [] };
  if (!record(value)) return facts;
  facts.demo = 'demo' in value && value.demo === true;
  facts.processor = 'Processor' in value && typeof value.Processor === 'string' ? value.Processor : null;
  facts.memory = 'Physical Memory' in value && typeof value['Physical Memory'] === 'string' ? value['Physical Memory'] : null;
  if (record(value.devices)) {
    for (const [kind, entries] of Object.entries(value.devices)) {
      for (const device of Array.isArray(entries) ? entries : [entries]) {
        if (!record(device) || device.available !== true || typeof device.name !== 'string') continue;
        if (kind === 'cpu') { facts.processor ??= device.name; continue; }
        facts.devices.push({ name: device.name, detail: typeof device.vram_gb === 'number' ? `${device.vram_gb} GB graphics memory` : kind.includes('npu') ? 'Neural processor' : 'Graphics' });
      }
    }
  }
  if (record(value.recipes)) {
    for (const [recipe, entry] of Object.entries(value.recipes)) {
      if (!record(entry) || !record(entry.backends)) continue;
      for (const [id, backend] of Object.entries(entry.backends)) {
        if (!backend || typeof backend !== 'object' || !('state' in backend) || typeof backend.state !== 'string') continue;
        facts.backends.push({ recipe, recipeLabel: typeof entry.web_display_name === 'string' ? entry.web_display_name : typeof entry.display_name === 'string' ? entry.display_name : recipe, id, state: backend.state, message: 'message' in backend && typeof backend.message === 'string' ? backend.message : '', devices: 'devices' in backend && Array.isArray(backend.devices) ? backend.devices.filter((device): device is string => typeof device === 'string') : [] });
      }
    }
  }
  return facts;
}

export function modelBackend(recipe: string, hardware: HardwareFacts) {
  const candidates = hardware.backends.filter((backend) => backend.recipe === recipe);
  return candidates.find((backend) => ['installed', 'update_available'].includes(backend.state)) ?? candidates.find((backend) => ['installable', 'update_required'].includes(backend.state)) ?? candidates.find((backend) => backend.state !== 'unsupported') ?? candidates[0] ?? null;
}

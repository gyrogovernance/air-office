import type { HardwareBackend, HardwareFacts } from './local-ai-hardware.policy';

export type LocalCapability = {
  id: string;
  label: string;
  recipe: string;
  engine: string;
  icon: 'chat' | 'mic' | 'volume' | 'image';
};

/**
 * What a user can do with a local engine. One row per capability keeps the
 * engine list short and connects each engine to the work it does.
 */
export const localCapabilities: LocalCapability[] = [
  { id: 'chat', label: 'Chat and text', recipe: 'llamacpp', engine: 'llama.cpp', icon: 'chat' },
  { id: 'transcription', label: 'Transcribe audio', recipe: 'whispercpp', engine: 'whisper.cpp', icon: 'mic' },
  { id: 'speech', label: 'Speak text', recipe: 'kokoro', engine: 'Kokoro', icon: 'volume' },
  { id: 'images', label: 'Generate images', recipe: 'sd-cpp', engine: 'Stable Diffusion', icon: 'image' },
];

export type CapabilityState = 'ready' | 'install' | 'unsupported' | 'unknown';

export type CapabilityRow = {
  capability: LocalCapability;
  state: CapabilityState;
  label: string;
  detail: string;
  backend: HardwareBackend | null;
};

/** The backend that serves a capability, preferring one that is already usable. */
export function capabilityBackend(recipe: string, hardware: HardwareFacts): HardwareBackend | null {
  const candidates = hardware.backends.filter((backend) => backend.recipe === recipe);
  return candidates.find((backend) => ['installed', 'update_available'].includes(backend.state))
    ?? candidates.find((backend) => ['installable', 'update_required'].includes(backend.state))
    ?? candidates.find((backend) => backend.state !== 'unsupported')
    ?? candidates[0]
    ?? null;
}

const stateLabels: Record<CapabilityState, string> = { ready: 'Ready', install: 'Install', unsupported: 'Not supported', unknown: 'Unknown' };

/** One row per capability, with a single plain-language state. */
export function capabilityRows(hardware: HardwareFacts): CapabilityRow[] {
  return localCapabilities.map((capability) => {
    const backend = capabilityBackend(capability.recipe, hardware);
    if (!backend) return { capability, state: 'unknown' as CapabilityState, label: stateLabels.unknown, detail: 'No engine is reported for this capability.', backend: null };
    const state: CapabilityState = ['installed', 'update_available'].includes(backend.state) ? 'ready' : ['installable', 'update_required'].includes(backend.state) ? 'install' : backend.state === 'unsupported' ? 'unsupported' : 'unknown';
    const devices = backend.devices.length ? ` · ${backend.devices.join(', ').replaceAll('_', ' ')}` : '';
    const detail = state === 'ready' ? `Installed${devices}${backend.state === 'update_available' ? ' · Update available' : ''}` : state === 'install' ? backend.state === 'update_required' ? `${capability.engine} requires an update.` : `${capability.engine} is not installed yet.` : state === 'unsupported' ? backend.message || `${capability.engine} is not supported on this computer.` : backend.message || 'Engine availability is unknown.';
    return { capability, state, label: stateLabels[state], detail, backend };
  });
}

/** A detected engine build that can serve the chat capability. */
export type EngineBuild = { id: string; name: string; path: string; version: string | null };

/** Only a llama.cpp server binary can run a local chat model. */
export function usableEngineBuilds(engines: { id: string; name: string; kind: string; path: string; version: string | null }[]): EngineBuild[] {
  return engines
    .filter((engine) => engine.kind === 'llama.cpp' && !engine.path.startsWith('http') && /llama-server(\.exe)?$/i.test(engine.path))
    .map((engine) => ({ id: engine.id, name: engine.name, path: engine.path, version: engine.version }));
}

/**
 * The engines one model can run on. The runtime stores this as a per-model
 * option, so a user can compare the CPU and the GPU with the same model.
 */
export type ModelEngine = { id: string; label: string; installed: boolean; state: string; recipe: string; devices: string[] };

/** The backend names the runtime uses, in the words a user would use. */
const backendLabels: Record<string, string> = { cpu: 'CPU', vulkan: 'Vulkan', cuda: 'CUDA', rocm: 'ROCm', metal: 'Metal', 'rocm-stable': 'ROCm (stable)', 'rocm-nightly': 'ROCm (nightly)', 'rocm-preview': 'ROCm (preview)', system: 'System' };

/**
 * The value that stands for "let the runtime choose". A plain empty string
 * reads as no selection in a combobox, so it cannot be chosen again once
 * another engine is picked.
 */
export const AUTO_ENGINE = 'auto';

export function modelEngines(recipe: string, hardware: HardwareFacts): ModelEngine[] {
  const candidates = hardware.backends.filter((backend) => backend.recipe === recipe);
  return candidates
    .filter((backend) => ['installed', 'update_available', 'installable', 'update_required'].includes(backend.state))
    .map((backend) => ({ id: backend.id, label: backendLabels[backend.id] ?? backend.id.replaceAll('_', ' '), installed: ['installed', 'update_available'].includes(backend.state), state: backend.state, recipe: backend.recipe, devices: backend.devices }));
}

/**
 * The engine a model runs on, taken from the saved option first and the
 * effective one second. The runtime resolves an unset option to the engine it
 * would pick anyway, so the chooser shows what is really in use.
 */
export function selectedModelEngine(options: { saved?: Record<string, unknown>; effective?: Record<string, unknown> } | null, recipe: string): string | null {
  const saved = options?.saved?.[`${recipe}_backend`];
  if (typeof saved === 'string' && saved) return saved;
  const effective = options?.effective?.[`${recipe}_backend`];
  return typeof effective === 'string' && effective ? effective : null;
}

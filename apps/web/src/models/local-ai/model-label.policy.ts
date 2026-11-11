import type { IconSvgElement } from '@hugeicons/react';
import { CloudServerIcon, CpuIcon, Image01Icon, Mic01Icon, SparklesIcon, VolumeUpIcon } from '@hugeicons/core-free-icons';

export type ModelLabelIcon = IconSvgElement;

/**
 * The models a person can pick in AIR Office. Each entry carries a label a
 * person would use and the icon that goes with it, so a long provider name
 * never has to fit inside a small bubble.
 */
export type ModelChoice = {
  value: string;
  label: string;
  roles?: string[];
  icon: ModelLabelIcon;
};

/** The icon that stands for a connection, used when a model has no own icon. */
export function connectionIcon(providerId: string): ModelLabelIcon {
  if (providerId === 'local-replay') return SparklesIcon;
  if (providerId === 'managed-local') return CpuIcon;
  return CloudServerIcon;
}

/** The icon that stands for what a model does. */
export function modelRoleIcon(roles: string[] | undefined): ModelLabelIcon {
  if (!roles?.length) return CpuIcon;
  if (roles.includes('image')) return Image01Icon;
  if (roles.includes('stt')) return Mic01Icon;
  if (roles.includes('tts')) return VolumeUpIcon;
  return CpuIcon;
}

type ProviderLike = { id: string; name?: string; models: string[]; modelFacts?: { modelId: string; roles: string[] }[] };

/** The model id alone from a `provider:model` selection key. */
export function modelIdFromKey(modelKey: string): string {
  const at = modelKey.indexOf(':');
  return at > 0 ? modelKey.slice(at + 1) || modelKey : modelKey;
}

/**
 * Compact text for the composer trigger. Never shows a raw provider key such as
 * `managed-local:…`, including while the catalog is still loading. The lab
 * sentinel `unassigned` reads as "No model", not as a fake model name.
 */
export function composerModelTriggerLabel(modelKey: string, catalogLabel?: string): string {
  if (!modelKey) return 'Choose a model';
  const modelId = modelIdFromKey(modelKey);
  if (modelId === 'unassigned') return 'No model';
  const label = catalogLabel?.trim() || modelId;
  if (!label) return 'Choose a model';
  if (label.length <= 18) return label;
  const first = label.split(/\s|·/)[0]?.trim();
  return first && first.length <= 18 ? first : `${label.slice(0, 16)}…`;
}

/** Label when the saved selection is not in the live model list. */
export function composerMissingModelLabel(modelKey: string): string {
  const label = composerModelTriggerLabel(modelKey);
  return label === 'No model' || label === 'Choose a model' ? label : 'Unavailable';
}

/**
 * The models a person can chat with, named the way a person would say them.
 * A local model is called by its own name; a hosted model carries the name of
 * its service, because two services can offer models with the same name.
 */
export function chatModelChoices(providers: ProviderLike[], demo: boolean): ModelChoice[] {
  return providers.flatMap((provider) => {
    // The replay model exists to exercise the workspace without an AI, so it
    // is offered in demo mode and nowhere else.
    if (provider.id === 'local-replay' && !demo) return [];
    return provider.models.flatMap((model) => {
      const roles = provider.modelFacts?.find((fact) => fact.modelId === model)?.roles;
      if (roles && !roles.includes('chat')) return [];
      const local = provider.id === 'managed-local';
      const label = provider.id === 'local-replay'
        ? 'Demo model'
        : local
          ? model
          : `${provider.name ?? provider.id} · ${model}`;
      return [{ value: `${provider.id}:${model}`, label, roles, icon: local ? modelRoleIcon(roles) : connectionIcon(provider.id) }];
    });
  });
}

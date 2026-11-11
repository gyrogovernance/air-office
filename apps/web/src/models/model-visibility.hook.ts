import { useEffect, useState } from 'react';

type ModelVisibility = { pinned: string[]; hidden: string[] };

export function visibleModelChoices<T extends { key: string; label: string }>(choices: T[], visibility: ModelVisibility, selected = ''): T[] {
  return choices.filter(choice => choice.key === selected || !visibility.hidden.includes(choice.key))
    .sort((a, b) => Number(visibility.pinned.includes(b.key)) - Number(visibility.pinned.includes(a.key)) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
}
const storageKey = 'air-office:model-visibility';
const changedEvent = 'office-model-visibility-changed';

function readVisibility(): ModelVisibility {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (!value || typeof value !== 'object') return { pinned: [], hidden: [] };
    const strings = (entry: unknown) => Array.isArray(entry) ? entry.filter((item): item is string => typeof item === 'string') : [];
    return { pinned: strings(Reflect.get(value, 'pinned')), hidden: strings(Reflect.get(value, 'hidden')) };
  } catch { return { pinned: [], hidden: [] }; }
}

export function useModelVisibility() {
  const [visibility, setVisibility] = useState(readVisibility);
  useEffect(() => {
    const refresh = () => setVisibility(readVisibility());
    window.addEventListener(changedEvent, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(changedEvent, refresh); window.removeEventListener('storage', refresh); };
  }, []);

  function update(change: (current: ModelVisibility) => ModelVisibility) {
    const next = change(readVisibility());
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { return; }
    setVisibility(next);
    window.dispatchEvent(new Event(changedEvent));
  }
  function togglePin(key: string) {
    update((current) => ({ pinned: current.pinned.includes(key) ? current.pinned.filter((item) => item !== key) : [...current.pinned, key], hidden: current.hidden.filter((item) => item !== key) }));
  }
  function toggleHidden(key: string) {
    update((current) => ({ pinned: current.hidden.includes(key) ? current.pinned : current.pinned.filter((item) => item !== key), hidden: current.hidden.includes(key) ? current.hidden.filter((item) => item !== key) : [...current.hidden, key] }));
  }
  return { ...visibility, update, togglePin, toggleHidden };
}

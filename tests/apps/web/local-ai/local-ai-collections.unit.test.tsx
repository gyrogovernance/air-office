import { afterAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { LocalAiCollections } from '../../../../apps/web/src/models/local-ai/local-ai-collections.component';
import type { CollectionOperation } from '@office/providers/lemonade-collections';
import '../../../support/web-dom.adapter';

const { act } = await import('react'); const { createRoot } = await import('react-dom/client');
const models = [{ id: 'builtin.Small', labels: ['tool-calling'], recipe: 'llamacpp' }, { id: 'user.Big', labels: ['tool-calling'], recipe: 'llamacpp' }];
test('structured router saves ordered rules, tests prompts, and resets defaults without rewriting identities', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const operations: CollectionOperation[] = [];
  const labelControl = (label: string) => [...host.querySelectorAll('label')].find((item) => item.firstChild?.textContent === label)!.querySelector('input,select,textarea')! as HTMLInputElement;
  const change = async (label: string, value: string) => { const control = labelControl(label); await act(async () => { control.value = value; control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); };
  const click = async (text: string) => act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === text)!.click(); });
  try {
    await act(async () => root.render(createElement(LocalAiCollections, { models, operation: async (value) => { operations.push(value); return { status: 'success' }; }, download: () => {} })));
    await change('Model group type', 'collection.router');
    for (const input of host.querySelectorAll<HTMLInputElement>('fieldset fieldset input[type=checkbox]')) await act(async () => input.click());
    await change('Default model', 'builtin.Small'); await change('Routing mode', 'rules'); await click('Add rule'); await change('Condition', 'has_tools'); await change('Route to', 'user.Big');
    await click('Save definition');
    expect(operations[0]).toMatchObject({ operation: 'save-collection', definition: { model_name: 'user.MyCollection', components: ['builtin.Small', 'user.Big'], routing: { default_model: 'builtin.Small', rules: [{ route_to: 'user.Big', match: { has_tools: true } }] } } });
    await click('Test routing'); expect(operations[1]).toMatchObject({ operation: 'test-collection-routing', prompt: '', has_images: false, has_tools: false });
    await change('Default model', ''); await click('Save definition'); expect(operations).toHaveLength(2); expect(host.querySelector('[role=alert]')).not.toBeNull();
    await change('Routing mode', 'llm'); await change('Router model', 'user.Big'); await click('Reset router prompt'); expect((labelControl('Router prompt') as unknown as HTMLTextAreaElement).value).toContain('ONLY the exact model name');
  } finally { await act(async () => root.unmount()); host.remove(); }
});
test('imported nested policies retain complete structure on export and failure preserves draft', async () => {
  const definition = { version: '1' as const, model_name: 'user.Existing', recipe: 'collection.router' as const, components: ['builtin.Small'], routing: { candidates: ['builtin.Small'], default_model: 'builtin.Small', rules: [{ id: 'nested', match: { not: { has_images: true } }, route_to: 'builtin.Small', outputs: { reason: 'keep' } }] } };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); let exported: unknown;
  try {
    await act(async () => root.render(createElement(LocalAiCollections, { models, initialDefinition: definition, operation: async () => { throw new Error('Runtime unavailable'); }, download: (value) => { exported = value; } })));
    const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === text)!;
    await act(async () => button('Save definition').click()); expect(host.textContent).toContain('Runtime unavailable'); expect(host.textContent).toContain('user.Existing');
    await act(async () => button('Export draft').click()); expect(exported).toEqual(definition);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

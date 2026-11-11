import { expect, test } from 'bun:test';
import { baselineSystemPrompt, BASELINE_SYSTEM_PROMPT } from '../../../packages/chat/src/baseline-instruction.policy';

test('a conversation without an attached agent still runs under the baseline instructions', () => {
  const prompt = baselineSystemPrompt([]);
  expect(prompt.startsWith(BASELINE_SYSTEM_PROMPT)).toBe(true);
  expect(prompt.length).toBeGreaterThan(BASELINE_SYSTEM_PROMPT.length);
});

test('the baseline tells the model which tools it may reach for', () => {
  const prompt = baselineSystemPrompt(['view', 'memory_search']);
  expect(prompt).toContain('view');
  expect(prompt).toContain('memory_search');
  expect(prompt).toContain('web_search');
  expect(prompt).toContain('web_fetch');
  expect(prompt).not.toBe(BASELINE_SYSTEM_PROMPT);
});

test('the baseline always names Copilot standard file shell and web tools', () => {
  const prompt = baselineSystemPrompt([]);
  expect(prompt).toContain('web_fetch');
  expect(prompt).toContain('bash');
  expect(prompt).toContain('view');
  expect(prompt).toContain('open_in_code');
});

test('full baseline keeps greetings in chat and narrows the task tool', () => {
  const prompt = baselineSystemPrompt([]);
  expect(prompt).toContain('Greetings and casual messages get a short reply in the chat');
  expect(prompt).toContain('Use the task tool only when the user asks to hand work to a specialized teammate');
  expect(prompt).not.toContain('use the task tool to delegate focused work');
});

test('lean baseline keeps web_search and omits Copilot-only tool instructions', () => {
  const prompt = baselineSystemPrompt(['web_search', 'web_fetch', 'view', 'todo_write'], { mode: 'lean' });
  expect(prompt).toContain('web_search');
  expect(prompt).toContain('call web_search rather than saying you have no web access');
  expect(prompt).toContain('Copilot shell tools are not available');
  expect(prompt).toContain('view, create (file_text), edit (old_str/new_str)');
  expect(prompt).toContain('web_fetch');
  expect(prompt).toContain('todo_write');
  expect(prompt).not.toContain('bash or powershell');
  expect(prompt).not.toContain('use the task tool');
});

test('baseline requires vault-relative paths and rejects legacy absolute homes', () => {
  const full = baselineSystemPrompt([]);
  const lean = baselineSystemPrompt(['view'], { mode: 'lean' });
  for (const prompt of [full, lean]) {
    expect(prompt).toContain('vault-relative paths');
    expect(prompt).toContain('private/files');
    expect(prompt).toContain('Office chat working directory is the AIR vault');
  }
});

test('the baseline keeps the workspace identity and does not name a provider', () => {
  expect(BASELINE_SYSTEM_PROMPT).toContain('AIR Office');
  // A model told only its own brand answers as that brand. The baseline must
  // give it a different identity to answer with.
  expect(BASELINE_SYSTEM_PROMPT).toMatch(/You are AIR\b/);
});

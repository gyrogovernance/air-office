import { expect, test } from 'bun:test';
import { prepareChatGptPlanRequest } from '../../../packages/providers/src/chatgpt-request.adapter';

test('ChatGPT plan requests expose Copilot tools before history without renaming calls', () => {
  const request = {
    model: 'gpt-5', store: false, stream: true,
    input: [
      { role: 'user', content: 'Read my note' },
      { type: 'function_call', call_id: 'call-1', name: 'read_note', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-1', output: 'Note text' }
    ],
    tools: [
      { type: 'function', name: 'read_note', parameters: { type: 'object', properties: {} } },
      { type: 'custom', name: 'edit_note', format: { type: 'text' } },
      { type: 'web_search' }
    ]
  };
  expect(prepareChatGptPlanRequest(request)).toEqual({
    model: 'gpt-5', store: false, stream: true,
    tools: [{ type: 'web_search' }],
    input: [
      { type: 'additional_tools', role: 'developer', tools: [
        { type: 'function', name: 'read_note', parameters: { type: 'object', properties: {} } },
        { type: 'custom', name: 'edit_note', format: { type: 'text' } }
      ] },
      { role: 'user', content: 'Read my note' },
      { type: 'function_call', call_id: 'call-1', name: 'read_note', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-1', output: 'Note text' }
    ]
  });
  expect(request.tools).toHaveLength(3);
  expect(request.input[0]).toEqual({ role: 'user', content: 'Read my note' });
});

test('preparing an already adapted request does not duplicate tool declarations', () => {
  const request = {
    input: [{ type: 'additional_tools', role: 'developer', tools: [{ type: 'function', name: 'read_note' }] }],
    tools: []
  };
  expect(prepareChatGptPlanRequest(request)).toEqual(request);
  expect(() => prepareChatGptPlanRequest({ input: 'hello' })).toThrow('input array');
});

test('model-specific Copilot system inputs use developer messages without unsupported cache markers', () => {
  expect(prepareChatGptPlanRequest({
    model: 'gpt-5.6-luna', store: false, stream: true,
    input: [
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'Follow workspace rules.', prompt_cache_breakpoint: { mode: 'explicit' } }] },
      { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,example', detail: 'auto' }] },
      { type: 'function_call_output', call_id: 'call-1', output: 'Saved note' }
    ]
  })).toEqual({
    model: 'gpt-5.6-luna', store: false, stream: true,
    input: [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Follow workspace rules.' }] },
      { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,example', detail: 'auto' }] },
      { type: 'function_call_output', call_id: 'call-1', output: 'Saved note' }
    ]
  });
});

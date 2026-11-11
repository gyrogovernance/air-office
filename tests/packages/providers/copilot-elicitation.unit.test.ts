import { describe, expect, test } from 'bun:test';
import { requestCopilotElicitation } from '../../../packages/providers/src/copilot-elicitation.adapter';

describe('requestCopilotElicitation', () => {
  test('asks Yes/No for a boolean field without a Continue consent step', async () => {
    const prompts: string[] = [];
    const choicesSeen: Array<string[] | undefined> = [];
    const result = await requestCopilotElicitation(
      {
        sessionId: 'test-session',
        message: 'Do you want to continue?',
        requestedSchema: {
          type: 'object',
          properties: { continue: { type: 'boolean', title: 'Do you want to continue?' } },
          required: ['continue']
        }
      },
      async (input) => {
        prompts.push(input.question);
        choicesSeen.push(input.choices);
        return { answer: 'Yes', wasFreeform: false };
      }
    );
    expect(prompts).toHaveLength(1);
    expect(choicesSeen).toEqual([['Yes', 'No']]);
    expect(result).toEqual({ action: 'accept', content: { continue: true } });
  });

  test('uses Allow/Decline for url elicitation mode', async () => {
    const result = await requestCopilotElicitation(
      {
        sessionId: 'test-session',
        mode: 'url',
        message: 'Open documentation?',
        url: 'https://example.com/docs'
      },
      async (input) => {
        expect(input.choices).toEqual(['Allow', 'Decline']);
        expect(input.url).toBe('https://example.com/docs');
        return { answer: 'Allow', wasFreeform: false };
      }
    );
    expect(result).toEqual({ action: 'accept' });
  });
});

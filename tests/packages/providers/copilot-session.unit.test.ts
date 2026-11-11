import { expect, test } from 'bun:test';
import { isCopilotSessionLoss } from '../../../packages/providers/src/copilot-session.adapter';

test('session-loss detection treats replace and disconnect as recoverable', () => {
  expect(isCopilotSessionLoss(new Error('Session disconnected while waiting for a response'))).toBe(true);
  expect(isCopilotSessionLoss(new Error('The session was closed or replaced while waiting for the response'))).toBe(true);
  expect(isCopilotSessionLoss(new Error('The provider rejected the credential.'))).toBe(false);
});

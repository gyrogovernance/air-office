import { describe, expect, test } from 'bun:test';
import { copilotSandboxNetworkPolicy, copilotToolSearchConfig, providerBaseUrlAllowsLocalNetwork } from '../../../packages/providers/src/copilot-provider.policy';

describe('providerBaseUrlAllowsLocalNetwork', () => {
  test('allows loopback OpenAI-compatible runtimes', () => {
    expect(providerBaseUrlAllowsLocalNetwork('http://127.0.0.1:8000/v1')).toBe(true);
    expect(providerBaseUrlAllowsLocalNetwork('http://localhost:11434/v1')).toBe(true);
    expect(providerBaseUrlAllowsLocalNetwork('http://[::1]:8000/v1')).toBe(true);
  });

  test('denies cloud and invalid endpoints', () => {
    expect(providerBaseUrlAllowsLocalNetwork('https://openrouter.ai/api/v1')).toBe(false);
    expect(providerBaseUrlAllowsLocalNetwork('https://api.openai.com/v1')).toBe(false);
    expect(providerBaseUrlAllowsLocalNetwork('')).toBe(false);
    expect(providerBaseUrlAllowsLocalNetwork(undefined)).toBe(false);
    expect(providerBaseUrlAllowsLocalNetwork('not-a-url')).toBe(false);
  });
});

describe('copilotSandboxNetworkPolicy', () => {
  test('keeps cloud BYOK off the LAN on non-Windows hosts', () => {
    expect(copilotSandboxNetworkPolicy({ baseUrl: 'https://openrouter.ai/api/v1', platform: 'linux' })).toEqual({
      allowOutbound: true,
      allowLocalNetwork: false
    });
    expect(copilotSandboxNetworkPolicy({ baseUrl: 'https://api.openai.com/v1', platform: 'darwin' })).toEqual({
      allowOutbound: true,
      allowLocalNetwork: false
    });
  });

  test('opens loopback for local BYOK and for Windows sandbox proxy reachability', () => {
    expect(copilotSandboxNetworkPolicy({ baseUrl: 'http://127.0.0.1:8000/v1', platform: 'linux' })).toEqual({
      allowOutbound: true,
      allowLocalNetwork: true
    });
    expect(copilotSandboxNetworkPolicy({ baseUrl: 'https://openrouter.ai/api/v1', platform: 'win32' })).toEqual({
      allowOutbound: true,
      allowLocalNetwork: true
    });
  });
});

describe('copilotToolSearchConfig', () => {
  test('keeps local BYOK preloaded so deferred-tool reminders are not injected', () => {
    expect(copilotToolSearchConfig(true)).toEqual({ enabled: false });
  });

  test('allows cloud sessions to defer large MCP and custom catalogs', () => {
    expect(copilotToolSearchConfig(false)).toEqual({ enabled: true, deferThreshold: 30 });
  });

  test('disables tool search for ChatGPT plan usage', () => {
    expect(copilotToolSearchConfig(false, { chatgptPlanUsage: true })).toEqual({ enabled: false });
  });
});

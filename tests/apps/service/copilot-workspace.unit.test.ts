import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mcpEndpointsMatch, mcpServerKey, resolveCopilotWorkspaceRoots } from '../../../apps/service/src/copilot-workspace.adapter';

describe('copilot workspace roots and mcp matching', () => {
  test('prefers the open connected folder and keeps realpath-resolved roots', () => {
    const root = join(tmpdir(), `air-copilot-roots-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    const alpha = join(root, 'alpha');
    const beta = join(root, 'beta');
    const files = join(root, 'files');
    const vault = join(root, 'fallback');
    mkdirSync(alpha, { recursive: true });
    mkdirSync(beta, { recursive: true });
    mkdirSync(files, { recursive: true });
    mkdirSync(vault, { recursive: true });
    const resolved = resolveCopilotWorkspaceRoots({
      connectedRoots: [alpha, beta],
      filesRoot: files,
      preferredWorkspaceRoot: beta,
      fallbackWorkdir: vault
    });
    expect(resolved.workingDirectory).toBe(beta);
    expect(resolved.workspaceRoots[0]).toBe(beta);
    expect(resolved.workspaceRoots).toContain(alpha);
    expect(resolved.workspaceRoots).not.toContain(files);
    expect(resolved.workspaceRoots).toContain(vault);
    rmSync(root, { recursive: true, force: true });
  });

  test('defaults the working directory to the vault when no folder is preferred', () => {
    const root = join(tmpdir(), `air-copilot-vault-default-${process.pid}`);
    rmSync(root, { recursive: true, force: true });
    const files = join(root, 'files');
    const vault = join(root, 'vault');
    mkdirSync(files, { recursive: true });
    mkdirSync(vault, { recursive: true });
    const resolved = resolveCopilotWorkspaceRoots({
      connectedRoots: [],
      filesRoot: files,
      fallbackWorkdir: vault
    });
    expect(resolved.workingDirectory).toBe(vault);
    expect(resolved.workspaceRoots[0]).toBe(vault);
    expect(resolved.workspaceRoots).not.toContain(files);
    expect(resolved.workspaceRoots).toEqual([vault]);
    rmSync(root, { recursive: true, force: true });
  });

  test('matches MCP auth by normalized URL or server key', () => {
    expect(mcpServerKey('market:github tools')).toBe('market_github_tools');
    expect(mcpEndpointsMatch('https://Example.com/mcp', 'https://example.com/mcp')).toBe(true);
    expect(mcpEndpointsMatch('https://example.com/mcp', 'https://other.example/mcp')).toBe(false);
  });
});

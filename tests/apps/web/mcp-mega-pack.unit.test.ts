import { expect, test } from 'bun:test';
import { MEGA_PACK_GROUPS, MEGA_PACK_SERVERS, megaPackConnectionId, megaPackEndpoint, megaPackInstalled } from '../../../apps/web/src/market/mcp-mega-pack.policy';

test('every mega pack server resolves to its own hosted keyless endpoint', () => {
  const endpoints = MEGA_PACK_SERVERS.map(megaPackEndpoint);
  expect(new Set(endpoints).size).toBe(MEGA_PACK_SERVERS.length);
  for (const server of MEGA_PACK_SERVERS) {
    expect(megaPackEndpoint(server)).toBe(`https://${server.id}.caseyjhand.com/mcp`);
    expect(MEGA_PACK_GROUPS).toContain(server.group);
  }
});

test('a pack server is recognised by its stored id or its endpoint', () => {
  const server = MEGA_PACK_SERVERS[0]!;
  const connection = { id: megaPackConnectionId(server), name: server.name, kind: 'mcp' as const, endpoint: megaPackEndpoint(server), enabled: false, createdAt: '', updatedAt: '', discoveredAt: '' };
  expect(megaPackInstalled(server, [connection])?.id).toBe(megaPackConnectionId(server));
  expect(megaPackInstalled(server, [{ ...connection, id: 'other' }])?.id).toBe('other');
  expect(megaPackInstalled(server, [])).toBeUndefined();
});


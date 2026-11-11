import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin });
const send = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
input.on('line', (line) => {
  const message = JSON.parse(line) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  if (message.method === 'initialize') send(message.id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } });
  if (message.method === 'tools/list') send(message.id, { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }] });
  if (message.method === 'tools/call') {
    if (message.params?.name === 'hang') return;
    if (message.params?.name === 'overflow') { process.stdout.write('x'.repeat(100_000)); return; }
    if (message.params?.name === 'fail') { send(message.id, { isError: true, content: [{ type: 'text', text: 'credential must remain private' }] }); return; }
    send(message.id, { content: [{ type: 'text', text: String(message.params?.arguments?.text ?? process.env.RESEND_API_KEY ?? '') }] });
  }
});
input.on('close', () => process.exit(0));

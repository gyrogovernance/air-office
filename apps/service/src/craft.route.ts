import { craftCommandSchema, CRAFT_PACKAGE_MAX_BYTES } from '@office/methods/domain';
import type { createCraftService } from '@office/methods/service';

export function createCraftRoutes(crafts: ReturnType<typeof createCraftService>, refreshResources: () => Promise<unknown>) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/crafts') return null;
    try {
      if (request.method === 'GET') {
        await refreshResources();
        return Response.json(crafts.snapshot(), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'POST') return new Response(null, { status: 405 });
      if (Number(request.headers.get('content-length')) > CRAFT_PACKAGE_MAX_BYTES) return Response.json({ error: 'Craft package exceeds the size limit.' }, { status: 413 });
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > CRAFT_PACKAGE_MAX_BYTES) return Response.json({ error: 'Craft package exceeds the size limit.' }, { status: 413 });
      const command = craftCommandSchema.safeParse(JSON.parse(text));
      if (!command.success) return Response.json({ error: command.error.issues[0]?.message ?? 'Invalid craft request.' }, { status: 400 });
      await refreshResources();
      return Response.json({ result: crafts.execute(command.data), snapshot: crafts.snapshot() });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'The craft could not be updated.' }, { status: 400 }); }
  };
}

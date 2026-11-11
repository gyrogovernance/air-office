import { bundledLemonadeCatalog, parseLemonadeCatalog } from '@office/providers/service';
import { LemonadeManagementAdapter, type LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';

type DescriptorArg = LemonadeRuntimeDescriptor | null | (() => LemonadeRuntimeDescriptor | null);
const resolveDescriptor = (value: DescriptorArg) => typeof value === 'function' ? value() : value;

export function createModelCatalogRoutes(getDescriptor: DescriptorArg) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/model-catalog' || request.method !== 'GET') return null;
    const descriptor = resolveDescriptor(getDescriptor);
    if (descriptor) {
      try {
        const adapter = new LemonadeManagementAdapter(descriptor);
        const models = parseLemonadeCatalog(await adapter.listCatalogModels({ signal: request.signal }));
        const source = new URL(request.url).searchParams.get('source');
        if (source === 'all') {
          const all = parseLemonadeCatalog(await adapter.listUnfilteredCatalogModels({ signal: request.signal }));
      const compatible = new Set(models.map((model) => model.id));
          return Response.json({ models: all.map((model) => ({ ...model, compatible: compatible.has(model.id) })), source: 'runtime', release: descriptor.release }, { headers: { 'Cache-Control': 'no-store' } });
        }
        return Response.json({ models, source: 'runtime', release: descriptor.release }, { headers: { 'Cache-Control': 'no-store' } });
      } catch { /* The bundled catalog remains browsable when the runtime is unavailable. */ }
    }
    return Response.json({ models: bundledLemonadeCatalog().map((model) => ({ ...model, compatible: null })), source: 'bundled', release: '2026.42.1' }, { headers: { 'Cache-Control': 'no-store' } });
  };
}

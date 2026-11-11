import { requestStorageLocation, storageLocationStatus, type StorageLayout } from '@office/runtime/service';

export function createStorageLocationRoutes(config: string, defaults: StorageLayout, canRelocate: boolean) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/storage-location') return null;
    if (request.method === 'GET') return Response.json({ ...await storageLocationStatus(config, defaults), canRelocate });
    if (request.method !== 'PUT') return new Response(null, { status: 405 });
    if (!canRelocate) return Response.json({ error: 'Storage is controlled by the host configuration. Change the attached runtime or database configuration there.' }, { status: 409 });
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return Response.json({ error: 'Choose a folder path.' }, { status: 400 });
    const destination = 'destination' in body ? body.destination : undefined;
    const models = 'modelsDestination' in body ? body.modelsDestination : undefined;
    if (destination === undefined && models === undefined) return Response.json({ error: 'Choose a folder path.' }, { status: 400 });
    if (destination !== undefined && destination !== null && (typeof destination !== 'string' || destination.length > 4096)) return Response.json({ error: 'Choose a folder path.' }, { status: 400 });
    if (models !== undefined && models !== null && (typeof models !== 'string' || models.length > 4096)) return Response.json({ error: 'Choose a folder path.' }, { status: 400 });
    try {
      await requestStorageLocation(config, defaults, destination === undefined ? undefined : destination as string | null, models as string | null | undefined);
      return Response.json(await storageLocationStatus(config, defaults));
    } catch (error) { return Response.json({ error: error instanceof Error && /^(Choose|Storage settings)/.test(error.message) ? error.message : 'The folder could not be used. Check its permissions and available space.' }, { status: 400 }); }
  };
}

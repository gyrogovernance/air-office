import type { createLocalInferenceControl } from '@office/runtime/service';
import { LemonadeManagementAdapter, LemonadeStatusError, type LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';

function unloadFailure(error: unknown): string {
  if (error instanceof LemonadeStatusError) {
    if (error.code === 'timeout') return 'Local AI did not finish unloading models in time. Retry turning it off.';
    if (error.code === 'unavailable') return 'Local AI runtime is unreachable, so loaded models could not be confirmed unloaded. Retry when the runtime is ready.';
    if (error.code === 'cancelled') return 'Unloading local models was cancelled. Retry turning Local AI off.';
    return 'The runtime could not unload its models. Retry turning Local AI off.';
  }
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message || message === 'Failed to fetch' || /failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Local AI runtime is unreachable, so loaded models could not be confirmed unloaded. Retry when the runtime is ready.';
  }
  return message;
}

export function createLocalAiPowerRoutes(options: {
  control: ReturnType<typeof createLocalInferenceControl>;
  getDescriptor: () => LemonadeRuntimeDescriptor | null;
  /** Browser-dev can start Lemonade on demand through the supervisor. */
  canStart?: () => boolean;
  ensure?: () => Promise<LemonadeRuntimeDescriptor | null>;
  owned: () => boolean;
  onDisabled(): void;
  /** Called after Local AI is turned on so background embedding work can resume. */
  onEnabled?(): void;
}) {
  let stopping: Promise<void> | null = null;
  let unloadError = '';
  const snapshot = () => ({
    available: options.getDescriptor() !== null || Boolean(options.canStart?.()),
    enabled: options.control.enabled(),
    stopping: stopping !== null,
    ...(unloadError ? { error: unloadError } : {}),
  });
  const stop = async () => {
    const descriptor = options.getDescriptor();
    if (!descriptor || !options.owned()) return;
    const adapter = new LemonadeManagementAdapter(descriptor);
    const assertUnloaded = (result: unknown) => {
      if (result && typeof result === 'object' && ('error' in result || 'status' in result && result.status === 'error')) throw new Error('The runtime could not unload its models. Retry turning Local AI off.');
    };
    let jobsStopped = true;
    try {
      const result = await adapter.listJobs();
      const jobs = Array.isArray(result) ? result : Array.isArray(result.jobs) ? result.jobs : [];
      const active = jobs.filter((job): job is Record<string, unknown> => Boolean(job && typeof job === 'object' && !Array.isArray(job) && 'status' in job && (job.status === 'running' || job.status === 'queued')));
      const stopped = await Promise.allSettled(active.flatMap(job => typeof job.id === 'string' ? [adapter.controlJob(job.id, 'interrupt')] : []));
      jobsStopped = stopped.every(result => result.status === 'fulfilled' && !(result.value && typeof result.value === 'object' && ('error' in result.value || 'status' in result.value && result.value.status === 'error')));
    } catch { jobsStopped = false; }
    assertUnloaded(await adapter.unloadAllModels());
    const health = await adapter.getHealth();
    if (!health || typeof health !== 'object' || !('all_models_loaded' in health) || !Array.isArray(health.all_models_loaded)) throw new Error('Could not confirm that local models stopped. Retry turning Local AI off.');
    if (health.all_models_loaded.length > 0) throw new Error('Some local models are still stopping. Retry turning Local AI off.');
    if (!jobsStopped) throw new Error('Models were unloaded, but runtime jobs could not all be stopped. Retry turning Local AI off.');
  };
  const beginStop = () => {
    if (stopping) return stopping;
    unloadError = '';
    stopping = stop().catch((error) => { unloadError = unloadFailure(error); }).finally(() => { stopping = null; });
    return stopping;
  };
  if (options.owned() && options.getDescriptor()) void beginStop();
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/local-ai/power') return null;
    if (request.method === 'GET') return Response.json(snapshot(), { headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'PUT') return new Response(null, { status: 405 });
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('enabled' in body) || typeof body.enabled !== 'boolean') return Response.json({ error: 'Choose whether Local AI is on or off.' }, { status: 400 });
    if (body.enabled) {
      if (!options.getDescriptor() && options.ensure) {
        const started = await options.ensure();
        if (!started) return Response.json({ error: 'The local AI runtime could not be started.', ...snapshot() }, { status: 503 });
      }
      if (!options.getDescriptor()) return Response.json({ error: 'The local AI runtime is not configured.' }, { status: 503 });
      if (stopping) return Response.json({ error: 'Wait for Local AI to finish stopping.', ...snapshot() }, { status: 409 });
      unloadError = '';
      options.control.setEnabled(true);
      options.onEnabled?.();
    } else {
      options.control.setEnabled(false);
      options.onDisabled();
      if (options.owned() && options.getDescriptor()) void beginStop();
    }
    return Response.json(snapshot(), { headers: { 'Cache-Control': 'no-store' } });
  };
}

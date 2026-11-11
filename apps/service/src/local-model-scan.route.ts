import { isAbsolute, basename, dirname } from 'node:path';
import { stat } from 'node:fs/promises';
import { LemonadeManagementAdapter, type LemonadeRuntimeDescriptor } from '@office/providers/lemonade-status';
import { modelRegistryFromManagedModels } from '@office/providers/service';
import { createLocalModelScanStore, defaultModelLocations, enginesFromSystemInfo, roleLabels, roleRecipe, buildVersion, type ModelLocation } from './local-model-scan.adapter';

/**
 * Remove an imported model from the runtime without touching its files.
 *
 * The runtime deletes a registered model through its own managed cache, so a
 * model that was imported from a folder the user owns is refused. Registering
 * the same model a second time without a source marks it as a registry entry,
 * which the runtime then removes from its registry alone. The files stay where
 * the user put them.
 */
async function removeImportedModel(descriptor: LemonadeRuntimeDescriptor, publicName: string, canonical: string, path: string, recipe: string, labels: string[], signal: AbortSignal) {
  const adapter = new LemonadeManagementAdapter(descriptor);
  await adapter.unloadModel({ model_name: publicName }, { signal }).catch(() => undefined);
  await adapter.registerModel({ model_name: canonical, recipe, checkpoint: path, labels }, { signal });
  await adapter.deleteModel({ model_name: publicName }, { signal });
}

/**
 * The name a person would use for a model the runtime holds. An imported
 * model keeps a generated name, so the readable part is taken from it.
 */
function displayName(id: string): string {
  const imported = /^imported-(.+)-[0-9a-f]{10}$/.exec(id);
  if (imported) return imported[1]!;
  return id;
}

/**
 * The name a person would use for a model file. A file called "model.gguf"
 * takes the name of the folder it sits in, because that folder usually
 * carries the family the model belongs to.
 */
function readableName(model: { name: string; path: string }): string {
  const file = model.name.replace(/\.gguf$/i, '');
  if (file && !/^(model|model-|weights|checkpoint|main|gguf)/i.test(file)) return file;
  const folder = basename(dirname(model.path));
  if (folder && !/^(models?|weights?|checkpoints?|downloads?|huggingface|hf-cache|blobs)$/i.test(folder)) return folder;
  return file || basename(model.path);
}

type DescriptorArg = LemonadeRuntimeDescriptor | null | (() => LemonadeRuntimeDescriptor | null);
const resolveDescriptor = (value: DescriptorArg) => typeof value === 'function' ? value() : value;

export function createLocalModelScanRoutes(path: string, getDescriptor: DescriptorArg, allowImport: boolean, locations?: ModelLocation[], modelsDirectory?: string | null) {
  const store = createLocalModelScanStore(path, locations ?? defaultModelLocations(undefined, process.env, process.platform, modelsDirectory));
  let busy = false;
  const runtimeEngines = async () => {
    const descriptor = resolveDescriptor(getDescriptor);
    if (!descriptor) return [];
    try { return enginesFromSystemInfo(await new LemonadeManagementAdapter(descriptor).getSystemInfo()); } catch { return []; }
  };
  /** Models the managed runtime already has, so a downloaded model is listed too. */
  const runtimeModels = async (): Promise<{ id: string; name: string; role: 'chat' | 'embedding' | 'rerank' | 'image' | 'stt' | 'tts' | 'other'; recipe: string; backend: string | null }[]> => {
    const descriptor = resolveDescriptor(getDescriptor);
    if (!descriptor) return [];
    try {
      const listed = await new LemonadeManagementAdapter(descriptor).listInstalledModels();
      const data = Array.isArray(listed) ? listed : (listed as { data?: unknown[] }).data;
      if (!Array.isArray(data)) return [];
      const registry = modelRegistryFromManagedModels(listed);
      return data.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const id = (entry as { id?: unknown }).id;
        if (typeof id !== 'string' || !id) return [];
        const roles = registry.find((model) => model.modelId === id)?.roles ?? [];
        const role: 'chat' | 'embedding' | 'rerank' | 'image' | 'stt' | 'tts' | 'other' = roles.includes('chat') ? 'chat' : roles.includes('embedding') ? 'embedding' : roles.includes('rerank') ? 'rerank' : roles.includes('image') ? 'image' : roles.includes('stt') ? 'stt' : roles.includes('tts') ? 'tts' : 'other';
        const recipe = typeof (entry as { recipe?: unknown }).recipe === 'string' ? (entry as { recipe: string }).recipe : 'llamacpp';
        return [{ id, name: displayName(id), role, recipe, backend: null }];
      });
    } catch { return []; }
  };
  const status = async () => {
    const descriptor = resolveDescriptor(getDescriptor);
    const state = await store.status();
    const runtime = await runtimeEngines();
    const seen = new Set(state.engines.map((engine) => engine.id));
    const managed = await runtimeModels();
    // A model the runtime holds is a model the user owns, so it belongs in
    // the same list as one imported from a folder.
    const known = new Set(state.models.map((model) => model.importedModel));
    const missing = managed.filter((model) => !known.has(model.id));
    return { ...state, engines: [...state.engines, ...runtime.filter((engine) => !seen.has(engine.id))], managedModels: missing, canImport: Boolean(descriptor && allowImport) };
  };
  /**
   * The version each build reports, so two builds of the same engine can be
   * told apart. The version is read from the binary itself, and a build that
   * does not report one is still listed.
   */
  const buildVersions = async (engines: { builds?: string[] }[]) => {
    const paths = [...new Set(engines.flatMap((engine) => engine.builds ?? []))];
    const versions = new Map<string, string | null>();
    await Promise.all(paths.map(async (path) => versions.set(path, await buildVersion(path))));
    return Object.fromEntries(versions);
  };
  /** The full list, with the version of every build attached. */
  const fullStatus = async () => {
    const state = await status();
    return { ...state, buildVersions: await buildVersions(state.engines) };
  };
  return async (request: Request, url: URL): Promise<Response | null> => {
    if (url.pathname !== '/api/v1/local-ai/model-scan') return null;
    const descriptor = resolveDescriptor(getDescriptor);
    if (request.method === 'GET') return Response.json(await fullStatus());
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (busy) return Response.json({ error: 'A model scan or import is already running.' }, { status: 409 });
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('action' in body)) return Response.json({ error: 'Choose a scan action.' }, { status: 400 });
    busy = true;
    let filesPreserved = false;
    try {
      if (body.action === 'add-folder' && 'path' in body && typeof body.path === 'string') await store.add(body.path);
      else if (body.action === 'remove-folder' && 'id' in body && typeof body.id === 'string') await store.remove(body.id);
      else if (body.action === 'scan') await store.scan(request.signal);
      else if (body.action === 'delete' && 'id' in body && typeof body.id === 'string') {
        const model = await store.model(body.id);
        if (!model) return Response.json({ error: 'This model is no longer listed. Scan again.' }, { status: 404 });
        if (model.importedModel) {
          if (!descriptor || !allowImport) return Response.json({ error: 'Deleting an imported model requires the managed local runtime on this computer.' }, { status: 409 });
          const recipe = roleRecipe[model.role];
          const labels = roleLabels[model.role];
          const canonical = model.importedCanonical ?? `user.${model.importedModel.replace(/^user\./, '')}`;
          await removeImportedModel(descriptor, model.importedModel, canonical, model.path, recipe, labels, request.signal);
        }
        await store.removeModel(body.id);
        filesPreserved = true;
      } else if (body.action === 'remove-engine' && 'id' in body && typeof body.id === 'string' && 'build' in body && typeof body.build === 'string') {
        const state = await status();
        const engine = state.engines.find((item) => item.id === body.id);
        const builds = engine?.builds ?? (engine && !engine.path.startsWith('http') ? [engine.path] : []);
        // The build must be one this scan actually found, so a caller cannot
        // name a path the user never had.
        if (!builds.includes(body.build)) return Response.json({ error: 'This engine build is no longer listed. Scan again.' }, { status: 404 });
        await store.hideBuild(body.build);
      } else if (body.action === 'use-engine' && 'id' in body && typeof body.id === 'string' && 'build' in body && typeof body.build === 'string') {
        if (!descriptor) return Response.json({ error: 'Using an engine build requires the managed local runtime on this computer.' }, { status: 409 });
        const state = await status();
        const engine = state.engines.find((item) => item.id === body.id);
        // The build must be one this scan actually found, so a caller cannot
        // point the runtime at an arbitrary path.
        const builds = engine?.builds ?? (engine && !engine.path.startsWith('http') ? [engine.path] : []);
        const build = builds.find((item) => item === body.build);
        if (!build || !isAbsolute(build)) return Response.json({ error: 'This engine build is no longer listed. Scan again.' }, { status: 404 });
        if (!await stat(build).then((info) => info.isFile()).catch(() => false)) return Response.json({ error: 'This engine build is no longer on disk. Scan again.' }, { status: 404 });
        await new LemonadeManagementAdapter(descriptor).setConfig({ key: 'llamacpp_cpu_bin', value: build }, { signal: request.signal });
      } else if (body.action === 'set-model-engine' && 'model' in body && typeof body.model === 'string' && 'backend' in body && typeof body.backend === 'string') {
        if (!descriptor) return Response.json({ error: 'Choosing an engine for a model requires the managed local runtime on this computer.' }, { status: 409 });
        // The runtime stores the backend as a per-model option, so one model
        // can run on the CPU while another runs on the GPU. The option key
        // follows the model's own recipe, because each recipe names its
        // backend option differently.
        const recipe = 'recipe' in body && typeof body.recipe === 'string' ? body.recipe : 'llamacpp';
        const adapter = new LemonadeManagementAdapter(descriptor);
        // The runtime treats "auto" as "choose for me" and clears the stored
        // option, so the model returns to the engine the runtime would pick.
        await adapter.saveModelOptions(body.model, { [`${recipe}_backend`]: body.backend === 'auto' ? 'auto' : body.backend }, { signal: request.signal });
      } else if (body.action === 'import' && 'id' in body && typeof body.id === 'string') {
        if (!descriptor || !allowImport) return Response.json({ error: 'Import requires the managed local runtime on this computer.' }, { status: 409 });
        const model = await store.candidate(body.id);
        // A model file is often called nothing but "model.gguf", so the folder
        // it sits in carries the name a person would recognize.
        const label = readableName(model);
        const name = `user.imported-${label.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)}-${model.id.slice(0, 10)}`;
        // The recipe and the labels tell the runtime which engine serves the
        // model. An image model registered as a chat model would be offered in
        // chat and refused by the image endpoint.
        const recipe = roleRecipe[model.role];
        const labels = roleLabels[model.role];
        const result = await new LemonadeManagementAdapter(descriptor).registerModel({ model_name: name, recipe, checkpoint: model.path, source: 'local_path', labels, size: model.size / 1024 ** 3 }, { signal: request.signal });
        const publicName = !Array.isArray(result) && typeof result.model_name === 'string' ? result.model_name : name;
        const canonical = !Array.isArray(result) && typeof result.canonical_model_name === 'string' ? result.canonical_model_name : name;
        await store.imported(model.id, publicName, canonical);
      } else return Response.json({ error: 'Choose a valid scan action.' }, { status: 400 });
      return Response.json({ ...await fullStatus(), filesPreserved });
    } catch { return Response.json({ error: body.action === 'import' ? 'The model could not be imported. Scan again and check that its files and llama.cpp engine are available.' : body.action === 'delete' ? 'The model could not be removed. Scan again and try again.' : body.action === 'use-engine' ? 'This engine build could not be used. Scan again and try again.' : body.action === 'remove-engine' ? 'This engine build could not be removed. Scan again and try again.' : 'The scan could not be completed. Check folder access and try again.' }, { status: 400 }); }
    finally { busy = false; }
  };
}

/**
 * What a local model can be asked to do. The runtime reports these as labels,
 * and the recipe decides which engine serves it.
 *
 * The Media app draws images. Speech is not a kind of media the app offers:
 * a spoken answer belongs in the conversation that asked for it, so text to
 * speech is a chat action rather than a Media tab.
 */
export type MediaKind = 'image';

export type MediaModel = {
  id: string;
  name: string;
  recipe: string;
  labels: string[];
};

/**
 * The label a model must carry to be offered for a kind of work. A label in
 * `excludes` takes the model out, because a model that only enlarges a
 * picture cannot draw one.
 */
const kindLabels: Record<MediaKind, { labels: string[]; excludes: string[] }> = {
  image: { labels: ['image', 'edit'], excludes: [] },
};

/** The recipe that serves a kind of work. */
export const kindRecipe: Record<MediaKind, string> = { image: 'sd-cpp' };

/**
 * Whether a model can do a kind of work. A model is offered only when the
 * runtime labels it for that work, because a chat model cannot make an image.
 */
export function modelSupportsKind(model: MediaModel, kind: MediaKind): boolean {
  const labels = model.labels.map((label) => label.toLowerCase());
  const rule = kindLabels[kind];
  if (rule.excludes.some((label) => labels.includes(label))) return false;
  return rule.labels.some((label) => labels.includes(label));
}

/**
 * The models that can do a kind of work, named the way a person would say
 * them. A model whose recipe does not match the work is left out, because the
 * runtime would refuse the request.
 */
export function mediaModelsForKind(models: MediaModel[], kind: MediaKind): MediaModel[] {
  return models.filter((model) => modelSupportsKind(model, kind));
}

/** The words a person would use for a model of this kind. */
export function mediaModelLabel(model: MediaModel): string {
  return model.name;
}

/**
 * The name a person would use for a model the runtime holds. An imported
 * model keeps a generated name in the runtime, so the readable part is taken
 * from it.
 */
export function mediaModelName(id: string): string {
  const imported = /^imported-(.+)-[0-9a-f]{10}$/.exec(id);
  return imported ? imported[1]! : id;
}

/**
 * The shapes an image can be drawn in. The runtime takes a width and a
 * height, so a shape is the pair that carries it. The sizes are multiples of
 * 64, which is what the image engine needs.
 */
export type ImageShape = 'square' | 'landscape' | 'portrait';

export const imageShapes: { value: ImageShape; label: string; size: string }[] = [
  { value: 'square', label: 'Square', size: '1024x1024' },
  { value: 'landscape', label: 'Landscape', size: '1152x768' },
  { value: 'portrait', label: 'Portrait', size: '768x1152' },
];

/** The size that goes with a shape. */
export function imageSize(shape: ImageShape): string {
  return imageShapes.find((item) => item.value === shape)?.size ?? imageShapes[0]!.size;
}

/**
 * How much work the image engine puts into a picture. The engine counts
 * steps, and more steps mean a more finished picture at a slower pace.
 */
export type ImageQuality = 'draft' | 'standard' | 'detailed';

export const imageQualities: { value: ImageQuality; label: string; steps: number; help: string }[] = [
  { value: 'draft', label: 'Draft', steps: 4, help: 'Fastest. Good for checking a prompt.' },
  { value: 'standard', label: 'Standard', steps: 20, help: 'A balanced picture. This is the usual choice.' },
  { value: 'detailed', label: 'Detailed', steps: 35, help: 'Slower, with more fine detail.' },
];

/** The number of steps that goes with a quality. */
export function imageSteps(quality: ImageQuality): number {
  return imageQualities.find((item) => item.value === quality)?.steps ?? imageQualities[1]!.steps;
}

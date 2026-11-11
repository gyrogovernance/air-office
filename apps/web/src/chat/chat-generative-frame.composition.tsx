/**
 * Generative Frame + spec vocabulary for assistant-ui threads
 * (/generative-frame/docs/assistant-ui, /docs/tools/generative-ui-formats).
 *
 * AIR keeps the service graph authoritative, so widget tools are render-only
 * (`execution: "backend"`). Frontend execute + AI SDK frontendTools stay for a
 * later bridge; instructions still register into model context for when that
 * path lands.
 */
import { createWidgetToolkit, useWidgetInstructions } from 'generative-frame/assistant-ui';
import { createSpecToolkit } from 'generative-frame/spec/assistant-ui';
import { defaultGenerativeUILibrary } from '@assistant-ui/generative-ui/react';
import { toSpecCatalog } from '@assistant-ui/generative-ui/spec';

const { catalog, components } = toSpecCatalog(defaultGenerativeUILibrary);

/** Widget + spec toolkit entries to spread into the AIR chat toolkit. */
export const airWidgetFrame = createWidgetToolkit({
  execution: 'backend',
  display: 'standalone',
  widget: { product: 'air-office', maxHeight: 700 },
  spec: createSpecToolkit(catalog, { components }),
});

/** Registers when-to-use-widget guidance on the runtime model context. */
export function ChatWidgetInstructions() {
  useWidgetInstructions(airWidgetFrame.tools);
  return null;
}

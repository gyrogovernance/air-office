import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

const logger = createLogger();
const info = logger.info.bind(logger);
logger.info = (msg, options) => {
  // Keep the Local URL; drop Vite version splash and the interactive-help hint.
  if (msg.includes('press h + enter')) return;
  if (/\bVITE\b/.test(msg) && /ready in/i.test(msg)) return;
  info(msg, options);
};

const staticDemo = process.env.VITE_STATIC_DEMO === '1';

export default defineConfig({
  customLogger: logger,
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  // Distinct static Pages build only — product `build:web` keeps default `/` + `dist`.
  base: staticDemo ? './' : undefined,
  publicDir: '../../assets',
  build: staticDemo ? { outDir: 'dist-static-demo', emptyOutDir: true } : undefined,
  resolve: { alias: {
  '@': resolve(__dirname, 'src'),
  '@office/contracts/file': resolve(__dirname, '../../packages/contracts/src/file.contracts.public.ts'),
  '@office/contracts/chat': resolve(__dirname, '../../packages/contracts/src/chat/chat.contracts.public.ts'),
  '@office/contracts/tool': resolve(__dirname, '../../packages/contracts/src/tool.contracts.public.ts'),
  '@office/files/service': resolve(__dirname, '../../packages/files/src/files.service.public.ts'),
  '@office/lab-pack/domain': resolve(__dirname, '../../packages/lab-pack/src/lab-pack.domain.public.ts'),
  '@office/editor/domain': resolve(__dirname, '../../packages/editor/src/editor.domain.public.ts'),
  '@office/providers/service': resolve(__dirname, '../../packages/providers/src/providers.service.public.ts'),
  '@office/chat/domain': resolve(__dirname, '../../packages/chat/src/chat.domain.public.ts'),
  '@office/tools/domain': resolve(__dirname, '../../packages/tools/src/tools.domain.public.ts'),
  '@office/workspace/domain': resolve(__dirname, '../../packages/workspace/src/workspace.domain.public.ts'),
  '@office/ui-kit/ui': resolve(__dirname, '../../packages/ui-kit/src/ui-kit.ui.public.ts'),
  '@office/ui-kit/styles': resolve(__dirname, '../../packages/ui-kit/src/ui-kit.tokens.css'),
  '@office/ui-kit/base': resolve(__dirname, '../../packages/ui-kit/src/ui-kit-base.styles.css')
} }, server: {
  fs: { allow: ['../..'] },
  // publicDir is ../../assets. On Windows, rewriting large images there locks the
  // file; Vite's watcher then throws EBUSY and takes the whole dev server down.
  // Static images do not need HMR.
  watch: { ignored: ['**/assets/images/**'] },
} });

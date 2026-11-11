import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/desktop.entry.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/desktop.entry.ts'),
        },
        output: {
          // package.json is "type": "module"; a .js preload is treated as ESM and
          // `require` fails, so airDesktop never appears and services never start.
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    // Stub only — real UI is apps/web on 5173. Keep this off 5173 so the two
    // Vite servers do not fight (IPv4 vs IPv6) during `bun run dev -- --native`.
    root: resolve('src/renderer-stub'),
    server: {
      port: 5199,
      strictPort: true,
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer-stub/index.html'),
        },
      },
    },
  },
})

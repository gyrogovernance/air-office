/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OFFICE_SERVICE_BASE?: string;
  readonly VITE_OFFICE_DEMO_SERVICE_BASE?: string;
  /** Set by `bun run dev:demo` so the UI treats this Vite session as Demo. */
  readonly VITE_OFFICE_DEMO_MODE?: string;
  /** Dev walkthrough only: fake macOS traffic lights in the browser shell. */
  readonly VITE_MOCK_MACOS_CHROME?: string;
  /** Distinct GitHub Pages static-demo build only (`build:web:static-demo`). */
  readonly VITE_STATIC_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css' {
  const content: string;
  export default content;
}

declare module '*.css?inline' {
  const content: string;
  export default content;
}
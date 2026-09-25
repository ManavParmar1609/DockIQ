/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API origin in production, e.g. https://dockiq-api.onrender.com. Unset in dev (Vite proxies). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

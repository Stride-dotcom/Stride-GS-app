/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // Stride API — baked in at build time so auth works on any browser
  // without requiring the user to configure Settings → Integrations first.
  readonly VITE_API_URL?: string;
  readonly VITE_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected by vite.config.ts via `define`. Values are baked into the bundle
// at build time so the running app can compare its own version against
// /version.json polled from the server.
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

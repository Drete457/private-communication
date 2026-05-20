/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNALING_SERVER_URL: string;
  readonly VITE_STUN_SERVER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

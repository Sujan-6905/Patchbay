/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the deployed signaling server, e.g. https://patchbay-api.onrender.com.
   * Unset for same-origin setups (local dev, or a server that also serves the client). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="vite-plugin-pwa/info" />
/// <reference types="vite-plugin-pwa/vanillajs" />

declare global {
  interface Window {
    confetti: typeof import('canvas-confetti').default;
  }
}

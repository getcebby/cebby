// Astro's Vite config compiles .astro files, so component tests can render them with the
// Container API. configFile: false leaves out astro.config.mjs and its integrations (the
// Cloudflare adapter's platform proxy, the PWA plugin), which component tests don't need.
import { getViteConfig } from 'astro/config';

export default getViteConfig({}, { configFile: false });

import { staticDemoBuild } from './static-demo.flag';

/** Resolve a public asset path for product (`/…`) or static-demo relative base. */
export function publicAsset(path: string): string {
  const clean = path.replace(/^\//, '');
  if (!staticDemoBuild()) return `/${clean}`;
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${clean}`;
}

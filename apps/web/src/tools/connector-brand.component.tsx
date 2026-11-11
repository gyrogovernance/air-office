import {
  siAirtable, siAtlassian, siCaldotcom, siCloudflare, siLinear, siNotion,
  siPaypal, siPerplexity, siPosthog, siResend, siSentry, siShopify,
  siStripe, siSupabase, siTrello, siWebflow, siZapier, type SimpleIcon,
} from 'simple-icons';

const CONNECTOR_BRANDS: Readonly<Record<string, SimpleIcon>> = {
  airtable: siAirtable, atlassian: siAtlassian, calcom: siCaldotcom,
  cloudflare: siCloudflare, linear: siLinear, notion: siNotion,
  paypal: siPaypal, perplexity: siPerplexity, posthog: siPosthog,
  resend: siResend, sentry: siSentry, 'shopify-dev': siShopify,
  stripe: siStripe, supabase: siSupabase, trello: siTrello,
  webflow: siWebflow, zapier: siZapier,
};
const FALLBACK_MARKS: Readonly<Record<string, string>> = { granola: 'G', firecrawl: 'fc' };

export function ConnectorBrand({ id, name }: { id: string; name: string }) {
  // Exa mark from theSVG, MIT: https://thesvg.org/icon/exa
  if (id === 'exa') return <svg className="connector-brand" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path fill="currentColor" fillRule="evenodd" d="M3 0h19v1.791L13.892 12 22 22.209V24H3V0zm9.62 10.348l6.589-8.557H6.03l6.59 8.557zM5.138 3.935v7.17h5.52l-5.52-7.17zm5.52 8.96h-5.52v7.17l5.52-7.17zM6.03 22.21l6.59-8.557 6.589 8.557H6.03z" /></svg>;
  if (id === 'atomicmail') return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>;
  const brand = CONNECTOR_BRANDS[id];
  return brand
    ? <svg className="connector-brand" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" data-brand={brand.slug}><path d={brand.path} fill="currentColor" /></svg>
    : <span className="connector-monogram" data-brand-fallback={id}>{FALLBACK_MARKS[id] ?? name.slice(0, 2)}</span>;
}

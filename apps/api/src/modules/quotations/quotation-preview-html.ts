/**
 * Minimal crawler document for a public quotation link: tenant company name
 * (or a neutral fallback), a fixed neutral description, type and canonical
 * URL only. Deliberately NO images of any kind — no og:image, no twitter
 * image, no JSON-LD logo, no CRM logo and no tenant logo — and no branding
 * beyond the company name itself. Unfurlers (WhatsApp) read the initial HTML
 * as-is without executing JavaScript.
 *
 * Privacy: only the company name (or the neutral fallback) and the already
 * public canonical URL are exposed. Lead names, traveller details, pricing
 * and internal notes never appear in Open Graph tags.
 */

export const PREVIEW_FALLBACK_SITE_NAME = 'Your Travel Quotation';
export const PREVIEW_DESCRIPTION = 'View your travel quotation.';

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

export type QuotationPreviewHtmlInput = {
  title: string;
  canonicalUrl: string;
  siteName?: string | undefined;
  description?: string | undefined;
};

export function buildQuotationPreviewHtml(input: QuotationPreviewHtmlInput): string {
  const title = escapeHtml(input.title);
  const url = escapeHtml(input.canonicalUrl);
  const siteName = escapeHtml(input.siteName ?? PREVIEW_FALLBACK_SITE_NAME);
  const description = escapeHtml(input.description ?? PREVIEW_DESCRIPTION);
  return [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    `<meta property="og:title" content="${siteName}">`,
    `<meta property="og:site_name" content="${siteName}">`,
    `<meta property="og:description" content="${description}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${url}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${siteName}">`,
    `<meta name="twitter:description" content="${description}">`,
    '</head><body></body></html>',
  ].join('');
}

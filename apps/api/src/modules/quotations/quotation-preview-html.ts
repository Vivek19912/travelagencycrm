/**
 * Minimal crawler document for a public quotation link: tenant company name,
 * company logo when publicly fetchable, type and canonical URL only.
 * Deliberately no description, no platform branding and no scripts —
 * unfurlers (WhatsApp) read the initial HTML as-is without executing JS.
 *
 * Privacy: only the company identity and the already-public canonical URL are
 * exposed. Lead names, traveller details, pricing and internal notes never
 * appear in Open Graph tags.
 *
 * This module is intentionally dependency-free so the HTML contract can be
 * unit-tested without a database.
 */

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

/** Social unfurlers only fetch absolute HTTPS images; anything else would render broken. */
export function asAbsoluteHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export type QuotationPreviewHtmlInput = {
  title: string;
  canonicalUrl: string;
  siteName?: string | undefined;
  imageUrl?: string | undefined;
  imageAlt?: string | undefined;
  imageMimeType?: string | undefined;
};

export function buildQuotationPreviewHtml(input: QuotationPreviewHtmlInput): string {
  const title = escapeHtml(input.title);
  const url = escapeHtml(input.canonicalUrl);
  const siteName = escapeHtml(input.siteName ?? input.title);
  const image = asAbsoluteHttpsUrl(input.imageUrl);
  const imageAlt = escapeHtml(input.imageAlt ?? input.siteName ?? input.title);
  const imageMime = input.imageMimeType ? escapeHtml(input.imageMimeType) : null;
  const parts = [
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    `<meta property="og:title" content="${siteName}">`,
    `<meta property="og:site_name" content="${siteName}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${url}">`,
  ];
  if (image) {
    const safeImage = escapeHtml(image);
    parts.push(`<meta property="og:image" content="${safeImage}">`);
    parts.push(`<meta property="og:image:alt" content="${imageAlt}">`);
    if (imageMime) parts.push(`<meta property="og:image:type" content="${imageMime}">`);
    parts.push('<meta name="twitter:card" content="summary_large_image">');
    parts.push(`<meta name="twitter:title" content="${siteName}">`);
  } else {
    parts.push('<meta name="twitter:card" content="summary">');
    parts.push(`<meta name="twitter:title" content="${siteName}">`);
  }
  parts.push('</head><body></body></html>');
  return parts.join('');
}

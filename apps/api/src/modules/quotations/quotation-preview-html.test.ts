import { describe, expect, it } from 'vitest';
import { buildQuotationPreviewHtml } from './quotation-preview-html.js';

const IMAGE_TOKENS = [
  'og:image',
  'og:image:secure_url',
  'og:image:type',
  'og:image:width',
  'og:image:height',
  'twitter:image',
  'twitter:image:src',
  'itemprop="image"',
  'image_src',
  'application/ld+json',
];

describe('quotation preview html (text-only, no DB)', () => {
  it('emits company name, neutral description and canonical URL without images', () => {
    const html = buildQuotationPreviewHtml({
      title: 'Canara Tales',
      canonicalUrl: 'https://quotation.canaratales.com/ganesh-v',
      siteName: 'Canara Tales',
    });
    expect(html).toContain('<meta property="og:title" content="Canara Tales">');
    expect(html).toContain('<meta property="og:site_name" content="Canara Tales">');
    expect(html).toContain(
      '<meta property="og:description" content="View your travel quotation.">',
    );
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain(
      '<meta property="og:url" content="https://quotation.canaratales.com/ganesh-v">',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    expect(html).toContain('<meta name="twitter:title" content="Canara Tales">');
    for (const token of IMAGE_TOKENS) expect(html).not.toContain(token);
    expect(html).not.toContain('Travel Agency CRM');
    expect(html).not.toContain('multi-tenant');
  });

  it('ignores branding beyond the company name: never emits image metadata', () => {
    const html = buildQuotationPreviewHtml({
      title: 'Enfield Travels',
      canonicalUrl: 'https://yourquotation.in/x',
      siteName: 'Enfield Travels',
      description: 'Custom description stays allowed.',
    });
    for (const token of IMAGE_TOKENS) expect(html).not.toContain(token);
    expect(html).toContain('content="Enfield Travels"');
  });

  it('falls back to neutral text when the company is unknown', () => {
    const html = buildQuotationPreviewHtml({
      title: 'x',
      canonicalUrl: 'https://yourquotation.in/x',
    });
    expect(html).toContain('<meta property="og:title" content="Your Travel Quotation">');
    expect(html).toContain(
      '<meta property="og:description" content="View your travel quotation.">',
    );
    expect(html).not.toContain('Travel Agency CRM');
  });

  it('escapes hostile company names and canonical URLs', () => {
    const html = buildQuotationPreviewHtml({
      title: 'S',
      canonicalUrl: 'https://yourquotation.in/x?a=1&b=2',
      siteName: 'Evil <script>alert(1)</script> Travels',
      description: 'Quote "special" <b>deal</b>',
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Evil &lt;script&gt;');
    expect(html).toContain('a=1&amp;b=2');
    expect(html).toContain('Quote &quot;special&quot; &lt;b&gt;deal&lt;/b&gt;');
  });
});

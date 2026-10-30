import { describe, expect, it } from 'vitest';
import { buildQuotationPreviewHtml } from './quotation-preview-html.js';

describe('quotation preview builder (unit, no DB)', () => {
  it('emits company branding with absolute https image and no CRM strings', () => {
    const html = buildQuotationPreviewHtml({
      title: 'Canara Tales – Aarav Mehta',
      canonicalUrl: 'https://quotation.canaratales.com/aarav-mehta',
      siteName: 'Canara Tales',
      imageUrl: 'https://cdn.test/logos/canara-tales.png?sig=abc',
      imageAlt: 'Canara Tales',
      imageMimeType: 'image/png',
    });
    expect(html).toContain('<meta property="og:title" content="Canara Tales">');
    expect(html).toContain('<meta property="og:site_name" content="Canara Tales">');
    expect(html).toContain(
      '<meta property="og:image" content="https://cdn.test/logos/canara-tales.png?sig=abc">',
    );
    expect(html).toContain('<meta property="og:image:alt" content="Canara Tales">');
    expect(html).toContain('<meta property="og:image:type" content="image/png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('content="https://quotation.canaratales.com/aarav-mehta"');
    expect(html).not.toContain('Travel Agency CRM');
    expect(html).not.toContain('multi-tenant');
    expect(html).not.toContain('<script');
  });

  it('omits image tags when there is no logo and escapes hostile names', () => {
    const html = buildQuotationPreviewHtml({
      title: 'X',
      canonicalUrl: 'https://yourquotation.in/x',
      siteName: 'Evil <script>alert(1)</script> Travels',
    });
    expect(html).not.toContain('og:image');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Evil &lt;script&gt;');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it('rejects non-https image URLs', () => {
    const absolute = buildQuotationPreviewHtml({
      title: 'X',
      canonicalUrl: 'https://yourquotation.in/x',
      siteName: 'Local Dev',
      imageUrl: 'http://localhost:3000/logo.png',
    });
    expect(absolute).not.toContain('og:image');
    const relative = buildQuotationPreviewHtml({
      title: 'X',
      canonicalUrl: 'https://yourquotation.in/x',
      siteName: 'Local Dev',
      imageUrl: '/logo.png',
    });
    expect(relative).not.toContain('og:image');
  });

  it('keeps the canonical URL exactly and escapes it', () => {
    const html = buildQuotationPreviewHtml({
      title: 'T',
      canonicalUrl: 'https://yourquotation.in/a-b?x=1&y=2',
      siteName: 'S',
    });
    expect(html).toContain('content="https://yourquotation.in/a-b?x=1&amp;y=2"');
  });
});

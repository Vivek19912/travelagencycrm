import { describe, expect, it } from 'vitest';
import { stylishPdfDownloadFileName } from '../src/modules/quotations/quotations.service.js';

describe('Stylish PDF download filename', () => {
  it('uses the customer name with spaces plus Package.pdf', () => {
    expect(stylishPdfDownloadFileName('Vikas Sahni')).toBe('Vikas Sahni Package.pdf');
    expect(stylishPdfDownloadFileName('Aarav Mehta')).toBe('Aarav Mehta Package.pdf');
  });

  it('drops quotation ids, versions and internal labels', () => {
    const name = stylishPdfDownloadFileName('Vikas Sahni');
    expect(name).toBe('Vikas Sahni Package.pdf');
    expect(name).not.toContain('stylish');
    expect(name).not.toContain('quotation');
    expect(name).not.toMatch(/QT-/i);
    expect(name).not.toMatch(/v\d+/);
  });

  it('strips invalid filesystem characters but keeps the readable name', () => {
    expect(stylishPdfDownloadFileName('A/B:C\\D*E?F"G<H>I|J')).toBe('ABCDEFGHIJ Package.pdf');
    expect(stylishPdfDownloadFileName('  Aarav   Mehta  ')).toBe('Aarav Mehta Package.pdf');
    expect(stylishPdfDownloadFileName('...')).toBe('Travel Package.pdf');
  });

  it('always ends in .pdf and falls back when the name is missing', () => {
    for (const missing of ['', null, undefined, '   ']) {
      const name = stylishPdfDownloadFileName(missing);
      expect(name).toBe('Travel Package.pdf');
      expect(name.endsWith('.pdf')).toBe(true);
    }
  });
});

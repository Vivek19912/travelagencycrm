import { describe, expect, it } from 'vitest';
import { sanitizeWeblinkPdfError } from './weblink-browser-pdf.service.js';

describe('weblink PDF error sanitizer (unit, no DB, no browser)', () => {
  it('redacts public tokens but keeps stage-relevant text', () => {
    const token = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8';
    const out = sanitizeWeblinkPdfError(
      new Error(`net::ERR_ABORTED at https://yourquotation.in/q/${token}?pdf=weblink`),
    );
    expect(out).not.toContain(token);
    expect(out).toContain('/q/[redacted]');
    expect(out).toContain('pdf=weblink');
  });

  it('keeps first-line diagnostics and truncates runaway messages', () => {
    const out = sanitizeWeblinkPdfError(new Error(`${'x'.repeat(5000)}\nsecond line`));
    expect(out).not.toContain('\n');
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it('handles non-Error failures without leaking internals', () => {
    expect(sanitizeWeblinkPdfError('plain string failure')).toBe('plain string failure');
    expect(sanitizeWeblinkPdfError(undefined)).toBe('undefined');
  });
});

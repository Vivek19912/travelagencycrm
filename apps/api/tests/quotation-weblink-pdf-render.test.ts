import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { fetchPublicToken } from './helpers/public-token.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { logger } from '../src/config/logger.js';

vi.mock('../src/modules/quotations/weblink-browser-pdf.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/quotations/weblink-browser-pdf.service.js')>();
  return {
    ...actual,
    renderWeblinkPdfFromUrl: vi.fn(async () => Buffer.from('%PDF-1.4\n%mock weblink\n')),
  };
});

import { renderWeblinkPdfFromUrl } from '../src/modules/quotations/weblink-browser-pdf.service.js';

const mockedRender = vi.mocked(renderWeblinkPdfFromUrl);

let app: Express;
let db: PrismaClient;

beforeAll(async () => {
  db = createTestPrismaClient();
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

afterAll(async () => {
  await db.$disconnect();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await truncateAll(db);
  getMemoryEmailProvider()?.clear();
  vi.clearAllMocks();
  mockedRender.mockResolvedValue(Buffer.from('%PDF-1.4\n%mock weblink\n'));
});

async function owner(email = 'owner@weblinkpdf.test') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email }));
  const emailed = getMemoryEmailProvider();
  await client.post('/api/auth/verify-email', { otp: emailed?.lastOtp(email) });
  return client;
}

const leadPayload = (overrides: Record<string, unknown> = {}) => ({
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  email: 'aarav.weblink@example.test',
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'QUALIFIED',
  priority: 'HIGH',
  travelStartDate: '2026-09-10',
  travelEndDate: '2026-09-14',
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  currency: 'INR',
  services: ['HOTEL'],
  itinerary: [
    { country: 'India', destination: 'Goa', nights: 2, sequence: 1 },
    { country: 'India', destination: 'Hampi', nights: 1, sequence: 2 },
    { country: 'India', destination: 'Coorg', nights: 1, sequence: 3 },
  ],
  ...overrides,
});

async function finalizedQuotationWithSlots(client: ReturnType<typeof createAuthClient>) {
  const lead = (await client.post('/api/queries', leadPayload())).body.data;
  const quotation = (
    await client.post('/api/quotations', { queryId: lead.id })
  ).body.data;
  const version = quotation.versions[0];
  await client.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);
  await client.post(`/api/quotations/${quotation.id}/public-link`, {
    quotationVersionId: version.id,
  });
  const token = await fetchPublicToken(db, quotation.id);
  return { quotation, version, token };
}

async function latestQuotationPdf(quotationId: string) {
  const document = await db.quotationDocument.findFirst({
    where: { quotationId },
    orderBy: { createdAt: 'desc' },
  });
  expect(document).toBeTruthy();
  const { storageService } = await import('../src/services/storage/storage.service.js');
  const memory = storageService as unknown as { read(key: string): Buffer | undefined };
  const bytes = memory.read(document!.objectKey);
  expect(bytes).toBeTruthy();
  return { document: document!, bytes: bytes! };
}

describe('weblink PDF generation (renderer mocked; browser covered in CI)', () => {
  it('generates a weblink PDF through the real generate flow and stores it', async () => {
    const client = await owner();
    const { quotation, version, token } = await finalizedQuotationWithSlots(client);
    expect(token).toBeTruthy();

    const res = await client.post(
      `/api/quotations/${quotation.id}/versions/${version.id}/generate-pdf`,
      { force: true, style: 'WEBLINK' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.fileName).toMatch(/-quotation\.pdf$/);
    expect(res.body.data.fileName).not.toContain('stylish');
    expect(mockedRender).toHaveBeenCalledTimes(1);

    const { document, bytes } = await latestQuotationPdf(quotation.id);
    expect(document.documentType).toBe('QUOTATION_PDF');
    expect(document.quotationVersionId).toBe(version.id);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('uses the requested version, not a stale public version', async () => {
    const client = await owner();
    const { quotation, version } = await finalizedQuotationWithSlots(client);
    await client.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);
    const res = await client.post(
      `/api/quotations/${quotation.id}/versions/${version.id}/generate-pdf`,
      { force: true, style: 'WEBLINK' },
    );
    expect(res.status).toBe(200);
    const { document } = await latestQuotationPdf(quotation.id);
    expect(document.quotationVersionId).toBe(version.id);
  });

  it('multi-day itinerary quotations flow through the weblink renderer', async () => {
    const client = await owner('owner@weblink-multi.test');
    const { quotation, version } = await finalizedQuotationWithSlots(client);
    const res = await client.post(
      `/api/quotations/${quotation.id}/versions/${version.id}/generate-pdf`,
      { force: true, style: 'WEBLINK' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockedRender).toHaveBeenCalledTimes(1);
    const callUrl = mockedRender.mock.calls[0]?.[0]?.url as string;
    expect(callUrl).toContain('/q/');
    expect(callUrl).toContain('pdf=weblink');
  });

  it('surfaces a generic error without leaking the token when rendering fails', async () => {
    const client = await owner('owner@weblink-fail.test');
    const { quotation, version } = await finalizedQuotationWithSlots(client);
    const leakedToken = 'f'.repeat(40);
    mockedRender.mockRejectedValueOnce(
      new Error(`Weblink PDF browser could not start (net::ERR at /q/${leakedToken}?pdf=weblink)`),
    );
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = await client.post(
      `/api/quotations/${quotation.id}/versions/${version.id}/generate-pdf`,
      { force: true, style: 'WEBLINK' },
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(leakedToken);
    expect(JSON.stringify(res.body)).not.toContain('/q/');
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(logged?.style).toBe('WEBLINK');
    expect(String((logged as { reason?: unknown })?.reason ?? '')).not.toContain(leakedToken);
    errorSpy.mockRestore();
  });
});

describe('classic and stylish PDF generation still work', () => {
  it('generates a real classic PDF (PDFKit, no browser)', async () => {
    const client = await owner('owner@classic-still-works.test');
    const { quotation, version } = await finalizedQuotationWithSlots(client);
    const res = await client.post(
      `/api/quotations/${quotation.id}/versions/${version.id}/generate-pdf`,
      { force: true, style: 'CLASSIC' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { bytes } = await latestQuotationPdf(quotation.id);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('generates a real stylish PDF with destination cover (PDFKit, no browser)', async () => {
    const client = await owner('owner@stylish-still-works.test');
    const { quotation, version } = await finalizedQuotationWithSlots(client);
    const res = await client.post(
      `/api/quotations/${quotation.id}/versions/${version.id}/generate-pdf`,
      { force: true, style: 'STYLISH', coverSource: 'DESTINATION' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { bytes } = await latestQuotationPdf(quotation.id);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

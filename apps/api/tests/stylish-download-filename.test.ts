import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { resetSystemCompanyIdCache } from '../src/modules/masters/master-visibility.js';

let app: Express;
let db: PrismaClient;

beforeAll(async () => {
  db = createTestPrismaClient();
  app = (await import('../src/app.js')).createApp();
});
afterAll(async () => db.$disconnect());
beforeEach(async () => {
  await truncateAll(db);
  getMemoryEmailProvider()?.clear();
  resetSystemCompanyIdCache();
});

async function owner(email = 'owner@alpha.test', companyName = 'Alpha Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const leadPayload = (customerName: string, phone = '+91 98765 43210') => ({
  customerName,
  phone,
  email: 'guest@example.test',
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
  services: ['HOTEL', 'SIGHTSEEING'],
  itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
});

/** Memory-provider signed URLs carry `?filename=<enc>&disposition=…`. */
function signedFileName(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get('filename') ?? '');
}

describe('Stylish PDF downloaded filename', () => {
  it('downloads a Stylish PDF as "{Customer Name} Package.pdf"', async () => {
    const client = await owner();
    const lead = (await client.post('/api/queries', leadPayload('Vikas Sahni'))).body.data;
    const quotation = (await client.post('/api/quotations', { queryId: lead.id })).body.data;
    const versionId = quotation.versions[0].id;
    const generated = await client.post(
      `/api/quotations/${quotation.id}/versions/${versionId}/generate-pdf`,
      { force: true, style: 'STYLISH', coverSource: 'DESTINATION' },
    );
    expect(generated.status).toBe(200);
    const documentId = generated.body.data.id as string;
    // Stored names stay archival; only the download name is friendly.
    expect(generated.body.data.fileName).toMatch(/-stylish-quotation\.pdf$/);

    const attachment = await client.get(
      `/api/quotations/${quotation.id}/documents/${documentId}/download-url`,
    );
    expect(attachment.status).toBe(200);
    expect(signedFileName(attachment.body.data.url)).toBe('Vikas Sahni Package.pdf');

    // Re-downloading the existing file (inline preview included) uses it too.
    const inline = await client.get(
      `/api/quotations/${quotation.id}/documents/${documentId}/download-url?disposition=inline`,
    );
    expect(inline.status).toBe(200);
    expect(signedFileName(inline.body.data.url)).toBe('Vikas Sahni Package.pdf');
  });

  it('leaves Classic PDF download filenames untouched', async () => {
    const client = await owner('owner2@alpha.test');
    const lead = (await client.post('/api/queries', leadPayload('Vikas Sahni'))).body.data;
    const quotation = (await client.post('/api/quotations', { queryId: lead.id })).body.data;
    const versionId = quotation.versions[0].id;
    const generated = await client.post(
      `/api/quotations/${quotation.id}/versions/${versionId}/generate-pdf`,
      { force: true, style: 'CLASSIC' },
    );
    expect(generated.status).toBe(200);
    const download = await client.get(
      `/api/quotations/${quotation.id}/documents/${generated.body.data.id}/download-url`,
    );
    expect(download.status).toBe(200);
    const fileName = signedFileName(download.body.data.url);
    expect(fileName).toMatch(/-quotation\.pdf$/);
    expect(fileName).not.toContain('Package');
  });
});

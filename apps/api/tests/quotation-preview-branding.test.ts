import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { fetchPublicToken } from './helpers/public-token.js';
import { createAuthClient } from './helpers/auth-client.js';
import { createCompanyFixture } from './helpers/fixtures.js';
import { storageService } from '../src/services/storage/storage.service.js';

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
  vi.restoreAllMocks();
});

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
  'cdn.test',
  'memory://',
];

function expectTextOnlyPreview(res: { status: number; text: string }, companyName: string) {
  expect(res.status).toBe(200);
  expect(res.text).toContain(`<meta property="og:title" content="${companyName}">`);
  expect(res.text).toContain(`<meta property="og:site_name" content="${companyName}">`);
  expect(res.text).toContain(
    '<meta property="og:description" content="View your travel quotation.">',
  );
  for (const token of IMAGE_TOKENS) expect(res.text).not.toContain(token);
  expect(res.text).not.toContain('Travel Agency CRM');
  expect(res.text).not.toContain('multi-tenant');
}

const leadPayload = (customerName: string) => ({
  customerName,
  phone: '+91 98765 43210',
  email: `${customerName.toLowerCase().replace(/[^a-z]/g, '')}@example.test`,
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
  itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
});

async function ownerWithCompany(slug: string) {
  const seeded = await createCompanyFixture(db, slug);
  const client = createAuthClient(app);
  await client.post('/api/auth/login', {
    email: `owner@${slug}.local`,
    password: 'Fixture@2026',
  });
  return { client, companyId: seeded.companyId, seeded };
}

async function createFinalizedQuotationWithSlug(
  client: ReturnType<typeof createAuthClient>,
  slug: string,
  customerName = 'Aarav Mehta',
) {
  const lead = (await client.post('/api/queries', leadPayload(customerName))).body.data;
  const quotation = (await client.post('/api/quotations', { queryId: lead.id })).body.data;
  const version = quotation.versions[0];
  await client.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);
  await client.post(`/api/quotations/${quotation.id}/public-link`, {
    quotationVersionId: version.id,
  });
  const token = await fetchPublicToken(db, quotation.id);
  await client.patch(`/api/quotations/${quotation.id}/weblink-name`, { publicSlug: slug });
  return { quotationId: quotation.id, token, slug };
}

async function brandCompany(companyId: string, name: string, withLogo = false) {
  await db.company.update({
    where: { id: companyId },
    data: {
      name,
      ...(withLogo
        ? {
            logoObjectKey: 'companies/logo-test.png',
            logoConfirmedAt: new Date(),
            logoMimeType: 'image/png',
          }
        : {}),
    },
  });
}

const WHATSAPP_UA = 'WhatsApp/2.31.5.70 A (iPhone; iOS 17.4; Scale/3.00)';

describe('text-only quotation previews (no images, no CRM branding)', () => {
  it('Canara-style tenant preview has company text and zero image metadata', async () => {
    const { client, companyId } = await ownerWithCompany('canara-text');
    await brandCompany(companyId, 'Canara Tales', true);
    await db.customDomain.create({
      data: { companyId, hostname: 'quotation.canaratales.test', status: 'ACTIVE' },
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'canara-text-slug-1');
    const spy = vi.spyOn(storageService, 'createDownloadUrl');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'quotation.canaratales.test');
    expectTextOnlyPreview(res, 'Canara Tales');
    expect(spy).not.toHaveBeenCalled();
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.headers['cache-control']).toMatch(/public/);
  });

  it('Travel-Enfield-style tenant preview is text-only with its own name', async () => {
    const { client, companyId } = await ownerWithCompany('enfield-text');
    await brandCompany(companyId, 'Travel Enfield', true);
    await db.customDomain.create({
      data: { companyId, hostname: 'quotation.enfield.test', status: 'ACTIVE' },
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'enfield-text-slug-1');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'quotation.enfield.test');
    expectTextOnlyPreview(res, 'Travel Enfield');
  });

  it('Trip-My-Buddy-style tenant preview is text-only with its own name', async () => {
    const { client, companyId } = await ownerWithCompany('tmb-text');
    await brandCompany(companyId, 'Trip My Buddy');
    const { slug } = await createFinalizedQuotationWithSlug(client, 'tmb-text-slug-1');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    expectTextOnlyPreview(res, 'Trip My Buddy');
  });

  it('tenants never cross: enfield host cannot preview other tenant slugs', async () => {
    const { companyId: companyA } = await ownerWithCompany('cross-a');
    const { client: clientB, companyId: companyB } = await ownerWithCompany('cross-b');
    await brandCompany(companyA, 'Cross Alpha');
    await brandCompany(companyB, 'Cross Beta');
    await db.customDomain.create({
      data: { companyId: companyA, hostname: 'quotation.crossa.test', status: 'ACTIVE' },
    });
    const { slug: slugB } = await createFinalizedQuotationWithSlug(clientB, 'cross-beta-slug-1');
    const cross = await request(app)
      .get(`/api/public/quotations/by-slug/${slugB}/preview`)
      .set('Host', 'quotation.crossa.test');
    expect(cross.status).toBe(404);
    expect(cross.text).not.toContain('Cross Beta');
    expect(cross.text).not.toContain('Cross Alpha');
  });

  it('custom-domain canonical URL uses the custom hostname', async () => {
    const { client, companyId } = await ownerWithCompany('canon-text');
    await brandCompany(companyId, 'Canon Travels');
    await db.customDomain.create({
      data: { companyId, hostname: 'quotation.canon.test', status: 'ACTIVE' },
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'canon-text-slug-1');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'quotation.canon.test');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`content="https://quotation.canon.test/${slug}"`);
    expectTextOnlyPreview(res, 'Canon Travels');
  });

  it('even a confirmed company logo in the database never reaches the preview', async () => {
    const { client, companyId } = await ownerWithCompany('logoignored');
    await brandCompany(companyId, 'Logo Ignored Travels', true);
    const { slug } = await createFinalizedQuotationWithSlug(client, 'logoignored-slug-1');
    const spy = vi.spyOn(storageService, 'createDownloadUrl');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    expectTextOnlyPreview(res, 'Logo Ignored Travels');
    expect(spy).not.toHaveBeenCalled();
  });

  it('invalid slug returns generic 404 without company details', async () => {
    const { companyId } = await ownerWithCompany('invalidslug2');
    await brandCompany(companyId, 'Secret Travels', true);
    await db.customDomain.create({
      data: { companyId, hostname: 'quotation.secret2.test', status: 'ACTIVE' },
    });
    const res = await request(app)
      .get('/api/public/quotations/by-slug/no-such-slug-xyz/preview')
      .set('Host', 'quotation.secret2.test');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Secret Travels');
  });

  it('deleted and revoked quotations are not exposed', async () => {
    const { client, companyId } = await ownerWithCompany('privatebrand2');
    await brandCompany(companyId, 'Private Travels');
    const { slug, quotationId } = await createFinalizedQuotationWithSlug(client, 'private-slug-2');
    await db.quotation.update({ where: { id: quotationId }, data: { deletedAt: new Date() } });
    const gone = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    expect(gone.status).toBe(404);
    expect(gone.text).not.toContain('Private Travels');

    const { client: client2, companyId: companyId2 } = await ownerWithCompany('revokebrand2');
    await brandCompany(companyId2, 'Revoked Travels');
    const revoked = await createFinalizedQuotationWithSlug(client2, 'revoked-slug-2');
    await client2.delete(`/api/quotations/${revoked.quotationId}/public-link`);
    const goneSlug = await request(app)
      .get(`/api/public/quotations/by-slug/revoked-slug-2/preview`)
      .set('Host', 'yourquotation.in');
    expect(goneSlug.status).toBe(404);
    const goneToken = await request(app)
      .get(`/api/public/quotations/${revoked.token}/preview`)
      .set('Host', 'yourquotation.in');
    expect(goneToken.status).toBe(404);
    expect(goneToken.text).not.toContain('Revoked Travels');
  });

  it('WhatsApp crawler user agent receives identical server-rendered HTML', async () => {
    const { client, companyId } = await ownerWithCompany('crawlerbrand2');
    await brandCompany(companyId, 'Crawler Travels', true);
    const { slug } = await createFinalizedQuotationWithSlug(client, 'crawler-slug-2');
    const asBot = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in')
      .set('User-Agent', WHATSAPP_UA);
    const asBrowser = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in')
      .set('User-Agent', 'Mozilla/5.0 Chrome/126.0');
    expect(asBot.status).toBe(200);
    expect(asBot.text).toBe(asBrowser.text);
    expect(asBot.text).toContain('content="Crawler Travels"');
    expect(asBot.headers['content-type']).toMatch(/html/);
  });

  it('token weblink preview carries tenant name on the platform base, no images', async () => {
    const { client, companyId } = await ownerWithCompany('tokenbrand2');
    await brandCompany(companyId, 'Token Travels', true);
    const { token } = await createFinalizedQuotationWithSlug(client, 'token-slug-unused-2');
    const res = await request(app)
      .get(`/api/public/quotations/${token}/preview`)
      .set('Host', 'app.travelagencycrm.in');
    expectTextOnlyPreview(res, 'Token Travels');
    for (const token2 of ['og:image']) expect(res.text).not.toContain(token2);
  });

  it('cache-busting query keeps working previews and short public cache', async () => {
    const { client, companyId } = await ownerWithCompany('cachebrand2');
    await brandCompany(companyId, 'Cache Travels');
    const { slug } = await createFinalizedQuotationWithSlug(client, 'cache-slug-2');
    const plain = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    const busted = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview?v=2`)
      .set('Host', 'yourquotation.in');
    expect(busted.status).toBe(200);
    expect(busted.text).toBe(plain.text);
    expect(busted.headers['cache-control']).toMatch(/public/);
    expectTextOnlyPreview(busted, 'Cache Travels');
  });

  it('browser JSON weblink path is unchanged and still serves company branding', async () => {
    const { client, companyId } = await ownerWithCompany('jsonbrand2');
    await brandCompany(companyId, 'Json Travels', true);
    const { slug } = await createFinalizedQuotationWithSlug(client, 'json-slug-2');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}`)
      .set('Host', 'yourquotation.in');
    expect(res.status).toBe(200);
    expect(res.body.data.quotation.quotationNumber).toBeDefined();
    expect(res.body.data.quotation.companyId).toBe(companyId);
    expect(res.body.data.company.name).toBe('Json Travels');
    expect(typeof res.body.data.company.logoUrl).toBe('string');
  });
});

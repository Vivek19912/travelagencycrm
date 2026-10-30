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

async function brandCompany(
  companyId: string,
  name: string,
  opts: { logoKey?: string; confirmed?: boolean; mimeType?: string } = {},
) {
  const hasLogo = Boolean(opts.logoKey);
  await db.company.update({
    where: { id: companyId },
    data: {
      name,
      logoObjectKey: opts.logoKey ?? null,
      logoConfirmedAt: (opts.confirmed ?? hasLogo) ? new Date() : null,
      logoMimeType: opts.mimeType ?? null,
    },
  });
}

const WHATSAPP_UA = 'WhatsApp/2.31.5.70 A (iPhone; iOS 17.4; Scale/3.00)';

describe('tenant-specific quotation preview branding (integration)', () => {
  it('Canara-style tenant receives its own name and logo, never platform branding', async () => {
    const { client, companyId } = await ownerWithCompany('canara-brand');
    await brandCompany(companyId, 'Canara Tales', {
      logoKey: 'companies/logo-canara.png',
      confirmed: true,
      mimeType: 'image/png',
    });
    await db.customDomain.create({
      data: { companyId, hostname: 'quotation.canaratales.test', status: 'ACTIVE' },
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'canara-slug-1', 'Vikas Singh');
    vi.spyOn(storageService, 'createDownloadUrl').mockResolvedValue(
      'https://cdn.test/logos/canara-tales.png',
    );

    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'quotation.canaratales.test');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('<meta property="og:title" content="Canara Tales">');
    expect(res.text).toContain('<meta property="og:site_name" content="Canara Tales">');
    expect(res.text).toContain(
      '<meta property="og:image" content="https://cdn.test/logos/canara-tales.png">',
    );
    expect(res.text).toContain('<meta property="og:image:alt" content="Canara Tales">');
    expect(res.text).not.toContain('Travel Agency CRM');
    expect(res.text).not.toContain('Personalized Travel Quotation');
    expect(res.headers['cache-control']).toMatch(/public/);
  });

  it('Travel-Enfield-style tenant receives different branding; tenants never cross', async () => {
    const { client: clientA, companyId: companyA } = await ownerWithCompany('enfield-brand');
    const { client: clientB, companyId: companyB } = await ownerWithCompany('other-brand');
    await brandCompany(companyA, 'Travel Enfield', {
      logoKey: 'companies/logo-enfield.png',
      confirmed: true,
    });
    await brandCompany(companyB, 'Other Travels', {
      logoKey: 'companies/logo-other.png',
      confirmed: true,
    });
    await db.customDomain.create({
      data: { companyId: companyA, hostname: 'quotation.enfield.test', status: 'ACTIVE' },
    });
    await db.customDomain.create({
      data: { companyId: companyB, hostname: 'quotation.other.test', status: 'ACTIVE' },
    });
    const { slug: slugA } = await createFinalizedQuotationWithSlug(clientA, 'enfield-slug-1');
    const { slug: slugB } = await createFinalizedQuotationWithSlug(clientB, 'other-slug-1');
    const spy = vi.spyOn(storageService, 'createDownloadUrl');
    const logoFor = async (key: string) => `https://cdn.test/${encodeURIComponent(key)}`;
    spy.mockImplementation(logoFor as unknown as typeof storageService.createDownloadUrl);

    const resA = await request(app)
      .get(`/api/public/quotations/by-slug/${slugA}/preview`)
      .set('Host', 'quotation.enfield.test');
    const resB = await request(app)
      .get(`/api/public/quotations/by-slug/${slugB}/preview`)
      .set('Host', 'quotation.other.test');
    expect(resA.text).toContain('content="Travel Enfield"');
    expect(resA.text).not.toContain('Other Travels');
    expect(resB.text).toContain('content="Other Travels"');
    expect(resB.text).not.toContain('Travel Enfield');
    expect(resA.text).not.toContain('logo-other');
    expect(resB.text).not.toContain('logo-enfield');

    const cross = await request(app)
      .get(`/api/public/quotations/by-slug/${slugB}/preview`)
      .set('Host', 'quotation.enfield.test');
    expect(cross.status).toBe(404);
  });

  it('custom-domain canonical URL uses the custom hostname', async () => {
    const { client, companyId } = await ownerWithCompany('canon-brand');
    await brandCompany(companyId, 'Canon Travels');
    await db.customDomain.create({
      data: { companyId, hostname: 'quotation.canon.test', status: 'ACTIVE' },
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'canon-slug-1');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'quotation.canon.test');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`content="https://quotation.canon.test/${slug}"`);
  });

  it('missing logo yields name-only metadata with no image tag', async () => {
    const { client, companyId } = await ownerWithCompany('nologo-brand');
    await brandCompany(companyId, 'No Logo Travels');
    const { slug } = await createFinalizedQuotationWithSlug(client, 'nologo-slug-1');
    const spy = vi.spyOn(storageService, 'createDownloadUrl');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    expect(res.status).toBe(200);
    expect(res.text).toContain('content="No Logo Travels"');
    expect(res.text).not.toContain('og:image');
    expect(spy).not.toHaveBeenCalled();
    expect(res.text).not.toContain('Travel Agency CRM');
  });

  it('unconfirmed logo is treated as missing', async () => {
    const { client, companyId } = await ownerWithCompany('unconfirmed-brand');
    await db.company.update({
      where: { id: companyId },
      data: {
        name: 'Unconfirmed Travels',
        logoObjectKey: 'companies/logo-pending.png',
        logoConfirmedAt: null,
      },
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'unconfirmed-slug-1');
    const spy = vi.spyOn(storageService, 'createDownloadUrl');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('og:image');
    expect(spy).not.toHaveBeenCalled();
  });

  it('storage failure degrades to name-only metadata without breaking', async () => {
    const { client, companyId } = await ownerWithCompany('failbrand');
    await brandCompany(companyId, 'Flaky Logo Travels', {
      logoKey: 'companies/logo-flaky.png',
      confirmed: true,
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'failbrand-slug-1');
    vi.spyOn(storageService, 'createDownloadUrl').mockRejectedValue(new Error('S3 down'));
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    expect(res.status).toBe(200);
    expect(res.text).toContain('content="Flaky Logo Travels"');
    expect(res.text).not.toContain('og:image');
  });

  it('non-https storage URLs are never emitted', async () => {
    const { client, companyId } = await ownerWithCompany('memorybrand');
    await brandCompany(companyId, 'Memory Logo Travels', {
      logoKey: 'companies/logo-mem.png',
      confirmed: true,
    });
    await storageService.putObject({
      key: 'companies/logo-mem.png',
      body: Buffer.from('fake-png'),
      contentType: 'image/png',
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'memory-slug-1');
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    expect(res.status).toBe(200);
    expect(res.text).toContain('content="Memory Logo Travels"');
    expect(res.text).not.toContain('og:image');
    expect(res.text).not.toContain('memory://');
  });

  it('invalid slug returns generic 404 without company details', async () => {
    const { companyId } = await ownerWithCompany('invalidslug');
    await brandCompany(companyId, 'Secret Travels', {
      logoKey: 'companies/logo-secret.png',
      confirmed: true,
    });
    await db.customDomain.create({
      data: { companyId, hostname: 'quotation.secret.test', status: 'ACTIVE' },
    });
    const res = await request(app)
      .get('/api/public/quotations/by-slug/no-such-slug-xyz/preview')
      .set('Host', 'quotation.secret.test');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('Secret Travels');
  });

  it('deleted and revoked quotations are not exposed', async () => {
    const { client, companyId } = await ownerWithCompany('privatebrand');
    await brandCompany(companyId, 'Private Travels');
    const { slug, quotationId } = await createFinalizedQuotationWithSlug(
      client,
      'private-slug-1',
    );
    await db.quotation.update({ where: { id: quotationId }, data: { deletedAt: new Date() } });
    const gone = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    expect(gone.status).toBe(404);
    expect(gone.text).not.toContain('Private Travels');

    const { client: client2, companyId: companyId2 } = await ownerWithCompany('revokebrand');
    await brandCompany(companyId2, 'Revoked Travels');
    const revoked = await createFinalizedQuotationWithSlug(client2, 'revoked-slug-1');
    await client2.delete(`/api/quotations/${revoked.quotationId}/public-link`);
    const goneSlug = await request(app)
      .get(`/api/public/quotations/by-slug/revoked-slug-1/preview`)
      .set('Host', 'yourquotation.in');
    expect(goneSlug.status).toBe(404);
    const goneToken = await request(app)
      .get(`/api/public/quotations/${revoked.token}/preview`)
      .set('Host', 'yourquotation.in');
    expect(goneToken.status).toBe(404);
    expect(goneToken.text).not.toContain('Revoked Travels');
  });

  it('WhatsApp crawler user agent receives identical server-rendered HTML', async () => {
    const { client, companyId } = await ownerWithCompany('crawlerbrand');
    await brandCompany(companyId, 'Crawler Travels', {
      logoKey: 'companies/logo-crawl.png',
      confirmed: true,
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'crawler-slug-1');
    vi.spyOn(storageService, 'createDownloadUrl').mockResolvedValue(
      'https://cdn.test/logos/crawl.png',
    );
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

  it('token weblink preview carries tenant branding on the platform base', async () => {
    const { client, companyId } = await ownerWithCompany('tokenbrand');
    await brandCompany(companyId, 'Token Travels', {
      logoKey: 'companies/logo-token.png',
      confirmed: true,
    });
    const { token } = await createFinalizedQuotationWithSlug(client, 'token-slug-unused');
    vi.spyOn(storageService, 'createDownloadUrl').mockResolvedValue(
      'https://cdn.test/logos/token.png',
    );
    const res = await request(app)
      .get(`/api/public/quotations/${token}/preview`)
      .set('Host', 'app.travelagencycrm.in');
    expect(res.status).toBe(200);
    expect(res.text).toContain('content="Token Travels"');
    expect(res.text).toContain('og:image');
    expect(res.text).not.toContain('Travel Agency CRM');
  });

  it('cache-busting query keeps working previews and short public cache', async () => {
    const { client, companyId } = await ownerWithCompany('cachebrand');
    await brandCompany(companyId, 'Cache Travels');
    const { slug } = await createFinalizedQuotationWithSlug(client, 'cache-slug-1');
    const plain = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview`)
      .set('Host', 'yourquotation.in');
    const busted = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}/preview?v=2`)
      .set('Host', 'yourquotation.in');
    expect(busted.status).toBe(200);
    expect(busted.text).toBe(plain.text);
    expect(busted.headers['cache-control']).toMatch(/public/);
    expect(busted.text).toContain('content="Cache Travels"');
  });

  it('browser JSON weblink path is unchanged', async () => {
    const { client, companyId } = await ownerWithCompany('jsonbrand');
    await brandCompany(companyId, 'Json Travels', {
      logoKey: 'companies/logo-json.png',
      confirmed: true,
    });
    const { slug } = await createFinalizedQuotationWithSlug(client, 'json-slug-1');
    vi.spyOn(storageService, 'createDownloadUrl').mockResolvedValue(
      'https://cdn.test/logos/json.png',
    );
    const res = await request(app)
      .get(`/api/public/quotations/by-slug/${slug}`)
      .set('Host', 'yourquotation.in');
    expect(res.status).toBe(200);
    expect(res.body.data.quotation.quotationNumber).toBeDefined();
    expect(res.body.data.quotation.companyId).toBe(companyId);
  });
});

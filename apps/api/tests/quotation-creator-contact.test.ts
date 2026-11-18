import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { fetchPublicToken } from './helpers/public-token.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';

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
});

/**
 * Public weblink Contact Us must show the QUOTATION CREATOR's contact
 * (Quotation.createdBy), never the company/owner contact when someone else
 * created the quotation. Missing creator contact stays null — it is never
 * backfilled from the company record.
 */

async function registerOwner(email = 'owner@creator.test') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const leadPayload = () => ({
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  email: 'aarav@example.test',
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'QUALIFIED',
  priority: 'HIGH',
  travelStartDate: '2026-12-05',
  travelEndDate: '2026-12-10',
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

async function createQuotationAs(client: ReturnType<typeof createAuthClient>) {
  const lead = await client.post('/api/queries', leadPayload());
  expect(lead.status, JSON.stringify(lead.body)).toBe(201);
  const quotation = (await client.post('/api/quotations', { queryId: lead.body.data.id })).body
    .data;
  const version = quotation.versions[0];
  await client.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);
  const link = await client.post(`/api/quotations/${quotation.id}/public-link`, {
    quotationVersionId: version.id,
  });
  expect(link.status, JSON.stringify(link.body)).toBe(200);
  const token = await fetchPublicToken(db, quotation.id);
  const view = await createAuthClient(app).get(`/api/public/quotations/${token}`);
  expect(view.status, JSON.stringify(view.body)).toBe(200);
  return { quotation, view: view.body.data };
}

async function createSalesperson(
  admin: ReturnType<typeof createAuthClient>,
  overrides: Record<string, unknown> = {},
) {
  const lookups = await admin.get('/api/users/lookups');
  const role = lookups.body.data.roles.find(
    (value: { name: string }) => value.name === 'Sales Executive',
  );
  const created = await admin.post('/api/users', {
    fullName: 'Sales Person A',
    username: 'sales-person-a',
    email: 'sales.a@creator.test',
    phone: '+91 91111 22222',
    roleId: role.id,
    permissionTemplateId: null,
    status: 'ACTIVE',
    temporaryPassword: 'Temporary@2026',
    confirmTemporaryPassword: 'Temporary@2026',
    mustChangePassword: false,
    ...overrides,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.data;
}

describe('public weblink shows the quotation creator contact', () => {
  it('owner-created quotation exposes the owner contact', async () => {
    const client = await registerOwner();
    const { view } = await createQuotationAs(client);
    expect(view.quotation.createdBy).toMatchObject({
      fullName: 'Priya Nair',
      phone: '+919876543210',
      email: 'owner@creator.test',
    });
  });

  it('salesperson-created quotation exposes the salesperson contact, not the company contact', async () => {
    const admin = await registerOwner();
    const sales = await createSalesperson(admin);
    // Quotation authored by the salesperson (createdById is the authoritative
    // authorship record; reassigned here to simulate authorship directly).
    const lead = await admin.post('/api/queries', leadPayload());
    const quotation = (await admin.post('/api/quotations', { queryId: lead.body.data.id })).body
      .data;
    await db.quotation.update({ where: { id: quotation.id }, data: { createdById: sales.id } });
    const version = quotation.versions[0];
    await admin.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);
    await admin.post(`/api/quotations/${quotation.id}/public-link`, {
      quotationVersionId: version.id,
    });
    const token = await fetchPublicToken(db, quotation.id);
    const view = await createAuthClient(app).get(`/api/public/quotations/${token}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.data.quotation.createdBy).toMatchObject({
      fullName: 'Sales Person A',
      phone: '+91 91111 22222',
      email: 'sales.a@creator.test',
    });
    // Company contact stays intact and distinct — never leaked into createdBy.
    expect(view.body.data.company.email).not.toBe('sales.a@creator.test');
  });

  it('missing creator phone stays null instead of falling back to the company contact', async () => {
    const admin = await registerOwner();
    const sales = await createSalesperson(admin);
    // Phone is optional on users while email is required: a null phone must
    // stay null on the public payload, never backfilled from the company.
    await db.user.update({
      where: { id: sales.id },
      data: { phone: null },
    });
    const lead = await admin.post('/api/queries', leadPayload());
    const quotation = (await admin.post('/api/quotations', { queryId: lead.body.data.id })).body
      .data;
    await db.quotation.update({ where: { id: quotation.id }, data: { createdById: sales.id } });
    const version = quotation.versions[0];
    await admin.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);
    await admin.post(`/api/quotations/${quotation.id}/public-link`, {
      quotationVersionId: version.id,
    });
    const token = await fetchPublicToken(db, quotation.id);
    const view = await createAuthClient(app).get(`/api/public/quotations/${token}`);
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    expect(view.body.data.quotation.createdBy).toMatchObject({
      fullName: 'Sales Person A',
      phone: null,
      email: 'sales.a@creator.test',
    });
  });
});

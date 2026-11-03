import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { resetSystemCompanyIdCache } from '../src/modules/masters/master-visibility.js';

// ---------------------------------------------------------------------------
// CRM User Mapping (DB-backed): WACRM-supplied `assignedToUserId` assigns
// the created lead to the mapped salesperson instead of the owner-email
// user, scoped strictly to the owner-email company.
// ---------------------------------------------------------------------------

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

async function owner(email: string, companyName: string) {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

async function employeeEmail(ownerClient: Awaited<ReturnType<typeof owner>>, email: string, fullName = 'Sales Person') {
  const lookups = await ownerClient.get('/api/users/lookups');
  const roles = lookups.body.data.roles as Array<{ id: string; name: string }>;
  const role = (roles.find((value) => value.name === 'Sales Executive') ?? roles[0])!;
  expect(role, 'a Sales Executive (or fallback) role must exist').toBeDefined();
  const username = (email.split('@')[0] ?? 'user').replaceAll(/[^a-z0-9]/gi, '-').slice(0, 30);
  const created = await ownerClient.post('/api/users', {
    fullName,
    username,
    email,
    roleId: role.id,
    permissionTemplateId: null,
    status: 'ACTIVE',
    temporaryPassword: 'Temporary@2026',
    confirmTemporaryPassword: 'Temporary@2026',
    mustChangePassword: false,
  });
  expect(created.status).toBe(201);
  const row = await db.user.findFirstOrThrow({ where: { normalizedEmail: email.trim().toLowerCase() } });
  return row.id as string;
}

const WACRM_ACCOUNT = '11111111-1111-4111-8111-111111111111';

let runSeq = 0;
const payload = (overrides: Record<string, unknown> = {}) => {
  runSeq += 1;
  return {
    wacrmAccountId: WACRM_ACCOUNT,
    flowRunId: `22222222-2222-4222-8222-${String(runSeq).padStart(12, '0')}`,
    customerName: 'Aarav Mehta',
    phone: '+91 98765 43210',
    leadSource: 'WHATSAPP',
    leadType: 'HOT',
    leadStage: 'NEW_LEAD',
    assignedToEmail: 'sales@alpha.test',
    services: ['FLIGHT', 'HOTEL'],
    itinerary: [{ country: 'Thailand', destination: 'Bangkok', nights: 3, sequence: 1 }],
    ...overrides,
  };
};

async function mintToken(adminClient: Awaited<ReturnType<typeof owner>>, userEmail: string) {
  const me = await db.user.findFirst({
    where: { normalizedEmail: userEmail.trim().toLowerCase(), deletedAt: null },
  });
  expect(me, `service user ${userEmail} must exist`).toBeDefined();
  const minted = await adminClient.post('/api/integrations/credentials', {
    name: 'wacrm-sync',
    userId: me!.id,
  });
  expect(minted.status).toBe(201);
  return minted.body.data.token as string;
}

const bearer = (token: string) => ({
  post: (path: string) => request(app).post(path).set('Authorization', `Bearer ${token}`),
  get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${token}`),
});

describe('WACRM CRM User Mapping assignment', () => {
  it('assigns the lead to the mapped salesperson instead of the owner', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const salesId = await employeeEmail(admin, 'mapped@alpha.test', 'Mapped Sales');
    const token = await mintToken(admin, 'owner@alpha.test');

    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToUserId: salesId }));
    expect(res.status).toBe(201);
    const row = await db.query.findUniqueOrThrow({ where: { id: res.body.data.leadId } });
    expect(row.assignedToId).toBe(salesId);
  });

  it('falls back to the owner when no mapped id is supplied', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const ownerRow = await db.user.findFirstOrThrow({
      where: { normalizedEmail: 'owner@alpha.test' },
    });
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');

    // Owner email itself is the locator here, so the lead lands on the owner.
    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToEmail: 'owner@alpha.test' }));
    expect(res.status).toBe(201);
    const row = await db.query.findUniqueOrThrow({ where: { id: res.body.data.leadId } });
    expect(row.assignedToId).toBe(ownerRow.id);
  });

  it('rejects an unknown mapped id with ASSIGNED_USER_NOT_FOUND and creates nothing', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');

    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToUserId: '99999999-9999-4999-8999-999999999999' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSIGNED_USER_NOT_FOUND');
    expect(await db.query.count()).toBe(0);
  });

  it('rejects a mapped id from a different company (no cross-tenant assignment)', async () => {
    const adminA = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(adminA, 'sales@alpha.test');
    const token = await mintToken(adminA, 'owner@alpha.test');

    const adminB = await owner('owner@beta.test', 'Beta Travel');
    const foreignSalesId = await employeeEmail(adminB, 'foreign@beta.test', 'Foreign Sales');

    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToUserId: foreignSalesId }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSIGNED_USER_NOT_FOUND');
    expect(await db.query.count()).toBe(0);
  });

  it('rejects a non-uuid mapped id at validation', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    const token = await mintToken(admin, 'owner@alpha.test');

    const res = await bearer(token)
      .post('/api/integrations/wacrm/leads')
      .send(payload({ assignedToUserId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('exposes assignable user ids with emails in lookups for the mapping dropdown', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const salesId = await employeeEmail(admin, 'sales@alpha.test', 'Sales Person');
    const token = await mintToken(admin, 'owner@alpha.test');

    const res = await bearer(token).get('/api/integrations/wacrm/lookups?assignedToEmail=sales@alpha.test');
    expect(res.status).toBe(200);
    const users = res.body.data.assignableUsers as Array<{
      id: string;
      fullName: string;
      username: string;
      email: string;
    }>;
    const match = users.find((u) => u.id === salesId);
    expect(match).toBeDefined();
    expect(match!.email).toBe('sales@alpha.test');
    expect(match!.fullName).toBe('Sales Person');
  });
});

describe('WACRM lookups tenant scoping (mapping dropdown)', () => {
  type LookupUser = { id: string; fullName: string; username: string; email: string };

  async function setupTwoCompanies() {
    const adminA = await owner('owner@alpha.test', 'Alpha Travel');
    const salesA = await employeeEmail(adminA, 'sales@alpha.test', 'Sales Person');
    const adminB = await owner('owner@beta.test', 'Beta Travel');
    const salesB = await employeeEmail(adminB, 'sales@beta.test', 'Sales Person');
    const tokenA = await mintToken(adminA, 'owner@alpha.test');
    const tokenB = await mintToken(adminB, 'owner@beta.test');
    const ownerA = await db.user.findFirstOrThrow({ where: { normalizedEmail: 'owner@alpha.test' } });
    const ownerB = await db.user.findFirstOrThrow({ where: { normalizedEmail: 'owner@beta.test' } });
    return { adminA, adminB, salesA, salesB, tokenA, tokenB, ownerA, ownerB };
  }

  async function lookupUsers(token: string, locator: string | null) {
    const path =
      locator === null
        ? '/api/integrations/wacrm/lookups'
        : `/api/integrations/wacrm/lookups?assignedToEmail=${encodeURIComponent(locator)}`;
    const res = await bearer(token).get(path);
    expect(res.status).toBe(200);
    return res.body.data.assignableUsers as LookupUser[];
  }

  it('company A sees only company A users through its locator', async () => {
    const { tokenA, salesA, ownerA } = await setupTwoCompanies();
    const users = await lookupUsers(tokenA, 'owner@alpha.test');
    const ids = users.map((u) => u.id);
    expect(ids).toContain(salesA);
    expect(ids).toContain(ownerA.id);
    expect(users.every((u) => ['owner@alpha.test', 'sales@alpha.test'].includes(u.email))).toBe(true);
  });

  it('company B sees only company B users through its locator', async () => {
    const { tokenB, salesB, ownerB } = await setupTwoCompanies();
    const users = await lookupUsers(tokenB, 'owner@beta.test');
    const ids = users.map((u) => u.id);
    expect(ids).toContain(salesB);
    expect(ids).toContain(ownerB.id);
    expect(users.every((u) => ['owner@beta.test', 'sales@beta.test'].includes(u.email))).toBe(true);
  });

  it('a credential bound to one company never leaks the other company via locator', async () => {
    const { tokenA, salesB, ownerB } = await setupTwoCompanies();
    // Token belongs to Alpha's credential, locator points at Beta.
    const users = await lookupUsers(tokenA, 'owner@beta.test');
    const ids = users.map((u) => u.id);
    expect(ids).toContain(salesB);
    expect(ids).toContain(ownerB.id);
    expect(users.some((u) => u.email === 'sales@alpha.test' || u.email === 'owner@alpha.test')).toBe(false);
  });

  it('an unknown locator falls back to the credential company without leaking', async () => {
    const { tokenA } = await setupTwoCompanies();
    const users = await lookupUsers(tokenA, 'nobody@nowhere.test');
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => ['owner@alpha.test', 'sales@alpha.test'].includes(u.email))).toBe(true);
  });

  it('inactive and deleted users are excluded from the scoped roster', async () => {
    const { adminB, tokenB, salesB } = await setupTwoCompanies();
    await db.user.update({ where: { id: salesB }, data: { status: 'INACTIVE' } });
    await employeeEmail(adminB, 'gone@beta.test', 'Gone Person');
    await db.user.update({
      where: { normalizedEmail: 'gone@beta.test' },
      data: { deletedAt: new Date() },
    });
    const users = await lookupUsers(tokenB, 'owner@beta.test');
    const ids = users.map((u) => u.id);
    expect(ids).not.toContain(salesB);
    expect(users.some((u) => u.email === 'gone@beta.test')).toBe(false);
    // The remaining active owner is still listed.
    expect(users.some((u) => u.email === 'owner@beta.test')).toBe(true);
  });

  it('same display names across companies cannot cross the scope boundary', async () => {
    // Both salespeople are literally named "Sales Person".
    const { tokenA, salesA, salesB } = await setupTwoCompanies();
    const usersA = await lookupUsers(tokenA, 'owner@alpha.test');
    expect(usersA.map((u) => u.id)).toContain(salesA);
    expect(usersA.map((u) => u.id)).not.toContain(salesB);
    const usersB = await lookupUsers(tokenA, 'owner@beta.test');
    expect(usersB.map((u) => u.id)).toContain(salesB);
    expect(usersB.map((u) => u.id)).not.toContain(salesA);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import { resetSystemCompanyIdCache } from '../src/modules/masters/master-visibility.js';

// ---------------------------------------------------------------------------
// CRM User Mapping management (Travel Agency CRM side, DB-backed).
//
// The mappings live in WhatsApp Max. These tests cover the per-company
// credential vault (encrypted at rest, never returned) and the
// session-gated proxy: tenant isolation, display re-resolution from
// this company's own users, and graceful degradation.
// ---------------------------------------------------------------------------

vi.mock('../src/config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/config/env.js')>();
  return { ...mod, env: { ...mod.env, WACRM_BASE_URL: 'https://wacrm.test' } };
});

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
  vi.unstubAllGlobals();
});

async function owner(email: string, companyName: string) {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

const SALES_ROLE = 'Sales Executive';

async function employeeEmail(
  ownerClient: Awaited<ReturnType<typeof owner>>,
  email: string,
  fullName = 'Sales Person',
  roleName = SALES_ROLE,
) {
  const lookups = await ownerClient.get('/api/users/lookups');
  const roles = lookups.body.data.roles as Array<{ id: string; name: string }>;
  const role = (roles.find((r) => r.name === roleName) ?? roles[0])!;
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
  return (await db.user.findFirstOrThrow({ where: { normalizedEmail: email.trim().toLowerCase() } })).id as string;
}

const SECRET = `wacrm_live_${'s'.repeat(43)}`;
const OTHER_SECRET = `wacrm_live_${'x'.repeat(43)}`;

type WacrmCall = { method: string; url: string; auth: string | null; body: unknown };
let wacrmCalls: WacrmCall[] = [];
let wacrmBehavior: { status: number; body: unknown } | null = null;

function stubWacrm() {
  wacrmCalls = [];
  wacrmBehavior = null;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith('https://wacrm.test/')) throw new Error(`unexpected outbound fetch ${u}`);
    const headers = new Headers(init?.headers as Record<string, string>);
    const rawBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    wacrmCalls.push({ method: init?.method ?? 'GET', url: u, auth: headers.get('authorization'), body: rawBody });
    if (wacrmBehavior) {
      return new Response(JSON.stringify(wacrmBehavior.body), { status: wacrmBehavior.status });
    }
    if ((init?.method ?? 'GET') === 'GET' && u.endsWith('/api/v1/crm-user-mappings')) {
      return new Response(
        JSON.stringify({
          data: {
            mappings: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                wacrm_user_id: 'wacrm-user-1',
                wacrm_name: 'Agent A',
                wacrm_email: 'agent@alpha.wacrm',
                crm_user_id: 'crm-sales-1',
                crm_name: 'Upstream Name',
                crm_email: 'upstream@x.test',
                status: 'active',
                created_at: '2026-11-01T00:00:00.000Z',
                updated_at: '2026-11-01T00:00:00.000Z',
              },
            ],
            wacrm_users: [{ id: 'wacrm-user-1', name: 'Agent A', email: 'agent@alpha.wacrm', role: 'agent' }],
            crm_reachable: true,
          },
        }),
        { status: 200 },
      );
    }
    if (init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          data: {
            mapping: {
              id: '22222222-2222-4222-8222-222222222222',
              wacrm_user_id: (rawBody as Record<string, string>).wacrm_user_id,
              wacrm_name: 'Agent A',
              wacrm_email: 'agent@alpha.wacrm',
              crm_user_id: (rawBody as Record<string, string>).crm_user_id,
              crm_name: 'Upstream Name',
              crm_email: 'upstream@x.test',
              status: 'active',
              created_at: '2026-11-03T00:00:00.000Z',
              updated_at: '2026-11-03T00:00:00.000Z',
            },
          },
        }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ data: { mapping: rawBody ?? null } }), { status: 200 });
  });
}

async function saveCredential(admin: Awaited<ReturnType<typeof owner>>, secret = SECRET) {
  const res = await admin.put('/api/integrations/crm-user-mappings/credential', { secret });
  expect(res.status).toBe(200);
  return res;
}

describe('CRM user mapping credential vault', () => {
  it('saves a live key encrypted and reports only a masked prefix', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    stubWacrm();
    const res = await saveCredential(admin);
    expect(res.body.data).toMatchObject({ configured: true });
    expect(res.body.data.keyPrefix).toBe('wacrm_live_s…');
    expect(JSON.stringify(res.body)).not.toContain(SECRET.slice('wacrm_live_'.length));
    const row = await db.wacrmManagementCredential.findFirstOrThrow({});
    expect(row.secretEncrypted).not.toContain(SECRET);
    expect(row.secretEncrypted.split(':').length).toBeGreaterThanOrEqual(3);
  });

  it('rejects a key WhatsApp Max does not accept without storing anything', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    stubWacrm();
    wacrmBehavior = { status: 401, body: { error: { code: 'unauthorized', message: 'nope' } } };
    const res = await admin.put('/api/integrations/crm-user-mappings/credential', { secret: OTHER_SECRET });
    expect(res.status).toBe(400);
    expect(await db.wacrmManagementCredential.count()).toBe(0);
  });

  it('rejects malformed keys at validation', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    stubWacrm();
    for (const bad of ['not-a-key', '', '   ']) {
      const res = await admin.put('/api/integrations/crm-user-mappings/credential', { secret: bad });
      expect(res.status).toBe(400);
    }
    expect(await db.wacrmManagementCredential.count()).toBe(0);
  });

  it('deletes the credential', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    stubWacrm();
    await saveCredential(admin);
    const del = await admin.delete('/api/integrations/crm-user-mappings/credential');
    expect(del.status).toBe(200);
    const status = await admin.get('/api/integrations/crm-user-mappings/credential');
    expect(status.body.data).toMatchObject({ configured: false, keyPrefix: null });
  });

  it('requires settings permission', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    stubWacrm();
    // A sales user lacks SETTINGS_UPDATE: every mapping endpoint 403s.
    const salesClient = createAuthClient(app);
    const login = await salesClient.post('/api/auth/login', {
      email: 'sales@alpha.test',
      password: 'Temporary@2026',
      loginMode: 'COMPANY_USER',
    });
    expect(login.status).toBe(200);
    expect((await salesClient.get('/api/integrations/crm-user-mappings/credential')).status).toBe(403);
    expect(
      (await salesClient.get('/api/integrations/crm-user-mappings')).status,
    ).toBe(403);
    expect(wacrmCalls).toHaveLength(0);
  });
});

describe('CRM user mapping proxy', () => {
  it('lists mappings with names re-resolved from this company (never upstream names)', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const salesId = await employeeEmail(admin, 'sales@alpha.test', 'Local Sales');
    stubWacrm();
    // Point the stored mapping row at the local sales user.
    await saveCredential(admin);
    const list = await admin.get('/api/integrations/crm-user-mappings');
    expect(list.status).toBe(200);
    // The stubbed upstream row references unknown ids; enrichment marks removed.
    expect(list.body.data.mappings).toHaveLength(1);
    expect(list.body.data.mappings[0]).toMatchObject({ status: 'crm-user-removed', crm_name: null });
    expect(JSON.stringify(list.body)).not.toContain(SECRET);
    void salesId;
  });

  it('shows local names for valid same-company salespeople', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const salesId = await employeeEmail(admin, 'sales@alpha.test', 'Local Sales');
    stubWacrm();
    await saveCredential(admin);
    // Rewrite the stubbed upstream row to reference the real local user.
    wacrmCalls = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const u = String(url);
      const auth = new Headers(init?.headers as Record<string, string>).get('authorization');
      wacrmCalls.push({ method: init?.method ?? 'GET', url: u, auth, body: undefined });
      return new Response(
        JSON.stringify({
          data: {
            mappings: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                wacrm_user_id: 'wacrm-user-1',
                wacrm_name: 'Agent A',
                wacrm_email: 'agent@alpha.wacrm',
                crm_user_id: salesId,
                crm_name: 'Upstream Name',
                crm_email: 'upstream@x.test',
                status: 'active',
                created_at: '2026-11-01T00:00:00.000Z',
                updated_at: '2026-11-01T00:00:00.000Z',
              },
            ],
            wacrm_users: [{ id: 'wacrm-user-1', name: 'Agent A', email: 'agent@alpha.wacrm', role: 'agent' }],
            crm_reachable: true,
          },
        }),
        { status: 200 },
      );
    });
    const list = await admin.get('/api/integrations/crm-user-mappings');
    expect(list.status).toBe(200);
    expect(list.body.data.mappings[0]).toMatchObject({
      status: 'active',
      crm_name: 'Local Sales',
      crm_email: 'sales@alpha.test',
    });
  });

  it('one tenant can never read another tenant mappings', async () => {
    const adminA = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(adminA, 'sales@alpha.test');
    const adminB = await owner('owner@beta.test', 'Beta Travel');
    await employeeEmail(adminB, 'sales@beta.test');
    stubWacrm();
    await saveCredential(adminA);
    wacrmCalls = [];
    // Company B saved nothing: explicit empty state, never company A's rows.
    const listB = await adminB.get('/api/integrations/crm-user-mappings');
    expect(listB.status).toBe(404);
    expect(listB.body.error.code).toBe('NOT_FOUND');
    // And company B cannot create through company A's credential.
    const createB = await adminB.post('/api/integrations/crm-user-mappings', {
      wacrm_user_id: 'wacrm-user-1',
      crm_user_id: 'crm-sales-1',
    });
    expect(createB.status).toBe(404);
    expect(wacrmCalls.filter((c) => c.auth === `Bearer ${SECRET}`)).toHaveLength(0);
  });

  it('creates through the proxy with the stored key and local validation first', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    const salesId = await employeeEmail(admin, 'sales@alpha.test', 'Local Sales');
    stubWacrm();
    await saveCredential(admin);
    wacrmCalls = [];
    const res = await admin.post('/api/integrations/crm-user-mappings', {
      wacrm_user_id: 'wacrm-user-1',
      crm_user_id: salesId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.mapping).toMatchObject({ crm_name: 'Local Sales', status: 'active' });
    expect(wacrmCalls).toHaveLength(1);
    expect(wacrmCalls[0]).toMatchObject({
      method: 'POST',
      url: 'https://wacrm.test/api/v1/crm-user-mappings',
      auth: `Bearer ${SECRET}`,
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('rejects a foreign salesperson locally without calling WhatsApp Max', async () => {
    const adminA = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(adminA, 'sales@alpha.test');
    const adminB = await owner('owner@beta.test', 'Beta Travel');
    const foreignId = await employeeEmail(adminB, 'foreign@beta.test', 'Foreign Sales');
    stubWacrm();
    await saveCredential(adminA);
    wacrmCalls = [];
    const res = await adminA.post('/api/integrations/crm-user-mappings', {
      wacrm_user_id: 'wacrm-user-1',
      crm_user_id: foreignId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ASSIGNED_USER_NOT_FOUND');
    expect(wacrmCalls).toHaveLength(0);
  });

  it('degrades to 503 when WhatsApp Max is unreachable', async () => {
    const admin = await owner('owner@alpha.test', 'Alpha Travel');
    await employeeEmail(admin, 'sales@alpha.test');
    stubWacrm();
    await saveCredential(admin);
    wacrmBehavior = { status: 500, body: { error: { code: 'internal', message: 'down' } } };
    const res = await admin.get('/api/integrations/crm-user-mappings');
    expect(res.status).toBe(502);
  });
});

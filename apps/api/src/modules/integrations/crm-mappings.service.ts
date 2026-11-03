import {
  crmMappingCreateSchema,
  crmMappingUpdateSchema,
  type CrmManagedMapping,
  type CrmMappingsOverview,
  type WacrmApiKeyInput,
  type WacrmCredentialStatus,
} from '@interscale/shared';
import type { AuthContext } from '../../middleware/authenticate.js';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { AppError, ValidationError } from '../../utils/errors.js';
import { ERROR_CODES } from '@interscale/shared';
import { decryptSensitiveValue, encryptSensitiveValue } from '../../utils/crypto.js';

/**
 * CRM User Mapping management (Travel Agency CRM side).
 *
 * The mappings live in WhatsApp Max. This service lets company
 * administrators manage them from Travel Agency CRM Settings →
 * Integrations without ever exposing either system's secret to the
 * browser:
 *
 *   - The WhatsApp Max API key (`wacrm_live_…`, `crm-mappings:manage`
 *     scope) is pasted once by an administrator and persisted only
 *     as an AES-256-GCM envelope (DATA_ENCRYPTION_KEY), mirroring
 *     the SMTP/bank-account pattern. Plaintext is never stored and
 *     never returned.
 *   - One credential row per company: the key inherently belongs to
 *     exactly one WhatsApp Max workspace, so tenant isolation holds
 *     without trusting any browser-supplied account identifier.
 *   - Every proxy call uses the session company's stored key; a
 *     company with no credential (or an unreachable WhatsApp Max)
 *     gets an explicit error, never another tenant's data.
 *
 * Display fields are re-resolved from this database (never trusted
 * from the upstream response): a salesperson id is shown with a name
 * only when it belongs to an ACTIVE, non-deleted user of the
 * session's company. Anything else renders as removed — so even a
 * stale upstream roster can never leak another tenant's users into
 * this company's UI.
 */

const PROXY_TIMEOUT_MS = 20_000;
const KEY_PREFIX_DISPLAY_CHARS = 12;

function wacrmBaseUrl(): string {
  const base = (env.WACRM_BASE_URL ?? '').replace(/\/+$/, '');
  if (!base) {
    throw new AppError(
      'WhatsApp Max is not connected. Set WACRM_BASE_URL on the server.',
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE,
    );
  }
  return base;
}

function requireDataKey(): string {
  if (!env.DATA_ENCRYPTION_KEY) {
    throw new AppError(
      'Credential encryption is not configured on the server.',
      503,
      ERROR_CODES.SERVICE_UNAVAILABLE,
    );
  }
  return env.DATA_ENCRYPTION_KEY;
}

function displayPrefix(secret: string): string {
  const body = secret.replace(/\s+/g, '');
  return body.slice(0, Math.min(body.length, KEY_PREFIX_DISPLAY_CHARS)) + '…';
}

async function loadPlaintextSecret(companyId: string): Promise<string> {
  const row = await prisma.wacrmManagementCredential.findUnique({
    where: { companyId },
    select: { secretEncrypted: true },
  });
  if (!row) {
    throw new AppError(
      'No WhatsApp Max API key is saved for this company. Paste one in Settings → Integrations first.',
      404,
      ERROR_CODES.NOT_FOUND,
    );
  }
  try {
    return decryptSensitiveValue(row.secretEncrypted, requireDataKey());
  } catch {
    throw new AppError(
      'The stored WhatsApp Max API key cannot be decrypted. Save it again.',
      500,
      ERROR_CODES.SERVICE_UNAVAILABLE,
    );
  }
}

interface WacrmEnvelope {
  data?: unknown;
  error?: { code?: unknown; message?: unknown };
}

async function readEnvelope(res: Response): Promise<WacrmEnvelope | null> {
  try {
    const json = (await res.json()) as WacrmEnvelope;
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

/**
 * Call a WhatsApp Max v1 mapping endpoint with the session company's
 * stored key. Success returns the `data` payload; upstream 4xx errors
 * surface with their status and machine code; transport failures and
 * upstream 5xx collapse to 502 — the secret itself never appears in
 * any error, log, or response.
 */
async function callWacrm(
  auth: AuthContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const secret = await loadPlaintextSecret(auth.companyId);
  const base = wacrmBaseUrl();
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  const hasBody = body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError(
      err instanceof Error && err.name === 'AbortError'
        ? 'WhatsApp Max request timed out.'
        : 'WhatsApp Max is unreachable.',
      502,
      ERROR_CODES.SERVICE_UNAVAILABLE,
    );
  }
  const envelope = await readEnvelope(res);
  if (res.ok) return envelope?.data ?? null;
  const code =
    typeof envelope?.error?.code === 'string' && envelope.error.code
      ? envelope.error.code
      : 'WACRM_ERROR';
  const message =
    typeof envelope?.error?.message === 'string' && envelope.error.message
      ? envelope.error.message
      : 'WhatsApp Max request failed.';
  if (res.status === 401 || res.status === 403) {
    // The stored key is rejected upstream (revoked in WhatsApp Max
    // or missing the scope): fail closed with a re-save hint, never
    // retry and never expose the key.
    throw new AppError(
      'WhatsApp Max rejected the saved API key. Mint a new key with the CRM-mappings scope and save it again.',
      502,
      ERROR_CODES.SERVICE_UNAVAILABLE,
    );
  }
  if (res.status >= 500) {
    throw new AppError('WhatsApp Max is unavailable.', 502, ERROR_CODES.SERVICE_UNAVAILABLE);
  }
  // Upstream 4xx: keep the human message, but report it under this
  // API's own machine codes (the v1 code namespace is WhatsApp Max's,
  // not ours) — the upstream code travels inside the message only.
  const mapped =
    res.status === 404
      ? ERROR_CODES.NOT_FOUND
      : res.status === 409
        ? ERROR_CODES.CONFLICT
        : ERROR_CODES.VALIDATION_ERROR;
  throw new AppError(`WhatsApp Max rejected the request (${code}): ${message}`, res.status, mapped);
}

interface WacrmMappingRow {
  id: string;
  wacrm_user_id: string;
  wacrm_name: string | null;
  wacrm_email: string | null;
  crm_user_id: string;
  crm_name: string | null;
  crm_email: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface WacrmOverview {
  mappings: WacrmMappingRow[];
  wacrm_users: Array<{ id: string; name: string; email: string | null; role: string | null }>;
  crm_reachable: boolean;
}

function isOverview(value: unknown): value is WacrmOverview {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.mappings) && Array.isArray(v.wacrm_users) && typeof v.crm_reachable === 'boolean';
}/**
 * Re-resolve every mapping's salesperson display from THIS company's
 * users. A name/email is shown only for an ACTIVE, non-deleted user
 * of the session's company; anything else renders as removed with no
 * name — the upstream response is never trusted for identity.
 */
async function enrichMappings(
  auth: AuthContext,
  rows: WacrmMappingRow[],
  wacrmUsers: WacrmOverview['wacrm_users'],
): Promise<CrmManagedMapping[]> {
  const wacrmIds = new Set(wacrmUsers.map((u) => u.id));
  const crmIds = [...new Set(rows.map((r) => r.crm_user_id))];
  const locals = await prisma.user.findMany({
    where: { id: { in: crmIds }, deletedAt: null },
    select: { id: true, fullName: true, email: true, status: true, companyId: true },
  });
  const byId = new Map(locals.map((u) => [u.id, u]));
  return rows.map((r) => {
    const local = byId.get(r.crm_user_id);
    const owned = !!local && local.companyId === auth.companyId && local.status === 'ACTIVE';
    let status: CrmManagedMapping['status'] = 'unknown';
    if (!wacrmIds.has(r.wacrm_user_id)) status = 'wacrm-user-removed';
    else if (!owned) status = 'crm-user-removed';
    else status = 'active';
    return {
      id: r.id,
      wacrm_user_id: r.wacrm_user_id,
      wacrm_name: r.wacrm_name,
      wacrm_email: r.wacrm_email,
      crm_user_id: r.crm_user_id,
      crm_name: owned ? local!.fullName : null,
      crm_email: owned ? local!.email : null,
      status,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
}

export const crmMappingsService = {
  async credentialStatus(auth: AuthContext): Promise<WacrmCredentialStatus> {
    const row = await prisma.wacrmManagementCredential.findUnique({
      where: { companyId: auth.companyId },
      select: { keyPrefix: true, updatedAt: true },
    });
    if (!row) return { configured: false, keyPrefix: null, updatedAt: null };
    return { configured: true, keyPrefix: row.keyPrefix, updatedAt: row.updatedAt.toISOString() };
  },

  async saveCredential(
    auth: AuthContext,
    input: WacrmApiKeyInput,
  ): Promise<WacrmCredentialStatus> {
    const secret = input.trim();
    // Defence in depth alongside the zod shape: only WhatsApp Max
    // API keys are acceptable here.
    if (!secret.startsWith('wacrm_live_') || secret.length < 20) {
      throw new ValidationError('That does not look like a WhatsApp Max API key.');
    }
    const key = requireDataKey();
    // Verify live before storing: the key must authenticate and carry
    // the mapping scope, otherwise fail closed without persisting.
    let probe: Response;
    try {
      probe = await fetch(`${wacrmBaseUrl()}/api/v1/crm-user-mappings`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AppError(
        err instanceof Error && err.name === 'AbortError'
          ? 'WhatsApp Max request timed out.'
          : 'WhatsApp Max is unreachable.',
        502,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
    if (probe.status === 401 || probe.status === 403) {
      throw new ValidationError(
        'WhatsApp Max rejected that key. Mint one with the CRM-mappings scope and try again.',
      );
    }
    if (!probe.ok) {
      throw new AppError('WhatsApp Max is unavailable.', 502, ERROR_CODES.SERVICE_UNAVAILABLE);
    }
    const row = await prisma.wacrmManagementCredential.upsert({
      where: { companyId: auth.companyId },
      create: {
        companyId: auth.companyId,
        secretEncrypted: encryptSensitiveValue(secret, key, env.DATA_ENCRYPTION_KEY_VERSION),
        keyVersion: env.DATA_ENCRYPTION_KEY_VERSION,
        keyPrefix: displayPrefix(secret),
        createdById: auth.userId,
      },
      update: {
        secretEncrypted: encryptSensitiveValue(secret, key, env.DATA_ENCRYPTION_KEY_VERSION),
        keyVersion: env.DATA_ENCRYPTION_KEY_VERSION,
        keyPrefix: displayPrefix(secret),
        createdById: auth.userId,
      },
      select: { keyPrefix: true, updatedAt: true },
    });
    return { configured: true, keyPrefix: row.keyPrefix, updatedAt: row.updatedAt.toISOString() };
  },

  async deleteCredential(auth: AuthContext): Promise<{ deleted: boolean }> {
    await prisma.wacrmManagementCredential.deleteMany({ where: { companyId: auth.companyId } });
    return { deleted: true };
  },

  async overview(auth: AuthContext): Promise<CrmMappingsOverview> {
    const data = await callWacrm(auth, 'GET', '/api/v1/crm-user-mappings');
    if (!isOverview(data)) {
      throw new AppError(
        'WhatsApp Max returned an unreadable mappings response.',
        502,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
    // The salesperson picker lists exactly this company's assignable
    // users — resolved here, never trusted from upstream.
    const assignable = await prisma.user.findMany({
      where: { companyId: auth.companyId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, fullName: true, email: true, username: true },
      orderBy: { fullName: 'asc' },
    });
    return {
      mappings: await enrichMappings(auth, data.mappings, data.wacrm_users),
      wacrm_users: data.wacrm_users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
      })),
      crm_users: assignable.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        username: u.username,
      })),
      crm_reachable: data.crm_reachable,
    };
  },

  async createMapping(
    auth: AuthContext,
    raw: unknown,
  ): Promise<CrmManagedMapping> {
    const input = crmMappingCreateSchema.parse(raw);
    // Fast local check first: the salesperson must be an ACTIVE user
    // of THIS company. WhatsApp Max re-validates via its live roster
    // as defence in depth (authoritative on write).
    const local = await prisma.user.findFirst({
      where: { id: input.crm_user_id, companyId: auth.companyId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, fullName: true, email: true },
    });
    if (!local) {
      throw new AppError(
        'That salesperson does not belong to this company.',
        400,
        ERROR_CODES.ASSIGNED_USER_NOT_FOUND,
      );
    }
    const created = (await callWacrm(auth, 'POST', '/api/v1/crm-user-mappings', input)) as {
      mapping: WacrmMappingRow;
    };
    if (!created || typeof created !== 'object' || !('mapping' in created)) {
      throw new AppError(
        'WhatsApp Max returned an unreadable mapping response.',
        502,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
    // Both sides were just validated (local ACTIVE check above,
    // membership + live-roster check in WhatsApp Max), so the new row
    // is active by construction; names come from our own user row.
    const m = created.mapping;
    return {
      id: m.id,
      wacrm_user_id: m.wacrm_user_id,
      wacrm_name: m.wacrm_name,
      wacrm_email: m.wacrm_email,
      crm_user_id: m.crm_user_id,
      crm_name: local.fullName,
      crm_email: local.email,
      status: 'active' as const,
      created_at: m.created_at,
      updated_at: m.updated_at,
    };
  },

  async updateMapping(auth: AuthContext, id: string, raw: unknown): Promise<CrmManagedMapping> {
    const input = crmMappingUpdateSchema.parse(raw);
    const local = await prisma.user.findFirst({
      where: { id: input.crm_user_id, companyId: auth.companyId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, fullName: true, email: true },
    });
    if (!local) {
      throw new AppError(
        'That salesperson does not belong to this company.',
        400,
        ERROR_CODES.ASSIGNED_USER_NOT_FOUND,
      );
    }
    const updated = (await callWacrm(
      auth,
      'PATCH',
      `/api/v1/crm-user-mappings/${encodeURIComponent(id)}`,
      input,
    )) as { mapping: WacrmMappingRow };
    if (!updated || typeof updated !== 'object' || !('mapping' in updated)) {
      throw new AppError(
        'WhatsApp Max returned an unreadable mapping response.',
        502,
        ERROR_CODES.SERVICE_UNAVAILABLE,
      );
    }
    const m = updated.mapping;
    return {
      id: m.id,
      wacrm_user_id: m.wacrm_user_id,
      wacrm_name: m.wacrm_name,
      wacrm_email: m.wacrm_email,
      crm_user_id: m.crm_user_id,
      crm_name: local.fullName,
      crm_email: local.email,
      status: 'active',
      created_at: m.created_at,
      updated_at: m.updated_at,
    };
  },

  async deleteMapping(auth: AuthContext, id: string): Promise<{ deleted: boolean }> {
    await callWacrm(auth, 'DELETE', `/api/v1/crm-user-mappings/${encodeURIComponent(id)}`);
    return { deleted: true };
  },
};

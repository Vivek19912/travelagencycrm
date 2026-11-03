import { z } from 'zod';

/**
 * CRM User Mapping management (Travel Agency CRM side).
 *
 * The mappings themselves live in WhatsApp Max (`crm_user_mappings`,
 * keyed by internal ids on both sides). Travel Agency CRM manages
 * them through its backend, which proxies to WhatsApp Max's
 * versioned machine-to-machine API (`/api/v1/crm-user-mappings`,
 * `crm-mappings:manage` API key). The browser never sees either
 * system's secret: the WhatsApp Max API key is pasted once by an
 * administrator, stored encrypted server-side, and only ever used
 * from server code.
 *
 * Tenant isolation: the stored key belongs to exactly one WhatsApp
 * Max workspace, and credential rows are keyed per company — one
 * tenant can never read or modify another tenant's mappings.
 */

export const wacrmApiKeySchema = z
  .string()
  .trim()
  .min(1, 'Paste the WhatsApp Max API key.')
  .max(200)
  .refine((v) => v.startsWith('wacrm_live_'), {
    message: 'That does not look like a WhatsApp Max API key (expected wacrm_live_…).',
  });

export type WacrmApiKeyInput = z.infer<typeof wacrmApiKeySchema>;

export interface WacrmCredentialStatus {
  /** True when a usable credential is stored for this company. */
  configured: boolean;
  /** Non-secret display prefix of the stored key (e.g. wacrm_live_ab12…). */
  keyPrefix: string | null;
  updatedAt: string | null;
}

export type CrmMappingStatus =
  | 'active'
  | 'crm-user-removed'
  | 'wacrm-user-removed'
  | 'unknown';

export interface CrmManagedMapping {
  id: string;
  wacrm_user_id: string;
  wacrm_name: string | null;
  wacrm_email: string | null;
  crm_user_id: string;
  crm_name: string | null;
  crm_email: string | null;
  status: CrmMappingStatus;
  created_at: string;
  updated_at: string;
}

export interface CrmManagedWacrmUser {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
}

export interface CrmManagedSalesperson {
  id: string;
  fullName: string;
  email: string;
  username: string;
}

export interface CrmMappingsOverview {
  mappings: CrmManagedMapping[];
  wacrm_users: CrmManagedWacrmUser[];
  /** Assignable salespeople in THIS company (ACTIVE, non-deleted). */
  crm_users: CrmManagedSalesperson[];
  crm_reachable: boolean;
}

export const crmMappingCreateSchema = z.object({
  wacrm_user_id: z.string().trim().min(1).max(128),
  crm_user_id: z.string().trim().min(1).max(64),
});

export type CrmMappingCreateInput = z.infer<typeof crmMappingCreateSchema>;

export const crmMappingUpdateSchema = z.object({
  crm_user_id: z.string().trim().min(1).max(64),
});

export type CrmMappingUpdateInput = z.infer<typeof crmMappingUpdateSchema>;

export const crmMappingIdParamsSchema = z.object({
  id: z.string().trim().uuid(),
});

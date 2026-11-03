import { z } from 'zod';

import {
  assertTravelMonthYearPair,
  LEAD_STAGES,
  LEAD_SOURCES,
  LEAD_TYPES,
  SERVICE_TYPES,
} from './queries.js';

/**
 * WACRM server-to-server lead-creation contract.
 *
 * Mirrors the audited Travel CRM lead form (`queryInputSchema`) but
 * scoped to what an external integration may supply: no customer
 * linking, no follow-ups, no financials. Enum values are the exact
 * Travel CRM enums — WACRM must fetch them from the integration
 * lookups endpoint, never hardcode them. Itinerary rows carry an
 * explicit `sequence` (unique per lead), matching the core schema.
 */

export const WACRM_INTEGRATION_TYPE = 'wacrm' as const;

export const wacrmItineraryRowSchema = z.object({
  country: z.string().trim().min(1).max(80),
  destination: z.string().trim().min(1).max(120),
  nights: z.coerce.number().int().min(0).max(365),
  sequence: z.coerce.number().int().min(1).max(100),
});

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalDate = z.coerce.date().nullable().optional();

export const wacrmLeadPayloadSchema = z
  .object({
    /** Opaque WACRM account id — idempotency scope only, never a tenant override. */
    wacrmAccountId: z.string().uuid(),
    /** Stable WACRM lead identity (flow run) — idempotency key with the above. */
    flowRunId: z.string().uuid(),
    customerName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(5).max(32),
    email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
    leadSource: z.enum(LEAD_SOURCES),
    leadType: z.enum(LEAD_TYPES),
    leadStage: z.enum(LEAD_STAGES),
    /** Owner email in the target tenant; resolved to a user id server-side. */
    assignedToEmail: z.string().trim().email().max(255),
    /**
     * Mapped salesperson id (CRM User Mapping): the Travel CRM user the
     * lead is assigned to instead of the owner-email user. Optional —
     * when omitted (or unresolvable) the owner email remains the
     * assignee. Must be an ACTIVE, non-deleted user in the SAME
     * company as the owner-email user, otherwise creation fails with
     * ASSIGNED_USER_NOT_FOUND so the caller can fall back to the
     * owner. Never a tenant override: the company still derives from
     * the owner-email user.
     */
    assignedToUserId: z.string().trim().uuid().nullable().optional(),
    dateOfBirth: optionalDate,
    travelStartDate: optionalDate,
    // Month-based travel timing (Phase 2): same ranges and pair
    // semantics as the native lead schema. Absent counts as neither,
    // so legacy exact-date payloads stay valid unchanged.
    travelMonth: z.coerce.number().int().min(1).max(12).nullable().optional(),
    travelYear: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
    departureCountry: optionalText(80),
    departureCity: optionalText(100),
    rooms: z.coerce.number().int().min(1).max(100).nullable().optional(),
    adults: z.coerce.number().int().min(1).max(200).nullable().optional(),
    childrenWithBed: z.coerce.number().int().min(0).max(100).nullable().optional(),
    childrenWithoutBed: z.coerce.number().int().min(0).max(100).nullable().optional(),
    infants: z.coerce.number().int().min(0).max(100).nullable().optional(),
    // Optional per-child ages — same rules as the core lead schema
    // (integers 0–30). Absent/null means "none provided" (never a
    // rejection reason); the core schema defaults them to [].
    childrenWithBedAges: z
      .array(z.coerce.number().int().min(0).max(30))
      .max(100)
      .nullable()
      .optional(),
    childrenWithoutBedAges: z
      .array(z.coerce.number().int().min(0).max(30))
      .max(100)
      .nullable()
      .optional(),
    infantAges: z
      .array(z.coerce.number().int().min(0).max(30))
      .max(100)
      .nullable()
      .optional(),
    services: z.array(z.enum(SERVICE_TYPES)).min(1),
    itinerary: z.array(wacrmItineraryRowSchema).min(1).max(100),
  })
  .superRefine((v, ctx) => {
    // Native pair semantics: month and year travel together or not
    // at all (same helper, same issue path/message as the UI path).
    assertTravelMonthYearPair(v, ctx);
    // Conflict rule (integration-only, stricter than the native
    // schema): an exact date and a complete month/year pair must
    // never be persisted together. The native schema tolerates the
    // combination for legacy records, but the native FORM guarantees
    // mutual exclusivity by clearing the inactive side — new writes
    // through this contract follow the form's guarantee and fail
    // closed with a clear error instead of persisting ambiguity.
    if (
      v.travelStartDate != null &&
      v.travelMonth != null &&
      v.travelYear != null
    )
      ctx.addIssue({
        code: 'custom',
        path: ['travelStartDate'],
        message: 'Travel timing must be either an exact date or a month/year pair, not both.',
      });
    if (new Set(v.itinerary.map((r) => r.sequence)).size !== v.itinerary.length)
      ctx.addIssue({
        code: 'custom',
        path: ['itinerary'],
        message: 'Itinerary sequence values must be unique.',
      });
  });

export type WacrmLeadPayload = z.infer<typeof wacrmLeadPayloadSchema>;

export const wacrmCredentialMintSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Service identity the credential acts as (must be ACTIVE in the company). */
  userId: z.string().uuid(),
  /** Lifetime in days; omitted means no expiry. */
  expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});

export type WacrmCredentialMint = z.infer<typeof wacrmCredentialMintSchema>;

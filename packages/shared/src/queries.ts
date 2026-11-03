import { z } from 'zod';

export const LEAD_SOURCES = [
  'WEBSITE',
  'SOCIAL_MEDIA',
  'FACEBOOK_ADS',
  'INSTAGRAM_ADS',
  'GOOGLE_ADS',
  'WHATSAPP',
  'PHONE_CALL',
  'REFERRAL',
  'WALK_IN',
  'REPEAT_CUSTOMER',
  'PARTNER',
  'OTHER',
] as const;
export const LEAD_TYPES = ['FRESH', 'HOT', 'WARM', 'COLD', 'PROSPECT'] as const;
export const LEAD_STAGES = [
  'NEW_LEAD',
  'CONTACTED',
  'QUALIFIED',
  'QUOTATION_REQUIRED',
  'QUOTATION_SENT',
  'IN_NEGOTIATION',
  'READY_TO_BOOK',
  'BOOKING_CONFIRMED',
  'FOLLOW_UP',
  'AMENDMENT',
  'LOST',
  'CANCELLED',
  'INVALID',
  'ON_HOLD',
  'NOT_CONNECTED',
] as const;
export const QUERY_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
/** Allowed date fields for the Leads list date-range filter. */
export const LEAD_DATE_FILTER_TYPES = ['CREATED_DATE', 'TRAVEL_DATE'] as const;
export const FOLLOW_UP_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED', 'MISSED'] as const;
export const FOLLOW_UP_OUTCOMES = [
  'CONNECTED',
  'NO_ANSWER',
  'BUSY',
  'SWITCHED_OFF',
  'CALL_BACK_LATER',
  'INTERESTED',
  'NOT_INTERESTED',
  'QUOTATION_REQUESTED',
  'NEGOTIATING',
  'READY_TO_BOOK',
  'BOOKING_CONFIRMED',
  'WRONG_NUMBER',
  'OTHER',
] as const;
export const CONTACT_METHODS = ['PHONE', 'WHATSAPP', 'EMAIL', 'MEETING', 'OTHER'] as const;
export const SERVICE_TYPES = [
  'FLIGHT',
  'HOTEL',
  'CRUISE',
  'VEHICLE_TRANSFER',
  'SIGHTSEEING',
  'VISA',
  'TRAVEL_INSURANCE',
  'RAIL',
  'PASSPORT_ASSISTANCE',
  'MEAL',
  'GUIDE',
  'OTHER_ADD_ON',
  'GENERAL_ENQUIRY',
] as const;

export type LeadSourceValue = (typeof LEAD_SOURCES)[number];
export type LeadTypeValue = (typeof LEAD_TYPES)[number];
export type LeadStageValue = (typeof LEAD_STAGES)[number];
export type QueryPriorityValue = (typeof QUERY_PRIORITIES)[number];
export type ServiceTypeValue = (typeof SERVICE_TYPES)[number];
export type FollowUpOutcomeValue = (typeof FOLLOW_UP_OUTCOMES)[number];
export type ContactMethodValue = (typeof CONTACT_METHODS)[number];
export type LeadDateFilterType = (typeof LEAD_DATE_FILTER_TYPES)[number];

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalDate = z.coerce.date().nullable().optional();
const optionalMoney = z.coerce.number().min(0).max(999999999999).nullable().optional();

/**
 * Month/year pair rule (both or neither; absent counts as neither so partial
 * updates and legacy exact-date payloads without the pair stay valid).
 * Exported for reuse by the WACRM integration contract, which mirrors
 * the native pair semantics exactly.
 */
export function assertTravelMonthYearPair(
  v: { travelMonth?: number | null | undefined; travelYear?: number | null | undefined },
  ctx: z.RefinementCtx,
) {
  const monthSet = v.travelMonth !== undefined && v.travelMonth !== null;
  const yearSet = v.travelYear !== undefined && v.travelYear !== null;
  if (monthSet !== yearSet)
    ctx.addIssue({
      code: 'custom',
      path: ['travelMonth'],
      message: 'Travel month and year must be set together.',
    });
}

export const itineraryInputSchema = z
  .object({
    country: z.string().trim().min(1).max(80),
    // Lead itinerary city is optional: Create Lead collects only a Destination
    // (stored in `country`). Existing leads may still carry a city; a blank
    // value is accepted and preserved as-is (never auto-filled).
    destination: z.string().trim().max(120).default(''),
    nights: z.coerce.number().int().min(0).max(365),
    sequence: z.coerce.number().int().min(1).max(100),
    arrivalDate: optionalDate,
    departureDate: optionalDate,
    notes: optionalText(1000),
  })
  .refine((v) => !v.arrivalDate || !v.departureDate || v.arrivalDate <= v.departureDate, {
    message: 'Arrival date must be on or before departure date.',
    path: ['departureDate'],
  });

export const followUpInputSchema = z.object({
  scheduledAt: z.coerce.date(),
  assignedToId: z.string().uuid().optional(),
  notes: optionalText(2000),
});

export const queryInputSchema = z
  .object({
    customerName: z.string().trim().min(2).max(120),
    customerId: z.string().uuid().nullable().optional(),
    createNewCustomer: z.boolean().default(false),
    createAnyway: z.boolean().default(false),
    phone: z.string().trim().min(5).max(32),
    alternatePhone: optionalText(32),
    email: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
    dateOfBirth: optionalDate,
    leadSource: z.enum(LEAD_SOURCES),
    leadType: z.enum(LEAD_TYPES).default('FRESH'),
    leadStage: z.enum(LEAD_STAGES).default('NEW_LEAD'),
    priority: z.enum(QUERY_PRIORITIES).default('MEDIUM'),
    departureCountry: optionalText(80),
    departureCity: optionalText(100),
    travelStartDate: optionalDate,
    travelEndDate: optionalDate,
    // Expected travel month/year without a day (month-only leads). Legacy
    // exact-date records keep travelStartDate and leave these null. The pair
    // rule below enforces both-or-neither; callers must never invent a day.
    travelMonth: z.coerce.number().int().min(1).max(12).nullable().optional(),
    travelYear: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
    flexibleDates: z.boolean().default(false),
    rooms: z.coerce.number().int().min(1).max(100).default(1),
    adults: z.coerce.number().int().min(1).max(200).default(1),
    childrenWithBed: z.coerce.number().int().min(0).max(100).default(0),
    childrenWithoutBed: z.coerce.number().int().min(0).max(100).default(0),
    infants: z.coerce.number().int().min(0).max(100).default(0),
    extraBeds: z.coerce.number().int().min(0).max(100).default(0),
    // Optional per-child ages collected on the Lead (CWB 1 Age, CWB 2 Age, …).
    // Carried into quotations so the PDF and Weblink render the same traveler
    // data. Empty entries are dropped by the form before submission.
    childrenWithBedAges: z.array(z.coerce.number().int().min(0).max(30)).max(100).default([]),
    childrenWithoutBedAges: z.array(z.coerce.number().int().min(0).max(30)).max(100).default([]),
    infantAges: z.array(z.coerce.number().int().min(0).max(30)).max(100).default([]),
    // Optional per-traveller names collected on the Lead (Adult 1, CWB 1, …).
    // Positional string arrays parallel to the passenger counts; blanks are
    // preserved so entries keep their identity and order. Carried into
    // quotations and email drafts.
    adultNames: z.array(z.string().trim().max(120)).max(200).default([]),
    childWithBedNames: z.array(z.string().trim().max(120)).max(200).default([]),
    childWithoutBedNames: z.array(z.string().trim().max(120)).max(200).default([]),
    infantNames: z.array(z.string().trim().max(120)).max(200).default([]),
    expectedAmount: optionalMoney,
    budgetMin: optionalMoney,
    budgetMax: optionalMoney,
    expectedMargin: optionalMoney,
    currency: z.string().trim().length(3).default('INR'),
    tripType: optionalText(40),
    quotationRequired: z.boolean().default(false),
    bookingStatusPlaceholder: optionalText(80),
    webLinkPlaceholder: z.string().trim().url().max(500).nullable().optional().or(z.literal('')),
    supplierCostingNotes: optionalText(2000),
    assignedToId: z.string().uuid().nullable().optional(),
    internalRemarks: optionalText(2000),
    services: z.array(z.enum(SERVICE_TYPES)).min(1),
    itinerary: z.array(itineraryInputSchema).max(100).default([]),
    initialNote: optionalText(4000),
    initialFollowUp: followUpInputSchema.optional(),
  })
  .superRefine((v, ctx) => {
    assertTravelMonthYearPair(v, ctx);
    if (v.travelStartDate && v.travelEndDate && v.travelStartDate > v.travelEndDate)
      ctx.addIssue({
        code: 'custom',
        path: ['travelEndDate'],
        message: 'Travel end must be after travel start.',
      });
    if (v.budgetMin != null && v.budgetMax != null && v.budgetMin > v.budgetMax)
      ctx.addIssue({
        code: 'custom',
        path: ['budgetMax'],
        message: 'Maximum budget must not be below minimum budget.',
      });
    if (new Set(v.itinerary.map((r) => r.sequence)).size !== v.itinerary.length)
      ctx.addIssue({
        code: 'custom',
        path: ['itinerary'],
        message: 'Itinerary sequence values must be unique.',
      });
    for (const [i, row] of v.itinerary.entries()) {
      if (v.travelStartDate && row.arrivalDate && row.arrivalDate < v.travelStartDate)
        ctx.addIssue({
          code: 'custom',
          path: ['itinerary', i, 'arrivalDate'],
          message: 'Itinerary must fit the trip dates.',
        });
      if (v.travelEndDate && row.departureDate && row.departureDate > v.travelEndDate)
        ctx.addIssue({
          code: 'custom',
          path: ['itinerary', i, 'departureDate'],
          message: 'Itinerary must fit the trip dates.',
        });
    }
  });

export const queryUpdateSchema = queryInputSchema
  .innerType()
  .omit({
    initialNote: true,
    initialFollowUp: true,
    leadStage: true,
    assignedToId: true,
    customerId: true,
    createNewCustomer: true,
    createAnyway: true,
  })
  .partial()
  .superRefine((v, ctx) => assertTravelMonthYearPair(v, ctx))
  .refine((v) => Object.keys(v).length > 0);
export const stageInputSchema = z.object({
  stage: z.enum(LEAD_STAGES),
  reason: optionalText(500),
  lostReason: optionalText(500),
});
export const assignmentInputSchema = z.object({
  assignedToId: z.string().uuid().nullable(),
  movePendingFollowUps: z.boolean().default(false),
});
export const noteInputSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  isCustomerContact: z.boolean().default(false),
  contactMethod: z.enum(CONTACT_METHODS).nullable().optional(),
  // Optional follow-up reminder created together with the note (matches the
  // "Create reminder for follow-up" option on the Add Note screen).
  reminderAt: z.coerce.date().optional(),
  reminderAssignedToId: z.string().uuid().optional(),
  reminderNotes: optionalText(2000),
});
export const noteUpdateSchema = noteInputSchema.omit({
  reminderAt: true,
  reminderAssignedToId: true,
  reminderNotes: true,
});
export const followUpUpdateSchema = followUpInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0);
export const followUpCompleteSchema = z
  .object({
    outcome: z.enum(FOLLOW_UP_OUTCOMES),
    notes: optionalText(2000),
    nextFollowUp: followUpInputSchema.optional(),
    nextLeadStage: z.enum(LEAD_STAGES).optional(),
  })
  .refine((v) => v.outcome !== 'OTHER' || Boolean(v.notes), {
    message: 'A note is required for the Other outcome.',
    path: ['notes'],
  });
export const followUpCancelSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

/**
 * Bulk lead operations (Phase 17). Ids are de-duplicated and capped at 100 so a
 * single request stays a bounded, atomic transaction. Every id is still
 * re-validated against the caller's lead visibility server-side.
 */
const bulkQueryIds = z
  .array(z.string().uuid())
  .min(1)
  .max(100)
  .transform((ids) => [...new Set(ids)]);

export const bulkAssignmentSchema = z.object({
  queryIds: bulkQueryIds,
  assignedToId: z.string().uuid(),
});

export const bulkStageSchema = z.object({
  queryIds: bulkQueryIds,
  leadStage: z.enum(LEAD_STAGES),
  reason: optionalText(500),
});

export type QueryInput = z.infer<typeof queryInputSchema>;
export type QueryUpdateInput = z.infer<typeof queryUpdateSchema>;
export type FollowUpInput = z.infer<typeof followUpInputSchema>;
export type FollowUpCompleteInput = z.infer<typeof followUpCompleteSchema>;
export type BulkAssignmentInput = z.infer<typeof bulkAssignmentSchema>;
export type BulkStageInput = z.infer<typeof bulkStageSchema>;

/**
 * CSV lead import (bulk). Each row is already mapped from CSV columns to the
 * same field vocabulary as the create form. Values arrive as strings (CSV cells)
 * and are intentionally permissive here: the import service validates each row
 * individually so a single bad row fails that row rather than the whole request.
 * Rows are capped so a single request stays bounded.
 */
export const LEAD_IMPORT_MAX_ROWS = 2000;

/** A lead field that CSV columns may map to. */
export const LEAD_IMPORT_FIELDS = {
  CUSTOMER_NAME: 'customerName',
  PHONE: 'phone',
  ALTERNATE_PHONE: 'alternatePhone',
  EMAIL: 'email',
  LEAD_SOURCE: 'leadSource',
  LEAD_TYPE: 'leadType',
  LEAD_STAGE: 'leadStage',
  PRIORITY: 'priority',
  DEPARTURE_COUNTRY: 'departureCountry',
  DEPARTURE_CITY: 'departureCity',
  DESTINATION: 'destination',
  TRAVEL_START_DATE: 'travelStartDate',
  TRAVEL_END_DATE: 'travelEndDate',
  ADULTS: 'adults',
  CHILDREN_WITH_BED: 'childrenWithBed',
  CHILDREN_WITHOUT_BED: 'childrenWithoutBed',
  INFANTS: 'infants',
  EXPECTED_AMOUNT: 'expectedAmount',
  BUDGET_MIN: 'budgetMin',
  BUDGET_MAX: 'budgetMax',
  CURRENCY: 'currency',
  TRIP_TYPE: 'tripType',
  INTERNAL_REMARKS: 'internalRemarks',
  SERVICES: 'services',
  ASSIGNED_TO: 'assignedTo',
} as const;
export type LeadImportFieldKey = (typeof LEAD_IMPORT_FIELDS)[keyof typeof LEAD_IMPORT_FIELDS];

/** A CSV column deliberately kept out of lead fields but included in the import note. */
export const leadImportNoteFieldSchema = z.object({
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(3800),
});

/** Permissive transport row; every scalar arrives as a CSV string cell. */
export const leadImportRowSchema = z.object({
  customerName: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  alternatePhone: z.string().trim().max(32).nullable().optional(),
  email: z.string().trim().max(255).nullable().optional(),
  leadSource: z.string().trim().max(60).nullable().optional(),
  leadType: z.string().trim().max(40).nullable().optional(),
  leadStage: z.string().trim().max(60).nullable().optional(),
  priority: z.string().trim().max(30).nullable().optional(),
  departureCountry: z.string().trim().max(80).nullable().optional(),
  departureCity: z.string().trim().max(100).nullable().optional(),
  destination: z.string().trim().max(120).nullable().optional(),
  travelStartDate: z.string().trim().max(10).nullable().optional(),
  travelEndDate: z.string().trim().max(10).nullable().optional(),
  adults: z.unknown().nullable().optional(),
  childrenWithBed: z.unknown().nullable().optional(),
  childrenWithoutBed: z.unknown().nullable().optional(),
  infants: z.unknown().nullable().optional(),
  expectedAmount: z.unknown().nullable().optional(),
  budgetMin: z.unknown().nullable().optional(),
  budgetMax: z.unknown().nullable().optional(),
  currency: z.string().trim().max(3).nullable().optional(),
  tripType: z.string().trim().max(40).nullable().optional(),
  internalRemarks: z.string().trim().max(2000).nullable().optional(),
  services: z.array(z.string().trim()).max(20).nullable().optional(),
  assignedTo: z.string().trim().max(120).nullable().optional(),
  ignoredColumnNotes: z.array(leadImportNoteFieldSchema).max(50).optional(),
});

export const leadImportSchema = z.object({
  rows: z.array(leadImportRowSchema).min(1).max(LEAD_IMPORT_MAX_ROWS),
  skipDuplicates: z.boolean().default(false),
  ignoreInvalidOptionalFields: z.boolean().default(false),
});

export type LeadImportRow = z.infer<typeof leadImportRowSchema>;
export type LeadImportInput = z.infer<typeof leadImportSchema>;

export const labelForLookup = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/**
 * Format a stored child-age array ("CWB Ages") for display: `8, 10`.
 * Returns null when the data is absent/empty or holds no usable numbers, so
 * callers can simply omit the age line for legacy quotations — never rendering
 * "undefined"/"null"/"-". Shared by the Classic PDF, the Stylish PDF and the
 * Weblink so all three render the same traveler ages from one source.
 */
export function formatAgeList(ages: unknown): string | null {
  if (!Array.isArray(ages)) return null;
  const list = ages
    .filter((age) => age != null && `${age}`.trim() !== '')
    .map((age) => Number(age))
    .filter((age) => Number.isFinite(age) && age >= 0);
  return list.length ? list.join(', ') : null;
}

/**
 * Format a stored infant-age array for display: `8 months`, `8 months, 10 months`.
 *
 * Infant ages are contractually stored in months (the Lead form collects
 * "Infant N Age (Months)", capped at 24, validated to a max of 30 — bounds
 * that only make sense as months — and values flow verbatim from lead to
 * quotation to PDF/weblink with no conversion anywhere in the chain). The
 * unit is therefore rendered explicitly per value so outputs can never be
 * misread as years. Same null/empty semantics as {@link formatAgeList}:
 * absent data yields null and the age line is omitted. CWB/CWOB ages stay on
 * {@link formatAgeList} untouched.
 */
export function formatInfantAgeList(ages: unknown): string | null {
  if (!Array.isArray(ages)) return null;
  const list = ages
    .filter((age) => age != null && `${age}`.trim() !== '')
    .map((age) => Number(age))
    .filter((age) => Number.isFinite(age) && age >= 0);
  if (!list.length) return null;
  return list.map((age) => `${age} month${age === 1 ? '' : 's'}`).join(', ');
}

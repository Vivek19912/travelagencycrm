import { z } from 'zod';
import { SERVICE_TYPES } from './queries.js';
import { MAX_ADD_ON_PRICING_ENTRIES } from './masters.js';

export const QUOTATION_TEMPLATE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const QUOTATION_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'ARCHIVED',
] as const;
export const QUOTATION_VERSION_STATUSES = ['DRAFT', 'FINALIZED', 'SUPERSEDED'] as const;
export const PRICING_MODES = [
  'TOTAL',
  'SECTION_WISE',
  'PER_PERSON',
  'PACKAGE_TOTAL',
  'ITEMIZED',
] as const;
export const QUOTATION_PRICING_MODES = ['SECTION_WISE', 'PER_PERSON'] as const;
export type QuotationPricingMode = (typeof QUOTATION_PRICING_MODES)[number];
export const MARKUP_MODES = ['NONE', 'FIXED', 'PERCENTAGE'] as const;

/**
 * "Tax Note on Total Price" dropdown (reference Summary & Pricing).
 *
 * The visible label IS the customer-facing note, so the selected label is what
 * gets stored — except for two control values:
 *  - the sentinel keeps the previously saved note (never persisted itself);
 *  - "Do not show" persists as null so the public card renders no tax line.
 */
export const QUOTATION_TAX_NOTE_SENTINEL = '-- No change (keep existing) --';
export const QUOTATION_TAX_NOTE_HIDDEN = 'Do not show';
export const QUOTATION_TAX_NOTE_OPTIONS = [
  QUOTATION_TAX_NOTE_HIDDEN,
  'Inclusive of all taxes',
  'Inclusive of all taxes, excluding TCS',
  'Inclusive of GST and TCS',
  'Excluding all taxes',
  'Excluding GST and TCS',
] as const;

/**
 * Resolve a tax-note dropdown choice into the value to persist, given the
 * previously saved note. Returns `undefined` when the field must be left
 * unchanged (the sentinel), `null` to hide it, or the literal note text.
 */
export function resolveTaxNoteChoice(
  choice: string,
  previous: string | null | undefined,
): string | null | undefined {
  if (choice === QUOTATION_TAX_NOTE_SENTINEL) return previous ?? null;
  if (choice === QUOTATION_TAX_NOTE_HIDDEN) return null;
  return choice;
}

/** Whether a stored tax note should render publicly (never the control values). */
export function isPublicTaxNote(taxNote: string | null | undefined): taxNote is string {
  const value = taxNote?.trim();
  return Boolean(
    value && value !== QUOTATION_TAX_NOTE_SENTINEL && value !== QUOTATION_TAX_NOTE_HIDDEN,
  );
}

/**
 * Remove stale leading day-number markers ("Day N:" or bare "Day N ") from an
 * itinerary title. A dash separator ("Day N - ...") is NOT a marker — it is a
 * complete stored title (e.g. from Sightseeing Master) and must survive
 * untouched, so the bare-number branch explicitly refuses to match it.
 */
export function stripItineraryDayPrefixes(value: string | null | undefined): string {
  let title = (value ?? '').replace(/\s+/g, ' ').trim();
  for (;;) {
    const colon = title.match(/^day\s+\d+\s*:\s*/i);
    if (colon) {
      title = title.slice(colon[0].length).trim();
      continue;
    }
    // Bare "Day N " (no punctuation) is a stale position marker, but never
    // consume the dash of a "Day N - ..." stored title (hyphen, en dash or
    // em dash all count as the stored separator).
    const bare = title.match(/^day\s+\d+\s+(?![-–—])/i);
    if (!bare) break;
    title = title.slice(bare[0].length).trim();
  }
  return title;
}

/**
 * Format an itinerary title for its current position.
 *
 * The stored title is rendered VERBATIM (whitespace-normalized): no separator
 * is ever generated between title parts — no " - ", no ":", no "|", no dash
 * normalization, no renumbering. "Night safari" stays "Night safari", and
 * "Day 3 - Hanoi" stays exactly that. Only a missing/blank title falls back
 * to the bare "Day N" label (which itself contains no separator).
 */
export function formatItineraryDayTitle(
  dayNumber: number,
  value: string | null | undefined,
): string {
  const raw = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return `Day ${dayNumber}`;
  return raw;
}

/**
 * Preserve-or-prefix day rule shared by the public Weblink and the WhatsApp
 * summary so both follow identical rules from this single implementation
 * (stored data is never modified): a title that already begins with a day
 * number — any separator (`|`, `-`, `:`, or none), any case — renders EXACTLY
 * as stored, never stripped, renumbered, or re-separated. A title without a
 * day prefix receives the sequential day number with a pipe separator
 * (`DAY N | Title`). Blank titles resolve to null so callers can fall back.
 */
const dayPrefixPattern = /^day\s*\d+/i;
export function formatDayPrefixedTitle(
  dayNumber: number,
  value: string | null | undefined,
): string | null {
  const raw = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  if (dayPrefixPattern.test(raw)) return raw;
  return `DAY ${dayNumber} | ${raw}`;
}

/** True when an activity name duplicates the day title (after stripping Day N: prefixes). */
export function isItineraryActivityTitleDuplicate(
  dayTitle: string | null | undefined,
  activityName: string | null | undefined,
): boolean {
  const day = stripItineraryDayPrefixes(dayTitle).trim().toLowerCase();
  const act = stripItineraryDayPrefixes(activityName).trim().toLowerCase();
  if (!day || !act) return false;
  return day === act;
}

export interface ItineraryImageActivityRef {
  imageDocumentId?: string | null;
  imageUrl?: string | null;
  sightseeingId?: string | null;
}

export interface ItineraryImageResolver<T> {
  document?: (imageDocumentId: string) => T | null | undefined;
  snapshot: (imageUrl: string) => T | null | undefined;
  sightseeing: (sightseeingId: string) => T | null | undefined;
  destination?: T | null;
}

/** Canonical activity image precedence: saved snapshot, then sightseeing master. */
export function resolveItineraryActivityImage<T>(
  activity: ItineraryImageActivityRef,
  resolver: ItineraryImageResolver<T>,
): T | null {
  const imageDocumentId = activity.imageDocumentId?.trim();
  if (imageDocumentId && resolver.document) {
    const document = resolver.document(imageDocumentId);
    if (document != null) return document;
  }
  const imageUrl = activity.imageUrl?.trim();
  if (imageUrl) {
    const snapshot = resolver.snapshot(imageUrl);
    if (snapshot != null) return snapshot;
  }
  const sightseeingId = activity.sightseeingId?.trim();
  if (sightseeingId) {
    const sightseeing = resolver.sightseeing(sightseeingId);
    if (sightseeing != null) return sightseeing;
  }
  return null;
}

/** Canonical day image: snapshot, master, destination hero, then no image. */
export function resolveItineraryDayImage<T>(
  activities: readonly ItineraryImageActivityRef[],
  resolver: ItineraryImageResolver<T>,
): T | null {
  if (resolver.document) {
    for (const activity of activities) {
      const imageDocumentId = activity.imageDocumentId?.trim();
      if (!imageDocumentId) continue;
      const document = resolver.document(imageDocumentId);
      if (document != null) return document;
    }
  }
  for (const activity of activities) {
    const imageUrl = activity.imageUrl?.trim();
    if (!imageUrl) continue;
    const snapshot = resolver.snapshot(imageUrl);
    if (snapshot != null) return snapshot;
  }
  for (const activity of activities) {
    const sightseeingId = activity.sightseeingId?.trim();
    if (!sightseeingId) continue;
    const sightseeing = resolver.sightseeing(sightseeingId);
    if (sightseeing != null) return sightseeing;
  }
  return resolver.destination ?? null;
}

export const SERVICE_DESCRIPTION_MAX_LENGTH = 20_000;

/**
 * Quotation "Booking Terms & Conditions" — rich-text/HTML block edited in the
 * Quotation Builder. Detailed travel booking terms legitimately exceed the old
 * 8,000-character cap (HTML markup counts toward the stored length), so the
 * limit is 20,000 characters. The DB column is TEXT (no DB-level cap); this
 * app-level limit is enforced identically by the frontend form and the API.
 */
export const QUOTATION_BOOKING_TERMS_MAX_LENGTH = 20_000;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const arrayFromNullish = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null || value === undefined ? [] : value), z.array(schema));
/**
 * Rich-text fields store HTML, so formatting markup must not consume the
 * customer-facing character allowance. Keep a generous raw-payload guard,
 * while enforcing the business limit against the visible text only.
 */
const optionalRichText = (visibleMax: number, message?: string) =>
  z
    .string()
    .trim()
    .max(100_000, 'Rich-text HTML must be 100,000 characters or fewer.')
    .refine(
      (html) =>
        html
          .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
          .replace(/<[^>]*>/g, '')
          .replace(/&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/gi, 'x')
          .trim().length <= visibleMax,
      { message: message ?? `Visible text must contain at most ${visibleMax} character(s)` },
    )
    .nullable()
    .optional();
const optionalDate = z.coerce.date().nullable().optional();
/** Optional wall-clock HH:mm (24h). Blank is normalised to null so an unset
 * time is stored consistently and can be "shown as nothing" downstream. */
const optionalTime = z
  .string()
  .trim()
  .refine((value) => value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'Use a HH:MM time.')
  .transform((value) => (value ? value : null))
  .nullable()
  .optional();
const money = z.coerce.number().finite().min(0).max(999_999_999_999);
const optionalMoney = money.nullable().optional();
const sequence = z.coerce.number().int().min(1).max(500);
/**
 * Optional link to a travel master (Phase 14).
 *
 * Always optional: master selection is a convenience, never a requirement, and
 * every row must stay valid as pure free text. The snapshot columns beside
 * these references remain the authoritative rendered values.
 */
const optionalMasterId = z.string().uuid().nullable().optional();

/**
 * One image in a quotation-owned snapshot gallery.
 *
 * `url` keeps existing bookmark/legacy snapshots working. Master images use an
 * opaque `masterImageId` while a draft is being edited; the API replaces that
 * transient reference with its own immutable storage metadata before writing
 * the snapshot. `id` is the stable, customer-safe identity returned on reload
 * and is also what new rows store in the legacy-named `pdfImageUrl` column.
 */
export const quotationSnapshotImageSchema = z
  .object({
    id: optionalText(200),
    masterImageId: optionalText(200),
    url: z.string().trim().url().max(4000).nullable().optional(),
    thumbnailUrl: z.string().trim().url().max(4000).nullable().optional(),
    alt: optionalText(500),
  })
  .superRefine((image, ctx) => {
    if (!image.id && !image.masterImageId && !image.url) {
      ctx.addIssue({
        code: 'custom',
        message: 'An image must include a saved id, Master image id, or URL.',
      });
    }
  });

export type QuotationSnapshotImage = z.infer<typeof quotationSnapshotImageSchema>;

/** Stable selection value for PDF choice: saved id first, legacy URL second. */
export function quotationSnapshotImageIdentity(
  image: Pick<QuotationSnapshotImage, 'id' | 'masterImageId' | 'url'>,
): string | null {
  return image.id?.trim() || image.masterImageId?.trim() || image.url?.trim() || null;
}

/** Explicit PDF image when valid, otherwise the first saved image in order. */
export function resolveQuotationPdfImage<T extends QuotationSnapshotImage>(
  images: readonly T[] | null | undefined,
  selected: string | null | undefined,
): T | null {
  if (!images?.length) return null;
  return (
    images.find((image) => quotationSnapshotImageIdentity(image) === selected) ?? images[0] ?? null
  );
}

export const quotationItinerarySchema = z.object({
  dayNumber: z.coerce.number().int().min(1).max(500),
  date: optionalDate,
  title: z.string().trim().min(1).max(200),
  destination: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(8000),
  meals: optionalText(500),
  overnightLocation: optionalText(120),
  activities: optionalText(2000),
  transfers: optionalText(2000),
  notes: optionalText(2000),
  sequence,
});

/**
 * One room allocation inside a hotel option. A hotel option may carry any
 * number of these (unlimited); each line keeps its own room-type link, room
 * quantity and extra-bed / child-without-bed details, mirroring the legacy
 * row-level scalar columns so a single-line hotel option prices identically
 * to a legacy quotation.
 */
export const quotationHotelRoomLineSchema = z.object({
  hotelRoomTypeId: optionalMasterId,
  roomType: optionalText(100),
  rooms: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? 1 : value),
    z.coerce.number().int().min(1).max(100),
  ),
  extraBedQuantity: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    z.coerce.number().int().min(0).max(100).nullable().optional(),
  ),
  extraBedPrice: optionalMoney,
  childWithoutBedQuantity: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    z.coerce.number().int().min(0).max(100).nullable().optional(),
  ),
  childWithoutBedPrice: optionalMoney,
  // Snapshot of resolved master pricing (per-night), same semantics as the
  // row-level snapshot columns.
  baseRoomPrice: optionalMoney,
  pricingSource: optionalText(20),
  /** Per-line master selling figure (additive row total), mirroring the row's sellingPrice semantics. */
  sellingPrice: optionalMoney,
  internalCost: optionalMoney,
  notes: optionalText(2000),
});

/** One meal-plan selection inside a hotel option (unlimited per option). */
export const quotationHotelMealPlanLineSchema = z.object({
  hotelMealPlanId: optionalMasterId,
  mealPlan: optionalText(100),
  sellingPrice: optionalMoney,
  internalCost: optionalMoney,
});

export type QuotationHotelRoomLine = z.infer<typeof quotationHotelRoomLineSchema>;
export type QuotationHotelMealPlanLine = z.infer<typeof quotationHotelMealPlanLineSchema>;

/**
 * One cruise room allocation inside a cruise service. A cruise may carry any
 * number of these; each line keeps its own room-type link, room quantity and
 * per-night rate, mirroring the cruise room-type master price.
 */
export const quotationCruiseRoomLineSchema = z.object({
  cruiseRoomTypeId: optionalMasterId,
  roomType: optionalText(100),
  rooms: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? 1 : value),
    z.coerce.number().int().min(1).max(100),
  ),
  // Per-night rate from master, editable (manual override)
  roomRate: optionalMoney,
  // Legacy single-room sellingPrice kept for backward compat; new code uses roomRate
  sellingPrice: optionalMoney,
  internalCost: optionalMoney,
  notes: optionalText(2000),
});

export type QuotationCruiseRoomLine = z.infer<typeof quotationCruiseRoomLineSchema>;

export const quotationHotelSchema = z
  .object({
    // Master references. These columns already existed on the hotel-option
    // tables; Phase 14 makes them reachable through the API.
    hotelId: optionalMasterId,
    hotelRoomTypeId: optionalMasterId,
    hotelMealPlanId: optionalMasterId,
    city: z.string().trim().max(120).nullable().optional(),
    hotelName: z.string().trim().max(200).nullable().optional(),
    category: optionalText(40),
    roomType: optionalText(100),
    mealPlan: optionalText(100),
    rooms: z.preprocess(
      (value) => (value === '' ? null : value),
      z.coerce.number().int().min(1).max(100).nullable().optional(),
    ),
    /**
     * Staff-entered TOTAL ROOMS override. NULL/undefined means automatic: the
     * total is the live sum of the room allocations. A non-null value wins
     * over the sum and is preserved verbatim across saves and reloads.
     */
    roomsOverride: z.preprocess(
      (value) => (value === '' ? null : value),
      z.coerce.number().int().min(1).max(100).nullable().optional(),
    ),
    nights: z.preprocess(
      (value) => (value === '' || value === null || value === undefined ? null : value),
      z.coerce.number().int().min(1).max(365).nullable().optional(),
    ),
    checkInDate: optionalDate,
    checkOutDate: optionalDate,
    // Optional per-stay wall-clock times (HH:mm). Left blank shows no time.
    checkInTime: optionalTime,
    checkOutTime: optionalTime,
    showCheckInTime: z.boolean().nullable().optional(),
    showCheckOutTime: z.boolean().nullable().optional(),
    internalCost: optionalMoney,
    sellingPrice: optionalMoney,
    // Snapshot of resolved master pricing (per-night, nullable for backward compat). Stored as snapshot, never live-queried from weblink/PDF/booking.
    baseRoomPrice: optionalMoney,
    extraBedQuantity: z.preprocess(
      (value) => (value === '' || value === null || value === undefined ? null : value),
      z.coerce.number().int().min(0).max(100).nullable().optional(),
    ),
    extraBedPrice: optionalMoney,
    childWithoutBedQuantity: z.preprocess(
      (value) => (value === '' || value === null || value === undefined ? null : value),
      z.coerce.number().int().min(0).max(100).nullable().optional(),
    ),
    childWithoutBedPrice: optionalMoney,
    pricingSource: optionalText(20),
    selected: z.boolean().default(true),
    /**
     * Alternative-hotel group. Stays sharing the same non-empty group id are
     * ALTERNATIVE OPTIONS — only the selected one contributes to the pricing
     * total. Stays without a group are CONSECUTIVE STAYS and always add up.
     * Legacy snapshots (null/absent) keep the plain selected-flag behavior.
     */
    optionGroupId: optionalText(40),
    notes: optionalText(2000),
    sequence,
    // Per-stay images for bookmark snapshots. When a hotel is bookmarked,
    // its images are stored here instead of in the section-level hotelDetails.
    // This allows multiple stays to have independent images. Older quotations
    // store NULL (or omit) the column, so null/undefined are normalized to an
    // empty array at the shared boundary — never a validation failure.
    images: z.preprocess(
      (value) => (value === null || value === undefined ? [] : value),
      z.array(quotationSnapshotImageSchema),
    ),
    /** False only for a legacy NULL snapshot; true also preserves an explicit empty gallery. */
    imageSnapshotPresent: z.boolean().optional(),
    /**
     * The image (a URL from `images`) chosen as this stay's single PDF photo
     * via "Use in PDF". Absent, or pointing at a removed image, the PDF falls
     * back to the first image in the stay's saved order.
     */
    pdfImageUrl: optionalText(1000),
    /**
     * Multiple room allocations inside ONE hotel option (unlimited). Legacy
     * quotations store NULL and keep using the row-level scalar columns
     * (roomType, rooms, extraBed and childWithoutBed fields); when the array
     * is present it is the authoritative room list and the scalars mirror the
     * first line for older readers.
     */
    roomLines: z.preprocess(
      (value) => (value === null || value === undefined ? [] : value),
      z.array(quotationHotelRoomLineSchema).max(10),
    ),
    /** Multiple meal-plan selections inside ONE hotel option (up to 10). */
    mealPlanLines: z.preprocess(
      (value) => (value === null || value === undefined ? [] : value),
      z.array(quotationHotelMealPlanLineSchema).max(10),
    ),
  })
  .refine((v) => !v.checkInDate || !v.checkOutDate || v.checkInDate <= v.checkOutDate, {
    message: 'Check-out must be on or after check-in.',
    path: ['checkOutDate'],
  })
  .superRefine((v, ctx) => {
    // A partially filled room line must name its room type so the problem is
    // reported against the exact line ("Room 2") instead of being dropped.
    (v.roomLines ?? []).forEach((line, index) => {
      const hasRoom = Boolean(line.hotelRoomTypeId) || Boolean(line.roomType?.trim());
      const hasData =
        hasRoom ||
        line.rooms !== 1 ||
        line.extraBedQuantity != null ||
        line.childWithoutBedQuantity != null ||
        Boolean(line.notes?.trim()) ||
        line.baseRoomPrice != null ||
        line.extraBedPrice != null ||
        line.childWithoutBedPrice != null ||
        line.sellingPrice != null;
      if (hasData && !hasRoom) {
        ctx.addIssue({
          code: 'custom',
          path: ['roomLines', index],
          message: `Room ${index + 1}: Room Type is required.`,
        });
      }
    });
  });

/** Pricing bases for service-backed sections (cruise/vehicle/add-on). */
export const SERVICE_PRICING_BASES = [
  'PER_DAY',
  'PER_HOUR',
  'PER_TRANSFER',
  'PER_VEHICLE',
  'PER_TRAVELER',
  'PER_UNIT',
  'FIXED',
] as const;
export type ServicePricingBasis = (typeof SERVICE_PRICING_BASES)[number];

/**
 * One quotation-owned pricing snapshot entry. Same shape as the master
 * pricing entries, except `id` is an opaque stable string rather than a UUID:
 * masters use UUIDs while legacy synthesis uses `legacy-<masterId>`, and
 * snapshots must never fail validation because of id format.
 */
export const quotationPricingSnapshotEntrySchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  label: optionalText(80),
  price: optionalMoney,
  currency: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), 'Use a three-letter currency code.')
    .default('INR'),
});
export type QuotationPricingSnapshotEntry = z.infer<
  typeof quotationPricingSnapshotEntrySchema
>;

export const quotationServiceSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES),
  // Master references, each valid only for its matching service type. The
  // server enforces that pairing; see master-refs.service.ts.
  airlineId: optionalMasterId,
  cruiseId: optionalMasterId,
  cruiseRoomTypeId: optionalMasterId,
  vehicleId: optionalMasterId,
  sightseeingId: optionalMasterId,
  addOnServiceId: optionalMasterId,
  name: z.string().trim().min(1).max(200),
  description: optionalRichText(
    SERVICE_DESCRIPTION_MAX_LENGTH,
    'Description must be 20,000 characters or fewer.',
  ),
  dayNumber: z.coerce.number().int().min(1).max(500).nullable().optional(),
  city: optionalText(120),
  quantity: z.coerce.number().positive().max(100_000).default(1),
  internalCost: optionalMoney,
  sellingPrice: optionalMoney,
  // What the unit price represents (days/hours/transfers/cabins/travelers).
  // Legacy snapshots (null) keep the plain quantity × unit-price semantics.
  pricingBasis: z.enum(SERVICE_PRICING_BASES).nullish(),
  // Free-text master pricing basis snapshot (e.g. "Per Person"), carried
  // from the Add-On Service master. NULL for legacy rows and other types.
  pricingBasisLabel: optionalText(80),
  // Quotation-owned snapshot of ALL master pricing options available when the
  // Add-On Service was selected (same shape as the master entries). Saved rows
  // are authoritative: later master edits never rewrite them. Nullish for
  // legacy rows and other service types.
  pricingSnapshot: z.array(quotationPricingSnapshotEntrySchema).max(MAX_ADD_ON_PRICING_ENTRIES).nullish(),
  taxCategory: optionalText(80),
  notes: optionalText(2000),
  // Vehicle "Duration" — free-text (e.g. "3 days", "8 hours", "Airport transfer"),
  // persisted independently from `notes` (which holds the vehicle "Usage").
  // NULL for legacy rows and every non-vehicle service type.
  duration: optionalText(2000),
  // Cruise-specific structured duration and multi-room allocation.
  // Legacy single-room cruises store nights in free-text notes; new code uses cruiseNights.
  cruiseNights: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    z.coerce.number().int().min(1).max(365).nullable().optional(),
  ).optional(),
  cruiseRoomLines: z
    .array(quotationCruiseRoomLineSchema)
    .max(10)
    .optional(),
  // Ordered, quotation-owned snapshot. Legacy service rows normalize to [].
  images: z
    .preprocess(
      (value) => (value === null || value === undefined ? [] : value),
      z.array(quotationSnapshotImageSchema),
    )
    .optional(),
  imageSnapshotPresent: z.boolean().optional(),
  // One explicit PDF choice; renderers fall back to the first saved image.
  pdfImageUrl: optionalText(1000),
  sequence,
});

const contentSchema = z.object({ content: z.string().trim().min(1).max(2000), sequence });

export const quotationTemplateInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: optionalText(4000),
    destinationSummary: z.string().trim().min(2).max(500),
    durationDays: z.coerce.number().int().min(1).max(365),
    durationNights: z.coerce.number().int().min(0).max(364),
    baseCurrency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase())
      .default('INR'),
    adultBasePrice: optionalMoney,
    childWithBedBasePrice: optionalMoney,
    childWithoutBedBasePrice: optionalMoney,
    infantBasePrice: optionalMoney,
    status: z.enum(QUOTATION_TEMPLATE_STATUSES).default('ACTIVE'),
    internalNotes: optionalText(4000),
    itinerary: arrayFromNullish(quotationItinerarySchema).pipe(
      z.array(quotationItinerarySchema).max(500),
    ),
    hotels: arrayFromNullish(quotationHotelSchema).pipe(z.array(quotationHotelSchema).max(200)),
    services: arrayFromNullish(quotationServiceSchema).pipe(
      z.array(quotationServiceSchema).max(500),
    ),
    inclusions: arrayFromNullish(contentSchema).pipe(z.array(contentSchema).max(200)),
    exclusions: arrayFromNullish(contentSchema).pipe(z.array(contentSchema).max(200)),
    terms: arrayFromNullish(contentSchema).pipe(z.array(contentSchema).max(200)),
  })
  .superRefine((value, ctx) => {
    if (value.durationNights >= value.durationDays)
      ctx.addIssue({
        code: 'custom',
        path: ['durationNights'],
        message: 'Nights must be fewer than days.',
      });
    for (const [name, rows] of Object.entries({
      itinerary: value.itinerary,
      hotels: value.hotels,
      services: value.services,
      inclusions: value.inclusions,
      exclusions: value.exclusions,
      terms: value.terms,
    })) {
      if (new Set(rows.map((row) => row.sequence)).size !== rows.length)
        ctx.addIssue({ code: 'custom', path: [name], message: 'Sequence values must be unique.' });
    }
  });

export const quotationTemplateUpdateSchema = quotationTemplateInputSchema
  .innerType()
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be supplied.');

export const FLIGHT_JOURNEY_TYPES = ['ROUND_TRIP', 'ONEWAY_OUTBOUND', 'ONEWAY_RETURN'] as const;

/**
 * Parent-flight label prefix shared by the builder, public weblink, and both
 * PDF renderers, e.g. `Flight Details 1 · `. Empty for single-flight
 * sections so lone journeys keep their bare titles (`Outbound Journey`).
 * Pass `uppercase` for the Stylish PDF's uppercase journey labels.
 */
export function flightRecordPrefix(
  flightIndex: number,
  totalFlights: number,
  uppercase = false,
): string {
  if (totalFlights <= 1) return '';
  const label = `Flight Details ${flightIndex + 1}`;
  return `${uppercase ? label.toUpperCase() : label} · `;
}

/**
 * User-facing label for a cabin-luggage option. The stored/API value stays
 * "10kg" for backward compatibility with existing quotations; it is displayed
 * as "10 kg+". Every other value renders unchanged.
 */
export function cabinLuggageLabel(value: string | null | undefined): string {
  return value === '10kg' ? '10 kg+' : (value ?? '');
}

/**
 * Calendar-night difference between a hotel's check-in and check-out dates.
 * Times are ignored (calendar-date comparison), so a stay from 10 Aug 14:00 to
 * 12 Aug 12:00 is 2 nights. Returns null when either date is missing/invalid or
 * when check-out is not strictly after check-in.
 */
export function hotelStayNights(
  checkIn: string | Date | null | undefined,
  checkOut: string | Date | null | undefined,
): number | null {
  if (!checkIn || !checkOut) return null;
  const from = new Date(checkIn);
  const to = new Date(checkOut);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.round((day(to) - day(from)) / 86_400_000);
  return diff > 0 ? diff : null;
}

/**
 * Join only the non-empty parts of a display string. Empty/whitespace-only
 * values are dropped entirely so optional fields (e.g. hotel room type or meal
 * plan) never render empty placeholders or dangling separators such as
 * "Deluxe ·" or "· Breakfast".
 */
export function joinNonEmpty(parts: Array<string | null | undefined>, separator = ' · '): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(separator);
}

/**
 * Snapshot pricing helpers for hotel extra-bed / child-without-bed.
 * All stored as snapshot (per-night) values, never live-queried in PDF/Weblink.
 */
export type HotelExtraPricing = {
  baseRoomPrice?: number | null;
  extraBedQuantity?: number | null;
  extraBedPrice?: number | null;
  childWithoutBedQuantity?: number | null;
  childWithoutBedPrice?: number | null;
  rooms?: number | null;
  nights?: number | null;
};

export function calculateHotelStayTotal(pricing: HotelExtraPricing): {
  baseTotal: number;
  extraBedTotal: number;
  childWithoutBedTotal: number;
  accommodationTotal: number;
} {
  const nights = pricing.nights ?? 0;
  const rooms = pricing.rooms ?? 1;
  const base = pricing.baseRoomPrice ?? 0;
  const ebQty = pricing.extraBedQuantity ?? 0;
  const ebPrice = pricing.extraBedPrice ?? 0;
  const cwQty = pricing.childWithoutBedQuantity ?? 0;
  const cwPrice = pricing.childWithoutBedPrice ?? 0;
  if (!nights || nights <= 0) {
    const extraBedTotal = ebQty * ebPrice;
    const childWithoutBedTotal = cwQty * cwPrice;
    const baseTotal = base * rooms;
    return { baseTotal, extraBedTotal, childWithoutBedTotal, accommodationTotal: baseTotal + extraBedTotal + childWithoutBedTotal };
  }
  const baseTotal = base * rooms * nights;
  const extraBedTotal = ebQty * ebPrice * nights;
  const childWithoutBedTotal = cwQty * cwPrice * nights;
  return { baseTotal, extraBedTotal, childWithoutBedTotal, accommodationTotal: baseTotal + extraBedTotal + childWithoutBedTotal };
}

export function validateHotelOccupancy(
  occupancy: { maxAdults?: number | null; maxChildren?: number | null; maxOccupancy?: number | null },
  pax: { extraBedQuantity?: number | null; childWithoutBedQuantity?: number | null; rooms?: number | null },
): string | null {
  const max = occupancy.maxOccupancy;
  if (max == null) return null;
  const totalExtra = (pax.extraBedQuantity ?? 0) + (pax.childWithoutBedQuantity ?? 0);
  // Occupancy is per room; if multiple rooms, allow scaling. Simple check: total extra per stay should not exceed max * rooms in naive sense.
  // We only warn when single room and total extra clearly exceeds max.
  const rooms = pax.rooms ?? 1;
  if (totalExtra > max * rooms) return `Extra occupants (${totalExtra}) exceed room max occupancy (${max}${rooms > 1 ? ` × ${rooms}` : ''}).`;
  return null;
}

// ---------------------------------------------------------------------------
// Multi-room / multi-meal hotel option support
// ---------------------------------------------------------------------------

const hotelLineRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * The room allocations of one hotel option, always as a line array.
 *
 * Rows saved with the multi-room structure return their lines as-is; legacy
 * rows (single roomType/rooms/extraBed* scalar columns, NULL roomLines) are
 * synthesized into exactly one line so every reader — PDF, weblink, pricing,
 * builder — consumes the same shape without data migration.
 */
export function resolveHotelRoomLines(hotel: unknown): QuotationHotelRoomLine[] {
  const row = hotelLineRecord(hotel);
  const stored = Array.isArray(row.roomLines) ? (row.roomLines as unknown[]) : [];
  if (stored.length > 0) return stored.map((line) => hotelLineRecord(line)) as unknown as QuotationHotelRoomLine[];
  const hasLegacy =
    row.roomType != null ||
    row.hotelRoomTypeId != null ||
    row.rooms != null ||
    row.extraBedQuantity != null ||
    row.childWithoutBedQuantity != null;
  if (!hasLegacy) return [];
  return [
    {
      hotelRoomTypeId: (row.hotelRoomTypeId as QuotationHotelRoomLine['hotelRoomTypeId']) ?? null,
      roomType: (row.roomType as QuotationHotelRoomLine['roomType']) ?? null,
      rooms: row.rooms == null ? 1 : Number(row.rooms) || 1,
      extraBedQuantity: (row.extraBedQuantity as QuotationHotelRoomLine['extraBedQuantity']) ?? null,
      extraBedPrice: (row.extraBedPrice as QuotationHotelRoomLine['extraBedPrice']) ?? null,
      childWithoutBedQuantity: (row.childWithoutBedQuantity as QuotationHotelRoomLine['childWithoutBedQuantity']) ?? null,
      childWithoutBedPrice: (row.childWithoutBedPrice as QuotationHotelRoomLine['childWithoutBedPrice']) ?? null,
      baseRoomPrice: (row.baseRoomPrice as QuotationHotelRoomLine['baseRoomPrice']) ?? null,
      pricingSource: (row.pricingSource as QuotationHotelRoomLine['pricingSource']) ?? null,
      sellingPrice: null,
      internalCost: null,
      notes: null,
    },
  ];
}

/**
 * The meal-plan selections of one hotel option as a line array. Legacy rows
 * (single mealPlan scalar, NULL mealPlanLines) synthesize exactly one line.
 */
export function resolveHotelMealPlanLines(hotel: unknown): QuotationHotelMealPlanLine[] {
  const row = hotelLineRecord(hotel);
  const stored = Array.isArray(row.mealPlanLines) ? (row.mealPlanLines as unknown[]) : [];
  if (stored.length > 0) return stored.map((line) => hotelLineRecord(line)) as unknown as QuotationHotelMealPlanLine[];
  if (row.mealPlan == null && row.hotelMealPlanId == null) return [];
  return [
    {
      hotelMealPlanId: (row.hotelMealPlanId as QuotationHotelMealPlanLine['hotelMealPlanId']) ?? null,
      mealPlan: (row.mealPlan as QuotationHotelMealPlanLine['mealPlan']) ?? null,
      sellingPrice: null,
      internalCost: null,
    },
  ];
}

/** Total room quantity across every room allocation of a hotel option. */
export function hotelRoomLinesTotalRooms(hotel: unknown): number | null {
  const lines = resolveHotelRoomLines(hotel);
  if (!lines.length) return null;
  return lines.reduce((sum, line) => sum + (Number(line.rooms) || 1), 0);
}

/**
 * Accommodation total across every room allocation of a hotel option, using
 * the exact legacy per-row formula applied per line (base × rooms × nights +
 * extra bed + child without bed). A legacy single-room row therefore yields
 * exactly the legacy total.
 */
export function calculateHotelRoomLinesTotal(
  hotel: unknown,
  nights?: number | null,
): number {
  const row = hotelLineRecord(hotel);
  const resolvedNights =
    nights ??
    (row.nights == null ? 0 : Number(row.nights));
  return resolveHotelRoomLines(hotel).reduce((sum, line) => {
    const lineTotal = calculateHotelStayTotal({
      baseRoomPrice: line.baseRoomPrice ?? 0,
      rooms: line.rooms ?? 1,
      extraBedQuantity: line.extraBedQuantity ?? 0,
      extraBedPrice: line.extraBedPrice ?? 0,
      childWithoutBedQuantity: line.childWithoutBedQuantity ?? 0,
      childWithoutBedPrice: line.childWithoutBedPrice ?? 0,
      nights: resolvedNights,
    });
    return sum + lineTotal.accommodationTotal;
  }, 0);
}

// ---------------------------------------------------------------------------
// Cruise multi-room helpers
// ---------------------------------------------------------------------------

const cruiseLineRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/**
 * The stored room allocations of one cruise service, always as a line array.
 *
 * An explicit `cruiseRoomLines` array is authoritative — including an
 * explicitly saved `[]`, which means the cruise has zero rooms. Display
 * readers (public weblink, PDFs) must never invent a default room for it.
 *
 * Rows WITHOUT the key (legacy scalar rows and template rows, which predate
 * the column) resolve to `[]` here; the quotation builder applies its own
 * legacy single-room synthesis for editing, and every display reader falls
 * back to the saved scalar columns (room name, notes) instead of a badge.
 */
export function resolveCruiseRoomLines(service: unknown): QuotationCruiseRoomLine[] {
  const row = cruiseLineRecord(service);
  if (Array.isArray(row.cruiseRoomLines))
    return (row.cruiseRoomLines as unknown[]).map((line) => cruiseLineRecord(line)) as unknown as QuotationCruiseRoomLine[];
  return [];
}

/**
 * Cruise total across every room allocation, using per-night semantics.
 * If nights is null/0, falls back to quantity×rate without nights (preserves
 * total-price legacy where nights not yet set). Each line total = roomRate × rooms × nights.
 */
export function calculateCruiseRoomLinesTotal(
  service: unknown,
  nights?: number | null,
): number {
  const row = cruiseLineRecord(service);
  const resolvedNights = nights ?? (row.cruiseNights == null ? null : Number(row.cruiseNights));
  const lines = resolveCruiseRoomLines(service);
  if (!lines.length) {
    // No lines: fall back to legacy quantity×sellingPrice (and nights if present for per-night)
    const qty = row.quantity == null ? 1 : Number(row.quantity) || 1;
    const rate = row.sellingPrice == null ? 0 : Number(row.sellingPrice);
    if (resolvedNights != null && resolvedNights > 0) return rate * qty * resolvedNights;
    return rate * qty;
  }
  return lines.reduce((sum, line) => {
    const rate = line.roomRate ?? line.sellingPrice ?? 0;
    const rooms = line.rooms ?? 1;
    const r = Number(rate) || 0;
    if (resolvedNights != null && resolvedNights > 0) return sum + r * rooms * resolvedNights;
    return sum + r * rooms;
  }, 0);
}

/** Cruise nights → days derivation (Days = Nights + 1). */
export function cruiseNightsToDays(nights: number | null | undefined): number | null {
  if (nights == null || Number(nights) <= 0) return null;
  return Number(nights) + 1;
}

/** Reference "Flight" tab — one segment (leg/connection) of a journey. */
export const flightSegmentSchema = z
  .object({
    airlineId: z.string().uuid().nullable().optional(),
    airlineName: optionalText(200),
    flightNumber: optionalText(40),
    travelClass: optionalText(40),
    from: optionalText(120),
    to: optionalText(120),
    departureDate: optionalText(20),
    departureTime: optionalText(20),
    arrivalDate: optionalText(20),
    arrivalTime: optionalText(20),
    duration: optionalText(40),
    cabinLuggage: optionalText(40),
    checkInLuggage: optionalText(40),
    notes: optionalText(8000),
    connectionVia: optionalText(120),
  })
  .superRefine((segment, ctx) => {
    if (
      !segment.departureDate ||
      !segment.departureTime ||
      !segment.arrivalDate ||
      !segment.arrivalTime
    )
      return;
    const departure = new Date(`${segment.departureDate}T${segment.departureTime}`).getTime();
    const arrival = new Date(`${segment.arrivalDate}T${segment.arrivalTime}`).getTime();
    if (!Number.isNaN(departure) && !Number.isNaN(arrival) && arrival <= departure) {
      ctx.addIssue({
        code: 'custom',
        path: ['arrivalTime'],
        message: 'Arrival time must be after departure time.',
      });
    }
  });

export const flightJourneySchema = z.object({
  fromCity: optionalText(120),
  toCity: optionalText(120),
  /**
   * Independently editable journey header route. Initialized once from the
   * journey endpoints (never re-derived afterwards): the header displays
   * `routeFrom → routeTo`, falling back to `fromCity → toCity` only while
   * these are absent (legacy quotations). Editing the header writes these
   * two fields alone — segments and fromCity/toCity are never touched — and
   * editing segments never rewrites them.
   */
  routeFrom: optionalText(120),
  routeTo: optionalText(120),
  travelClass: optionalText(40),
  segments: arrayFromNullish(flightSegmentSchema).pipe(z.array(flightSegmentSchema).max(20)),
});

/**
 * One flight record inside the Flight section: its own bookmark trace,
 * journey type, and outbound/return journeys. Section-level fields (include,
 * title, amount, pricing, images) stay on `flightDetails` itself.
 */
export const flightJourneyRecordSchema = z.object({
  bookmarkCode: optionalText(20),
  journeyType: z.enum(FLIGHT_JOURNEY_TYPES).default('ROUND_TRIP'),
  outbound: flightJourneySchema.default({ segments: [] }),
  returnJourney: flightJourneySchema.default({ segments: [] }),
});
export type FlightJourneyRecord = z.infer<typeof flightJourneyRecordSchema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A journey object with at least one segment carrying real content. */
const hasJourneyContent = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const segments = Array.isArray(value.segments) ? value.segments : [];
  const text = (segment: Record<string, unknown>, key: string): string =>
    typeof segment[key] === 'string' ? (segment[key] as string).trim() : '';
  return segments.some(
    (segment) =>
      isRecord(segment) &&
      (text(segment, 'airlineName') !== '' ||
        text(segment, 'from') !== '' ||
        text(segment, 'to') !== '' ||
        text(segment, 'flightNumber') !== '' ||
        text(segment, 'departureDate') !== '' ||
        text(segment, 'arrivalDate') !== ''),
  );
};

/**
 * Canonicalize a stored `flightDetails` value into the multi-flight shape:
 * `{ ...section, flights: [...] }` with the legacy top-level journey fields
 * folded away. Rules:
 * - a non-empty `flights` array wins; legacy mirrors are dropped;
 * - otherwise legacy journeys with real segment content wrap into one record;
 * - otherwise (blank defaults included) the result carries `flights: []`.
 * Non-objects pass through untouched. Pure and total — safe for form
 * hydration, API validation, and PDF/weblink rendering alike.
 */
export function normalizeFlightDetails<T>(value: T): T {
  if (!isRecord(value)) return value;
  const { flights, outbound, returnJourney, journeyType, bookmarkCode, ...rest } = value as Record<
    string,
    unknown
  > & {
    flights?: unknown;
    outbound?: unknown;
    returnJourney?: unknown;
    journeyType?: unknown;
    bookmarkCode?: unknown;
  };
  if (Array.isArray(flights) && flights.length > 0) return { ...rest, flights } as T;
  if (hasJourneyContent(outbound) || hasJourneyContent(returnJourney)) {
    return {
      ...rest,
      flights: [
        {
          bookmarkCode: typeof bookmarkCode === 'string' && bookmarkCode.trim() ? bookmarkCode : null,
          journeyType: typeof journeyType === 'string' ? journeyType : 'ROUND_TRIP',
          outbound: isRecord(outbound) ? outbound : { segments: [] },
          returnJourney: isRecord(returnJourney) ? returnJourney : { segments: [] },
        },
      ],
    } as T;
  }
  return { ...rest, flights: [] } as T;
}

export const flightImageSchema = z.object({
  documentId: z.string().uuid(),
  fileName: optionalText(255),
  description: optionalText(500),
  /** Legacy field retained so existing quotation snapshots remain readable. */
  heading: optionalText(200),
});

/** How the flight section's selling price is determined. */
export const FLIGHT_PRICING_BASES = ['FIXED_TOTAL', 'PER_TRAVELER'] as const;
export type FlightPricingBasis = (typeof FLIGHT_PRICING_BASES)[number];

/** Per-traveler flight rates (FIXED_TOTAL quotations keep these empty). */
export const flightPerTravelerSchema = z
  .object({
    adult: optionalMoney,
    childWithBed: optionalMoney,
    childWithoutBed: optionalMoney,
    infant: optionalMoney,
  })
  .default({});

export const flightDetailsSchema = z
  .preprocess(normalizeFlightDetails, z.object({
    include: z.boolean().default(true),
    sectionTitle: optionalText(200),
    amount: optionalMoney,
    // MUTUALLY EXCLUSIVE with perTraveler rates: only the selected basis
    // contributes to the quotation total (see resolveQuotationPricing).
    pricingBasis: z.enum(FLIGHT_PRICING_BASES).default('FIXED_TOTAL'),
    perTraveler: flightPerTravelerSchema,
    entryMode: z.enum(['MANUAL', 'IMAGE']).default('MANUAL'),
    imageDocumentId: z.string().uuid().nullable().optional(),
    imageFileName: optionalText(255),
    images: arrayFromNullish(flightImageSchema).pipe(z.array(flightImageSchema).max(10)),
    journeyType: z.enum(FLIGHT_JOURNEY_TYPES).default('ROUND_TRIP'),
    outbound: flightJourneySchema.default({ segments: [] }),
    returnJourney: flightJourneySchema.default({ segments: [] }),
    /**
     * Every flight in the section, in display order. New writes always carry
     * the journeys here; the top-level legacy mirrors are folded away by the
     * preprocess above so stored rows converge on this shape.
     */
    flights: z.array(flightJourneyRecordSchema).max(10).default([]),
  }))
  .superRefine((details, ctx) => {
    if (
      details.include &&
      details.entryMode === 'IMAGE' &&
      !details.imageDocumentId &&
      details.images.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['images'],
        message: 'Upload at least one flight image.',
      });
    }
  });

export const SIGHTSEEING_MEAL_MODES = ['NO_TRANSFER', 'INCLUDE_AT_HOTEL', 'WITH_TRANSFER'] as const;
export const SIGHTSEEING_TRANSFER_MODES = ['PRIVATE', 'SHARED', 'NO_TRANSFER'] as const;

/** Per-meal sightseeing preference: independent mode + optional transfer details. */
export const sightseeingMealPreferenceSchema = z.object({
  mode: z.enum(SIGHTSEEING_MEAL_MODES).default('NO_TRANSFER'),
  transferDetails: optionalText(300),
});

/** Per-meal preferences keyed by meal; absent entries mean "not configured". */
export const sightseeingMealPreferencesSchema = z
  .object({
    breakfast: sightseeingMealPreferenceSchema.optional(),
    lunch: sightseeingMealPreferenceSchema.optional(),
    dinner: sightseeingMealPreferenceSchema.optional(),
  })
  .default({});

/**
 * Default price rows the builder offers on every activity. They are only UI
 * seeds — nothing distinguishes them from a user-added row once saved, and an
 * untouched one is never persisted.
 */
export const SIGHTSEEING_DEFAULT_PRICE_LABELS = ['Adult', 'Child'] as const;

/** Max pricing rows on a single activity. */
const SIGHTSEEING_PRICE_OPTIONS_MAX = 20;

/**
 * How a pricing row may arrive: the builder's number inputs hand back strings
 * (or null once cleared), while a saved snapshot round-trips real numbers.
 */
const rawSightseeingPriceOptionSchema = z.object({
  label: z.string().max(60).nullish(),
  price: z.union([z.string(), z.number()]).nullish(),
});

const isBlankPriceValue = (value: unknown) =>
  value == null || (typeof value === 'string' && value.trim() === '');

/** Parsed price, or null when the input was left empty. */
const parsePriceValue = (value: unknown): number | null => {
  if (isBlankPriceValue(value)) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * Informational per-activity pricing — Adult/Child and any custom row
 * all live in this one array.
 *
 * Rows are validated at their original index so the builder can attach inline
 * errors, then normalised on the way out: labels trimmed, untouched rows
 * dropped. An empty default therefore never persists as `{ label: 'Child',
 * price: 0 }`. These prices are display-only and never feed quotation totals.
 */
export const sightseeingPricingOptionsSchema = z
  .array(rawSightseeingPriceOptionSchema)
  .max(SIGHTSEEING_PRICE_OPTIONS_MAX)
  .optional()
  .superRefine((rows, ctx) => {
    if (!rows) return;
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const label = (row.label ?? '').trim();
      const price = parsePriceValue(row.price);
      // A row the user never filled in is dropped below, not reported.
      if (!label && price === null) return;
      if (!label)
        ctx.addIssue({
          code: 'custom',
          message: 'Add a label for this price.',
          path: [index, 'label'],
        });
      if (price !== null && (!Number.isFinite(price) || price < 0 || price > 999_999_999_999))
        ctx.addIssue({
          code: 'custom',
          message: 'Enter a price of 0 or more.',
          path: [index, 'price'],
        });
      const key = label.toLowerCase();
      if (!key) return;
      if (seen.has(key))
        ctx.addIssue({
          code: 'custom',
          message: `"${label}" is already priced on this activity.`,
          path: [index, 'label'],
        });
      seen.add(key);
    });
  })
  .transform((rows) =>
    (rows ?? [])
      .map((row) => ({ label: (row.label ?? '').trim(), price: parsePriceValue(row.price) }))
      // Persist only meaningful rows — a real label with a real price.
      .filter(
        (row): row is { label: string; price: number } => Boolean(row.label) && row.price !== null,
      ),
  );

/**
 * How one activity's price is applied. PER_TRAVELER multiplies the
 * label-matched rows (Adult/CWB/CWOB/Infant) by the quotation's traveler
 * counts; every other basis multiplies each priced row by a plain quantity
 * (default 1) and never uses traveler counts.
 */
export const SIGHTSEEING_PRICING_BASES = [
  'PER_TRAVELER',
  'PER_GROUP',
  'PER_VEHICLE',
  'PER_DAY',
  'FIXED',
] as const;
export type SightseeingPricingBasis = (typeof SIGHTSEEING_PRICING_BASES)[number];

/** Reference "Sightseeing" tab — one attraction/activity within a day. */
export const sightseeingActivitySchema = z.object({
  sightseeingId: z.string().uuid().nullable().optional(),
  imageDocumentId: z.string().uuid().nullable().optional(),
  name: optionalText(300),
  startTime: optionalText(20),
  // Per-activity customer-output control. Legacy snapshots default to visible.
  showTime: z.boolean().default(true),
  duration: optionalText(40),
  city: optionalText(120),
  description: optionalRichText(8000),
  imageUrl: optionalText(1000),
  // Ordered gallery copied from the selected Sightseeing Master. The legacy
  // single imageUrl/imageDocumentId fields remain valid for old quotations and
  // custom uploads.
  images: z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    z.array(quotationSnapshotImageSchema),
  ),
  imageSnapshotPresent: z.boolean().optional(),
  pdfImageUrl: optionalText(1000),
  // Per-activity transfer now uses meal modes (NO_TRANSFER/INCLUDE_AT_HOTEL/WITH_TRANSFER)
  // for consistency with MEALS INCLUDED. Old PRIVATE/SHARED values remain accepted for backwards compatibility.
  dailyTransfer: z
    .union([z.enum(SIGHTSEEING_MEAL_MODES), z.enum(SIGHTSEEING_TRANSFER_MODES)])
    .nullish(),
  // Absent/null on every activity saved before this feature; read as [].
  pricingOptions: z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    sightseeingPricingOptionsSchema,
  ),
  // Structured pricing basis. Legacy snapshots (null/absent) keep the
  // PER_TRAVELER label-matching behavior.
  pricingBasis: z.enum(SIGHTSEEING_PRICING_BASES).nullish(),
  pricingQuantity: z.preprocess(
    (value) => (value === '' || value === null || value === undefined ? null : value),
    z.coerce.number().int().min(0).max(1000).nullable().optional(),
  ),
  sequence: z.number().int().min(1).max(500).nullable().optional(),
  // DISPLAY-ONLY master pricing snapshot — checked entries are shown in
  // the itinerary presentation (builder/weblink/PDFs) but never feed
  // resolveQuotationPricing or any grand total.
  displayPricing: z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    z
      .array(
        z.object({
          label: z.string().trim().max(60),
          price: z.union([z.string(), z.number()]).nullable().optional(),
          enabled: z.boolean().optional().default(true),
        }),
      )
      .max(20)
      .optional(),
  ),
  // DISPLAY-ONLY heading for the pricing block — customizes the "PRICING"
  // label shown in weblink/classic/stylish PDFs.
  displayPricingHeading: optionalText(60),
});

export type SightseeingPriceOption = { label: string; price: number };

export const sightseeingDaySchema = z.object({
  dayNumber: z.coerce.number().int().min(1).max(365),
  title: optionalText(300),
  // True once the user manually edits the day title, so automatic prefill and
  // primary-activity changes never overwrite it.
  titleTouched: z.boolean().optional(),
  city: optionalText(120),
  date: optionalText(20),
  meals: z
    .object({
      breakfast: z.boolean().default(false),
      lunch: z.boolean().default(false),
      dinner: z.boolean().default(false),
    })
    .default({ breakfast: false, lunch: false, dinner: false }),
  mealMode: z.enum(SIGHTSEEING_MEAL_MODES).default('INCLUDE_AT_HOTEL'),
  // Independent per-meal mode + transfer details. `mealMode` is retained for
  // legacy snapshots that predate per-meal preferences.
  mealPreferences: sightseeingMealPreferencesSchema,
  dailyTransfer: z
    .union([z.enum(SIGHTSEEING_MEAL_MODES), z.enum(SIGHTSEEING_TRANSFER_MODES)])
    .default('NO_TRANSFER'),
  activities: arrayFromNullish(sightseeingActivitySchema).pipe(
    z.array(sightseeingActivitySchema).max(20),
  ),
});

export const sightseeingDetailsSchema = z.object({
  include: z.boolean().default(true),
  sectionTitle: optionalText(200),
  amount: optionalMoney,
  description: optionalText(8000),
  days: arrayFromNullish(sightseeingDaySchema).pipe(z.array(sightseeingDaySchema).max(60)),
});

export const hotelDetailsSchema = z.object({
  include: z.boolean().default(true),
  sectionTitle: optionalText(200).default('Your Hotels'),
  amount: optionalMoney,
  description: optionalText(8000),
  /**
   * Images copied from a Live Search bookmark snapshot when a hotel was
   * imported via a bookmark code. Stored as plain URLs (thumbnail/original)
   * and never fetched from SearchAPI.
   */
  images: z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    z
      .array(
        z.object({
          url: z.string().url(),
          /**
           * The bookmark card's fallback URL for the same provider image (the
           * `thumbnail` candidate). Kept verbatim from the bookmark so renderers
           * can fall back exactly like the carousel when `url` fails to load.
           */
          thumbnailUrl: optionalText(1000),
          alt: optionalText(500),
        }),
      )
      .max(12),
  ),
  /**
   * The image (a URL from `images`) chosen as the single hotel photo for the
   * PDF via "Use in PDF". Absent, or pointing at a removed image, the PDF falls
   * back to the first image in the saved order.
   */
  pdfImageUrl: optionalText(1000),
});

/** Top-level Add-on Services section state (individual add-ons are service rows). */
export const addOnDetailsSchema = z.object({
  include: z.boolean().default(true),
  sectionTitle: optionalText(200).default('Additional Services'),
});

/**
 * Weblink profile card display customization (Weblink Display Settings).
 *
 * Purely presentational overrides for the customer-facing profile information
 * card: an optional custom label, an optional custom value and a visibility
 * flag per item, plus the composite "Prepared By" block. Blank/absent values
 * always fall back to the automatically derived quotation/lead value. This is
 * never written into lead data or any source record — it lives only on the
 * quotation version as display configuration.
 */
export const WEBLINK_PROFILE_FIELD_IDS = [
  'travelerName',
  'travelDate',
  'duration',
  'travelers',
  'cwbAges',
  'cwobAges',
  'infantAges',
  'quotationId',
  'destinations',
] as const;
export type WeblinkProfileFieldId = (typeof WEBLINK_PROFILE_FIELD_IDS)[number];

/** Default customer-facing labels for the weblink profile card rows. */
export const WEBLINK_PROFILE_FIELD_LABELS: Record<WeblinkProfileFieldId, string> = {
  travelerName: 'Traveler Name',
  travelDate: 'Travel Date',
  duration: 'Duration',
  travelers: 'Travelers',
  cwbAges: 'CWB Ages',
  cwobAges: 'CWOB Ages',
  infantAges: 'Infant Ages',
  quotationId: 'Quotation ID',
  destinations: 'Destinations',
};

export const WEBLINK_PROFILE_PREPARED_BY_LABEL = 'Prepared By';

export const weblinkProfileFieldConfigSchema = z.object({
  /** Custom row label; blank falls back to the default label. */
  label: optionalText(60),
  /** Custom display value; blank falls back to the derived value. */
  value: optionalText(300),
  /** Hide this row from the weblink without deleting the underlying data. */
  hidden: z.boolean().optional(),
});

export const weblinkProfilePreparedByConfigSchema = z.object({
  label: optionalText(60),
  name: optionalText(120),
  phone: optionalText(60),
  email: optionalText(160),
  hidden: z.boolean().optional(),
});

export const weblinkProfileConfigSchema = z.object({
  travelerName: weblinkProfileFieldConfigSchema.optional(),
  travelDate: weblinkProfileFieldConfigSchema.optional(),
  duration: weblinkProfileFieldConfigSchema.optional(),
  travelers: weblinkProfileFieldConfigSchema.optional(),
  cwbAges: weblinkProfileFieldConfigSchema.optional(),
  cwobAges: weblinkProfileFieldConfigSchema.optional(),
  infantAges: weblinkProfileFieldConfigSchema.optional(),
  quotationId: weblinkProfileFieldConfigSchema.optional(),
  destinations: weblinkProfileFieldConfigSchema.optional(),
  preparedBy: weblinkProfilePreparedByConfigSchema.optional(),
});
export type WeblinkProfileConfig = z.infer<typeof weblinkProfileConfigSchema>;
export type WeblinkProfileFieldConfig = z.infer<typeof weblinkProfileFieldConfigSchema>;
export type WeblinkProfilePreparedByConfig = z.infer<typeof weblinkProfilePreparedByConfigSchema>;

/**
 * Sanitize a weblink profile config before persisting. Trims every value and
 * drops empty entries so an untouched form stores `null` rather than a pile of
 * blank objects. Purely display configuration — it never touches lead/business
 * data.
 */
export function normalizeWeblinkProfileConfig(
  input: WeblinkProfileConfig | null | undefined,
): WeblinkProfileConfig | null {
  if (!input) return null;
  const out: WeblinkProfileConfig = {};
  for (const id of WEBLINK_PROFILE_FIELD_IDS) {
    const cfg = input[id];
    if (!cfg) continue;
    const next: WeblinkProfileFieldConfig = {};
    const label = cfg.label?.trim();
    const value = cfg.value?.trim();
    if (label) next.label = label;
    if (value) next.value = value;
    if (cfg.hidden === true) next.hidden = true;
    if (Object.keys(next).length > 0) out[id] = next;
  }
  const preparedBy = input.preparedBy;
  if (preparedBy) {
    const next: WeblinkProfilePreparedByConfig = {};
    const label = preparedBy.label?.trim();
    const name = preparedBy.name?.trim();
    const phone = preparedBy.phone?.trim();
    const email = preparedBy.email?.trim();
    if (label) next.label = label;
    if (name) next.name = name;
    if (phone) next.phone = phone;
    if (email) next.email = email;
    if (preparedBy.hidden === true) next.hidden = true;
    if (Object.keys(next).length > 0) out.preparedBy = next;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export const quotationVersionInputSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    introduction: optionalText(4000),
    weblinkHeading: optionalText(200),
    // Custom package heading for the third line of the public weblink hero.
    // Null/empty falls back to "Custom Package for [Lead]".
    packageHeading: optionalText(200),
    // Per-quotation weblink display overrides (Weblink Display Settings).
    // Null/empty falls back to the automatically generated text; never
    // affects masters, itinerary, dates, pricing, or PDFs.
    weblinkDurationText: optionalText(200),
    weblinkProfileDestination: optionalText(500),
    // Per-item label/value/visibility overrides for the weblink profile card.
    // Null/absent keeps the fully automatic card. Display-only.
    weblinkProfile: weblinkProfileConfigSchema.nullable().optional(),
    // Optional: a quotation may not have a destination summary yet, so an
    // empty, blank or missing value must never block saving. Normalised to an
    // empty string (never null) to match the stored column and the builder form.
    destinationSummary: z.string().trim().max(500).default(''),
    travelStartDate: optionalDate,
    travelEndDate: optionalDate,
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    pricingMode: z.enum(PRICING_MODES).default('PER_PERSON'),
    // Customer-facing pricing presentation.
    pricingHeading: optionalText(120).default('Price Breakdown'),
    pricingSubheading: optionalText(200),
    pricingDisplayOrder: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    // Builder-only row order for the By Traveler Price Breakdown: stable row ids
    // (traveler keys + custom item ids) in the order the user arranged them.
    pricingRowOrder: z.array(z.string().trim().min(1).max(64)).max(80).optional(),
    markupMode: z.enum(MARKUP_MODES).default('NONE'),
    markupValue: money.default(0),
    taxRate: money.max(100).default(0),
    discountAmount: money.default(0),
    // Reference "Summary & Pricing" — per-passenger package pricing.
    perAdultPrice: optionalMoney,
    perChildWithBedPrice: optionalMoney,
    perChildWithoutBedPrice: optionalMoney,
    perInfantPrice: optionalMoney,
    taxNote: optionalText(200),
    netAmount: optionalMoney,
    initialPaymentAmount: optionalMoney,
    // Optional, but when present must be an absolute http(s) URL (any gateway).
    paymentLink: optionalText(500).refine(
      (value) => {
        const trimmed = value?.trim();
        if (!trimmed) return true;
        try {
          const url = new URL(trimmed);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'Enter a valid URL starting with http:// or https://' },
    ),
    showServiceChargesSeparately: z.boolean().optional(),
    markServiceChargesOutside: z.boolean().optional(),
    hidePricing: z.boolean().optional(),
    showIndividualPricing: z.boolean().optional(),
    // Weblink "Quick Navigation" section index (default shown; sticky opt-in).
    showQuickNav: z.boolean().optional(),
    quickNavSticky: z.boolean().optional(),
    // Reference "Inclusions & Exclusions" — rich-text/HTML blocks. Rich text
    // is stored with markup, so it legitimately exceeds 8000 characters. The
    // 50,000 ceiling is the project's rich-HTML limit (see optionalRichText in
    // masters.ts) and matches the DB columns widened to TEXT.
    inclusionsHtml: optionalText(50_000),
    exclusionsHtml: optionalText(50_000),
    paymentPolicies: optionalText(8000),
    cancellationPolicies: optionalText(8000),
    bookingTerms: optionalText(QUOTATION_BOOKING_TERMS_MAX_LENGTH),
    childPolicy: optionalText(8000),
    // Reference "Visa" — single dedicated section.
    includeVisa: z.boolean().optional(),
    visaSectionTitle: optionalText(200),
    visaAmount: optionalMoney,
    visaDestination: optionalText(120),
    visaType: optionalText(120),
    visaServiceCharge: optionalMoney,
    visaGstPercent: money.max(100).nullable().optional(),
    visaVfsCharge: optionalMoney,
    // Custom Charges — only for By Section pricing, FIXED TOTAL each.
    // Each charge is a fixed package amount (never multiplied by traveler count).
    customCharges: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(100),
          amount: money,
          description: optionalText(500),
          category: optionalText(50),
        }),
      )
      .max(50)
      .optional(),
    // Additional Price Items — flat package charges for By Traveler pricing.
    // Each item is a FIXED package amount (never multiplied by traveler count)
    // and is added on top of the per-traveler subtotal.
    packageCustomItems: z
      .array(
        z.object({
          // Stable row identity so the builder can reorder items across saves.
          id: z.string().trim().min(1).max(64).optional(),
          label: z.string().trim().min(1).max(100),
          amount: money,
        }),
      )
      .max(50)
      .optional(),
    // Reference "Flight" — structured journeys/segments.
    flightDetails: flightDetailsSchema.nullable().optional(),
    // Reference "Hotel" — editable section heading, amount and description.
    hotelDetails: hotelDetailsSchema.nullable().optional(),
    // Reference "Add-on Services" — top-level include flag.
    addOnDetails: addOnDetailsSchema.nullable().optional(),
    // Reference "Sightseeing" — day-wise activity itinerary.
    sightseeingDetails: sightseeingDetailsSchema.nullable().optional(),
    // Weblink customization — quotation-specific FAQs and custom section order.
    faqs: arrayFromNullish(
      z.object({
        question: z.string().trim().min(1).max(500),
        answer: z.string().trim().min(1).max(5000),
      }),
    ).pipe(
      z
        .array(
          z.object({
            question: z.string().trim().min(1).max(500),
            answer: z.string().trim().min(1).max(5000),
          }),
        )
        .max(50),
    ),
    weblinkSectionOrder: z.array(z.string().trim().min(1).max(80)).max(30).nullable().optional(),
    // Destination Expert — per-quotation expert config
    destinationExpertConfig: z
      .object({
        enabled: z.boolean().default(false),
        expertUserId: z.string().uuid().nullable().optional(),
        heading: optionalText(200),
        customIntroduction: optionalText(2000),
        whatsappNumber: z
          .string()
          .trim()
          .max(32)
          .nullable()
          .optional()
          .refine((v) => !v || /^\+?[0-9\s()-]{6,32}$/.test(v), 'Enter a valid WhatsApp number'),
        callNumber: z
          .string()
          .trim()
          .max(32)
          .nullable()
          .optional()
          .refine((v) => !v || /^\+?[0-9\s()-]{6,32}$/.test(v), 'Enter a valid phone number'),
        email: z
          .string()
          .trim()
          .max(255)
          .nullable()
          .optional()
          .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
        showWhatsapp: z.boolean().default(true),
        showCall: z.boolean().default(true),
        showEmail: z.boolean().default(true),
        showExperience: z.boolean().default(true),
        showTripsPlanned: z.boolean().default(true),
        showLanguages: z.boolean().default(true),
      })
      .nullable()
      .optional(),
    notes: optionalText(4000),
    internalNotes: optionalText(4000),
    itinerary: arrayFromNullish(quotationItinerarySchema).pipe(
      z.array(quotationItinerarySchema).max(500),
    ),
    hotels: arrayFromNullish(quotationHotelSchema).pipe(z.array(quotationHotelSchema).max(200)),
    services: arrayFromNullish(quotationServiceSchema).pipe(
      z.array(quotationServiceSchema).max(500),
    ),
    inclusions: arrayFromNullish(contentSchema).pipe(z.array(contentSchema).max(200)),
    exclusions: arrayFromNullish(contentSchema).pipe(z.array(contentSchema).max(200)),
    terms: arrayFromNullish(contentSchema).pipe(z.array(contentSchema).max(200)),
  })
  .refine((v) => !v.travelStartDate || !v.travelEndDate || v.travelStartDate <= v.travelEndDate, {
    message: 'Travel end must be on or after travel start.',
    path: ['travelEndDate'],
  });

export const quotationVersionUpdateSchema = quotationVersionInputSchema
  .innerType()
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be supplied.');

/**
 * Weblink display settings — cosmetic flags editable directly from the
 * quotation detail view (no full edit). Unlike a version edit, this is allowed
 * on finalized versions too, since it changes only how the shared link is
 * presented, never the quoted content or pricing.
 */
export const quotationWeblinkSettingsSchema = z
  .object({
    showQuickNav: z.boolean().optional(),
    quickNavSticky: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one setting must be supplied.');
export type QuotationWeblinkSettings = z.infer<typeof quotationWeblinkSettingsSchema>;

/**
 * Weblink customization — reorderable sections for the public quotation page.
 * These ids map one-to-one to the actual sections rendered by PublicQuotationPage.
 * Do NOT add fictional sections here; the list must stay in sync with the renderer.
 */
export const WEBLINK_SECTION_IDS = [
  'services',
  'itinerary',
  'hotels',
  'flights',
  'transportation',
  'cruise',
  'addons',
  'visa',
  'policies',
  'destinationExpert',
  'faqs',
] as const;
export type WeblinkSectionId = (typeof WEBLINK_SECTION_IDS)[number];
export const DEFAULT_WEBLINK_SECTION_ORDER: WeblinkSectionId[] = [...WEBLINK_SECTION_IDS];

/**
 * Normalize a possibly-stale saved section order into a complete, deduped order.
 * Unknown ids are dropped; missing known ids are appended in default order so
 * new sections never disappear on old quotations.
 */
export function resolveWeblinkSectionOrder(
  saved: unknown,
  fallback: readonly string[] = DEFAULT_WEBLINK_SECTION_ORDER,
): string[] {
  const valid = new Set<string>(WEBLINK_SECTION_IDS as readonly string[]);
  if (!Array.isArray(saved) || saved.length === 0) return [...fallback];
  const normalized = (saved as unknown[])
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0 && valid.has(value));
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const id of normalized) {
    if (!seen.has(id)) {
      seen.add(id);
      deduped.push(id);
    }
  }
  for (const id of fallback) {
    if (!seen.has(id as string) && valid.has(id as string)) {
      deduped.push(id as string);
    }
  }
  // Append any brand-new known ids not yet in fallback (future-proof).
  for (const id of WEBLINK_SECTION_IDS) {
    if (!deduped.includes(id)) deduped.push(id);
  }
  return deduped;
}

/**
 * Quotation PDFs follow the SAME single saved `weblinkSectionOrder` as the
 * public weblink — there is no separate per-PDF ordering. Visa has no
 * independent PDF renderer (both styles fold it into the add-on pages), so it
 * is not an independently placeable PDF section.
 */
export const QUOTATION_PDF_SECTION_IDS = [
  'flights',
  'hotels',
  'itinerary',
  'transportation',
  'cruise',
  'services',
  'addons',
  'policies',
  'destinationExpert',
  'faqs',
] as const;
export type QuotationPdfSectionId = (typeof QUOTATION_PDF_SECTION_IDS)[number];

/** Sequence used when no custom order is saved — preserves the legacy PDF layout. */
export const DEFAULT_QUOTATION_PDF_SECTION_ORDER: QuotationPdfSectionId[] = [
  ...QUOTATION_PDF_SECTION_IDS,
];

/**
 * Type guard for weblink section ids that are independently placeable PDF
 * sections. Excludes 'visa', which both PDF styles render inside the add-on
 * pages rather than as its own section.
 */
function isQuotationPdfSectionId(id: string): id is QuotationPdfSectionId {
  return (QUOTATION_PDF_SECTION_IDS as readonly string[]).includes(id);
}

/**
 * Resolve the PDF section order from the version's saved weblink order.
 * Falls back to the legacy PDF sequence when nothing (or something invalid)
 * is saved, so existing quotations keep their current layout.
 */
export function resolveQuotationPdfSectionOrder(saved: unknown): QuotationPdfSectionId[] {
  if (!Array.isArray(saved) || saved.length === 0) return [...DEFAULT_QUOTATION_PDF_SECTION_ORDER];
  // resolveWeblinkSectionOrder() also emits 'visa'; the guard filters it out.
  return resolveWeblinkSectionOrder(saved).filter(isQuotationPdfSectionId);
}

/**
 * Validate and normalize FAQs stored on a quotation version.
 * Invalid entries are dropped so a single bad row never breaks public rendering.
 */
export function normalizeFaqs(value: unknown): Array<{ question: string; answer: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const question = typeof row.question === 'string' ? row.question.trim() : '';
    const answer = typeof row.answer === 'string' ? row.answer.trim() : '';
    if (!question || !answer) return [];
    return [{ question: question.slice(0, 500), answer: answer.slice(0, 5000) }];
  });
}

export const destinationExpertConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    expertUserId: z.string().uuid().nullable().optional(),
    heading: z.string().trim().max(200).nullable().optional(),
    customIntroduction: z.string().trim().max(2000).nullable().optional(),
    whatsappNumber: z
      .string()
      .trim()
      .max(32)
      .nullable()
      .optional()
      .refine((v) => !v || /^\+?[0-9\s()-]{6,32}$/.test(v), 'Enter a valid WhatsApp number'),
    callNumber: z
      .string()
      .trim()
      .max(32)
      .nullable()
      .optional()
      .refine((v) => !v || /^\+?[0-9\s()-]{6,32}$/.test(v), 'Enter a valid phone number'),
    email: z
      .string()
      .trim()
      .max(255)
      .nullable()
      .optional()
      .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address'),
    showWhatsapp: z.boolean().default(true),
    showCall: z.boolean().default(true),
    showEmail: z.boolean().default(true),
    showExperience: z.boolean().default(true),
    showTripsPlanned: z.boolean().default(true),
    showLanguages: z.boolean().default(true),
    jobTitle: optionalText(120),
    bio: optionalText(5000),
    specialization: optionalText(200),
    yearsOfExperience: z.coerce.number().int().min(0).max(100).nullable().optional(),
    tripsPlanned: z.coerce.number().int().min(0).max(100000).nullable().optional(),
    languages: optionalText(200),
    gender: z.enum(['MALE', 'FEMALE']).nullable().optional(),
    profileImageUrl: z.string().trim().url().max(4000).nullable().optional(),
    destination: optionalText(120),
  })
  .nullable()
  .optional();

export type DestinationExpertConfig = z.infer<typeof destinationExpertConfigSchema>;

/**
 * Stylish PDF Page 1 image selections. Persisted per quotation version so
 * regeneration reproduces the same cover. Hero defaults to the destination
 * master image; each gallery card defaults to the first usable image of the
 * first three DIFFERENT sightseeing activities. CUSTOM slots carry a
 * storage object key written by the approve/confirm upload flow — never the
 * master or quotation data itself, so Classic PDF / weblink stay untouched.
 */
const stylishPdfPage1ImageSchema = z.object({
  mode: z.enum(['DEFAULT', 'CUSTOM']),
  objectKey: z.string().trim().min(1).max(1000).nullable().optional(),
  fileName: z.string().trim().min(1).max(200).nullable().optional(),
  mimeType: z.string().trim().min(1).max(100).nullable().optional(),
  fileSize: z.number().int().positive().max(5 * 1024 * 1024).nullable().optional(),
});

export const stylishPdfPage1Schema = z
  .object({
    hero: stylishPdfPage1ImageSchema.nullable().optional(),
    cards: z.array(stylishPdfPage1ImageSchema.nullable().optional()).max(3).nullable().optional(),
  })
  .nullable()
  .optional();

export type StylishPdfPage1 = z.infer<typeof stylishPdfPage1Schema>;

export function normalizeStylishPdfPage1(value: unknown): StylishPdfPage1 {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const cleanSlot = (slot: unknown) => {
    if (!slot || typeof slot !== 'object') return null;
    const s = slot as Record<string, unknown>;
    if (s.mode !== 'CUSTOM') return { mode: 'DEFAULT' as const };
    const objectKey = typeof s.objectKey === 'string' && s.objectKey.trim() ? s.objectKey.trim() : null;
    if (!objectKey) return { mode: 'DEFAULT' as const };
    return {
      mode: 'CUSTOM' as const,
      objectKey,
      fileName: typeof s.fileName === 'string' ? s.fileName : null,
      mimeType: typeof s.mimeType === 'string' ? s.mimeType : null,
      fileSize: typeof s.fileSize === 'number' && Number.isFinite(s.fileSize) ? s.fileSize : null,
    };
  };
  const cardsRaw = Array.isArray(row.cards) ? row.cards.slice(0, 3) : [];
  while (cardsRaw.length < 3) cardsRaw.push(null);
  return {
    hero: cleanSlot(row.hero),
    cards: cardsRaw.map(cleanSlot),
  };
}

export function normalizeDestinationExpertConfig(value: unknown): DestinationExpertConfig {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const enabled = row.enabled === true;
  if (!enabled)
    return {
      enabled: false,
      expertUserId: null,
      heading: null,
      customIntroduction: null,
      whatsappNumber: undefined,
      callNumber: undefined,
      email: undefined,
      showWhatsapp: true,
      showCall: true,
      showEmail: true,
      showExperience: true,
      showTripsPlanned: true,
      showLanguages: true,
      jobTitle: null,
      bio: null,
      specialization: null,
      yearsOfExperience: null,
      tripsPlanned: null,
      languages: null,
      gender: null,
      profileImageUrl: null,
      destination: null,
    } as DestinationExpertConfig;
  const expertUserId =
    typeof row.expertUserId === 'string' && row.expertUserId.trim()
      ? row.expertUserId.trim()
      : null;
  const hasWhatsapp = 'whatsappNumber' in row;
  const hasCall = 'callNumber' in row || 'phoneNumber' in row;
  const hasEmail = 'email' in row;
  const whatsappNumber = hasWhatsapp
    ? typeof row.whatsappNumber === 'string' && row.whatsappNumber.trim()
      ? row.whatsappNumber.trim().slice(0, 32)
      : null
    : undefined;
  const rawCall = (row.callNumber as unknown) ?? (row as Record<string, unknown>).phoneNumber;
  const callNumber = hasCall
    ? typeof rawCall === 'string' && (rawCall as string).trim()
      ? (rawCall as string).trim().slice(0, 32)
      : null
    : undefined;
  const email = hasEmail
    ? typeof row.email === 'string' && row.email.trim()
      ? row.email.trim().slice(0, 255).toLowerCase()
      : null
    : undefined;
  return {
    enabled: true,
    expertUserId,
    heading: typeof row.heading === 'string' ? row.heading.trim().slice(0, 200) || null : null,
    customIntroduction:
      typeof row.customIntroduction === 'string'
        ? row.customIntroduction.trim().slice(0, 2000) || null
        : null,
    whatsappNumber,
    callNumber,
    email,
    showWhatsapp: row.showWhatsapp !== false,
    showCall: row.showCall !== false,
    showEmail: row.showEmail !== false,
    showExperience: row.showExperience !== false,
    showTripsPlanned: row.showTripsPlanned !== false,
    showLanguages: row.showLanguages !== false,
    jobTitle: typeof row.jobTitle === 'string' ? row.jobTitle.trim().slice(0, 120) || null : null,
    bio: typeof row.bio === 'string' ? row.bio.trim().slice(0, 5000) || null : null,
    specialization: typeof row.specialization === 'string' ? row.specialization.trim().slice(0, 200) || null : null,
    yearsOfExperience: row.yearsOfExperience != null ? Math.max(0, Math.min(100, Number(row.yearsOfExperience))) || null : null,
    tripsPlanned: row.tripsPlanned != null ? Math.max(0, Math.min(100000, Number(row.tripsPlanned))) || null : null,
    languages: typeof row.languages === 'string' ? row.languages.trim().slice(0, 200) || null : null,
    gender: row.gender === 'MALE' || row.gender === 'FEMALE' ? row.gender : null,
    profileImageUrl: typeof row.profileImageUrl === 'string' && row.profileImageUrl.trim() ? row.profileImageUrl.trim().slice(0, 4000) : null,
    destination: typeof row.destination === 'string' ? row.destination.trim().slice(0, 120) || null : null,
  } as DestinationExpertConfig;
}

/**
 * Resolve real fallback contacts for Destination Expert.
 * Shared priority used by frontend prefill and backend public rendering.
 * Never returns fake placeholders.
 */
export function resolveDestinationExpertFallbacks(params: {
  expert?: { whatsappNumber?: string | null; phone?: string | null; email?: string | null } | null;
  company?: { phone?: string | null; email?: string | null } | null;
}): { whatsappNumber: string | null; callNumber: string | null; email: string | null } {
  const expertWhatsapp = params.expert?.whatsappNumber?.trim() || null;
  const expertPhone = params.expert?.phone?.trim() || null;
  const companyPhone = params.company?.phone?.trim() || null;
  const expertEmail = params.expert?.email?.trim() || null;
  const companyEmail = params.company?.email?.trim() || null;
  const whatsappNumber = expertWhatsapp || expertPhone || companyPhone || null;
  const callNumber = expertPhone || companyPhone || null;
  const email = expertEmail || companyEmail || null;
  return { whatsappNumber, callNumber, email };
}

export function isDestinationExpertConfigValid(
  config: DestinationExpertConfig | null | undefined,
): boolean {
  if (!config?.enabled || !config.expertUserId) return false;
  return true;
}

/**
 * Public weblink visitor telemetry. Sent by the customer-facing page (no auth):
 * an initial snapshot on load and a final beacon with scroll/time on leave.
 * Every field is optional and bounded — the server adds IP, User-Agent parsing
 * and approximate geolocation. Never carries personally identifying data.
 */
export const quotationTrackSchema = z.object({
  platform: z.string().max(60).optional(),
  language: z.string().max(20).optional(),
  languages: z.string().max(500).optional(),
  clientTimezone: z.string().max(60).optional(),
  screenWidth: z.coerce.number().int().min(0).max(100000).optional(),
  screenHeight: z.coerce.number().int().min(0).max(100000).optional(),
  screenAvailWidth: z.coerce.number().int().min(0).max(100000).optional(),
  screenAvailHeight: z.coerce.number().int().min(0).max(100000).optional(),
  viewportWidth: z.coerce.number().int().min(0).max(100000).optional(),
  viewportHeight: z.coerce.number().int().min(0).max(100000).optional(),
  pixelRatio: z.coerce.number().min(0).max(16).optional(),
  colorDepth: z.coerce.number().int().min(0).max(64).optional(),
  orientation: z.string().max(24).optional(),
  cpuCores: z.coerce.number().int().min(0).max(1024).optional(),
  deviceMemory: z.coerce.number().min(0).max(1024).optional(),
  connectionType: z.string().max(20).optional(),
  connectionDownlink: z.coerce.number().min(0).max(100000).optional(),
  connectionRtt: z.coerce.number().int().min(0).max(600000).optional(),
  online: z.coerce.boolean().optional(),
  referrer: z.string().max(2000).optional(),
  landingUrl: z.string().max(2000).optional(),
  utmSource: z.string().max(120).optional(),
  utmMedium: z.string().max(120).optional(),
  utmCampaign: z.string().max(120).optional(),
  visitorId: z.string().max(60).optional(),
  maxScrollDepth: z.coerce.number().int().min(0).max(100).optional(),
  timeOnPageSeconds: z.coerce.number().int().min(0).max(86400).optional(),
  ctaClicks: z.coerce.number().int().min(0).max(100000).optional(),
  // Short-lived, HMAC-signed staff-view signal minted by the CRM when a signed-in
  // employee opens the weblink from the public (possibly cross-domain) host. It
  // only ever influences HOME vs EXTERNAL analytics classification — never
  // authentication or data access. Optional so ordinary customer beacons are
  // unchanged.
  staffViewToken: z.string().max(2000).optional(),
});
export type QuotationTrackInput = z.infer<typeof quotationTrackSchema>;

export const quotationInputSchema = z.object({
  queryId: z.string().uuid(),
  templateId: z.string().uuid().nullable().optional(),
  sourceVersionId: z.string().uuid().nullable().optional(),
  customerName: z.string().trim().min(2).max(120).optional(),
  customerEmail: z.string().trim().email().max(255).nullable().optional().or(z.literal('')),
  customerPhone: z.string().trim().min(5).max(32).optional(),
  // Optional; an empty/blank summary is accepted (recording one is not required).
  destinationSummary: z.string().trim().max(500).optional(),
  travelStartDate: optionalDate,
  travelEndDate: optionalDate,
  adults: z.coerce.number().int().min(1).max(200).optional(),
  childrenWithBed: z.coerce.number().int().min(0).max(100).optional(),
  childrenWithoutBed: z.coerce.number().int().min(0).max(100).optional(),
  infants: z.coerce.number().int().min(0).max(100).optional(),
  // Optional child ages carried from the Lead (or edited on the quotation) so
  // the PDF and Weblink render the same traveler data.
  childrenWithBedAges: z.array(z.coerce.number().int().min(0).max(30)).max(100).optional(),
  childrenWithoutBedAges: z.array(z.coerce.number().int().min(0).max(30)).max(100).optional(),
  infantAges: z.array(z.coerce.number().int().min(0).max(30)).max(100).optional(),
  // Optional traveller names carried from the Lead (or edited on the
  // quotation) for email drafts. Positional string arrays parallel to the
  // passenger counts; blanks are preserved.
  adultNames: z.array(z.string().trim().max(120)).max(200).optional(),
  childWithBedNames: z.array(z.string().trim().max(120)).max(200).optional(),
  childWithoutBedNames: z.array(z.string().trim().max(120)).max(200).optional(),
  infantNames: z.array(z.string().trim().max(120)).max(200).optional(),
  rooms: z.coerce.number().int().min(1).max(100).optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .optional(),
  validUntil: optionalDate,
  version: quotationVersionInputSchema.innerType().partial().optional(),
});

export const quotationUpdateSchema = quotationInputSchema
  .omit({ queryId: true, templateId: true, sourceVersionId: true, version: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field must be supplied.');

export const quotationSendSchema = z.object({
  quotationVersionId: z.string().uuid(),
  recipientEmail: z.string().trim().email().max(255),
  cc: z.array(z.string().trim().email().max(255)).max(10).default([]),
  subject: optionalText(255),
  message: optionalText(4000),
  includePdf: z.boolean().default(true),
  includePublicLink: z.boolean().default(true),
});

export const publicLinkSchema = z.object({
  quotationVersionId: z.string().uuid().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  // Opt-in: when true the response also carries a `staffViewUrl` — the same
  // public link plus a short-lived signed signal that marks the visit HOME.
  // The ordinary `url` (used for copying/sharing with customers) is unchanged.
  staffView: z.boolean().optional(),
});

export const uploadRequestSchema = z.object({
  quotationVersionId: z.string().uuid().nullable().optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']),
  fileSize: z.coerce.number().int().positive(),
  documentType: z
    .enum(['SUPPORTING_ATTACHMENT', 'HOTEL_IMAGE', 'ITINERARY_IMAGE'])
    .default('SUPPORTING_ATTACHMENT'),
});

export const publicAcceptSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  confirmed: z.literal(true),
  note: optionalText(2000),
});

export const publicRejectSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  note: optionalText(2000),
});

export type QuotationTemplateInput = z.infer<typeof quotationTemplateInputSchema>;
export type QuotationTemplateUpdate = z.infer<typeof quotationTemplateUpdateSchema>;
export type QuotationInput = z.infer<typeof quotationInputSchema>;
export type QuotationUpdate = z.infer<typeof quotationUpdateSchema>;
export type QuotationVersionInput = z.infer<typeof quotationVersionInputSchema>;
export type QuotationVersionUpdate = z.infer<typeof quotationVersionUpdateSchema>;
export type QuotationSendInput = z.infer<typeof quotationSendSchema>;

// ---------------------------------------------------------------------------
// Pricing resolver — single source of truth for Total vs Section-wise pricing
// ---------------------------------------------------------------------------

export type PricingMode = 'SECTION_WISE' | 'PER_PERSON';

export function normalizePricingMode(value: unknown): PricingMode {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'SECTION_WISE' || normalized === 'SECTION-WISE' || normalized === 'SECTIONWISE') return 'SECTION_WISE';
  return 'PER_PERSON';
}

export interface SectionPrice {
  id: 'flight' | 'hotel' | 'cruise' | 'vehicle' | 'sightseeing' | 'addon' | 'visa' | 'customCharges' | string;
  label: string;
  amount: number;
  description?: string | null;
  category?: string | null;
}

export interface PaxCounts {
  adults: number;
  childrenWithBed: number;
  childrenWithoutBed: number;
  infants: number;
}

function toNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function paxForLabel(label: string, pax: PaxCounts): number | null {
  const normalized = label.trim().toLowerCase();
  if (normalized === 'adult' || normalized === 'adults') return pax.adults;
  if (normalized === 'cwb' || normalized === 'child with bed' || normalized === 'child_with_bed') return pax.childrenWithBed;
  if (normalized === 'cwob' || normalized === 'child without bed' || normalized === 'child_without_bed') return pax.childrenWithoutBed;
  if (normalized === 'infant' || normalized === 'infants') return pax.infants;
  if (normalized === 'child' || normalized === 'children') return pax.childrenWithBed + pax.childrenWithoutBed;
  return null;
}

export function calculateSightseeingActivityTotal(
  pricingOptions: Array<{ label: string; price: number | string | null | undefined }> | null | undefined,
  pax: PaxCounts,
  basis?: { pricingBasis?: string | null | undefined; pricingQuantity?: number | null | undefined },
): number {
  if (!Array.isArray(pricingOptions) || !pricingOptions.length) return 0;
  const normalizedBasis = typeof basis?.pricingBasis === 'string' ? basis.pricingBasis.trim().toUpperCase() : '';
  const usesTravelerCounts = normalizedBasis === '' || normalizedBasis === 'PER_TRAVELER';
  const quantity = Math.max(
    0,
    Math.floor(basis?.pricingQuantity == null ? 1 : Number(basis.pricingQuantity) || 0),
  );
  let total = 0;
  for (const row of pricingOptions) {
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) continue;
    const price = toNumber(row.price);
    if (usesTravelerCounts) {
      const paxCount = paxForLabel(label, pax);
      total += price * (paxCount === null ? 1 : paxCount);
    } else {
      // PER_GROUP / PER_VEHICLE / PER_DAY / FIXED: traveler counts never apply.
      total += price * quantity;
    }
  }
  return Math.round(total * 100) / 100;
}

export function calculateSightseeingSectionTotal(
  sightseeingDetails: unknown,
  pax: PaxCounts,
): number {
  if (!sightseeingDetails || typeof sightseeingDetails !== 'object') return 0;
  const details = sightseeingDetails as { days?: unknown; amount?: unknown };
  // If days not present, fallback to amount field
  if (!Array.isArray(details.days)) {
    return toNumber((details as { amount?: unknown }).amount);
  }
  let total = 0;
  for (const day of details.days as unknown[]) {
    if (!day || typeof day !== 'object') continue;
    const activities = (day as { activities?: unknown }).activities;
    if (!Array.isArray(activities)) continue;
    for (const activity of activities) {
      if (!activity || typeof activity !== 'object') continue;
      const row = activity as {
        pricingOptions?: unknown;
        pricingBasis?: unknown;
        pricingQuantity?: unknown;
      };
      total += calculateSightseeingActivityTotal(
        row.pricingOptions as never,
        pax,
        typeof row.pricingBasis === 'string' || row.pricingQuantity != null
          ? {
              pricingBasis: typeof row.pricingBasis === 'string' ? row.pricingBasis : null,
              pricingQuantity:
                row.pricingQuantity == null ? null : Number(row.pricingQuantity) || 0,
            }
          : undefined,
      );
    }
  }
  // If no priced activities but amount exists, use amount as fallback
  if (total === 0 && details.amount != null) {
    return toNumber(details.amount);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Flight section total. Only ONE pricing basis is ever active:
 *  - FIXED_TOTAL → the section-level amount.
 *  - PER_TRAVELER → per-traveler rates × the quotation traveler counts, falling
 *    back to the fixed amount when no rates were entered (legacy/image mode).
 */
export function calculateFlightTotal(
  flightDetails: unknown,
  pax: PaxCounts,
): number {
  if (!flightDetails || typeof flightDetails !== 'object') return 0;
  const details = flightDetails as {
    include?: unknown;
    amount?: unknown;
    pricingBasis?: unknown;
    perTraveler?: { adult?: unknown; childWithBed?: unknown; childWithoutBed?: unknown; infant?: unknown } | null;
  };
  if (details.include === false) return 0;
  const fixedAmount = toNumber(details.amount);
  const basis = typeof details.pricingBasis === 'string' ? details.pricingBasis.trim().toUpperCase() : '';
  if (basis === 'PER_TRAVELER') {
    const rates = details.perTraveler ?? {};
    const adult = toNumber(rates.adult);
    const cwb = toNumber(rates.childWithBed);
    const cwob = toNumber(rates.childWithoutBed);
    const infant = toNumber(rates.infant);
    const hasRates = adult !== 0 || cwb !== 0 || cwob !== 0 || infant !== 0;
    if (hasRates) {
      const total =
        adult * pax.adults +
        cwb * pax.childrenWithBed +
        cwob * pax.childrenWithoutBed +
        infant * pax.infants;
      return Math.round(total * 100) / 100;
    }
  }
  return fixedAmount;
}

export function getFlightPerTravelerBreakdown(
  flightDetails: unknown,
  pax: PaxCounts,
): Array<{ label: string; count: number; rate: number; total: number }> | null {
  if (!flightDetails || typeof flightDetails !== 'object') return null;
  const details = flightDetails as {
    include?: unknown;
    pricingBasis?: unknown;
    perTraveler?: { adult?: unknown; childWithBed?: unknown; childWithoutBed?: unknown; infant?: unknown } | null;
  };
  if (details.include === false) return null;
  const basis = typeof details.pricingBasis === 'string' ? details.pricingBasis.trim().toUpperCase() : '';
  if (basis !== 'PER_TRAVELER') return null;
  const rates = details.perTraveler ?? {};
  const adult = toNumber(rates.adult);
  const cwb = toNumber(rates.childWithBed);
  const cwob = toNumber(rates.childWithoutBed);
  const infant = toNumber(rates.infant);
  const hasRates = adult !== 0 || cwb !== 0 || cwob !== 0 || infant !== 0;
  if (!hasRates) return null;
  const rows: Array<{ label: string; count: number; rate: number; total: number }> = [];
  if (pax.adults > 0) rows.push({ label: 'Adult', count: pax.adults, rate: adult, total: Math.round(adult * pax.adults * 100) / 100 });
  if (pax.childrenWithBed > 0) rows.push({ label: 'Child With Bed', count: pax.childrenWithBed, rate: cwb, total: Math.round(cwb * pax.childrenWithBed * 100) / 100 });
  if (pax.childrenWithoutBed > 0) rows.push({ label: 'Child Without Bed', count: pax.childrenWithoutBed, rate: cwob, total: Math.round(cwob * pax.childrenWithoutBed * 100) / 100 });
  if (pax.infants > 0) rows.push({ label: 'Infant', count: pax.infants, rate: infant, total: Math.round(infant * pax.infants * 100) / 100 });
  if (rows.length === 0) return null;
  return rows;
}

/**
 * Hotel stays that contribute to the pricing total, with explicit
 * ALTERNATIVE-OPTION semantics.
 *
 * Stays sharing a non-empty `optionGroupId` are alternatives: only the
 * selected row(s) contribute (when none is selected, the first row of the
 * group is treated as the default so configuration is never silently
 * dropped). Stays WITHOUT a group are consecutive stays and contribute
 * whenever they are not explicitly deselected.
 */
export function filterContributingHotelRows(rows: unknown[]): unknown[] {
  const groups = new Map<string, unknown[]>();
  const contributing: unknown[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const groupId =
      typeof (row as { optionGroupId?: unknown }).optionGroupId === 'string'
        ? ((row as { optionGroupId?: unknown }).optionGroupId as string).trim()
        : '';
    if (!groupId) {
      if ((row as { selected?: unknown }).selected !== false) contributing.push(row);
      continue;
    }
    const bucket = groups.get(groupId);
    if (bucket) bucket.push(row);
    else groups.set(groupId, [row]);
  }
  for (const [, bucket] of groups) {
    // A group contributes exactly ONE option: the first explicitly selected
    // row, else the first row of the group (default option never dropped).
    const selected = bucket.find((row) => (row as { selected?: unknown }).selected !== false);
    contributing.push(selected ?? bucket[0]!);
  }
  return contributing;
}

/** Meal-plan selections of one hotel option, as a plain record list. */
function hotelMealPlanLinesOf(row: Record<string, unknown>): Array<Record<string, unknown>> {
  const stored = Array.isArray(row.mealPlanLines) ? (row.mealPlanLines as unknown[]) : [];
  return stored.filter(
    (line): line is Record<string, unknown> => Boolean(line) && typeof line === 'object',
  );
}

/**
 * Selling total of ONE hotel stay: per-night room breakdowns (base × rooms ×
 * nights + extra bed + child without bed) across every room allocation, plus
 * every meal-plan line. Falls back to the row's manual sellingPrice exactly
 * when the structured lines price to zero (manual override preserved; the
 * calculated figure is never destroyed).
 */
export function calculateHotelRowTotal(
  row: unknown,
  nightsOverride?: number | null,
): { roomTotal: number; mealTotal: number; total: number } {
  if (!row || typeof row !== 'object') return { roomTotal: 0, mealTotal: 0, total: 0 };
  const r = row as Record<string, unknown>;
  const nightsRaw =
    nightsOverride != null ? nightsOverride : Math.max(0, Math.floor(toNumber(r.nights ?? 1)));
  const nightsFactor = nightsRaw > 0 ? nightsRaw : 1;
  const roomLines = Array.isArray(r.roomLines)
    ? (r.roomLines as Array<Record<string, unknown>>).filter(
        (line): line is Record<string, unknown> => Boolean(line) && typeof line === 'object',
      )
    : [];
  let roomTotal = 0;
  if (roomLines.length > 0) {
    for (const line of roomLines) {
      const hasLineBreakdown =
        line.baseRoomPrice != null || line.extraBedPrice != null || line.childWithoutBedPrice != null;
      if (hasLineBreakdown) {
        const rooms = Math.max(1, Math.floor(toNumber(line.rooms ?? 1)));
        roomTotal +=
          toNumber(line.baseRoomPrice) * rooms * nightsFactor +
          toNumber(line.extraBedPrice) * Math.max(0, Math.floor(toNumber(line.extraBedQuantity))) * nightsFactor +
          toNumber(line.childWithoutBedPrice) * Math.max(0, Math.floor(toNumber(line.childWithoutBedQuantity))) * nightsFactor;
      } else if (line.sellingPrice != null) {
        roomTotal += toNumber(line.sellingPrice);
      }
    }
  } else {
    const hasBreakdown =
      r.baseRoomPrice != null || r.extraBedPrice != null || r.childWithoutBedPrice != null;
    if (hasBreakdown) {
      const rooms = Math.max(1, Math.floor(toNumber(r.rooms ?? 1)));
      roomTotal =
        toNumber(r.baseRoomPrice) * rooms * nightsFactor +
        toNumber(r.extraBedPrice) * Math.max(0, Math.floor(toNumber(r.extraBedQuantity))) * nightsFactor +
        toNumber(r.childWithoutBedPrice) * Math.max(0, Math.floor(toNumber(r.childWithoutBedQuantity))) * nightsFactor;
    } else {
      roomTotal = toNumber(r.sellingPrice);
    }
  }
  let mealTotal = 0;
  for (const line of hotelMealPlanLinesOf(r)) {
    mealTotal += toNumber(line.sellingPrice);
  }
  const roomRounded = Math.round(roomTotal * 100) / 100;
  const mealRounded = Math.round(mealTotal * 100) / 100;
  const structured = roomRounded + mealRounded;
  // Manual override: structured lines priced to zero but a row total exists.
  if (structured === 0 && r.sellingPrice != null && toNumber(r.sellingPrice) !== 0) {
    const fallback = Math.round(toNumber(r.sellingPrice) * 100) / 100;
    return { roomTotal: fallback, mealTotal: 0, total: fallback };
  }
  return { roomTotal: roomRounded, mealTotal: mealRounded, total: Math.round(structured * 100) / 100 };
}

export interface TravelerPriceRow {
  /** Stable row identity (traveler key or custom-item id) used for ordering. */
  id: string;
  label: string;
  count: number;
  price: number;
  total: number;
}

/** Canonical ids of the four By Traveler breakdown rows, in default order. */
export const TRAVELER_PRICING_ROW_IDS = ['adults', 'cwb', 'cwob', 'infants'] as const;

/**
 * Customer-friendly display labels for the shared traveler pricing rows
 * (`TravelerPriceRow.label` is 'Adults' | 'CWB' | 'CWOB' | 'Infants').
 * Single source of truth for every Price Breakdown renderer (public weblink,
 * Weblink PDF via the shared weblink view, builder live preview) so the
 * wording can never drift between surfaces.
 */
export const TRAVELER_BREAKDOWN_LABELS: Record<string, string> = {
  Adults: 'Adults',
  CWB: 'Child With Bed (CWB)',
  CWOB: 'Child Without Bed (CWOB)',
  Infants: 'Infants',
};

/**
 * Order Price Breakdown rows by a saved `pricingRowOrder`. Rows whose id is not
 * listed keep their relative order and are placed after the listed ones. Pure
 * and stable, so it is safe to call from both the builder and the renderer.
 */
export function orderPricingRows<T extends { id: string }>(
  rows: T[],
  order: readonly string[] | null | undefined,
): T[] {
  if (!Array.isArray(order) || order.length === 0) return rows;
  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rankA = rank.has(a.row.id) ? rank.get(a.row.id)! : Number.MAX_SAFE_INTEGER;
      const rankB = rank.has(b.row.id) ? rank.get(b.row.id)! : Number.MAX_SAFE_INTEGER;
      return rankA === rankB ? a.index - b.index : rankA - rankB;
    })
    .map((entry) => entry.row);
}

export interface QuotationPricing {
  pricingMode: PricingMode;
  /** Σ per-traveler price × count — authoritative ONLY in PER_PERSON mode. */
  packageTotal: number;
  /** Sum of every section amount (incl. visa). Authoritative ONLY in
   *  SECTION_WISE mode. */
  sectionTotal: number;
  currency: string;
  sections: SectionPrice[];
  /** Pre-adjustment amount of the ACTIVE pricing method. */
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  /** The single authoritative customer total: subtotal − discount + tax,
   *  computed from the ACTIVE pricing method only (never both). */
  grandTotal: number;
  /** Per-traveler package breakdown (rows for adults/CWB/CWOB/infants). */
  travelerPricing: {
    rows: TravelerPriceRow[];
    subtotal: number;
  };
  /** Additional fixed-price line items (By Traveler only). Each amount is a
   *  flat package charge, never multiplied by the traveler count. Included in
   *  `packageTotal`, `subtotal` and `grandTotal` when PER_PERSON is active. */
  customItems: {
    rows: Array<{ id: string; label: string; amount: number }>;
    subtotal: number;
  };
  /** Saved builder row order for the By Traveler breakdown (empty = default). */
  pricingRowOrder: string[];
  allocatedAmount: number;
  remainingAmount: number;
  overallocatedAmount: number;
  isOverallocated: boolean;
  isExactlyAllocated: boolean;
}

/**
 * The one authoritative service-row → section mapping. Used by the shared
 * resolver, the backend pricing engine and the validators so a service row can
 * never be counted twice or land in different sections in different layers.
 */
export type ServiceSectionBucket = 'flight' | 'cruise' | 'vehicle' | 'sightseeing' | 'addon';

export function classifyServiceBucket(serviceType: unknown): ServiceSectionBucket {
  switch (String(serviceType ?? '')) {
    case 'FLIGHT':
      return 'flight';
    case 'CRUISE':
      return 'cruise';
    case 'VEHICLE_TRANSFER':
      return 'vehicle';
    case 'SIGHTSEEING':
      return 'sightseeing';
    default:
      return 'addon';
  }
}

export function resolveQuotationPricing(input: {
  version: {
    pricingMode?: unknown;
    finalAmount?: unknown;
    currency?: unknown;
    flightDetails?: unknown;
    hotelDetails?: unknown;
    hotels?: unknown;
    sightseeingDetails?: unknown;
    addOnDetails?: unknown;
    services?: unknown;
    includeVisa?: unknown;
    visaAmount?: unknown;
    visaServiceCharge?: unknown;
    visaGstPercent?: unknown;
    visaVfsCharge?: unknown;
    customCharges?: unknown;
    // Additional Price Items — fixed package charges for By Traveler pricing.
    packageCustomItems?: unknown;
    // Builder-only By Traveler breakdown row order (stable row ids).
    pricingRowOrder?: unknown;
    // Adjustment pipeline — applied ONCE to the active method's subtotal.
    discountAmount?: unknown;
    taxRate?: unknown;
    // Per-traveler package rates.
    perAdultPrice?: unknown;
    perChildWithBedPrice?: unknown;
    perChildWithoutBedPrice?: unknown;
    perInfantPrice?: unknown;
  };
  quotation: {
    adults?: unknown;
    childrenWithBed?: unknown;
    childrenWithoutBed?: unknown;
    infants?: unknown;
    currency?: unknown;
  };
}): QuotationPricing {
  const pricingMode = normalizePricingMode(input.version.pricingMode);
  const currency =
    (typeof input.version.currency === 'string' && input.version.currency.trim()) ||
    (typeof input.quotation.currency === 'string' && input.quotation.currency.trim()) ||
    'INR';
  const storedFinalAmount = Math.round(toNumber(input.version.finalAmount) * 100) / 100;

  const pax: PaxCounts = {
    adults: Math.max(0, Math.floor(toNumber(input.quotation.adults))),
    childrenWithBed: Math.max(0, Math.floor(toNumber(input.quotation.childrenWithBed))),
    childrenWithoutBed: Math.max(0, Math.floor(toNumber(input.quotation.childrenWithoutBed))),
    infants: Math.max(0, Math.floor(toNumber(input.quotation.infants))),
  };

  // ---- Traveler-wise (package) pricing -------------------------------------
  const perAdult = toNumber(input.version.perAdultPrice);
  const perCwb = toNumber(input.version.perChildWithBedPrice);
  const perCwob = toNumber(input.version.perChildWithoutBedPrice);
  const perInfant = toNumber(input.version.perInfantPrice);
  const travelerRows: TravelerPriceRow[] = [
    { id: 'adults', label: 'Adults', count: pax.adults, price: perAdult },
    { id: 'cwb', label: 'CWB', count: pax.childrenWithBed, price: perCwb },
    { id: 'cwob', label: 'CWOB', count: pax.childrenWithoutBed, price: perCwob },
    { id: 'infants', label: 'Infants', count: pax.infants, price: perInfant },
  ]
    .map((row) => ({ ...row, total: Math.round(row.price * row.count * 100) / 100 }))
    .filter((row) => row.count > 0 && row.price > 0);
  const travelerSubtotal =
    Math.round(
      (perAdult * pax.adults +
        perCwb * pax.childrenWithBed +
        perCwob * pax.childrenWithoutBed +
        perInfant * pax.infants) *
        100,
    ) / 100;
  // ---- Additional Price Items (By Traveler only) ---------------------------
  // Fixed package charges entered in the Pricing tab, added on top of the
  // per-traveler subtotal. Never multiplied by traveler counts. Only valid
  // positive-amount rows contribute, so a blank/invalid/negative amount can
  // never corrupt the total. Excluded from SECTION_WISE pricing entirely.
  const packageCustomItemsRaw = (input.version.packageCustomItems ?? []) as Array<{
    id?: unknown;
    label?: unknown;
    amount?: unknown;
  }>;
  const customItemRows =
    pricingMode === 'SECTION_WISE'
      ? []
      : packageCustomItemsRaw
          .filter(
            (item) =>
              item != null &&
              typeof item.label === 'string' &&
              item.label.trim().length > 0 &&
              toNumber(item.amount) > 0,
          )
          .slice(0, 50)
          .map((item, index) => ({
            id:
              typeof item.id === 'string' && item.id.trim()
                ? item.id.trim().slice(0, 64)
                : `custom-${index}`,
            label: String(item.label).trim().slice(0, 100),
            amount: Math.round(toNumber(item.amount) * 100) / 100,
          }));
  const customItemsSubtotal =
    Math.round(customItemRows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
  // Builder-only By Traveler breakdown row order (stable row ids).
  const pricingRowOrder = Array.isArray(input.version.pricingRowOrder)
    ? (input.version.pricingRowOrder as unknown[])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim().slice(0, 64))
        .slice(0, 80)
    : [];
  // Legacy quotations carry only a stored final total (no per-traveler
  // rates); the stored amount is the package total in that case. Fixed custom
  // items are part of the package total whenever the quotation is
  // traveler-priced.
  const packageTotal =
    travelerSubtotal > 0
      ? Math.round((travelerSubtotal + customItemsSubtotal) * 100) / 100
      : customItemsSubtotal > 0
        ? customItemsSubtotal
        : storedFinalAmount;

  // ---- Section-wise pricing -------------------------------------------------
  const flightFixedAmount = calculateFlightTotal(input.version.flightDetails, pax);
  // Each hotel stay stores its own quotation price. Only contributing stays
  // count: deselected rows and non-selected ALTERNATIVE options never do.
  const hotelIncluded =
    (input.version.hotelDetails as { include?: boolean } | null)?.include !== false;
  const hotelRows = Array.isArray(input.version.hotels) ? (input.version.hotels as unknown[]) : [];
  const hotelAmount = !hotelIncluded
    ? 0
    : hotelRows.length > 0
      ? filterContributingHotelRows(hotelRows).reduce<number>(
          (sum, row) => sum + calculateHotelRowTotal(row).total,
          0,
        )
      : toNumber((input.version.hotelDetails as { amount?: unknown } | null)?.amount);

  const services = Array.isArray(input.version.services) ? (input.version.services as unknown[]) : [];

  const sumServices = (predicate: (row: Record<string, unknown>) => boolean): number => {
    let sum = 0;
    for (const row of services) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      if (!predicate(r)) continue;
      // Cruise with structured multi-room + nights uses per-night total
      if (r.serviceType === 'CRUISE' && (Array.isArray(r.cruiseRoomLines) || r.cruiseNights != null)) {
        const cruiseTotal = calculateCruiseRoomLinesTotal(r, r.cruiseNights != null ? toNumber(r.cruiseNights) : null);
        // If cruiseRoomLines present, cruiseTotal is authoritative; fallback to legacy quantity*price already handled inside helper
        sum += cruiseTotal;
        continue;
      }
      const quantity = toNumber(r.quantity ?? 1);
      const unitPrice = toNumber(r.unitSellingPrice ?? r.sellingPrice);
      const total = r.totalSellingPrice != null ? toNumber(r.totalSellingPrice) : quantity * unitPrice;
      sum += total;
    }
    return Math.round(sum * 100) / 100;
  };

  // Section enable flags. A disabled section contributes ₹0 while its stored
  // configuration is preserved. Legacy snapshots without a flag (or without
  // the details object at all) stay enabled — backward compatible.
  const flightDetailsRec = input.version.flightDetails as
    | { include?: boolean; amount?: unknown }
    | null
    | undefined;
  const sightseeingDetailsRec = input.version.sightseeingDetails as
    | { include?: boolean }
    | null
    | undefined;
  const addOnDetailsRec = input.version.addOnDetails as { include?: boolean } | null | undefined;
  const flightSectionEnabled = flightDetailsRec?.include !== false;
  const sightseeingSectionEnabled = sightseeingDetailsRec?.include !== false;
  const addOnSectionEnabled = addOnDetailsRec?.include !== false;

  // Flight section: structured flight pricing plus any legacy FLIGHT service
  // rows — every service row is counted in exactly one section, never twice.
  const flightSectionServiceAmount = flightSectionEnabled
    ? sumServices((r) => classifyServiceBucket(r.serviceType) === 'flight')
    : 0;
  const flightAmount =
    Math.round((flightFixedAmount + flightSectionServiceAmount) * 100) / 100;
  const cruiseAmount = sumServices((r) => classifyServiceBucket(r.serviceType) === 'cruise');
  const vehicleAmount = sumServices((r) => classifyServiceBucket(r.serviceType) === 'vehicle');
  // Day-wise activity pricing plus any legacy SIGHTSEEING service rows —
  // every service row is counted in exactly one section, never twice.
  const sightseeingServiceAmount = sightseeingSectionEnabled
    ? sumServices((r) => classifyServiceBucket(r.serviceType) === 'sightseeing')
    : 0;
  const sightseeingAmount = !sightseeingSectionEnabled
    ? 0
    : Math.round(
        (calculateSightseeingSectionTotal(input.version.sightseeingDetails, pax) +
          sightseeingServiceAmount) *
          100,
      ) / 100;
  const addonAmount = !addOnSectionEnabled
    ? 0
    : sumServices((r) => classifyServiceBucket(r.serviceType) === 'addon');
  // Visa is a single dedicated section: base visa amount plus the service
  // charge, its GST, and the VFS charge — mirroring the builder's consolidated
  // visa total. Kept out of the sum when the visa section is excluded.
  const visaIncluded = input.version.includeVisa !== false;
  const visaAmountRaw = toNumber(input.version.visaAmount);
  const visaServiceCharge = toNumber(input.version.visaServiceCharge);
  const visaGstPercent = toNumber(input.version.visaGstPercent);
  const visaVfsCharge = toNumber(input.version.visaVfsCharge);
  const visaAmount = !visaIncluded
    ? 0
    : Math.round(
        (visaAmountRaw +
          visaServiceCharge +
          (visaServiceCharge * visaGstPercent) / 100 +
          visaVfsCharge) *
          100,
      ) / 100;

  const isSectionWise = pricingMode === 'SECTION_WISE';
  const customChargesRaw = (input.version.customCharges ?? []) as Array<{ label?: unknown; amount?: unknown; description?: unknown; category?: unknown }>;
  const extraChargeSections: SectionPrice[] = isSectionWise
    ? customChargesRaw
        .filter((c) => typeof c.label === 'string' && c.label.trim() && toNumber(c.amount) > 0)
        .map((c, idx) => ({
          id: `extra-${idx}-${String(c.label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}`,
          label: String(c.label).trim(),
          amount: Math.round(toNumber(c.amount) * 100) / 100,
          description: typeof c.description === 'string' ? c.description.trim().slice(0, 500) || null : null,
          category: typeof c.category === 'string' ? c.category.trim().slice(0, 50) || null : null,
        }))
    : [];

  const sections: SectionPrice[] = [
    { id: 'flight', label: 'Flights', amount: flightAmount },
    { id: 'hotel', label: 'Hotels', amount: hotelAmount },
    { id: 'cruise', label: 'Cruise', amount: cruiseAmount },
    { id: 'vehicle', label: 'Vehicle/Transportation', amount: vehicleAmount },
    { id: 'sightseeing', label: 'Sightseeing', amount: sightseeingAmount },
    { id: 'addon', label: 'Add-on Services', amount: addonAmount },
    { id: 'visa', label: 'Visa', amount: visaAmount },
    ...extraChargeSections,
  ];

  // allocated is the sum of all section amounts (incl. visa). For SECTION_WISE
  // pricing the sections ARE the price, so the section total is the quotation
  // total. For TOTAL pricing the authoritative total stays the package total.
  const allocatedAmount = Math.round(sections.reduce((sum, s) => sum + s.amount, 0) * 100) / 100;
  const sectionTotal = allocatedAmount;
  const remainingRaw = Math.round((packageTotal - allocatedAmount) * 100) / 100;
  const isOverallocated = remainingRaw < 0;
  const overallocatedAmount = isOverallocated ? Math.abs(remainingRaw) : 0;
  const remainingAmount = isOverallocated ? 0 : remainingRaw;
  const isExactlyAllocated = remainingRaw === 0;

  // ---- Adjustment pipeline: subtotal → discount → tax → grand total --------
  // Only the ACTIVE pricing method's subtotal enters the pipeline, so section
  // prices and traveler prices can NEVER be added together.
  const subtotal = pricingMode === 'SECTION_WISE' ? sectionTotal : packageTotal;
  const discountAmount = Math.round(toNumber(input.version.discountAmount) * 100) / 100;
  const taxableAmount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
  const taxRate = toNumber(input.version.taxRate);
  const taxAmount = Math.round(taxableAmount * taxRate) / 100;
  const grandTotal = Math.round((taxableAmount + taxAmount) * 100) / 100;

  return {
    pricingMode,
    packageTotal,
    sectionTotal,
    currency: currency.toUpperCase(),
    sections,
    subtotal,
    discountAmount,
    taxableAmount,
    taxRate,
    taxAmount,
    grandTotal,
    travelerPricing: { rows: travelerRows, subtotal: travelerSubtotal },
    customItems: { rows: customItemRows, subtotal: customItemsSubtotal },
    pricingRowOrder,
    allocatedAmount,
    remainingAmount,
    overallocatedAmount,
    isOverallocated,
    isExactlyAllocated,
  };
}

// ---------------------------------------------------------------------------
// Pricing completeness validation — shared by the builder UI and the backend
// finalization gate. Missing pricing is NEVER treated as a valid ₹0 price.
// ---------------------------------------------------------------------------

export interface PricingIssue {
  severity: 'ERROR' | 'WARNING';
  section: string;
  message: string;
}

export function validateQuotationPricing(input: {
  version: Parameters<typeof resolveQuotationPricing>[0]['version'];
  quotation: Parameters<typeof resolveQuotationPricing>[0]['quotation'];
}): PricingIssue[] {
  const pricing = resolveQuotationPricing(input);
  const version = input.version;
  const issues: PricingIssue[] = [];
  const v = (key: string): unknown =>
    (version as Record<string, unknown>)[key as keyof typeof version];

  const flightDetails = v('flightDetails') as
    | { include?: boolean; entryMode?: string; amount?: unknown; pricingBasis?: string; perTraveler?: Record<string, unknown> }
    | null
    | undefined;
  const hotelDetails = v('hotelDetails') as { include?: boolean; amount?: unknown } | null | undefined;
  const sightseeingDetails = v('sightseeingDetails') as { include?: boolean } | null | undefined;

  // BY_TRAVELER means pricing is entered centrally in Summary & Pricing.
  // No section-level pricing is required; the quotation is complete iff the
  // traveler package total is configured. This must be the single source of
  // truth for PER_PERSON mode — do NOT fall through to section checks.
  if (pricing.pricingMode === 'PER_PERSON') {
    if (pricing.travelerPricing.subtotal > 0 || pricing.customItems.subtotal > 0) {
      // Real per-traveler prices (or fixed additional price items) exist — the
      // package total is authoritative.
      return issues;
    }
    issues.push({
      severity: 'ERROR',
      section: 'pricing',
      message: 'Traveler pricing is incomplete. Enter per-traveler prices or configure section pricing.',
    });
    return issues;
  }

  // SECTION_WISE — every ENABLED section must carry a real price. A section
  // that was never configured (null details) is not treated as enabled.
  // Flight specifics: IMAGE-mode sections carry the fare inside the uploaded
  // ticket image (no structured amount to require), and auto-seeded skeleton
  // sections (template airline rows without real segment data) are treated as
  // display-only until the agent prices them.
  const flightSegments =
    flightDetails && typeof flightDetails === 'object'
      ? [
          ...(((flightDetails as { outbound?: { segments?: unknown[] } }).outbound?.segments ??
            []) as unknown[]),
          ...(((flightDetails as { returnJourney?: { segments?: unknown[] } }).returnJourney
            ?.segments ?? []) as unknown[]),
        ]
      : [];
  const flightHasRealSegments = flightSegments.some((segment) => {
    if (!segment || typeof segment !== 'object') return false;
    const s = segment as { flightNumber?: unknown; from?: unknown; to?: unknown; departureDate?: unknown };
    return Boolean(s.flightNumber || s.from || s.to || s.departureDate);
  });
  if (flightDetails && flightDetails.include !== false && flightDetails.entryMode !== 'IMAGE') {
    const hasRates =
      flightDetails.pricingBasis === 'PER_TRAVELER' &&
      Object.values(flightDetails.perTraveler ?? {}).some((rate) => toNumber(rate) > 0);
    if (!hasRates && toNumber(flightDetails.amount) <= 0 && flightHasRealSegments) {
      issues.push({
        severity: 'ERROR',
        section: 'flight',
        message: 'Flight selling price is required.',
      });
    }
  }
  const hotelRows = Array.isArray(v('hotels')) ? (v('hotels') as unknown[]) : [];
  const hotelEnabled = hotelDetails != null && hotelDetails.include !== false;
  const hotelContributingTotal = hotelRows.reduce<number>(
    (sum, row) => sum + calculateHotelRowTotal(row).total,
    0,
  );
  if (hotelContributingTotal <= 0) {
    if (hotelEnabled) {
      issues.push({
        severity: 'ERROR',
        section: 'hotel',
        message: 'Hotel pricing is incomplete.',
      });
    } else if (hotelRows.length > 0) {
      // Legacy rows (or DB-seeded stays) without a configured Hotel section
      // only warn — legacy quotations never carried a section flag.
      issues.push({
        severity: 'WARNING',
        section: 'hotel',
        message: 'Hotel stays have no selling price configured.',
      });
    }
  }
  const services = Array.isArray(v('services')) ? (v('services') as unknown[]) : [];
  // Quotations created from a lead seed zero-priced placeholder rows for every
  // requested service type. A placeholder row may only block finalization when
  // the quotation is genuinely section-priced — otherwise the global
  // zero-total gate below handles it.
  const sectionPriced = pricing.sectionTotal > 0;
  for (const row of services) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const quantity = toNumber(r.quantity ?? 1);
    const total =
      r.totalSellingPrice != null
        ? toNumber(r.totalSellingPrice)
        : quantity * toNumber(r.unitSellingPrice ?? r.sellingPrice);
    if (total > 0) continue;
    if (r.serviceType === 'CRUISE' && sectionPriced) {
      issues.push({
        severity: 'ERROR',
        section: 'cruise',
        message: 'Cruise pricing is incomplete. Select a cabin rate or enter a selling price.',
      });
    }
    if (r.serviceType === 'VEHICLE_TRANSFER' && sectionPriced) {
      issues.push({
        severity: 'ERROR',
        section: 'vehicle',
        message: 'Vehicle pricing is required. Choose a pricing basis and rate.',
      });
    }
  }
  if (
    sightseeingDetails &&
    sightseeingDetails.include !== false &&
    pricing.sections.find((s) => s.id === 'sightseeing')?.amount === 0
  ) {
    issues.push({
      severity: 'WARNING',
      section: 'sightseeing',
      message: 'Sightseeing section is enabled but has no priced activities.',
    });
  }
  if (
    v('includeVisa') !== false &&
    pricing.sections.find((s) => s.id === 'visa')?.amount === 0 &&
    (v('visaType') != null || v('visaDestination') != null)
  ) {
    issues.push({
      severity: 'WARNING',
      section: 'visa',
      message: 'Visa section is enabled but has no charges configured.',
    });
  }
  if (pricing.sectionTotal <= 0 && pricing.travelerPricing.subtotal <= 0) {
    // A quotation with NO priced content at all (legacy empty draft, including
    // the zero-priced placeholder service rows seeded from the lead) only
    // warns; one that carries real pricing configuration but no prices is
    // invalid and must not be finalized.
    const serviceTotal = (row: Record<string, unknown>): number => {
      const quantity = toNumber(row.quantity ?? 1);
      return row.totalSellingPrice != null
        ? toNumber(row.totalSellingPrice)
        : quantity * toNumber(row.unitSellingPrice ?? row.sellingPrice);
    };
    const hasAnyPricingConfig =
      flightDetails != null &&
      (toNumber((flightDetails as { amount?: unknown }).amount) > 0 ||
        Object.values((flightDetails as { perTraveler?: Record<string, unknown> }).perTraveler ?? {}).some(
          (rate) => toNumber(rate) > 0,
        )) ||
      hotelDetails != null ||
      hotelRows.some((row) => calculateHotelRowTotal(row).total > 0) ||
      services.some(
        (row): row is Record<string, unknown> =>
          Boolean(row) &&
          typeof row === 'object' &&
          (row as Record<string, unknown>).serviceType !== 'HOTEL' &&
          serviceTotal(row as Record<string, unknown>) > 0,
      ) ||
      toNumber(v('visaAmount')) > 0 ||
      toNumber(v('visaServiceCharge')) > 0 ||
      toNumber(v('visaVfsCharge')) > 0;
    issues.push({
      severity: hasAnyPricingConfig ? 'ERROR' : 'WARNING',
      section: 'pricing',
      message: hasAnyPricingConfig
        ? 'Quotation pricing is incomplete. No enabled section carries a selling price.'
        : 'Quotation has no pricing configured yet.',
    });
  }
  return issues;
}

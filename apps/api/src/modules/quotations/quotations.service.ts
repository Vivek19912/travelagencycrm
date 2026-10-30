import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import {
  flightDetailsSchema,
  normalizeFlightDetails,
  sightseeingDetailsSchema,
  calculateCruiseRoomLinesTotal,
  PERMISSIONS,
  normalizePublicSlug,
  isReservedPublicSlug,
  friendlySlugCandidates,
  PUBLIC_SLUG_MAX_LENGTH,
  quotationSnapshotImageIdentity,
  normalizeFaqs,
  resolveWeblinkSectionOrder,
  normalizeDestinationExpertConfig,
  validateQuotationPricing,
  normalizeStylishPdfPage1,
  type StylishPdfPage1,
  SERVICE_PRICING_BASES,
  normalizePricingSnapshotEntries,
  type QuotationSnapshotImage,
  type DestinationExpertConfig,
  type QuotationInput,
  type QuotationSendInput,
  type QuotationUpdate,
  type QuotationVersionInput,
  type QuotationVersionUpdate,
  type QuotationWeblinkSettings,
  type QuotationTrackInput,
} from '@interscale/shared';
import type { AuthContext } from '../../middleware/authenticate.js';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { generateSecureToken, hashToken } from '../../utils/crypto.js';
import { mintStaffViewToken, verifyStaffViewToken } from './staff-view-token.js';
import { geolocateIp, parseUserAgent } from './weblink-enrichment.js';
import { resolvePagination } from '../../utils/pagination.js';
import { permissionsService } from '../auth/permissions.service.js';
import {
  getVisible as getVisibleLead,
  visibility as leadVisibility,
} from '../queries/queries.service.js';
import { templateInclude } from '../quotation-templates/quotation-templates.service.js';
import { calculatePricing } from './pricing.service.js';
import { validateMasterRefs, type RetainedMasterRefs } from './master-refs.service.js';
import { resolveHotelRoomPricing } from './hotel-pricing-resolver.js';
import { renderQuotationPdf, type QuotationPdfInput } from './pdf.service.js';
import { renderStylishQuotationPdf } from './stylish-pdf.service.js';
import { buildWeblinkPdfUrl, renderWeblinkPdfFromUrl, sanitizeWeblinkPdfError } from './weblink-browser-pdf.service.js';
import {
  preferredPublicAppBaseUrl,
  friendlyPublicSlugBaseUrl,
} from '../custom-domains/custom-domain.service.js';
import { loadCompanyBranding } from '../../services/pdf/company-branding.js';
import { webpToPng } from '../../services/pdf/webp-to-png.js';
import {
  quotationObjectKey,
  sanitizeFileName,
  storageService,
  stylishPage1ImageObjectKey,
} from '../../services/storage/storage.service.js';
import { emailService } from '../../services/email/email.service.js';
import { nextCompanyNumber, quotationAudit, type RequestContext } from './quotation.utils.js';
import { recalculateCustomerMetrics } from '../customers/customers.service.js';
import { reminderProcessor } from '../reminders/reminder-processor.service.js';
import {
  effectiveMasterImages,
  type LegacyImageFields,
  type StoredMasterImage,
} from '../masters/master-images.js';
import { getSystemCompanyId } from '../masters/master-visibility.js';
import { logger } from '../../config/logger.js';

const userSelect = { id: true, fullName: true, username: true } as const;

type QuotationPdfOptions = {
  style: 'CLASSIC' | 'STYLISH' | 'WEBLINK';
  coverSource: 'DESTINATION' | 'UPLOAD';
  coverImageDataUrl?: string;
  /**
   * Stylish Page 1 manual overrides. The hero data URL replaces the
   * destination-master hero for the cover only; each card data URL replaces
   * one of the three sightseeing gallery slots. Sparse — missing slots keep
   * their calculated defaults. Never touches Classic PDF / weblink data.
   */
  page1HeroImageDataUrl?: string;
  page1CardImageDataUrls?: Array<string | null | undefined>;
};

async function decodePdfCoverImage(dataUrl: string | undefined): Promise<Buffer> {
  const match = dataUrl?.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z\d+/=]+)$/i);
  if (!match) throw new ValidationError('The stylish cover must be a JPEG, PNG, or WebP image.');
  const buffer = Buffer.from(match[2]!, 'base64');
  if (buffer.length < 12 || buffer.length > 5 * 1024 * 1024)
    throw new ValidationError('The stylish cover image must be between 12 bytes and 5 MB.');
  return (await webpToPng(buffer)) ?? buffer;
}

/**
 * Normalize a client IP for weblink analytics. IPv4-mapped IPv6 is unwrapped
 * (::ffff:a.b.c.d → a.b.c.d), whitespace is trimmed, and an unresolvable value
 * falls back to a safe internal sentinel so the aggregate row always has a key.
 */
export function normalizeWeblinkIp(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '0.0.0.0';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

/**
 * Customer-friendly Weblink PDF filename: `{customer-slug}-quotation.pdf`.
 *
 * Weblink-only: Classic (`<number>-<customer>-v<n>-quotation.pdf`) and Stylish
 * (`...-stylish-quotation.pdf`) keep their archival names. The customer name
 * is lowercased, runs of non-alphanumerics collapse to one hyphen, and
 * leading/trailing hyphens are trimmed (`Vikas Sahni` →
 * `vikas-sahni-quotation.pdf`). An empty name falls back to `quotation.pdf`.
 * The caller still passes the result through `sanitizeFileName`.
 */
export function weblinkPdfFileName(customerName: string | null | undefined): string {
  const slug = (customerName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return `${slug ? `${slug}-` : ''}quotation.pdf`;
}

/**
 * Whether a weblink load should be classified HOME. True only when the request
 * is a verified session of the owning company, OR it carries a valid signed
 * staff-view signal bound to this company and quotation. Anonymous visitors,
 * users of another company, and tampered/expired signals all resolve to
 * EXTERNAL. Never throws.
 */
function isHomeWeblinkView(
  authCompanyId: string | null | undefined,
  staffViewToken: string | null | undefined,
  quotation: { id: string; companyId: string },
): boolean {
  if (authCompanyId && authCompanyId === quotation.companyId) return true;
  return verifyStaffViewToken(staffViewToken ?? null, {
    companyId: quotation.companyId,
    quotationId: quotation.id,
  });
}

/** Append the signed staff-view signal to a public URL as `?stv=`/`&stv=`. */
function withStaffViewToken(url: string, token: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}stv=${encodeURIComponent(token)}`;
}

/** One aggregated visitor row in the weblink analytics response. */
export interface WeblinkAnalyticsEntry {
  ipAddress: string;
  type: 'HOME' | 'EXTERNAL';
  views: number;
  firstViewedAt: string;
  lastViewedAt: string;
  // Best-effort visitor snapshot (any may be null on older/limited views).
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceType: string | null;
  deviceVendor: string | null;
  deviceModel: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  latitude: number | null;
  longitude: number | null;
  clientTimezone: string | null;
  language: string | null;
  languages: string | null;
  platform: string | null;
  userAgent: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  screenAvailWidth: number | null;
  screenAvailHeight: number | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  pixelRatio: number | null;
  colorDepth: number | null;
  orientation: string | null;
  cpuCores: number | null;
  deviceMemory: number | null;
  connectionType: string | null;
  connectionDownlink: number | null;
  connectionRtt: number | null;
  online: boolean | null;
  referrer: string | null;
  landingUrl: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  visitorId: string | null;
  maxScrollDepth: number | null;
  timeOnPageSeconds: number | null;
  ctaClicks: number | null;
}

export interface WeblinkAnalytics {
  totalViews: number;
  externalViews: number;
  homeIpViews: number;
  uniqueIps: number;
  entries: WeblinkAnalyticsEntry[];
}

/** Deterministic upper bound on IP rows returned in the analytics modal. */
const WEBLINK_ANALYTICS_ROW_LIMIT = 200;
export const versionInclude = {
  createdBy: { select: userSelect },
  itinerary: { orderBy: { sequence: 'asc' as const } },
  hotels: { orderBy: { sequence: 'asc' as const } },
  services: { orderBy: { sequence: 'asc' as const } },
  inclusions: { orderBy: { sequence: 'asc' as const } },
  exclusions: { orderBy: { sequence: 'asc' as const } },
  terms: { orderBy: { sequence: 'asc' as const } },
} as const;
const quotationInclude = {
  customer: { select: { id: true, customerNumber: true, displayName: true } },
  query: {
    select: {
      id: true,
      queryNumber: true,
      leadStage: true,
      assignedToId: true,
      createdById: true,
      // Used to prefill the quotation Flight tab's departure city.
      departureCity: true,
      departureCountry: true,
      // Lead-requested services drive the quotation builder's tab asterisks and
      // default Include-in-Quotation state for NEW quotations.
      services: { select: { serviceType: true } },
      itinerary: {
        orderBy: { sequence: 'asc' as const },
        select: {
          id: true,
          country: true,
          destination: true,
          nights: true,
          sequence: true,
          arrivalDate: true,
          departureDate: true,
        },
      },
    },
  },
  createdBy: { select: userSelect },
  versions: { include: versionInclude, orderBy: { versionNumber: 'desc' as const } },
  documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' as const } },
  emailLogs: {
    orderBy: { createdAt: 'desc' as const },
    include: { sentBy: { select: userSelect } },
  },
  booking: {
    select: { id: true, bookingNumber: true, bookingStatus: true },
  },
} as const;
type FullQuotation = Prisma.QuotationGetPayload<{ include: typeof quotationInclude }>;
type FullVersion = Prisma.QuotationVersionGetPayload<{ include: typeof versionInclude }>;

/** Include for the anonymous public renderer: quotationInclude plus the safe
 *  company branding fields surfaced on the public page/footer. */
const publicQuotationInclude = {
  ...quotationInclude,
  company: {
    select: {
      name: true,
      email: true,
      phone: true,
      website: true,
      address: true,
      googleMapsUrl: true,
      primaryColor: true,
      operatingSinceYear: true,
      tripsSold: true,
      tan: true,
      taxRegistrationNumber: true,
      logoObjectKey: true,
      logoConfirmedAt: true,
    },
  },
} as const;
type PublicQuotation = Prisma.QuotationGetPayload<{ include: typeof publicQuotationInclude }>;

const decimal = (value: { toString(): string } | null | undefined) => value?.toString() ?? null;

/** Internal quotation snapshot image. Storage metadata never leaves this service. */
export interface StoredQuotationImage {
  id: string;
  objectKey?: string;
  fileName?: string;
  mimeType?: string;
  url?: string;
  thumbnailUrl?: string | null;
  alt?: string | null;
}

const textValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Lenient reader for old URL-only JSON and new storage-backed snapshots. */
function storedQuotationImages(value: unknown): StoredQuotationImage[] {
  if (!Array.isArray(value)) return [];
  const parsed: StoredQuotationImage[] = [];
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const row = raw as Record<string, unknown>;
    const objectKey = textValue(row.objectKey);
    const url = textValue(row.url);
    const masterImageId = textValue(row.masterImageId);
    const fileName = textValue(row.fileName);
    const mimeType = textValue(row.mimeType);
    const thumbnailUrl = textValue(row.thumbnailUrl);
    const alt = textValue(row.alt);
    const id = textValue(row.id) ?? masterImageId ?? url ?? `legacy-${index + 1}`;
    if (!objectKey && !url && !masterImageId) return;
    parsed.push({
      id,
      ...(objectKey ? { objectKey } : {}),
      ...(fileName ? { fileName } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(url ? { url } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(alt ? { alt } : {}),
    });
  });
  return parsed;
}

/** Resolve fresh display URLs and deliberately omit every storage key. */
async function presentQuotationImages(value: unknown): Promise<QuotationSnapshotImage[]> {
  const presented = await Promise.all(
    storedQuotationImages(value).map(async (image): Promise<QuotationSnapshotImage | null> => {
      let url = image.url;
      if (image.objectKey) {
        try {
          url = await storageService.createDownloadUrl(
            image.objectKey,
            image.fileName ?? 'quotation-image',
            env.MASTER_MEDIA_PRESIGNED_URL_EXPIRY_SECONDS,
            'inline',
          );
        } catch {
          // A missing object only removes this image from the presentation;
          // the rest of the saved quotation remains usable.
          return null;
        }
      }
      if (!url) return null;
      if (!image.objectKey) {
        // Preserve the established URL-only snapshot payload. Its URL remains
        // the stable identity, so synthesizing an id (or null thumbnail) would
        // needlessly change legacy API responses.
        return {
          url,
          ...(image.thumbnailUrl ? { thumbnailUrl: image.thumbnailUrl } : {}),
          ...(image.alt ? { alt: image.alt } : {}),
        };
      }
      return {
        id: image.id,
        url,
        ...(image.thumbnailUrl ? { thumbnailUrl: image.thumbnailUrl } : {}),
        ...(image.alt ? { alt: image.alt } : {}),
      };
    }),
  );
  return presented.filter(
    (image): image is NonNullable<(typeof presented)[number]> => image !== null,
  );
}

/** Resolve storage-backed activity galleries inside the Sightseeing JSON. */
async function presentSightseeingSnapshot(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const details = value as Record<string, unknown> & {
    days?: Array<Record<string, unknown> & { activities?: Array<Record<string, unknown>> }>;
  };
  return {
    ...details,
    days: await Promise.all(
      (details.days ?? []).map(async (day) => ({
        ...day,
        activities: await Promise.all(
          (day.activities ?? []).map(async (activity) => ({
            ...activity,
            images: await presentQuotationImages(activity.images),
            imageSnapshotPresent:
              typeof activity.imageSnapshotPresent === 'boolean'
                ? activity.imageSnapshotPresent
                : Array.isArray(activity.images),
          })),
        ),
      })),
    ),
  };
}

/**
 * Make persisted Sightseeing JSON editable without losing the distinction
 * between an old missing gallery and an intentionally emptied gallery.
 */
function editableSightseeingSnapshot(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const details = value as Record<string, unknown> & {
    days?: Array<Record<string, unknown> & { activities?: Array<Record<string, unknown>> }>;
  };
  return {
    ...details,
    days: (details.days ?? []).map((day) => ({
      ...day,
      activities: (day.activities ?? []).map((activity) => ({
        ...activity,
        images: Array.isArray(activity.images) ? activity.images : [],
        imageSnapshotPresent:
          typeof activity.imageSnapshotPresent === 'boolean'
            ? activity.imageSnapshotPresent
            : Array.isArray(activity.images),
      })),
    })),
  };
}

const storedImageIdentity = (image: StoredQuotationImage) => image.id || image.url || null;

/** All storage-backed images already owned by this quotation version. */
function existingQuotationImageMap(version?: FullVersion | null) {
  const images = [
    ...(version?.hotels.flatMap((row) => storedQuotationImages(row.images)) ?? []),
    ...(version?.services.flatMap((row) => storedQuotationImages(row.images)) ?? []),
  ];
  const sightseeing = version?.sightseeingDetails as {
    days?: Array<{ activities?: Array<{ images?: unknown }> }>;
  } | null;
  for (const day of sightseeing?.days ?? [])
    for (const activity of day.activities ?? [])
      images.push(...storedQuotationImages(activity.images));
  const entries: Array<[string | null, StoredQuotationImage]> = images.map((image) => [
    storedImageIdentity(image),
    image,
  ]);
  return new Map(
    entries.filter((entry): entry is [string, StoredQuotationImage] => Boolean(entry[0])),
  );
}

function masterImageMap(row: LegacyImageFields | undefined) {
  return new Map((row ? effectiveMasterImages(row) : []).map((image) => [image.id, image]));
}

/**
 * Convert browser-safe refs into an immutable internal snapshot. Existing
 * images are recovered by opaque id; newly selected Master images are resolved
 * against a Master row whose tenant/System owner was already validated.
 * Client-supplied object keys are ignored by the shared request schema and
 * never form a trust boundary.
 */
function hydrateImageList(
  requested: unknown,
  existing: Map<string | null, StoredQuotationImage>,
  masterImages: Map<string, StoredMasterImage>,
): StoredQuotationImage[] {
  if (!Array.isArray(requested)) return [];
  const hydrated: StoredQuotationImage[] = [];
  requested.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const row = raw as Record<string, unknown>;
    const id = textValue(row.id);
    const masterImageId = textValue(row.masterImageId);
    const url = textValue(row.url);
    const previous = (id ? existing.get(id) : undefined) ?? (url ? existing.get(url) : undefined);
    if (previous) {
      hydrated.push({ ...previous, alt: textValue(row.alt) ?? previous.alt ?? null });
      return;
    }

    // Trusted internal copy/revision paths retain their already-hydrated key.
    const internalKey = textValue(row.objectKey);
    if (internalKey) {
      const mimeType = textValue(row.mimeType);
      hydrated.push({
        id: id ?? masterImageId ?? randomUUID(),
        objectKey: internalKey,
        fileName: textValue(row.fileName) ?? 'quotation-image',
        ...(mimeType ? { mimeType } : {}),
        alt: textValue(row.alt) ?? null,
      });
      return;
    }

    const masterImage = masterImageId ? masterImages.get(masterImageId) : undefined;
    if (masterImage) {
      hydrated.push({
        id: masterImage.id,
        objectKey: masterImage.objectKey,
        fileName: masterImage.fileName,
        mimeType: masterImage.mimeType,
        alt: textValue(row.alt) ?? null,
      });
      return;
    }
    // A claimed Master ref that cannot be resolved inside the validated linked
    // Master is invalid. Never downgrade its client URL into a trusted legacy
    // snapshot.
    if (masterImageId) return;

    // URL-only rows are the established bookmark/legacy snapshot format.
    if (url) {
      hydrated.push({
        id: id ?? url,
        url,
        thumbnailUrl: textValue(row.thumbnailUrl) ?? null,
        alt: textValue(row.alt) ?? null,
      });
    }
  });
  return hydrated;
}

function hydratePdfSelection(
  requestedImages: unknown,
  hydrated: StoredQuotationImage[],
  selected: string | null | undefined,
) {
  if (!selected || !Array.isArray(requestedImages)) return null;
  const requested = requestedImages.find((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    return quotationSnapshotImageIdentity(raw as QuotationSnapshotImage) === selected;
  });
  if (!requested || typeof requested !== 'object') return null;
  const row = requested as Record<string, unknown>;
  const id = textValue(row.id);
  const masterImageId = textValue(row.masterImageId);
  const url = textValue(row.url);
  const match = hydrated.find(
    (image) =>
      (id && image.id === id) ||
      (masterImageId && image.id === masterImageId) ||
      (url && (image.url === url || image.id === url)),
  );
  return match ? storedImageIdentity(match) : null;
}

async function hasCosting(auth: AuthContext) {
  return permissionsService.userHasPermission(auth.userId, PERMISSIONS.QUOTATIONS_VIEW_COSTING);
}

async function visibleWhere(auth: AuthContext, extra: Prisma.QuotationWhereInput = {}) {
  return {
    companyId: auth.companyId,
    deletedAt: null,
    query: { is: { companyId: auth.companyId, ...(await leadVisibility(auth)) } },
    ...extra,
  } satisfies Prisma.QuotationWhereInput;
}

async function getQuotation(auth: AuthContext, id: string) {
  const value = await prisma.quotation.findFirst({
    where: await visibleWhere(auth, { id }),
    include: quotationInclude,
  });
  if (!value) throw new NotFoundError('Quotation not found.');
  return value;
}

/**
 * Destination/Master-country names for a quotation, preserving first-seen
 * itinerary order and de-duplicating repeated stays. The lead itinerary's
 * `country` field holds the Master Destination (e.g. "Malaysia"), while
 * `destination` holds the city (e.g. "Kuala Lumpur"). Falls back to the
 * destination summary only when no proper destination value exists (legacy
 * quotations).
 */
function resolveDestinationNames(
  itinerary: Array<{ country?: string | null; destination?: string | null }> | null | undefined,
  destinationSummary: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of itinerary ?? []) {
    const country = (row.country ?? '').trim();
    if (!country) continue;
    const key = country.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(country);
  }
  if (names.length) return names;
  const fallback = (destinationSummary ?? '').trim();
  return fallback ? [fallback] : [];
}

/** Total package nights from every destination row on the source lead. */
export function resolveItineraryNights(
  itinerary: Array<{ nights?: number | null }> | null | undefined,
): number | null {
  const total = (itinerary ?? []).reduce(
    (sum, row) => sum + Math.max(0, Number(row.nights ?? 0)),
    0,
  );
  return total > 0 ? total : null;
}

/** Short-lived signed URL for the company branding logo, or null. */
async function publicCompanyLogoUrl(company: {
  logoObjectKey: string | null;
  logoConfirmedAt: Date | null;
}) {
  if (!company.logoObjectKey || !company.logoConfirmedAt) return null;
  try {
    return await storageService.createDownloadUrl(
      company.logoObjectKey,
      'logo',
      env.MASTER_MEDIA_PRESIGNED_URL_EXPIRY_SECONDS,
    );
  } catch {
    return null;
  }
}

async function presentVersion(version: FullVersion, canViewCosting: boolean, customerSafe = false) {
  const {
    companyId,
    quotationId,
    subtotalCost,
    marginAmount,
    marginPercentage,
    internalNotes,
    netAmount,
    ...value
  } = version;
  void companyId;
  void quotationId;
  const strip = <T extends { companyId: string; quotationVersionId: string }>(row: T) => {
    const { companyId: _companyId, quotationVersionId: _versionId, ...rest } = row;
    void _companyId;
    void _versionId;
    return rest;
  };
  // Weblink customization: normalize FAQs, section order and Destination Expert for every consumer.
  // Invalid/legacy rows are cleaned here so public rendering stays resilient.
  const rawFaqs = (value as unknown as { faqs?: unknown }).faqs;
  const rawOrder = (value as unknown as { weblinkSectionOrder?: unknown }).weblinkSectionOrder;
  const rawExpert = (value as unknown as { destinationExpertConfig?: unknown })
    .destinationExpertConfig;
  return {
    ...value,
    faqs: normalizeFaqs(rawFaqs),
    weblinkSectionOrder: Array.isArray(rawOrder) ? resolveWeblinkSectionOrder(rawOrder) : null,
    destinationExpertConfig: normalizeDestinationExpertConfig(rawExpert),
    subtotalSellingPrice: decimal(value.subtotalSellingPrice),
    markupValue: decimal(value.markupValue),
    totalMarkup: decimal(value.totalMarkup),
    taxRate: decimal(value.taxRate),
    taxAmount: decimal(value.taxAmount),
    discountAmount: decimal(value.discountAmount),
    finalAmount: decimal(value.finalAmount),
    // Reference "Summary & Pricing" — per-passenger package pricing.
    perAdultPrice: decimal(value.perAdultPrice),
    perChildWithBedPrice: decimal(value.perChildWithBedPrice),
    perChildWithoutBedPrice: decimal(value.perChildWithoutBedPrice),
    perInfantPrice: decimal(value.perInfantPrice),
    initialPaymentAmount: decimal(value.initialPaymentAmount),
    sightseeingDetails: await presentSightseeingSnapshot(value.sightseeingDetails),
    // Reference "Visa" — single dedicated section.
    visaAmount: decimal(value.visaAmount),
    visaServiceCharge: decimal(value.visaServiceCharge),
    visaGstPercent: decimal(value.visaGstPercent),
    visaVfsCharge: decimal(value.visaVfsCharge),
    ...(canViewCosting && !customerSafe
      ? {
          subtotalCost: decimal(subtotalCost),
          marginAmount: decimal(marginAmount),
          marginPercentage: decimal(marginPercentage),
          netAmount: decimal(netAmount),
          internalNotes,
        }
      : {}),
    itinerary: version.itinerary.map(strip),
    hotels: await Promise.all(
      version.hotels.map(async (row) => {
        const {
          internalCost,
          hotelId,
          hotelRoomTypeId,
          hotelMealPlanId,
          baseRoomPrice,
          extraBedPrice,
          childWithoutBedPrice,
          ...hotel
        } = strip(
          row as unknown as typeof row & {
            baseRoomPrice: unknown;
            extraBedPrice: unknown;
            childWithoutBedPrice: unknown;
          },
        );
        // Multi-room lines: master ids are internal editing aids and line costs
        // are internal data — apply the same visibility rules as the row level.
        const presentLines = (lines: unknown, idKey: 'hotelRoomTypeId' | 'hotelMealPlanId') =>
          (Array.isArray(lines) ? lines : []).map((line) => {
            const {
              [idKey]: lineId,
              internalCost: lineCost,
              ...rest
            } = line as Record<string, unknown>;
            void lineId;
            return {
              ...(rest as object),
              ...(customerSafe ? {} : { [idKey]: lineId ?? null }),
              ...(canViewCosting && !customerSafe ? { internalCost: lineCost ?? null } : {}),
            };
          });
        const hotelScalars = hotel as unknown as {
          sellingPrice: { toString(): string } | null | undefined;
        };
        return {
          ...hotel,
          images: await presentQuotationImages((hotel as unknown as { images: unknown }).images),
          imageSnapshotPresent: Array.isArray((hotel as unknown as { images: unknown }).images),
          sellingPrice: decimal(hotelScalars.sellingPrice),
          baseRoomPrice:
            baseRoomPrice == null ? null : decimal(baseRoomPrice as { toString(): string }),
          extraBedPrice:
            extraBedPrice == null ? null : decimal(extraBedPrice as { toString(): string }),
          childWithoutBedPrice:
            childWithoutBedPrice == null
              ? null
              : decimal(childWithoutBedPrice as { toString(): string }),
          roomLines: presentLines(hotel.roomLines, 'hotelRoomTypeId'),
          mealPlanLines: presentLines(hotel.mealPlanLines, 'hotelMealPlanId'),
          // Master ids are an internal editing aid. Customer-facing output
          // (public link, PDF, email) is snapshot-only, so they are omitted
          // there rather than nulled.
          ...(customerSafe ? {} : { hotelId, hotelRoomTypeId, hotelMealPlanId }),
          ...(canViewCosting && !customerSafe
            ? { internalCost: decimal(internalCost as { toString(): string }) }
            : {}),
        };
      }),
    ),
    services: await Promise.all(
      version.services.map(async (row) => {
        const {
          unitCost,
          totalCost,
          airlineId,
          cruiseId,
          cruiseRoomTypeId,
          vehicleId,
          sightseeingId,
          addOnServiceId,
          ...service
        } = strip(row);
        return {
          ...service,
          images: await presentQuotationImages(service.images),
          imageSnapshotPresent: Array.isArray(service.images),
          quantity: decimal(service.quantity),
          unitSellingPrice: decimal(service.unitSellingPrice),
          totalSellingPrice: decimal(service.totalSellingPrice),
          ...(customerSafe
            ? // The add-on master link stays so customer outputs (weblink/PDF) can
              // render only add-on rows that are actually included/selected.
              { addOnServiceId }
            : {
                airlineId,
                cruiseId,
                cruiseRoomTypeId,
                vehicleId,
                sightseeingId,
                addOnServiceId,
              }),
          ...(canViewCosting && !customerSafe
            ? { unitCost: decimal(unitCost), totalCost: decimal(totalCost) }
            : {}),
        };
      }),
    ),
    inclusions: version.inclusions.map(strip),
    exclusions: version.exclusions.map(strip),
    terms: version.terms.map(strip),
  };
}

async function presentQuotation(
  value: FullQuotation,
  canViewCosting: boolean,
  customerSafe = false,
) {
  const { companyId, publicTokenHash, deletedAt, ...quotation } = value;
  void companyId;
  void publicTokenHash;
  void deletedAt;
  return {
    ...quotation,
    status: value.status,
    versions: await Promise.all(
      value.versions.map((version) => presentVersion(version, canViewCosting, customerSafe)),
    ),
    documents: value.documents.map(({ companyId: _companyId, objectKey, bucket, ...document }) => {
      void _companyId;
      void objectKey;
      void bucket;
      return document;
    }),
  };
}

type HotelRowInput = QuotationVersionInput['hotels'][number];

/**
 * Mirror the first room/meal line of a multi-room hotel option onto the legacy
 * scalar columns (roomType, hotelRoomTypeId, rooms, extraBed*, childWithoutBed*,
 * mealPlan, hotelMealPlanId) so older readers — booking import, exports, any
 * code path still reading the scalars — keep working unchanged. An explicit
 * `roomsOverride` (a staff manual total from the builder) always wins; without
 * one, the total is the live sum of every room allocation. Rows without lines
 * (legacy writers) pass through untouched.
 */
function syncHotelLineScalars<
  T extends Pick<HotelRowInput, 'roomLines' | 'mealPlanLines'> & Record<string, unknown>,
>(hotel: T): T {
  const roomLines = Array.isArray(hotel.roomLines) ? hotel.roomLines : [];
  const mealPlanLines = Array.isArray(hotel.mealPlanLines) ? hotel.mealPlanLines : [];
  if (!roomLines.length && !mealPlanLines.length) return hotel;
  const firstRoom = roomLines[0];
  const firstMeal = mealPlanLines[0];
  const allocationSum = roomLines.reduce((sum, line) => sum + (Number(line.rooms) || 1), 0);
  const override = typeof hotel.roomsOverride === 'number' ? hotel.roomsOverride : null;
  return {
    ...hotel,
    ...(roomLines.length
      ? {
          hotelRoomTypeId: firstRoom?.hotelRoomTypeId ?? null,
          roomType: firstRoom?.roomType ?? null,
          rooms: override ?? allocationSum,
          extraBedQuantity: firstRoom?.extraBedQuantity ?? null,
          extraBedPrice: firstRoom?.extraBedPrice ?? null,
          childWithoutBedQuantity: firstRoom?.childWithoutBedQuantity ?? null,
          childWithoutBedPrice: firstRoom?.childWithoutBedPrice ?? null,
          baseRoomPrice: firstRoom?.baseRoomPrice ?? null,
          pricingSource: firstRoom?.pricingSource ?? null,
        }
      : {}),
    ...(mealPlanLines.length
      ? {
          hotelMealPlanId: firstMeal?.hotelMealPlanId ?? null,
          mealPlan: firstMeal?.mealPlan ?? null,
        }
      : {}),
  } as T;
}

/**
 * Cruise room allocations are authoritative; the legacy scalar columns mirror
 * them so every legacy reader (PDF fallback, weblink tags, old revisions)
 * keeps working without migration-time backfill.
 *
 * Only an explicit `cruiseRoomLines` array carries room-list intent. Legacy
 * and template rows without the key are returned untouched so their scalars
 * stay authoritative and keep synthesizing their single room on read.
 *
 * - With lines: the first line's room type mirrors onto cruiseRoomTypeId/city
 *   and the per-night total mirrors onto quantity(1)/sellingPrice — the same
 *   rule the builder's save path already applies client-side.
 * - With an explicit empty list: the type scalars are nulled so a removed
 *   room can never be resurrected from stale scalars on reload; the price
 *   mirrors to 0 (quantity stays 1).
 */
function syncCruiseLineScalars<
  T extends Pick<
    QuotationVersionInput['services'][number],
    'serviceType' | 'cruiseRoomLines' | 'cruiseNights'
  > &
    Record<string, unknown>,
>(service: T): T {
  if (service.serviceType !== 'CRUISE') return service;
  const rawLines = service.cruiseRoomLines;
  if (!Array.isArray(rawLines)) return service;
  const lines = rawLines as NonNullable<
    QuotationVersionInput['services'][number]['cruiseRoomLines']
  >;
  if (!lines.length) {
    return {
      ...service,
      cruiseRoomTypeId: null,
      city: null,
      quantity: 1,
      sellingPrice: 0,
    } as T;
  }
  const first = lines[0] as unknown as {
    cruiseRoomTypeId?: string | null;
    roomType?: string | null;
  };
  const nights = (service as unknown as { cruiseNights?: number | null }).cruiseNights ?? null;
  const total = calculateCruiseRoomLinesTotal(
    { cruiseRoomLines: lines, cruiseNights: nights } as unknown as Parameters<
      typeof calculateCruiseRoomLinesTotal
    >[0],
    nights,
  );
  return {
    ...service,
    cruiseRoomTypeId: first?.cruiseRoomTypeId ?? null,
    city: first?.roomType ?? null,
    quantity: 1,
    sellingPrice: total,
  } as T;
}

function normalizeVersionInput(input: QuotationVersionInput, allowCosting: boolean) {
  return {
    ...input,
    hotels: input.hotels.map((hotel) =>
      syncHotelLineScalars({
        ...hotel,
        internalCost: allowCosting ? (hotel.internalCost ?? 0) : 0,
        sellingPrice: hotel.sellingPrice ?? 0,
        baseRoomPrice: hotel.baseRoomPrice ?? null,
        extraBedQuantity: hotel.extraBedQuantity ?? null,
        extraBedPrice: hotel.extraBedPrice ?? null,
        childWithoutBedQuantity: hotel.childWithoutBedQuantity ?? null,
        childWithoutBedPrice: hotel.childWithoutBedPrice ?? null,
        pricingSource: hotel.pricingSource ?? null,
        roomLines: (Array.isArray(hotel.roomLines) ? hotel.roomLines : []).map((line) => ({
          ...line,
          // Costing lines are internal data — same gating as the row-level cost.
          internalCost: allowCosting ? (line.internalCost ?? null) : null,
        })),
        mealPlanLines: (Array.isArray(hotel.mealPlanLines) ? hotel.mealPlanLines : []).map(
          (line) => ({
            ...line,
            internalCost: allowCosting ? (line.internalCost ?? null) : null,
          }),
        ),
      }),
    ),
    services: input.services.map((service) =>
      syncCruiseLineScalars({
        ...service,
        internalCost: allowCosting ? (service.internalCost ?? 0) : 0,
        sellingPrice: service.sellingPrice ?? 0,
        // Preserve undefined for legacy/template rows without the key: only an
        // explicit array (possibly empty) carries room-list intent.
        cruiseRoomLines: Array.isArray(service.cruiseRoomLines)
          ? service.cruiseRoomLines.map((line) => ({
              ...line,
              // Costing lines are internal data — same gating as the row-level cost.
              internalCost: allowCosting ? (line.internalCost ?? null) : null,
            }))
          : service.cruiseRoomLines,
      }),
    ),
  };
}

async function enrichHotelPricingSnapshots(
  _tx: Prisma.TransactionClient,
  imageOwnerCompanyIds: string[],
  input: QuotationVersionInput,
): Promise<QuotationVersionInput> {
  // Snapshot enrichment: if a hotel row links to a room type and has a check-in date but no resolved pricing, fill from master.
  // Manual overrides (client-provided baseRoomPrice != null) are preserved.
  // Multi-room hotel options resolve EVERY room allocation line independently.
  const enrichedHotels = await Promise.all(
    input.hotels.map(async (hotel) => {
      const roomLines = Array.isArray(hotel.roomLines) ? hotel.roomLines : [];
      let lines = roomLines;
      if (roomLines.length && hotel.checkInDate) {
        lines = await Promise.all(
          roomLines.map(async (line) => {
            if (!line.hotelRoomTypeId) return line;
            const needsResolution =
              line.baseRoomPrice == null &&
              line.extraBedPrice == null &&
              line.childWithoutBedPrice == null;
            // If any pricing snapshot already set (manual), keep it.
            if (!needsResolution && line.baseRoomPrice != null) return line;
            const resolved = await resolveHotelRoomPricing(
              imageOwnerCompanyIds,
              line.hotelRoomTypeId,
              hotel.checkInDate,
            );
            if (!resolved) return line;
            return {
              ...line,
              baseRoomPrice: line.baseRoomPrice ?? resolved.baseRoomPrice,
              extraBedPrice: line.extraBedPrice ?? resolved.extraBedPrice,
              childWithoutBedPrice: line.childWithoutBedPrice ?? resolved.childWithoutBedPrice,
              pricingSource: line.pricingSource ?? resolved.pricingSource,
            };
          }),
        );
      }
      if (!hotel.hotelRoomTypeId || !hotel.checkInDate) {
        return lines === roomLines ? hotel : { ...hotel, roomLines: lines };
      }
      const needsResolution =
        hotel.baseRoomPrice == null &&
        hotel.extraBedPrice == null &&
        hotel.childWithoutBedPrice == null;
      // If any pricing snapshot already set (manual), keep it.
      if (!needsResolution && hotel.baseRoomPrice != null) {
        return lines === roomLines ? hotel : { ...hotel, roomLines: lines };
      }
      const resolved = await resolveHotelRoomPricing(
        imageOwnerCompanyIds,
        hotel.hotelRoomTypeId,
        hotel.checkInDate,
      );
      if (!resolved) return lines === roomLines ? hotel : { ...hotel, roomLines: lines };
      return {
        ...hotel,
        roomLines: lines,
        baseRoomPrice: hotel.baseRoomPrice ?? resolved.baseRoomPrice,
        extraBedPrice: hotel.extraBedPrice ?? resolved.extraBedPrice,
        childWithoutBedPrice: hotel.childWithoutBedPrice ?? resolved.childWithoutBedPrice,
        pricingSource: hotel.pricingSource ?? resolved.pricingSource,
      };
    }),
  );
  return { ...input, hotels: enrichedHotels };
}

type ImageMasterDb = Pick<
  Prisma.TransactionClient,
  'hotel' | 'cruise' | 'vehicle' | 'sightseeing' | 'addOnService'
>;

const imageMasterSelect = {
  id: true,
  images: true,
  imageObjectKey: true,
  imageFileName: true,
  imageMimeType: true,
  imageFileSize: true,
  imageConfirmedAt: true,
} as const;

/**
 * Hydrate every Master gallery reference before persistence. This is the
 * snapshot boundary: after this function, rendering never needs the Master row
 * again and later Master reorder/removal cannot mutate this quotation.
 */
async function hydrateQuotationImageSnapshots(
  db: ImageMasterDb,
  imageOwnerCompanyIds: string[],
  input: QuotationVersionInput,
  existingVersion?: FullVersion | null,
): Promise<QuotationVersionInput> {
  const unique = (values: Array<string | null | undefined>) => [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
  const sightseeingActivities =
    input.sightseeingDetails?.days.flatMap((day) => day.activities) ?? [];
  const hotelIds = unique(input.hotels.map((row) => row.hotelId));
  const cruiseIds = unique(input.services.map((row) => row.cruiseId));
  const vehicleIds = unique(input.services.map((row) => row.vehicleId));
  const sightseeingIds = unique([
    ...input.services.map((row) => row.sightseeingId),
    ...sightseeingActivities.map((row) => row.sightseeingId),
  ]);
  const addOnServiceIds = unique(input.services.map((r) => r.addOnServiceId));
  const [hotels, cruises, vehicles, sightseeings, addOnServices] = await Promise.all([
    hotelIds.length
      ? db.hotel.findMany({
          where: { id: { in: hotelIds }, companyId: { in: imageOwnerCompanyIds } },
          select: { ...imageMasterSelect, price: true, currency: true },
        })
      : [],
    cruiseIds.length
      ? db.cruise.findMany({
          where: { id: { in: cruiseIds }, companyId: { in: imageOwnerCompanyIds } },
          select: { ...imageMasterSelect, price: true, currency: true },
        })
      : [],
    vehicleIds.length
      ? db.vehicle.findMany({
          where: { id: { in: vehicleIds }, companyId: { in: imageOwnerCompanyIds } },
          select: { ...imageMasterSelect, price: true, currency: true },
        })
      : [],
    sightseeingIds.length
      ? db.sightseeing.findMany({
          where: { id: { in: sightseeingIds }, companyId: { in: imageOwnerCompanyIds } },
          select: { ...imageMasterSelect, pricing: true },
        })
      : [],
    addOnServiceIds.length
      ? db.addOnService.findMany({
          where: { id: { in: addOnServiceIds }, companyId: { in: imageOwnerCompanyIds } },
          select: { ...imageMasterSelect, id: true, price: true, currency: true },
        })
      : [],
  ]);
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const hotelById = byId(hotels as unknown as Array<{ id: string }>);
  const cruiseById = byId(cruises as unknown as Array<{ id: string }>);
  const vehicleById = byId(vehicles as unknown as Array<{ id: string }>);
  const sightseeingById = byId(sightseeings as unknown as Array<{ id: string }>);
  const addOnServiceById = byId(addOnServices as unknown as Array<{ id: string }>);
  const existing = existingQuotationImageMap(existingVersion);

  const hydrateCarrier = <
    T extends {
      images?: unknown;
      imageSnapshotPresent?: boolean | undefined;
      pdfImageUrl?: string | null | undefined;
    },
  >(
    row: T,
    master?: LegacyImageFields,
  ): T => {
    const firstLinkedMasterImport = row.imageSnapshotPresent === undefined && Boolean(master);
    const requestedImages =
      firstLinkedMasterImport && (!Array.isArray(row.images) || row.images.length === 0)
        ? effectiveMasterImages(master!).map((image) => ({ masterImageId: image.id }))
        : row.images;
    const images = hydrateImageList(requestedImages, existing, masterImageMap(master));
    return {
      ...row,
      images,
      imageSnapshotPresent:
        row.imageSnapshotPresent ??
        (firstLinkedMasterImport || (Array.isArray(row.images) && row.images.length > 0)),
      pdfImageUrl: hydratePdfSelection(requestedImages, images, row.pdfImageUrl),
    } as unknown as T;
  };

  return {
    ...input,
    // NOTE: master prices are intentionally NOT re-applied here. The master
    // price is only a prefill source that is copied ONCE into the quotation
    // snapshot when the master is selected (in the frontend). Re-pulling it on
    // every save would dynamically re-link the quotation to the master, so a
    // later master-price change would silently rewrite an already-saved
    // quotation. Persisting exactly what the client sent keeps quotations as
    // stable snapshots. This function only hydrates master gallery images.
    hotels: input.hotels.map((row) =>
      hydrateCarrier(
        row,
        row.hotelId
          ? (hotelById.get(row.hotelId) as unknown as LegacyImageFields | undefined)
          : undefined,
      ),
    ) as QuotationVersionInput['hotels'],
    services: input.services.map((row) => {
      const master =
        row.serviceType === 'CRUISE' && row.cruiseId
          ? cruiseById.get(row.cruiseId)
          : row.serviceType === 'VEHICLE_TRANSFER' && row.vehicleId
            ? vehicleById.get(row.vehicleId)
            : row.serviceType === 'SIGHTSEEING' && row.sightseeingId
              ? sightseeingById.get(row.sightseeingId)
              : row.addOnServiceId
                ? addOnServiceById.get(row.addOnServiceId)
                : undefined;
      return hydrateCarrier(
        row as unknown as Record<string, unknown> & { images?: unknown },
        master as unknown as LegacyImageFields | undefined,
      );
    }) as unknown as QuotationVersionInput['services'],
    sightseeingDetails: (input.sightseeingDetails
      ? {
          ...input.sightseeingDetails,
          days: input.sightseeingDetails.days.map((day) => ({
            ...day,
            activities: day.activities.map((activity) =>
              hydrateCarrier(
                activity as unknown as Record<string, unknown> & { images?: unknown },
                activity.sightseeingId
                  ? (sightseeingById.get(activity.sightseeingId) as unknown as
                      LegacyImageFields | undefined)
                  : undefined,
              ),
            ),
          })),
        }
      : input.sightseeingDetails) as unknown as QuotationVersionInput['sightseeingDetails'],
  };
}

interface PaxCounts {
  adults: number;
  childrenWithBed: number;
  childrenWithoutBed: number;
  infants: number;
}

function versionCreateData(
  input: QuotationVersionInput,
  companyId: string,
  allowCosting: boolean,
  pax: PaxCounts,
) {
  const normalized = normalizeVersionInput(input, allowCosting);
  // Per-passenger prices × the lead's traveller mix drive the stored total.
  const pricing = calculatePricing({
    ...normalized,
    netAmount: allowCosting ? normalized.netAmount : 0,
    pax,
  });
  const { serviceLines, ...totals } = pricing;
  return {
    scalar: {
      title: normalized.title,
      introduction: normalized.introduction ?? null,
      weblinkHeading: normalized.weblinkHeading ?? null,
      packageHeading: normalized.packageHeading ?? null,
      weblinkDurationText: normalized.weblinkDurationText ?? null,
      weblinkProfileDestination: normalized.weblinkProfileDestination ?? null,
      weblinkProfile: (normalized.weblinkProfile
        ? (normalized.weblinkProfile as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull) as Prisma.InputJsonValue,
      destinationSummary: normalized.destinationSummary,
      travelStartDate: normalized.travelStartDate ?? null,
      travelEndDate: normalized.travelEndDate ?? null,
      currency: normalized.currency,
      pricingMode: normalized.pricingMode,
      // Customer-facing pricing presentation (heading/subheading/order).
      pricingHeading: (typeof input.pricingHeading === 'string' && input.pricingHeading.trim()
        ? input.pricingHeading
        : (normalized.pricingHeading ?? 'Price Breakdown')
      ).slice(0, 120),
      pricingSubheading:
        typeof input.pricingSubheading === 'string' && input.pricingSubheading.trim()
          ? input.pricingSubheading.slice(0, 200)
          : null,
      pricingDisplayOrder:
        Array.isArray(input.pricingDisplayOrder) && input.pricingDisplayOrder.length
          ? (input.pricingDisplayOrder.slice(0, 20) as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      pricingRowOrder:
        Array.isArray(normalized.pricingRowOrder) && normalized.pricingRowOrder.length
          ? (normalized.pricingRowOrder.slice(0, 80) as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      markupMode: normalized.markupMode,
      markupValue: normalized.markupValue,
      taxRate: normalized.taxRate,
      // Reference "Summary & Pricing" — per-passenger package pricing.
      perAdultPrice: normalized.perAdultPrice ?? 0,
      perChildWithBedPrice: normalized.perChildWithBedPrice ?? 0,
      perChildWithoutBedPrice: normalized.perChildWithoutBedPrice ?? 0,
      perInfantPrice: normalized.perInfantPrice ?? 0,
      // Additional Price Items — fixed flat charges for By Traveler pricing.
      packageCustomItems:
        Array.isArray(normalized.packageCustomItems) && normalized.packageCustomItems.length
          ? (normalized.packageCustomItems.slice(0, 50) as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      taxNote: normalized.taxNote ?? null,
      // Net amount is internal margin data — never taken from viewers without costing.
      netAmount: allowCosting ? (normalized.netAmount ?? 0) : 0,
      initialPaymentAmount: normalized.initialPaymentAmount ?? 0,
      paymentLink: normalized.paymentLink ?? null,
      showServiceChargesSeparately: normalized.showServiceChargesSeparately ?? false,
      markServiceChargesOutside: normalized.markServiceChargesOutside ?? false,
      hidePricing: normalized.hidePricing ?? false,
      showIndividualPricing: normalized.showIndividualPricing ?? false,
      showQuickNav: normalized.showQuickNav ?? true,
      quickNavSticky: normalized.quickNavSticky ?? true,
      // Reference "Inclusions & Exclusions" — rich-text blocks.
      inclusionsHtml: normalized.inclusionsHtml ?? null,
      exclusionsHtml: normalized.exclusionsHtml ?? null,
      paymentPolicies: normalized.paymentPolicies ?? null,
      cancellationPolicies: normalized.cancellationPolicies ?? null,
      bookingTerms: normalized.bookingTerms ?? null,
      childPolicy: normalized.childPolicy ?? null,
      // Reference "Visa" — single dedicated section.
      includeVisa: normalized.includeVisa ?? true,
      visaSectionTitle: normalized.visaSectionTitle ?? null,
      visaAmount: normalized.visaAmount ?? 0,
      visaDestination: normalized.visaDestination ?? null,
      visaType: normalized.visaType ?? null,
      visaServiceCharge: normalized.visaServiceCharge ?? 0,
      visaGstPercent: normalized.visaGstPercent ?? 0,
      visaVfsCharge: normalized.visaVfsCharge ?? 0,
      // Reference "Flight" — structured journeys/segments (JSON).
      flightDetails: (normalized.flightDetails ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      // Reference "Hotel" — editable section metadata (JSON).
      hotelDetails: (normalized.hotelDetails ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      sightseeingDetails: (normalized.sightseeingDetails ??
        Prisma.JsonNull) as Prisma.InputJsonValue,
      // Weblink customization: FAQs, custom section order and Destination Expert (backward compatible).
      faqs: (normalized.faqs?.length
        ? (normalized.faqs as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull) as Prisma.InputJsonValue,
      weblinkSectionOrder: (normalized.weblinkSectionOrder?.length
        ? (normalized.weblinkSectionOrder as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull) as Prisma.InputJsonValue,
      destinationExpertConfig: (normalized.destinationExpertConfig
        ? (normalizeDestinationExpertConfig(
            normalized.destinationExpertConfig,
          ) as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull) as Prisma.InputJsonValue,
      notes: normalized.notes ?? null,
      internalNotes: allowCosting ? (normalized.internalNotes ?? null) : null,
      ...totals,
    },
    itinerary: normalized.itinerary.map((row) => ({ ...row, companyId })),
    hotels: normalized.hotels.map(({ imageSnapshotPresent, ...row }) => ({
      ...row,
      images: imageSnapshotPresent
        ? ((row.images ?? []) as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      companyId,
      internalCost: row.internalCost ?? 0,
      sellingPrice: row.sellingPrice ?? 0,
    })),
    services: normalized.services.map((row, index) => ({
      companyId,
      serviceType: row.serviceType,
      // These six are listed explicitly because this mapper enumerates fields
      // rather than spreading: anything omitted here is silently dropped.
      airlineId: row.airlineId ?? null,
      cruiseId: row.cruiseId ?? null,
      cruiseRoomTypeId: row.cruiseRoomTypeId ?? null,
      // Cruise stays carry their structured duration and room allocations in
      // dedicated columns. An explicitly saved [] persists as [] (roomless);
      // legacy rows without the key persist SQL NULL and keep synthesizing
      // their single room from the scalar columns on read.
      cruiseNights: (row as unknown as { cruiseNights?: number | null }).cruiseNights ?? null,
      cruiseRoomLines: Array.isArray(
        (row as unknown as { cruiseRoomLines?: unknown }).cruiseRoomLines,
      )
        ? ((row as unknown as { cruiseRoomLines: unknown[] })
            .cruiseRoomLines as unknown as Prisma.InputJsonValue)
        : undefined,
      vehicleId: row.vehicleId ?? null,
      sightseeingId: row.sightseeingId ?? null,
      addOnServiceId: row.addOnServiceId ?? null,
      name: row.name,
      description: row.description,
      dayNumber: row.dayNumber,
      city: row.city,
      quantity: row.quantity,
      unitCost: row.internalCost ?? 0,
      unitSellingPrice: row.sellingPrice ?? 0,
      totalCost: serviceLines[index]?.totalCost ?? 0,
      totalSellingPrice: serviceLines[index]?.totalSellingPrice ?? 0,
      pricingBasis: row.pricingBasis ?? null,
      pricingBasisLabel: row.pricingBasisLabel ?? null,
      // Quotation-owned snapshot of every master pricing option available at
      // selection time. An ARRAY (even empty) is an explicit override and must
      // persist as-is, so deleting every option can never fall back to master
      // defaults on reload. Only an absent/undefined value stays JsonNull
      // (legacy single-price rows that should still synthesize from the price).
      pricingSnapshot: Array.isArray(row.pricingSnapshot)
        ? (row.pricingSnapshot as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      taxCategory: row.taxCategory,
      notes: row.notes,
      duration: row.duration ?? null,
      images: row.imageSnapshotPresent
        ? ((row.images ?? []) as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      pdfImageUrl: row.pdfImageUrl ?? null,
      sequence: row.sequence,
    })),
    inclusions: normalized.inclusions.map((row) => ({ ...row, companyId })),
    exclusions: normalized.exclusions.map((row) => ({ ...row, companyId })),
    terms: normalized.terms.map((row) => ({ ...row, companyId })),
  };
}

function fromVersion(source: FullVersion): QuotationVersionInput {
  return {
    title: source.title,
    weblinkHeading: source.weblinkHeading,
    packageHeading: source.packageHeading,
    weblinkDurationText: source.weblinkDurationText,
    weblinkProfileDestination: source.weblinkProfileDestination,
    weblinkProfile: ((source as unknown as { weblinkProfile?: unknown }).weblinkProfile ??
      null) as QuotationVersionInput['weblinkProfile'],
    introduction: source.introduction,
    destinationSummary: source.destinationSummary,
    travelStartDate: source.travelStartDate,
    travelEndDate: source.travelEndDate,
    currency: source.currency,
    pricingMode: source.pricingMode,
    pricingHeading: source.pricingHeading,
    pricingSubheading: source.pricingSubheading,
    pricingDisplayOrder: Array.isArray(
      (source as unknown as { pricingDisplayOrder?: unknown }).pricingDisplayOrder,
    )
      ? ((source as unknown as { pricingDisplayOrder?: unknown }).pricingDisplayOrder as string[])
      : undefined,
    pricingRowOrder: Array.isArray(
      (source as unknown as { pricingRowOrder?: unknown }).pricingRowOrder,
    )
      ? ((source as unknown as { pricingRowOrder?: unknown }).pricingRowOrder as string[])
      : undefined,
    markupMode: source.markupMode,
    markupValue: source.markupValue.toNumber(),
    taxRate: source.taxRate.toNumber(),
    discountAmount: source.discountAmount.toNumber(),
    perAdultPrice: source.perAdultPrice.toNumber(),
    perChildWithBedPrice: source.perChildWithBedPrice.toNumber(),
    perChildWithoutBedPrice: source.perChildWithoutBedPrice.toNumber(),
    perInfantPrice: source.perInfantPrice.toNumber(),
    packageCustomItems: Array.isArray(source.packageCustomItems)
      ? (source.packageCustomItems as unknown as QuotationVersionInput['packageCustomItems'])
      : undefined,
    taxNote: source.taxNote,
    netAmount: source.netAmount.toNumber(),
    initialPaymentAmount: source.initialPaymentAmount.toNumber(),
    paymentLink: source.paymentLink,
    showServiceChargesSeparately: source.showServiceChargesSeparately,
    markServiceChargesOutside: source.markServiceChargesOutside,
    hidePricing: source.hidePricing,
    showIndividualPricing: source.showIndividualPricing,
    showQuickNav: source.showQuickNav,
    quickNavSticky: source.quickNavSticky,
    inclusionsHtml: source.inclusionsHtml,
    exclusionsHtml: source.exclusionsHtml,
    paymentPolicies: source.paymentPolicies,
    cancellationPolicies: source.cancellationPolicies,
    bookingTerms: source.bookingTerms,
    childPolicy: source.childPolicy,
    includeVisa: source.includeVisa,
    visaSectionTitle: source.visaSectionTitle,
    visaAmount: source.visaAmount.toNumber(),
    visaDestination: source.visaDestination,
    visaType: source.visaType,
    visaServiceCharge: source.visaServiceCharge.toNumber(),
    visaGstPercent: source.visaGstPercent.toNumber(),
    visaVfsCharge: source.visaVfsCharge.toNumber(),
    flightDetails: source.flightDetails as QuotationVersionInput['flightDetails'],
    hotelDetails: source.hotelDetails as QuotationVersionInput['hotelDetails'],
    sightseeingDetails: editableSightseeingSnapshot(
      source.sightseeingDetails,
    ) as QuotationVersionInput['sightseeingDetails'],
    faqs: normalizeFaqs((source as unknown as { faqs?: unknown }).faqs),
    weblinkSectionOrder: (() => {
      const raw = (source as unknown as { weblinkSectionOrder?: unknown }).weblinkSectionOrder;
      return Array.isArray(raw) ? (resolveWeblinkSectionOrder(raw) as string[]) : null;
    })(),
    destinationExpertConfig: normalizeDestinationExpertConfig(
      (source as unknown as { destinationExpertConfig?: unknown }).destinationExpertConfig,
    ),
    notes: source.notes,
    internalNotes: source.internalNotes,
    itinerary: source.itinerary.map(
      ({
        id: _id,
        companyId: _companyId,
        quotationVersionId: _versionId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...row
      }) => row,
    ),
    hotels: source.hotels.map(
      ({
        id: _id,
        companyId: _companyId,
        quotationVersionId: _versionId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        internalCost,
        sellingPrice,
        baseRoomPrice,
        extraBedPrice,
        childWithoutBedPrice,
        showCheckInTime,
        showCheckOutTime,
        images: rawImages,
        ...row
      }) => ({
        ...row,
        ...(showCheckInTime == null ? {} : { showCheckInTime }),
        ...(showCheckOutTime == null ? {} : { showCheckOutTime }),
        internalCost: internalCost.toNumber(),
        sellingPrice: sellingPrice.toNumber(),
        baseRoomPrice:
          baseRoomPrice == null
            ? null
            : (baseRoomPrice as unknown as { toNumber: () => number }).toNumber(),
        extraBedPrice:
          extraBedPrice == null
            ? null
            : (extraBedPrice as unknown as { toNumber: () => number }).toNumber(),
        childWithoutBedPrice:
          childWithoutBedPrice == null
            ? null
            : (childWithoutBedPrice as unknown as { toNumber: () => number }).toNumber(),
        // Legacy rows store NULL in the Json column; normalize to [] so the
        // snapshot stays valid for every copy/revision path.
        images: (Array.isArray(rawImages) ? rawImages : []) as Array<{
          url: string;
          thumbnailUrl?: string | null;
          alt?: string | null;
        }>,
        imageSnapshotPresent: Array.isArray(rawImages),
        // Multi-room lines normalize the same way: legacy NULL → [].
        roomLines: Array.isArray(row.roomLines)
          ? (row.roomLines as HotelRowInput['roomLines'])
          : [],
        mealPlanLines: Array.isArray(row.mealPlanLines)
          ? (row.mealPlanLines as HotelRowInput['mealPlanLines'])
          : [],
      }),
    ),
    services: source.services.map(
      ({
        id: _id,
        companyId: _companyId,
        quotationVersionId: _versionId,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        unitCost,
        unitSellingPrice,
        totalCost: _totalCost,
        totalSellingPrice: _totalSellingPrice,
        pricingBasis: rawPricingBasis,
        images: rawImages,
        pricingSnapshot: rawPricingSnapshot,
        cruiseNights: rawCruiseNights,
        cruiseRoomLines: rawCruiseRoomLines,
        ...row
      }) => ({
        ...row,
        quantity: row.quantity.toNumber(),
        internalCost: unitCost.toNumber(),
        sellingPrice: unitSellingPrice.toNumber(),
        // Cruise duration persists in its own column (NULL for legacy rows).
        cruiseNights: (rawCruiseNights as number | null | undefined) ?? null,
        // Room allocations persist as JSON. An explicitly saved [] stays []
        // (roomless); legacy NULL stays undefined so readers keep synthesizing
        // the single room from the scalar columns.
        cruiseRoomLines: Array.isArray(rawCruiseRoomLines)
          ? (rawCruiseRoomLines as unknown as QuotationVersionInput['services'][number]['cruiseRoomLines'])
          : undefined,
        // The DB column is free-form text; normalize to the shared enum so a
        // stale/unknown value can never leak into the quotation input.
        pricingBasis: (SERVICE_PRICING_BASES as readonly string[]).includes(rawPricingBasis ?? '')
          ? (rawPricingBasis as (typeof SERVICE_PRICING_BASES)[number])
          : null,
        // Stored snapshot JSON normalizes to validated entries (legacy NULL).
        pricingSnapshot: normalizePricingSnapshotEntries(rawPricingSnapshot),
        images: (Array.isArray(rawImages) ? rawImages : []) as Array<{
          url: string;
          thumbnailUrl?: string | null;
          alt?: string | null;
        }>,
        imageSnapshotPresent: Array.isArray(rawImages),
      }),
    ),
    inclusions: source.inclusions.map(
      ({ id: _id, companyId: _companyId, quotationVersionId: _versionId, ...row }) => row,
    ),
    exclusions: source.exclusions.map(
      ({ id: _id, companyId: _companyId, quotationVersionId: _versionId, ...row }) => row,
    ),
    terms: source.terms.map(
      ({ id: _id, companyId: _companyId, quotationVersionId: _versionId, ...row }) => row,
    ),
  };
}

async function validateDestinationExpertConfig(
  auth: AuthContext,
  config: DestinationExpertConfig | null | undefined,
) {
  if (!config?.enabled || !config.expertUserId) return;
  const user = await prisma.user.findFirst({
    where: { id: config.expertUserId, companyId: auth.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!user)
    throw new ValidationError('Selected Destination Expert does not belong to this company.');
}

/** Include master-linked itinerary activities in the same tenancy validation. */
function masterRefServices(input: QuotationVersionInput) {
  // Segments across every flight record (validated input always carries the
  // canonical flights array; legacy mirrors are folded away on write).
  const flightRefs = (input.flightDetails?.flights ?? [])
    .flatMap((flight) => [
      ...(flight.outbound.segments ?? []),
      ...(flight.returnJourney.segments ?? []),
    ])
    .map((segment) => ({
      serviceType: 'FLIGHT' as const,
      airlineId: segment.airlineId,
    }));
  const activityRefs =
    input.sightseeingDetails?.days.flatMap((day) =>
      day.activities.map((activity) => ({
        serviceType: 'SIGHTSEEING' as const,
        sightseeingId: activity.sightseeingId,
      })),
    ) ?? [];
  return [...input.services, ...flightRefs, ...activityRefs];
}

/**
 * Ordered candidate names for Destination-image lookup. Resolution order:
 *   1. itinerary `country` values (Master destinations, e.g. "Malaysia")
 *   2. destinationSummary parts (legacy fallback)
 *   3. itinerary `destination` values (city; last resort for legacy rows)
 * De-duplicated, first-seen order. Pure and exported for focused tests.
 */
export function destinationImageCandidates(
  destinationSummary: string | null | undefined,
  itinerary: Array<{ country?: string | null; destination?: string | null }> | null | undefined,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    for (const part of (value ?? '').split(/[•,>/→|-]+/)) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        ordered.push(trimmed);
      }
    }
  };
  for (const row of itinerary ?? []) add(row.country);
  add(destinationSummary);
  for (const row of itinerary ?? []) add(row.destination);
  return ordered;
}

/**
 * Pick the hotel snapshot image the PDF should render for a bookmarked hotel:
 * the image marked "Use in PDF" (`pdfImageUrl`), falling back to the first
 * image in the saved order. Returns null when there are no snapshot images.
 */
export function resolvePdfHotelImageUrl(
  images:
    | Array<{ id?: string | null; masterImageId?: string | null; url?: string | null }>
    | undefined
    | null,
  pdfImageUrl: string | null | undefined,
): string | null {
  const usable = (images ?? []).filter(
    (image): image is typeof image & { url: string } =>
      typeof image.url === 'string' && Boolean(image.url.trim()),
  );
  const selected = usable.find(
    (image) => quotationSnapshotImageIdentity(image as QuotationSnapshotImage) === pdfImageUrl,
  );
  return selected?.url.trim() ?? usable[0]?.url.trim() ?? null;
}

/** Internal PDF choice: explicit stable id/legacy URL, then first saved image. */
export function resolvePdfSnapshotImage(
  images: unknown,
  pdfImageUrl: string | null | undefined,
): StoredQuotationImage | null {
  const stored = storedQuotationImages(images);
  if (!stored.length) return null;
  return stored.find((image) => storedImageIdentity(image) === pdfImageUrl) ?? stored[0] ?? null;
}

/**
 * Finds a Destination master (with a confirmed image) that matches the quote's
 * Destination/Master country. In this data model the lead itinerary's `country`
 * field holds the Destination Master name (e.g. "Malaysia") while `destination`
 * holds the city (e.g. "Kuala Lumpur"). Resolution order:
 *   1. itinerary `country` values (Master destinations) — exact match first
 *   2. destinationSummary parts (legacy fallback)
 *   3. itinerary `destination` values (city; last resort for legacy rows)
 * This ensures a Malaysia → Kuala Lumpur quotation resolves the Malaysia Master
 * image rather than looking for a "Kuala Lumpur" Destination (which never exists).
 * Shared by the customer weblink hero (signed URL) and the PDF (raw bytes).
 * Returns null when nothing matches.
 */
async function findDestinationImageRecord(
  companyId: string,
  destinationSummary: string,
  itinerary: Array<{ country?: string | null; destination?: string | null }> | null | undefined,
): Promise<{ imageObjectKey: string; imageFileName: string | null } | null> {
  const orderedCandidates = destinationImageCandidates(destinationSummary, itinerary);
  if (!orderedCandidates.length) return null;
  const destinations = await prisma.destination.findMany({
    where: {
      companyId,
      imageObjectKey: { not: null },
      imageConfirmedAt: { not: null },
    },
    select: {
      id: true,
      name: true,
      normalizedName: true,
      imageObjectKey: true,
      imageFileName: true,
    },
  });
  const selected = selectDestinationImageRecord(
    destinations,
    fullImageNameCandidates(destinationSummary, itinerary),
    orderedCandidates,
  );
  if (selected?.imageObjectKey) {
    return { imageObjectKey: selected.imageObjectKey, imageFileName: selected.imageFileName };
  }
  return null;
}

/**
 * Pure destination-image row selection (no I/O; exported for focused tests).
 *
 * Resolution order, most precise first:
 *   1. full-string exact match — the whole destination summary or a whole
 *      itinerary country/destination (e.g. a "Vietnam - Ho Chi Minh • Da Nang
 *      • Hanoi - 6 Nights" master) wins over any of its fragments;
 *   2. per-part exact match, in quotation-data order (unchanged legacy rule);
 *   3. fuzzy fallback per candidate, keeping the LONGEST (most specific)
 *      destination name with deterministic name/id tiebreaks — never the
 *      arbitrary heap-order first row. Candidate priority order is preserved:
 *      an earlier candidate's hit always beats a later candidate's hit.
 */
export function selectDestinationImageRecord(
  destinations: Array<{
    id: string;
    name: string;
    normalizedName: string;
    imageObjectKey: string | null;
    imageFileName: string | null;
  }>,
  fullCandidates: string[],
  orderedCandidates: string[],
): {
  id: string;
  name: string;
  normalizedName: string;
  imageObjectKey: string | null;
  imageFileName: string | null;
} | null {
  const normalized = (value: string) => value.trim().toLowerCase();
  const withImage = destinations.filter((row) => row.imageObjectKey);
  // 1. Full-string exact matches, most precise first.
  for (const candidate of fullCandidates) {
    if (!candidate) continue;
    const exact = withImage.find(
      (row) => normalized(row.name) === candidate || normalized(row.normalizedName) === candidate,
    );
    if (exact) return exact;
  }
  // 2. Per-part exact matches, in order of appearance in the quotation data.
  for (const candidate of orderedCandidates) {
    const exact = withImage.find(
      (row) => normalized(row.name) === candidate || normalized(row.normalizedName) === candidate,
    );
    if (exact) return exact;
  }
  // 3. Fuzzy fallback: most specific (longest) name per candidate.
  for (const candidate of orderedCandidates) {
    if (candidate.length <= 2) continue;
    const hits = withImage
      .filter((row) => {
        const name = normalized(row.name);
        return name.includes(candidate) || candidate.includes(name);
      })
      .sort(
        (a, b) =>
          normalized(b.name).length - normalized(a.name).length ||
          normalized(a.name).localeCompare(normalized(b.name)) ||
          a.id.localeCompare(b.id),
      );
    if (hits[0]) return hits[0];
  }
  return null;
}

/**
 * Whole-string candidate names for Destination-image lookup: the full
 * destination summary plus each full itinerary country/destination, normalized
 * and de-duplicated. The split-fragment list from destinationImageCandidates
 * can never equal a long master name, so without these a quotation for
 * "Vietnam - Ho Chi Minh • Da Nang • Hanoi - 6 Nights" can only ever match
 * short fragments ("vietnam", "da nang") and land on a stale record.
 * Pure and exported for focused tests.
 */
export function fullImageNameCandidates(
  destinationSummary: string | null | undefined,
  itinerary: Array<{ country?: string | null; destination?: string | null }> | null | undefined,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = (value ?? '').trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      ordered.push(normalized);
    }
  };
  add(destinationSummary);
  for (const row of itinerary ?? []) add(row.country);
  for (const row of itinerary ?? []) add(row.destination);
  return ordered;
}

/** Signed weblink hero URL; null when no destination image matches. */
async function resolveDestinationHeroImage(
  companyId: string,
  destinationSummary: string,
  itinerary: Array<{ country?: string | null; destination?: string | null }> | null | undefined,
): Promise<string | null> {
  const match = await findDestinationImageRecord(companyId, destinationSummary, itinerary);
  if (!match) return null;
  try {
    return await storageService.createDownloadUrl(
      match.imageObjectKey,
      match.imageFileName ?? 'destination.jpg',
    );
  } catch {
    return null;
  }
}

/**
 * Page-1 consultant data for the quotation PDF. Precedence: quotation
 * prepared-by (creator) → linked lead assignee → company contact fallback.
 * All lookups are tenant-scoped; missing values resolve to null so the renderer
 * omits them cleanly.
 */
async function resolvePdfConsultant(
  companyId: string,
  quotation: FullQuotation,
  companyContact: { phone: string | null; email: string },
): Promise<{ name: string | null; phone: string | null; email: string | null }> {
  const userIds = [quotation.createdById, quotation.query?.assignedToId].filter(
    (id): id is string => Boolean(id),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, companyId, deletedAt: null },
        select: { id: true, fullName: true, phone: true, email: true },
      })
    : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  const creator = byId.get(quotation.createdById);
  const assignee = quotation.query?.assignedToId ? byId.get(quotation.query.assignedToId) : null;
  return {
    name: creator?.fullName ?? assignee?.fullName ?? null,
    phone: creator?.phone ?? assignee?.phone ?? companyContact.phone ?? null,
    email: creator?.email ?? assignee?.email ?? companyContact.email,
  };
}

/** Stored links may resolve against their tenant owner or the one System company. */
async function linkedMasterOwnerCompanyIds(tenantCompanyId: string): Promise<string[]> {
  const systemCompanyId = await getSystemCompanyId();
  return [tenantCompanyId, systemCompanyId].filter(
    (id, index, values): id is string => Boolean(id) && values.indexOf(id) === index,
  );
}

/** Customer-safe hotel catalogue details used by the public quotation cards. */
async function resolveHotelPresentations(
  ownerCompanyIds: string[],
  options: Array<{ id: string; hotelId: string | null }>,
) {
  const hotelIds = [...new Set(options.map((row) => row.hotelId).filter(Boolean))] as string[];
  if (!hotelIds.length) return {};
  const hotels = await prisma.hotel.findMany({
    where: { id: { in: hotelIds }, companyId: { in: ownerCompanyIds } },
    select: {
      id: true,
      starCategory: true,
      starRating: true,
      address: true,
      reviewLink: true,
      checkInTime: true,
      checkOutTime: true,
      imageObjectKey: true,
      imageFileName: true,
      imageConfirmedAt: true,
      destination: { select: { name: true, countryName: true } },
    },
  });
  const byId = new Map(
    await Promise.all(
      hotels.map(async (hotel) => {
        let imageUrl: string | null = null;
        if (hotel.imageObjectKey && hotel.imageConfirmedAt) {
          try {
            imageUrl = await storageService.createDownloadUrl(
              hotel.imageObjectKey,
              hotel.imageFileName ?? 'hotel.jpg',
            );
          } catch {
            imageUrl = null;
          }
        }
        return [
          hotel.id,
          {
            imageUrl,
            starCategory: hotel.starCategory,
            starRating: decimal(hotel.starRating),
            address: hotel.address,
            reviewLink: hotel.reviewLink,
            checkInTime: hotel.checkInTime,
            checkOutTime: hotel.checkOutTime,
            destination: hotel.destination.name,
            country: hotel.destination.countryName,
          },
        ] as const;
      }),
    ),
  );
  return Object.fromEntries(
    options.flatMap((option) => {
      const presentation = option.hotelId ? byId.get(option.hotelId) : undefined;
      return presentation ? [[option.id, presentation]] : [];
    }),
  );
}

/** Customer-safe vehicle catalogue details used by the public quotation card. */
async function resolveVehiclePresentations(
  ownerCompanyIds: string[],
  services: Array<{ id: string; vehicleId: string | null }>,
) {
  const vehicleIds = [...new Set(services.map((row) => row.vehicleId).filter(Boolean))] as string[];
  if (!vehicleIds.length) return {};
  const vehicles = await prisma.vehicle.findMany({
    where: { id: { in: vehicleIds }, companyId: { in: ownerCompanyIds } },
    select: {
      id: true,
      name: true,
      vehicleType: true,
      capacity: true,
      imageObjectKey: true,
      imageFileName: true,
      imageConfirmedAt: true,
    },
  });
  const byId = new Map(
    await Promise.all(
      vehicles.map(async (vehicle) => {
        let imageUrl: string | null = null;
        if (vehicle.imageObjectKey && vehicle.imageConfirmedAt) {
          try {
            imageUrl = await storageService.createDownloadUrl(
              vehicle.imageObjectKey,
              vehicle.imageFileName ?? 'vehicle.jpg',
            );
          } catch {
            imageUrl = null;
          }
        }
        return [
          vehicle.id,
          {
            imageUrl,
            name: vehicle.name,
            vehicleType: vehicle.vehicleType,
            capacity: vehicle.capacity,
          },
        ] as const;
      }),
    ),
  );
  return Object.fromEntries(
    services.flatMap((service) => {
      const presentation = service.vehicleId ? byId.get(service.vehicleId) : undefined;
      return presentation ? [[service.id, presentation]] : [];
    }),
  );
}

/** Customer-safe Cruise master image + room-type name used by public cruise cards. */
async function resolveCruisePresentations(
  ownerCompanyIds: string[],
  services: Array<{ id: string; cruiseId: string | null; cruiseRoomTypeId: string | null }>,
) {
  const cruiseIds = [...new Set(services.map((row) => row.cruiseId).filter(Boolean))] as string[];
  if (!cruiseIds.length) return {};
  const cruises = await prisma.cruise.findMany({
    where: { id: { in: cruiseIds }, companyId: { in: ownerCompanyIds } },
    select: {
      id: true,
      name: true,
      imageObjectKey: true,
      imageFileName: true,
      imageConfirmedAt: true,
      roomTypes: {
        where: { status: 'ACTIVE' },
        select: { id: true, name: true },
        orderBy: { sortOrder: 'asc' as const },
      },
    },
  });
  const roomNameById = new Map<string, string>();
  for (const cruise of cruises)
    for (const room of cruise.roomTypes) roomNameById.set(room.id, room.name);
  const byCruise = new Map(
    await Promise.all(
      cruises.map(async (cruise) => {
        let imageUrl: string | null = null;
        if (cruise.imageObjectKey && cruise.imageConfirmedAt) {
          try {
            imageUrl = await storageService.createDownloadUrl(
              cruise.imageObjectKey,
              cruise.imageFileName ?? 'cruise.jpg',
            );
          } catch {
            imageUrl = null;
          }
        }
        return [cruise.id, { imageUrl, name: cruise.name }] as const;
      }),
    ),
  );
  return Object.fromEntries(
    services.flatMap((service) => {
      const cruise = service.cruiseId ? byCruise.get(service.cruiseId) : undefined;
      if (!cruise) return [];
      return [
        [
          service.id,
          {
            imageUrl: cruise.imageUrl,
            name: cruise.name,
            roomTypeName: service.cruiseRoomTypeId
              ? (roomNameById.get(service.cruiseRoomTypeId) ?? null)
              : null,
          },
        ],
      ];
    }),
  );
}

/** Customer-safe Airline master logos used by public flight segment cards. */
async function resolveAirlinePresentations(ownerCompanyIds: string[], flightDetails: unknown) {
  const parsed = flightDetailsSchema.safeParse(flightDetails);
  if (!parsed.success) return {};
  const segments = parsed.data.flights.flatMap((flight) => [
    ...flight.outbound.segments,
    ...flight.returnJourney.segments,
  ]);
  const airlineIds = [
    ...new Set(segments.map((segment) => segment.airlineId).filter(Boolean)),
  ] as string[];
  if (!airlineIds.length) return {};
  const airlines = await prisma.airline.findMany({
    where: { id: { in: airlineIds }, companyId: { in: ownerCompanyIds } },
    select: {
      id: true,
      name: true,
      logoObjectKey: true,
      logoFileName: true,
      logoConfirmedAt: true,
    },
  });
  return Object.fromEntries(
    await Promise.all(
      airlines.map(async (airline) => {
        let logoUrl: string | null = null;
        if (airline.logoObjectKey && airline.logoConfirmedAt) {
          try {
            logoUrl = await storageService.createDownloadUrl(
              airline.logoObjectKey,
              airline.logoFileName ?? 'airline-logo',
            );
          } catch {
            logoUrl = null;
          }
        }
        return [airline.id, { name: airline.name, logoUrl }] as const;
      }),
    ),
  );
}

/** Destination Expert — fetch expert user and decide the optional avatar presentation.
 * Uses per-quotation saved contacts when present, otherwise falls back to real
 * expert/company data. Never manufactures fake numbers.
 */
async function resolveDestinationExpertPresentation(
  companyId: string,
  config: DestinationExpertConfig | null | undefined,
) {
  if (!config?.enabled || !config.expertUserId) return null;
  const [user, company] = await Promise.all([
    prisma.user.findFirst({
      where: { id: config.expertUserId, companyId, deletedAt: null },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        whatsappNumber: true,
        jobTitle: true,
        bio: true,
        specialization: true,
        yearsOfExperience: true,
        tripsPlanned: true,
        languages: true,
        gender: true,
        profileImageObjectKey: true,
        profileImageConfirmedAt: true,
      },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { phone: true, email: true },
    }),
  ]);
  if (!user) return null;
  // Snapshot fields from quotation config (imported preset) take precedence over live user data
  const snap = config as unknown as Record<string, unknown>;
  const snapJobTitle =
    typeof snap.jobTitle === 'string'
      ? (snap.jobTitle as string).trim() || null
      : ((snap.jobTitle as string | null) ?? null);
  const snapBio =
    typeof snap.bio === 'string'
      ? (snap.bio as string).trim() || null
      : ((snap.bio as string | null) ?? null);
  const snapSpecialization =
    typeof snap.specialization === 'string'
      ? (snap.specialization as string).trim() || null
      : ((snap.specialization as string | null) ?? null);
  const snapYears = snap.yearsOfExperience != null ? Number(snap.yearsOfExperience) : null;
  const snapTrips = snap.tripsPlanned != null ? Number(snap.tripsPlanned) : null;
  const snapLanguages =
    typeof snap.languages === 'string'
      ? (snap.languages as string).trim() || null
      : ((snap.languages as string | null) ?? null);
  const snapGender =
    snap.gender === 'MALE' || snap.gender === 'FEMALE' ? (snap.gender as string) : null;
  const snapProfileImageUrl =
    typeof snap.profileImageUrl === 'string' && (snap.profileImageUrl as string).trim()
      ? (snap.profileImageUrl as string).trim()
      : null;
  const hasSnapProfileImage = 'profileImageUrl' in snap;

  // Avatar priority: snapshot custom photo > user custom photo > gender default > no avatar.
  let avatarUrl: string | null = null;
  let avatarKind: 'custom' | 'male' | 'female' | null = null;
  if (hasSnapProfileImage && snapProfileImageUrl) {
    avatarUrl = snapProfileImageUrl;
    avatarKind = 'custom';
  } else if (user.profileImageObjectKey && user.profileImageConfirmedAt) {
    try {
      avatarUrl = await storageService.createDownloadUrl(
        user.profileImageObjectKey,
        'profile-image',
        env.MASTER_MEDIA_PRESIGNED_URL_EXPIRY_SECONDS,
      );
      avatarKind = 'custom';
    } catch {
      avatarUrl = null;
    }
  }
  if (!avatarUrl) {
    const effectiveGender = snapGender ?? user.gender;
    if (effectiveGender === 'MALE') avatarKind = 'male';
    else if (effectiveGender === 'FEMALE') avatarKind = 'female';
  }

  // Per-quotation contact overrides (snapshot). Undefined means old quotation without the field
  // → fall back to real data. Null/empty means explicit empty → hide that action.
  const hasWhatsapp = (config as unknown as Record<string, unknown>).whatsappNumber !== undefined;
  const hasCall = (config as unknown as Record<string, unknown>).callNumber !== undefined;
  const hasEmail = (config as unknown as Record<string, unknown>).email !== undefined;

  const savedWhatsapp = (config as unknown as { whatsappNumber?: string | null }).whatsappNumber;
  const savedCall = (config as unknown as { callNumber?: string | null }).callNumber;
  const savedEmail = (config as unknown as { email?: string | null }).email;

  const effectiveWhatsapp = hasWhatsapp
    ? savedWhatsapp?.trim() || null
    : user.whatsappNumber?.trim() || user.phone?.trim() || company?.phone?.trim() || null;
  const effectiveCall = hasCall
    ? savedCall?.trim() || null
    : user.phone?.trim() || company?.phone?.trim() || null;
  const effectiveEmail = hasEmail
    ? savedEmail?.trim().toLowerCase() || null
    : user.email?.trim() || company?.email?.trim() || null;

  return {
    id: user.id,
    fullName: user.fullName,
    email: effectiveEmail,
    phone: effectiveCall,
    whatsappNumber: effectiveWhatsapp,
    jobTitle: snapJobTitle ?? user.jobTitle,
    bio: snapBio ?? user.bio,
    specialization: snapSpecialization ?? user.specialization,
    yearsOfExperience: snapYears ?? user.yearsOfExperience,
    tripsPlanned: snapTrips ?? user.tripsPlanned,
    languages: snapLanguages ?? user.languages,
    gender: (snapGender as 'MALE' | 'FEMALE' | null) ?? user.gender,
    profileImageUrl: avatarUrl,
    avatarKind,
    // Internal-only: used by the PDF path to fetch the profile image bytes.
    // Stripped before the public weblink response.
    profileImageObjectKey: user.profileImageObjectKey,
    profileImageConfirmedAt: user.profileImageConfirmedAt,
    config: {
      heading: config.heading,
      customIntroduction: config.customIntroduction,
      showWhatsapp: config.showWhatsapp !== false,
      showCall: config.showCall !== false,
      showEmail: config.showEmail !== false,
      showExperience: config.showExperience !== false,
      showTripsPlanned: config.showTripsPlanned !== false,
      showLanguages: config.showLanguages !== false,
    },
  };
}

const defaultExpertAvatarCache = new Map<string, Buffer>();

function loadDefaultExpertAvatar(kind: 'male' | 'female'): Buffer | null {
  const cached = defaultExpertAvatarCache.get(kind);
  if (cached) return cached;
  const fileName = `${kind}.png`;
  let fileDirCandidates: string[] = [];
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    fileDirCandidates = [
      resolve(currentDir, `../../../web/public/destination-expert/${fileName}`),
      resolve(currentDir, `../../../../apps/web/public/destination-expert/${fileName}`),
      resolve(currentDir, `../../../images/${fileName}`),
      resolve(currentDir, `../../assets/destination-expert/${fileName}`),
      resolve(currentDir, `../../../assets/destination-expert/${fileName}`),
    ];
  } catch {
    // No default expert avatar configured for this kind — fall through.
  }
  const candidates = [
    ...fileDirCandidates,
    resolve(process.cwd(), `apps/web/public/destination-expert/${fileName}`),
    resolve(process.cwd(), `apps/images/${fileName}`),
    resolve(process.cwd(), `apps/api/src/assets/destination-expert/${fileName}`),
    resolve(process.cwd(), `apps/api/src/assets/${fileName}`),
    resolve(process.cwd(), `src/assets/${fileName}`),
    resolve(process.cwd(), `src/assets/destination-expert/${fileName}`),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;
  try {
    const buf = readFileSync(path);
    if (buf?.length) {
      defaultExpertAvatarCache.set(kind, buf);
      return buf;
    }
  } catch {
    // Unreadable cache file — treat as no cached avatar.
  }
  return null;
}

/** Maps each sightseeing activity's master id to a short-lived signed image URL. */
async function resolveSightseeingPresentations(
  ownerCompanyIds: string[],
  sightseeingDetails: unknown,
) {
  const parsed = sightseeingDetailsSchema.safeParse(sightseeingDetails);
  if (!parsed.success) return {};
  const ids = [
    ...new Set(
      parsed.data.days
        .flatMap((day) => day.activities.map((activity) => activity.sightseeingId))
        .filter(Boolean),
    ),
  ] as string[];
  if (!ids.length) return {};
  const rows = await prisma.sightseeing.findMany({
    where: { id: { in: ids }, companyId: { in: ownerCompanyIds } },
    select: { id: true, imageObjectKey: true, imageFileName: true, imageConfirmedAt: true },
  });
  return Object.fromEntries(
    await Promise.all(
      rows.map(async (row) => {
        let imageUrl: string | null = null;
        if (row.imageObjectKey && row.imageConfirmedAt) {
          try {
            imageUrl = await storageService.createDownloadUrl(
              row.imageObjectKey,
              row.imageFileName ?? 'sightseeing',
            );
          } catch {
            imageUrl = null;
          }
        }
        return [row.id, { imageUrl }] as const;
      }),
    ),
  );
}

async function getVersion(auth: AuthContext, quotationId: string, versionId: string) {
  await getQuotation(auth, quotationId);
  const version = await prisma.quotationVersion.findFirst({
    where: { id: versionId, quotationId, companyId: auth.companyId },
    include: versionInclude,
  });
  if (!version) throw new NotFoundError('Quotation version not found.');
  return version;
}

async function createVersion(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  quotationId: string,
  input: QuotationVersionInput,
  versionNumber: number,
  allowCosting: boolean,
  pax: PaxCounts,
  retainedRefs: RetainedMasterRefs = {},
) {
  // Single choke point for version creation: initial version, added revision,
  // duplication and template application all funnel through here.
  const access = await validateMasterRefs(
    auth,
    input.hotels ?? [],
    masterRefServices(input),
    retainedRefs,
  );
  await validateDestinationExpertConfig(
    auth,
    input.destinationExpertConfig as DestinationExpertConfig,
  );
  // Hydration runs only after the ids have passed the same tenant/System Global
  // boundary, so a client can never use an arbitrary company's id to copy media.
  const hydratedInput = await hydrateQuotationImageSnapshots(
    tx,
    access.imageOwnerCompanyIds,
    input,
  );
  const pricingEnrichedInput = await enrichHotelPricingSnapshots(
    tx,
    access.imageOwnerCompanyIds,
    hydratedInput,
  );

  const data = versionCreateData(pricingEnrichedInput, auth.companyId, allowCosting, pax);
  const version = await tx.quotationVersion.create({
    data: {
      companyId: auth.companyId,
      quotationId,
      versionNumber,
      createdById: auth.userId,
      ...data.scalar,
    },
  });
  if (data.itinerary.length)
    await tx.quotationVersionItineraryDay.createMany({
      data: data.itinerary.map((row) => ({
        ...row,
        quotationVersionId: version.id,
      })) as Prisma.QuotationVersionItineraryDayCreateManyInput[],
    });
  if (data.hotels.length)
    await tx.quotationVersionHotelOption.createMany({
      data: data.hotels.map((row) => ({
        ...row,
        quotationVersionId: version.id,
      })) as Prisma.QuotationVersionHotelOptionCreateManyInput[],
    });
  if (data.services.length)
    await tx.quotationVersionService.createMany({
      data: data.services.map((row) => ({
        ...row,
        quotationVersionId: version.id,
      })) as Prisma.QuotationVersionServiceCreateManyInput[],
    });
  if (data.inclusions.length)
    await tx.quotationVersionInclusion.createMany({
      data: data.inclusions.map((row) => ({ ...row, quotationVersionId: version.id })),
    });
  if (data.exclusions.length)
    await tx.quotationVersionExclusion.createMany({
      data: data.exclusions.map((row) => ({ ...row, quotationVersionId: version.id })),
    });
  if (data.terms.length)
    await tx.quotationVersionTerm.createMany({
      data: data.terms.map((row) => ({ ...row, quotationVersionId: version.id })),
    });
  return tx.quotationVersion.findUniqueOrThrow({
    where: { id: version.id },
    include: versionInclude,
  });
}

import {
  asAbsoluteHttpsUrl,
  buildQuotationPreviewHtml,
  escapeHtml,
} from './quotation-preview-html.js';

const PREVIEW_TITLE_BASE = 'Personalized Travel Quotation';

type PreviewCompanyBranding = {
  siteName: string;
  imageUrl?: string | undefined;
  imageAlt?: string | undefined;
  imageMimeType?: string | undefined;
};

/**
 * Tenant branding for a quotation preview, resolved from the quotation's OWN
 * company — never the current session, never a global default. Returns the
 * company name with an absolute HTTPS logo URL when a confirmed logo exists
 * and a signed URL can be minted; otherwise name-only (no image tag at all —
 * a generic CRM logo must never stand in for a tenant).
 */
async function previewCompanyBranding(companyId: string): Promise<PreviewCompanyBranding | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      logoObjectKey: true,
      logoConfirmedAt: true,
      logoMimeType: true,
    },
  });
  if (!company) return null;
  let imageUrl: string | undefined;
  if (company.logoObjectKey && company.logoConfirmedAt) {
    try {
      const signed = await storageService.createDownloadUrl(
        company.logoObjectKey,
        'logo',
        env.OG_IMAGE_PRESIGNED_URL_EXPIRY_SECONDS,
        'inline',
      );
      imageUrl = asAbsoluteHttpsUrl(signed);
    } catch {
      imageUrl = undefined;
    }
  }
  return {
    siteName: company.name,
    imageUrl,
    imageAlt: company.name,
    imageMimeType: company.logoMimeType ?? undefined,
  };
}

function previewDocumentForQuotation(
  quotation: { id?: unknown; companyId: string; query?: { customerName?: string | null } | null },
  canonicalUrl: string,
  branding: PreviewCompanyBranding | null,
): string {
  const leadName = quotation.query?.customerName?.trim() || null;
  const siteName = branding?.siteName ?? PREVIEW_TITLE_BASE;
  return buildQuotationPreviewHtml({
    title: leadName ? `${siteName} – ${leadName}` : siteName,
    canonicalUrl,
    siteName,
    imageUrl: branding?.imageUrl,
    imageAlt: branding?.imageAlt,
    imageMimeType: branding?.imageMimeType,
  });
}

export const quotationsService = {
  async list(auth: AuthContext, query: Record<string, unknown>) {
    const page = resolvePagination({
      page: Number(query.page) || undefined,
      pageSize: Number(query.pageSize) || undefined,
    });
    const search = typeof query.search === 'string' ? query.search : undefined;
    const status = typeof query.status === 'string' ? query.status : undefined;
    const destination = typeof query.destination === 'string' ? query.destination : undefined;
    const where = await visibleWhere(auth, {
      ...(status ? { status: status as Prisma.EnumQuotationStatusFilter } : {}),
      ...(destination
        ? { destinationSummary: { contains: destination, mode: 'insensitive' } }
        : {}),
      ...(typeof query.createdById === 'string' ? { createdById: query.createdById } : {}),
      ...(search
        ? {
            OR: [
              { quotationNumber: { contains: search, mode: 'insensitive' } },
              { customerName: { contains: search, mode: 'insensitive' } },
              { customerPhone: { contains: search } },
              { destinationSummary: { contains: search, mode: 'insensitive' } },
              { query: { queryNumber: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    });
    const [rows, total, costing] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: quotationInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      prisma.quotation.count({ where }),
      hasCosting(auth),
    ]);
    const counts = await prisma.quotation.groupBy({
      by: ['status'],
      where: await visibleWhere(auth),
      _count: { _all: true },
    });
    const accepted = rows.filter((row) => row.status === 'ACCEPTED').length;
    const decided = rows.filter((row) => ['ACCEPTED', 'REJECTED'].includes(row.status)).length;
    return {
      data: await Promise.all(rows.map((row) => presentQuotation(row, costing))),
      pagination: { ...page, total, totalPages: total ? Math.ceil(total / page.pageSize) : 0 },
      analytics: {
        byStatus: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
        totalQuotedValue: rows
          .reduce((sum, row) => sum + Number(row.versions[0]?.finalAmount ?? 0), 0)
          .toFixed(2),
        acceptanceRate: decided ? Number(((accepted / decided) * 100).toFixed(1)) : 0,
      },
    };
  },

  async details(auth: AuthContext, id: string) {
    const [quotation, costing, activityTimeline] = await Promise.all([
      getQuotation(auth, id),
      hasCosting(auth),
      prisma.activityLog.findMany({
        where: {
          companyId: auth.companyId,
          entityType: { in: ['Quotation', 'QuotationDocument'] },
          OR: [{ entityId: id }, { metadata: { path: ['quotationId'], equals: id } }],
        },
        select: {
          id: true,
          action: true,
          metadata: true,
          createdAt: true,
          actorUser: { select: userSelect },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      ...(await presentQuotation(quotation, costing)),
      activityTimeline,
      // Resolved friendly-slug base for the Weblink Name preview (custom domain
      // when ACTIVE, else the apex domain).
      publicSlugBaseUrl: await friendlyPublicSlugBaseUrl(auth.companyId),
    };
  },

  async create(auth: AuthContext, input: QuotationInput, context: RequestContext) {
    const lead = await getVisibleLead(auth, input.queryId);
    const costing = await hasCosting(auth);
    // Company default quotation terms are used only when neither the request nor
    // a source template supplies terms; existing quotations are never changed.
    const companyDefaults = await prisma.company.findUniqueOrThrow({
      where: { id: auth.companyId },
      select: { defaultQuotationTerms: true },
    });
    const defaultTermRows = companyDefaults.defaultQuotationTerms
      ? [{ content: companyDefaults.defaultQuotationTerms, sequence: 1 }]
      : [];
    let source: QuotationVersionInput | undefined;
    if (input.templateId) {
      const template = await prisma.quotationTemplate.findFirst({
        where: {
          id: input.templateId,
          companyId: auth.companyId,
          status: 'ACTIVE',
          deletedAt: null,
        },
        include: templateInclude,
      });
      if (!template) throw new NotFoundError('Active quotation template not found.');
      source = {
        title: template.name,
        introduction: template.description,
        destinationSummary: template.destinationSummary,
        travelStartDate: input.travelStartDate ?? lead.travelStartDate,
        travelEndDate: input.travelEndDate ?? lead.travelEndDate,
        currency: input.currency ?? template.baseCurrency,
        pricingMode: 'PER_PERSON',
        pricingHeading: 'Price Breakdown',
        pricingSubheading: null,
        pricingDisplayOrder: undefined,
        markupMode: 'NONE',
        markupValue: 0,
        taxRate: 0,
        discountAmount: 0,
        notes: null,
        internalNotes: template.internalNotes,
        itinerary: template.itinerary.map(
          ({
            id: _id,
            companyId: _companyId,
            templateId: _templateId,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            ...row
          }) => ({ ...row, date: null }),
        ),
        hotels: template.hotels.map(
          ({
            id: _id,
            companyId: _companyId,
            templateId: _templateId,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            internalCost,
            sellingPrice,
            baseRoomPrice,
            extraBedPrice,
            childWithoutBedPrice,
            showCheckInTime,
            showCheckOutTime,
            ...row
          }) => ({
            ...row,
            ...(showCheckInTime == null ? {} : { showCheckInTime }),
            ...(showCheckOutTime == null ? {} : { showCheckOutTime }),
            internalCost: internalCost?.toNumber(),
            sellingPrice: sellingPrice?.toNumber(),
            baseRoomPrice:
              (baseRoomPrice as unknown as { toNumber?: () => number })?.toNumber?.() ?? null,
            extraBedPrice:
              (extraBedPrice as unknown as { toNumber?: () => number })?.toNumber?.() ?? null,
            childWithoutBedPrice:
              (childWithoutBedPrice as unknown as { toNumber?: () => number })?.toNumber?.() ??
              null,
            // Template hotel options have no images column; keep the shared
            // hotel schema shape valid on apply.
            images: [],
            // Legacy template rows store NULL in the Json line columns.
            roomLines: Array.isArray(row.roomLines)
              ? (row.roomLines as unknown as HotelRowInput['roomLines'])
              : [],
            mealPlanLines: Array.isArray(row.mealPlanLines)
              ? (row.mealPlanLines as unknown as HotelRowInput['mealPlanLines'])
              : [],
          }),
        ),
        services: template.services.map(
          ({
            id: _id,
            companyId: _companyId,
            templateId: _templateId,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            quantity,
            internalCost,
            sellingPrice,
            pricingSnapshot: rawPricingSnapshot,
            ...row
          }) => ({
            ...row,
            quantity: quantity.toNumber(),
            internalCost: internalCost?.toNumber(),
            sellingPrice: sellingPrice?.toNumber(),
            // Template-owned snapshot normalizes like the quotation one.
            pricingSnapshot: normalizePricingSnapshotEntries(rawPricingSnapshot),
            images: [],
            pdfImageUrl: null,
          }),
        ),
        inclusions: template.inclusions.map(
          ({ id: _id, companyId: _companyId, templateId: _templateId, ...row }) => row,
        ),
        exclusions: template.exclusions.map(
          ({ id: _id, companyId: _companyId, templateId: _templateId, ...row }) => row,
        ),
        terms: template.terms.map(
          ({ id: _id, companyId: _companyId, templateId: _templateId, ...row }) => row,
        ),
        faqs: [],
        weblinkSectionOrder: null,
      };
    } else if (input.sourceVersionId) {
      const original = await prisma.quotationVersion.findFirst({
        where: {
          id: input.sourceVersionId,
          companyId: auth.companyId,
          quotation: await visibleWhere(auth),
        },
        include: versionInclude,
      });
      if (!original) throw new NotFoundError('Source quotation version not found.');
      source = fromVersion(original);
    }
    // The lead itinerary stores the Master Destination in `country` and an
    // optional city in `destination` (Create Lead no longer collects a city, so
    // `destination` is blank on new leads). Build the destination summary from
    // each stay's city when present and otherwise its Master Destination — never
    // from the blank city alone, which would collapse to an empty/invalid value.
    const leadDestinationParts = lead.itinerary
      .map((row) => (row.destination ?? '').trim() || (row.country ?? '').trim())
      .filter((part) => part.length > 0);
    const destination =
      input.destinationSummary ??
      source?.destinationSummary ??
      (leadDestinationParts.join(' • ') || lead.departureCity || 'Travel package');
    const primaryDestination =
      leadDestinationParts[0] || destination.split(/[•(→>,]/)[0]?.trim() || destination;
    const defaultTitle = `${primaryDestination} Package for ${lead.customerName}`;
    // The weblink package heading defaults to the lead-based label (never the
    // quotation title, never an itinerary city).
    const defaultPackageHeading = `Custom Package for ${lead.customerName}`;
    const version: QuotationVersionInput = {
      title: input.version?.title ?? source?.title ?? defaultTitle,
      packageHeading:
        input.version?.packageHeading ?? source?.packageHeading ?? defaultPackageHeading,
      weblinkDurationText:
        input.version?.weblinkDurationText ?? source?.weblinkDurationText ?? null,
      weblinkProfileDestination:
        input.version?.weblinkProfileDestination ?? source?.weblinkProfileDestination ?? null,
      weblinkProfile: input.version?.weblinkProfile ?? source?.weblinkProfile ?? null,
      introduction: input.version?.introduction ?? source?.introduction ?? '',
      destinationSummary: input.version?.destinationSummary ?? destination,
      travelStartDate:
        input.version?.travelStartDate ??
        input.travelStartDate ??
        source?.travelStartDate ??
        lead.travelStartDate,
      travelEndDate:
        input.version?.travelEndDate ??
        input.travelEndDate ??
        source?.travelEndDate ??
        lead.travelEndDate,
      currency: input.version?.currency ?? input.currency ?? source?.currency ?? lead.currency,
      pricingMode: input.version?.pricingMode ?? source?.pricingMode ?? 'PER_PERSON',
      pricingHeading: input.version?.pricingHeading ?? source?.pricingHeading ?? 'Price Breakdown',
      pricingSubheading: input.version?.pricingSubheading ?? source?.pricingSubheading ?? null,
      pricingDisplayOrder:
        input.version?.pricingDisplayOrder ?? source?.pricingDisplayOrder ?? undefined,
      pricingRowOrder: input.version?.pricingRowOrder ?? source?.pricingRowOrder ?? undefined,
      markupMode: input.version?.markupMode ?? source?.markupMode ?? 'NONE',
      markupValue: input.version?.markupValue ?? source?.markupValue ?? 0,
      taxRate: input.version?.taxRate ?? source?.taxRate ?? 0,
      discountAmount: input.version?.discountAmount ?? source?.discountAmount ?? 0,
      notes: input.version?.notes ?? source?.notes ?? null,
      internalNotes: input.version?.internalNotes ?? source?.internalNotes ?? null,
      itinerary:
        input.version?.itinerary ??
        source?.itinerary ??
        lead.itinerary.map((row, index) => {
          // The lead itinerary stores the Master Destination in `country` and an
          // optional city in `destination` (Create Lead no longer collects a
          // city, so `destination` is blank on new leads). The quotation
          // itinerary requires a non-empty `title` and `destination`, so use the
          // city when present and otherwise fall back to the Master Destination
          // name — never emit an empty required value.
          const place = (row.destination ?? '').trim() || (row.country ?? '').trim();
          return {
            dayNumber: index + 1,
            date: row.arrivalDate,
            title: place,
            destination: place,
            description: row.notes ?? `${row.nights} night stay in ${place}.`,
            meals: null,
            overnightLocation: place,
            activities: null,
            transfers: null,
            notes: null,
            sequence: index + 1,
          };
        }),
      hotels: input.version?.hotels ?? source?.hotels ?? [],
      services:
        input.version?.services ??
        source?.services ??
        lead.services.map((row, index) => ({
          serviceType: row.serviceType,
          name: row.serviceType.replaceAll('_', ' ').toLowerCase(),
          description: null,
          dayNumber: null,
          city: null,
          quantity: 1,
          internalCost: 0,
          sellingPrice: 0,
          taxCategory: null,
          notes: null,
          images: [],
          pdfImageUrl: null,
          sequence: index + 1,
        })),
      inclusions: input.version?.inclusions ?? source?.inclusions ?? [],
      exclusions: input.version?.exclusions ?? source?.exclusions ?? [],
      terms: input.version?.terms ?? source?.terms ?? defaultTermRows,
      faqs: input.version?.faqs ?? source?.faqs ?? [],
      weblinkSectionOrder:
        input.version?.weblinkSectionOrder ?? source?.weblinkSectionOrder ?? null,
    };
    // The friendly weblink name is generated automatically from the associated
    // lead's name — never asked for in Quotation Settings. Candidates are tried
    // in the exact priority order; an advisory lock serializes concurrent
    // creations that target the same candidate so two can never pick the same
    // name, and the global unique index is the final guard. When all five
    // patterns are taken, no sixth pattern is generated: the name stays NULL so
    // the user can choose one manually.
    const created = await prisma.$transaction(async (tx) => {
      const quotationNumber = await nextCompanyNumber(tx, auth.companyId, 'quotation');
      let publicSlug: string | null = null;
      for (const candidate of friendlySlugCandidates(lead.customerName)) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate}))`;
        const claimed = await tx.quotation.findFirst({
          where: { publicSlug: candidate },
          select: { id: true },
        });
        if (!claimed) {
          publicSlug = candidate;
          break;
        }
      }
      // A public weblink is provisioned as part of quotation creation: the link
      // and the quotation are one workflow, so the Leads Weblink column never
      // needs a manual Create action. The token is stored raw (for URL
      // reconstruction) and hashed (for secure lookup) in the same write.
      const token = generateSecureToken(32);
      const quotation = await tx.quotation.create({
        data: {
          companyId: auth.companyId,
          customerId: lead.customerId,
          quotationNumber,
          queryId: lead.id,
          sourceTemplateId: input.templateId ?? null,
          createdById: auth.userId,
          customerName: input.customerName ?? lead.customerName,
          customerEmail: input.customerEmail || lead.email || null,
          customerPhone: input.customerPhone ?? lead.phone,
          destinationSummary: destination,
          travelStartDate: input.travelStartDate ?? lead.travelStartDate,
          travelEndDate: input.travelEndDate ?? lead.travelEndDate,
          adults: input.adults ?? lead.adults,
          childrenWithBed: input.childrenWithBed ?? lead.childrenWithBed,
          childrenWithoutBed: input.childrenWithoutBed ?? lead.childrenWithoutBed,
          infants: input.infants ?? lead.infants,
          rooms: input.rooms ?? lead.rooms,
          // Carry the Lead's child ages into the quotation: the PDF and the
          // Weblink both render from these columns, so the two outputs always
          // agree. Explicit input overrides the Lead snapshot.
          ...(() => {
            const leadRow = lead as typeof lead & Record<string, unknown>;
            const pick = (
              key:
                | 'childrenWithBedAges'
                | 'childrenWithoutBedAges'
                | 'infantAges'
                | 'adultNames'
                | 'childWithBedNames'
                | 'childWithoutBedNames'
                | 'infantNames',
            ) => {
              const value = input[key] ?? (leadRow[key] as unknown[] | null | undefined) ?? null;
              return Array.isArray(value) && value.length ? { [key]: value } : {};
            };
            return {
              ...pick('childrenWithBedAges'),
              ...pick('childrenWithoutBedAges'),
              ...pick('infantAges'),
              ...pick('adultNames'),
              ...pick('childWithBedNames'),
              ...pick('childWithoutBedNames'),
              ...pick('infantNames'),
            };
          })(),
          currency: input.currency ?? lead.currency,
          validUntil: input.validUntil ?? null,
          publicToken: token,
          publicTokenHash: hashToken(token),
          publicTokenExpiresAt: input.validUntil ?? null,
          publicSlug,
        },
      });
      const initial = await createVersion(tx, auth, quotation.id, version, 1, costing, quotation, {
        // Template/source-version rows were already linked by this tenant.
        // Only those server-loaded ids receive the hide/archive retention
        // exception; request-only overrides still require current visibility.
        hotels: source?.hotels,
        services: source ? masterRefServices(source) : undefined,
      });
      await tx.quotation.update({
        where: { id: quotation.id },
        data: { currentVersionId: initial.id, publicVersionId: initial.id },
      });
      if (input.templateId)
        await tx.quotationTemplate.update({
          where: { id: input.templateId },
          data: { usageCount: { increment: 1 } },
        });
      if (lead.leadStage === 'QUALIFIED')
        await tx.query.update({
          where: { id: lead.id },
          data: { leadStage: 'QUOTATION_REQUIRED', quotationRequired: true },
        });
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_CREATED', 'Quotation', quotation.id, context, {
          quotationNumber,
          queryId: lead.id,
          templateId: input.templateId ?? null,
        }),
      });
      await tx.activityLog.create({
        data: quotationAudit(
          auth,
          'QUOTATION_VERSION_CREATED',
          'Quotation',
          quotation.id,
          context,
          { versionId: initial.id, versionNumber: 1 },
        ),
      });
      if (lead.customerId) await recalculateCustomerMetrics(tx, auth.companyId, lead.customerId);
      return tx.quotation.findUniqueOrThrow({
        where: { id: quotation.id },
        include: quotationInclude,
      });
    });
    reminderProcessor.scheduleEvent(auth.companyId, ['QUOTATION_EXPIRY']);
    return presentQuotation(created, costing);
  },

  async update(auth: AuthContext, id: string, input: QuotationUpdate, context: RequestContext) {
    const existing = await getQuotation(auth, id);
    if (existing.status === 'ACCEPTED')
      throw new ConflictError('Accepted quotations cannot be changed.');
    const value = await prisma.quotation.update({
      where: { id },
      data: {
        ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
        ...(input.customerEmail !== undefined
          ? { customerEmail: input.customerEmail || null }
          : {}),
        ...(input.customerPhone !== undefined ? { customerPhone: input.customerPhone } : {}),
        ...(input.destinationSummary !== undefined
          ? { destinationSummary: input.destinationSummary }
          : {}),
        ...(input.travelStartDate !== undefined ? { travelStartDate: input.travelStartDate } : {}),
        ...(input.travelEndDate !== undefined ? { travelEndDate: input.travelEndDate } : {}),
        ...(input.adults !== undefined ? { adults: input.adults } : {}),
        ...(input.childrenWithBed !== undefined ? { childrenWithBed: input.childrenWithBed } : {}),
        ...(input.childrenWithoutBed !== undefined
          ? { childrenWithoutBed: input.childrenWithoutBed }
          : {}),
        ...(input.infants !== undefined ? { infants: input.infants } : {}),
        ...(input.childrenWithBedAges !== undefined
          ? { childrenWithBedAges: input.childrenWithBedAges }
          : {}),
        ...(input.childrenWithoutBedAges !== undefined
          ? { childrenWithoutBedAges: input.childrenWithoutBedAges }
          : {}),
        ...(input.infantAges !== undefined ? { infantAges: input.infantAges } : {}),
        ...(input.adultNames !== undefined ? { adultNames: input.adultNames } : {}),
        ...(input.childWithBedNames !== undefined
          ? { childWithBedNames: input.childWithBedNames }
          : {}),
        ...(input.childWithoutBedNames !== undefined
          ? { childWithoutBedNames: input.childWithoutBedNames }
          : {}),
        ...(input.infantNames !== undefined ? { infantNames: input.infantNames } : {}),
        ...(input.rooms !== undefined ? { rooms: input.rooms } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
      },
      include: quotationInclude,
    });
    await prisma.activityLog.create({
      data: quotationAudit(auth, 'QUOTATION_UPDATED', 'Quotation', id, context),
    });
    return presentQuotation(value, await hasCosting(auth));
  },

  async archive(auth: AuthContext, id: string, context: RequestContext) {
    const existing = await getQuotation(auth, id);
    if (existing.status === 'ACCEPTED')
      throw new ConflictError('Accepted quotations cannot be archived.');
    await prisma.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          status: 'ARCHIVED',
          publicTokenHash: null,
          publicTokenExpiresAt: null,
        },
      });
      if (existing.customerId)
        await recalculateCustomerMetrics(tx, auth.companyId, existing.customerId);
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_ARCHIVED', 'Quotation', id, context),
      });
    });
    return { id, archived: true };
  },

  async permanentDelete(auth: AuthContext, id: string, context: RequestContext) {
    // Idempotency: if already hard-deleted, return success
    const existing = await prisma.quotation.findFirst({
      where: { id, companyId: auth.companyId },
      include: { booking: { select: { id: true } } },
    });
    if (!existing) {
      return { id, deleted: true, alreadyDeleted: true };
    }
    // Prevent deletion if linked booking exists – data safety
    if (existing.booking) {
      throw new ConflictError('Cannot delete quotation with an associated booking.');
    }
    // Also block accepted quotations for safety, mirroring archive
    if (existing.status === 'ACCEPTED') {
      throw new ConflictError('Accepted quotations cannot be deleted.');
    }

    // Collect all S3 objectKeys for this quotation (exact ownership)
    const documents = await prisma.quotationDocument.findMany({
      where: { companyId: auth.companyId, quotationId: id },
      select: { objectKey: true, bucket: true },
    });
    const s3Keys = documents
      .map((doc) => doc.objectKey?.trim())
      .filter((key): key is string => Boolean(key))
      // Safety: only delete keys that are strictly under this quotation's prefix
      .filter((key) => key.startsWith(`companies/${auth.companyId}/quotations/${id}/`));

    // Attempt S3 deletions first – if any fail, abort and keep DB intact
    const s3Failures: string[] = [];
    for (const key of s3Keys) {
      try {
        await storageService.deleteObject(key);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          { key, reason: message, quotationId: id },
          'S3 delete failed during permanent quotation deletion',
        );
        s3Failures.push(key);
      }
    }
    if (s3Failures.length > 0) {
      throw new ValidationError(
        `Failed to delete ${s3Failures.length} associated file(s) from storage. Quotation not deleted. Please retry.`,
      );
    }

    // All S3 succeeded – proceed to hard-delete DB records in correct FK order
    const versionIds = (
      await prisma.quotationVersion.findMany({
        where: { companyId: auth.companyId, quotationId: id },
        select: { id: true },
      })
    ).map((v) => v.id);

    await prisma.$transaction(async (tx) => {
      // Child tables first
      if (versionIds.length > 0) {
        await tx.quotationVersionItineraryDay.deleteMany({
          where: { quotationVersionId: { in: versionIds } },
        });
        await tx.quotationVersionHotelOption.deleteMany({
          where: { quotationVersionId: { in: versionIds } },
        });
        await tx.quotationVersionService.deleteMany({
          where: { quotationVersionId: { in: versionIds } },
        });
        await tx.quotationVersionInclusion.deleteMany({
          where: { quotationVersionId: { in: versionIds } },
        });
        await tx.quotationVersionExclusion.deleteMany({
          where: { quotationVersionId: { in: versionIds } },
        });
        await tx.quotationVersionTerm.deleteMany({
          where: { quotationVersionId: { in: versionIds } },
        });
      }
      await tx.quotationWeblinkView.deleteMany({
        where: { companyId: auth.companyId, quotationId: id },
      });
      await tx.quotationEmailLog.deleteMany({
        where: { companyId: auth.companyId, quotationId: id },
      });
      await tx.quotationDocument.deleteMany({
        where: { companyId: auth.companyId, quotationId: id },
      });
      await tx.queryFollowUp.deleteMany({ where: { companyId: auth.companyId, quotationId: id } });
      await tx.quotationVersion.deleteMany({
        where: { companyId: auth.companyId, quotationId: id },
      });
      await tx.quotation.delete({ where: { id } });
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_DELETED', 'Quotation', id, context),
      });
    });

    // Post-transaction: ensure any remaining documents are hard-deleted (already done)
    // No further S3 work – all keys already removed

    return { id, deleted: true };
  },

  async versions(auth: AuthContext, id: string) {
    const quotation = await getQuotation(auth, id);
    const costing = await hasCosting(auth);
    return Promise.all(quotation.versions.map((version) => presentVersion(version, costing)));
  },

  async version(auth: AuthContext, id: string, versionId: string) {
    return presentVersion(await getVersion(auth, id, versionId), await hasCosting(auth));
  },

  async createRevision(
    auth: AuthContext,
    id: string,
    input: QuotationVersionInput | undefined,
    sourceVersionId: string | undefined,
    context: RequestContext,
  ) {
    const quotation = await getQuotation(auth, id);
    if (quotation.status === 'ACCEPTED')
      throw new ConflictError('Accepted quotations cannot be revised.');
    const source = sourceVersionId
      ? await getVersion(auth, id, sourceVersionId)
      : quotation.versions[0];
    if (!source && !input) throw new ValidationError('Version details are required.');
    const sourceInput = source ? fromVersion(source) : undefined;
    const body = input ?? sourceInput!;
    const number = Math.max(0, ...quotation.versions.map((version) => version.versionNumber)) + 1;
    const costing = await hasCosting(auth);
    const created = await prisma.$transaction(async (tx) => {
      const version = await createVersion(tx, auth, id, body, number, costing, quotation, {
        hotels: sourceInput?.hotels,
        services: sourceInput ? masterRefServices(sourceInput) : undefined,
      });
      await tx.quotation.update({
        where: { id },
        data: {
          currentVersionId: version.id,
          status: 'DRAFT',
          acceptedVersionId: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      });
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_VERSION_CREATED', 'Quotation', id, context, {
          versionId: version.id,
          versionNumber: number,
          sourceVersionId: source?.id ?? null,
        }),
      });
      return version;
    });
    return presentVersion(created, costing);
  },

  async updateVersion(
    auth: AuthContext,
    id: string,
    versionId: string,
    input: QuotationVersionUpdate,
    context: RequestContext,
  ) {
    const quotation = await getQuotation(auth, id);
    const existing = await getVersion(auth, id, versionId);
    if (existing.status !== 'DRAFT')
      throw new ConflictError('Finalized versions are immutable. Create a revision instead.');
    const costing = await hasCosting(auth);
    const existingInput = fromVersion(existing);
    const merged = { ...existingInput, ...input } as QuotationVersionInput;
    const access = await validateMasterRefs(auth, merged.hotels ?? [], masterRefServices(merged), {
      hotels: existingInput.hotels,
      services: masterRefServices(existingInput),
    });
    await validateDestinationExpertConfig(
      auth,
      merged.destinationExpertConfig as DestinationExpertConfig,
    );
    const hydrated = await hydrateQuotationImageSnapshots(
      prisma,
      access.imageOwnerCompanyIds,
      merged,
      existing,
    );
    const normalized = versionCreateData(hydrated, auth.companyId, costing, quotation);
    const result = await prisma.$transaction(async (tx) => {
      await tx.quotationVersion.update({ where: { id: versionId }, data: normalized.scalar });
      await Promise.all([
        tx.quotationVersionItineraryDay.deleteMany({
          where: { companyId: auth.companyId, quotationVersionId: versionId },
        }),
        tx.quotationVersionHotelOption.deleteMany({
          where: { companyId: auth.companyId, quotationVersionId: versionId },
        }),
        tx.quotationVersionService.deleteMany({
          where: { companyId: auth.companyId, quotationVersionId: versionId },
        }),
        tx.quotationVersionInclusion.deleteMany({
          where: { companyId: auth.companyId, quotationVersionId: versionId },
        }),
        tx.quotationVersionExclusion.deleteMany({
          where: { companyId: auth.companyId, quotationVersionId: versionId },
        }),
        tx.quotationVersionTerm.deleteMany({
          where: { companyId: auth.companyId, quotationVersionId: versionId },
        }),
      ]);
      if (normalized.itinerary.length)
        await tx.quotationVersionItineraryDay.createMany({
          data: normalized.itinerary.map((row) => ({
            ...row,
            quotationVersionId: versionId,
          })) as Prisma.QuotationVersionItineraryDayCreateManyInput[],
        });
      if (normalized.hotels.length)
        await tx.quotationVersionHotelOption.createMany({
          data: normalized.hotels.map((row) => ({
            ...row,
            quotationVersionId: versionId,
          })) as Prisma.QuotationVersionHotelOptionCreateManyInput[],
        });
      if (normalized.services.length)
        await tx.quotationVersionService.createMany({
          data: normalized.services.map((row) => ({
            ...row,
            quotationVersionId: versionId,
          })) as Prisma.QuotationVersionServiceCreateManyInput[],
        });
      if (normalized.inclusions.length)
        await tx.quotationVersionInclusion.createMany({
          data: normalized.inclusions.map((row) => ({ ...row, quotationVersionId: versionId })),
        });
      if (normalized.exclusions.length)
        await tx.quotationVersionExclusion.createMany({
          data: normalized.exclusions.map((row) => ({ ...row, quotationVersionId: versionId })),
        });
      if (normalized.terms.length)
        await tx.quotationVersionTerm.createMany({
          data: normalized.terms.map((row) => ({ ...row, quotationVersionId: versionId })),
        });
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_UPDATED', 'Quotation', id, context, { versionId }),
      });
      return tx.quotationVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: versionInclude,
      });
    });
    return presentVersion(result, costing);
  },

  /**
   * Update only the weblink display flags (Quick Navigation) for a version.
   * Cosmetic and content-safe, so — unlike a full version edit — it is allowed
   * on finalized versions too, and never touches child collections or pricing.
   */
  async updateWeblinkSettings(
    auth: AuthContext,
    id: string,
    versionId: string,
    input: QuotationWeblinkSettings,
    context: RequestContext,
  ) {
    await getQuotation(auth, id);
    await getVersion(auth, id, versionId);
    const costing = await hasCosting(auth);
    const result = await prisma.$transaction(async (tx) => {
      await tx.quotationVersion.update({
        where: { id: versionId },
        data: {
          ...(input.showQuickNav !== undefined ? { showQuickNav: input.showQuickNav } : {}),
          ...(input.quickNavSticky !== undefined ? { quickNavSticky: input.quickNavSticky } : {}),
        },
      });
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_UPDATED', 'Quotation', id, context, { versionId }),
      });
      return tx.quotationVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: versionInclude,
      });
    });
    return presentVersion(result, costing);
  },

  /**
   * Stylish PDF Page 1 image selections (cover-only). Reads the persisted
   * `stylishPdfPage1` JSON on the version; absent means all defaults.
   * Never touches Classic PDF / weblink / master data.
   */
  async getStylishPage1(auth: AuthContext, id: string, versionId: string) {
    const version = await getVersion(auth, id, versionId);
    return normalizeStylishPdfPage1(
      (version as unknown as { stylishPdfPage1?: unknown }).stylishPdfPage1,
    );
  },

  async approveStylishPage1Image(
    auth: AuthContext,
    id: string,
    versionId: string,
    slot: 'hero' | 'card-1' | 'card-2' | 'card-3',
    input: { fileName: string; mimeType: string; fileSize: number },
  ) {
    await getVersion(auth, id, versionId);
    const mime = input.mimeType.trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime))
      throw new ValidationError('The Page 1 image must be a JPEG, PNG, or WebP image.');
    const max = 5 * 1024 * 1024;
    if (input.fileSize > max || input.fileSize < 12)
      throw new ValidationError('The Page 1 image must be between 12 bytes and 5 MB.');
    const key = stylishPage1ImageObjectKey({
      companyId: auth.companyId,
      quotationId: id,
      versionId,
      slot,
      fileName: input.fileName,
    });
    const ttl = env.MASTER_MEDIA_PRESIGNED_URL_EXPIRY_SECONDS;
    return {
      uploadUrl: await storageService.createUploadUrl(key, mime, input.fileSize, ttl),
      objectKey: key,
      expiresInSeconds: ttl,
    };
  },

  async confirmStylishPage1Image(
    auth: AuthContext,
    id: string,
    versionId: string,
    slot: 'hero' | 'card-1' | 'card-2' | 'card-3',
    input: { objectKey: string; fileName: string; mimeType: string; fileSize: number },
    context: RequestContext,
  ) {
    const version = await getVersion(auth, id, versionId);
    const prefix = `companies/${auth.companyId}/quotations/${id}/versions/${versionId}/stylish-page1/`;
    if (!input.objectKey.startsWith(prefix))
      throw new ValidationError('This upload does not belong to this Page 1 slot.');
    const metadata = await storageService.headObject(input.objectKey);
    if (!metadata) throw new ValidationError('The uploaded Page 1 image could not be found.');
    if (
      metadata.size !== input.fileSize ||
      metadata.contentType !== input.mimeType.trim().toLowerCase()
    )
      throw new ValidationError('Uploaded image metadata does not match the approved file.');
    const current = normalizeStylishPdfPage1(
      (version as unknown as { stylishPdfPage1?: unknown }).stylishPdfPage1,
    ) ?? { hero: null, cards: [null, null, null] };
    const slotValue = {
      mode: 'CUSTOM' as const,
      objectKey: input.objectKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
    };
    const cardIndex = slot === 'hero' ? -1 : Number(slot.split('-')[1]) - 1;
    const next: StylishPdfPage1 =
      slot === 'hero'
        ? { hero: slotValue, cards: current?.cards ?? [null, null, null] }
        : {
            hero: current?.hero ?? null,
            cards: (current?.cards ?? [null, null, null]).map((card, index) =>
              index === cardIndex ? slotValue : (card ?? null),
            ),
          };
    const result = await prisma.$transaction(async (tx) => {
      await tx.quotationVersion.update({
        where: { id: versionId },
        data: { stylishPdfPage1: next as unknown as Prisma.InputJsonValue },
      });
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_UPDATED', 'Quotation', id, context, { versionId }),
      });
      return tx.quotationVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: versionInclude,
      });
    });
    try {
      const previous =
        slot === 'hero'
          ? (current?.hero as { objectKey?: string } | null)
          : ((current?.cards ?? [])[cardIndex] as { objectKey?: string } | null);
      if (previous?.objectKey && previous.objectKey !== input.objectKey)
        await storageService.deleteObject(previous.objectKey);
    } catch {
      // Best-effort cleanup of the replaced upload; never blocks the save.
    }
    return this.getStylishPage1(auth, id, result.id);
  },

  async resetStylishPage1Image(
    auth: AuthContext,
    id: string,
    versionId: string,
    slot: 'hero' | 'card-1' | 'card-2' | 'card-3',
    context: RequestContext,
  ) {
    const version = await getVersion(auth, id, versionId);
    const current = normalizeStylishPdfPage1(
      (version as unknown as { stylishPdfPage1?: unknown }).stylishPdfPage1,
    ) ?? { hero: null, cards: [null, null, null] };
    const cardIndex = slot === 'hero' ? -1 : Number(slot.split('-')[1]) - 1;
    const previous =
      slot === 'hero'
        ? (current?.hero as { objectKey?: string } | null)
        : ((current?.cards ?? [])[cardIndex] as { objectKey?: string } | null);
    const next: StylishPdfPage1 =
      slot === 'hero'
        ? { hero: { mode: 'DEFAULT' as const }, cards: current?.cards ?? [null, null, null] }
        : {
            hero: current?.hero ?? null,
            cards: (current?.cards ?? [null, null, null]).map((card, index) =>
              index === cardIndex ? { mode: 'DEFAULT' as const } : (card ?? null),
            ),
          };
    await prisma.$transaction([
      prisma.quotationVersion.update({
        where: { id: versionId },
        data: { stylishPdfPage1: next as unknown as Prisma.InputJsonValue },
      }),
      prisma.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_UPDATED', 'Quotation', id, context, { versionId }),
      }),
    ]);
    try {
      if (previous?.objectKey) await storageService.deleteObject(previous.objectKey);
    } catch {
      // Best-effort; never blocks the reset.
    }
    return this.getStylishPage1(auth, id, versionId);
  },

  /**
   * Set, change or clear the friendly weblink name (publicSlug). The slug is a
   * customer-facing alias for the existing public token: updating it never
   * touches publicToken/publicTokenHash, and it is globally unique across every
   * tenant because all slugs share `travelagencycrm.in/<slug>`.
   */
  async updateWeblinkName(
    auth: AuthContext,
    id: string,
    input: { publicSlug?: string | null },
    context: RequestContext,
  ) {
    await getQuotation(auth, id);

    const raw = (input.publicSlug ?? '').trim();
    // Blank clears the friendly name; the permanent token URL stays intact.
    if (!raw) {
      await prisma.$transaction([
        prisma.quotation.update({ where: { id }, data: { publicSlug: null } }),
        prisma.activityLog.create({
          data: quotationAudit(auth, 'QUOTATION_UPDATED', 'Quotation', id, context, {
            publicSlug: null,
          }),
        }),
      ]);
      return { publicSlug: null };
    }

    const slug = normalizePublicSlug(raw);
    if (!slug) throw new ValidationError('Enter a valid Weblink name.');
    if (slug.length > PUBLIC_SLUG_MAX_LENGTH)
      throw new ValidationError(
        `Weblink name must be at most ${PUBLIC_SLUG_MAX_LENGTH} characters.`,
      );
    if (isReservedPublicSlug(slug))
      throw new ValidationError('This Weblink Name is reserved. Choose another name.');

    // Global uniqueness (matches the DB unique index: soft-deleted rows still
    // hold their slug). `id: { not: id }` lets the same quotation keep its slug.
    const conflict = await prisma.quotation.findFirst({
      where: { publicSlug: slug, id: { not: id } },
      select: { id: true },
    });
    if (conflict)
      throw new ConflictError('This Weblink Name is already in use. Choose another name.');

    await prisma.$transaction([
      prisma.quotation.update({ where: { id }, data: { publicSlug: slug } }),
      prisma.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_UPDATED', 'Quotation', id, context, {
          publicSlug: slug,
        }),
      }),
    ]);
    return { publicSlug: slug };
  },

  async finalize(auth: AuthContext, id: string, versionId: string, context: RequestContext) {
    const quotation = await getQuotation(auth, id);
    const version = await getVersion(auth, id, versionId);
    if (quotation.status === 'ACCEPTED')
      throw new ConflictError('Accepted quotations are immutable.');
    if (version.status !== 'DRAFT') throw new ConflictError('This version is already finalized.');
    // Backend pricing gate: an incomplete quotation can never be finalized
    // into a silent ₹0 / wrong-total customer document. Errors block
    // finalization; warnings are surfaced in the builder only.
    const pricingIssues = validateQuotationPricing({
      version: fromVersion(version) as unknown as Parameters<
        typeof validateQuotationPricing
      >[0]['version'],
      quotation: {
        adults: quotation.adults,
        childrenWithBed: quotation.childrenWithBed,
        childrenWithoutBed: quotation.childrenWithoutBed,
        infants: quotation.infants,
      },
    }).filter((issue) => issue.severity === 'ERROR');
    if (pricingIssues.length > 0) {
      throw new ValidationError(
        `Quotation pricing is incomplete: ${pricingIssues.map((issue) => issue.message).join(' ')}`,
      );
    }
    const result = await prisma.$transaction(async (tx) => {
      await tx.quotationVersion.updateMany({
        where: { quotationId: id, companyId: auth.companyId, status: 'FINALIZED' },
        data: { status: 'SUPERSEDED' },
      });
      const finalized = await tx.quotationVersion.update({
        where: { id: versionId },
        data: { status: 'FINALIZED', finalizedAt: new Date() },
        include: versionInclude,
      });
      await tx.quotation.update({ where: { id }, data: { currentVersionId: versionId } });
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_VERSION_FINALIZED', 'Quotation', id, context, {
          versionId,
          versionNumber: version.versionNumber,
        }),
      });
      return finalized;
    });
    return presentVersion(result, await hasCosting(auth));
  },

  /**
   * Render the Weblink PDF for a version through a real browser pointed at
   * that quotation's own public weblink (`?pdf=weblink` static mode). The
   * token is reused when one exists, otherwise minted exactly like Copy
   * Weblink URL (same permissions, same activity log), so the PDF always
   * reflects the currently published public data.
   */
  async renderWeblinkPdfForVersion(
    auth: AuthContext,
    id: string,
    versionId: string,
    context: RequestContext,
  ): Promise<Buffer> {
    await this.createPublicLink(auth, id, versionId, null, context);
    const stored = await prisma.quotation.findUniqueOrThrow({
      where: { id },
      select: { publicToken: true },
    });
    if (!stored.publicToken)
      throw new ConflictError('A public weblink is required for Weblink PDF.');
    const baseUrl = env.WEB_URL.replace(/\/$/, '');
    try {
      return await renderWeblinkPdfFromUrl({
        url: buildWeblinkPdfUrl(baseUrl, stored.publicToken),
      });
    } catch (error) {
      // Stage-tagged reason only: URLs carry unguessable public tokens and
      // must never reach logs. IDs below are internal UUIDs, safe to log.
      logger.error(
        {
          style: 'WEBLINK',
          quotationId: id,
          versionId,
          reason: sanitizeWeblinkPdfError(error),
        },
        'Weblink PDF render failed; Classic/Stylish paths are unaffected',
      );
      throw error;
    }
  },

  async generatePdf(
    auth: AuthContext,
    id: string,
    versionId: string,
    context: RequestContext,
    force = false,
    options: QuotationPdfOptions = { style: 'CLASSIC', coverSource: 'DESTINATION' },
  ) {
    const quotation = await getQuotation(auth, id);
    const version = await getVersion(auth, id, versionId);
    // Classic/Stylish/legacy-Weblink files all start with the quotation
    // number; the customer-friendly Weblink name (`<slug>-quotation.pdf`)
    // never does, which is how the styles tell each other's cached files
    // apart now that Weblink no longer carries a `-weblink-` label.
    const styleFileNameFilter =
      options.style === 'STYLISH'
        ? { endsWith: '-stylish-quotation.pdf' }
        : options.style === 'WEBLINK'
          ? {
              endsWith: '-quotation.pdf',
              not: { startsWith: quotation.quotationNumber },
            }
          : {
              endsWith: '-quotation.pdf',
              not: { contains: '-stylish-' },
            };
    // The classic suffix also matches legacy `-weblink-quotation.pdf` files
    // and the new customer-friendly Weblink names, so the classic lookup
    // excludes the weblink label and requires the quotation-number prefix
    // (each style reuses only its own files).
    const fileNameCondition =
      options.style === 'CLASSIC'
        ? {
            AND: [
              { fileName: styleFileNameFilter },
              { fileName: { not: { contains: '-weblink-' } } },
              { fileName: { startsWith: quotation.quotationNumber } },
            ],
          }
        : { fileName: styleFileNameFilter };
    const existing = !force
      ? await prisma.quotationDocument.findFirst({
          where: {
            companyId: auth.companyId,
            quotationId: id,
            quotationVersionId: versionId,
            documentType: 'QUOTATION_PDF',
            ...fileNameCondition,
            status: 'AVAILABLE',
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    if (existing) {
      const stored = await storageService.headObject(existing.objectKey);
      if (stored) return { ...existing, bucket: undefined, objectKey: undefined, reused: true };
      await prisma.quotationDocument.update({
        where: { id: existing.id },
        data: { status: 'FAILED' },
      });
    }
    // Customer-facing branding (logo + colour + contact + footer data).
    const branding = await loadCompanyBranding(auth.companyId);
    const profile = await prisma.company.findUniqueOrThrow({
      where: { id: auth.companyId },
      select: { operatingSinceYear: true, tripsSold: true, tan: true },
    });
    const company = {
      name: branding.name,
      email: branding.email,
      phone: branding.phone,
      website: branding.website,
      address: branding.address,
      primaryColor: branding.primaryColor,
      operatingSinceYear: profile.operatingSinceYear,
      tripsSold: profile.tripsSold,
      tan: profile.tan,
      taxRegistrationNumber: branding.taxRegistrationNumber,
      logo: branding.logo,
    };
    // Page-1 consultant strip: prepared-by/creator → lead assignee → company.
    const consultant = await resolvePdfConsultant(auth.companyId, quotation, company);

    // Weblink PDF renders the live public weblink in a real browser, so it
    // needs no server-resolved presentations or image buffers — skip that
    // work entirely for this style.
    const isWeblinkPdf = options.style === 'WEBLINK';

    // Hotel catalogue presentation is optional and customer-safe. Keep it
    // aligned with the quotation stays so both PDF renderers can consume it
    // without exposing Master ids.
    let hotelPresentations: QuotationPdfInput['hotelPresentations'];
    if (!isWeblinkPdf)
      try {
        const ownerCompanyIds = await linkedMasterOwnerCompanyIds(auth.companyId);
        const presentationByOptionId = await resolveHotelPresentations(
          ownerCompanyIds,
          version.hotels.map((hotel) => ({ id: hotel.id, hotelId: hotel.hotelId })),
        );
        hotelPresentations = version.hotels.map((hotel) => {
          const presentation = presentationByOptionId[hotel.id];
          return presentation
            ? {
                starCategory: presentation.starCategory,
                starRating: presentation.starRating,
                address: presentation.address,
                reviewLink: presentation.reviewLink,
              }
            : null;
        });
      } catch {
        hotelPresentations = undefined;
      }

    // --- PDF image resolution: server-side buffers, never signed URLs ----------
    // (skipped for Weblink PDF — the browser loads the weblink's own images).
    let images: QuotationPdfInput['images'] | undefined;
    let pdfSightseeingDetails: unknown = version.sightseeingDetails;
    if (!isWeblinkPdf)
      try {
        const imageCache = new Map<string, Buffer | null>();
        const fetchImage = async (key: string | null | undefined): Promise<Buffer | null> => {
          if (!key) return null;
          const cached = imageCache.get(key);
          if (cached !== undefined) return cached;
          try {
            let buf = await storageService.getObject(key);
            // PDFKit cannot decode WebP; convert it to PNG so masters that upload
            // WebP (vehicles, hotels, cruises, ...) render in the PDF exactly as
            // they do in the public weblink. Non-WebP buffers pass through.
            if (buf) {
              const png = await webpToPng(buf);
              if (png) buf = png;
            }
            imageCache.set(key, buf);
            return buf;
          } catch {
            imageCache.set(key, null);
            return null;
          }
        };
        const externalImageCache = new Map<string, Buffer | null>();
        const fetchExternalImage = async (url: string | undefined): Promise<Buffer | null> => {
          if (!url) return null;
          const cached = externalImageCache.get(url);
          if (cached !== undefined) return cached;
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw new Error('Image response was not successful.');
            const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
            if (contentType && !contentType.startsWith('image/'))
              throw new Error('Snapshot URL did not return an image.');
            const raw = Buffer.from(await res.arrayBuffer());
            if (raw.length < 12) throw new Error('Snapshot image was empty.');
            const image = (await webpToPng(raw)) ?? raw;
            externalImageCache.set(url, image);
            return image;
          } catch {
            externalImageCache.set(url, null);
            return null;
          }
        };
        const snapshotImageBytes = async (
          image: StoredQuotationImage,
          allowLegacyExternal: boolean,
        ) =>
          image.objectKey
            ? fetchImage(image.objectKey)
            : allowLegacyExternal
              ? fetchExternalImage(image.url)
              : null;
        const selectedSnapshotBytes = async (
          raw: unknown,
          selected: string | null | undefined,
          allowLegacyExternal = false,
        ) => {
          const all = storedQuotationImages(raw);
          if (!all.length) return null;
          const preferred = resolvePdfSnapshotImage(raw, selected);
          const candidates = preferred
            ? [preferred, ...all.filter((image) => image !== preferred)]
            : all;
          for (const image of candidates) {
            const bytes = await snapshotImageBytes(image, allowLegacyExternal);
            if (bytes) return bytes;
            if (allowLegacyExternal && image.thumbnailUrl) {
              const thumbnail = await fetchExternalImage(image.thumbnailUrl);
              if (thumbnail) return thumbnail;
            }
          }
          return null;
        };

        // Destination hero image: first matching Destination master in the quote's
        // ordered itinerary data — the lead itinerary `country` is the Master
        // destination name (e.g. "Malaysia"), while `destination` is the city.
        let coverImage: Buffer | null = null;
        const destRecord = await findDestinationImageRecord(
          auth.companyId,
          quotation.destinationSummary,
          quotation.query?.itinerary,
        );
        if (destRecord) {
          coverImage = await fetchImage(destRecord.imageObjectKey);
        }
        // Every linked master id was validated when persisted. Limit legacy live
        // fallbacks to the tenant and the single System company; snapshots remain
        // authoritative for all newly written rows.
        const masterOwnerCompanyIds = await linkedMasterOwnerCompanyIds(auth.companyId);

        // Each hotel stay owns an ordered snapshot. New Master-backed snapshots
        // use immutable object keys; old bookmark snapshots keep their URLs. The
        // linked live Master is consulted only for legacy rows with no snapshot.
        const hotelDetailsRaw = version.hotelDetails as
          | {
              images?: unknown;
              pdfImageUrl?: string | null;
            }
          | null
          | undefined;
        const stayImagesFor = (h: (typeof version.hotels)[number]): unknown => {
          if (Array.isArray(h.images)) return h.images;
          // Legacy: a single-bookmark quotation stored its gallery on hotelDetails.
          // The section schema has historically defaulted to `images: []`, which
          // means "no bookmark gallery" rather than an authoritative removal.
          // Only a non-empty legacy section gallery may suppress the linked
          // Hotel Master's established PDF fallback.
          return Array.isArray(hotelDetailsRaw?.images) && hotelDetailsRaw.images.length > 0
            ? hotelDetailsRaw.images
            : undefined;
        };
        const legacyHotelIds = version.hotels
          .filter((hotel) => !Array.isArray(stayImagesFor(hotel)))
          .map((hotel) => hotel.hotelId)
          .filter((id): id is string => Boolean(id));
        const hotelImageMap = new Map<string, Buffer | null>();
        if (legacyHotelIds.length) {
          const hotelMasters = await prisma.hotel.findMany({
            where: {
              companyId: { in: masterOwnerCompanyIds },
              id: { in: [...new Set(legacyHotelIds)] },
              imageObjectKey: { not: null },
              imageConfirmedAt: { not: null },
            },
            select: { id: true, imageObjectKey: true },
          });
          for (const hotel of hotelMasters)
            hotelImageMap.set(hotel.id, await fetchImage(hotel.imageObjectKey));
        }
        const hotelImages = await Promise.all(
          version.hotels.map(async (hotel) => {
            const snapshot = stayImagesFor(hotel);
            if (Array.isArray(snapshot))
              return selectedSnapshotBytes(
                snapshot,
                hotel.pdfImageUrl ?? hotelDetailsRaw?.pdfImageUrl,
                // Hotel bookmark URLs were already fetched by the legacy PDF
                // path. New Master galleries always use quotation-owned keys.
                true,
              );
            return hotel.hotelId ? (hotelImageMap.get(hotel.hotelId) ?? null) : null;
          }),
        );

        // Sightseeing activity images. Gallery snapshots are resolved per
        // activity (not per Master id), so two rows linked to the same Master can
        // independently reorder/remove/select their PDF image. A synthetic
        // snapshot key feeds the existing renderer without persisting anything.
        const sightseeingIds: string[] = [];
        const itineraryDocumentIds: string[] = [];
        const itineraryImageMap = new Map<string, Buffer>();
        const ssData = version.sightseeingDetails as Record<string, unknown> | null;
        if (ssData?.days && Array.isArray(ssData.days)) {
          const pdfDays: Array<Record<string, unknown>> = [];
          for (const [dayIndex, day] of (ssData.days as Array<Record<string, unknown>>).entries()) {
            const acts = Array.isArray(day.activities)
              ? (day.activities as Array<Record<string, unknown>>)
              : [];
            const pdfActivities: Array<Record<string, unknown>> = [];
            for (const [activityIndex, act] of acts.entries()) {
              const galleryPresent =
                typeof act.imageSnapshotPresent === 'boolean'
                  ? act.imageSnapshotPresent
                  : Array.isArray(act.images);
              if (galleryPresent) {
                const key = `quotation-gallery:${dayIndex + 1}:${activityIndex + 1}`;
                const selected = await selectedSnapshotBytes(
                  Array.isArray(act.images) ? act.images : [],
                  textValue(act.pdfImageUrl),
                );
                if (selected) itineraryImageMap.set(key, selected);
                // A gallery is authoritative even if its selected object is
                // missing. Null the live Master/document fallbacks in this
                // renderer-only copy so an old Master edit cannot leak through.
                pdfActivities.push({
                  ...act,
                  imageUrl: key,
                  imageDocumentId: null,
                  sightseeingId: null,
                });
                continue;
              }
              const sid = act.sightseeingId;
              if (sid && typeof sid === 'string') sightseeingIds.push(sid);
              const documentId = act.imageDocumentId;
              if (documentId && typeof documentId === 'string')
                itineraryDocumentIds.push(documentId);
              const snapshotUrl = typeof act.imageUrl === 'string' ? act.imageUrl.trim() : '';
              if (snapshotUrl) {
                const snapshot = await fetchExternalImage(snapshotUrl);
                if (snapshot) itineraryImageMap.set(snapshotUrl, snapshot);
              }
              pdfActivities.push(act);
            }
            pdfDays.push({ ...day, activities: pdfActivities });
          }
          pdfSightseeingDetails = { ...ssData, days: pdfDays };
        }
        const sightseeingImageMap = new Map<string, Buffer | null>();
        if (sightseeingIds.length) {
          const uniqueIds = [...new Set(sightseeingIds)];
          const ssMasters = await prisma.sightseeing.findMany({
            where: {
              companyId: { in: masterOwnerCompanyIds },
              id: { in: uniqueIds },
              imageObjectKey: { not: null },
              imageConfirmedAt: { not: null },
            },
            select: { id: true, imageObjectKey: true },
          });
          for (const s of ssMasters) {
            sightseeingImageMap.set(s.id, await fetchImage(s.imageObjectKey));
          }
        }
        const sightseeingImages = Object.fromEntries(sightseeingImageMap);
        const itineraryImages = Object.fromEntries(itineraryImageMap);
        const itineraryDocumentMap = new Map<string, Buffer>();
        const imageDocumentsById = new Map(
          quotation.documents
            .filter(
              (document) =>
                document.status === 'AVAILABLE' &&
                document.deletedAt === null &&
                document.mimeType.startsWith('image/'),
            )
            .map((document) => [document.id, document]),
        );
        await Promise.all(
          [...new Set(itineraryDocumentIds)].map(async (documentId) => {
            const document = imageDocumentsById.get(documentId);
            if (!document) return;
            const image = await fetchImage(document.objectKey);
            if (image) itineraryDocumentMap.set(documentId, image);
          }),
        );
        const itineraryDocumentImages = Object.fromEntries(itineraryDocumentMap);

        // Vehicle/Cruise images: quotation snapshot first; the linked Master is
        // a compatibility fallback only for pre-feature rows with no snapshot.
        const serviceImageMap = new Map<string, Buffer | null>();
        const vehicleIds = version.services
          .filter((service) => service.vehicleId && !Array.isArray(service.images))
          .map((s) => s.vehicleId as string);
        const cruiseIds = version.services
          .filter((service) => service.cruiseId && !Array.isArray(service.images))
          .map((s) => s.cruiseId as string);
        if (vehicleIds.length) {
          const uniqueIds = [...new Set(vehicleIds)];
          const vehicleMasters = await prisma.vehicle.findMany({
            where: {
              companyId: { in: masterOwnerCompanyIds },
              id: { in: uniqueIds },
              imageObjectKey: { not: null },
              imageConfirmedAt: { not: null },
            },
            select: { id: true, imageObjectKey: true },
          });
          for (const v of vehicleMasters) {
            serviceImageMap.set(v.id, await fetchImage(v.imageObjectKey));
          }
        }
        if (cruiseIds.length) {
          const uniqueIds = [...new Set(cruiseIds)];
          const cruiseMasters = await prisma.cruise.findMany({
            where: {
              companyId: { in: masterOwnerCompanyIds },
              id: { in: uniqueIds },
              imageObjectKey: { not: null },
              imageConfirmedAt: { not: null },
            },
            select: { id: true, imageObjectKey: true },
          });
          for (const c of cruiseMasters) {
            serviceImageMap.set(c.id, await fetchImage(c.imageObjectKey));
          }
        }
        const serviceImages = await Promise.all(
          version.services.map(async (service) => {
            if (Array.isArray(service.images))
              return selectedSnapshotBytes(service.images, service.pdfImageUrl);
            const masterId = service.vehicleId ?? service.cruiseId ?? null;
            return masterId ? (serviceImageMap.get(masterId) ?? null) : null;
          }),
        );

        // Airline logos: resolve from the flight segment airline IDs (stored on
        // the quotation-version flight snapshot across every flight record),
        // fetched via the shared cache.
        const airlineImageMap = new Map<string, Buffer | null>();
        const fd = normalizeFlightDetails(version.flightDetails) as {
          include?: boolean;
          entryMode?: 'MANUAL' | 'IMAGE';
          imageDocumentId?: string | null;
          images?: Array<{
            documentId: string;
            description?: string | null;
            heading?: string | null;
          }>;
          flights?: Array<{
            outbound?: { segments?: Array<{ airlineId?: string | null }> };
            returnJourney?: { segments?: Array<{ airlineId?: string | null }> };
          }>;
        } | null;
        const airlineIds = (fd?.flights ?? [])
          .flatMap((flight) => [
            ...(flight.outbound?.segments ?? []),
            ...(flight.returnJourney?.segments ?? []),
          ])
          .map((s) => s.airlineId)
          .filter((id): id is string => Boolean(id));
        const uniqueAirlineIds = [...new Set(airlineIds)];
        if (uniqueAirlineIds.length) {
          const airlineMasters = await prisma.airline.findMany({
            where: {
              companyId: { in: masterOwnerCompanyIds },
              id: { in: uniqueAirlineIds },
              logoObjectKey: { not: null },
              logoConfirmedAt: { not: null },
            },
            select: { id: true, logoObjectKey: true },
          });
          for (const a of airlineMasters) {
            airlineImageMap.set(a.id, await fetchImage(a.logoObjectKey));
          }
        }
        const airlineImages = Object.fromEntries(airlineImageMap);
        let flightImage: Buffer | null = null;
        const flightImages: Array<{ description?: string | null; image: Buffer; url?: string }> =
          [];
        if (fd?.entryMode === 'IMAGE') {
          const configuredImages = fd.images?.length
            ? fd.images
            : fd.imageDocumentId
              ? [{ documentId: fd.imageDocumentId, description: null, heading: null }]
              : [];
          const flightDocuments = configuredImages.length
            ? await prisma.quotationDocument.findMany({
                where: {
                  id: { in: configuredImages.map((image) => image.documentId) },
                  companyId: auth.companyId,
                  quotationId: id,
                  // Revisions intentionally retain the original flight-image document
                  // IDs. The explicit document IDs plus company/quotation ownership
                  // are the security boundary; requiring the document's original
                  // version ID would make copied flight images disappear from PDFs.
                  status: 'AVAILABLE',
                  deletedAt: null,
                  mimeType: { startsWith: 'image/' },
                },
                select: { id: true, objectKey: true, fileName: true },
              })
            : [];
          const documentsById = new Map(flightDocuments.map((document) => [document.id, document]));
          for (const configuredImage of configuredImages) {
            const document = documentsById.get(configuredImage.documentId);
            const image = await fetchImage(document?.objectKey);
            if (image) {
              const url = document
                ? await storageService
                    .createDownloadUrl(document.objectKey, document.fileName, 604800, 'inline')
                    .catch(() => undefined)
                : undefined;
              flightImages.push({
                description: configuredImage.description ?? configuredImage.heading ?? null,
                image,
                ...(url ? { url } : {}),
              });
            }
          }
          flightImage = flightImages[0]?.image ?? null;
        }

        images = {
          cover: coverImage,
          hotels: hotelImages,
          services: serviceImages,
          sightseeing: sightseeingImages,
          itinerary: itineraryImages,
          itineraryDocuments: itineraryDocumentImages,
          airlines: airlineImages,
          flight: flightImage,
          flights: flightImages,
        };
      } catch {
        // Image resolution is best-effort; never block PDF generation.
        images = undefined;
      }

    if (options.style === 'STYLISH' && options.coverSource === 'UPLOAD') {
      const uploadedCover = await decodePdfCoverImage(options.coverImageDataUrl);
      images = { ...(images ?? {}), cover: uploadedCover };
    }

    if (options.style === 'STYLISH') {
      if (options.page1HeroImageDataUrl) {
        const hero = await decodePdfCoverImage(options.page1HeroImageDataUrl);
        images = { ...(images ?? {}), page1Hero: hero };
      }
      const cardUrls = (options.page1CardImageDataUrls ?? []).slice(0, 3);
      if (cardUrls.some(Boolean)) {
        const cards: Array<Buffer | null> = [];
        for (const dataUrl of cardUrls) {
          cards.push(dataUrl ? await decodePdfCoverImage(dataUrl) : null);
        }
        images = { ...(images ?? {}), page1Cards: cards };
      }
      // Persisted Page 1 selections fill slots the request did not override.
      const persistedPage1 = normalizeStylishPdfPage1(
        (version as unknown as { stylishPdfPage1?: unknown }).stylishPdfPage1,
      );
      const fetchPage1Bytes = async (key: string): Promise<Buffer | null> => {
        try {
          const body = await storageService.getObject(key);
          if (!body) return null;
          return (await webpToPng(body)) ?? body;
        } catch {
          return null;
        }
      };
      if (
        !images?.page1Hero &&
        persistedPage1?.hero?.mode === 'CUSTOM' &&
        persistedPage1.hero.objectKey
      ) {
        const bytes = await fetchPage1Bytes(persistedPage1.hero.objectKey);
        if (bytes) images = { ...(images ?? {}), page1Hero: bytes };
      }
      const persistedCards = persistedPage1?.cards ?? [];
      if (persistedCards.some((card) => card?.mode === 'CUSTOM' && card.objectKey)) {
        const current = [...((images?.page1Cards ?? []) as Array<Buffer | null | undefined>)];
        while (current.length < 3) current.push(undefined);
        for (let slot = 0; slot < 3; slot += 1) {
          const saved = persistedCards[slot];
          if (!current[slot] && saved?.mode === 'CUSTOM' && saved.objectKey) {
            const bytes = await fetchPage1Bytes(saved.objectKey);
            if (bytes) current[slot] = bytes;
          }
        }
        if (current.some(Boolean)) images = { ...(images ?? {}), page1Cards: current };
      }
    }

    const renderer = options.style === 'STYLISH' ? renderStylishQuotationPdf : renderQuotationPdf;

    // Destination Expert — same resolved data the weblink uses, plus the
    // profile image bytes for the PDF (the weblink gets a signed URL instead).
    // Skipped for Weblink PDF — the browser loads the weblink's own images.
    let destinationExpert: QuotationPdfInput['destinationExpert'] = null;
    if (!isWeblinkPdf) {
      const expert = await resolveDestinationExpertPresentation(
        auth.companyId,
        normalizeDestinationExpertConfig(
          (version as unknown as { destinationExpertConfig?: unknown }).destinationExpertConfig,
        ),
      );
      if (expert) {
        destinationExpert = {
          fullName: expert.fullName,
          heading: expert.config.heading ?? null,
          customIntroduction: expert.config.customIntroduction ?? null,
          whatsappNumber: expert.whatsappNumber,
          callNumber: expert.phone,
          email: expert.email,
          jobTitle: expert.jobTitle,
          bio: expert.bio,
          specialization: expert.specialization,
          showWhatsapp: expert.config.showWhatsapp,
          showCall: expert.config.showCall,
          showEmail: expert.config.showEmail,
        };
        if (
          (expert as { profileImageObjectKey?: string | null }).profileImageObjectKey &&
          (expert as { profileImageConfirmedAt?: Date | null }).profileImageConfirmedAt
        ) {
          try {
            const profile = await storageService.getObject(
              (expert as { profileImageObjectKey: string }).profileImageObjectKey,
            );
            if (profile) {
              if (!images) images = {};
              images.expertProfile = profile;
            }
          } catch {
            // A missing profile photo never blocks the PDF.
          }
        }
        // Fallback to the gender-based default avatar (same as the weblink)
        // when no custom photo was resolved. This keeps both PDF styles in
        // sync with the public page without inventing a generic placeholder.
        if (!images?.expertProfile) {
          const fallbackKind = (expert as { avatarKind?: string | null }).avatarKind;
          if (fallbackKind === 'male' || fallbackKind === 'female') {
            const fallback = loadDefaultExpertAvatar(fallbackKind);
            if (fallback) {
              if (!images) images = {};
              (images as NonNullable<typeof images>).expertProfile = fallback;
            }
          }
        }
      }
    }

    const pdfInput: QuotationPdfInput = {
      company,
      consultant,
      quotation: {
        ...quotation,
        durationNights: resolveItineraryNights(quotation.query?.itinerary),
        destinations: resolveDestinationNames(
          quotation.query?.itinerary,
          quotation.destinationSummary,
        ).join(' → '),
      },
      // Prisma represents JSON columns as a generic JsonValue. The PDF input
      // narrows the two structured JSON snapshots after they have already been
      // validated by the quotation write path.
      version: {
        ...version,
        sightseeingDetails: pdfSightseeingDetails,
      } as unknown as QuotationPdfInput['version'],
      ...(hotelPresentations ? { hotelPresentations } : {}),
      ...(images ? { images } : {}),
      ...(destinationExpert ? { destinationExpert } : {}),
    };
    // Weblink PDF renders the live public weblink in a real browser — same
    // published data and components, never a reconstructed layout.
    const pdf = isWeblinkPdf
      ? await this.renderWeblinkPdfForVersion(auth, id, versionId, context)
      : await renderer(pdfInput);
    const checksum = createHash('sha256').update(pdf).digest('hex');
    const documentId = randomUUID();
    // Meaningful filename: <number>-<customer>-v<version>[-stylish]-quotation.pdf.
    // Weblink alone uses the customer-friendly `<customer>-quotation.pdf`.
    const customerSlug = quotation.customerName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const fileName = sanitizeFileName(
      options.style === 'WEBLINK'
        ? weblinkPdfFileName(quotation.customerName)
        : `${quotation.quotationNumber}-${customerSlug ? `${customerSlug}-` : ''}v${version.versionNumber}${options.style === 'STYLISH' ? '-stylish' : ''}-quotation.pdf`,
    );
    const objectKey = quotationObjectKey({
      companyId: auth.companyId,
      quotationId: id,
      versionId,
      documentId,
      fileName,
    });
    await storageService.putObject({
      key: objectKey,
      body: pdf,
      contentType: 'application/pdf',
      checksum,
    });
    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.quotationDocument.create({
        data: {
          id: documentId,
          companyId: auth.companyId,
          quotationId: id,
          quotationVersionId: versionId,
          storageProvider: storageService.provider,
          bucket: storageService.bucket,
          objectKey,
          fileName,
          mimeType: 'application/pdf',
          fileSize: pdf.length,
          checksum,
          documentType: 'QUOTATION_PDF',
          status: 'AVAILABLE',
          generatedById: auth.userId,
        },
      });
      await tx.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_PDF_GENERATED', 'Quotation', id, context, {
          versionId,
          documentId,
          style: options.style,
        }),
      });
      return created;
    });
    return { ...document, bucket: undefined, objectKey: undefined, reused: false };
  },

  async documents(auth: AuthContext, id: string) {
    await getQuotation(auth, id);
    return prisma.quotationDocument.findMany({
      where: { companyId: auth.companyId, quotationId: id, deletedAt: null },
      select: {
        id: true,
        quotationVersionId: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        checksum: true,
        documentType: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async downloadUrl(
    auth: AuthContext,
    id: string,
    documentId: string,
    disposition: 'attachment' | 'inline' = 'attachment',
  ) {
    await getQuotation(auth, id);
    const document = await prisma.quotationDocument.findFirst({
      where: {
        id: documentId,
        quotationId: id,
        companyId: auth.companyId,
        status: 'AVAILABLE',
        deletedAt: null,
      },
    });
    if (!document) throw new NotFoundError('Document not found.');
    return {
      url: await storageService.createDownloadUrl(
        document.objectKey,
        document.fileName,
        undefined,
        disposition,
      ),
      expiresInSeconds: env.AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS,
    };
  },

  /** Aggregated weblink view analytics for one quotation (tenant-scoped). */
  async weblinkAnalytics(auth: AuthContext, id: string): Promise<WeblinkAnalytics> {
    await getQuotation(auth, id);
    const [rows, totals] = await Promise.all([
      prisma.quotationWeblinkView.findMany({
        where: { companyId: auth.companyId, quotationId: id },
        orderBy: [{ lastViewedAt: 'desc' }, { ipAddress: 'asc' }],
        take: WEBLINK_ANALYTICS_ROW_LIMIT,
        omit: { id: true, companyId: true, quotationId: true },
      }),
      prisma.quotationWeblinkView.aggregate({
        where: { companyId: auth.companyId, quotationId: id },
        _sum: { viewCount: true },
        _count: { _all: true },
      }),
    ]);
    const byType = await prisma.quotationWeblinkView.groupBy({
      by: ['type'],
      where: { companyId: auth.companyId, quotationId: id },
      _sum: { viewCount: true },
    });
    const sumFor = (type: 'HOME' | 'EXTERNAL') =>
      byType.find((row) => row.type === type)?._sum.viewCount ?? 0;
    return {
      totalViews: totals._sum.viewCount ?? 0,
      externalViews: sumFor('EXTERNAL'),
      homeIpViews: sumFor('HOME'),
      uniqueIps: totals._count._all,
      entries: rows.map((row) => {
        const { type, viewCount, firstViewedAt, lastViewedAt, ...rest } = row;
        return {
          ...rest,
          type: type === 'HOME' ? ('HOME' as const) : ('EXTERNAL' as const),
          views: viewCount,
          firstViewedAt: firstViewedAt.toISOString(),
          lastViewedAt: lastViewedAt.toISOString(),
        };
      }),
    };
  },

  async requestUpload(
    auth: AuthContext,
    id: string,
    input: {
      quotationVersionId?: string | null;
      fileName: string;
      mimeType: string;
      fileSize: number;
      documentType: 'SUPPORTING_ATTACHMENT' | 'HOTEL_IMAGE' | 'ITINERARY_IMAGE';
    },
  ) {
    await getQuotation(auth, id);
    if (input.fileSize > env.MAX_UPLOAD_SIZE_MB * 1024 * 1024)
      throw new ValidationError(`Files may not exceed ${env.MAX_UPLOAD_SIZE_MB} MB.`);
    const extension = input.fileName.toLowerCase().split('.').pop();
    const allowedExtensions: Record<string, readonly string[]> = {
      'application/pdf': ['pdf'],
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
    };
    if (!extension || !allowedExtensions[input.mimeType]?.includes(extension))
      throw new ValidationError('The file extension does not match the approved MIME type.');
    const existingAttachments = await prisma.quotationDocument.count({
      where: {
        companyId: auth.companyId,
        quotationId: id,
        documentType: { not: 'QUOTATION_PDF' },
        deletedAt: null,
      },
    });
    if (existingAttachments >= 20)
      throw new ValidationError('A quotation may contain at most 20 attachments.');
    if (input.quotationVersionId) await getVersion(auth, id, input.quotationVersionId);
    const documentId = randomUUID();
    const fileName = sanitizeFileName(input.fileName);
    const versionId = input.quotationVersionId ?? null;
    const objectKey = quotationObjectKey({
      companyId: auth.companyId,
      quotationId: id,
      versionId,
      documentId,
      fileName,
      attachment: true,
    });
    const document = await prisma.quotationDocument.create({
      data: {
        id: documentId,
        companyId: auth.companyId,
        quotationId: id,
        quotationVersionId: versionId,
        storageProvider: storageService.provider,
        bucket: storageService.bucket,
        objectKey,
        fileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        documentType: input.documentType,
        status: 'PENDING',
        generatedById: auth.userId,
      },
    });
    return {
      documentId: document.id,
      uploadUrl: await storageService.createUploadUrl(objectKey, input.mimeType, input.fileSize),
      expiresInSeconds: env.AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS,
      requiredHeaders: {
        'Content-Type': input.mimeType,
      },
    };
  },

  async confirmUpload(auth: AuthContext, id: string, documentId: string, context: RequestContext) {
    await getQuotation(auth, id);
    const document = await prisma.quotationDocument.findFirst({
      where: {
        id: documentId,
        quotationId: id,
        companyId: auth.companyId,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (!document) throw new NotFoundError('Pending document not found.');
    const head = await storageService.headObject(document.objectKey);
    if (
      !head ||
      head.size !== document.fileSize ||
      (head.contentType && head.contentType !== document.mimeType)
    )
      throw new ValidationError('The uploaded object does not match the approved file metadata.');
    const updated = await prisma.quotationDocument.update({
      where: { id: documentId },
      data: { status: 'AVAILABLE', checksum: head.checksum ?? null },
    });
    await prisma.activityLog.create({
      data: quotationAudit(
        auth,
        'QUOTATION_DOCUMENT_UPLOADED',
        'QuotationDocument',
        documentId,
        context,
        { quotationId: id },
      ),
    });
    return { id: updated.id, status: updated.status, fileName: updated.fileName };
  },

  async deleteDocument(auth: AuthContext, id: string, documentId: string, context: RequestContext) {
    await getQuotation(auth, id);
    const document = await prisma.quotationDocument.findFirst({
      where: { id: documentId, quotationId: id, companyId: auth.companyId, deletedAt: null },
    });
    if (!document) throw new NotFoundError('Document not found.');
    await storageService.deleteObject(document.objectKey);
    await prisma.$transaction([
      prisma.quotationDocument.update({
        where: { id: documentId },
        data: { deletedAt: new Date() },
      }),
      prisma.activityLog.create({
        data: quotationAudit(
          auth,
          'QUOTATION_DOCUMENT_DELETED',
          'QuotationDocument',
          documentId,
          context,
          { quotationId: id },
        ),
      }),
    ]);
    return { id: documentId, deleted: true };
  },

  async createPublicLink(
    auth: AuthContext,
    id: string,
    versionId: string | undefined,
    expiresAt: Date | null | undefined,
    context: RequestContext,
    options: { staffView?: boolean } = {},
  ) {
    const quotation = await getQuotation(auth, id);
    const selected = versionId
      ? await getVersion(auth, id, versionId)
      : (quotation.versions.find((version) => version.id === quotation.currentVersionId) ??
        quotation.versions[0]);
    if (!selected) throw new ConflictError('Quotation version not found.');
    // A short-lived, company+quotation-bound staff-view signal, minted only when
    // the caller explicitly asks for it (the CRM "Open/Preview Weblink" action).
    // The ordinary `url` — what is copied/shared with customers — is never
    // altered by it.
    const buildStaffViewUrl = (url: string): string | null =>
      options.staffView
        ? withStaffViewToken(
            url,
            mintStaffViewToken({ userId: auth.userId, companyId: auth.companyId, quotationId: id }),
          )
        : null;
    // A normal Open Weblink (no explicit versionId) always targets the CURRENT
    // (latest) version. Keep publicVersionId in sync so the shared token serves
    // the latest customer-facing content, even when a token already exists.
    const isExplicitHistorical = Boolean(versionId);
    if (quotation.publicToken) {
      // Self-heal a stale token hash (e.g. minted before a TOKEN_PEPPER
      // rotation, which invalidates every existing hash): the stored plaintext
      // token and its URL stay exactly the same, so no link changes and no
      // access rule changes — but the hash must match the current pepper or
      // every public lookup for this quotation 404s as invalid/expired.
      const repairedHash = hashToken(quotation.publicToken);
      const repair: Record<string, unknown> = {};
      if (quotation.publicTokenHash !== repairedHash) repair.publicTokenHash = repairedHash;
      if (!isExplicitHistorical && quotation.publicVersionId !== selected.id) {
        repair.publicVersionId = selected.id;
      }
      if (Object.keys(repair).length > 0) {
        await prisma.quotation.update({ where: { id }, data: repair });
      }
      const url = quotation.publicSlug
        ? `${await friendlyPublicSlugBaseUrl(auth.companyId)}/${quotation.publicSlug}`
        : `${await preferredPublicAppBaseUrl(auth.companyId)}/q/${quotation.publicToken}`;
      const staffViewUrl = buildStaffViewUrl(url);
      return {
        url,
        ...(staffViewUrl ? { staffViewUrl } : {}),
        expiresAt: quotation.publicTokenExpiresAt,
        versionId: quotation.publicVersionId ?? selected.id,
        reused: true,
      };
    }
    const token = generateSecureToken(32);
    await prisma.$transaction([
      prisma.quotation.update({
        where: { id },
        data: {
          publicToken: token,
          publicTokenHash: hashToken(token),
          publicTokenExpiresAt: expiresAt ?? quotation.validUntil,
          publicVersionId: selected.id,
        },
      }),
      prisma.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_PUBLIC_LINK_CREATED', 'Quotation', id, context, {
          versionId: selected.id,
          expiresAt: expiresAt?.toISOString() ?? null,
        }),
      }),
    ]);
    const url = quotation.publicSlug
      ? `${await friendlyPublicSlugBaseUrl(auth.companyId)}/${quotation.publicSlug}`
      : `${await preferredPublicAppBaseUrl(auth.companyId)}/q/${token}`;
    const staffViewUrl = buildStaffViewUrl(url);
    return {
      url,
      ...(staffViewUrl ? { staffViewUrl } : {}),
      expiresAt: expiresAt ?? quotation.validUntil,
      versionId: selected.id,
      reused: false,
    };
  },

  async revokePublicLink(auth: AuthContext, id: string, context: RequestContext) {
    await getQuotation(auth, id);
    await prisma.$transaction([
      prisma.quotation.update({
        where: { id },
        data: {
          publicToken: null,
          publicTokenHash: null,
          publicTokenExpiresAt: null,
          publicVersionId: null,
          publicSlug: null,
        },
      }),
      prisma.activityLog.create({
        data: quotationAudit(auth, 'QUOTATION_PUBLIC_LINK_REVOKED', 'Quotation', id, context),
      }),
    ]);
    return { revoked: true };
  },

  async send(auth: AuthContext, id: string, input: QuotationSendInput, context: RequestContext) {
    const quotation = await getQuotation(auth, id);
    const version = await getVersion(auth, id, input.quotationVersionId);
    if (version.status !== 'FINALIZED')
      throw new ConflictError('Only the current finalized version can be sent.');
    let publicLink: { url: string } | undefined;
    if (input.includePublicLink)
      publicLink = await this.createPublicLink(auth, id, version.id, quotation.validUntil, context);
    if (input.includePdf) await this.generatePdf(auth, id, version.id, context);
    const pdfDocument = input.includePdf
      ? await prisma.quotationDocument.findFirst({
          where: {
            companyId: auth.companyId,
            quotationId: id,
            quotationVersionId: version.id,
            documentType: 'QUOTATION_PDF',
            status: 'AVAILABLE',
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const pdfUrl = pdfDocument
      ? await storageService.createDownloadUrl(pdfDocument.objectKey, pdfDocument.fileName)
      : undefined;
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: auth.companyId },
      select: { name: true, email: true, phone: true },
    });
    const subject = input.subject || `${company.name} quotation ${quotation.quotationNumber}`;
    const emailLog = await prisma.quotationEmailLog.create({
      data: {
        companyId: auth.companyId,
        quotationId: id,
        quotationVersionId: version.id,
        recipientEmail: input.recipientEmail,
        cc: input.cc.join(', ') || null,
        subject,
        status: 'PENDING',
        sentById: auth.userId,
      },
    });
    const text = [
      `Hello ${quotation.customerName},`,
      '',
      input.message || `Please find your ${quotation.destinationSummary} quotation.`,
      '',
      `Quotation: ${quotation.quotationNumber}`,
      `Travel: ${quotation.travelStartDate?.toLocaleDateString('en-IN') ?? 'Flexible dates'}`,
      `Final amount: ${version.currency} ${version.finalAmount}`,
      `Valid until: ${quotation.validUntil?.toLocaleDateString('en-IN') ?? 'As advised'}`,
      publicLink?.url && `View quotation: ${publicLink.url}`,
      pdfUrl && `Download PDF: ${pdfUrl}`,
      '',
      `${company.name} • ${company.email}${company.phone ? ` • ${company.phone}` : ''}`,
    ]
      .filter(Boolean)
      .join('\n');
    const html = `<p>Hello ${escapeHtml(quotation.customerName)},</p><p>${escapeHtml(input.message || `Please find your ${quotation.destinationSummary} quotation.`)}</p><p><strong>${escapeHtml(quotation.quotationNumber)}</strong><br>Final amount: ${escapeHtml(version.currency)} ${escapeHtml(version.finalAmount.toString())}<br>Valid until: ${escapeHtml(quotation.validUntil?.toLocaleDateString('en-IN') ?? 'As advised')}</p>${publicLink ? `<p><a href="${escapeHtml(publicLink.url)}">View quotation</a></p>` : ''}${pdfUrl ? `<p><a href="${escapeHtml(pdfUrl)}">Download PDF</a></p>` : ''}<p>${escapeHtml(company.name)} • ${escapeHtml(company.email)}</p>`;
    try {
      await emailService.sendMessage({
        to: input.recipientEmail,
        cc: input.cc,
        subject,
        text,
        html,
      });
      const now = new Date();
      await prisma.$transaction([
        prisma.quotationEmailLog.update({
          where: { id: emailLog.id },
          data: { status: 'SENT', sentAt: now },
        }),
        prisma.quotation.update({
          where: { id },
          data: {
            status: 'SENT',
            firstSentAt: quotation.firstSentAt ?? now,
            lastSentAt: now,
            currentVersionId: version.id,
          },
        }),
        prisma.query.update({
          where: { id: quotation.queryId },
          data: { leadStage: 'QUOTATION_SENT', quotationRequired: false },
        }),
        prisma.activityLog.create({
          data: quotationAudit(auth, 'QUOTATION_SENT', 'Quotation', id, context, {
            versionId: version.id,
            recipientEmail: input.recipientEmail,
            emailLogId: emailLog.id,
          }),
        }),
      ]);
      return { sent: true, emailLogId: emailLog.id, publicUrl: publicLink?.url ?? null };
    } catch (error) {
      await prisma.quotationEmailLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'FAILED',
          failureReason:
            error instanceof Error ? error.message.slice(0, 2000) : 'Unknown email error',
        },
      });
      throw error;
    }
  },

  async emailHistory(auth: AuthContext, id: string) {
    await getQuotation(auth, id);
    return prisma.quotationEmailLog.findMany({
      where: { companyId: auth.companyId, quotationId: id },
      select: {
        id: true,
        quotationVersionId: true,
        recipientEmail: true,
        cc: true,
        subject: true,
        providerMessageId: true,
        status: true,
        sentAt: true,
        failureReason: true,
        createdAt: true,
        sentBy: { select: userSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async publicView(
    token: string,
    options?: {
      userAgent?: string | null;
      ip?: string | null;
      authCompanyId?: string | null;
      staffViewToken?: string | null;
      customDomainCompanyId?: string | null;
    },
  ) {
    const quotation = await prisma.quotation.findFirst({
      where: { publicTokenHash: hashToken(token), deletedAt: null },
      include: publicQuotationInclude,
    });
    if (!quotation) throw new NotFoundError('This quotation link is invalid or expired.');
    return this.renderPublicQuotation(quotation, options ?? {});
  },

  /**
   * Resolve a friendly public slug (`travelagencycrm.in/<slug>`) to the exact
   * same sanitized public payload as the token lookup. Unknown slugs return the
   * same generic not-found, revealing nothing about private/tenant records.
   */
  async publicViewBySlug(
    slug: string,
    options?: {
      userAgent?: string | null;
      ip?: string | null;
      authCompanyId?: string | null;
      staffViewToken?: string | null;
      customDomainCompanyId?: string | null;
    },
  ) {
    const normalized = slug.trim().toLowerCase();
    const quotation = normalized
      ? await prisma.quotation.findFirst({
          where: { publicSlug: normalized, deletedAt: null },
          include: publicQuotationInclude,
        })
      : null;
    if (!quotation) throw new NotFoundError('This quotation link is invalid or expired.');
    return this.renderPublicQuotation(quotation, options ?? {});
  },

  /**
   * Crawler preview metadata for a public quotation link. Returns a complete,
   * self-contained HTML document so link unfurlers (WhatsApp) read the dynamic
   * title from the initial response without executing JavaScript.
   *
   * Only the lead name and the canonical URL are exposed — both already public
   * on the weblink itself. Unknown, expired, or foreign-tenant links get the
   * same generic not-found as the JSON view. Never writes: previews must not
   * count as views, flip statuses, or create analytics rows.
   */
  async publicPreviewByToken(
    token: string,
    options?: { customDomainCompanyId?: string | null },
  ): Promise<string> {
    const quotation = await prisma.quotation.findFirst({
      where: { publicTokenHash: hashToken(token), deletedAt: null },
      select: {
        id: true,
        companyId: true,
        query: { select: { customerName: true } },
      },
    });
    if (!quotation) throw new NotFoundError('This quotation link is invalid or expired.');
    if (options?.customDomainCompanyId && quotation.companyId !== options.customDomainCompanyId) {
      throw new NotFoundError('This quotation link is invalid or expired.');
    }
    return previewDocumentForQuotation(
      quotation,
      `${await preferredPublicAppBaseUrl(quotation.companyId)}/q/${token}`,
      await previewCompanyBranding(quotation.companyId),
    );
  },

  /**
   * Same preview document for friendly slug links (`/<slug>`). Slug handling
   * mirrors publicViewBySlug: case-insensitive, same generic not-found.
   */
  async publicPreviewBySlug(
    slug: string,
    options?: { customDomainCompanyId?: string | null },
  ): Promise<string> {
    const normalized = slug.trim().toLowerCase();
    const quotation = normalized
      ? await prisma.quotation.findFirst({
          where: { publicSlug: normalized, deletedAt: null },
          select: {
            id: true,
            companyId: true,
            query: { select: { customerName: true } },
          },
        })
      : null;
    if (!quotation) throw new NotFoundError('This quotation link is invalid or expired.');
    if (options?.customDomainCompanyId && quotation.companyId !== options.customDomainCompanyId) {
      throw new NotFoundError('This quotation link is invalid or expired.');
    }
    return previewDocumentForQuotation(
      quotation,
      `${await friendlyPublicSlugBaseUrl(quotation.companyId)}/${normalized}`,
      await previewCompanyBranding(quotation.companyId),
    );
  },

  async renderPublicQuotation(
    quotation: PublicQuotation,
    options: {
      userAgent?: string | null;
      ip?: string | null;
      authCompanyId?: string | null;
      staffViewToken?: string | null;
      customDomainCompanyId?: string | null;
    },
  ) {
    // When the request arrives through an ACTIVE custom domain, the quotation
    // must belong to that domain's company. A token is never exposed through
    // another tenant's custom domain — safe not-found behavior.
    if (options?.customDomainCompanyId && quotation.companyId !== options.customDomainCompanyId) {
      throw new NotFoundError('This quotation link is invalid or expired.');
    }
    // The public weblink always serves the CURRENT (latest) customer-facing
    // version. `publicVersionId` is kept in sync by createPublicLink, but if it
    // is missing/stale the current version is authoritative.
    const version =
      quotation.versions.find((row) => row.id === quotation.currentVersionId) ??
      quotation.versions.find((row) => row.id === quotation.publicVersionId) ??
      quotation.versions[0];
    if (!version) throw new NotFoundError('Quotation version not available.');
    const likelyBot = /bot|crawler|spider|preview|headless|health/i.test(options?.userAgent ?? '');
    if (!likelyBot) {
      const now = new Date();
      await prisma.$transaction([
        prisma.quotation.update({
          where: { id: quotation.id },
          data: {
            firstViewedAt: quotation.firstViewedAt ?? now,
            lastViewedAt: now,
            ...(quotation.status === 'SENT' ? { status: 'VIEWED' } : {}),
          },
        }),
        ...(!quotation.firstViewedAt
          ? [
              prisma.activityLog.create({
                data: {
                  companyId: quotation.companyId,
                  action: 'QUOTATION_VIEWED',
                  entityType: 'Quotation',
                  entityId: quotation.id,
                  metadata: { versionId: version.id },
                },
              }),
            ]
          : []),
      ]);
      // Record an aggregated weblink view for this successful public load. A
      // same-company authenticated session (or a valid signed staff-view signal,
      // for cross-host staff visits) is classified as HOME; every other valid
      // visitor is EXTERNAL. Classification is promote-only: a HOME visit
      // upgrades an existing EXTERNAL row, and an EXTERNAL visit never demotes a
      // HOME row. Atomic upsert: one row per quotation+IP.
      const homeView = isHomeWeblinkView(
        options?.authCompanyId,
        options?.staffViewToken,
        quotation,
      );
      const ipAddress = normalizeWeblinkIp(options?.ip);
      await prisma.quotationWeblinkView.upsert({
        where: {
          quotationId_ipAddress: {
            quotationId: quotation.id,
            ipAddress,
          },
        },
        create: {
          companyId: quotation.companyId,
          quotationId: quotation.id,
          ipAddress,
          type: homeView ? 'HOME' : 'EXTERNAL',
          viewCount: 1,
          firstViewedAt: now,
          lastViewedAt: now,
        },
        update: {
          viewCount: { increment: 1 },
          lastViewedAt: now,
          // Promote-only: only a HOME visit may change the stored type.
          ...(homeView ? { type: 'HOME' as const } : {}),
        },
      });
    }
    const document = quotation.documents.find(
      (row) =>
        row.quotationVersionId === version.id &&
        row.documentType === 'QUOTATION_PDF' &&
        row.status === 'AVAILABLE',
    );
    let downloadUrl: string | null = null;
    if (document) {
      try {
        downloadUrl = await storageService.createDownloadUrl(document.objectKey, document.fileName);
      } catch {
        // A missing or temporarily unavailable object must not hide the
        // customer-safe quotation itself. Staff can regenerate the PDF.
        downloadUrl = null;
      }
    }
    // Hero image: match this quote's Master destination (itinerary `country`,
    // e.g. "Malaysia") to a Destination master with a confirmed image, and hand
    // the page a short-lived signed URL. Never keyed off the city value.
    const heroImageUrl = await resolveDestinationHeroImage(
      quotation.companyId,
      quotation.destinationSummary,
      quotation.query?.itinerary,
    );
    // These ids come from already-persisted, validated links. Keep hidden
    // globals working for existing quotations while excluding other tenants.
    const masterOwnerCompanyIds = await linkedMasterOwnerCompanyIds(quotation.companyId);
    const hotelPresentations = await resolveHotelPresentations(
      masterOwnerCompanyIds,
      version.hotels.map((hotel) => ({ id: hotel.id, hotelId: hotel.hotelId })),
    );
    const vehiclePresentations = await resolveVehiclePresentations(
      masterOwnerCompanyIds,
      version.services
        .filter((service) => service.serviceType === 'VEHICLE_TRANSFER')
        .map((service) => ({ id: service.id, vehicleId: service.vehicleId })),
    );
    const airlinePresentations = await resolveAirlinePresentations(
      masterOwnerCompanyIds,
      version.flightDetails,
    );
    const publicFlightDetails = version.flightDetails as {
      entryMode?: 'MANUAL' | 'IMAGE';
      imageDocumentId?: string | null;
      images?: Array<{ documentId: string; description?: string | null; heading?: string | null }>;
    } | null;
    const configuredFlightImages = publicFlightDetails?.images?.length
      ? publicFlightDetails.images
      : publicFlightDetails?.imageDocumentId
        ? [{ documentId: publicFlightDetails.imageDocumentId, description: null, heading: null }]
        : [];
    const imageDocumentsById = new Map(
      quotation.documents
        .filter(
          (row) =>
            row.status === 'AVAILABLE' &&
            row.deletedAt === null &&
            row.mimeType.startsWith('image/'),
        )
        .map((row) => [row.id, row]),
    );
    let flightImageUrl: string | null = null;
    const flightImages: Array<{ description?: string | null; url: string }> = [];
    if (publicFlightDetails?.entryMode === 'IMAGE') {
      for (const configuredImage of configuredFlightImages) {
        const document = imageDocumentsById.get(configuredImage.documentId);
        if (!document) continue;
        try {
          const url = await storageService.createDownloadUrl(
            document.objectKey,
            document.fileName,
            undefined,
            'inline',
          );
          flightImages.push({
            description: configuredImage.description ?? configuredImage.heading ?? null,
            url,
          });
        } catch {
          /* Image URLs are best-effort. */
        }
      }
      flightImageUrl = flightImages[0]?.url ?? null;
    }
    const sightseeingPresentations = await resolveSightseeingPresentations(
      masterOwnerCompanyIds,
      version.sightseeingDetails,
    );
    const sightseeingDocumentPresentations: Record<string, { imageUrl: string | null }> = {};
    const parsedSightseeing = sightseeingDetailsSchema.safeParse(version.sightseeingDetails);
    if (parsedSightseeing.success) {
      const documentIds = [
        ...new Set(
          parsedSightseeing.data.days
            .flatMap((day) => day.activities.map((activity) => activity.imageDocumentId))
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      await Promise.all(
        documentIds.map(async (documentId) => {
          const document = imageDocumentsById.get(documentId);
          if (!document) return;
          try {
            sightseeingDocumentPresentations[documentId] = {
              imageUrl: await storageService.createDownloadUrl(
                document.objectKey,
                document.fileName,
                undefined,
                'inline',
              ),
            };
          } catch {
            sightseeingDocumentPresentations[documentId] = { imageUrl: null };
          }
        }),
      );
    }
    const cruisePresentations = await resolveCruisePresentations(
      masterOwnerCompanyIds,
      version.services
        .filter((service) => service.serviceType === 'CRUISE')
        .map((service) => ({
          id: service.id,
          cruiseId: service.cruiseId,
          cruiseRoomTypeId: service.cruiseRoomTypeId,
        })),
    );
    const destinationExpert = await resolveDestinationExpertPresentation(
      quotation.companyId,
      normalizeDestinationExpertConfig(
        (version as unknown as { destinationExpertConfig?: unknown }).destinationExpertConfig,
      ),
    );
    // Internal storage keys never leave the API.
    const {
      profileImageObjectKey: _profileImageObjectKey,
      profileImageConfirmedAt: _profileImageConfirmedAt,
      ...safeDestinationExpert
    } = destinationExpert ?? {};
    void _profileImageObjectKey;
    void _profileImageConfirmedAt;
    return {
      company: {
        name: quotation.company.name,
        email: quotation.company.email,
        phone: quotation.company.phone,
        website: quotation.company.website,
        address: quotation.company.address,
        googleMapsUrl: quotation.company.googleMapsUrl ?? null,
        primaryColor: quotation.company.primaryColor,
        operatingSince: quotation.company.operatingSinceYear,
        tripsSold: quotation.company.tripsSold,
        tan: quotation.company.tan,
        taxRegistrationNumber: quotation.company.taxRegistrationNumber,
        logoUrl: await publicCompanyLogoUrl(quotation.company),
      },
      heroImageUrl,
      hotelPresentations,
      vehiclePresentations,
      airlinePresentations,
      flightImageUrl,
      flightImages,
      sightseeingPresentations,
      sightseeingDocumentPresentations,
      cruisePresentations,
      destinationExpert: Object.keys(safeDestinationExpert).length ? safeDestinationExpert : null,
      quotation: {
        quotationNumber: quotation.quotationNumber,
        customerName: quotation.customerName,
        destinationSummary: quotation.destinationSummary,
        // Destination/Master-country names (e.g. "Malaysia"), de-duplicated in
        // first-seen itinerary order; falls back to the summary for legacy rows.
        destinations: resolveDestinationNames(
          quotation.query?.itinerary,
          quotation.destinationSummary,
        ).join(' → '),
        durationNights: resolveItineraryNights(quotation.query?.itinerary),
        travelStartDate: quotation.travelStartDate,
        travelEndDate: quotation.travelEndDate,
        adults: quotation.adults,
        childrenWithBed: quotation.childrenWithBed,
        childrenWithoutBed: quotation.childrenWithoutBed,
        infants: quotation.infants,
        rooms: quotation.rooms,
        // Child ages for the public Travelers display (same source the PDF
        // renders). Null for legacy quotations → the age line is omitted.
        childrenWithBedAges: (quotation.childrenWithBedAges as number[] | null) ?? null,
        childrenWithoutBedAges: (quotation.childrenWithoutBedAges as number[] | null) ?? null,
        infantAges: (quotation.infantAges as number[] | null) ?? null,
        validUntil: quotation.validUntil,
        createdAt: quotation.createdAt,
        status: quotation.status,
      },
      version: await presentVersion(version, false, true),
      downloadUrl,
    };
  },

  /**
   * Enrich the aggregated weblink-view row for a visitor with the telemetry the
   * public page collects (device/screen/referrer/UTM + scroll/time), plus
   * server-derived User-Agent parsing and approximate IP geolocation. Best
   * effort: never throws to the caller, never increments the view count (the
   * page-load in publicView owns that), and never wipes a previously captured
   * value with a missing one.
   */
  async trackWeblinkVisit(
    token: string,
    input: QuotationTrackInput,
    meta: {
      userAgent?: string | null;
      ip?: string | null;
      authCompanyId?: string | null;
      staffViewToken?: string | null;
      customDomainCompanyId?: string | null;
    },
  ) {
    const quotation = await prisma.quotation.findFirst({
      where: { publicTokenHash: hashToken(token), deletedAt: null },
      select: { id: true, companyId: true },
    });
    if (!quotation) return { ok: false };
    return this.trackWeblinkVisitForQuotation(quotation, input, meta);
  },

  async trackWeblinkVisitBySlug(
    slug: string,
    input: QuotationTrackInput,
    meta: {
      userAgent?: string | null;
      ip?: string | null;
      authCompanyId?: string | null;
      staffViewToken?: string | null;
      customDomainCompanyId?: string | null;
    },
  ) {
    const normalized = slug.trim().toLowerCase();
    const quotation = normalized
      ? await prisma.quotation.findFirst({
          where: { publicSlug: normalized, deletedAt: null },
          select: { id: true, companyId: true },
        })
      : null;
    if (!quotation) return { ok: false };
    return this.trackWeblinkVisitForQuotation(quotation, input, meta);
  },

  async trackWeblinkVisitForQuotation(
    quotation: { id: string; companyId: string },
    input: QuotationTrackInput,
    meta: {
      userAgent?: string | null;
      ip?: string | null;
      authCompanyId?: string | null;
      staffViewToken?: string | null;
      customDomainCompanyId?: string | null;
    },
  ) {
    if (meta.customDomainCompanyId && quotation.companyId !== meta.customDomainCompanyId)
      return { ok: false };
    const ua = meta.userAgent ?? '';
    if (/bot|crawler|spider|preview|headless|health/i.test(ua)) return { ok: false };

    // Visitor telemetry is collected for real (external) clients only. A HOME
    // view — a signed-in team member of the same company (or a valid signed
    // staff-view signal) opening the weblink — is not profiled. It never
    // creates a row (publicView owns that) and never demotes an existing row;
    // it can only promote an EXTERNAL row to HOME for this quotation+IP.
    const homeView = isHomeWeblinkView(meta.authCompanyId, meta.staffViewToken, quotation);
    if (homeView) {
      await prisma.quotationWeblinkView.updateMany({
        where: {
          quotationId: quotation.id,
          ipAddress: normalizeWeblinkIp(meta.ip),
        },
        data: { type: 'HOME' },
      });
      return { ok: false, skipped: 'home' as const };
    }
    const type = 'EXTERNAL' as const;

    const parsed = parseUserAgent(ua);
    const geo = await geolocateIp(meta.ip);
    const ipAddress = normalizeWeblinkIp(meta.ip);

    // Engagement metrics keep the best value across a visitor's sessions, so a
    // quick reopen never clobbers a longer earlier read.
    const existing = await prisma.quotationWeblinkView.findUnique({
      where: { quotationId_ipAddress: { quotationId: quotation.id, ipAddress } },
      select: { maxScrollDepth: true, timeOnPageSeconds: true, ctaClicks: true },
    });
    const maxOf = (prev: number | null | undefined, next: number | undefined) =>
      next === undefined ? undefined : Math.max(prev ?? 0, next);

    // Only include fields we actually have, so a later beacon never clears an
    // earlier value (e.g. a geo lookup that timed out on the second call).
    const defined = <T>(value: T | undefined | null) => value !== undefined && value !== null;
    const data = {
      userAgent: ua || null,
      browser: parsed.browser,
      browserVersion: parsed.browserVersion,
      os: parsed.os,
      osVersion: parsed.osVersion,
      deviceType: parsed.deviceType,
      deviceVendor: parsed.deviceVendor,
      deviceModel: parsed.deviceModel,
      ...(geo
        ? {
            country: geo.country,
            region: geo.region,
            city: geo.city,
            isp: geo.isp,
            geoTimezone: geo.timezone,
            latitude: geo.latitude,
            longitude: geo.longitude,
          }
        : {}),
      ...(defined(input.platform) ? { platform: input.platform } : {}),
      ...(defined(input.language) ? { language: input.language } : {}),
      ...(defined(input.languages) ? { languages: input.languages } : {}),
      ...(defined(input.clientTimezone) ? { clientTimezone: input.clientTimezone } : {}),
      ...(defined(input.screenWidth) ? { screenWidth: input.screenWidth } : {}),
      ...(defined(input.screenHeight) ? { screenHeight: input.screenHeight } : {}),
      ...(defined(input.screenAvailWidth) ? { screenAvailWidth: input.screenAvailWidth } : {}),
      ...(defined(input.screenAvailHeight) ? { screenAvailHeight: input.screenAvailHeight } : {}),
      ...(defined(input.viewportWidth) ? { viewportWidth: input.viewportWidth } : {}),
      ...(defined(input.viewportHeight) ? { viewportHeight: input.viewportHeight } : {}),
      ...(defined(input.pixelRatio) ? { pixelRatio: input.pixelRatio } : {}),
      ...(defined(input.colorDepth) ? { colorDepth: input.colorDepth } : {}),
      ...(defined(input.orientation) ? { orientation: input.orientation } : {}),
      ...(defined(input.cpuCores) ? { cpuCores: input.cpuCores } : {}),
      ...(defined(input.deviceMemory) ? { deviceMemory: input.deviceMemory } : {}),
      ...(defined(input.connectionType) ? { connectionType: input.connectionType } : {}),
      ...(defined(input.connectionDownlink)
        ? { connectionDownlink: input.connectionDownlink }
        : {}),
      ...(defined(input.connectionRtt) ? { connectionRtt: input.connectionRtt } : {}),
      ...(defined(input.online) ? { online: input.online } : {}),
      ...(defined(input.referrer) ? { referrer: input.referrer } : {}),
      ...(defined(input.landingUrl) ? { landingUrl: input.landingUrl } : {}),
      ...(defined(input.utmSource) ? { utmSource: input.utmSource } : {}),
      ...(defined(input.utmMedium) ? { utmMedium: input.utmMedium } : {}),
      ...(defined(input.utmCampaign) ? { utmCampaign: input.utmCampaign } : {}),
      ...(defined(input.visitorId) ? { visitorId: input.visitorId } : {}),
      ...(defined(input.maxScrollDepth)
        ? { maxScrollDepth: maxOf(existing?.maxScrollDepth, input.maxScrollDepth) }
        : {}),
      ...(defined(input.timeOnPageSeconds)
        ? { timeOnPageSeconds: maxOf(existing?.timeOnPageSeconds, input.timeOnPageSeconds) }
        : {}),
      ...(defined(input.ctaClicks)
        ? { ctaClicks: maxOf(existing?.ctaClicks, input.ctaClicks) }
        : {}),
    } as Prisma.QuotationWeblinkViewUncheckedUpdateInput;

    await prisma.quotationWeblinkView.upsert({
      where: { quotationId_ipAddress: { quotationId: quotation.id, ipAddress } },
      create: {
        companyId: quotation.companyId,
        quotationId: quotation.id,
        ipAddress,
        type,
        ...data,
      } as Prisma.QuotationWeblinkViewUncheckedCreateInput,
      update: data,
    });
    return { ok: true };
  },

  async publicDecision(
    token: string,
    decision: 'accept' | 'reject',
    input: { customerName?: string; reason?: string; note?: string },
  ) {
    const quotation = await prisma.quotation.findFirst({
      where: { publicTokenHash: hashToken(token), deletedAt: null },
      include: quotationInclude,
    });
    if (!quotation) throw new NotFoundError('This quotation link is invalid or expired.');
    return recordPublicDecision(quotation, decision, input);
  },

  async publicDecisionBySlug(
    slug: string,
    decision: 'accept' | 'reject',
    input: { customerName?: string; reason?: string; note?: string },
  ) {
    const normalized = slug.trim().toLowerCase();
    const quotation = normalized
      ? await prisma.quotation.findFirst({
          where: { publicSlug: normalized, deletedAt: null },
          include: quotationInclude,
        })
      : null;
    if (!quotation) throw new NotFoundError('This quotation link is invalid or expired.');
    return recordPublicDecision(quotation, decision, input);
  },
};

async function recordPublicDecision(
  quotation: FullQuotation,
  decision: 'accept' | 'reject',
  input: { customerName?: string; reason?: string; note?: string },
) {
  if (['ACCEPTED', 'REJECTED', 'ARCHIVED'].includes(quotation.status))
    throw new ConflictError('A final response has already been recorded.');
  const version =
    quotation.versions.find((row) => row.id === quotation.currentVersionId) ??
    quotation.versions.find((row) => row.id === quotation.publicVersionId);
  if (!version || version.status === 'DRAFT')
    throw new ConflictError('The linked version is not finalized.');
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (decision === 'accept') {
      await tx.quotation.update({
        where: { id: quotation.id },
        data: { status: 'ACCEPTED', acceptedAt: now, acceptedVersionId: version.id },
      });
      await tx.query.update({
        where: { id: quotation.queryId },
        data: { leadStage: 'READY_TO_BOOK' },
      });
      await tx.activityLog.create({
        data: {
          companyId: quotation.companyId,
          action: 'QUOTATION_ACCEPTED',
          entityType: 'Quotation',
          entityId: quotation.id,
          metadata: { versionId: version.id, customerName: input.customerName, note: input.note },
        },
      });
    } else {
      await tx.quotation.update({
        where: { id: quotation.id },
        data: { status: 'REJECTED', rejectedAt: now, rejectionReason: input.reason ?? null },
      });
      await tx.activityLog.create({
        data: {
          companyId: quotation.companyId,
          action: 'QUOTATION_REJECTED',
          entityType: 'Quotation',
          entityId: quotation.id,
          metadata: { versionId: version.id, reason: input.reason, note: input.note },
        },
      });
    }
  });
  return { status: decision === 'accept' ? 'ACCEPTED' : 'REJECTED', recordedAt: now };
}

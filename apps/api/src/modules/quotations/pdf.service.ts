import PDFDocument from 'pdfkit';
import {
  cabinLuggageLabel,
  flightRecordPrefix,
  formatAgeList,
  formatDayPrefixedTitle,
  formatInfantAgeList,
  formatItineraryDayTitle,
  hotelStayNights,
  isItineraryActivityTitleDuplicate,
  isPublicTaxNote,
  normalizeFaqs,
  normalizeFlightDetails,
  resolveCruiseRoomLines,
  resolveHotelMealPlanLines,
  resolveHotelRoomLines,
  resolveItineraryActivityImage,
  resolveItineraryDayImage,
  resolveQuotationPdfSectionOrder,
  resolveQuotationPricing,
  getFlightPerTravelerBreakdown,
  type QuotationPdfSectionId,
} from '@interscale/shared';
import {
  colorEmojiPng,
  containsPdfEmoji,
  pdfEmojiFallback,
  pdfEmojiSequenceRegex,
} from '../../services/pdf/color-emojis.js';
import { DEJAVU_SANS, DEJAVU_SANS_BOLD } from '../../services/pdf/fonts.js';

/**
 * Quotation PDF renderer — content-based page heights.
 *
 * Every physical page height is derived from its measured content:
 *
 *   pageHeight = topMargin + measuredContentHeight + postContentGap
 *              + footerHeight + bottomMargin
 *
 * The renderer works in two phases:
 *   1. MEASURE + PLAN — every section builds measured blocks; a page planner
 *      packs them into pages (continuation pages when a page would exceed the
 *      maximum content height).
 *   2. RENDER — each planned page is added with its calculated size and its
 *      blocks are drawn, then the complete footer is drawn on every buffered
 *      page using that page's own height.
 *
 * All visual features are preserved: destination hero image + overlay, the
 * consultant strip, package title, summary + traveller-pricing columns, yellow
 * Total Cost box, the `Inclusive of all taxes, excluding TCS` note, Secure Your
 * Booking (no filled background, clickable Pay Now), Services Include, flight
 * timeline cards with padding and wrapping notes, hotel cards, one-day-per-page
 * alternating itinerary, vehicle/cruise/add-on sections, coloured policies, the
 * final Thank You page, and the complete repeating footer.
 */

// ---- Fixed palette (never derived from tenant branding) -------------------
const GREEN = '#22B14C';
const DGREEN = '#159447';
const LGREEN = '#EAF8EF';
const BLUE = '#1677F3';
const AMBER = '#FFB500';
const RED = '#E53935';
const TEAL = '#0FAAA5';
const DARK = '#171717';
const MUTED = '#5F6670';
const BORDER = '#D8DDE3';

// ---- Global page geometry (PDF points) ------------------------------------
/** A4 page width. */
export const PDF_PAGE_WIDTH = 595.28;
/** A4 page height — every page uses the same physical size. */
export const PDF_PAGE_HEIGHT = 841.89;
export const PDF_TOP_MARGIN = 46;
export const PDF_SIDE_MARGIN = 40;
export const PDF_BOTTOM_MARGIN = 30;
export const PDF_FOOTER_HEIGHT = 112;
export const PDF_POST_CONTENT_GAP = 16;
/** Smallest practical page: preserves the full footer plus a usable body area. */
export const PDF_MIN_PAGE_HEIGHT = 500;
export const PDF_MAX_PAGE_HEIGHT = PDF_PAGE_HEIGHT;
const M = PDF_SIDE_MARGIN;
const TOP = PDF_TOP_MARGIN;
const BOTTOM_M = PDF_BOTTOM_MARGIN;
const FOOTER_H = PDF_FOOTER_HEIGHT;
const POST_GAP = PDF_POST_CONTENT_GAP;
const CONTENT_W = PDF_PAGE_WIDTH - M * 2; // 515.28
/** Y where body content must stop so it never collides with the footer zone. */
export const CONTENT_BOTTOM_LIMIT = PDF_PAGE_HEIGHT - BOTTOM_M - FOOTER_H - POST_GAP;
/** Max content height on a page before the planner starts a continuation page. */
export const PDF_MAX_CONTENT_HEIGHT = CONTENT_BOTTOM_LIMIT - TOP;

// ---- Footer grid (fixed logo column; the three data sections reflow) -------
// Content area is M..(PDF_PAGE_WIDTH - M) = 40..555.28 (width 515.28).
// The logo column is fixed; the CONTACT US / OUR ACHIEVEMENTS / LEGAL INFO
// sections share the remaining width evenly, each in its own non-overlapping
// column, and reflow to skip any section whose data is entirely missing.
export const FOOTER_GUTTER = 14;
export const FOOTER_COLUMNS = {
  logo: { x: M, width: 100 },
  contact: { x: M + 100 + FOOTER_GUTTER, width: 145 },
  achievements: { x: M + 100 + FOOTER_GUTTER + 145 + FOOTER_GUTTER, width: 115 },
  legal: {
    x: M + 100 + FOOTER_GUTTER + 145 + FOOTER_GUTTER + 115 + FOOTER_GUTTER,
    width:
      PDF_PAGE_WIDTH - M - (M + 100 + FOOTER_GUTTER + 145 + FOOTER_GUTTER + 115 + FOOTER_GUTTER),
  },
} as const;
const LOGO_X = FOOTER_COLUMNS.logo.x;
const LOGO_W = FOOTER_COLUMNS.logo.width;
const FOOTER_HEADING_FONT = 9.5;
const FOOTER_BODY_FONT = 8;
const FOOTER_VALUE_FONT_MIN = 7;
// Vertical footer rows (relative to the divider/footerTop), badge on its own row.
export const FOOTER_HEADING_Y_OFF = 16;
export const FOOTER_LINE_1_Y_OFF = 34;
export const FOOTER_LINE_2_Y_OFF = 47;
export const FOOTER_LINE_3_Y_OFF = 60;
export const FOOTER_LINE_GAP = 13;
/** Shared downward adjustment for the divider, logo, and footer information. */
export const FOOTER_INFORMATION_Y_OFFSET = 10;
export const PAGE_BADGE_H = 24;
export const PAGE_BADGE_BOTTOM_GAP = 12;

// Flight-card padding (points), shared by measurement and rendering.
const FLIGHT_CARD_PADDING_X = 16;
const FLIGHT_CARD_PADDING_TOP = 14;
const FLIGHT_CARD_PADDING_BOTTOM = 12;
const FLIGHT_CARD_SECTION_GAP = 8;
const FLIGHT_CARD_SEGMENT_GAP = 12;

const num = (value: unknown) => Number(value ?? 0) || 0;

/** Normalize an optional text value: null/undefined/whitespace/literal junk → ''. */
const toText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  if (!s || s === 'null' || s === 'undefined' || s === 'NaN' || s === '[object Object]') return '';
  return s;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** e.g. "22 Aug 2026" (or "Sat, 22 Aug 2026" with the weekday). */
const dateFmt = (value: Date | string | null | undefined, withDow = false) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const core = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withDow ? `${DOW[d.getUTCDay()]}, ${core}` : core;
};

const moneyFmt = (currency: string, value: unknown, digits = 0) => {
  const code = (currency || 'INR').toUpperCase();
  const n = num(value);
  try {
    return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${code} ${n.toFixed(digits)}`;
  }
};

/** A payment link is clickable only when it is an absolute http(s) URL. */
const validPaymentUrl = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
};

export interface AddonPricingBox {
  label: string;
  amount: string | null;
}

/**
 * Compact add-on pricing boxes from the quotation-owned pricing snapshot.
 * Legacy rows (no snapshot) yield none, so their Classic PDF output is
 * byte-identical to before. Basis-only entries keep a label-only tile.
 */
export function addonPricingBoxes(
  service: {
    pricingSnapshot?: Array<{
      id?: string;
      label?: string | null;
      price?: number | null;
      currency?: string | null;
    }> | null;
  },
  fallbackCurrency: string,
): AddonPricingBox[] {
  const raw = Array.isArray(service.pricingSnapshot) ? service.pricingSnapshot : [];
  return raw.flatMap((entry): AddonPricingBox[] => {
    if (entry == null || typeof entry !== 'object') return [];
    const label = String(entry.label ?? '').trim() || 'Standard';
    const rawPrice = entry.price as unknown;
    const price = rawPrice == null || rawPrice === '' ? null : Number(rawPrice);
    if (price == null || !Number.isFinite(price)) return [{ label, amount: null }];
    const code = String(entry.currency ?? fallbackCurrency).trim().toUpperCase() || 'INR';
    return [{ label, amount: moneyFmt(code, price) }];
  });
}

/** Compact pricing-box grid: 3 small bordered tiles per row (label over price). */
export const ADDON_BOXES_PER_ROW = 3;
export const ADDON_BOX_GAP = 8;
export const ADDON_BOX_H = 38;
export function addonPricingGridHeight(count: number): number {
  if (!count) return 0;
  const rows = Math.ceil(count / ADDON_BOXES_PER_ROW);
  return 8 + rows * ADDON_BOX_H + (rows - 1) * ADDON_BOX_GAP;
}

/**
 * Draw the compact pricing-box grid (label over bold price, 3 tiles per row).
 * Returns the y cursor just below the grid. Amount-only tiles keep the same
 * geometry with a single line.
 */
export function drawAddonPricingGrid(
  doc: PDFKit.PDFDocument,
  boxes: AddonPricingBox[],
  x: number,
  y: number,
  width: number,
): number {
  if (!boxes.length) return y;
  const rows = Math.ceil(boxes.length / ADDON_BOXES_PER_ROW);
  const boxW = (width - ADDON_BOX_GAP * (ADDON_BOXES_PER_ROW - 1)) / ADDON_BOXES_PER_ROW;
  boxes.forEach((box, i) => {
    const col = i % ADDON_BOXES_PER_ROW;
    const gridRow = Math.floor(i / ADDON_BOXES_PER_ROW);
    const bx = x + col * (boxW + ADDON_BOX_GAP);
    const by = y + gridRow * (ADDON_BOX_H + ADDON_BOX_GAP);
    doc.save().roundedRect(bx, by, boxW, ADDON_BOX_H, 4).stroke(BORDER).restore();
    doc
      .font('Body')
      .fontSize(7.5)
      .fillColor(DARK)
      .text(box.label, bx + 6, by + 5, { width: boxW - 12, ellipsis: true, lineBreak: false });
    if (box.amount != null)
      doc
        .font('Bold')
        .fontSize(9.5)
        .fillColor(DARK)
        .text(box.amount, bx + 6, by + 19, {
          width: boxW - 12,
          ellipsis: true,
          lineBreak: false,
        });
  });
  return y + rows * ADDON_BOX_H + (rows - 1) * ADDON_BOX_GAP;
}

export type PdfRichTextRun = { text: string; bold: boolean };
export type PdfRichTextLine = PdfRichTextRun[];

const decodeHtmlText = (value: string): string => {
  let prev = '';
  let cur = value;
  let iterations = 0;
  while (cur !== prev && iterations < 10) {
    prev = cur;
    cur = cur
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_: string, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([\da-f]+);/gi, (_: string, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
    iterations++;
    if (!cur.includes('&')) break;
  }
  return cur;
};

/** Convert sanitised editor HTML to PDF lines while retaining inline bold runs. */
export const htmlToRichTextLines = (html: string | null | undefined): PdfRichTextLine[] => {
  if (!html) return [];
  const lines: PdfRichTextLine[] = [[]];
  let boldDepth = 0;
  const current = () => lines[lines.length - 1]!;
  const hasText = (line: PdfRichTextLine) => line.some((run) => run.text.trim().length > 0);
  const newLine = () => {
    if (hasText(current())) lines.push([]);
  };
  const append = (text: string, bold = boldDepth > 0) => {
    if (!text) return;
    const previous = current().at(-1);
    if (previous?.bold === bold) previous.text += text;
    else current().push({ text, bold });
  };

  for (const token of html.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (!token.startsWith('<')) {
      append(decodeHtmlText(token).replace(/\s+/g, ' '));
      continue;
    }
    const closing = /^<\s*\//.test(token);
    const tag = token.match(/^<\s*\/?\s*([\w-]+)/)?.[1]?.toLowerCase();
    if (!tag) continue;
    if (tag === 'strong' || tag === 'b') boldDepth = Math.max(0, boldDepth + (closing ? -1 : 1));
    else if (tag === 'br') newLine();
    else if (tag === 'li' && !closing) {
      newLine();
      append('• ', false);
    } else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'li'].includes(tag)) {
      const bulletOnly =
        current()
          .map((run) => run.text)
          .join('')
          .trim() === '•';
      if (closing || (hasText(current()) && !bulletOnly)) newLine();
    }
  }

  return lines.filter(hasText).map((line) => {
    const copy = line.map((run) => ({ ...run }));
    if (copy[0]) copy[0].text = copy[0].text.trimStart();
    if (copy.at(-1)) copy.at(-1)!.text = copy.at(-1)!.text.trimEnd();
    return copy.filter((run) => run.text.length > 0);
  });
};

/** Flatten rich text for PDF sections that intentionally use plain text. */
export const htmlToLines = (html: string | null | undefined): string[] =>
  htmlToRichTextLines(html).map((line) => line.map((run) => run.text).join(''));

const ADDON_SERVICE_TYPES = new Set([
  'TRAVEL_INSURANCE',
  'RAIL',
  'PASSPORT_ASSISTANCE',
  'MEAL',
  'GUIDE',
  'OTHER_ADD_ON',
  'GENERAL_ENQUIRY',
]);

/** Normalize legacy sightseeing meal-mode strings into the canonical value. */
function normalizePdfMealMode(value: string | null | undefined): string | null {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s_./-]+/g, '');
  if (raw === 'NOTRANSFER' || raw === 'NONE') return 'NO_TRANSFER';
  if (raw === 'INCLUDEATHOTEL' || raw === 'HOTEL' || raw === 'INHOTEL') return 'INCLUDE_AT_HOTEL';
  if (raw === 'WITHTRANSFER') return 'WITH_TRANSFER';
  return null;
}

/**
 * Per-meal mode label, mirroring the public weblink's itineraryMealLabel so the
 * PDF never infers "(Hotel)" from breakfast/hotel-stay defaults. The meal's own
 * saved preference wins; the shared legacy mealMode is used only when the meal
 * has no per-meal preference.
 */
function pdfMealModeLabel(
  pref: { mode?: string | null; transferDetails?: string | null } | undefined,
  legacyMode: string | null | undefined,
): string | null {
  const mode = pref?.mode ? normalizePdfMealMode(pref.mode) : normalizePdfMealMode(legacyMode);
  if (mode === 'WITH_TRANSFER') {
    const details = (pref?.transferDetails ?? '').trim();
    return details ? `With Transfer: ${details}` : 'With Transfer';
  }
  if (mode === 'INCLUDE_AT_HOTEL') return 'Hotel';
  if (mode === 'NO_TRANSFER') return 'No Transfer';
  return null;
}

/** Customer label for a transfer value (PRIVATE/SHARED/NO_TRANSFER). */
function pdfTransferLabel(value: string | null | undefined): string | null {
  if (value === 'PRIVATE') return 'Private Transfer';
  if (value === 'SHARED') return 'Shared Transfer';
  if (value === 'NO_TRANSFER') return 'No Transfer';
  return null;
}

/**
 * Usable pricing rows for an activity: a real label with a real, finite,
 * non-negative price. Pre-feature snapshots have no `pricingOptions` and yield
 * an empty list, which renders nothing at all. Exported for tests.
 */
export function pdfActivityPrices(
  rows: Array<{ label?: string | null; price?: number | string | null }> | null | undefined,
): Array<{ label: string; price: number }> {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const label = String(row?.label ?? '').trim();
    if (!label || row?.price == null || row.price === '') return [];
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) return [];
    return [{ label, price }];
  });
}

/**
 * DISPLAY-ONLY pricing rows copied from the Sightseeing Master.
 * Only rows with `enabled !== false` are shown, and they never feed totals.
 */
export function pdfDisplayPrices(
  rows: Array<{ label?: string | null; price?: number | string | null; enabled?: boolean }> | null | undefined,
): Array<{ label: string; price: number }> {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if ((row as { enabled?: boolean })?.enabled === false) return [];
    const label = String(row?.label ?? '').trim();
    if (!label || row?.price == null || row.price === '') return [];
    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) return [];
    return [{ label, price }];
  });
}

type Img = Buffer | null | undefined;

/** Company data for the repeating footer and page-1 consultant fallback. */
export interface QuotationPdfCompany {
  name: string;
  email: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  primaryColor: string;
  operatingSinceYear: number | null;
  tripsSold: number | null;
  tan: string | null;
  taxRegistrationNumber: string | null;
  /** Server-resolved logo bytes (optional; contain-fit in the footer). */
  logo: Img;
}

/** Page-1 consultant strip: name/phone/email resolved server-side. */
export interface QuotationPdfConsultant {
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** Resolved Destination Expert data, mirroring the public weblink payload. */
export interface QuotationPdfDestinationExpert {
  fullName: string;
  heading: string | null;
  customIntroduction: string | null;
  whatsappNumber: string | null;
  callNumber: string | null;
  email: string | null;
  jobTitle: string | null;
  bio: string | null;
  specialization: string | null;
  showWhatsapp: boolean;
  showCall: boolean;
  showEmail: boolean;
}

export interface QuotationPdfInput {
  company?: QuotationPdfCompany | null;
  consultant?: QuotationPdfConsultant | null;
  /** Resolved Destination Expert (server-side), when the quotation enables one. */
  destinationExpert?: QuotationPdfDestinationExpert | null;
  quotation: {
    quotationNumber: string;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string;
    destinationSummary: string;
    /** Destination/Master-country names (e.g. "Malaysia"), joined with " → ". */
    destinations?: string;
    /** Sum of nights from every destination row on the source lead. */
    durationNights?: number | null;
    travelStartDate: Date | null;
    travelEndDate: Date | null;
    adults: number;
    childrenWithBed: number;
    childrenWithoutBed: number;
    infants: number;
    rooms: number;
    // Child ages carried from the Lead (JSON arrays). Absent/NULL for legacy
    // quotations — the age lines are simply omitted.
    childrenWithBedAges?: unknown;
    childrenWithoutBedAges?: unknown;
    infantAges?: unknown;
    validUntil: Date | null;
  };
  version: {
    versionNumber: number;
    title: string;
    introduction: string | null;
    currency: string;
    finalAmount: unknown;
    notes: string | null;
    perAdultPrice: unknown;
    perChildWithBedPrice: unknown;
    perChildWithoutBedPrice: unknown;
    perInfantPrice: unknown;
    taxNote: string | null;
    initialPaymentAmount: unknown;
    paymentLink: string | null;
    inclusionsHtml: string | null;
    exclusionsHtml: string | null;
    paymentPolicies: string | null;
    cancellationPolicies: string | null;
    bookingTerms: string | null;
    // Optional for backward compatibility with callers/tests that build the
    // PDF input without the newer Child Policy field.
    childPolicy?: string | null;
    includeVisa: boolean;
    visaSectionTitle: string | null;
    visaAmount: unknown;
    visaDestination: string | null;
    visaType: string | null;
    visaServiceCharge: unknown;
    visaGstPercent: unknown;
    visaVfsCharge: unknown;
    flightDetails: unknown;
    sightseeingDetails: unknown;
    hotelDetails?: { include?: boolean } | null;
    addOnDetails?: { include?: boolean } | null;
    hotels: Array<{
      city: string;
      hotelName: string;
      category: string | null;
      roomType: string | null;
      mealPlan: string | null;
      rooms?: number | null;
      // Stay dates are optional: NULL nights means the duration is unknown
      // (dateless hotel option). Customer views omit the badge in that case.
      nights: number | null;
      selected: boolean;
      notes: string | null;
      checkInDate?: Date | string | null;
      checkOutDate?: Date | string | null;
      checkInTime?: string | null;
      checkOutTime?: string | null;
      showCheckInTime?: boolean;
      showCheckOutTime?: boolean;
      sellingPrice?: number | null;
      baseRoomPrice?: number | null;
      extraBedQuantity?: number | null;
      extraBedPrice?: number | null;
      childWithoutBedQuantity?: number | null;
      childWithoutBedPrice?: number | null;
      pricingSource?: string | null;
    }>;
    itinerary: Array<{
      dayNumber: number;
      title: string;
      destination: string;
      description: string;
      meals: string | null;
      overnightLocation: string | null;
    }>;
    services: Array<{
      serviceType: string;
      name: string;
      description: string | null;
      city: string | null;
      notes?: string | null;
      /** Customer-facing section title (used by Vehicle rows). */
      taxCategory?: string | null;
      quantity: unknown;
      unitSellingPrice: unknown;
      /** Add-on master link; only present on actually-selected Add-on rows. */
      addOnServiceId?: string | null;
      /**
       * Quotation-owned snapshot of every master pricing option available
       * when the add-on was selected. Nullish for legacy rows (which render
       * exactly as before — Classic PDF never showed a single price).
       */
      pricingSnapshot?: Array<{
        id?: string;
        label?: string | null;
        price?: number | null;
        currency?: string | null;
      }> | null;
    }>;
    inclusions: Array<{ content: string }>;
    exclusions: Array<{ content: string }>;
    terms: Array<{ content: string }>;
    /** Quotation FAQs (same data as the public weblink accordion). */
    faqs?: Array<{ question: string; answer: string }> | null;
    /**
     * Single saved section order shared with the public weblink. When absent
     * the renderer falls back to the legacy PDF sequence.
     */
    weblinkSectionOrder?: unknown;
  };
  /** Hotel Master presentation fields, aligned to version.hotels. */
  hotelPresentations?: Array<{
    starCategory?: number | null;
    starRating?: number | string | null;
    address?: string | null;
    reviewLink?: string | null;
  } | null>;
  /** Server-resolved image bytes; every slot is optional and falls back cleanly. */
  images?: {
    cover?: Img;
    hotels?: Img[]; // aligned to version.hotels
    services?: Img[]; // aligned to version.services
    sightseeing?: Record<string, Img>; // keyed by sightseeingId
    /** Keyed by the activity snapshot image URL (matches the public weblink). */
    itinerary?: Record<string, Img>;
    /** Keyed by a quotation document id uploaded directly on an activity. */
    itineraryDocuments?: Record<string, Img>;
    airlines?: Record<string, Img>; // keyed by flight-segment airlineId
    flight?: Img;
    flights?: Array<{ description?: string | null; image: Img; url?: string }>;
    /** Destination Expert profile photo bytes. */
    expertProfile?: Img;
    /**
     * Stylish-only Day Wise Itinerary fallback, keyed by lower-cased
     * destination/city name (e.g. "singapore"). A day without its own image
     * shows its own destination's saved image instead of the single primary
     * cover. Only populated for Stylish PDFs; Classic ignores it.
     */
    destinationImages?: Record<string, Img>;
    /**
     * Stylish PDF Page 1 manual overrides. `page1Hero` replaces the
     * destination-master hero for the cover only; `page1Cards` replaces the
     * three sightseeing gallery images slot-by-slot (sparse entries fall back
     * to the calculated defaults). Never touches Classic PDF / weblink data.
     */
    page1Hero?: Img;
    page1Cards?: Img[];
  };
}

type FlightSegment = {
  airlineId?: string | null;
  airlineName?: string | null;
  flightNumber?: string | null;
  travelClass?: string | null;
  from?: string | null;
  to?: string | null;
  departureDate?: string | null;
  departureTime?: string | null;
  arrivalDate?: string | null;
  arrivalTime?: string | null;
  duration?: string | null;
  cabinLuggage?: string | null;
  checkInLuggage?: string | null;
  notes?: string | null;
};
type FlightJourney = {
  fromCity?: string | null;
  toCity?: string | null;
  /** Independently edited header route; falls back to fromCity/toCity when absent. */
  routeFrom?: string | null;
  routeTo?: string | null;
  segments?: FlightSegment[];
};
const formatClock12Hour = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) return value;
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
};
type FlightDetails = {
  include?: boolean;
  sectionTitle?: string | null;
  entryMode?: 'MANUAL' | 'IMAGE';
  imageDocumentId?: string | null;
  imageFileName?: string | null;
  images?: Array<{
    documentId: string;
    fileName?: string | null;
    description?: string | null;
    heading?: string | null;
  }>;
  journeyType?: string;
  outbound?: FlightJourney;
  returnJourney?: FlightJourney;
  flights?: Array<{
    bookmarkCode?: string | null;
    journeyType?: string;
    outbound?: FlightJourney;
    returnJourney?: FlightJourney;
  }>;
};
/** Every flight record in display order; legacy single-flight rows wrap into one. */
function flightRecordsOf(flightData: FlightDetails | null | undefined): Array<{
  bookmarkCode?: string | null;
  journeyType?: string;
  outbound?: FlightJourney;
  returnJourney?: FlightJourney;
}> {
  const normalized = normalizeFlightDetails(flightData) as FlightDetails | null | undefined;
  return normalized?.flights ?? [];
}
type SightActivity = {
  sightseeingId?: string | null;
  imageDocumentId?: string | null;
  /** True when the quotation owns this gallery, including an intentional empty one. */
  imageSnapshotPresent?: boolean;
  name?: string | null;
  description?: string | null;
  startTime?: string | null;
  showTime?: boolean;
  /** Snapshot image URL saved on the activity (may be a signed/private URL). */
  imageUrl?: string | null;
  /** Per-activity transfer; legacy rows fall back to the day-level value. */
  dailyTransfer?: string | null;
  /** Informational per-activity prices; absent on pre-feature snapshots. */
  pricingOptions?: Array<{ label?: string | null; price?: number | string | null }> | null;
};
type SightDay = {
  dayNumber?: number;
  title?: string | null;
  city?: string | null;
  date?: string | null;
  meals?: { breakfast?: boolean; lunch?: boolean; dinner?: boolean };
  /** Shared legacy meal mode; used only when a meal has no per-meal preference. */
  mealMode?: string | null;
  /** Per-meal independent mode + optional transfer details (matches weblink). */
  mealPreferences?: {
    breakfast?: { mode?: string | null; transferDetails?: string | null };
    lunch?: { mode?: string | null; transferDetails?: string | null };
    dinner?: { mode?: string | null; transferDetails?: string | null };
  };
  dailyTransfer?: string | null;
  activities?: SightActivity[];
};

/** Destination art is a legacy fallback, never a replacement for an emptied snapshot. */
export function pdfDayAllowsDestinationFallback(
  activities: readonly { imageSnapshotPresent?: boolean }[],
): boolean {
  return !activities.some((activity) => activity.imageSnapshotPresent === true);
}

/** Per-activity equivalent used by the Stylish renderer. */
export function pdfActivityImageOrCover<T>(
  activity: { imageSnapshotPresent?: boolean },
  image: T | null | undefined,
  cover: T | null | undefined,
): T | null {
  return image ?? (activity.imageSnapshotPresent === true ? null : (cover ?? null));
}

// ---- Page layout helpers (pure; exported for tests) -----------------------
export interface PdfPageLayout {
  pageHeight: number;
  contentBottom: number;
  footerTop: number;
}

/**
 * Content-aware page layout. The planner continues to use the A4 body limit,
 * but sparse pages shrink vertically after their measured body content. The
 * footer remains bottom-anchored on each individual physical page.
 */
export function computePageHeight(contentHeight: number): PdfPageLayout {
  const measuredContentHeight = Math.max(0, Math.min(contentHeight, PDF_MAX_CONTENT_HEIGHT));
  const contentBottom = TOP + measuredContentHeight;
  const requiredHeight = contentBottom + POST_GAP + FOOTER_H + BOTTOM_M;
  const pageHeight = Math.min(PDF_MAX_PAGE_HEIGHT, Math.max(PDF_MIN_PAGE_HEIGHT, requiredHeight));
  const footerTop = pageHeight - BOTTOM_M - FOOTER_H;
  return { pageHeight, contentBottom, footerTop };
}

/**
 * Largest font size (in 0.5 steps, ≤ startSize) at which `text` still fits on
 * ONE line within `maxWidth`. Used by the classic Package Total box: PDFKit
 * wraps long unbroken amounts (e.g. ₹1,90,00,000) mid-number when they exceed
 * the available width, so the amount is measured with the real bold font and
 * the size shrinks just enough to keep the whole figure — currency symbol
 * included — on a single line. Normal amounts return `startSize` unchanged.
 * Exported for tests.
 */
export function fitPackageTotalFontSize(
  doc: {
    font: (name: string) => unknown;
    fontSize: (size: number) => unknown;
    widthOfString: (text: string) => number;
  },
  text: string,
  maxWidth: number,
  startSize = 20,
  minSize = 8,
): number {
  doc.font('Bold');
  let size = startSize;
  while (size > minSize) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= maxWidth) break;
    size -= 0.5;
  }
  return size;
}

/** A measured, renderable block. render(y0) draws and returns the next y. */
interface PdfBlock {
  height: number;
  /** Keep this block with the following content (e.g. a section heading). */
  keepWithNext?: boolean;
  render: (y0: number) => number;
}

/** Packs measured blocks into pages, splitting only at block boundaries. */
class PagePlanner {
  private pages: Array<{ blocks: PdfBlock[]; height: number }> = [];
  private current: PdfBlock[] = [];
  private currentHeight = 0;

  add(block: PdfBlock | null | undefined): void {
    if (!block || block.height <= 0) return;
    if (this.currentHeight + block.height > PDF_MAX_CONTENT_HEIGHT && this.current.length > 0) {
      const kept: PdfBlock[] = [];
      while (this.current.length > 0) {
        const last = this.current[this.current.length - 1];
        if (!last?.keepWithNext) break;
        kept.unshift(last);
        this.current.pop();
        this.currentHeight -= last.height;
      }
      const keptHeight = kept.reduce((sum, b) => sum + b.height, 0);
      if (this.current.length > 0) {
        this.flush();
      }
      // Keep the retained heading group with the following block. A kept
      // group must never be flushed onto its own mostly-empty page (orphaned
      // heading / wasted space); callers pre-split oversized content so the
      // combined group stays within the page budget in practice.
      this.current = kept;
      this.currentHeight = keptHeight;
    }
    this.current.push(block);
    this.currentHeight += block.height;
  }

  flush(): void {
    if (!this.current.length) return;
    this.pages.push({ blocks: this.current, height: this.currentHeight });
    this.current = [];
    this.currentHeight = 0;
  }

  /** Force the next block onto a fresh measured page (section/page break). */
  pageBreak(): void {
    this.flush();
  }

  getPages(): Array<{ blocks: PdfBlock[]; height: number }> {
    this.flush();
    return this.pages;
  }
}

/**
 * Draw one footer body line as `Label: value`, guaranteeing the whole line
 * stays inside the given column rectangle. The value font is reduced (down to
 * FOOTER_VALUE_FONT_MIN) if the combined label+value would overflow, and any
 * remaining overflow is visually truncated with an ellipsis on a single line.
 * The value never bleeds into the next footer column.
 */
function drawFooterTextLine(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  colWidth: number,
) {
  if (!value) return;
  doc.font('Bold').fontSize(FOOTER_BODY_FONT).fillColor(DARK);
  const labelText = `${label}: `;
  const labelW = doc.widthOfString(labelText);
  const available = colWidth - labelW - 2;
  if (available <= 0) return;

  // Reduce ONLY the value font until it fits (or comes closest to fitting).
  let valueFont = FOOTER_BODY_FONT;
  doc.font('Body').fontSize(valueFont);
  while (valueFont > FOOTER_VALUE_FONT_MIN && doc.widthOfString(value) > available) {
    valueFont -= 0.5;
    doc.font('Body').fontSize(valueFont);
  }

  // Truncate visually with an ellipsis if it still exceeds the column width.
  let display = value;
  if (doc.widthOfString(display) > available) {
    const ellipsis = '…';
    const ellW = doc.widthOfString(ellipsis);
    let maxChars = display.length;
    while (maxChars > 1 && doc.widthOfString(display.slice(0, maxChars)) + ellW > available) {
      maxChars -= 1;
    }
    display = display.slice(0, maxChars).replace(/\s+$/, '') + ellipsis;
  }

  // Label (bold) then value (normal), both confined to the column rectangle,
  // rendered on a single line so it can never enter the next column.
  doc.font('Bold').fontSize(FOOTER_BODY_FONT).fillColor(DARK);
  doc.text(labelText, x, y, { width: labelW, height: 11, lineBreak: false });
  doc.font('Body').fontSize(valueFont).fillColor(MUTED);
  doc.text(display, x + labelW, y, {
    width: available,
    height: 11,
    ellipsis: true,
    lineBreak: false,
  });
}

/**
 * Draw the complete repeating company footer on one buffered physical page.
 * `footerTop` is the fixed bottom-anchored divider Y for every page
 * (pageHeight - bottomMargin - footerHeight), so the footer uses identical
 * coordinates on every page — cover, flight, hotel, itinerary, thank-you.
 * All content is confined to a fixed 4-column grid; nothing may touch or
 * overlap another column, and the Page badge sits on its own lower row.
 */
function drawPageFooter(
  doc: PDFKit.PDFDocument,
  company: QuotationPdfCompany | null | undefined,
  pageNumber: number,
  totalPages: number,
  footerTop: number,
  pageHeight: number,
) {
  doc.save();
  const footerInfoTop = footerTop + FOOTER_INFORMATION_Y_OFFSET;
  // Thin light-gray divider spanning the full usable content width.
  doc
    .lineWidth(0.8)
    .strokeColor(BORDER)
    .moveTo(M, footerInfoTop)
    .lineTo(PDF_PAGE_WIDTH - M, footerInfoTop)
    .stroke();

  const headingY = footerInfoTop + FOOTER_HEADING_Y_OFF;
  const line1Y = footerInfoTop + FOOTER_LINE_1_Y_OFF;
  const line2Y = footerInfoTop + FOOTER_LINE_2_Y_OFF;
  const line3Y = footerInfoTop + FOOTER_LINE_3_Y_OFF;

  // Company logo (contain/fit, aspect preserved; invalid/missing → omitted).
  if (company?.logo) {
    try {
      // @types/pdfkit omits the runtime-valid 'left'/'top' values; keep them via
      // a cast so the logo is top-left aligned and never stretched.
      doc.image(company.logo, LOGO_X, line1Y - 8, {
        fit: [LOGO_W, 46],
        align: 'left',
        valign: 'top',
      } as unknown as PDFKit.Mixins.ImageOption);
    } catch {
      // A broken logo never breaks the footer or shifts the page number.
    }
  }

  // Each footer section renders only when it has at least one real value, and
  // the visible sections reflow to fill the footer: with all three present the
  // original fixed widths are preserved exactly, and when any section is hidden
  // the remaining sections expand proportionally so no empty fixed-width column
  // is left behind.
  const cPhone = company ? toText(company.phone) : '';
  const cEmail = company ? toText(company.email) : '';
  const cWeb = company ? toText(company.website) : '';
  const contactVisible = Boolean(cPhone || cEmail || cWeb);

  const tripsVisible = company?.tripsSold != null;
  const estVisible = company?.operatingSinceYear != null;
  const achievementsVisible = tripsVisible || estVisible;

  const tan = company ? toText(company.tan) : '';
  const gstin = company ? toText(company.taxRegistrationNumber) : '';
  const legalVisible = Boolean(tan || gstin);

  const gridLeft = LOGO_X + LOGO_W + FOOTER_GUTTER;
  const gridRight = PDF_PAGE_WIDTH - M;
  const gridWidth = gridRight - gridLeft;
  // Original per-section widths (contact, achievements, legal) used when every
  // section is present; hidden sections donate their width to the visible ones.
  const origWidths = [145, 115, gridWidth - 145 - FOOTER_GUTTER - 115 - FOOTER_GUTTER] as const;
  const flags = [contactVisible, achievementsVisible, legalVisible] as const;
  const visibleIndices = flags
    .map((visible, index) => (visible ? index : -1))
    .filter((index) => index >= 0);
  const visibleCount = visibleIndices.length;
  const availableWidth = gridWidth - (visibleCount > 0 ? (visibleCount - 1) * FOOTER_GUTTER : 0);
  const origVisibleSum = visibleIndices.reduce((sum, index) => sum + origWidths[index]!, 0);

  let colX = gridLeft;
  const nextColumn = (index: number): { x: number; w: number } => {
    const w = (origWidths[index]! * availableWidth) / origVisibleSum;
    const r = { x: colX, w };
    colX += w + FOOTER_GUTTER;
    return r;
  };

  if (contactVisible) {
    const c = nextColumn(0);
    doc.fillColor(GREEN).font('Bold').fontSize(FOOTER_HEADING_FONT);
    doc.text('CONTACT US', c.x, headingY, { width: c.w, lineBreak: false });
    if (cPhone) drawFooterTextLine(doc, 'Ph', cPhone, c.x, line1Y, c.w);
    if (cEmail) drawFooterTextLine(doc, 'Em', cEmail, c.x, line2Y, c.w);
    if (cWeb) drawFooterTextLine(doc, 'Web', cWeb, c.x, line3Y, c.w);
  }

  // Our Achievements — rows aligned with the contact rows within its column.
  if (achievementsVisible) {
    const c = nextColumn(1);
    doc.fillColor(GREEN).font('Bold').fontSize(FOOTER_HEADING_FONT);
    doc.text('OUR ACHIEVEMENTS', c.x, headingY, { width: c.w, lineBreak: false });
    let ay = line1Y;
    if (tripsVisible) {
      doc
        .font('Body')
        .fontSize(FOOTER_BODY_FONT)
        .fillColor(MUTED)
        .text(`${toText(company?.tripsSold)} Trips Sold`, c.x, ay, {
          width: c.w,
          lineBreak: false,
        });
      ay += FOOTER_LINE_GAP;
    }
    if (estVisible) {
      doc
        .font('Body')
        .fontSize(FOOTER_BODY_FONT)
        .fillColor(MUTED)
        .text(`Est: ${toText(company?.operatingSinceYear)}`, c.x, ay, {
          width: c.w,
          lineBreak: false,
        });
    }
  }

  // Legal Info — rows aligned with the contact rows within its column.
  if (legalVisible) {
    const c = nextColumn(2);
    doc.fillColor(GREEN).font('Bold').fontSize(FOOTER_HEADING_FONT);
    doc.text('LEGAL INFO', c.x, headingY, { width: c.w, lineBreak: false });
    if (tan) drawFooterTextLine(doc, 'TAN', tan, c.x, line1Y, c.w);
    if (gstin) drawFooterTextLine(doc, 'GSTIN', gstin, c.x, line2Y, c.w);
  }

  // Page number badge — its own lower row, fixed bottom-right, below Legal.
  const label = `Page ${pageNumber}/${totalPages}`;
  doc.font('Bold').fontSize(9.5);
  const w = doc.widthOfString(label) + 26;
  const bx = PDF_PAGE_WIDTH - M - w;
  const by = pageHeight - PAGE_BADGE_H - PAGE_BADGE_BOTTOM_GAP;
  doc.save().roundedRect(bx, by, w, PAGE_BADGE_H, 5).fill(GREEN).restore();
  doc
    .fillColor('#ffffff')
    .text(label, bx, by + 6.5, { width: w, align: 'center', lineBreak: false });
  doc.restore();
}

export async function renderQuotationPdf(input: QuotationPdfInput): Promise<Buffer> {
  const q = input.quotation;
  const v = input.version;
  const company = input.company;
  const consultant = input.consultant;
  const currency = v.currency;
  const images = input.images ?? {};
  const pricing = resolveQuotationPricing({ version: v, quotation: q });
  const isSectionWisePricing = pricing.pricingMode === 'SECTION_WISE';

  // No automatic first page — every physical page is created by the measured
  // page helper below with its own content-based height.
  const doc = new PDFDocument({
    size: [PDF_PAGE_WIDTH, PDF_MAX_PAGE_HEIGHT],
    bufferPages: true,
    autoFirstPage: false,
    // The bottom margin reserves the footer zone: any text() auto-pagination
    // during body rendering stops at the footer boundary (never through it),
    // including on pages PDFKit creates itself mid-text.
    margins: { top: 0, right: 0, bottom: BOTTOM_M + FOOTER_H, left: 0 },
    info: { Title: v.title },
  });
  doc.registerFont('Body', DEJAVU_SANS);
  doc.registerFont('Bold', DEJAVU_SANS_BOLD);
  doc.font('Body');
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Each planned page retains A4 when content fills it, but sparse pages use a
  // shorter physical MediaBox. Store the per-page footer position for the
  // buffered footer pass and correct Page X/Y total.
  const pageMetrics: Array<{ pageHeight: number; footerTop: number }> = [];
  const addMeasuredPage = (contentHeight: number): void => {
    const layout = computePageHeight(contentHeight);
    doc.addPage({
      size: [PDF_PAGE_WIDTH, layout.pageHeight],
      margins: { top: 0, right: 0, bottom: BOTTOM_M + FOOTER_H, left: 0 },
    });
    pageMetrics.push({ pageHeight: layout.pageHeight, footerTop: layout.footerTop });
  };

  // --- measurement primitives -------------------------------------------------
  const hOf = (
    text: string,
    size: number,
    width: number,
    font: 'Body' | 'Bold' = 'Body',
  ): number => {
    doc.font(font).fontSize(size);
    return doc.heightOfString(text, { width });
  };

  /** A block that renders wrapped lines; measured with the exact font/size/width. */
  const flowBlock = (
    lines: string[],
    x: number,
    width: number,
    size: number,
    gap: number,
    color = '#333',
  ): PdfBlock => {
    doc.font('Body').fontSize(size);
    const heights = lines.map((line) => doc.heightOfString(line, { width }));
    const height = heights.reduce((sum, h) => sum + h + gap, 0);
    return {
      height,
      render: (y0) => {
        doc.font('Body').fontSize(size).fillColor(color);
        let yy = y0;
        for (const line of lines) {
          doc.text(line, x, yy, { width });
          yy = doc.y + gap;
        }
        doc.fillColor(DARK);
        return yy;
      },
    };
  };

  /**
   * PDFKit cannot retain colour layers from emoji fonts. For sightseeing rich
   * text, preserve normal PDF text layout while drawing the supported emoji as
   * small embedded colour PNGs at the same inline positions.
   */
  type InlinePart = { value: string; width: number; bold: boolean; emoji?: Buffer };
  type LineLayout = {
    rows: InlinePart[][];
    lineHeight: number;
    emojiSize: number;
    height: number;
  };

  /**
   * Lay out a single rich-text line into inline rows (emoji-aware) using the
   * exact measurement the render pass will use. Shared by the single-block and
   * page-splitting flow builders so measured and drawn text always match.
   */
  const layoutRichLine = (
    line: PdfRichTextLine,
    width: number,
    size: number,
    gap: number,
  ): LineLayout => {
    const parts: Array<{ value: string; bold: boolean; emoji?: Buffer }> = [];
    for (const run of line) {
      let cursor = 0;
      const matches = run.text.matchAll(pdfEmojiSequenceRegex());
      for (const match of matches) {
        if (match.index === undefined) continue;
        if (match.index > cursor) {
          run.text
            .slice(cursor, match.index)
            .split(/(\s+)/)
            .filter(Boolean)
            .forEach((value) => parts.push({ value, bold: run.bold }));
        }
        const png = colorEmojiPng(match[0]);
        parts.push({
          value: png ? match[0] : pdfEmojiFallback(match[0]),
          bold: run.bold,
          ...(png ? { emoji: png } : {}),
        });
        cursor = match.index + match[0].length;
      }
      if (cursor < run.text.length) {
        run.text
          .slice(cursor)
          .split(/(\s+)/)
          .filter(Boolean)
          .forEach((value) => parts.push({ value, bold: run.bold }));
      }
    }

    doc.font('Body').fontSize(size);
    const lineHeight = doc.heightOfString('Ag', { width });
    const emojiSize = Math.min(lineHeight * 0.94, size * 1.2);

    const measured = parts.map<InlinePart>((part) => ({
      ...part,
      width: part.emoji
        ? emojiSize
        : doc
            .font(part.bold ? 'Bold' : 'Body')
            .fontSize(size)
            .widthOfString(part.value),
    }));
    const rows: InlinePart[][] = [];
    let row: InlinePart[] = [];
    let rowWidth = 0;
    const finishRow = () => {
      while (row.length && /^\s+$/.test(row[row.length - 1]!.value)) row.pop();
      if (row.length) rows.push(row);
      row = [];
      rowWidth = 0;
    };
    const addPart = (part: InlinePart) => {
      const whitespace = /^\s+$/.test(part.value);
      if (whitespace && row.length === 0) return;
      if (row.length && rowWidth + part.width > width) finishRow();
      if (whitespace && row.length === 0) return;
      row.push(part);
      rowWidth += part.width;
    };

    for (const part of measured) {
      if (part.emoji || part.width <= width) {
        addPart(part);
        continue;
      }
      // Keep unusually long unbroken text inside the column.
      let chunk = '';
      let chunkWidth = 0;
      doc.font(part.bold ? 'Bold' : 'Body').fontSize(size);
      for (const character of Array.from(part.value)) {
        const characterWidth = doc.widthOfString(character);
        if (chunk && chunkWidth + characterWidth > width) {
          addPart({ value: chunk, width: chunkWidth, bold: part.bold });
          chunk = '';
          chunkWidth = 0;
        }
        chunk += character;
        chunkWidth += characterWidth;
      }
      if (chunk) addPart({ value: chunk, width: chunkWidth, bold: part.bold });
    }
    finishRow();

    return {
      rows,
      lineHeight,
      emojiSize,
      height: rows.length * lineHeight + gap,
    };
  };

  const colorEmojiFlowBlock = (
    lines: PdfRichTextLine[],
    x: number,
    width: number,
    size: number,
    gap: number,
    color = '#333',
  ): PdfBlock => {
    const layouts: LineLayout[] = lines.map((line) => layoutRichLine(line, width, size, gap));

    return {
      height: layouts.reduce((sum, layout) => sum + layout.height, 0),
      render: (y0) => {
        let yy = y0;
        for (const layout of layouts) {
          for (const row of layout.rows) {
            let xx = x;
            for (const part of row) {
              if (part.emoji) {
                // Preserve the Unicode character for selection/accessibility,
                // then cover the invisible glyph with its colour image.
                doc
                  .save()
                  .font(part.bold ? 'Bold' : 'Body')
                  .fontSize(size)
                  .fillOpacity(0)
                  .text(part.value, xx, yy, { lineBreak: false })
                  .restore();
                doc.image(part.emoji, xx, yy + (layout.lineHeight - layout.emojiSize) / 2, {
                  width: layout.emojiSize,
                  height: layout.emojiSize,
                });
              } else {
                doc
                  .font(part.bold ? 'Bold' : 'Body')
                  .fontSize(size)
                  .fillColor(color)
                  .text(part.value, xx, yy, { lineBreak: false });
              }
              xx += part.width;
            }
            yy += layout.lineHeight;
          }
          yy += gap;
        }
        doc.x = x;
        doc.y = yy;
        doc.fillColor(DARK).fillOpacity(1);
        return yy;
      },
    };
  };

  /**
   * Split rich-text lines into page-safe flow blocks, each at most `maxHeight`
   * tall. Long activity descriptions split at line/bullet boundaries so text
   * flows onto the next page instead of entering the footer area.
   */
  const colorEmojiFlowBlocks = (
    lines: PdfRichTextLine[],
    x: number,
    width: number,
    size: number,
    gap: number,
    maxHeight = PDF_MAX_CONTENT_HEIGHT,
    color = '#333',
  ): PdfBlock[] => {
    if (!lines.length) return [];
    const budget = Math.min(PDF_MAX_CONTENT_HEIGHT, maxHeight);
    const chunks: PdfRichTextLine[][] = [];
    let current: PdfRichTextLine[] = [];
    let currentHeight = 0;
    for (const line of lines) {
      const lineHeight = layoutRichLine(line, width, size, gap).height;
      if (current.length && currentHeight + lineHeight > budget) {
        chunks.push(current);
        current = [];
        currentHeight = 0;
      }
      current.push(line);
      currentHeight += lineHeight;
    }
    if (current.length) chunks.push(current);
    return chunks.map((chunk) => colorEmojiFlowBlock(chunk, x, width, size, gap, color));
  };

  /** Split wrapped lines into page-safe flow blocks. */
  const flowBlocks = (
    lines: string[],
    x: number,
    width: number,
    size: number,
    gap: number,
    maxBlockHeight = PDF_MAX_CONTENT_HEIGHT,
  ): PdfBlock[] => {
    if (!lines.length) return [];
    doc.font('Body').fontSize(size);
    const chunks: string[][] = [];
    let current: string[] = [];
    let currentHeight = 0;
    const budget = Math.min(PDF_MAX_CONTENT_HEIGHT, maxBlockHeight);
    const pushToChunks = (part: string) => {
      const partHeight = doc.heightOfString(part, { width }) + gap;
      if (current.length && currentHeight + partHeight > budget) {
        chunks.push(current);
        current = [];
        currentHeight = 0;
      }
      current.push(part);
      currentHeight += partHeight;
    };
    for (const line of lines) {
      // A single wrapped paragraph can be taller than a whole page (long
      // bullets/terms). Split it with the library's real wrapped-text height so
      // every flow block fits inside one page and can never run into the footer.
      const parts = splitWrappedToFit(line, width, budget);
      for (const part of parts) pushToChunks(part);
    }
    if (current.length) chunks.push(current);
    return chunks.map((chunk) => flowBlock(chunk, x, width, size, gap));
  };

  /**
   * Split one wrapped paragraph into sub-parts, each of which wraps to no more
   * than `maxHeight` for the current font/size at the given width. Uses the
   * library's real wrapped-text height measurement (same font/size/width the
   * block will be rendered with) via binary search over the longest fitting
   * prefix, preferring a whitespace boundary so the visual break looks natural.
   */
  const splitWrappedToFit = (text: string, width: number, maxHeight: number): string[] => {
    if (!text) return [];
    if (doc.heightOfString(text, { width }) <= maxHeight) return [text];
    const parts: string[] = [];
    let rest = text;
    while (rest) {
      if (doc.heightOfString(rest, { width }) <= maxHeight) {
        parts.push(rest);
        break;
      }
      let lo = 1;
      let hi = rest.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (doc.heightOfString(rest.slice(0, mid), { width }) <= maxHeight) lo = mid;
        else hi = mid - 1;
      }
      let splitAt = lo;
      const space = rest.lastIndexOf(' ', splitAt);
      if (space > splitAt * 0.4) splitAt = space;
      const part = rest.slice(0, splitAt).trimEnd();
      if (!part) {
        parts.push(rest);
        break;
      }
      parts.push(part);
      rest = rest.slice(splitAt).trimStart();
    }
    return parts;
  };

  // --- drawing primitives ----------------------------------------------------
  const money = (value: unknown, digits = 0) => moneyFmt(currency, value, digits);

  const drawImage = (buf: Img, x: number, iy: number, w: number, h: number, label = 'Image') => {
    if (buf) {
      try {
        doc.save();
        doc.roundedRect(x, iy, w, h, 6).clip();
        doc.image(buf, x, iy, { cover: [w, h], align: 'center', valign: 'center' });
        doc.restore();
        return;
      } catch {
        doc.restore();
      }
    }
    doc.save().roundedRect(x, iy, w, h, 6).fill(LGREEN).restore();
    doc
      .fillColor(GREEN)
      .font('Bold')
      .fontSize(9)
      .text(label, x, iy + h / 2 - 5, { width: w, align: 'center' });
    doc.fillColor(DARK);
  };

  /** Contain-fit image (used for logos) with a clean fallback. */
  const drawImageFit = (buf: Img, x: number, iy: number, w: number, h: number, label = 'Image') => {
    if (buf) {
      try {
        doc.save();
        doc.roundedRect(x, iy, w, h, 6).clip();
        doc.image(buf, x, iy, {
          fit: [w, h],
          align: 'center',
          valign: 'center',
        } as unknown as PDFKit.Mixins.ImageOption);
        doc.restore();
        return;
      } catch {
        doc.restore();
      }
    }
    drawImage(undefined, x, iy, w, h, label);
  };

  const checkCircle = (cx: number, cy: number, r: number) => {
    doc.save().circle(cx, cy, r).fill(GREEN).restore();
    doc
      .save()
      .lineWidth(2.2)
      .strokeColor('#ffffff')
      .moveTo(cx - r * 0.42, cy + r * 0.02)
      .lineTo(cx - r * 0.1, cy + r * 0.36)
      .lineTo(cx + r * 0.46, cy - r * 0.32)
      .stroke()
      .restore();
  };

  const badge = (text: string, x: number, by: number, bg: string, fg: string) => {
    doc.font('Bold').fontSize(10);
    const w = doc.widthOfString(text) + 18;
    doc.save().roundedRect(x, by, w, 20, 4).fill(bg).restore();
    doc.fillColor(fg).text(text, x + 9, by + 5.5);
    doc.fillColor(DARK);
    return w;
  };

  /** Section heading block (kept with following content). */
  const sectionHeaderBlock = (title: string): PdfBlock => {
    const h = 52;
    return {
      height: h,
      keepWithNext: true,
      render: (y0) => {
        checkCircle(M + 15, y0 + 15, 15);
        doc
          .fillColor(DARK)
          .font('Bold')
          .fontSize(21)
          .text(title.toUpperCase(), M + 42, y0 + 4);
        doc
          .save()
          .lineWidth(1)
          .strokeColor(BORDER)
          .moveTo(M + 42, y0 + 34)
          .lineTo(PDF_PAGE_WIDTH - M, y0 + 34)
          .stroke()
          .restore();
        doc.fillColor(DARK).font('Body').fontSize(11);
        return y0 + h;
      },
    };
  };

  const planner = new PagePlanner();

  // ==========================================================================
  // PAGE 1 — cover: hero, consultant, title, summary + pricing, yellow total,
  //          tax note, secure booking, services include (one measured page)
  // ==========================================================================
  const primaryDestination =
    (q.destinationSummary || '').split(/[•(→>,/]/)[0]?.trim() ||
    q.destinationSummary ||
    'Your Trip';

  const coverParts: PdfBlock[] = [];

  // 1. Hero image + overlay + destination name.
  {
    const heroH = 190;
    coverParts.push({
      height: heroH + 14,
      render: (y0) => {
        if (images.cover) {
          try {
            doc.save().roundedRect(M, y0, CONTENT_W, heroH, 6).clip();
            doc.image(images.cover, M, y0, {
              cover: [CONTENT_W, heroH],
              align: 'center',
              valign: 'center',
            });
            doc.restore();
          } catch {
            doc.restore();
            doc.save().roundedRect(M, y0, CONTENT_W, heroH, 6).clip();
            const grad = doc.linearGradient(M, y0, M + CONTENT_W, y0);
            grad.stop(0, DGREEN).stop(1, GREEN);
            doc.rect(M, y0, CONTENT_W, heroH).fill(grad);
            doc.restore();
          }
        } else {
          doc.save().roundedRect(M, y0, CONTENT_W, heroH, 6).clip();
          const grad = doc.linearGradient(M, y0, M + CONTENT_W, y0);
          grad.stop(0, DGREEN).stop(1, GREEN);
          doc.rect(M, y0, CONTENT_W, heroH).fill(grad);
          doc.restore();
        }
        doc.save().roundedRect(M, y0, CONTENT_W, heroH, 6).clip();
        doc.fillOpacity(1);
        const heroTitle = primaryDestination.toUpperCase();
        const heroTitleX = M + 18;
        const heroTitleY = y0 + heroH - 48;
        const heroTitleW = CONTENT_W - 36;
        // Subtle text shadow for readability over a photo — no background box.
        doc.save().font('Bold').fontSize(34);
        doc.fillOpacity(0.45).fillColor('#000000');
        doc.text(heroTitle, heroTitleX + 1.2, heroTitleY + 1.2, {
          width: heroTitleW,
          ellipsis: true,
          height: 30,
        });
        doc.restore();
        doc.save().font('Bold').fontSize(34).fillColor('#ffffff');
        doc.text(heroTitle, heroTitleX, heroTitleY, {
          width: heroTitleW,
          ellipsis: true,
          height: 30,
        });
        doc.restore();
        doc.restore();
        doc.fillOpacity(1);
        doc.fillColor(DARK);
        return y0 + heroH + 14;
      },
    });
  }

  // 2. Consultant / phone / email strip (missing values are omitted).
  const consultantItems: Array<[string, string]> = [];
  const cName = consultant ? toText(consultant.name) : '';
  const cPhone = consultant ? toText(consultant.phone) : '';
  const cEmail = consultant ? toText(consultant.email) : '';
  if (cName) consultantItems.push(['Consultant', cName]);
  if (cPhone) consultantItems.push(['Phone', cPhone]);
  if (cEmail) consultantItems.push(['Email', cEmail]);
  if (consultantItems.length) {
    const stripH = 32;
    coverParts.push({
      height: stripH + 12,
      render: (y0) => {
        doc.save().rect(M, y0, CONTENT_W, stripH).fill('#F2F3F5').restore();
        const itemW = CONTENT_W / consultantItems.length;
        consultantItems.forEach(([label, value], i) => {
          const ix = M + itemW * i + 12;
          doc
            .font('Bold')
            .fontSize(9)
            .fillColor(MUTED)
            .text(`${label}: `, ix, y0 + 11, {
              continued: true,
            });
          doc
            .font('Body')
            .fillColor(DARK)
            .text(value, { width: itemW - 24 });
        });
        doc.fillColor(DARK);
        return y0 + stripH + 12;
      },
    });
  }

  // 3. Package title.
  {
    const titleH = hOf(v.title.toUpperCase(), 20, CONTENT_W, 'Bold') + 14;
    coverParts.push({
      height: titleH,
      render: (y0) => {
        doc.font('Bold').fontSize(20).fillColor(DARK).text(v.title.toUpperCase(), M, y0, {
          width: CONTENT_W,
        });
        return y0 + titleH;
      },
    });
  }

  // 4. Two columns: summary (left) + pricing breakdown (right).
  const nights =
    q.durationNights && q.durationNights > 0
      ? q.durationNights
      : q.travelStartDate && q.travelEndDate
        ? Math.max(
            0,
            Math.round(
              (new Date(q.travelEndDate).getTime() - new Date(q.travelStartDate).getTime()) /
                86_400_000,
            ),
          )
        : 0;
  const duration = nights > 0 ? `${nights} Nights / ${nights + 1} Days` : '';
  const pax = [
    q.adults > 0 && `${q.adults} Adult${q.adults > 1 ? 's' : ''}`,
    q.childrenWithBed > 0 && `${q.childrenWithBed} CWB`,
    q.childrenWithoutBed > 0 && `${q.childrenWithoutBed} CWOB`,
    q.infants > 0 && `${q.infants} Infant${q.infants > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(', ');

  const summaryRows: Array<[string, string]> = [
    ['Name', q.customerName],
    // Destination/Master-country (e.g. "Malaysia"); the hero/primary heading and
    // city-specific sections keep using the city value.
    ['Destination', toText(q.destinations) || q.destinationSummary],
    ['Duration', duration],
    ['Travel Date', dateFmt(q.travelStartDate)],
    ['Pax', pax],
    // Child ages from the Lead, displayed directly under the Pax line. Omitted
    // entirely for legacy quotations without age data (never "undefined").
    ...(formatAgeList(q.childrenWithBedAges)
      ? [['CWB Ages', formatAgeList(q.childrenWithBedAges) as string]]
      : []),
    ...(formatAgeList(q.childrenWithoutBedAges)
      ? [['CWOB Ages', formatAgeList(q.childrenWithoutBedAges) as string]]
      : []),
    ...(formatInfantAgeList(q.infantAges)
      ? [['Infant Ages', formatInfantAgeList(q.infantAges) as string]]
      : []),
    ['Quotation ID', q.quotationNumber],
  ].filter(([, val]) => Boolean(val)) as Array<[string, string]>;

  const colGap = 20;
  const leftW = (CONTENT_W - colGap) * 0.52;
  const rightW = CONTENT_W - colGap - leftW;
  const rightX = M + leftW + colGap;

  // Measure summary rows.
  const summaryRowHeights = summaryRows.map(([label, val]) =>
    hOf(`${label}: ${val}`, 10, leftW, 'Bold'),
  );
  const leftColumnH = summaryRowHeights.reduce((sum, h) => sum + h + 4, 0);

  // Measure pricing rows + total box + tax note. Per-passenger rows only apply
  // to TOTAL pricing — section-wise pricing shows a single section total.
  const priceRows = pricing.pricingMode === 'SECTION_WISE'
    ? []
    : (
        [
          ['Per Adult', q.adults, v.perAdultPrice],
          ['CWB', q.childrenWithBed, v.perChildWithBedPrice],
          ['CWOB', q.childrenWithoutBed, v.perChildWithoutBedPrice],
          ['Infant', q.infants, v.perInfantPrice],
        ] as const
      ).filter(([, count, price]) => count > 0 && num(price) > 0);
  // The single authoritative PDF total, straight from the shared pricing
  // engine: the ACTIVE method's subtotal with discount → tax applied. Section
  // prices and traveler prices are never added together, and this number
  // always matches the builder's Summary & Pricing.
  const finalTotal = pricing.grandTotal;

  const priceRowHeights = priceRows.map(
    ([label, count, price]) =>
      Math.max(
        hOf(`${label} (x${count})`, 10, rightW * 0.55, 'Body'),
        hOf(money(num(price)), 10, rightW * 0.4, 'Bold'),
      ) + 4,
  );
  const totalBoxH = 48;
  const taxH = isPublicTaxNote(v.taxNote) ? hOf(v.taxNote.trim(), 8.5, rightW, 'Body') : 0;
  const taxBottomGap = taxH > 0 ? 6 : 0;
  const rightColumnH =
    priceRowHeights.reduce((sum, h) => sum + h, 0) + 4 + totalBoxH + 6 + taxH + taxBottomGap;
  const columnsH = Math.max(leftColumnH, rightColumnH);

  coverParts.push({
    height: columnsH,
    render: (y0) => {
      let ly = y0;
      summaryRows.forEach(([label, val], i) => {
        doc.font('Bold').fontSize(10).fillColor(MUTED).text(`${label}: `, M, ly, {
          continued: true,
        });
        doc.font('Body').fillColor(DARK).text(val, { width: leftW });
        ly = doc.y + 4;
        void summaryRowHeights[i];
      });
      let ry = y0;
      priceRows.forEach(([label, count, price]) => {
        doc
          .font('Body')
          .fontSize(10)
          .fillColor(MUTED)
          .text(`${label} (x${count})`, rightX, ry, {
            width: rightW * 0.55,
            continued: false,
          });
        doc
          .font('Bold')
          .fillColor(DARK)
          .text(money(num(price)), rightX, ry, {
            width: rightW,
            align: 'right',
          });
        ry = doc.y + 4;
      });
      ry += 4;
      // Total Cost card: subtle amber treatment with a single-line layout.
      doc
        .save()
        .lineWidth(1)
        .roundedRect(rightX, ry, rightW, totalBoxH, 7)
        .fillAndStroke('#FFF7DF', '#E6A300')
        .restore();
      doc
        .fillColor('#6B4B00')
        .font('Bold')
        .fontSize(9.5)
        .text(
          pricing.pricingMode === 'SECTION_WISE' ? 'TOTAL PRICE' : 'PACKAGE TOTAL',
          rightX + 22,
          ry + 18,
          {
            width: 82,
            lineBreak: false,
          },
        );
      // The complete amount is one visual unit and must never wrap mid-number
      // (PDFKit breaks long figures like ₹1,90,00,000 when they exceed the
      // column). Measure with the real bold font and shrink the size just
      // enough for one line; normal amounts keep the original 20pt rendering.
      const totalText = money(finalTotal);
      const totalMaxWidth = rightW - 118;
      const totalFontSize = fitPackageTotalFontSize(doc, totalText, totalMaxWidth);
      doc
        .fillColor(DARK)
        .font('Bold')
        .fontSize(totalFontSize)
        .text(totalText, rightX + 104, ry + Math.max(6, (totalBoxH - totalFontSize * 1.2) / 2), {
          width: totalMaxWidth,
          align: 'right',
          lineBreak: false,
        });
      doc.fillColor(DARK);
      ry += totalBoxH + 6;
      if (isPublicTaxNote(v.taxNote)) {
        doc.font('Body').fontSize(8.5).fillColor(MUTED).text(v.taxNote.trim(), rightX, ry, {
          width: rightW,
        });
        ry = doc.y;
        doc.fillColor(DARK).font('Body');
      }
      return y0 + columnsH;
    },
  });

  // 5. Secure Your Booking (no filled background, clickable Pay Now).
  const payUrl = validPaymentUrl(v.paymentLink);
  if (num(v.initialPaymentAmount) > 0 && payUrl) {
    const boxH = 66;
    coverParts.push({
      height: boxH + 16,
      render: (y0) => {
        doc.save().roundedRect(M, y0, CONTENT_W, boxH, 6).stroke(BORDER).restore();
        doc
          .fillColor(DGREEN)
          .font('Bold')
          .fontSize(13)
          .text('Secure Your Booking', M + 16, y0 + 12);
        doc
          .fillColor(DARK)
          .font('Body')
          .fontSize(10)
          .text(
            `Make an initial payment of ${money(v.initialPaymentAmount, 2)} to confirm your booking.`,
            M + 16,
            y0 + 32,
            { width: CONTENT_W - 160 },
          );
        doc
          .fillColor(MUTED)
          .fontSize(9)
          .text('The remaining balance can be paid as per the payment policy.', M + 16, y0 + 46, {
            width: CONTENT_W - 160,
          });
        const btnW = 108;
        const btnH = 30;
        const btnX = PDF_PAGE_WIDTH - M - btnW - 14;
        const btnY = y0 + boxH / 2 - btnH / 2;
        doc.save().roundedRect(btnX, btnY, btnW, btnH, 5).fill(GREEN).restore();
        doc
          .fillColor('#ffffff')
          .font('Bold')
          .fontSize(12)
          .text('Pay Now', btnX, btnY + 9, { width: btnW, align: 'center' });
        doc.link(btnX, btnY, btnW, btnH, payUrl);
        doc.fillColor(DARK);
        return y0 + boxH + 16;
      },
    });
  }

  // 6. Services Include.
  const flightData = v.flightDetails as FlightDetails | null | undefined;
  const flightImageMode = flightData?.entryMode === 'IMAGE';
  const sightData = v.sightseeingDetails as
    { include?: boolean; days?: SightDay[] } | null | undefined;
  // Hotels only render when included in the quotation (hotelDetails.include).
  const hotelIncluded = v.hotelDetails?.include !== false && v.hotels.length > 0;
  const flightRecords = flightRecordsOf(flightData);
  const hasFlights =
    !!flightData?.include &&
    (flightImageMode
      ? Boolean(flightData.imageDocumentId || flightData.images?.length)
      : flightRecords.some(
          (flight) =>
            (flight.outbound?.segments?.length ?? 0) > 0 ||
            (flight.returnJourney?.segments?.length ?? 0) > 0,
        ));
  const sightDays = (sightData?.include !== false ? (sightData?.days ?? []) : []).filter(
    (d) => d.title || (d.activities ?? []).some((a) => a.name || a.description),
  );
  const vehicleServices = v.services.filter((s) => s.serviceType === 'VEHICLE_TRANSFER');
  const cruiseServices = v.services.filter((s) => s.serviceType === 'CRUISE');
  // Add-ons only render when the top-level Add-on Services include flag is on.
  const addOnIncluded = v.addOnDetails?.include !== false;
  const addonServices = addOnIncluded
    ? v.services.filter((s) => ADDON_SERVICE_TYPES.has(s.serviceType) && Boolean(s.addOnServiceId))
    : [];
  const hasVisa =
    v.includeVisa &&
    (num(v.visaAmount) > 0 || num(v.visaServiceCharge) > 0 || !!v.visaType || !!v.visaDestination);

  const serviceChips = [
    hasFlights && 'Flights',
    hotelIncluded && 'Hotels',
    (sightDays.length > 0 || v.itinerary.length > 0) && 'Tours',
    vehicleServices.length > 0 && 'Transport',
    cruiseServices.length > 0 && 'Cruise',
    addonServices.length > 0 && 'Add-ons',
    hasVisa && 'Visa',
  ].filter(Boolean) as string[];
  if (serviceChips.length) {
    coverParts.push({
      height: 90,
      render: (y0) => {
        doc.font('Bold').fontSize(15).fillColor(DARK).text('SERVICES INCLUDE', M, y0, {
          width: CONTENT_W,
          align: 'center',
        });
        doc
          .save()
          .lineWidth(1)
          .strokeColor(BORDER)
          .moveTo(M, y0 + 24)
          .lineTo(PDF_PAGE_WIDTH - M, y0 + 24)
          .stroke()
          .restore();
        const cy = y0 + 52;
        const cols = serviceChips.length;
        const colW = CONTENT_W / cols;
        serviceChips.forEach((chip, i) => {
          const cx = M + colW * i + colW / 2;
          checkCircle(cx, cy, 13);
          doc
            .fillColor(DARK)
            .font('Bold')
            .fontSize(10)
            .text(chip, M + colW * i, cy + 22, {
              width: colW,
              align: 'center',
            });
        });
        return y0 + 90;
      },
    });
  }

  // The cover is one atomic page (never split mid-hero).
  {
    const coverH = coverParts.reduce((sum, b) => sum + b.height, 0);
    const coverBlock: PdfBlock = {
      height: coverH,
      render: (y0) => {
        let yy = y0;
        for (const part of coverParts) yy = part.render(yy);
        return yy;
      },
    };
    planner.add(coverBlock);
  }

  // Customer-facing introduction. The planner measures and splits the text,
  // so long copy cannot enter the footer or orphan the heading.
  const customerCopyLines = (value: string | null | undefined) =>
    (value ?? '')
      .split(/\r?\n/)
      .flatMap((line) => htmlToLines(line))
      .filter(Boolean);
  const introductionLines = customerCopyLines(v.introduction);
  if (v.introduction?.trim() && introductionLines.length) {
    planner.add(sectionHeaderBlock('Introduction'));
    flowBlocks(introductionLines, M, CONTENT_W, 10.5, 2).forEach((block) => planner.add(block));
  }

  // ==========================================================================
  // FLIGHTS — every flight record in order, each with its own journeys;
  // measured segment cards, continuation at boundaries
  // ==========================================================================
  const drawFlightsSection = () => {
    const segHasData = (s: FlightSegment) =>
      Boolean(s.airlineName || s.from || s.to || s.flightNumber);
    const legs = hasFlights
      ? flightRecords.flatMap((flight, flightIndex) => {
          const prefix = flightRecordPrefix(flightIndex, flightRecords.length);
          return [
            flight.journeyType === 'ONEWAY_RETURN'
              ? null
              : {
                  title: `${prefix}Outbound Journey`,
                  journey: flight.outbound,
                  color: BLUE,
                },
            flight.journeyType === 'ONEWAY_OUTBOUND'
              ? null
              : {
                  title: `${prefix}Return Journey`,
                  journey: flight.returnJourney,
                  color: GREEN,
                },
          ] as Array<{ title: string; journey?: FlightJourney; color: string } | null>;
        }).filter((l): l is { title: string; journey?: FlightJourney; color: string } => Boolean(l))
      : [];
    const drawableLegs = legs.filter((l) => (l.journey?.segments ?? []).some(segHasData));

    const buildSegmentCard = (s: FlightSegment, index: number): PdfBlock => {
      const noteLines = htmlToLines(s.notes);
      const padX = FLIGHT_CARD_PADDING_X;
      const padTop = FLIGHT_CARD_PADDING_TOP;
      const padBottom = FLIGHT_CARD_PADDING_BOTTOM;
      const badgeRowH = 20;
      const imageW = 120;
      const imageH = 64;
      const tlH = 64;
      const nameH = hOf(s.airlineName || 'Airline', 11, imageW + 4, 'Body');
      const numH = s.flightNumber ? hOf(s.flightNumber, 10, imageW + 4, 'Body') : 0;
      const leftColH = imageH + 6 + nameH + (numH ? 2 + numH : 0);
      const mainRowH = Math.max(leftColH, tlH);
      const baggageH = 14;
      const notesLabelH = noteLines.length ? 12 : 0;
      const notesWidth = CONTENT_W - padX * 2;
      const notesH = noteLines.length
        ? flowBlock(noteLines, M + padX, notesWidth, 10, 1).height
        : 0;
      const cardH =
        padTop +
        badgeRowH +
        FLIGHT_CARD_SECTION_GAP +
        mainRowH +
        FLIGHT_CARD_SECTION_GAP +
        1 + // divider
        FLIGHT_CARD_SECTION_GAP +
        baggageH +
        (noteLines.length
          ? FLIGHT_CARD_SECTION_GAP + notesLabelH + notesH + FLIGHT_CARD_SECTION_GAP
          : 0) +
        padBottom;

      return {
        height: cardH + FLIGHT_CARD_SEGMENT_GAP,
        render: (y0) => {
          const top = y0;
          doc.save().roundedRect(M, top, CONTENT_W, cardH, 6).stroke(BORDER).restore();
          badge(`Segment ${index + 1}`, M + padX, top + padTop, GREEN, '#ffffff');
          if (s.travelClass) {
            doc.font('Body').fontSize(10);
            const w = doc.widthOfString(`${s.travelClass} Class`) + 20;
            doc
              .save()
              .roundedRect(PDF_PAGE_WIDTH - M - 16 - w, top + padTop, w, 20, 4)
              .fill('#F2F3F5')
              .restore();
            doc
              .fillColor(DARK)
              .text(`${s.travelClass} Class`, PDF_PAGE_WIDTH - M - 16 - w + 10, top + padTop + 5.5);
          }
          const mainY = top + padTop + badgeRowH + FLIGHT_CARD_SECTION_GAP;
          // Airline logo / placeholder (contain-fit).
          const logo = s.airlineId ? images.airlines?.[s.airlineId] : undefined;
          drawImageFit(logo, M + padX, mainY, imageW, imageH, 'Airline');
          doc
            .fillColor(DARK)
            .font('Body')
            .fontSize(11)
            .text(s.airlineName || 'Airline', M + padX, mainY + imageH + 6, {
              width: imageW + 4,
            });
          if (s.flightNumber) {
            doc
              .fillColor(MUTED)
              .fontSize(10)
              .text(s.flightNumber, M + padX, doc.y + 2, {
                width: imageW + 4,
              });
          }
          // timeline
          const tlY = mainY;
          const depX = M + padX + imageW + 34;
          const arrX = PDF_PAGE_WIDTH - M - 90;
          const departureTime = s.departureTime ? formatClock12Hour(s.departureTime) : '--:--';
          const arrivalTime = s.arrivalTime ? formatClock12Hour(s.arrivalTime) : '--:--';
          // AM/PM makes some values wider than the original 24-hour text. Use a
          // shared fitted size so both ends stay aligned and never wrap into the
          // date row (for example, "10:00 AM").
          doc.font('Bold').fontSize(16);
          const widestTime = Math.max(
            doc.widthOfString(departureTime),
            doc.widthOfString(arrivalTime),
          );
          const flightTimeSize = Math.max(12, Math.min(16, (16 * 80) / widestTime));
          doc
            .fillColor(DARK)
            .fontSize(flightTimeSize)
            .text(departureTime, depX, tlY, { width: 80, lineBreak: false });
          doc
            .font('Body')
            .fontSize(9)
            .fillColor(MUTED)
            .text(dateFmt(s.departureDate), depX, tlY + 20, { width: 90 });
          doc.text((s.from || '').toUpperCase(), depX, tlY + 32, { width: 90 });
          doc
            .fillColor(DARK)
            .font('Bold')
            .fontSize(flightTimeSize)
            .text(arrivalTime, arrX, tlY, { width: 80, align: 'right', lineBreak: false });
          doc
            .font('Body')
            .fontSize(9)
            .fillColor(MUTED)
            .text(dateFmt(s.arrivalDate), arrX - 10, tlY + 20, { width: 90, align: 'right' });
          doc.text((s.to || '').toUpperCase(), arrX - 10, tlY + 32, { width: 90, align: 'right' });
          const lineY = tlY + 10;
          const lx1 = depX + 92;
          const lx2 = arrX - 18;
          doc
            .save()
            .lineWidth(2)
            .strokeColor(BORDER)
            .moveTo(lx1, lineY)
            .lineTo(lx2, lineY)
            .stroke()
            .restore();
          doc.save().circle(lx1, lineY, 4).fill(GREEN).restore();
          doc.save().circle(lx2, lineY, 4).fill(GREEN).restore();
          if (s.duration)
            doc
              .fillColor(MUTED)
              .font('Body')
              .fontSize(9)
              .text(s.duration, lx1, lineY + 6, { width: lx2 - lx1, align: 'center' });
          // divider
          const dividerY = mainY + mainRowH + FLIGHT_CARD_SECTION_GAP;
          doc
            .save()
            .lineWidth(0.7)
            .strokeColor(BORDER)
            .moveTo(M + padX, dividerY)
            .lineTo(PDF_PAGE_WIDTH - M - padX, dividerY)
            .stroke()
            .restore();
          // baggage
          const bagY = dividerY + FLIGHT_CARD_SECTION_GAP;
          const bag = [
            s.cabinLuggage && `Cabin: ${cabinLuggageLabel(s.cabinLuggage) ?? s.cabinLuggage}`,
            s.checkInLuggage && `Check-in: ${s.checkInLuggage}`,
          ]
            .filter(Boolean)
            .join('  •  ');
          doc
            .fillColor(DARK)
            .font('Body')
            .fontSize(10)
            .text(`Baggage: ${bag || '—'}`, M + padX, bagY, {
              width: CONTENT_W - padX * 2,
            });
          // notes
          if (noteLines.length) {
            const noteY = bagY + baggageH + FLIGHT_CARD_SECTION_GAP;
            doc
              .fillColor(MUTED)
              .font('Bold')
              .fontSize(10)
              .text('Note:', M + padX, noteY);
            const noteBlock = flowBlock(noteLines, M + padX, notesWidth, 10, 1);
            noteBlock.render(noteY + notesLabelH);
          }
          doc.fillColor(DARK);
          return y0 + cardH + FLIGHT_CARD_SEGMENT_GAP;
        },
      };
    };

    if (hasFlights && flightImageMode) {
      const flightImages = images.flights?.length
        ? images.flights
        : images.flight
          ? [{ description: null, image: images.flight }]
          : [];
      flightImages.forEach((item, index) => {
        const description = item.description?.trim() || '';
        planner.pageBreak();
        planner.add(sectionHeaderBlock(flightData?.sectionTitle || 'Flight Details'));
        if (description) {
          doc.font('Body').fontSize(10);
          const descriptionHeight = doc.heightOfString(description, { width: CONTENT_W });
          planner.add({
            height: descriptionHeight + 12,
            render: (y0) => {
              doc
                .font('Body')
                .fontSize(10)
                .fillColor(DARK)
                .text(description, M, y0, { width: CONTENT_W });
              return y0 + descriptionHeight + 12;
            },
          });
        }
        if (item.url)
          planner.add({
            height: 38,
            render: (y0) => {
              const buttonW = 82;
              const buttonH = 28;
              const buttonX = M + CONTENT_W - buttonW;
              doc.roundedRect(buttonX, y0, buttonW, buttonH, 6).fillAndStroke('#F8FAFC', BORDER);
              doc
                .font('Bold')
                .fontSize(9)
                .fillColor(BLUE)
                .text('Preview', buttonX + 12, y0 + 9, { width: 48 });
              doc
                .moveTo(buttonX + 63, y0 + 17)
                .lineTo(buttonX + 71, y0 + 9)
                .strokeColor(BLUE)
                .lineWidth(1.2)
                .stroke();
              doc
                .moveTo(buttonX + 66, y0 + 9)
                .lineTo(buttonX + 71, y0 + 9)
                .lineTo(buttonX + 71, y0 + 14)
                .stroke();
              doc.link(buttonX, y0, buttonW, buttonH, item.url!);
              doc.fillColor(DARK);
              return y0 + 38;
            },
          });
        planner.add({
          height: 500,
          render: (y0) => {
            drawImageFit(
              item.image,
              M,
              y0,
              CONTENT_W,
              480,
              description || `Flight itinerary ${index + 1}`,
            );
            return y0 + 500;
          },
        });
      });
    }

    if (!flightImageMode)
      drawableLegs.forEach((leg, legIndex) => {
        planner.pageBreak();
        if (legIndex === 0) planner.add(sectionHeaderBlock('Flight Details'));
        // Coloured journey bar.
        planner.add({
          height: 46 + 12,
          render: (y0) => {
            doc.save().roundedRect(M, y0, CONTENT_W, 46, 6).fill(leg.color).restore();
            doc
              .fillColor('#ffffff')
              .font('Bold')
              .fontSize(16)
              .text(leg.title, M + 16, y0 + 8);
            const route = [leg.journey?.routeFrom ?? leg.journey?.fromCity, leg.journey?.routeTo ?? leg.journey?.toCity].filter(Boolean).join(' > ');
            if (route)
              doc
                .font('Body')
                .fontSize(10)
                .text(route, M + 16, y0 + 28);
            doc.fillColor(DARK);
            return y0 + 46 + 12;
          },
        });
        const segs = (leg.journey?.segments ?? []).filter(segHasData);
        segs.forEach((s, i) => planner.add(buildSegmentCard(s, i)));
      });
  };
  // ==========================================================================
  // HOTELS — measured cards, continuation at card boundaries
  // ==========================================================================
  const drawHotelsSection = () => {
    if (hotelIncluded) {
      planner.pageBreak();
      planner.add(sectionHeaderBlock('Hotels'));
      const imageW = 150;
      const cardPadX = 14;
      const cardPadTop = 14;
      const cardPadBottom = 14;
      v.hotels.forEach((hotel, i) => {
        const tx = M + cardPadX + imageW + 16;
        const tw = PDF_PAGE_WIDTH - M - 14 - tx;
        const stayNights = hotelStayNights(hotel.checkInDate, hotel.checkOutDate) ?? hotel.nights;

        // Measure the text column height so the card never clips its content.
        doc.font('Bold').fontSize(15);
        const titleH = doc.heightOfString(hotel.hotelName, { width: tw });
        const stars = Number((hotel.category || '').match(/\d+/)?.[0] ?? 0);
        let textY = cardPadTop + titleH;
        if (stars > 0) textY += 16 + 4;
        // Keep the nights badge in the content flow, below the title/stars,
        // rather than pinning it against the hotel name.
        textY += 8 + 20 + 6;
        // Multi-room hotel options list EVERY room allocation and meal plan;
        // legacy single-room rows keep the exact historical line strings.
        const hotelRoomLines = resolveHotelRoomLines(hotel);
        const hotelMealLines = resolveHotelMealPlanLines(hotel);
        const multiRoom = hotelRoomLines.length > 1;
        const multiMeal = hotelMealLines.length > 1;
        const roomLineRows = multiRoom
          ? hotelRoomLines.flatMap((line, j) => {
              const name = (line.roomType ?? '').trim() || 'Room';
              const head = `${j + 1}. ${name}${line.rooms != null ? ` — Rooms: ${line.rooms}` : ''}`;
              // Counts only — the per-line price breakdown (Base/Extra/Child
              // × nights × rooms) is intentionally not shown to the customer.
              const details: string[] = [];
              if (line.extraBedQuantity)
                details.push(`Extra Bed: ${line.extraBedQuantity}`);
              if (line.childWithoutBedQuantity)
                details.push(`Child Without Bed: ${line.childWithoutBedQuantity}`);
              return [head, ...details.map((detail) => `    ${detail}`)];
            })
          : [];
        const mealLineRows = multiMeal
          ? hotelMealLines.map((line, j) => `Meal Plan ${j + 1}: ${(line.mealPlan ?? '').trim()}`)
          : [];
        const rows = [
          hotel.city && `City: ${hotel.city}`,
          ...(multiRoom
            ? roomLineRows
            : [
                hotel.roomType && `Room Type: ${hotel.roomType}`,
                ...(multiMeal ? [] : [hotel.mealPlan && `Meal Plan: ${hotel.mealPlan}`]),
                hotel.rooms != null && `Rooms: ${hotel.rooms}`,
              ]),
          ...(multiMeal
            ? mealLineRows
            : multiRoom
              ? [hotel.mealPlan && `Meal Plan: ${hotel.mealPlan}`]
              : []),
          hotel.checkInDate &&
            `Check-in: ${dateFmt(hotel.checkInDate)}${hotel.checkInTime?.trim() ? ` | ${formatClock12Hour(hotel.checkInTime)}` : ''}`,
          hotel.checkOutDate &&
            `Check-out: ${dateFmt(hotel.checkOutDate)}${hotel.checkOutTime?.trim() ? ` | ${formatClock12Hour(hotel.checkOutTime)}` : ''}`,
          ...(multiRoom
            ? []
            : [
                // Counts only — the per-line price breakdown (Base/Extra/Child
                // × nights × rooms) is intentionally not shown to the customer.
                (hotel as unknown as { extraBedQuantity?: number | null }).extraBedQuantity
                  ? `Extra Bed: ${(hotel as unknown as { extraBedQuantity: number }).extraBedQuantity}`
                  : null,
                (hotel as unknown as { childWithoutBedQuantity?: number | null }).childWithoutBedQuantity
                  ? `Child Without Bed: ${(hotel as unknown as { childWithoutBedQuantity: number }).childWithoutBedQuantity}`
                  : null,
              ]),
          // No per-hotel "Total" on the customer-facing classic PDF.
        ].filter(Boolean) as string[];
        doc.font('Body').fontSize(10);
        const rowHeights = rows.map((r) => doc.heightOfString(r, { width: tw }));
        const rowGap = 4;
        const textH = rowHeights.reduce((sum, h) => sum + h + rowGap, 0);
        const textBottom = textY + textH;

        // Card height = max(text bottom, image area minimum) + bottom padding.
        // The image stretches to the available height, so only a minimum keeps
        // the left column from collapsing on short cards.
        const minImageH = cardPadTop + 40;
        const cardH = Math.max(textBottom, minImageH) + cardPadBottom;
        planner.add({
          height: cardH + 12,
          render: (y0) => {
            const top = y0;
            doc.save().roundedRect(M, top, CONTENT_W, cardH, 6).stroke(BORDER).restore();
            drawImage(
              images.hotels?.[i],
              M + cardPadX,
              top + cardPadTop,
              imageW,
              cardH - cardPadTop - cardPadBottom,
              'Hotel',
            );
            let yy = top + cardPadTop;
            doc
              .fillColor(DARK)
              .font('Bold')
              .fontSize(15)
              .text(hotel.hotelName, tx, yy, { width: tw });
            yy = doc.y;
            if (stars > 0) {
              yy += 4;
              doc
                .fillColor(AMBER)
                .font('Bold')
                .fontSize(12)
                .text('★'.repeat(Math.min(5, stars)), tx, yy);
              yy = doc.y + 4;
            }
            yy += 8;
            // Dateless hotel options carry NULL nights: omit the badge rather
            // than printing an invented or "null" duration. Spacing is kept so
            // dated stays lay out exactly as before.
            if (stayNights != null) badge(`Nights: ${stayNights}`, tx, yy, GREEN, '#ffffff');
            yy += 26;
            doc.fillColor(MUTED).font('Body').fontSize(10);
            rows.forEach((r) => {
              doc.text(r, tx, yy, { width: tw });
              yy = doc.y + rowGap;
            });
            doc.fillColor(DARK);
            return y0 + cardH + 12;
          },
        });
      });
    }
  };
  // ==========================================================================
  // TOUR ITINERARY — day heading once, then one self-contained block per
  // activity with that activity's own image and transfer.
  const drawItinerarySection = () => {
    if (sightDays.length) {
      // The itinerary section starts on a fresh page; individual days flow
      // continuously so sparse days share pages instead of wasting a page each.
      planner.pageBreak();
      planner.add(sectionHeaderBlock('Tour Itinerary'));
      sightDays.forEach((day, i) => {
        const validActivities = (day.activities ?? []).filter((a) => a.name || a.description);
        // Day heading carries the canonical day prefix (same rule as the
        // Weblink): stored DAY prefixes render exactly, others receive
        // `DAY N |`. Per-activity blocks below keep their own names.
        const dayTitle =
          formatDayPrefixedTitle(day.dayNumber ?? i + 1, day.title) ??
          formatItineraryDayTitle(day.dayNumber ?? i + 1, null);
        const mealEntries = [
          ['breakfast', '(B) Breakfast'],
          ['lunch', '(L) Lunch'],
          ['dinner', '(D) Dinner'],
        ] as const;
        const meals = mealEntries
          .map(([key, label]) => {
            if (!day.meals?.[key]) return null;
            const pref = day.mealPreferences?.[key];
            const modeLabel = pdfMealModeLabel(pref, day.mealMode);
            return modeLabel ? `${label} (${modeLabel})` : label;
          })
          .filter(Boolean) as string[];

        const dayImage = resolveItineraryDayImage(day.activities ?? [], {
          document: (documentId) => images.itineraryDocuments?.[documentId],
          snapshot: (imageUrl) => images.itinerary?.[imageUrl],
          sightseeing: (sightseeingId) => images.sightseeing?.[sightseeingId],
          // An explicitly emptied quotation gallery must render the normal
          // placeholder, not silently replace the removed activity image with
          // the unrelated destination cover.
          destination: pdfDayAllowsDestinationFallback(day.activities ?? []) ? images.cover : null,
        });

        // Day heading: title + date + day-level meals, kept with the first
        // activity so a heading is never orphaned at the bottom of a page.
        {
          let headingH = hOf(dayTitle, 15, CONTENT_W, 'Bold');
          if (day.date) headingH += hOf(dateFmt(day.date, true), 10, CONTENT_W, 'Body') + 4;
          headingH += 6;
          if (meals.length) {
            doc.font('Bold').fontSize(12);
            headingH += 14 + meals.length * (hOf('x', 10.5, CONTENT_W - 10, 'Body') + 3);
          }
          planner.add({
            height: headingH + 10,
            keepWithNext: validActivities.length > 0,
            render: (y0) => {
              doc
                .fillColor(DARK)
                .font('Bold')
                .fontSize(15)
                .text(dayTitle, M, y0, { width: CONTENT_W });
              let yy = doc.y;
              if (day.date) {
                doc
                  .font('Body')
                  .fontSize(10)
                  .fillColor(MUTED)
                  .text(dateFmt(day.date, true), M, yy + 2, {
                    width: CONTENT_W,
                  });
                yy = doc.y + 6;
              }
              if (meals.length) {
                doc
                  .fillColor(DARK)
                  .font('Bold')
                  .fontSize(12)
                  .text('Meals Included:', M, yy + 4);
                doc.font('Body').fontSize(10.5).fillColor('#333');
                meals.forEach((m) => doc.text(m, M + 10, doc.y + 3, { width: CONTENT_W - 10 }));
                doc.fillColor(DARK);
              }
              return y0 + headingH + 10;
            },
          });
        }

        // One complete visual block per activity (own image, name, description,
        // start time and transfer), alternating the image side like the weblink.
        validActivities.forEach((a, ai) => {
          const imgLeft = ai % 2 === 0;
          const imgW = 190;
          const gap = 22;
          const imgX = imgLeft ? M : PDF_PAGE_WIDTH - M - imgW;
          const contentX = imgLeft ? M + imgW + gap : M;
          const contentW = CONTENT_W - imgW - gap;

          // Canonical activity image: snapshot imageUrl first, then the
          // sightseeing master image — exactly the weblink's per-activity source.
          const aImg =
            validActivities.length === 1
              ? dayImage
              : resolveItineraryActivityImage(a, {
                  document: (documentId) => images.itineraryDocuments?.[documentId],
                  snapshot: (imageUrl) => images.itinerary?.[imageUrl],
                  sightseeing: (sightseeingId) => images.sightseeing?.[sightseeingId],
                });
          const aTransfer = pdfTransferLabel(a.dailyTransfer ?? day.dailyTransfer);
          const aMeta =
            a.startTime ? `STARTS: ${formatClock12Hour(a.startTime)}` : '';

          let imgColH = imgW + 8;
          if (aMeta) imgColH += 22 + 8;

          const isDuplicateTitle = isItineraryActivityTitleDuplicate(day.title, a.name);
          const titleH = !isDuplicateTitle && a.name ? hOf(a.name, 12, contentW, 'Bold') + 3 : 0;
          const descLines = htmlToRichTextLines(a.description);
          const descBlock = colorEmojiFlowBlock(descLines, contentX, contentW, 10.5, 2);
          const transferH = aTransfer ? 6 + 20 + 6 : 0;

          // Informational prices use a compact two-column grid. The shared
          // measurement below is also used for rendering, so a wrapped label can
          // never collide with the next activity or footer.
          // Hidden when pricingMode is TOTAL — only show in SECTION_WISE.
          const aPrices = isSectionWisePricing ? pdfActivityPrices(a.pricingOptions) : [];
          // DISPLAY-ONLY pricing snapshot — never feeds totals.
          const aDisplayPrices = pdfDisplayPrices(
            (a as unknown as { displayPricing?: Array<{ label?: string | null; price?: number | string | null; enabled?: boolean }> | null }).displayPricing,
          );
          const pricingGap = 8;
          const pricingPadX = 8;
          const pricingPadY = 6;
          const pricingCols = 2;
          const pricingBoxW = (contentW - pricingGap) / pricingCols;
          const pricingInnerW = pricingBoxW - pricingPadX * 2;
          const pricingRows = Array.from(
            { length: Math.ceil(aPrices.length / pricingCols) },
            (_, rowIndex) =>
              aPrices.slice(rowIndex * pricingCols, rowIndex * pricingCols + pricingCols),
          );
          const pricingRowHeights = pricingRows.map((row) => {
            doc.font('Body').fontSize(8.5);
            const labelsH = row.map((price) =>
              doc.heightOfString(price.label, { width: pricingInnerW }),
            );
            doc.font('Bold').fontSize(10);
            const pricesH = row.map((price) =>
              doc.heightOfString(money(price.price), { width: pricingInnerW }),
            );
            return (
              Math.max(...row.map((_, index) => labelsH[index]! + 2 + pricesH[index]!), 0) +
              pricingPadY * 2
            );
          });
          const pricingGridH =
            pricingRowHeights.reduce((sum, height) => sum + height, 0) +
            Math.max(0, pricingRowHeights.length - 1) * pricingGap;
          const pricingH = aPrices.length
            ? 10 + hOf('PRICING', 9, contentW, 'Bold') + 4 + pricingGridH
            : 0;
          // Display pricing grid (always shown when present, regardless of pricingMode)
          const displayHeading = String((a as unknown as { displayPricingHeading?: unknown }).displayPricingHeading ?? '').trim() || 'PRICING';
          const displayRows = Array.from(
            { length: Math.ceil(aDisplayPrices.length / pricingCols) },
            (_, rowIndex) =>
              aDisplayPrices.slice(rowIndex * pricingCols, rowIndex * pricingCols + pricingCols),
          );
          const displayRowHeights = displayRows.map((row) => {
            doc.font('Body').fontSize(8.5);
            const labelsH = row.map((price) =>
              doc.heightOfString(price.label, { width: pricingInnerW }),
            );
            doc.font('Bold').fontSize(10);
            const pricesH = row.map((price) =>
              doc.heightOfString(money(price.price), { width: pricingInnerW }),
            );
            return (
              Math.max(...row.map((_, index) => labelsH[index]! + 2 + pricesH[index]!), 0) +
              pricingPadY * 2
            );
          });
          const displayGridH =
            displayRowHeights.reduce((sum, height) => sum + height, 0) +
            Math.max(0, displayRowHeights.length - 1) * pricingGap;
          const displayPricingH = aDisplayPrices.length
            ? 10 + hOf(displayHeading, 9, contentW, 'Bold') + 4 + displayGridH
            : 0;

          const textColH = titleH + descBlock.height + transferH + pricingH + displayPricingH;
          const blockH = Math.max(imgColH, textColH);

          // Shared body drawing: image, start time, title, optional inline
          // description, transfer badge and pricing. `height` is the measured
          // block height this render is drawn for, so the next y always matches
          // the planned layout and nothing is drawn past the block boundary.
          const drawActivityBody = (y0: number, withDesc: boolean, height: number): number => {
            const top = y0;
            drawImage(aImg, imgX, top, imgW, imgW, 'Activity');
            let underY = top + imgW + 8;
            if (aMeta) {
              doc.save().roundedRect(imgX, underY, imgW, 22, 4).fill('#F2F3F5').restore();
              doc
                .fillColor(DARK)
                .font('Bold')
                .fontSize(10)
                .text(aMeta, imgX, underY + 6, {
                  width: imgW,
                  align: 'center',
                });
              underY += 30;
            }
            let yy = top;
            if (!isDuplicateTitle && a.name) {
              doc
                .font('Bold')
                .fontSize(12)
                .fillColor(DARK)
                .text(a.name, contentX, yy, { width: contentW });
              yy = doc.y + 3;
            }
            if (withDesc) yy = descBlock.render(yy);
            if (aTransfer) {
              yy += 6;
              badge(aTransfer, contentX, yy, AMBER, DARK);
              yy += 26;
            }
            if (aPrices.length) {
              yy += 10;
              doc
                .font('Bold')
                .fontSize(9)
                .fillColor(MUTED)
                .text('PRICING', contentX, yy, { width: contentW });
              yy = doc.y + 4;
              pricingRows.forEach((row, rowIndex) => {
                const rowH = pricingRowHeights[rowIndex]!;
                row.forEach((price, colIndex) => {
                  const x = contentX + colIndex * (pricingBoxW + pricingGap);
                  doc
                    .save()
                    .roundedRect(x, yy, pricingBoxW, rowH, 3)
                    .fill('#F7F8FA')
                    .stroke(BORDER)
                    .restore();
                  doc
                    .font('Body')
                    .fontSize(8.5)
                    .fillColor(MUTED)
                    .text(price.label, x + pricingPadX, yy + pricingPadY, {
                      width: pricingInnerW,
                    });
                  const priceY = doc.y + 2;
                  doc
                    .font('Bold')
                    .fontSize(10)
                    .fillColor(DARK)
                    .text(money(price.price), x + pricingPadX, priceY, {
                      width: pricingInnerW,
                    });
                });
                yy += rowH + pricingGap;
              });
            }
            if (aDisplayPrices.length) {
              yy += 10;
              doc
                .font('Bold')
                .fontSize(9)
                .fillColor(MUTED)
                .text(displayHeading, contentX, yy, { width: contentW });
              yy = doc.y + 4;
              displayRows.forEach((row, rowIndex) => {
                const rowH = displayRowHeights[rowIndex]!;
                row.forEach((price, colIndex) => {
                  const x = contentX + colIndex * (pricingBoxW + pricingGap);
                  doc
                    .save()
                    .roundedRect(x, yy, pricingBoxW, rowH, 3)
                    .fill('#F7F8FA')
                    .stroke(BORDER)
                    .restore();
                  doc
                    .font('Body')
                    .fontSize(8.5)
                    .fillColor(MUTED)
                    .text(price.label, x + pricingPadX, yy + pricingPadY, {
                      width: pricingInnerW,
                    });
                  const priceY = doc.y + 2;
                  doc
                    .font('Bold')
                    .fontSize(10)
                    .fillColor(DARK)
                    .text(money(price.price), x + pricingPadX, priceY, {
                      width: pricingInnerW,
                    });
                });
                yy += rowH + pricingGap;
              });
            }
            return y0 + height;
          };

          // The whole activity fits one page: keep the atomic layout unchanged.
          if (blockH + 10 <= PDF_MAX_CONTENT_HEIGHT) {
            planner.add({
              height: blockH + 10,
              render: (y0) => drawActivityBody(y0, true, blockH + 10),
            });
            return;
          }
          // The description is longer than a page. Keep the image + title +
          // transfer + pricing together as a self-contained header (it sits with
          // the day heading, so the activity title and transfer badge are never
          // orphaned) and let the description bullets flow across page-safe
          // blocks. The header deliberately has NO keepWithNext: chaining it to
          // the first description chunk would overfill the page budget and push
          // bullets below the footer divider.
          const headerH = Math.max(imgColH, titleH + transferH + pricingH + displayPricingH) + 10;
          planner.add({
            height: headerH,
            render: (y0) => drawActivityBody(y0, false, headerH),
          });
          colorEmojiFlowBlocks(descLines, contentX, contentW, 10.5, 2).forEach((block) =>
            planner.add(block),
          );
        });
      });
    }
  };
  // ==========================================================================
  // VEHICLE / CRUISE / ADD-ONS
  // ==========================================================================
  const serviceIndex = (row: (typeof v.services)[number]) => v.services.indexOf(row);
  const buildServiceCard = (
    row: (typeof v.services)[number],
    fields: Array<[string, string | null | undefined]>,
    imgLabel: string,
  ): PdfBlock => {
    const baseH = 150;
    return {
      height: baseH + 8 + 6,
      render: (y0) => {
        const top = y0;
        doc.save().roundedRect(M, top, CONTENT_W, baseH, 6).stroke(BORDER).restore();
        const serviceImage = images.services?.[serviceIndex(row)];
        const drawServiceImage = row.serviceType === 'VEHICLE_TRANSFER' ? drawImageFit : drawImage;
        drawServiceImage(serviceImage, M + 14, top + 14, 150, baseH - 28, imgLabel);
        const tx = M + 180;
        const tw = PDF_PAGE_WIDTH - M - 14 - tx;
        doc
          .fillColor(DARK)
          .font('Bold')
          .fontSize(15)
          .text(row.name, tx, top + 16, { width: tw });
        doc.font('Body').fontSize(10).fillColor(MUTED);
        let fy = doc.y + 4;
        fields
          .filter(([, val]) => Boolean(val))
          .forEach(([label, val]) => {
            doc.fillColor(MUTED).text(`${label}: `, tx, fy, { continued: true });
            doc.fillColor(DARK).text(String(val), { width: tw });
            fy = doc.y + 2;
          });
        doc.fillColor(DARK);
        return y0 + baseH + 8;
      },
    };
  };
  const serviceDescriptionBlocks = (row: (typeof v.services)[number]): PdfBlock[] => {
    const plainDescLines = htmlToLines(row.description);
    if (!plainDescLines.length) return [];
    const hasEmoji = containsPdfEmoji(row.description ?? '');
    const richDescLines = hasEmoji ? htmlToRichTextLines(row.description) : [];
    const headingH = hOf('Description:', 10.5, CONTENT_W, 'Bold') + 4;
    return [
      {
        height: headingH,
        keepWithNext: true,
        render: (y0) => {
          doc.font('Bold').fontSize(10.5).fillColor(DARK).text('Description:', M, y0, {
            width: CONTENT_W,
          });
          return y0 + headingH;
        },
      },
      ...(hasEmoji
        ? colorEmojiFlowBlocks(richDescLines, M, CONTENT_W, 10.5, 2, 260)
        : flowBlocks(plainDescLines, M, CONTENT_W, 10.5, 2, 260)),
    ];
  };

  const drawTransportationSection = () => {
    if (vehicleServices.length) {
      planner.pageBreak();
      planner.add(sectionHeaderBlock(vehicleServices[0]?.taxCategory?.trim() || 'Transportation'));
      vehicleServices.forEach((row) => {
        planner.add(
          buildServiceCard(
            row,
            [
              ['Type', row.city],
              ['Usage', row.notes],
            ],
            'Vehicle',
          ),
        );
        serviceDescriptionBlocks(row).forEach((block) => planner.add(block));
      });
    }
  };
  const drawCruiseSection = () => {
    if (cruiseServices.length) {
      planner.pageBreak();
      planner.add(sectionHeaderBlock('Cruise Details'));
      cruiseServices.forEach((row) => {
        const cruiseNights = (row as unknown as { cruiseNights?: number | null }).cruiseNights;
        const duration = cruiseNights != null && Number(cruiseNights) > 0
          ? `${cruiseNights} Nights · ${Number(cruiseNights) + 1} Days`
          : toText(row.notes) || null;
        const roomLines = resolveCruiseRoomLines(row as unknown as Parameters<typeof resolveCruiseRoomLines>[0]);
        const cabin = roomLines.length
          ? roomLines.map((line, idx) => `${(line.roomType ?? '').trim() || 'Room'}${line.rooms !== 1 ? ` ×${line.rooms}` : ''}${roomLines.length > 1 ? ` (#${idx + 1})` : ''}`).join(' · ')
          : toText(row.city) || null;
        planner.add(
          buildServiceCard(
            row,
            [
              ['Duration', duration],
              ['Cabin', cabin],
            ],
            'Cruise',
          ),
        );
        serviceDescriptionBlocks(row).forEach((block) => planner.add(block));
      });
    }
  };
  const drawAddonsSection = () => {
    const hasAddonSection = addonServices.length > 0 || hasVisa;
    if (hasAddonSection) {
      planner.pageBreak();
      planner.add(sectionHeaderBlock('Add-on Services'));
      addonServices.forEach((row) => {
        const plainDescLines = htmlToLines(row.description);
        const hasEmoji = containsPdfEmoji(row.description ?? '');
        // One bordered card per add-on: single primary image (when resolved)
        // on the left, service name + description on the right, all inside the
        // same box. Geometry mirrors buildServiceCard (vehicle/cruise).
        const serviceImage = images.services?.[serviceIndex(row)] ?? null;
        const CARD_PAD = 14;
        const CARD_IMG_W = 150;
        const CARD_IMG_H = 110;
        const CARD_GAP = 16;
        const tx = serviceImage ? M + CARD_PAD + CARD_IMG_W + CARD_GAP : M + CARD_PAD;
        const tw = PDF_PAGE_WIDTH - M - CARD_PAD - tx;
        const nameH = hOf(row.name, 12, tw, 'Bold') + 3;
        const imgH = serviceImage ? CARD_IMG_H : 0;
        // Description budget left on a page once the card header is placed;
        // anything beyond the first fitting chunk flows as regular full-width
        // blocks after the card (same pagination model as activity headers).
        const descBudget =
          PDF_MAX_CONTENT_HEIGHT - CARD_PAD - Math.max(imgH, nameH) - 4 - CARD_PAD;
        const inCardDesc =
          plainDescLines.length || hasEmoji
            ? hasEmoji
              ? colorEmojiFlowBlocks(htmlToRichTextLines(row.description), tx, tw, 10.5, 2, descBudget)
              : flowBlocks(plainDescLines, tx, tw, 10.5, 2, descBudget)
            : [];
        const firstDesc = inCardDesc[0] ?? null;
        const restDesc = inCardDesc.slice(1);
        // Quotation-owned pricing snapshot as compact bordered tiles under the
        // description. Legacy rows (no snapshot) reserve nothing, so their
        // output is unchanged.
        const priceBoxes = addonPricingBoxes(row, v.currency);
        const priceH = addonPricingGridHeight(priceBoxes.length);
        const textH = nameH + (firstDesc ? 4 + firstDesc.height : 0) + priceH;
        const cardH = CARD_PAD + Math.max(imgH, textH) + CARD_PAD;
        if (!restDesc.length) {
          planner.add({
            height: cardH + 8,
            render: (y0) => {
              const top = y0;
              doc.save().roundedRect(M, top, CONTENT_W, cardH, 6).stroke(BORDER).restore();
              if (serviceImage)
                drawImage(serviceImage, M + CARD_PAD, top + CARD_PAD, CARD_IMG_W, CARD_IMG_H, 'Add-on service');
              let yy = top + CARD_PAD;
              doc
                .font('Bold')
                .fontSize(12)
                .fillColor(DARK)
                .text(row.name, tx, yy, { width: tw });
              yy += nameH;
              if (firstDesc) yy = firstDesc.render(yy + 4);
              if (priceBoxes.length) drawAddonPricingGrid(doc, priceBoxes, tx, yy + 8, tw);
              return top + cardH;
            },
          });
          planner.add({ height: 8, render: (y0) => y0 + 8 });
          return;
        }
        // Oversized description: bordered header card (image + name) keeps the
        // row identity together, the remainder flows as regular full-width
        // description blocks so nothing is clipped or pushed into the footer.
        const headerH = CARD_PAD + Math.max(imgH, nameH + priceH) + CARD_PAD;
        planner.add({
          height: headerH + 8,
          keepWithNext: true,
          render: (y0) => {
            const top = y0;
            doc.save().roundedRect(M, top, CONTENT_W, headerH, 6).stroke(BORDER).restore();
            if (serviceImage)
              drawImage(serviceImage, M + CARD_PAD, top + CARD_PAD, CARD_IMG_W, CARD_IMG_H, 'Add-on service');
            doc
              .font('Bold')
              .fontSize(12)
              .fillColor(DARK)
              .text(row.name, tx, top + CARD_PAD, { width: tw });
            if (priceBoxes.length)
              drawAddonPricingGrid(doc, priceBoxes, tx, top + CARD_PAD + nameH + 8, tw);
            return top + headerH;
          },
        });
        const descriptionBlocks = hasEmoji
          ? colorEmojiFlowBlocks(htmlToRichTextLines(row.description), M, CONTENT_W, 10.5, 2)
          : flowBlocks(plainDescLines, M, CONTENT_W, 10.5, 2);
        descriptionBlocks.forEach((block) => planner.add(block));
        // Visible vertical gap between cards. The planner positions blocks by
        // their render cursor (not reserved height), so the gap must be an
        // explicit spacer block — same pattern as the FAQ rows.
        planner.add({ height: 8, render: (y0) => y0 + 8 });
      });
      if (hasVisa) {
        const visaLines = [
          v.visaType && `Visa type: ${v.visaType}`,
          v.visaDestination && `Destination: ${v.visaDestination}`,
        ].filter(Boolean) as string[];
        const visaTitleH =
          hOf(
            v.visaSectionTitle || `${v.visaDestination ?? ''} Visa`.trim(),
            12,
            CONTENT_W,
            'Bold',
          ) + 3;
        planner.add({
          height: visaTitleH,
          render: (y0) => {
            doc
              .font('Bold')
              .fontSize(12)
              .fillColor(DARK)
              .text(v.visaSectionTitle || `${v.visaDestination ?? ''} Visa`.trim(), M, y0, {
                width: CONTENT_W,
              });
            return y0 + visaTitleH;
          },
        });
        flowBlocks(visaLines, M, CONTENT_W, 10.5, 2).forEach((block) => planner.add(block));
      }
    }
  };

  // ==========================================================================
  // CUSTOMER NOTES + POLICIES — notes deliberately sit immediately before the
  // policies block; both travel together when sections are reordered.
  // ==========================================================================
  const drawPoliciesSection = () => {
    const customerNoteLines = customerCopyLines(v.notes);
    if (customerNoteLines.length) {
      planner.add(sectionHeaderBlock('Notes for Customer'));
      flowBlocks(customerNoteLines, M, CONTENT_W, 10.5, 2).forEach((block) => planner.add(block));
    }

    // POLICIES — measured blocks split between list items
    // ==========================================================================
    const policyBlocks: Array<[string, string, string[]]> = [
      [
        'Inclusions',
        GREEN,
        v.inclusionsHtml
          ? htmlToLines(v.inclusionsHtml)
          : v.inclusions.map((r) => `• ${r.content}`),
      ],
      [
        'Exclusions',
        RED,
        v.exclusionsHtml
          ? htmlToLines(v.exclusionsHtml)
          : v.exclusions.map((r) => `• ${r.content}`),
      ],
      ['Child Policy', GREEN, htmlToLines(v.childPolicy)],
      ['Payment Policies', AMBER, htmlToLines(v.paymentPolicies)],
      ['Cancellation Policies', RED, htmlToLines(v.cancellationPolicies)],
      [
        'Booking Terms',
        BLUE,
        v.bookingTerms ? htmlToLines(v.bookingTerms) : v.terms.map((r) => `• ${r.content}`),
      ],
    ].filter((block) => (block[2] ?? []).length) as Array<[string, string, string[]]>;
    if (policyBlocks.length) {
      planner.pageBreak();
      const policiesTitleHeight = hOf('Policies', 22, CONTENT_W, 'Bold') + 14;
      planner.add({
        height: policiesTitleHeight,
        keepWithNext: true,
        render: (y0) => {
          doc.font('Bold').fontSize(22).fillColor(DARK).text('Policies', M, y0, {
            width: CONTENT_W,
            align: 'center',
          });
          return y0 + hOf('Policies', 22, CONTENT_W, 'Bold') + 14;
        },
      });
      policyBlocks.forEach(([title, col, lines], index) => {
        const sectionGap = index === 0 ? 0 : 16;
        const headingHeight = sectionGap + hOf(title.toUpperCase(), 14, CONTENT_W, 'Bold') + 4;
        planner.add({
          height: headingHeight,
          keepWithNext: true,
          render: (y0) => {
            const headingY = y0 + sectionGap;
            doc.font('Bold').fontSize(14).fillColor(col).text(title.toUpperCase(), M, headingY, {
              width: CONTENT_W,
            });
            return headingY + hOf(title.toUpperCase(), 14, CONTENT_W, 'Bold') + 4;
          },
        });
        // Measure every paragraph/bullet before drawing. The first item also
        // reserves the Policies title so neither heading can be orphaned.
        const itemBudget =
          PDF_MAX_CONTENT_HEIGHT - headingHeight - (index === 0 ? policiesTitleHeight : 0);
        lines.forEach((line) => {
          flowBlocks([line], M, CONTENT_W, 10.5, 2, itemBudget).forEach((block) =>
            planner.add(block),
          );
        });
      });
    }
  };

  // ==========================================================================
  // DESTINATION EXPERT — resolved server-side, same data as the weblink
  // ==========================================================================
  const drawDestinationExpertSection = () => {
    const expert = input.destinationExpert;
    if (expert?.fullName) {
      planner.pageBreak();
      planner.add(sectionHeaderBlock('Your Destination Expert'));

      const hasPhoto = Boolean(images.expertProfile);
      const introLines = htmlToLines(expert.customIntroduction || expert.bio);
      const textSize = 10.5;
      const textGap = 2;
      const imageW = 96;
      const imageH = 118;
      // The text column only reserves photo space when a photo was actually
      // resolved; without one the section renders as clean text (never an
      // empty image placeholder box).
      const textLeft = M + (hasPhoto ? imageW + 20 : 0);
      const rightW = CONTENT_W - (hasPhoto ? imageW + 20 : 0);

      const contactParts: Array<{ label: string; value: string; href: string }> = [];
      const waDigits = expert.whatsappNumber?.replace(/\D/g, '');
      const callDigits = expert.callNumber?.replace(/[^+\d]/g, '');
      if (expert.showWhatsapp !== false && waDigits) {
        contactParts.push({
          label: 'WhatsApp',
          value: expert.whatsappNumber || waDigits,
          href: `https://wa.me/${waDigits}`,
        });
      }
      if (expert.showCall !== false && callDigits) {
        contactParts.push({
          label: 'Call',
          value: expert.callNumber || callDigits,
          href: `tel:${callDigits}`,
        });
      }
      if (expert.showEmail !== false && expert.email) {
        contactParts.push({ label: 'Email', value: expert.email, href: `mailto:${expert.email}` });
      }
      // One clickable contact row per present value (WhatsApp/Call/Email).
      const contactRowH = 14;

      const nameH = 20;
      const headingH = expert.heading ? 16 : 0;

      // Photo + name + heading as one measured header block. The photo height
      // participates in the measurement so the reserved block is never shorter
      // than the image.
      const headerTextH = nameH + headingH + 4;
      const headerBlockH = Math.max(hasPhoto ? imageH : 0, headerTextH) + 6;
      planner.add({
        height: headerBlockH,
        render: (y0) => {
          if (hasPhoto) drawImage(images.expertProfile, M, y0, imageW, imageH, 'EXPERT');
          let yy = y0 + 2;
          doc.font('Bold').fontSize(16).fillColor(DARK);
          doc.text(expert.fullName.toUpperCase(), textLeft, yy, {
            width: rightW,
            lineBreak: false,
          });
          yy += nameH;
          if (expert.heading) {
            doc.font('Bold').fontSize(12).fillColor(GREEN);
            doc.text(expert.heading, textLeft, yy, { width: rightW, lineBreak: false });
          }
          doc.fillColor(DARK).font('Body').fontSize(11);
          return y0 + headerBlockH;
        },
      });

      // Introduction flows through the standard splitter so even a very long bio
      // paginates safely and can never be drawn into the footer area.
      flowBlocks(introLines, textLeft, rightW, textSize, textGap).forEach((block) =>
        planner.add(block),
      );

      if (contactParts.length) {
        const contactBlockH = contactParts.length * contactRowH + 8;
        planner.add({
          height: contactBlockH,
          render: (y0) => {
            let yy = y0;
            for (const part of contactParts) {
              const labelW = doc.widthOfString(`${part.label}: `);
              doc.font('Bold').fontSize(10).fillColor(GREEN);
              doc.text(`${part.label}: `, textLeft, yy, {
                width: labelW,
                height: 13,
                lineBreak: false,
              });
              doc.font('Body').fontSize(10).fillColor(BLUE);
              doc.text(part.value, textLeft + labelW, yy, {
                width: rightW - labelW,
                height: 13,
                lineBreak: false,
                link: part.href,
              });
              doc.fillColor(DARK);
              yy += contactRowH;
            }
            doc.font('Body').fontSize(11);
            return y0 + contactBlockH;
          },
        });
      }
    }
  };

  // ==========================================================================
  // FREQUENTLY ASKED QUESTIONS — plain question + answer blocks, not the
  // weblink accordion. Question is kept with its first answer lines; long
  // answers paginate via the existing flow-block splitting.
  // ==========================================================================
  const drawFaqsSection = () => {
    const faqRows = normalizeFaqs((v as unknown as { faqs?: unknown }).faqs);
    if (faqRows.length) {
      if (!input.destinationExpert?.fullName) planner.pageBreak();
      planner.add(sectionHeaderBlock('Frequently Asked Questions'));
      faqRows.forEach((faq, index) => {
        const questionText = `${index + 1}. ${faq.question}`;
        const qHeight = hOf(questionText, 12, CONTENT_W, 'Bold') + 4;
        planner.add({
          height: qHeight,
          keepWithNext: true,
          render: (y0) => {
            doc.font('Bold').fontSize(12).fillColor(GREEN);
            doc.text(questionText, M, y0, { width: CONTENT_W });
            doc.fillColor(DARK).font('Body').fontSize(11);
            return y0 + qHeight;
          },
        });
        flowBlocks(htmlToLines(faq.answer), M, CONTENT_W, 10.5, 3).forEach((block) =>
          planner.add(block),
        );
        planner.add({
          height: 8,
          render: (y0) => y0 + 8,
        });
      });
    }
  };

  // ==========================================================================
  // SECTION DISPATCH — one shared order for both PDF styles. The saved
  // weblink order drives the sequence; when nothing is saved the legacy PDF
  // layout is preserved exactly.
  // ==========================================================================
  const sectionDrawers: Partial<Record<QuotationPdfSectionId, () => void>> = {
    flights: drawFlightsSection,
    hotels: drawHotelsSection,
    itinerary: drawItinerarySection,
    transportation: drawTransportationSection,
    cruise: drawCruiseSection,
    addons: drawAddonsSection,
    policies: drawPoliciesSection,
    destinationExpert: drawDestinationExpertSection,
    faqs: drawFaqsSection,
    // 'services' has no dedicated classic-PDF section; it renders on the cover
    // "services include" strip and in the stylish style's Travel Services pages.
  };
  for (const id of resolveQuotationPdfSectionOrder(
    (v as unknown as { weblinkSectionOrder?: unknown }).weblinkSectionOrder,
  )) {
    sectionDrawers[id]?.();
  }

  // ==========================================================================
  // PRICE BREAKDOWN — professional pricing card (By Section). Hidden entirely
  // for By Traveler (per-person) quotations.
  // ==========================================================================
  if (pricing.pricingMode === 'SECTION_WISE') {
    const pricingHeading = (v as { pricingHeading?: string }).pricingHeading || 'Price Breakdown';
    const pricingSubheading =
      (v as { pricingSubheading?: string | null }).pricingSubheading || null;
    const pricingOrder = Array.isArray(
      (v as { pricingDisplayOrder?: unknown }).pricingDisplayOrder,
    )
      ? ((v as { pricingDisplayOrder?: unknown }).pricingDisplayOrder as string[])
      : null;
    const orderedSections = pricingOrder
      ? [...pricing.sections].sort((a, b) => {
          const ia = pricingOrder.indexOf(a.id);
          const ib = pricingOrder.indexOf(b.id);
          return (ia < 0 ? pricingOrder.length : ia) - (ib < 0 ? pricingOrder.length : ib);
        })
      : pricing.sections;

    planner.pageBreak();
    planner.add(sectionHeaderBlock(pricingHeading));
    if (pricingSubheading) {
      const h = hOf(pricingSubheading, 10, CONTENT_W, 'Body') + 4;
      planner.add({
        height: h,
        render: (y0: number) => {
          doc.font('Body').fontSize(10).fillColor(MUTED).text(pricingSubheading, M, y0, {
            width: CONTENT_W,
          });
          return y0 + h;
        },
      });
    }
    const pricingRow = (label: string, value: string, bold = false) => {
      const h =
        Math.max(
          hOf(label, 10.5, CONTENT_W * 0.6, bold ? 'Bold' : 'Body'),
          hOf(value, 10.5, CONTENT_W * 0.4, 'Bold'),
        ) + 6;
      return {
        height: h,
        render: (y0: number) => {
          doc
            .font(bold ? 'Bold' : 'Body')
            .fontSize(10.5)
            .fillColor(DARK)
            .text(label, M, y0, { width: CONTENT_W * 0.6 });
          doc.font('Bold').fillColor(DARK).text(value, M, y0, { width: CONTENT_W, align: 'right' });
          return y0 + h;
        },
      };
    };
    for (const section of orderedSections.filter((sectionRow) => sectionRow.amount > 0)) {
      if (section.id === 'flight') {
        const breakdown = getFlightPerTravelerBreakdown(
          (v as unknown as { flightDetails?: unknown }).flightDetails,
          {
            adults: Number((q as unknown as { adults?: unknown }).adults ?? 0),
            childrenWithBed: Number((q as unknown as { childrenWithBed?: unknown }).childrenWithBed ?? 0),
            childrenWithoutBed: Number((q as unknown as { childrenWithoutBed?: unknown }).childrenWithoutBed ?? 0),
            infants: Number((q as unknown as { infants?: unknown }).infants ?? 0),
          },
        );
        if (breakdown) {
          planner.add(pricingRow('Flights', money(section.amount), true));
          for (const row of breakdown) {
            planner.add(pricingRow(`${row.label}: ${row.count} × ${money(row.rate)}`, money(row.total)));
          }
          planner.add(pricingRow('Flight Total', money(section.amount), true));
          continue;
        }
      }
      planner.add(pricingRow(section.label, money(section.amount)));
    }
    // Subtotal → Discount → Tax → Grand Total (same pipeline as the builder).
    if (pricing.discountAmount > 0 || pricing.taxAmount > 0) {
      planner.add(pricingRow('Subtotal', money(pricing.sectionTotal), true));
    }
    if (pricing.discountAmount > 0) {
      planner.add(pricingRow('Discount', `- ${money(pricing.discountAmount)}`));
    }
    if (pricing.taxAmount > 0) {
      planner.add(pricingRow(`Tax${pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}`, money(pricing.taxAmount)));
    }
    planner.add(pricingRow('Grand Total', money(finalTotal), true));
  }

  // ==========================================================================
  // THANK YOU — content-sized final page
  // ==========================================================================
  {
    const boxW = 300;
    const boxH = 150;
    planner.pageBreak();
    const thankBlock: PdfBlock = {
      height: 30 + boxH + 20,
      render: (y0) => {
        const bx = (PDF_PAGE_WIDTH - boxW) / 2;
        const by = y0 + 30;
        doc.save().rect(bx, by, boxW, boxH).fill(TEAL).restore();
        doc
          .fillColor('#ffffff')
          .font('Bold')
          .fontSize(40)
          .text('THANK', bx, by + 30, { width: boxW, align: 'center' });
        doc.text('YOU', bx, by + 82, { width: boxW, align: 'center' });
        doc.fillColor(DARK);
        return y0 + 30 + boxH + 20;
      },
    };
    planner.add(thankBlock);
  }

  // ==========================================================================
  // RENDER — create each planned page with its measured height, draw blocks
  // ==========================================================================
  const planPages = planner.getPages();
  for (const page of planPages) {
    addMeasuredPage(page.height);
    let yy = TOP;
    for (const block of page.blocks) yy = block.render(yy);
  }

  // ==========================================================================
  // FOOTER PASS — the single shared footer on every physical page, using each
  // page's actual measured physical height.
  // ==========================================================================
  const range = doc.bufferedPageRange();
  const total = range.count;
  // The footer pass must add zero pages. PDFKit's text() creates a new page
  // whenever a footer line is positioned below the page's maxY, which happened
  // on sparse pages whose planned per-page metrics were misaligned with the
  // physical pages (the body pass can auto-create pages). Neutralize page
  // creation for the duration of the pass so no footer draw call can ever
  // paginate, then restore the real implementation.
  const realAddPage = doc.addPage.bind(doc);
  doc.addPage = (() => doc) as unknown as typeof doc.addPage;
  try {
    for (let i = 0; i < total; i += 1) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // critical: prevents auto-pagination
      // Anchor the footer to the ACTUAL physical page height (not the planned
      // per-page metrics array), so every footer element stays inside the page
      // bounds and never flows onto a new page.
      const pageHeight = doc.page.height;
      const footerTop = pageHeight - BOTTOM_M - FOOTER_H;
      drawPageFooter(doc, company, i + 1, total, footerTop, pageHeight);
    }
  } finally {
    doc.addPage = realAddPage;
  }
  const pageCountAfterFooter = doc.bufferedPageRange().count;
  if (pageCountAfterFooter !== total) {
    throw new Error(
      `Quotation PDF footer changed page count (${total} -> ${pageCountAfterFooter})`,
    );
  }

  doc.end();
  return done;
}

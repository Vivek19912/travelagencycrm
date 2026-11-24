import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {
  formatAgeList,
  formatInfantAgeList,
  flightRecordPrefix,
  isItineraryActivityTitleDuplicate,
  isPublicTaxNote,
  normalizeFaqs,
  normalizeFlightDetails,
  resolveCruiseRoomLines,
  resolveHotelMealPlanLines,
  resolveHotelRoomLines,
  resolveQuotationPdfSectionOrder,
  resolveQuotationPricing,
  getFlightPerTravelerBreakdown,
  stripItineraryDayPrefixes,
  type QuotationPdfSectionId,
} from '@interscale/shared';
import {
  colorEmojiPng,
  containsPdfEmoji,
  pdfEmojiFallback,
  splitPdfEmojiSequences,
} from '../../services/pdf/color-emojis.js';
import { DEJAVU_SANS, DEJAVU_SANS_BOLD } from '../../services/pdf/fonts.js';
import { ROBOTO_BOLD } from '../../services/pdf/roboto-bold.js';
import {
  computePageHeight,
  htmlToLines,
  htmlToRichTextLines,
  PDF_TOP_MARGIN,
  type PdfRichTextLine,
  type QuotationPdfInput,
  addonPricingBoxes,
  addonPricingGridHeight,
  drawAddonPricingGrid,
  type AddonPricingBox,
} from './pdf.service.js';

const W = 595.28;
const H = 841.89;
const M = 42;
const CONTENT_W = W - M * 2;
// Usable body bottom on a full-height (A4) content page. The footer divider is
// drawn (H - 769) points above the bottom of every page, and body content keeps
// the existing 13pt gap above that divider (769 - 756).
const BODY_BOTTOM = 756;
const FOOTER_RESERVE = H - 769;
const BODY_FOOTER_GAP = 769 - BODY_BOTTOM;
const NAVY = '#17386f';
const NAVY_DARK = '#10254d';
const GOLD = '#fdbb16';
const TEAL = '#0a6f98';
const GREEN = '#0ea36d';
const RED = '#d93045';
// Pink-red cross marker for Stylish exclusion bullets.
const PINK = '#e5487f';
const INK = '#161b22';
const MUTED = '#687487';
const LINE = '#d7e0ec';
const PALE_BLUE = '#eaf0f8';

// ── Stylish itinerary – text inset for day descriptions ──────────
const ITIN_TEXT_LEFT = M + 27;
// Natural whitespace between consecutive days sharing one page.
const ITIN_DAY_GAP = 24;

const PAGE_HEADER_ASSET = [
  resolve(process.cwd(), 'apps/api/src/assets/stylish-pdf-page-header.png'),
  resolve(process.cwd(), 'src/assets/stylish-pdf-page-header.png'),
].find((path) => existsSync(path));
const PAGE_HEADER_IMAGE = PAGE_HEADER_ASSET ? readFileSync(PAGE_HEADER_ASSET) : null;

const loadStylishServiceIcon = (name: string): Buffer | null => {
  const path = [
    resolve(process.cwd(), `apps/api/src/assets/stylish-services/${name}.png`),
    resolve(process.cwd(), `src/assets/stylish-services/${name}.png`),
  ].find((candidate) => existsSync(candidate));
  return path ? readFileSync(path) : null;
};

const STYLISH_SERVICE_ICONS = {
  Flights: loadStylishServiceIcon('flights'),
  Hotels: loadStylishServiceIcon('hotels'),
  Tours: loadStylishServiceIcon('tours'),
  Transport: loadStylishServiceIcon('transport'),
  Cruise: loadStylishServiceIcon('cruise'),
  'Add-ons': loadStylishServiceIcon('add-ons'),
} as const;

const loadStylishOverviewIcon = (name: string): Buffer | null => {
  const path = [
    resolve(process.cwd(), `apps/api/src/assets/stylish-overview/${name}.png`),
    resolve(process.cwd(), `src/assets/stylish-overview/${name}.png`),
  ].find((candidate) => existsSync(candidate));
  return path ? readFileSync(path) : null;
};

const STYLISH_OVERVIEW_ICONS = {
  destination: loadStylishOverviewIcon('destination'),
  guest: loadStylishOverviewIcon('guest'),
  duration: loadStylishOverviewIcon('duration'),
  travelDate: loadStylishOverviewIcon('travel-date'),
  travelers: loadStylishOverviewIcon('travelers'),
  pricePerson: loadStylishOverviewIcon('price-person'),
  payment: loadStylishOverviewIcon('payment'),
} as const;

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

const formatClock12Hour = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  if (hour < 0 || hour > 23) return value;
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
};

type SightActivity = {
  sightseeingId?: string | null;
  imageDocumentId?: string | null;
  /** True when the quotation owns this gallery, including an intentional empty one. */
  imageSnapshotPresent?: boolean;
  name?: string | null;
  description?: string | null;
  startTime?: string | null;
  showTime?: boolean;
  duration?: string | null;
  imageUrl?: string | null;
  dailyTransfer?: string | null;
};

type SightDay = {
  dayNumber?: number;
  title?: string | null;
  city?: string | null;
  date?: string | null;
  dailyTransfer?: string | null;
  meals?: { breakfast?: boolean; lunch?: boolean; dinner?: boolean };
  mealMode?: string | null;
  mealsText?: string | null;
  activities?: SightActivity[];
};

type PdfImage = Buffer | null | undefined;

/**
 * Largest display size (in 2pt steps, ≤ startSize, ≥ minSize) at which `text`
 * still fits within `maxWidth`. Keeps long lead names on the cover hierarchy
 * without overlapping the logo or hero focal point.
 */
export function fitDisplaySize(
  measure: (text: string, size: number) => number,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
): number {
  let size = startSize;
  while (size > minSize && measure(text, size) > maxWidth) size -= 2;
  return size;
}

/** Minimal activity shape for Page 1 gallery selection (cover-only). */
export type StylishPage1CardActivity = {
  sightseeingId?: string | null;
  imageDocumentId?: string | null;
  imageUrl?: string | null;
};

export type StylishPage1CardImages = {
  itineraryDocuments?: Record<string, PdfImage>;
  itinerary?: Record<string, PdfImage>;
  sightseeing?: Record<string, PdfImage>;
} | null | undefined;

/**
 * First usable image from three DIFFERENT sightseeing activities, in day
 * order with a day offset: itineraries longer than three days start at Day 2
 * (Day 1 is never used as a card fallback), while three-day and shorter
 * itineraries start at Day 1. Each activity row counts as different; the same
 * master linked twice is only used once. Days without a usable image are
 * skipped in favour of subsequent days. No cover fallback, no fabrication,
 * no duplication — fewer than three usable images yields fewer cards.
 */
export function resolveStylishPage1DefaultCards(
  days: Array<{ activities?: StylishPage1CardActivity[] | null } | null> | null | undefined,
  images: StylishPage1CardImages,
): Buffer[] {
  const list = days ?? [];
  const usable = list.length > 3 ? list.slice(1) : list;
  const out: Buffer[] = [];
  const seen = new Set<string>();
  let position = 0;
  for (const day of usable) {
    for (const activity of day?.activities ?? []) {
      position += 1;
      if (out.length >= 3 || !activity) break;
      const key = activity.sightseeingId?.trim()
        ? `master:${activity.sightseeingId.trim()}`
        : `row:${position}`;
      if (seen.has(key)) continue;
      const bytes =
        (activity.imageDocumentId
          ? images?.itineraryDocuments?.[activity.imageDocumentId]
          : null) ??
        (activity.imageUrl ? images?.itinerary?.[activity.imageUrl] : null) ??
        (activity.sightseeingId ? images?.sightseeing?.[activity.sightseeingId] : null);
      if (!bytes) continue;
      seen.add(key);
      out.push(bytes);
    }
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Merge calculated defaults with per-slot CUSTOM overrides. Sparse overrides
 * fall back to the default in that slot; missing defaults render as null
 * (empty placeholder, never a duplicate or caption).
 */
export function resolveStylishPage1Cards(
  defaults: Buffer[],
  overrides?: Array<Buffer | null | undefined>,
): Array<Buffer | null> {
  return [0, 1, 2].map((slot) => overrides?.[slot] ?? defaults[slot] ?? null);
}

const prepareStylishLogo = async (value: Buffer): Promise<Buffer> => {
  try {
    const { data, info } = await sharp(value)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const background = { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 };
    const purpleBackground =
      background.b > background.r &&
      background.r > background.g * 1.35 &&
      background.b > background.g * 1.7;
    if (!purpleBackground || info.channels !== 4) return value;

    for (let index = 0; index < data.length; index += 4) {
      const distance = Math.hypot(
        (data[index] ?? 0) - background.r,
        (data[index + 1] ?? 0) - background.g,
        (data[index + 2] ?? 0) - background.b,
      );
      if (distance < 48) data[index + 3] = 0;
      else if (distance < 78) data[index + 3] = Math.round(((distance - 48) / 30) * 255);
    }

    return await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
      .png()
      .toBuffer();
  } catch {
    return value;
  }
};

const prepareStylishOverviewIcon = async (value: Buffer | null): Promise<Buffer | null> => {
  if (!value) return null;
  try {
    const { data, info } = await sharp(value)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) return value;
    const background = { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 };
    for (let index = 0; index < data.length; index += 4) {
      const distance = Math.hypot(
        (data[index] ?? 0) - background.r,
        (data[index + 1] ?? 0) - background.g,
        (data[index + 2] ?? 0) - background.b,
      );
      if (distance < 8) data[index + 3] = 0;
      else if (distance < 28) data[index + 3] = Math.round(((distance - 8) / 20) * 255);
    }
    return await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
  } catch {
    return value;
  }
};

const clean = (value: unknown): string => String(value ?? '').trim();

/**
 * Collapse a duplicated trailing word group in a resolved package name:
 * "Spiti Valley Tour Package Package" → "Spiti Valley Tour Package".
 * Version titles built as "<destination> Package for <customer>" duplicate
 * the suffix when the destination value already ends with it. The comparison
 * is case-insensitive and repeats until stable; legitimate names without a
 * repeated tail pass through exactly.
 */
const collapseTrailingDuplicateWords = (value: string): string => {
  let words = value.split(/\s+/).filter(Boolean);
  for (;;) {
    let collapsed = false;
    for (let size = Math.floor(words.length / 2); size >= 1; size -= 1) {
      const tail = words.slice(-size).join(' ').toLowerCase();
      const prev = words.slice(-size * 2, -size).join(' ').toLowerCase();
      if (tail && tail === prev) {
        words = words.slice(0, -size);
        collapsed = true;
        break;
      }
    }
    if (!collapsed) return words.join(' ');
  }
};

const asNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value: unknown, currency: string, digits = 0): string => {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(asNumber(value));
  } catch {
    return `${currency} ${asNumber(value).toLocaleString('en-IN')}`;
  }
};

const date = (value: Date | string | null | undefined, withWeekday = false): string => {
  if (!value) return 'As advised';
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return clean(value);
  return parsed.toLocaleDateString('en-GB', {
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const durationLabel = (
  itineraryNights: number | null | undefined,
  start: Date | null,
  end: Date | null,
): string => {
  const nights =
    itineraryNights && itineraryNights > 0
      ? itineraryNights
      : start && end
        ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
        : null;
  if (nights === null) return 'As advised';
  return `${nights} Nights / ${nights + 1} Days`;
};

const transferLabel = (value: string | null | undefined): string | null => {
  if (value === 'PRIVATE') return 'Private Transfer';
  if (value === 'SHARED') return 'Shared Transfer';
  if (value === 'NO_TRANSFER') return 'No Transfer';
  return null;
};

const serviceLabel = (value: string): string =>
  ({
    FLIGHT: 'Flights',
    HOTEL: 'Hotels',
    SIGHTSEEING: 'Tours',
    TRANSFER: 'Transport',
    VEHICLE: 'Transport',
    VEHICLE_TRANSFER: 'Transport',
    CRUISE: 'Cruise',
    VISA: 'Visa',
    ADD_ON: 'Add-ons',
    OTHER_ADD_ON: 'Add-ons',
    TRAVEL_INSURANCE: 'Insurance',
  })[value] ?? value.replaceAll('_', ' ');

/**
 * TravelEnfield-style quotation renderer. Its geometry intentionally follows
 * the supplied TCPDF references: scrapbook headers, compact navy information
 * cards, one itinerary activity per page, legal footer grid and dark closing
 * page. It remains data-driven so every CRM quotation can use the same design.
 */
export async function renderStylishQuotationPdf(input: QuotationPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    compress: true,
    margin: 0,
    info: {
      Title: input.version.title,
      Author: input.company?.name ?? 'Travel CRM',
      Creator: input.company?.name ?? 'Travel CRM',
    },
  });
  doc.registerFont('Body', DEJAVU_SANS);
  doc.registerFont('Bold', DEJAVU_SANS_BOLD);
  doc.registerFont('RobotoBold', ROBOTO_BOLD);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Every stylish page is created deliberately by the renderer. PDFKit's
  // implicit text-overflow pages have no header and shift the remaining card
  // content to the top edge, so disable them and retain the real method for
  // measured/section page creation below.
  const realAddPage = doc.addPage.bind(doc);
  doc.addPage = (() => doc) as unknown as typeof doc.addPage;

  const company = input.company;
  const consultant = input.consultant;
  const styledLogo = company?.logo ? await prepareStylishLogo(company.logo) : null;
  const overviewIcons = {
    destination: await prepareStylishOverviewIcon(STYLISH_OVERVIEW_ICONS.destination),
    guest: await prepareStylishOverviewIcon(STYLISH_OVERVIEW_ICONS.guest),
    duration: await prepareStylishOverviewIcon(STYLISH_OVERVIEW_ICONS.duration),
    travelDate: await prepareStylishOverviewIcon(STYLISH_OVERVIEW_ICONS.travelDate),
    travelers: await prepareStylishOverviewIcon(STYLISH_OVERVIEW_ICONS.travelers),
    pricePerson: await prepareStylishOverviewIcon(STYLISH_OVERVIEW_ICONS.pricePerson),
    payment: await prepareStylishOverviewIcon(STYLISH_OVERVIEW_ICONS.payment),
  };
  // Airplane artwork for flight-related Additional Price Item rows (same
  // asset family as the itinerary arc), background-cleared like the row icons.
  const flightsRowIcon = await prepareStylishOverviewIcon(STYLISH_SERVICE_ICONS.Flights);
  const pricing = resolveQuotationPricing({ version: input.version, quotation: input.quotation });
  const numberedPages: number[] = [];
  let y = 0;

  /**
   * Usable body bottom for the CURRENT page. The footer divider is drawn
   * FOOTER_RESERVE points above the page bottom, and body content keeps a
   * BODY_FOOTER_GAP gap above it. Because pages are dynamically sized, this
   * must be derived from the actual page height — never the fixed full-page
   * constant — or long content would flow into the footer on shorter pages.
   */
  const bodyBottom = () => doc.page.height - FOOTER_RESERVE - BODY_FOOTER_GAP;

  const drawImage = (
    value: PdfImage,
    x: number,
    top: number,
    width: number,
    height: number,
    mode: 'cover' | 'contain' = 'cover',
    radius = 14,
  ): boolean => {
    if (!value) return false;
    let saved = false;
    try {
      doc.save();
      if (radius > 0)
        doc.roundedRect(x, top, width, height, Math.min(radius, width / 2, height / 2));
      else doc.rect(x, top, width, height);
      doc.clip();
      saved = true;
      doc.image(value, x, top, {
        ...(mode === 'cover' ? { cover: [width, height] } : { fit: [width, height] }),
        align: 'center',
        valign: 'center',
      });
      if (saved) doc.restore();
      return true;
    } catch {
      if (saved) doc.restore();
      return false;
    }
  };

  const rounded = (
    x: number,
    top: number,
    width: number,
    height: number,
    fill = '#ffffff',
    stroke = LINE,
    radius = 9,
  ) => {
    doc.save().roundedRect(x, top, width, height, radius).fillAndStroke(fill, stroke).restore();
  };

  const pill = (
    label: string,
    x: number,
    top: number,
    options: {
      fill?: string;
      color?: string;
      minWidth?: number;
      height?: number;
      size?: number;
    } = {},
  ): number => {
    const height = options.height ?? 18;
    const size = options.size ?? 6.2;
    doc.font('Bold').fontSize(size);
    const width = Math.max(options.minWidth ?? 50, doc.widthOfString(label) + 18);
    doc
      .save()
      .roundedRect(x, top, width, height, height / 2)
      .fill(options.fill ?? PALE_BLUE)
      .restore();
    doc.fillColor(options.color ?? NAVY).text(label, x, top + (height - size) / 2 - 0.7, {
      width,
      align: 'center',
      lineBreak: false,
    });
    return width;
  };

  const drawDiamond = (x: number, top: number, size = 5, color = NAVY) => {
    doc
      .save()
      .moveTo(x, top - size)
      .lineTo(x + size, top)
      .lineTo(x, top + size)
      .lineTo(x - size, top)
      .closePath()
      .fill(color)
      .restore();
  };

  const pageHeader = () => {
    if (!drawImage(PAGE_HEADER_IMAGE, 0, 0, W, 71.3, 'contain', 0)) {
      doc.rect(0, 0, W, 71.3).fill('#f7f1e7');
    }
    doc
      .font('Times-BoldItalic')
      .fontSize(11)
      .fillColor('#1c58bc')
      .text((company?.name ?? 'TRAVEL COMPANY').toUpperCase(), 165, 30, {
        width: W - 330,
        align: 'center',
        characterSpacing: 2.3,
        lineBreak: false,
      });
  };

  const pageFooter = (pageIndex: number) => {
    const pageHeight = doc.page.height;
    const top = pageHeight - (H - 769);
    doc
      .moveTo(M, top)
      .lineTo(W - M, top)
      .lineWidth(0.7)
      .strokeColor('#8ebdff')
      .stroke();
    if (styledLogo) drawImage(styledLogo, 46, top + 12, 42, 38, 'contain', 0);
    else {
      doc
        .font('Bold')
        .fontSize(6)
        .fillColor(GOLD)
        .text('TRAVEL', 47, top + 22, { width: 40, align: 'center' });
      doc
        .font('Bold')
        .fontSize(5)
        .fillColor(NAVY)
        .text('HOLIDAYS', 47, top + 30, { width: 40, align: 'center' });
    }
    const achievementRows = [
      company?.tripsSold != null ? `${company.tripsSold} Trip Sold` : null,
      company?.operatingSinceYear ? `Est: ${company.operatingSinceYear}` : null,
    ].filter((row): row is string => Boolean(row));
    // The achievements column (and its heading) exists only when it has
    // content; Legal then slides left to its pitch so no gap is left behind.
    const hasAchievements = achievementRows.length > 0;
    const columns = [
      {
        x: 105,
        title: 'CONTACT US',
        rows: [
          company?.phone ? `${company.phone}` : null,
          company?.email ? `${company.email}` : null,
          company?.website ? `${company.website}` : null,
        ],
      },
      ...(hasAchievements
        ? [{ x: 254, title: 'OUR ACHIEVEMENTS', rows: achievementRows }]
        : []),
      {
        x: hasAchievements ? 404 : 254,
        title: 'LEGAL INFO',
        rows: [
          company?.tan ? `TAN: ${company.tan}` : null,
          company?.taxRegistrationNumber ? `GST: ${company.taxRegistrationNumber}` : null,
        ],
      },
    ];
    for (const column of columns) {
      doc
        .font('Body')
        .fontSize(7)
        .fillColor(TEAL)
        .text(column.title, column.x, top + 13, {
          width: 130,
          lineBreak: false,
        });
      doc
        .font('Body')
        .fontSize(6.5)
        .fillColor(INK)
        .text(column.rows.filter(Boolean).join('\n'), column.x, top + 26, {
          width: 135,
          lineGap: 1.1,
        });
    }
    doc
      .font('Body')
      .fontSize(6.2)
      .fillColor(MUTED)
      .text(`${pageIndex + 1}`, W - M - 70, pageHeight - (H - 823), {
        width: 70,
        align: 'right',
        lineBreak: false,
      });
  };

  const sectionHeading = (title: string, top: number) => {
    doc
      .font('Bold')
      .fontSize(13)
      .fillColor(NAVY)
      .text(title.toUpperCase(), M + 3, top, {
        width: CONTENT_W,
        lineBreak: false,
      });
    doc
      .moveTo(M, top + 25)
      .lineTo(M + 85, top + 25)
      .lineWidth(1.5)
      .strokeColor(GOLD)
      .stroke();
  };

  const addContentPage = (title?: string, pageHeight = H): number => {
    realAddPage({ size: [W, pageHeight], margin: 0 });
    const range = doc.bufferedPageRange();
    const pageIndex = range.start + range.count - 1;
    numberedPages.push(pageIndex);
    pageHeader();
    y = title ? 90 : 86;
    if (title) {
      sectionHeading(title, y);
      y += 43;
    }
    return pageIndex;
  };

  const drawEmoji = (emoji: string, x: number, top: number, size: number): boolean => {
    const png = colorEmojiPng(emoji);
    return png ? drawImage(png, x, top, size, size, 'contain') : false;
  };

  const drawRichLines = (
    lines: PdfRichTextLine[],
    x: number,
    top: number,
    width: number,
    size = 7.2,
    color = INK,
    lineFactor = 1.42,
  ): number => {
    let yy = top;
    const lineHeight = size * lineFactor;
    for (const line of lines) {
      let xx = x;
      for (const run of line) {
        const parts = splitPdfEmojiSequences(run.text);
        for (const part of parts) {
          const emoji = colorEmojiPng(part);
          if (emoji) {
            if (xx + lineHeight > x + width) {
              yy += lineHeight;
              xx = x;
            }
            drawImage(emoji, xx, yy + 0.2, lineHeight * 0.88, lineHeight * 0.88, 'contain');
            xx += lineHeight;
            continue;
          }
          const printablePart = containsPdfEmoji(part) ? pdfEmojiFallback(part) : part;
          doc.font(run.bold ? 'Bold' : 'Body').fontSize(size);
          for (const word of printablePart.split(/(\s+)/).filter(Boolean)) {
            const wordWidth = doc.widthOfString(word);
            if (!/^\s+$/.test(word) && xx > x && xx + wordWidth > x + width) {
              yy += lineHeight;
              xx = x;
            }
            if (xx !== x || !/^\s+$/.test(word)) {
              doc.fillColor(color).text(word, xx, yy, { lineBreak: false });
              xx += wordWidth;
            }
          }
        }
      }
      yy += lineHeight;
    }
    return yy;
  };

  // Accurate measurement – same wrapping as drawRichLines, no drawing.
  const measureRichHeight = (
    lines: PdfRichTextLine[],
    width: number,
    size: number,
    lineFactor = 1.42,
  ): number => {
    if (!lines.length) return 0;
    const lineHeight = size * lineFactor;
    let total = 0;
    for (const line of lines) {
      let xx = 0;
      for (const run of line) {
        const parts = splitPdfEmojiSequences(run.text);
        for (const part of parts) {
          const emoji = colorEmojiPng(part);
          if (emoji) {
            if (xx + lineHeight > width && xx > 0) {
              total += lineHeight;
              xx = 0;
            }
            xx += lineHeight;
            continue;
          }
          const printable = containsPdfEmoji(part) ? pdfEmojiFallback(part) : part;
          doc.font(run.bold ? 'Bold' : 'Body').fontSize(size);
          for (const word of printable.split(/(\s+)/).filter(Boolean)) {
            const w = doc.widthOfString(word);
            if (!/^\s+$/.test(word) && xx > 0 && xx + w > width) {
              total += lineHeight;
              xx = 0;
            }
            if (xx !== 0 || !/^\s+$/.test(word)) {
              xx += w;
            }
          }
        }
      }
      total += lineHeight;
    }
    return total;
  };

  /**
   * Pre-wrap rich text lines into single-visual-row lines using exactly the
   * same wrap conditions as drawRichLines. Callers that chunk content by page
   * height (FAQs, Destination Expert) must feed it pre-wrapped rows: a single
   * source paragraph can otherwise be taller than a whole page and can never
   * be split by the chunker, overflowing into the footer.
   */
  const wrapRichLinesToWidth = (
    lines: PdfRichTextLine[],
    width: number,
    size: number,
    lineFactor = 1.42,
  ): PdfRichTextLine[] => {
    const lineHeight = size * lineFactor;
    const rows: PdfRichTextLine[] = [];
    let row: PdfRichTextLine = [];
    let xx = 0;
    const flushRow = () => {
      if (row.length) rows.push(row);
      row = [];
      xx = 0;
    };
    for (const line of lines) {
      for (const run of line) {
        for (const part of splitPdfEmojiSequences(run.text)) {
          if (colorEmojiPng(part)) {
            if (xx + lineHeight > width && xx > 0) flushRow();
            row.push({ text: part, bold: false });
            xx += lineHeight;
            continue;
          }
          const printablePart = containsPdfEmoji(part) ? pdfEmojiFallback(part) : part;
          doc.font(run.bold ? 'Bold' : 'Body').fontSize(size);
          for (const word of printablePart.split(/(\s+)/).filter(Boolean)) {
            const wordWidth = doc.widthOfString(word);
            const isSpace = /^\s+$/.test(word);
            if (!isSpace && xx > 0 && xx + wordWidth > width) flushRow();
            if (isSpace && xx === 0) continue;
            const previous = row.at(-1);
            if (previous && previous.bold === run.bold) previous.text += word;
            else row.push({ text: word, bold: run.bold });
            xx += wordWidth;
          }
        }
      }
      flushRow();
    }
    return rows;
  };

  // Cover (Page 1) -----------------------------------------------------------
  // Premium travel-brochure cover: a full-bleed destination photograph with
  // editorial serif typography, an organic cream-paper sheet laid over the
  // lower photograph, services integrated into that paper and three framed,
  // softly rotated sightseeing photo cards. Cover-only: later pages begin with
  // the overview section below and must not depend on anything in this block.
  const PAGE1_HERO_H = 530;
  const PAGE1_CREAM = '#f7f1e7';
  const PAGE1_GOLD = '#d9a441';
  const PAGE1_INK = '#102a43';
  const PAGE1_FOOTER_H = 66;
  const PAGE1_FOOTER_TOP = H - PAGE1_FOOTER_H;
  // Footer navy from the brochure reference (Page 2+ keeps NAVY_DARK).
  const PAGE1_NAVY = '#1e3a5f';
  const PAGE1_SERVICE_COLORS: Record<string, string> = {
    Flights: '#2f8fd0',
    Hotels: '#f0a22e',
    Tours: '#3d9e73',
    Transport: '#e06552',
    Cruise: '#7b79c6',
    'Add-ons': '#5b7fa6',
  };
  const page1PaperNoise = (index: number) => {
    const value = Math.sin(index * 12.9898 + 7.3) * 43758.5453;
    return value - Math.floor(value);
  };

  // Default gallery: first usable image from three different sightseeing
  // activities starting at Day 2 for itineraries longer than three days
  // (Days 2, 3, 4, then onward), or at Day 1 for three-day and shorter ones.
  // No cover fallback, no fabrication. A saved destination-level or
  // per-version cover selection replaces these defaults slot by slot.
  const page1DefaultCards = (): Buffer[] => {
    const details = input.version.sightseeingDetails as {
      days?: SightDay[];
    } | null;
    return resolveStylishPage1DefaultCards(details?.days, input.images);
  };

  realAddPage({ size: [W, H], margin: 0 });

  // Hero photograph: the destination master image, full-bleed, cinematic,
  // object-cover. It extends below the paper edge so the torn cream contour
  // always overlaps real photography. An explicit per-quotation CUSTOM hero
  // override takes precedence; otherwise the resolved destination cover is
  // used. Missing/unreadable art falls back to the navy panel below.
  const page1Hero = input.images?.page1Hero ?? input.images?.cover;
  const page1HeroBottom = PAGE1_HERO_H + 28;
  if (!drawImage(page1Hero, 0, 0, W, page1HeroBottom, 'cover', 0))
    doc.rect(0, 0, W, page1HeroBottom).fill(NAVY_DARK);
  // Soft readability scrim behind the typography only — the photograph stays
  // bright and natural (no opaque panel, no hard edge).
  const page1Scrim = doc.linearGradient(0, 0, 0, 380);
  page1Scrim.stop(0, NAVY_DARK, 0.48).stop(0.5, NAVY_DARK, 0.2).stop(1, NAVY_DARK, 0);
  doc.save().rect(0, 0, W, 380).fill(page1Scrim).restore();

  // Cover hero typography: the customer name leads in Roboto Bold, with the
  // destination / package name directly below in the same family and white
  // colour at 60% of the lead size. No separator sits between the two
  // headings — only clean, balanced vertical spacing.
  // Dominant bold sans-serif headings, shrinking gracefully for long names.
  const page1Name = clean(input.quotation.customerName) || 'Valued Traveller';
  const page1NameWidth = CONTENT_W - 24;
  const page1NameTop = 192;
  // Dynamic destination / package name value directly below the customer name.
  // Prefers the saved package heading, then the version title (with a
  // trailing " for <customer>" stripped to avoid duplicating the lead name),
  // then the quotation destinations / summary.
  const page1VersionExtra = input.version as unknown as {
    packageHeading?: unknown;
    title?: unknown;
    destinationSummary?: unknown;
  };
  const page1RawHeading = clean(page1VersionExtra.packageHeading);
  const page1RawTitle = clean(page1VersionExtra.title);
  const page1RawDestinations = clean(
    (input.quotation as { destinations?: unknown }).destinations,
  );
  const page1RawDestSummary =
    clean(input.quotation.destinationSummary) || clean(page1VersionExtra.destinationSummary);
  let page1PackageName = '';
  const page1GenericHeading = `custom package for ${page1Name}`.toLowerCase();
  if (page1RawHeading && page1RawHeading.toLowerCase() !== page1GenericHeading) {
    page1PackageName = page1RawHeading;
  } else if (page1RawTitle) {
    let page1TitleClean = page1RawTitle;
    const page1ForSuffix = ` for ${page1Name}`.toLowerCase();
    if (
      page1TitleClean.toLowerCase().endsWith(page1ForSuffix) &&
      page1TitleClean.length > page1ForSuffix.length
    )
      page1TitleClean = page1TitleClean.slice(0, page1TitleClean.length - page1ForSuffix.length).trim();
    if (page1TitleClean && page1TitleClean.toLowerCase() !== page1Name.toLowerCase())
      page1PackageName = page1TitleClean;
    else page1PackageName = page1RawDestinations || page1RawDestSummary;
  } else {
    page1PackageName = page1RawDestinations || page1RawDestSummary;
  }
  // One authoritative package string: collapse a duplicated trailing word
  // group ("… Package Package" → "… Package") that version titles built as
  // "<destination> Package for <customer>" carry when the destination value
  // already ends with that suffix. Never appends anything.
  if (page1PackageName) page1PackageName = collapseTrailingDuplicateWords(page1PackageName);
  // Lead size: the largest size (down to the minimum) at which the name wraps
  // to at most two lines and the destination at 22/45 of that size wraps to
  // at most three. The destination always renders at 22/45 of the lead size
  // so the hierarchy holds at every scale.
  const page1NameSize = (() => {
    const start = 45;
    const min = 24;
    const linesAt = (text: string, size: number): number => {
      doc.font('RobotoBold').fontSize(size);
      const one = Math.max(1, doc.heightOfString('Ag', { width: page1NameWidth }));
      return Math.max(1, Math.round(doc.heightOfString(text, { width: page1NameWidth }) / one));
    };
    let size = start;
    while (
      size > min &&
      (linesAt(page1Name, size) > 2 ||
        (page1PackageName ? linesAt(page1PackageName, Math.max(12, Math.round((size * 22) / 45))) > 3 : false))
    )
      size -= 1;
    return size;
  })();
  const page1PackageSize = Math.max(12, Math.round((page1NameSize * 22) / 45));
  doc.font('RobotoBold').fontSize(page1NameSize);
  const page1NameHeight = doc.heightOfString(page1Name, { width: page1NameWidth });
  doc
    .fillColor('#ffffff')
    .text(page1Name, M + 12, page1NameTop, {
      width: page1NameWidth,
      align: 'center',
    });
  if (page1PackageName) {
    const page1PackageTop = page1NameTop + page1NameHeight + 14;
    doc
      .font('RobotoBold')
      .fontSize(page1PackageSize)
      .fillColor('#ffffff')
      .text(page1PackageName, M + 12, page1PackageTop, {
        width: page1NameWidth,
        align: 'center',
      });
  }

  // Organic cream-paper sheet laid over the lower photograph. The contour
  // combines two noise frequencies so the torn edge is asymmetric and clearly
  // physical (never a repeating zig-zag), with a faint warm lift shadow.
  const page1PaperAmp = (index: number) =>
    page1PaperNoise(index) * 6 + page1PaperNoise(index * 2.3 + 11) * 3;
  const page1PaperPath = (edgeOffset: number, steps: number) => {
    doc.moveTo(0, PAGE1_HERO_H - 10 + edgeOffset + page1PaperAmp(0));
    for (let step = 1; step <= steps; step += 1) {
      const x = (W / steps) * step;
      doc.lineTo(x, PAGE1_HERO_H - 10 + edgeOffset + page1PaperAmp(step));
    }
    doc.lineTo(W, PAGE1_FOOTER_TOP).lineTo(0, PAGE1_FOOTER_TOP).closePath();
  };
  doc.save().fillColor('#4a3a26').fillOpacity(0.16);
  page1PaperPath(-4, 52);
  doc.fill().restore();
  doc.save().fillColor(PAGE1_CREAM).fillOpacity(1);
  page1PaperPath(0, 52);
  doc.fill().restore();
  const page1Services = [
    ...new Set([
      ...((input.version.flightDetails as FlightDetails | null)?.include ? ['Flights'] : []),
      ...(input.version.hotels.some((hotel) => hotel.selected) ? ['Hotels'] : []),
      ...(input.version.sightseeingDetails ? ['Tours'] : []),
      ...input.version.services.map((service) => serviceLabel(service.serviceType)),
    ]),
  ]
    .map((label) =>
      label === 'Flights' ||
      label === 'Hotels' ||
      label === 'Tours' ||
      label === 'Transport' ||
      label === 'Cruise'
        ? label
        : 'Add-ons',
    )
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .sort(
      (left, right) =>
        ['Flights', 'Hotels', 'Tours', 'Transport', 'Cruise', 'Add-ons'].indexOf(left) -
        ['Flights', 'Hotels', 'Tours', 'Transport', 'Cruise', 'Add-ons'].indexOf(right),
    );
  const page1ServicesTop = PAGE1_HERO_H + 19;
  const page1Heading = 'SERVICES INCLUDE';
  doc.font('Bold').fontSize(8.5);
  const page1HeadingWidth =
    doc.widthOfString(page1Heading) + 3.5 * (page1Heading.length - 1);
  const page1RuleY = page1ServicesTop + 4;
  const page1RuleGap = 14;
  const page1RuleLen = 70;
  doc
    .save()
    .lineWidth(0.5)
    .strokeColor('#a9b4c2')
    .moveTo(W / 2 - page1HeadingWidth / 2 - page1RuleGap - page1RuleLen, page1RuleY)
    .lineTo(W / 2 - page1HeadingWidth / 2 - page1RuleGap, page1RuleY)
    .moveTo(W / 2 + page1HeadingWidth / 2 + page1RuleGap, page1RuleY)
    .lineTo(W / 2 + page1HeadingWidth / 2 + page1RuleGap + page1RuleLen, page1RuleY)
    .stroke()
    .restore();
  doc
    .font('Bold')
    .fontSize(8.5)
    .fillColor(PAGE1_INK)
    .text(page1Heading, M, page1ServicesTop, {
      width: CONTENT_W,
      align: 'center',
      characterSpacing: 3.5,
      lineBreak: false,
    });
  // Circular colour-coded service badges with a white centre and a close label.
  const page1IconGap = 16;
  const page1IconD = 56;
  const page1RowW = page1Services.length * page1IconD + (page1Services.length - 1) * page1IconGap;
  let page1IconX = (W - page1RowW) / 2;
  const page1IconTop = page1ServicesTop + 16;
  page1Services.forEach((label) => {
    const centerX = page1IconX + page1IconD / 2;
    const centerY = page1IconTop + page1IconD / 2;
    doc.save().circle(centerX, centerY, page1IconD / 2).fill(PAGE1_SERVICE_COLORS[label] ?? NAVY).restore();
    doc.save().circle(centerX, centerY, 24).fill('#ffffff').restore();
    const icon = STYLISH_SERVICE_ICONS[label as keyof typeof STYLISH_SERVICE_ICONS] ?? null;
    drawImage(icon, centerX - 14, centerY - 14, 28, 28, 'contain', 0);
    doc
      .font('Bold')
      .fontSize(8)
      .fillColor(PAGE1_INK)
      .text(label, page1IconX - 10, page1IconTop + page1IconD + 5, {
        width: page1IconD + 20,
        align: 'center',
        lineBreak: false,
      });
    page1IconX += page1IconD + page1IconGap;
  });
  // Three framed sightseeing photographs — white mat, soft lift shadow and a
  // gentle brochure rotation. The photograph is the whole card; no captions.
  const page1Defaults = page1DefaultCards();
  const page1Cards = resolveStylishPage1Cards(page1Defaults, input.images?.page1Cards);
  const page1CardW = 162;
  const page1CardH = 112;
  const page1CardFrame = 4;
  const page1CardGap = 11;
  const page1CardRowW = 3 * page1CardW + 2 * page1CardGap;
  const page1CardLeft0 = M + (CONTENT_W - page1CardRowW) / 2;
  const page1CardCenterY = 706;
  const page1CardYOffsets = [1.5, 0, 1.5];
  const page1CardAngles = [-2, 0, 2];
  const page1CardOuterW = page1CardW + page1CardFrame * 2;
  const page1CardOuterH = page1CardH + page1CardFrame * 2;
  for (let card = 0; card < 3; card += 1) {
    const image = page1Cards[card] ?? null;
    const centerX = page1CardLeft0 + card * (page1CardW + page1CardGap) + page1CardW / 2;
    doc.save();
    doc.translate(centerX, page1CardCenterY + (page1CardYOffsets[card] ?? 0));
    doc.rotate(page1CardAngles[card] ?? 0);
    // Soft, low-opacity lift shadow (approximated with two stacked mats).
    doc
      .save()
      .roundedRect(
        -page1CardOuterW / 2 + 2,
        -page1CardOuterH / 2 + 3,
        page1CardOuterW,
        page1CardOuterH,
        8,
      )
      .fillColor('#2b2115')
      .fillOpacity(0.16)
      .fill()
      .restore();
    doc
      .save()
      .roundedRect(
        -page1CardOuterW / 2 + 1,
        -page1CardOuterH / 2 + 1.5,
        page1CardOuterW,
        page1CardOuterH,
        8,
      )
      .fillColor('#2b2115')
      .fillOpacity(0.1)
      .fill()
      .restore();
    // White photo mat.
    doc
      .save()
      .roundedRect(-page1CardOuterW / 2, -page1CardOuterH / 2, page1CardOuterW, page1CardOuterH, 6)
      .fill('#ffffff')
      .restore();
    if (!image) {
      doc
        .save()
        .roundedRect(-page1CardW / 2, -page1CardH / 2, page1CardW, page1CardH, 3)
        .fill('#e7edf4')
        .restore();
    } else {
      drawImage(image, -page1CardW / 2, -page1CardH / 2, page1CardW, page1CardH, 'cover', 3);
    }
    doc.restore();
  }
  // Navy consultant footer (Page 1 only). Two-sided edge-anchored layout:
  // consultant pinned to the left edge, phone pinned to the right edge
  // (20pt insets), with no separator between them. Compact gold discs hold
  // drawn navy vector glyphs. All values stay dynamic and single-line.
  const page1FooterEdgePad = 20;
  const page1DiscR = 13;
  const page1DiscY = PAGE1_FOOTER_TOP + PAGE1_FOOTER_H / 2;
  const page1TearNoise = (index: number) => {
    const value = Math.sin(index * 12.9898 + 4.1) * 43758.5453;
    return value - Math.floor(value);
  };
  doc.save().fill(PAGE1_NAVY);
  doc.moveTo(0, PAGE1_FOOTER_TOP);
  const page1FooterTeeth = 52;
  for (let tear = 0; tear <= page1FooterTeeth; tear += 1) {
    const x = (W / page1FooterTeeth) * tear;
    doc.lineTo(x, PAGE1_FOOTER_TOP + page1TearNoise(tear) * 2);
  }
  doc
    .lineTo(W, PAGE1_FOOTER_TOP + PAGE1_FOOTER_H)
    .lineTo(0, PAGE1_FOOTER_TOP + PAGE1_FOOTER_H)
    .closePath()
    .fill()
    .restore();
  // Drawn vector glyphs (navy on gold) — person and a solid telephone handset.
  const page1Person = (cx: number, cy: number, radius: number) => {
    doc.save().fillColor(NAVY_DARK);
    doc.circle(cx, cy - radius * 0.26, radius * 0.3).fill();
    doc
      .moveTo(cx - radius * 0.54, cy + radius * 0.56)
      .bezierCurveTo(
        cx - radius * 0.54,
        cy + radius * 0.12,
        cx - radius * 0.26,
        cy - radius * 0.02,
        cx,
        cy - radius * 0.02,
      )
      .bezierCurveTo(
        cx + radius * 0.26,
        cy - radius * 0.02,
        cx + radius * 0.54,
        cy + radius * 0.12,
        cx + radius * 0.54,
        cy + radius * 0.56,
      )
      .closePath()
      .fill();
    doc.restore();
  };
  const page1Handset = (cx: number, cy: number, radius: number) => {
    // Official Material "call" receiver silhouette (Google, Apache 2.0),
    // scaled so its 18-unit bbox spans 1.25x the disc radius and centred on
    // the disc. Single filled path, solid navy, no waves or extra marks.
    doc.save().fillColor(NAVY_DARK);
    const k = radius * 0.06944;
    doc.moveTo((cx + 8.01 * k), (cy + 3.38 * k));
    doc.bezierCurveTo((cx + 6.78 * k), (cy + 3.38 * k), (cx + 5.59 * k), (cy + 3.18 * k), (cx + 4.48 * k), (cy + 2.82 * k));
    doc.bezierCurveTo((cx + 4.13 * k), (cy + 2.7 * k), (cx + 3.74 * k), (cy + 2.79 * k), (cx + 3.47 * k), (cy + 3.06 * k));
    doc.lineTo((cx + 1.9 * k), (cy + 5.03 * k));
    doc.bezierCurveTo((cx - 0.93 * k), (cy + 3.68 * k), (cx - 3.58 * k), (cy + 1.13 * k), (cx - 4.99 * k), (cy - 1.8 * k));
    doc.lineTo((cx - 3.04 * k), (cy - 3.46 * k));
    doc.bezierCurveTo((cx - 2.77 * k), (cy - 3.74 * k), (cx - 2.69 * k), (cy - 4.13 * k), (cx - 2.8 * k), (cy - 4.48 * k));
    doc.bezierCurveTo((cx - 3.17 * k), (cy - 5.59 * k), (cx - 3.36 * k), (cy - 6.78 * k), (cx - 3.36 * k), (cy - 8.01 * k));
    doc.bezierCurveTo((cx - 3.36 * k), (cy - 8.55 * k), (cx - 3.81 * k), (cy - 9.0 * k), (cx - 4.35 * k), (cy - 9.0 * k));
    doc.lineTo((cx - 7.81 * k), (cy - 9.0 * k));
    doc.bezierCurveTo((cx - 8.35 * k), (cy - 9.0 * k), (cx - 9.0 * k), (cy - 8.76 * k), (cx - 9.0 * k), (cy - 8.01 * k));
    doc.bezierCurveTo((cx - 9.0 * k), (cy + 1.28 * k), (cx - 1.27 * k), (cy + 9.0 * k), (cx + 8.01 * k), (cy + 9.0 * k));
    doc.bezierCurveTo((cx + 8.72 * k), (cy + 9.0 * k), (cx + 9.0 * k), (cy + 8.37 * k), (cx + 9.0 * k), (cy + 7.82 * k));
    doc.lineTo((cx + 9.0 * k), (cy + 4.37 * k));
    doc.bezierCurveTo((cx + 9.0 * k), (cy + 3.83 * k), (cx + 8.55 * k), (cy + 3.38 * k), (cx + 8.01 * k), (cy + 3.38 * k));
    doc.closePath().fill();
    doc.restore();
  };
  const page1FooterCols = [
    { label: 'Consultant:', value: consultant?.name ?? company?.name ?? '-', draw: page1Person },
    { label: 'Phone:', value: consultant?.phone ?? company?.phone ?? '-', draw: page1Handset },
  ];
  // Each side is capped so long values can never meet in the middle (20pt
  // minimum gap); overflow shrinks then ellipsizes as before.
  const page1FooterMaxTextW = (W - page1FooterEdgePad * 2) / 2 - (page1DiscR + 8) - 16;
  const page1DrawFooterCol = (
    column: (typeof page1FooterCols)[number],
    discX: number,
    textW: number,
  ) => {
    doc.save().circle(discX, page1DiscY, page1DiscR).fill(PAGE1_GOLD).restore();
    column.draw(discX, page1DiscY, page1DiscR);
    const textX = discX + page1DiscR + 8;
    doc
      .font('Body')
      .fontSize(7.5)
      .fillColor('#c8d5ec')
      .text(column.label, textX, PAGE1_FOOTER_TOP + 22, {
        width: textW,
        lineBreak: false,
      });
    let page1ValueSize = 10;
    doc.font('Bold').fontSize(page1ValueSize);
    while (page1ValueSize > 8 && doc.widthOfString(column.value) > textW) {
      page1ValueSize -= 0.25;
      doc.font('Bold').fontSize(page1ValueSize);
    }
    doc
      .font('Bold')
      .fontSize(page1ValueSize)
      .fillColor('#ffffff')
      .text(column.value, textX, PAGE1_FOOTER_TOP + 33, {
        width: textW,
        height: 16,
        ellipsis: true,
        lineBreak: false,
      });
  };
  // Consultant anchored to the far left: gold disc starts exactly at the
  // 20pt inset.
  const page1ConsultantDiscX = page1FooterEdgePad + page1DiscR;
  page1DrawFooterCol(page1FooterCols[0]!, page1ConsultantDiscX, page1FooterMaxTextW);
  // Phone anchored to the far right: measure the text block first so the
  // whole section (disc + texts) ends exactly at the 20pt inset.
  const page1PhoneCol = page1FooterCols[1]!;
  doc.font('Body').fontSize(7.5);
  const page1PhoneLabelW = doc.widthOfString(page1PhoneCol.label);
  let page1PhoneSize = 10;
  doc.font('Bold').fontSize(page1PhoneSize);
  while (page1PhoneSize > 8 && doc.widthOfString(page1PhoneCol.value) > page1FooterMaxTextW) {
    page1PhoneSize -= 0.25;
    doc.font('Bold').fontSize(page1PhoneSize);
  }
  const page1PhoneTextW = Math.min(
    page1FooterMaxTextW,
    Math.max(page1PhoneLabelW, doc.widthOfString(page1PhoneCol.value)),
  );
  const page1PhoneDiscX =
    W - page1FooterEdgePad - (page1DiscR + 8 + page1PhoneTextW);
  page1DrawFooterCol(page1PhoneCol, page1PhoneDiscX, page1PhoneTextW);

  // Overview ---------------------------------------------------------------
  // Price Breakdown rows are measured before the page exists so a long
  // custom-item list grows the overview page instead of colliding with the
  // booking box or footer. A4 whenever everything fits (existing renders
  // are bit-identical): the footer stays bottom-anchored per physical page.
  const investmentTop = 446;
  const isSectionWiseInvestment = pricing.pricingMode === 'SECTION_WISE';
  const priceRows = isSectionWiseInvestment
    ? []
    : ([
        ['Adults', input.quotation.adults, input.version.perAdultPrice],
        ['Child With Bed (CWB)', input.quotation.childrenWithBed, input.version.perChildWithBedPrice],
        [
          'Child Without Bed (CWOB)',
          input.quotation.childrenWithoutBed,
          input.version.perChildWithoutBedPrice,
        ],
        [
          asNumber(input.quotation.infants) === 1 ? 'Infant' : 'Infants',
          input.quotation.infants,
          input.version.perInfantPrice,
        ],
      ] as const).filter(([, count, value]) => asNumber(count) > 0 && asNumber(value) > 0);
  // Additional Price Items (Pricing tab flat charges, the same saved rows the
  // public weblink breakdown lists): rendered after the traveler rows in
  // saved order, never multiplied by traveler count. Amounts already flow
  // into the package total — this only displays them. Row heights grow for
  // wrapped labels so nothing clips.
  const investmentCustomItems = isSectionWiseInvestment ? [] : (pricing.customItems?.rows ?? []);
  doc.font('Body').fontSize(9);
  let investmentCustomExtra = 0;
  const investmentCustomLayout: Array<{ top: number; height: number }> = [];
  {
    let top = investmentTop + 65 + priceRows.length * 25;
    for (const item of investmentCustomItems) {
      const lines = Math.max(1, Math.ceil(doc.widthOfString(item.label) / 175));
      const height = 25 + (lines - 1) * 12;
      investmentCustomLayout.push({ top, height });
      top += height;
      investmentCustomExtra += height;
    }
  }
  const overviewHasBooking = asNumber(input.version.initialPaymentAmount) > 0;
  const overviewContentBottom = Math.max(
    investmentTop + 194 + investmentCustomExtra,
    overviewHasBooking ? 661 + investmentCustomExtra + 64 : 0,
  );
  addContentPage(undefined, Math.max(H, overviewContentBottom + 82));
  doc
    .font('Times-Italic')
    .fontSize(14)
    .fillColor(NAVY)
    .text(
      `A personalized travel experience exclusively designed for ${input.quotation.customerName}`,
      M,
      86,
      { width: CONTENT_W, align: 'center' },
    );
  doc
    .font('Body')
    .fontSize(10)
    .fillColor(INK)
    .text(
      `Dear ${input.quotation.customerName},\n\nGreetings from ${company?.name ?? 'our travel team'}.\n\nOur team has put up this quotation regarding your upcoming trip. Please go through it and let us know if you need any changes in the provided services. You can reach out to us using the provided contacts.`,
      25,
      129,
      { width: W - 50, lineGap: 4.2 },
    );

  const overviewTop = 250;
  // Height leaves room for the optional traveler-ages sub-line on the second
  // overview row; the Investment card below is shifted accordingly.
  rounded(M, overviewTop, CONTENT_W, 184, '#ffffff', TEAL, 10);
  doc
    .font('Body')
    .fontSize(14)
    .fillColor(INK)
    .text('Trip Overview', M + 31, overviewTop + 20);
  doc
    .moveTo(M + 29, overviewTop + 47)
    .lineTo(W - M - 29, overviewTop + 47)
    .lineWidth(0.55)
    .strokeColor(LINE)
    .stroke();
  const overviewRows = [
    [
      overviewIcons.destination,
      'DESTINATION',
      input.quotation.destinations || input.quotation.destinationSummary,
      TEAL,
    ],
    [overviewIcons.guest, 'GUEST', input.quotation.customerName, GREEN],
    [
      overviewIcons.duration,
      'DURATION',
      durationLabel(
        input.quotation.durationNights,
        input.quotation.travelStartDate,
        input.quotation.travelEndDate,
      ),
      TEAL,
    ],
    [overviewIcons.travelDate, 'TRAVEL DATE', date(input.quotation.travelStartDate), '#f29e2e'],
    [
      overviewIcons.travelers,
      'TRAVELERS',
      [
        `${input.quotation.adults} Adults`,
        input.quotation.childrenWithBed ? `${input.quotation.childrenWithBed} CWB` : null,
        input.quotation.childrenWithoutBed ? `${input.quotation.childrenWithoutBed} CWOB` : null,
        input.quotation.infants ? `${input.quotation.infants} Inf` : null,
      ]
        .filter(Boolean)
        .join(', '),
      RED,
    ],
    ...(() => {
      const ageBits = [
        formatAgeList(input.quotation.childrenWithBedAges)
          ? `CWB: ${formatAgeList(input.quotation.childrenWithBedAges)}`
          : null,
        formatAgeList(input.quotation.childrenWithoutBedAges)
          ? `CWOB: ${formatAgeList(input.quotation.childrenWithoutBedAges)}`
          : null,
        formatInfantAgeList(input.quotation.infantAges)
          ? `Inf: ${formatInfantAgeList(input.quotation.infantAges)}`
          : null,
      ].filter(Boolean) as string[];
      if (!ageBits.length) return [];
      return [
        [overviewIcons.travelers, 'AGES', ageBits.join(', '), RED] as [
          PdfImage,
          string,
          string,
          string,
        ],
      ];
    })(),
  ] as Array<[PdfImage, string, string, string, (string | undefined)?]>;
  overviewRows.forEach(([icon, label, value, color, sub], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const left = M + 31 + column * 160;
    const top = overviewTop + 63 + row * 57;
    drawImage(icon, left, top, 20, 20, 'contain', 0);
    doc
      .font('Body')
      .fontSize(6.7)
      .fillColor(color)
      .text(label, left + 32, top + 1, { width: 118 });
    doc
      .font('Body')
      .fontSize(9.3)
      .fillColor(INK)
      .text(value, left + 32, top + 17, { width: 118, height: 27 });
    if (sub)
      doc
        .font('Body')
        .fontSize(6.8)
        .fillColor(MUTED)
        .text(sub, left + 32, top + 39, { width: 118, height: 16 });
  });

  rounded(M, investmentTop, CONTENT_W, 194 + investmentCustomExtra, '#ffffff', TEAL, 10);
  doc
    .font('Body')
    .fontSize(14)
    .fillColor(INK)
    .text('Price Breakdown', M + 31, investmentTop + 21);
  priceRows.forEach(([label, count, value], index) => {
    const rowTop = investmentTop + 65 + index * 25;
    drawImage(overviewIcons.pricePerson, M + 29, rowTop - 2, 13, 13, 'contain', 0);
    doc
      .font('Body')
      .fontSize(9)
      .fillColor(MUTED)
      .text(`${label} (x${count})`, M + 51, rowTop, { width: 175 });
    doc
      .font('Body')
      .fontSize(9.5)
      .fillColor(INK)
      .text(money(value, input.version.currency), M + 225, rowTop, { width: 70, align: 'right' });
    doc
      .moveTo(M + 29, rowTop + 15)
      .lineTo(M + 300, rowTop + 15)
      .lineWidth(0.45)
      .strokeColor(LINE)
      .stroke();
  });
  // Additional Price Item icons: flight- or visa-related labels get a matching
  // pictogram (case-insensitive substring, so plurals match too); everything
  // else keeps the default person icon. Traveller rows above are untouched.
  const customItemIconKind = (label: string): 'flight' | 'visa' | null => {
    const text = label.toLowerCase();
    if (text.includes('flight')) return 'flight';
    if (text.includes('visa')) return 'visa';
    return null;
  };
  // Minimal navy passport booklet with gold emblem, drawn at row-icon scale.
  const drawPassportIcon = (x: number, top: number, size: number) => {
    const coverW = size * 0.68;
    const coverX = x + (size - coverW) / 2;
    const coverH = size * 0.86;
    const coverTop = top + (size - coverH) / 2;
    doc.save().roundedRect(coverX, coverTop, coverW, coverH, size * 0.09).fill(NAVY).restore();
    doc.save().fillColor('#ffffff');
    doc.rect(coverX + size * 0.14, coverTop + size * 0.24, coverW - size * 0.28, size * 0.07).fill();
    doc.rect(coverX + size * 0.14, coverTop + size * 0.38, coverW - size * 0.28, size * 0.07).fill();
    doc.restore();
    doc
      .save()
      .fillColor(GOLD)
      .circle(coverX + coverW / 2, coverTop + coverH * 0.72, size * 0.1)
      .fill()
      .restore();
  };
  investmentCustomLayout.forEach(({ top: rowTop, height: rowHeight }, customIndex) => {
    const item = investmentCustomItems[customIndex]!;
    const iconKind = customItemIconKind(item.label);
    if (iconKind === 'flight' && flightsRowIcon) {
      drawImage(flightsRowIcon, M + 29, rowTop - 2, 13, 13, 'contain', 0);
    } else if (iconKind === 'visa') {
      drawPassportIcon(M + 29, rowTop - 2, 13);
    } else {
      drawImage(overviewIcons.pricePerson, M + 29, rowTop - 2, 13, 13, 'contain', 0);
    }
    doc
      .font('Body')
      .fontSize(9)
      .fillColor(MUTED)
      .text(item.label, M + 51, rowTop, { width: 175 });
    doc
      .font('Body')
      .fontSize(9.5)
      .fillColor(INK)
      .text(money(item.amount, input.version.currency), M + 225, rowTop, {
        width: 70,
        align: 'right',
      });
    doc
      .moveTo(M + 29, rowTop + rowHeight - 10)
      .lineTo(M + 300, rowTop + rowHeight - 10)
      .lineWidth(0.45)
      .strokeColor(LINE)
      .stroke();
  });
  // Authoritative total from the shared pricing engine (active method's
  // subtotal with the discount → tax pipeline applied), minus Add-on
  // Services. Add-on buckets must never inflate the Stylish Total Package
  // Price, and the legacy stored-final fallback must not silently reintroduce
  // them (a stored total can carry add-on charges, as on QT-001083).
  // Package pricing is strictly traveler + custom-item charges for
  // PER_PERSON — exactly as the builder computes it live — so a zero core
  // package stays zero no matter what separately added service rows carry.
  // A separately added row never counts merely because of its section bucket
  // (e.g. a VEHICLE_TRANSFER add-on like Dhano); genuine package-included
  // vehicle pricing keeps flowing through the SECTION_WISE section path.
  const investmentAddonAmount =
    pricing.sections.find((section) => section.id === 'addon')?.amount ?? 0;
  const investmentSubtotal =
    pricing.pricingMode === 'SECTION_WISE'
      ? pricing.sectionTotal - investmentAddonAmount
      : pricing.travelerPricing.subtotal + pricing.customItems.subtotal;
  const investmentTaxable = Math.max(
    0,
    Math.round((investmentSubtotal - pricing.discountAmount) * 100) / 100,
  );
  const investmentTax = Math.round(investmentTaxable * pricing.taxRate) / 100;
  const investmentTotal = Math.round((investmentTaxable + investmentTax) * 100) / 100;
  const totalBoxX = W - M - 198;
  // Tax note mirrors the weblink and Classic PDF: only a real saved note
  // renders. "Do not show" persists as null (and legacy blanks stay blank),
  // so the card never backfills a default; without a note the card shrinks
  // to avoid dead space.
  const investmentTaxNote = isPublicTaxNote(input.version.taxNote)
    ? input.version.taxNote.trim()
    : null;
  rounded(totalBoxX, investmentTop + 50, 176, investmentTaxNote ? 121 : 91, TEAL, TEAL, 17);
  doc
    .font('Body')
    .fontSize(7.2)
    .fillColor('#b9dbe9')
    .text(
      isSectionWiseInvestment ? 'QUOTATION TOTAL' : 'TOTAL PACKAGE',
      totalBoxX + 10,
      investmentTop + 71,
      {
        width: 156,
        align: 'center',
      },
    );
  // Discount presentation mirrors the interactive weblink exactly: the same
  // resolver values (originalTotal = grandTotal + discountAmount), shown only
  // for a real positive discount. No discount → the historic single-price
  // card, with no badge and no struck-through price.
  const investmentHasDiscount = pricing.discountAmount > 0;
  if (!investmentHasDiscount) {
    doc
      .font('Body')
      .fontSize(17)
      .fillColor('#ffffff')
      .text(
        money(investmentTotal, input.version.currency),
        totalBoxX + 10,
        investmentTop + 97,
        { width: 156, align: 'center' },
      );
  }
  if (investmentHasDiscount) {
    const investmentOriginalStr = money(investmentTotal + pricing.discountAmount, input.version.currency);
    const investmentBadgeStr = `${money(pricing.discountAmount, input.version.currency)} OFF`;
    doc.font('Body').fontSize(8.5);
    const investmentOrigW = doc.widthOfString(investmentOriginalStr);
    doc.font('Bold').fontSize(7.5);
    const investmentBadgeW = Math.max(50, doc.widthOfString(investmentBadgeStr) + 18);
    const investmentDiscountRowW = investmentOrigW + 6 + investmentBadgeW;
    const investmentDiscountX = totalBoxX + (176 - investmentDiscountRowW) / 2;
    const investmentDiscountTop = investmentTop + 86;
    doc
      .font('Body')
      .fontSize(8.5)
      .fillColor('#cfe6f2')
      .text(investmentOriginalStr, investmentDiscountX, investmentDiscountTop, {
        lineBreak: false,
      });
    doc
      .save()
      .moveTo(investmentDiscountX, investmentDiscountTop + 4.5)
      .lineTo(investmentDiscountX + investmentOrigW, investmentDiscountTop + 4.5)
      .lineWidth(1)
      .strokeColor('#cfe6f2')
      .stroke()
      .restore();
    pill(investmentBadgeStr, investmentDiscountX + investmentOrigW + 6, investmentDiscountTop - 3, {
      fill: '#fde68a',
      color: '#064e3b',
      minWidth: investmentBadgeW,
      height: 15,
      size: 7.5,
    });
    doc
      .font('Body')
      .fontSize(19)
      .fillColor('#ffffff')
      .text(
        money(investmentTotal, input.version.currency),
        totalBoxX + 10,
        investmentTop + 103,
        { width: 156, align: 'center' },
      );
  }
  if (investmentTaxNote) {
    doc
      .font('Body')
      .fontSize(6.5)
      .fillColor('#b9dbe9')
      .text(investmentTaxNote, totalBoxX + 10, investmentTop + 145, {
        width: 156,
        align: 'center',
      });
  }

  if (overviewHasBooking) {
    const bookingTop = 661 + investmentCustomExtra;
    rounded(M, bookingTop, CONTENT_W, 64, '#ffffff', GREEN, 10);
    drawImage(overviewIcons.payment, M + 27, bookingTop + 18, 17, 17, 'contain', 0);
    doc
      .font('Body')
      .fontSize(12)
      .fillColor(INK)
      .text('Secure Your Booking', M + 53, bookingTop + 17);
    doc
      .font('Body')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(
        `Pay ${money(input.version.initialPaymentAmount, input.version.currency, 2)} to confirm your booking.`,
        M + 31,
        bookingTop + 41,
      );
    const payButtonX = W - M - 137;
    const payButtonTop = bookingTop + 20;
    const payButtonWidth = pill('Pay Now', payButtonX, payButtonTop, {
      fill: GREEN,
      color: '#ffffff',
      minWidth: 108,
      height: 31,
      size: 7.5,
    });
    const paymentLink = clean(input.version.paymentLink);
    if (paymentLink) {
      const paymentUrl = /^[a-z][a-z\d+.-]*:/i.test(paymentLink)
        ? paymentLink
        : `https://${paymentLink}`;
      doc.link(payButtonX, payButtonTop, payButtonWidth, 31, paymentUrl);
    }
  }

  const drawCustomerCopy = (title: string, value: string | null | undefined) => {
    const paragraphs = (value ?? '')
      .split(/\r?\n/)
      .flatMap((line) => htmlToLines(line))
      .map((line) => line.trim())
      .filter(Boolean);
    if (!paragraphs.length) return;
    const size = 9.2;
    const lineGap = 3;
    const width = CONTENT_W - 42;
    doc.font('Body').fontSize(size);
    const wrapped: string[] = [];
    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && doc.widthOfString(candidate) > width) {
          wrapped.push(current);
          current = word;
        } else current = candidate;
      }
      if (current) wrapped.push(current);
      wrapped.push('');
    }
    if (wrapped.at(-1) === '') wrapped.pop();
    const lineHeight = size + lineGap;
    const measuredHeight = wrapped.reduce(
      (sum, line) => sum + (line ? lineHeight : lineHeight * 0.65),
      0,
    );
    const contentBottom = 133 + measuredHeight;
    addContentPage(
      title,
      contentBottom <= BODY_BOTTOM
        ? computePageHeight(contentBottom - PDF_TOP_MARGIN).pageHeight
        : H,
    );
    for (const line of wrapped) {
      if (y + lineHeight > bodyBottom()) addContentPage(title);
      if (line)
        doc
          .font('Body')
          .fontSize(size)
          .fillColor(INK)
          .text(line, M + 21, y, {
            width,
            lineBreak: false,
          });
      y += line ? lineHeight : lineHeight * 0.65;
    }
  };

  // The saved version copy is rendered before the service itinerary.
  if (input.version.introduction?.trim())
    drawCustomerCopy('Introduction', input.version.introduction);

  // Flights ----------------------------------------------------------------
  const drawFlightsSection = () => {
    const flightDetails = input.version.flightDetails as FlightDetails | null;
    const flights = flightRecordsOf(flightDetails);
    const journeys: Array<{ label: string; journey: FlightJourney }> = [];
    flights.forEach((flight, flightIndex) => {
      const prefix = flightRecordPrefix(flightIndex, flights.length, true);
      if (flight.outbound?.segments?.length)
        journeys.push({ label: `${prefix}OUTBOUND`, journey: flight.outbound });
      if (flight.returnJourney?.segments?.length)
        journeys.push({ label: `${prefix}RETURN`, journey: flight.returnJourney });
    });
    let flightPage = 0;
    if (flightDetails?.include) {
      if (flightDetails.entryMode === 'IMAGE') {
        const flightImages = input.images?.flights?.length
          ? input.images.flights
          : input.images?.flight
            ? [{ description: null, image: input.images.flight }]
            : [];
        flightImages.forEach((item) => {
          const description = item.description?.trim() || '';
          addContentPage(flightDetails.sectionTitle || 'Flight Details');
          const metaTop = y;
          if (description)
            doc
              .font('Body')
              .fontSize(9)
              .fillColor(INK)
              .text(description, M, metaTop, {
                width: CONTENT_W - 105,
                height: 34,
                ellipsis: true,
              });
          if (item.url) {
            const buttonW = 74;
            const buttonH = 26;
            const buttonX = M + CONTENT_W - buttonW;
            const buttonY = metaTop - 4;
            rounded(buttonX, buttonY, buttonW, buttonH, '#f8fafc', LINE, 6);
            doc
              .font('Bold')
              .fontSize(7.5)
              .fillColor(NAVY)
              .text('Preview', buttonX + 10, buttonY + 9, { width: 42 });
            doc
              .moveTo(buttonX + 56, buttonY + 16)
              .lineTo(buttonX + 64, buttonY + 8)
              .strokeColor(NAVY)
              .lineWidth(1)
              .stroke();
            doc
              .moveTo(buttonX + 59, buttonY + 8)
              .lineTo(buttonX + 64, buttonY + 8)
              .lineTo(buttonX + 64, buttonY + 13)
              .stroke();
            doc.link(buttonX, buttonY, buttonW, buttonH, item.url);
          }
          const imageTop = description || item.url ? metaTop + 38 : metaTop;
          rounded(M, imageTop, CONTENT_W, 504, '#ffffff', LINE, 8);
          drawImage(item.image, M + 12, imageTop + 12, CONTENT_W - 24, 480, 'contain');
        });
      }
      if (flightDetails.entryMode !== 'IMAGE') {
        for (const { label, journey } of journeys) {
          for (const segment of journey.segments ?? []) {
            const top = flightPage === 0 ? 130 : 85;
            const cardTop = top + 30;
            const noteText = htmlToLines(segment.notes).join(' ');
            const baggage = [
              segment.cabinLuggage ? `Cabin: ${segment.cabinLuggage}` : null,
              segment.checkInLuggage ? `Check-in: ${segment.checkInLuggage}` : null,
            ]
              .filter(Boolean)
              .join('  |  ');
            const hasBaggage = Boolean(baggage);
            const cardHeight = hasBaggage ? (noteText ? 228 : 196) : noteText ? 204 : 174;
            const contentBottom = cardTop + cardHeight;
            const measuredPage = computePageHeight(contentBottom - PDF_TOP_MARGIN);
            addContentPage(
              flightPage === 0 ? 'Flight Details' : undefined,
              measuredPage.pageHeight,
            );

            const sideWidth = 124;
            // Standalone journey label: plain bold navy text aligned to the
            // left edge of its card. No tab, border or container. The label
            // already carries the parent-flight prefix for multi-record
            // quotations (`FLIGHT DETAILS 1 · OUTBOUND`), keeping every
            // journey distinct without inventing any content.
            doc
              .font('Bold')
              .fontSize(13)
              .fillColor(NAVY)
              .text(label, M, top + 2, { width: CONTENT_W, lineBreak: false });
            // Flight content sits directly on the white page — no outer
            // container, border or background. All internal elements keep
            // their positions relative to cardTop.
            const airlineLogo = segment.airlineId
              ? input.images?.airlines?.[segment.airlineId]
              : null;
            if (!drawImage(airlineLogo, M + 17, cardTop + 14, 90, 54, 'contain')) {
              doc.rect(M + 17, cardTop + 14, 90, 54).fill('#f7f7f7');
              doc
                .font('Bold')
                .fontSize(11)
                .fillColor(RED)
                .text(clean(segment.airlineName) || 'AIRLINE', M + 17, cardTop + 34, {
                  width: 90,
                  align: 'center',
                  ellipsis: true,
                });
            }
            doc
              .font('Body')
              .fontSize(11)
              .fillColor(INK)
              .text(clean(segment.airlineName) || 'Airline', M + 10, cardTop + 78, {
                width: sideWidth - 20,
                align: 'center',
                height: 30,
                ellipsis: true,
              });
            doc
              .font('Body')
              .fontSize(10)
              .fillColor(MUTED)
              .text(clean(segment.flightNumber), M + 10, cardTop + 111, {
                width: sideWidth - 20,
                align: 'center',
              });
            pill(clean(segment.travelClass) || 'ECONOMY', M + 11, cardTop + cardHeight - 27, {
              fill: NAVY,
              color: '#ffffff',
              minWidth: sideWidth - 22,
              height: 18,
              size: 9,
            });

            const mainX = M + sideWidth;
            const mainW = CONTENT_W - sideWidth;
            const endpointWidth = 128;
            const departureX = mainX + 18;
            const arrivalX = mainX + mainW - endpointWidth - 18;
            doc
              .font('Body')
              .fontSize(9)
              .fillColor(MUTED)
              .text('DEPARTURE', departureX, cardTop + 15, {
                width: endpointWidth,
                align: 'center',
              });
            doc
              .font('Bold')
              .fontSize(9)
              .fillColor(NAVY)
              .text(
                clean(segment.from) || clean(journey.fromCity) || '-',
                departureX,
                cardTop + 29,
                {
                  width: endpointWidth,
                  height: 38,
                  align: 'center',
                  ellipsis: true,
                },
              );
            doc
              .font('Body')
              .fontSize(9)
              .fillColor(MUTED)
              .text('ARRIVAL', arrivalX, cardTop + 15, {
                width: endpointWidth,
                align: 'center',
              });
            doc
              .font('Bold')
              .fontSize(9)
              .fillColor(NAVY)
              .text(clean(segment.to) || clean(journey.toCity) || '-', arrivalX, cardTop + 29, {
                width: endpointWidth,
                height: 38,
                align: 'center',
                ellipsis: true,
              });
            const arcLeft = departureX + endpointWidth + 7;
            const arcRight = arrivalX - 7;
            const arcTop = cardTop + 27;
            doc
              .moveTo(arcLeft, arcTop + 15)
              .bezierCurveTo(
                arcLeft + 42,
                arcTop - 2,
                arcRight - 42,
                arcTop - 2,
                arcRight,
                arcTop + 15,
              )
              .lineWidth(1.4)
              .strokeColor(NAVY)
              .stroke();
            doc
              .circle(arcLeft, arcTop + 15, 3)
              .fill(NAVY)
              .circle(arcRight, arcTop + 15, 3)
              .fill(NAVY);
            const flightIconSize = 14;
            const flightIconX = (arcLeft + arcRight) / 2 - flightIconSize / 2;
            const flightIconY = arcTop - 6;
            doc
              .circle(flightIconX + flightIconSize / 2, flightIconY + flightIconSize / 2, 8)
              .fill('#ffffff');
            drawImage(
              STYLISH_SERVICE_ICONS.Flights,
              flightIconX,
              flightIconY,
              flightIconSize,
              flightIconSize,
              'contain',
              // The transparent aircraft artwork is wider than its body. A
              // circular image mask clips the wings and tail on the route arc.
              0,
            );
            doc
              .font('Bold')
              .fontSize(9)
              .fillColor(NAVY)
              .text(clean(segment.duration), (arcLeft + arcRight) / 2 - 30, arcTop + 15, {
                width: 60,
                align: 'center',
              });
            doc
              .moveTo(mainX + 15, cardTop + 75)
              .lineTo(mainX + mainW - 15, cardTop + 75)
              .lineWidth(0.5)
              .strokeColor(LINE)
              .stroke();
            const timing = [
              [
                'DEPARTS',
                segment.departureTime ? formatClock12Hour(segment.departureTime) : '-',
                date(segment.departureDate, true),
              ],
              [
                'ARRIVES',
                segment.arrivalTime ? formatClock12Hour(segment.arrivalTime) : '-',
                date(segment.arrivalDate, true),
              ],
            ] as const;
            timing.forEach(([key, value, dateValue], index) => {
              const left = index === 0 ? departureX : arrivalX;
              doc
                .font('Body')
                .fontSize(9)
                .fillColor(MUTED)
                .text(key, left, cardTop + 86, { width: endpointWidth, align: 'center' });
              doc
                .font('Bold')
                .fontSize(16)
                .fillColor(NAVY)
                .text(value, left, cardTop + 101, {
                  width: endpointWidth,
                  align: 'center',
                  lineBreak: false,
                });
              doc
                .font('Body')
                .fontSize(9)
                .fillColor(INK)
                .text(dateValue, left, cardTop + 125, { width: endpointWidth, align: 'center' });
            });

            if (hasBaggage || noteText)
              doc
                .moveTo(mainX + 15, cardTop + 150)
                .lineTo(mainX + mainW - 15, cardTop + 150)
                .lineWidth(0.5)
                .strokeColor(LINE)
                .stroke();
            if (hasBaggage)
              doc
                .font('Body')
                .fontSize(10)
                .fillColor(INK)
                .text(`Baggage: ${baggage}`, mainX + 18, cardTop + 163, {
                  width: mainW - 36,
                });
            if (noteText)
              doc
                .font('Body')
                .fontSize(10)
                .fillColor(MUTED)
                .text(`Note: ${noteText}`, mainX + 18, cardTop + (hasBaggage ? 188 : 163), {
                  width: mainW - 36,
                  height: 29,
                  ellipsis: true,
                });
            flightPage += 1;
          }
        }
      }
    }
  };

  // Hotels -----------------------------------------------------------------
  const drawHotelsSection = () => {
    const selectedHotels = input.version.hotels
      .map((hotel, index) => ({ hotel, index }))
      .filter(({ hotel }) => hotel.selected);
    if (!selectedHotels.length) return;
    const IMAGE_TOP_OFF = 11;
    // Hotel photo size: +25% over the previous 138x159 rendering.
    const IMAGE_W = 172.5;
    const IMAGE_H = 198.75;
    const infoX = M + 17 + IMAGE_W + 13;
    const textW = CONTENT_W - (infoX - M) - 10;
    const HOTEL_GAP = 30;

    // Minimal vector calendar glyph (outline + hanger ticks + centre dot).
    const drawCalendarIcon = (x: number, top: number, size: number, color: string) => {
      doc
        .save()
        .roundedRect(x, top, size, size, size * 0.18)
        .lineWidth(1.4)
        .strokeColor(color)
        .stroke()
        .restore();
      doc
        .save()
        .moveTo(x + 2, top + size * 0.34)
        .lineTo(x + size - 2, top + size * 0.34)
        .lineWidth(1.1)
        .strokeColor(color)
        .stroke()
        .restore();
      doc
        .save()
        .lineWidth(1.4)
        .strokeColor(color)
        .moveTo(x + size * 0.3, top - 1.5)
        .lineTo(x + size * 0.3, top + size * 0.22)
        .moveTo(x + size * 0.7, top - 1.5)
        .lineTo(x + size * 0.7, top + size * 0.22)
        .stroke()
        .restore();
      doc.save().fillColor(color).circle(x + size / 2, top + size * 0.66, 1.7).fill().restore();
    };

    // Real saved dates only: missing or invalid stays absent (never
    // "As advised", never invented).
    const stayDate = (value: unknown): string | null => {
      if (value == null || String(value).trim() === '') return null;
      const formatted = date(value as Date | string, false);
      return formatted === 'As advised' ? null : formatted;
    };

    type HotelBlock = {
      hotel: (typeof selectedHotels)[number]['hotel'];
      index: number;
      starCount: number;
      nameH: number;
      address: string;
      addressH: number;
      checkIn: string | null;
      checkOut: string | null;
      roomTexts: string[];
      blockH: number;
    };
    // Measure every listing up front so page breaks are decided by actual
    // rendered height. Nothing is shrunk to fit.
    const blocks: HotelBlock[] = selectedHotels.map(({ hotel, index }) => {
      const presentation = input.hotelPresentations?.[index];
      const categoryStars = Number.parseInt(hotel.category ?? '', 10);
      const starCount = Math.max(
        0,
        Math.min(
          5,
          presentation?.starCategory ?? (Number.isFinite(categoryStars) ? categoryStars : 0),
        ),
      );
      doc.font('Bold').fontSize(15);
      const nameH = Math.max(19, doc.heightOfString(hotel.hotelName.trim(), { width: textW }));
      const address = presentation?.address?.trim() ?? '';
      let addressH = 0;
      if (address) {
        doc.font('Body').fontSize(8.5);
        addressH = doc.heightOfString(address, { width: textW });
      }
      const checkIn = stayDate(hotel.checkInDate);
      const checkOut = stayDate(hotel.checkOutDate);
      const roomLines = resolveHotelRoomLines(hotel);
      const mealLines = resolveHotelMealPlanLines(hotel);
      const roomTexts: string[] = [];
      const numbered = roomLines.length > 1;
      roomLines.forEach((line, j) => {
        const name = (line.roomType ?? '').trim() || 'Room';
        // Counts only — no per-item prices on the customer-facing PDF.
        const bits = [numbered ? `${j + 1}. ${name}` : name];
        if (line.rooms != null) bits.push(`${line.rooms} Room${line.rooms === 1 ? '' : 's'}`);
        if (line.extraBedQuantity) bits.push(`Extra Bed: ${line.extraBedQuantity}`);
        if (line.childWithoutBedQuantity) bits.push(`Child W/O Bed: ${line.childWithoutBedQuantity}`);
        roomTexts.push(bits.join(' – '));
      });
      if (mealLines.length > 1) {
        mealLines.forEach((line, j) => {
          roomTexts.push(`Meal Plan ${j + 1}: ${(line.mealPlan ?? '').trim()}`);
        });
      } else if (mealLines.length === 1 && (mealLines[0]?.mealPlan ?? '').trim()) {
        roomTexts.push(`Meal Plan: ${(mealLines[0]?.mealPlan ?? '').trim()}`);
      }
      doc.font('Body').fontSize(9);
      let roomsH = 0;
      for (const text of roomTexts) roomsH += doc.heightOfString(text, { width: textW }) + 4;
      let contentH = 13 + nameH + 6;
      if (starCount) contentH += 5 + 16;
      if (address) contentH += addressH + 10;
      if (checkIn || checkOut) contentH += 30 + 12;
      contentH += roomsH;
      return {
        hotel,
        index,
        starCount,
        nameH,
        address,
        addressH,
        checkIn,
        checkOut,
        roomTexts,
        blockH: Math.max(IMAGE_TOP_OFF + IMAGE_H, contentH),
      };
    });

    const drawBlock = (block: HotelBlock, top: number): number => {
      const { hotel, index } = block;
      let cy = top + 13;
      if (!drawImage(input.images?.hotels?.[index], M + 17, top + IMAGE_TOP_OFF, IMAGE_W, IMAGE_H)) {
        doc.roundedRect(M + 17, top + IMAGE_TOP_OFF, IMAGE_W, IMAGE_H, 7).fill('#e7edf4');
        drawEmoji('🏨', M + 86, top + 93, 34);
      }
      doc
        .font('Bold')
        .fontSize(15)
        .fillColor(NAVY)
        .text(hotel.hotelName.trim(), infoX, cy, { width: textW });
      cy += block.nameH;
      if (block.starCount) {
        doc
          .font('Bold')
          .fontSize(13)
          .fillColor(GOLD)
          .text('★'.repeat(block.starCount), infoX, cy + 5, { width: textW });
        cy += 5 + 16;
      }
      cy += 6;
      if (block.address) {
        doc.font('Body').fontSize(8.5).fillColor(INK).text(block.address, infoX, cy, { width: textW });
        cy += block.addressH;
        cy += 10;
      }
      if (block.checkIn || block.checkOut) {
        const colW = textW / 2;
        const drawDateCol = (x: number, label: string, value: string, iconColor: string) => {
          drawCalendarIcon(x, cy + 5, 18, iconColor);
          doc.font('Body').fontSize(8.5).fillColor(INK).text(label, x + 24, cy, { width: colW - 24 });
          doc.font('Bold').fontSize(14).fillColor(NAVY).text(value, x + 24, cy + 12, { width: colW - 24 });
        };
        if (block.checkIn && block.checkOut) {
          drawDateCol(infoX, 'Check-in', block.checkIn, TEAL);
          const dividerX = infoX + colW;
          doc
            .moveTo(dividerX, cy + 2)
            .lineTo(dividerX, cy + 28)
            .lineWidth(0.7)
            .strokeColor(LINE)
            .stroke();
          drawDateCol(infoX + colW + 16, 'Check-out', block.checkOut, GOLD);
        } else if (block.checkIn) {
          drawDateCol(infoX, 'Check-in', block.checkIn, TEAL);
        } else if (block.checkOut) {
          drawDateCol(infoX, 'Check-out', block.checkOut, GOLD);
        }
        cy += 30;
        cy += 12;
      }
      doc.font('Body').fontSize(9).fillColor(INK);
      for (const text of block.roomTexts) {
        if (cy + 12 > bodyBottom()) {
          addContentPage('Hotel Accommodations');
          cy = y;
        }
        const need = doc.heightOfString(text, { width: textW });
        if (cy + need > bodyBottom()) {
          addContentPage('Hotel Accommodations');
          cy = y;
        }
        doc.text(text, infoX, cy, { width: textW });
        cy += need + 4;
      }
      return Math.max(top + IMAGE_TOP_OFF + IMAGE_H, cy);
    };
    let firstHotelPage = true;
    let yy = 0;
    let hotelPageHasContent = false;
    const startHotelPage = (): number => {
      addContentPage('Hotel Accommodations');
      hotelPageHasContent = false;
      return y;
    };
    for (const block of blocks) {
      if (firstHotelPage) {
        yy = startHotelPage();
        firstHotelPage = false;
      } else if (hotelPageHasContent && yy + HOTEL_GAP + block.blockH > bodyBottom()) {
        // The whole listing moves to a fresh A4 page — never squeezed, never
        // overlapping the footer or the next listing.
        yy = startHotelPage();
      } else {
        if (hotelPageHasContent) yy += HOTEL_GAP;
      }
      yy = drawBlock(block, yy);
      hotelPageHasContent = true;
    }
    y = yy + 10;
  };

  // Day-wise itinerary -----------------------------------------------------
  const drawItinerarySection = () => {
    const sightseeing = input.version.sightseeingDetails as {
      include?: boolean;
      days?: SightDay[];
    } | null;
    const days: SightDay[] =
      sightseeing?.include && sightseeing.days?.length
        ? sightseeing.days
        : input.version.itinerary.map((day) => ({
            dayNumber: day.dayNumber,
            title: day.title,
            city: day.destination,
            mealsText: day.meals,
            activities: [{ name: day.title, description: day.description }],
          }));
    // Outline calendar glyph with hanger ticks, header line and a small
    // date grid — used by the day badge and the travel-date rows.
    const drawBadgeCalendar = (x: number, top: number, size: number, color: string) => {
      const lw = Math.max(1, size * 0.075);
      doc
        .save()
        .roundedRect(x, top, size, size, size * 0.2)
        .lineWidth(lw)
        .strokeColor(color)
        .stroke()
        .restore();
      doc
        .save()
        .moveTo(x + size * 0.12, top + size * 0.34)
        .lineTo(x + size * 0.88, top + size * 0.34)
        .lineWidth(Math.max(1, size * 0.06))
        .strokeColor(color)
        .stroke()
        .restore();
      doc
        .save()
        .lineWidth(Math.max(1, size * 0.07))
        .strokeColor(color)
        .moveTo(x + size * 0.3, top - size * 0.08)
        .lineTo(x + size * 0.3, top + size * 0.22)
        .moveTo(x + size * 0.7, top - size * 0.08)
        .lineTo(x + size * 0.7, top + size * 0.22)
        .stroke()
        .restore();
      // 2x2 date-grid marks in the lower half.
      const dotR = Math.max(0.9, size * 0.05);
      const gridCx = x + size / 2;
      const gridCy = top + size * 0.64;
      const gridGap = size * 0.16;
      doc.save().fillColor(color);
      for (const ox of [-gridGap / 2, gridGap / 2]) {
        for (const oy of [-gridGap / 2, gridGap / 2]) {
          doc.circle(gridCx + ox, gridCy + oy, dotR).fill();
        }
      }
      doc.restore();
    };
    // Intelligent pagination: consecutive days share a page whenever the
    // whole next day (details + complete description) fits in the remaining
    // space. Heights are measured, never shrunk: a day that cannot fit moves
    // whole to a fresh A4 page (heading never stranded), and a day taller
    // than a page flows its description across standard A4 pages.
    let itinFirstDay = true;
    let yy = 0; // cursor on the current itinerary page
    let itinPageHasContent = false;
    const startItinPage = (withTitle: boolean): number => {
      addContentPage(withTitle ? 'Day Wise Itinerary' : undefined);
      itinPageHasContent = false;
      return withTitle ? 132 : 85;
    };
    for (const [dayIndex, day] of days.entries()) {
      const activities = day.activities?.length
        ? day.activities
        : [{ name: day.title ?? `Day ${day.dayNumber}`, description: '' }];
      for (const activity of activities) {
        const richDescription = htmlToRichTextLines(activity.description);
        const bodySize = 9;
        const bodyWidth = CONTENT_W - 54;
        const bodyFactor = 1.38;
        // DISPLAY-ONLY pricing snapshot — never feeds totals
        const displayPricingRaw = (activity as unknown as { displayPricing?: unknown }).displayPricing as
          | Array<{ label?: string | null; price?: number | string | null; enabled?: boolean }>
          | undefined;
        const displayPricingRows = Array.isArray(displayPricingRaw)
          ? displayPricingRaw
              .filter(
                (r) =>
                  r.enabled !== false &&
                  String(r.label ?? '').trim() &&
                  r.price != null &&
                  r.price !== '' &&
                  Number(r.price) >= 0,
              )
              .map((r) => ({ label: String(r.label).trim(), price: Number(r.price) }))
          : [];
        const displayPricingHeading =
          String((activity as unknown as { displayPricingHeading?: unknown }).displayPricingHeading ?? '').trim() || 'PRICING';
        let displayPricingLines: PdfRichTextLine[] = [];
        if (displayPricingRows.length) {
          const pricingHtml = `<p><strong>${displayPricingHeading}</strong></p><p>${displayPricingRows
            .map(
              (r) =>
                `${r.label}: ₹${r.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            )
            .join(' · ')}</p>`;
          displayPricingLines = htmlToRichTextLines(pricingHtml);
        }
        // Measure the complete day up front (details + title + description +
        // pricing + the gap that would precede it) so placement is decided by
        // actual rendered height. Nothing is shrunk to fit.
        const activityTitle = clean(activity.name);
        const shouldShowActivityTitle =
          !!activityTitle && !isItineraryActivityTitleDuplicate(day.title, activityTitle);
        const titleH = shouldShowActivityTitle ? 28 : 0;
        // Approved header layout (badge, title, date row, meals, transfer
        // pill): measured here, drawn below.
        const dayNum = day.dayNumber ?? dayIndex + 1;
        doc.font('Bold').fontSize(13);
        const badgeW = 28 + doc.widthOfString(`Day ${dayNum}`) + 10;
        const dayX = M + 12 + 198 + 18;
        const titleW = W - M - dayX - 10;
        const dayStrippedRaw = stripItineraryDayPrefixes(day.title);
        const displayTitle = dayStrippedRaw || `Day ${day.dayNumber}`;
        doc.font('Bold').fontSize(17);
        const headingH = Math.max(22, doc.heightOfString(displayTitle, { width: titleW }));
        const rawDate = day.date ? date(day.date, true) : null;
        const dateStr = rawDate && rawDate !== 'As advised' ? rawDate : null;
        const cityStr = (day.city ?? '').trim() || null;
        const hasDateRow = Boolean(dateStr || cityStr);
        const mealText =
          day.mealsText ||
          (day.meals?.breakfast
            ? `Breakfast (${day.mealMode === 'NO_TRANSFER' ? 'No Transfer' : 'Hotel'})`
            : null) ||
          (day.meals?.lunch ? 'Lunch' : null) ||
          (day.meals?.dinner ? 'Dinner' : null);
        doc.font('Bold').fontSize(9);
        const mealLabelW = mealText ? doc.widthOfString('Meals:') : 0;
        const mealTextW = titleW - mealLabelW - 20;
        doc.font('Body').fontSize(9);
        const mealsH = mealText ? Math.max(14, doc.heightOfString(mealText, { width: mealTextW })) : 0;
        const transfer = transferLabel(activity.dailyTransfer ?? day.dailyTransfer);
        let detailsH = 16 + headingH + 8;
        if (hasDateRow) detailsH += 18 + 8;
        if (mealText) detailsH += mealsH + 8;
        if (transfer) detailsH += 20 + 8;
        detailsH -= 8; // no trailing gap before the description
        const descTopOff = Math.max(12 + 170, detailsH) + 14;
        let descH = 0;
        for (const line of richDescription) {
          const need = measureRichHeight([line], bodyWidth, bodySize, bodyFactor);
          if (need > 0) descH += need;
        }
        let priceH = 0;
        if (displayPricingLines.length) {
          priceH += 8;
          for (const line of displayPricingLines) {
            const need = measureRichHeight([line], bodyWidth, bodySize, bodyFactor);
            if (need > 0) priceH += need;
          }
        }
        const blockH = descTopOff + titleH + descH + priceH;
        let top: number;
        if (itinFirstDay) {
          top = startItinPage(true);
          itinFirstDay = false;
        } else if (itinPageHasContent && yy + ITIN_DAY_GAP + blockH > bodyBottom()) {
          // The whole day moves to a fresh A4 page — never squeezed, never
          // leaving its heading stranded at the bottom of this page.
          top = startItinPage(false);
        } else {
          if (itinPageHasContent) yy += ITIN_DAY_GAP;
          top = yy;
        }
        // Day details sit directly on the white page — approved header with
        // badge, title, date/destination, meals and transport pill. The image
        // keeps its rounded corners; fallbacks are unchanged.
        // Priority 1 — the day's own image (saved snapshot, then master).
        const activityImage =
          (activity.imageDocumentId
            ? input.images?.itineraryDocuments?.[activity.imageDocumentId]
            : null) ??
          (activity.imageUrl ? input.images?.itinerary?.[activity.imageUrl] : null) ??
          (activity.sightseeingId ? input.images?.sightseeing?.[activity.sightseeingId] : null);
        // Priority 2 — the relevant destination's saved image for this day
        // (multi-destination safe: never another destination's cover). Days
        // without an attributable city keep the existing cover behaviour.
        // An explicitly emptied day gallery also falls back to the matching
        // destination image when one is available.
        const dayCityKey = (day.city ?? '').trim().toLowerCase();
        const dayDestinationImage = dayCityKey
          ? (input.images?.destinationImages?.[dayCityKey] ?? null)
          : (input.images?.cover ?? null);
        const imageValue = activityImage ?? dayDestinationImage ?? null;
        if (!drawImage(imageValue, M + 12, top + 12, 198, 170, 'cover', 10)) {
          // A day image that exists but cannot be decoded falls back to the
          // destination image before the generic placeholder (Priority 3).
          const renderFallback =
            imageValue && dayDestinationImage && imageValue !== dayDestinationImage
              ? drawImage(dayDestinationImage, M + 12, top + 12, 198, 170, 'cover', 10)
              : false;
          if (!renderFallback) {
            doc.roundedRect(M + 12, top + 12, 198, 170, 10).fill('#e3ebf3');
            drawEmoji('🌍', M + 90, top + 76, 42);
          }
        }
        // Approved day badge: navy plate over a gold accent layer, calendar
        // glyph and automatic "Day N" label, overlapping the image corner.
        const badgeX = M + 12 - 12;
        const badgeY = top + 12 - 10;
        const badgeH = 30;
        doc.save().roundedRect(badgeX + 3, badgeY + 4, badgeW, badgeH, 7).fill(GOLD).restore();
        doc.save().roundedRect(badgeX, badgeY, badgeW, badgeH, 7).fill(NAVY).restore();
        drawBadgeCalendar(badgeX + 10, badgeY + 8, 14, '#ffffff');
        doc
          .font('Bold')
          .fontSize(13)
          .fillColor('#ffffff')
          .text(`Day ${dayNum}`, badgeX + 30, badgeY + 7, {
            width: badgeW - 30 - 8,
            lineBreak: false,
          });
        // Approved header: bold navy title, date | destination row, meals
        // row and transport pill — all directly on the white page.
        let cy = top + 16;
        doc.font('Bold').fontSize(17).fillColor(NAVY).text(displayTitle, dayX, cy, { width: titleW });
        cy += headingH + 8;
        if (hasDateRow) {
          let dx = dayX;
          if (dateStr) {
            drawBadgeCalendar(dx, cy + 1, 14, MUTED);
            doc.font('Body').fontSize(9).fillColor(MUTED);
            doc.text(dateStr, dx + 20, cy, { width: titleW, lineBreak: false });
            dx += 20 + doc.widthOfString(dateStr) + 10;
          }
          if (dateStr && cityStr) {
            doc
              .moveTo(dx, cy + 2)
              .lineTo(dx, cy + 14)
              .lineWidth(0.8)
              .strokeColor(LINE)
              .stroke();
            dx += 12;
          }
          if (cityStr) {
            const pinCx = dx + 7;
            doc.save().circle(pinCx, cy + 5, 4).lineWidth(1.2).strokeColor(MUTED).stroke().restore();
            doc
              .save()
              .moveTo(pinCx - 3, cy + 7.5)
              .lineTo(pinCx, cy + 13)
              .lineTo(pinCx + 3, cy + 7.5)
              .closePath()
              .fillColor(MUTED)
              .fill()
              .restore();
            doc.save().fillColor(MUTED).circle(pinCx, cy + 5, 1.3).fill().restore();
            doc.font('Body').fontSize(9).fillColor(MUTED).text(cityStr, dx + 18, cy, { width: titleW });
          }
          cy += 18 + 8;
        }
        if (mealText) {
          doc.font('Bold').fontSize(9).fillColor(NAVY).text('Meals:', dayX, cy, { width: mealLabelW + 2 });
          const dotCx = dayX + mealLabelW + 10;
          doc.save().fillColor(GOLD).circle(dotCx + 2, cy + 5, 4).fill().restore();
          doc.font('Body').fontSize(9).fillColor(INK).text(mealText, dotCx + 10, cy, { width: mealTextW });
          cy += mealsH + 8;
        }
        if (transfer) {
          pill(transfer, dayX, cy, { minWidth: 92, height: 20, size: 6.5 });
          cy += 20 + 8;
        }
        cy -= 8; // mirror the measured layout: no trailing gap
        yy = top + Math.max(12 + 170, cy - top) + 14;

        // Description sits directly on the white page below the day
        // details. Rich-text structure and styling are untouched; long copy
        // paginates onto follow-up pages instead of clipping or overlapping
        // the footer.
        itinPageHasContent = true;
        if (shouldShowActivityTitle) {
          const titleH = 22;
          if (yy + titleH + 6 > bodyBottom()) {
            addContentPage(undefined);
            yy = y;
          }
          doc
            .font('Bold')
            .fontSize(11.5)
            .fillColor(NAVY)
            .text(activityTitle, ITIN_TEXT_LEFT, yy, {
              width: bodyWidth,
              height: titleH,
              ellipsis: true,
            });
          yy += titleH + 6;
        }
        for (const line of richDescription) {
          const need = measureRichHeight([line], bodyWidth, bodySize, bodyFactor);
          if (need <= 0) continue;
          if (yy + need > bodyBottom()) {
            addContentPage(undefined);
            yy = y;
          }
          yy = drawRichLines([line], ITIN_TEXT_LEFT, yy, bodyWidth, bodySize, INK, bodyFactor);
        }
        if (displayPricingLines.length) {
          yy += 8;
          for (const line of displayPricingLines) {
            const need = measureRichHeight([line], bodyWidth, bodySize, bodyFactor);
            if (need <= 0) continue;
            if (yy + need > bodyBottom()) {
              addContentPage(undefined);
              yy = y;
            }
            yy = drawRichLines([line], ITIN_TEXT_LEFT, yy, bodyWidth, bodySize, INK, bodyFactor);
          }
        }
      }
    }
    if (!itinFirstDay) y = yy + 10;
  };

  // Travel services and add-ons -------------------------------------------
  const serviceRows = input.version.services
    .map((service, index) => ({ service, index }))
    .filter(
      ({ service }) =>
        !service.addOnServiceId &&
        service.serviceType !== 'OTHER_ADD_ON' &&
        !['FLIGHT', 'HOTEL', 'SIGHTSEEING'].includes(service.serviceType),
    )
    .sort((left, right) => {
      const rank = (type: string) => (type === 'VEHICLE_TRANSFER' ? 0 : type === 'CRUISE' ? 1 : 2);
      return rank(left.service.serviceType) - rank(right.service.serviceType);
    });
  const addOns = input.version.services
    .map((service, index) => ({ service, index }))
    .filter(({ service }) => Boolean(service.addOnServiceId));
  const serviceGroupOf = (type: string) =>
    type === 'VEHICLE_TRANSFER' ? 'vehicle' : type === 'CRUISE' ? 'cruise' : 'other';
  const drawServiceGroup = (group: 'vehicle' | 'cruise' | 'other') => {
    const rows = serviceRows.filter(({ service }) => serviceGroupOf(service.serviceType) === group);
    if (!rows.length) return;
    const servicesTitle =
      group === 'vehicle'
        ? rows[0]!.service.taxCategory?.trim() || 'Transportation'
        : group === 'cruise'
          ? 'Cruise Details'
          : 'Travel Services';
    const addServicePage = (cardsRemaining: number) => {
      const cardsOnPage = Math.min(3, cardsRemaining);
      const contentBottom = 133 + cardsOnPage * 204;
      return addContentPage(
        servicesTitle,
        computePageHeight(contentBottom - PDF_TOP_MARGIN).pageHeight,
      );
    };
    addServicePage(rows.length);
    for (const [rowInGroup, { service, index }] of rows.entries()) {
      if (rowInGroup > 0 && rowInGroup % 3 === 0) {
        addServicePage(rows.length - rowInGroup);
      }
      const top = y;
      // Listings sit directly on the white page — no outer card, border,
      // background or shadow. Internal elements keep their positions.
      // Vehicle/cruise photos render +40% over the previous 157x110 size.
      const imageLeft = true;
      const imageX = imageLeft ? M + 11 : W - M - 168;
      const imageW = 219.8;
      const imageTop = top + 35;
      const imageHeight = 154;
      const imageMode = ['VEHICLE_TRANSFER', 'CRUISE'].includes(service.serviceType)
        ? 'contain'
        : 'cover';
      if (
        !drawImage(
          input.images?.services?.[index],
          imageX,
          imageTop,
          imageW,
          imageHeight,
          imageMode,
        )
      ) {
        doc.roundedRect(imageX, imageTop, imageW, imageHeight, 10).fill('#e5edf4');
        drawEmoji(service.serviceType === 'CRUISE' ? '🚢' : '🚌', imageX + 90, imageTop + 57, 40);
      }
      const tabWidth = 92;
      const tabX = imageLeft ? imageX : imageX + imageW - tabWidth;
      doc.roundedRect(tabX, top + 7, tabWidth, 22, 6).fill(NAVY);
      doc
        .font('Bold')
        .fontSize(6.5)
        .fillColor('#ffffff')
        .text(
          (service.serviceType === 'VEHICLE_TRANSFER'
            ? service.taxCategory?.trim() || 'Transportation'
            : serviceLabel(service.serviceType)
          ).toUpperCase(),
          tabX,
          top + 15,
          {
            width: tabWidth,
            align: 'center',
          },
        );
      const textX = imageLeft ? imageX + imageW + 20 : M + 20;
      const textW = CONTENT_W - (textX - M) - 22;
      doc
        .font('Bold')
        .fontSize(12)
        .fillColor(NAVY)
        .text(service.name, textX, top + 38, {
          width: textW,
          height: 30,
          ellipsis: true,
        });
      // CRUISE: show room lines (joined) as primary cabin tag, duration as secondary tag
      const cruiseNightsVal = (service as unknown as { cruiseNights?: number | null }).cruiseNights;
      const cruiseRoomLinesVal = resolveCruiseRoomLines(service as unknown as Parameters<typeof resolveCruiseRoomLines>[0]);
      const isCruise = service.serviceType === 'CRUISE';
      const cruisePrimaryTag = isCruise && cruiseRoomLinesVal.length
        ? cruiseRoomLinesVal.map((l) => `${(l.roomType ?? '').trim() || 'Room'}${l.rooms !== 1 ? ` ×${l.rooms}` : ''}`).join(' · ')
        : clean(service.city);
      const cruiseSecondaryTag = isCruise && cruiseNightsVal != null && Number(cruiseNightsVal) > 0
        ? `${cruiseNightsVal} Nights · ${Number(cruiseNightsVal) + 1} Days`
        : clean(service.notes);
      let tagX = textX;
      const primaryTag = isCruise ? cruisePrimaryTag : clean(service.city);
      if (primaryTag)
        tagX += pill(primaryTag, tagX, top + 78, { minWidth: 64, height: 19, size: 6.5 }) + 8;
      const secondaryTag = service.serviceType === 'VEHICLE_TRANSFER'
        ? clean(service.notes)
        : service.serviceType === 'CRUISE'
          ? cruiseSecondaryTag
          : asNumber(service.quantity) > 0
            ? clean(service.quantity)
            : '';
      if (secondaryTag)
        pill(secondaryTag, tagX, top + 78, {
          fill: '#fff2d2',
          color: '#a16a00',
          minWidth: 40,
          height: 18,
          size: 6.5,
        });
      doc
        .font('Body')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(htmlToLines(service.description || service.notes).join(' '), textX, top + 108, {
          width: textW,
          height: 28,
          ellipsis: true,
        });
      y = top + 204;
    }
  };

  const drawAddonsSection = () => {
    // Visa renders only when it carries actual content (amount/charges or
    // destination/type), not merely when the visa section flag is set. This
    // mirrors the Classic PDF definition and stops an empty Visa card from
    // generating a blank "Add-On Services" page.
    const visaNumber = (value: unknown): number => {
      if (value == null) return 0;
      if (typeof value === 'number') return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const hasVisaContent =
      visaNumber(input.version.visaAmount) > 0 ||
      visaNumber(input.version.visaServiceCharge) > 0 ||
      Boolean(input.version.visaType) ||
      Boolean(input.version.visaDestination);
    const hasVisaCard =
      input.version.includeVisa &&
      hasVisaContent &&
      !addOns.some(({ service }) => /visa/i.test(service.name));
    if (addOns.length || hasVisaCard) {
      const versionCurrency = input.version.currency;
      const cards: Array<{
        name: string;
        description: string;
        index: number | null;
        boxes: AddonPricingBox[];
      }> = [
        ...addOns.map(({ service, index }) => ({
          name: service.name,
          description: clean(service.description) || clean(service.notes),
          index,
          boxes: addonPricingBoxes(service, versionCurrency),
        })),
        ...(hasVisaCard
          ? [
              {
                name: input.version.visaSectionTitle || 'Visa',
                description: [input.version.visaDestination, input.version.visaType]
                  .filter(Boolean)
                  .join(' · '),
                index: null,
                boxes: [] as AddonPricingBox[],
              },
            ]
          : []),
      ];
      // Add-on snapshot image per service row (same inputs.services index as the
      // vehicle/cruise cards). Rows without a resolved image keep the legacy
      // text-only card untouched. Images render +40% over the previous
      // 150x110 size.
      const ADDON_IMAGE_W = 210;
      const ADDON_IMAGE_H = 154;
      const ADDON_IMAGE_GAP = 16;
      const ADDON_TITLE_X = 78;
      const measuredCards = cards.map((card) => {
        const image = card.index != null ? (input.images?.services?.[card.index] ?? null) : null;
        const textW = image ? CONTENT_W - 60 - ADDON_IMAGE_W - ADDON_IMAGE_GAP : CONTENT_W - 60;
        // Full add-on title: wrapping, measured, never truncated.
        doc.font('Bold').fontSize(15);
        const titleW = CONTENT_W - ADDON_TITLE_X - 10;
        const titleH = Math.max(19, doc.heightOfString(card.name, { width: titleW }));
        const titleBlockH = Math.max(34, titleH);
        const contentTopOff = titleBlockH + 12;
        // Pre-wrap and measure exactly like drawRichLines so the card height
        // matches the real content; an estimated height can undershoot and push
        // long copy into the footer.
        const lines = wrapRichLinesToWidth(htmlToRichTextLines(card.description), textW, 10, 1.32);
        const descriptionHeight = measureRichHeight(lines, textW, 10, 1.32);
        const bodyHeight = image ? Math.max(descriptionHeight, ADDON_IMAGE_H) : descriptionHeight;
        // Quotation-owned pricing snapshot as compact bordered tiles below the
        // description. Legacy cards (no boxes) keep their exact old height.
        const gridH = addonPricingGridHeight(card.boxes.length);
        return {
          ...card,
          lines,
          image,
          textW,
          gridH,
          titleW,
          titleBlockH,
          contentTopOff,
          height: Math.min(610, Math.max(150, contentTopOff + bodyHeight + gridH + 20)),
        };
      });
      for (const [cardIndex, card] of measuredCards.entries()) {
        // A dedicated page per service gives customer-facing copy enough room
        // to stay legible and prevents a short follow-up card being stranded at
        // the bottom of an already dense page.
        const contentBottom = 133 + card.height;
        const pageHeight =
          contentBottom <= BODY_BOTTOM
            ? computePageHeight(contentBottom - PDF_TOP_MARGIN).pageHeight
            : H;
        addContentPage('Add-On Services', pageHeight);
        const top = y;
        // Number disc plus full wrapping title directly on the white page —
        // no navy banner, no gold rule, no truncation. Image, description
        // and pricing keep their order below the title.
        doc.circle(M + 47, top + 17, 17).fill(GOLD);
        doc
          .font('Bold')
          .fontSize(11)
          .fillColor(NAVY)
          .text(String(cardIndex + 1).padStart(2, '0'), M + 32, top + 10, {
            width: 30,
            align: 'center',
            lineBreak: false,
          });
        doc
          .font('Bold')
          .fontSize(15)
          .fillColor(NAVY)
          .text(card.name, M + ADDON_TITLE_X, top + 8, {
            width: card.titleW,
          });
        const cardLineHeight = 10 * 1.32;
        const textX = M + 30 + (card.image ? ADDON_IMAGE_W + ADDON_IMAGE_GAP : 0);
        const contentTop = top + card.contentTopOff;
        if (card.image) {
          if (!drawImage(card.image, M + 30, contentTop, ADDON_IMAGE_W, ADDON_IMAGE_H, 'cover', 8)) {
            doc
              .save()
              .roundedRect(M + 30, contentTop, ADDON_IMAGE_W, ADDON_IMAGE_H, 8)
              .fill('#e5edf4')
              .restore();
          }
        }
        const onCard = card.lines.slice(
          0,
          Math.max(
            0,
            Math.floor((card.height - card.contentTopOff - (card.gridH ? card.gridH + 8 : 0)) / cardLineHeight),
          ),
        );
        drawRichLines(onCard, textX, contentTop, card.textW, 10, INK, 1.32);
        if (card.boxes.length)
          drawAddonPricingGrid(
            doc,
            card.boxes,
            textX,
            contentTop + onCard.length * cardLineHeight + 8,
            card.textW,
          );
        y = top + card.height + 14;
        // A description taller than the card flows onto continuation pages as
        // plain text under the same heading, so it can never be drawn into the
        // footer area or clipped.
        for (let i = onCard.length; i < card.lines.length; ) {
          addContentPage('Add-On Services');
          const perPage = Math.max(1, Math.floor((bodyBottom() - y - 10) / cardLineHeight));
          const chunk = card.lines.slice(i, i + perPage);
          y = drawRichLines(chunk, M + 30, y, CONTENT_W - 60, 10, INK, 1.32) + 10;
          i += chunk.length;
        }
      }
    }
  };

  // Customer notes belong near the end of the proposal and remain fully
  // paginated before Policies and the final Thank You page. Notes travel with
  // the policies step so they keep their designed adjacency under any order.
  const drawPoliciesSection = () => {
    drawCustomerCopy('Notes for Customer', input.version.notes);

    // Policies ---------------------------------------------------------------
    const policies = [
      ['INCLUSIONS', GREEN, input.version.inclusionsHtml, input.version.inclusions],
      ['EXCLUSIONS', RED, input.version.exclusionsHtml, input.version.exclusions],
      ['CHILD POLICY', GREEN, input.version.childPolicy, []],
      ['PAYMENT POLICIES', NAVY, input.version.paymentPolicies, []],
      ['CANCELLATION POLICIES', NAVY, input.version.cancellationPolicies, []],
      ['BOOKING TERMS & CONDITIONS', NAVY, input.version.bookingTerms, input.version.terms],
    ] as const;
    const visiblePolicies = policies
      .map(([title, color, html, rows]) => ({
        title,
        color,
        lines: html
          ? htmlToRichTextLines(html)
          : rows.map((row) => [{ text: `• ${row.content}`, bold: false }]),
      }))
      .filter((policy) => policy.lines.length);
    if (visiblePolicies.length) {
      addContentPage('Policies');
      const policySize = 8.5;
      const policyLineFactor = 1.3;
      const policyLineHeight = policySize * policyLineFactor;
      const policyTextWidth = CONTENT_W - 64;
      const wrapPolicyLines = (lines: PdfRichTextLine[]): PdfRichTextLine[] => {
        doc.font('Body').fontSize(policySize);
        const wrapped: PdfRichTextLine[] = [];
        for (const richLine of lines) {
          const words = richLine
            .map((run) => run.text)
            .join('')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          let current = '';
          for (const word of words) {
            const candidate = current ? `${current} ${word}` : word;
            if (current && doc.widthOfString(candidate) > policyTextWidth) {
              wrapped.push([{ text: current, bold: false }]);
              current = word;
            } else current = candidate;
          }
          if (current) wrapped.push([{ text: current, bold: false }]);
        }
        return wrapped;
      };
      for (const [policyIndex, policy] of visiblePolicies.entries()) {
        const remaining = wrapPolicyLines(policy.lines);
        let continuation = false;
        while (remaining.length) {
          if (bodyBottom() - y < 46 + policyLineHeight) addContentPage('Policies');
          const availableLines = Math.max(
            1,
            Math.floor((bodyBottom() - y - 46) / policyLineHeight),
          );
          const chunk = remaining.splice(0, availableLines);
          const sectionHeight = 46 + chunk.length * policyLineHeight;
          const top = y;
          // Child Policy uses the neutral treatment (light-grey header, navy
          // badge and title) instead of the green accent used elsewhere.
          const headerColor = policy.title === 'CHILD POLICY' ? NAVY : policy.color;
          if (policy.title === 'CHILD POLICY') {
            doc.save().roundedRect(M, top, CONTENT_W, 34, 8).fill(PALE_BLUE).restore();
          } else {
            doc
              .save()
              .fillOpacity(0.08)
              .roundedRect(M, top, CONTENT_W, 34, 8)
              .fill(policy.color)
              .restore();
          }
          doc.circle(M + 31, top + 17, 12).fill(headerColor);
          doc
            .font('Bold')
            .fontSize(8)
            .fillColor('#ffffff')
            .text(String(policyIndex + 1), M + 23, top + 13, { width: 16, align: 'center' });
          doc
            .font('Bold')
            .fontSize(11)
            .fillColor(headerColor)
            .text(`${policy.title}${continuation ? ' (CONTINUED)' : ''}`, M + 53, top + 12, {
              width: CONTENT_W - 74,
              height: 14,
              ellipsis: true,
            });
          // Exclusion bullets arrive as typed "x" markers in saved content
          // (after any list "•" prefix); render a proper cross glyph per row
          // instead. Run-level bold formatting is preserved; other sections
          // keep their existing rendering untouched.
          let end: number;
          if (policy.title === 'EXCLUSIONS') {
            const drawCross = (cx: number, cy: number) => {
              doc
                .save()
                .moveTo(cx, cy)
                .lineTo(cx + 9, cy + 9)
                .moveTo(cx + 9, cy)
                .lineTo(cx, cy + 9)
                .lineWidth(1.7)
                .strokeColor(PINK)
                .stroke()
                .restore();
            };
            const crossX = M + 31;
            const crossTextX = crossX + 16;
            const crossTextW = CONTENT_W - 62 - 16;
            let yy = top + 40;
            for (const line of chunk) {
              const runs = line.map((run) => ({ ...run }));
              const joined = runs.map((run) => run.text).join('');
              const marker = /^\s*(?:•\s*)?[xX](\s+|$)/.exec(joined);
              let content: PdfRichTextLine = runs;
              if (marker) {
                let drop = marker[0].length;
                content = [];
                for (const run of runs) {
                  if (drop <= 0) {
                    content.push(run);
                    continue;
                  }
                  if (run.text.length <= drop) {
                    drop -= run.text.length;
                    continue;
                  }
                  content.push({ text: run.text.slice(drop), bold: run.bold });
                  drop = 0;
                }
                content = content.filter((run) => run.text.length > 0);
                drawCross(crossX + 2, yy + 1.5);
              }
              yy = drawRichLines([content], crossTextX, yy, crossTextW, policySize, INK, policyLineFactor);
            }
            end = yy;
          } else {
            end = drawRichLines(
              chunk,
              M + 31,
              top + 40,
              CONTENT_W - 62,
              policySize,
              INK,
              policyLineFactor,
            );
          }
          y = Math.max(top + sectionHeight, end + 10);
          continuation = true;
          if (remaining.length) {
            const nextPageStart = 133;
            const nextPageCapacity = Math.max(
              1,
              Math.floor((BODY_BOTTOM - nextPageStart - 46) / policyLineHeight),
            );
            const nextPageLines = Math.min(remaining.length, nextPageCapacity);
            const nextContentBottom = nextPageStart + 46 + nextPageLines * policyLineHeight;
            const nextLayout = computePageHeight(nextContentBottom - PDF_TOP_MARGIN);
            addContentPage('Policies', nextLayout.pageHeight);
          }
        }
        // Generous whitespace between finished policy sections (roughly 4x
        // the previous ~10pt rhythm). The next chunk's break check repages
        // when the remaining space runs out, so this never clips content.
        if (policyIndex < visiblePolicies.length - 1) y += 30;
      }
    }
  };

  // Destination Expert -----------------------------------------------------
  const drawDestinationExpertSection = () => {
    const pdfExpert = input.destinationExpert;
    if (pdfExpert?.fullName) {
      addContentPage('Destination Expert');
      const hasPhoto = Boolean(input.images?.expertProfile);
      const imageW = 120;
      const imageH = 150;
      const infoX = M + (hasPhoto ? imageW + 28 : 26);
      const infoW = CONTENT_W - infoX - M + 20;
      const introSize = 10;
      const introFactor = 1.4;

      const contactParts: Array<{ label: string; value: string; href: string }> = [];
      const waDigits = pdfExpert.whatsappNumber?.replace(/\D/g, '');
      const callDigits = pdfExpert.callNumber?.replace(/[^+\d]/g, '');
      if (pdfExpert.showWhatsapp !== false && waDigits)
        contactParts.push({
          label: 'WhatsApp',
          value: pdfExpert.whatsappNumber || waDigits,
          href: `https://wa.me/${waDigits}`,
        });
      if (pdfExpert.showCall !== false && callDigits)
        contactParts.push({
          label: 'Call',
          value: pdfExpert.callNumber || callDigits,
          href: `tel:${callDigits}`,
        });
      if (pdfExpert.showEmail !== false && pdfExpert.email)
        contactParts.push({
          label: 'Email',
          value: pdfExpert.email,
          href: `mailto:${pdfExpert.email}`,
        });

      const nameH = 24;
      const headingH = pdfExpert.heading ? 18 : 0;
      const contactH = contactParts.length ? contactParts.length * 16 + 4 : 0;
      const padTop = 26;
      const padBottom = 24;

      // Split the introduction into page-safe chunks: the first chunk must fit
      // inside the card together with photo/name/heading/contacts, continuation
      // chunks flow as plain text on follow-up pages. Lines are pre-wrapped so a
      // lone oversized paragraph is always splittable and nothing can ever be
      // drawn below the page's usable body bottom.
      const introLines = wrapRichLinesToWidth(
        htmlToRichTextLines(pdfExpert.customIntroduction || pdfExpert.bio),
        infoW,
        introSize,
        introFactor,
      );
      const fixedFirstH = Math.max(
        padTop + nameH + headingH + contactH + 10,
        hasPhoto ? imageH + 40 : 0,
      );
      const firstBudget = Math.max(60, bodyBottom() - y - fixedFirstH - padBottom);
      const nextBudget = Math.max(60, bodyBottom() - 133 - 12);
      const introChunks: ReturnType<typeof htmlToRichTextLines>[] = [];
      {
        let current: ReturnType<typeof htmlToRichTextLines> = [];
        let currentHeight = 0;
        let budget = firstBudget;
        for (const line of introLines) {
          const lineH = measureRichHeight([line], infoW, introSize, introFactor);
          if (current.length && currentHeight + lineH > budget) {
            introChunks.push(current);
            current = [];
            currentHeight = 0;
            budget = nextBudget;
          }
          current.push(line);
          currentHeight += lineH;
        }
        if (current.length) introChunks.push(current);
      }

      const deTop = y;
      const firstChunk = introChunks.shift() ?? [];
      const firstChunkH = firstChunk.length
        ? measureRichHeight(firstChunk, infoW, introSize, introFactor)
        : 0;
      const cardH =
        Math.max(
          hasPhoto ? imageH + 40 : 0,
          padTop + nameH + headingH + firstChunkH + contactH + 10,
        ) + padBottom;
      rounded(M, deTop, CONTENT_W, cardH, '#ffffff', LINE, 14);
      if (hasPhoto) {
        drawImage(input.images?.expertProfile, M + 22, deTop + 20, imageW, imageH, 'cover', 12);
      }
      let yy = deTop + padTop;
      doc.font('Bold').fontSize(18).fillColor(NAVY);
      doc.text(pdfExpert.fullName.toUpperCase(), infoX, yy, {
        width: infoW,
        lineBreak: false,
      });
      yy += nameH;
      if (pdfExpert.heading) {
        doc.font('Bold').fontSize(12).fillColor(GOLD);
        doc.text(pdfExpert.heading, infoX, yy, { width: infoW, lineBreak: false });
        yy += headingH;
      }
      if (firstChunk.length) {
        yy = drawRichLines(firstChunk, infoX, yy, infoW, introSize, INK, introFactor) + 6;
      }
      for (const part of contactParts) {
        doc.font('Bold').fontSize(9.5).fillColor(NAVY);
        doc.text(`${part.label}: `, infoX, yy, { width: 62, lineBreak: false });
        doc.font('Body').fontSize(9.5).fillColor(TEAL);
        doc.text(part.value, infoX + 62, yy, {
          width: infoW - 62,
          lineBreak: false,
          link: part.href,
        });
        yy += 16;
      }
      doc.fillColor(INK);
      y = deTop + cardH + 20;

      // Continuation pages for a very long introduction — plain paragraphs under
      // the same section heading, never inside a half-drawn card.
      while (introChunks.length) {
        addContentPage('Destination Expert');
        const chunk = introChunks.shift()!;
        y = drawRichLines(chunk, M + 26, y, CONTENT_W - 52, introSize, INK, introFactor) + 12;
        doc.fillColor(INK);
      }
    }
  };

  // Frequently Asked Questions ---------------------------------------------
  const drawFaqsSection = () => {
    const pdfFaqs = normalizeFaqs((input.version as unknown as { faqs?: unknown }).faqs);
    if (pdfFaqs.length) {
      addContentPage('Frequently Asked Questions');
      const faqSize = 9.5;
      const faqFactor = 1.38;
      const faqTextW = CONTENT_W - 64;
      const faqChunks = (
        lines: ReturnType<typeof htmlToRichTextLines>,
        maxHeight: number,
      ): ReturnType<typeof htmlToRichTextLines>[] => {
        const chunks: ReturnType<typeof htmlToRichTextLines>[] = [];
        let current: ReturnType<typeof htmlToRichTextLines> = [];
        let currentHeight = 0;
        for (const line of lines) {
          const lineH = measureRichHeight([line], faqTextW, faqSize, faqFactor);
          if (current.length && currentHeight + lineH > maxHeight) {
            chunks.push(current);
            current = [];
            currentHeight = 0;
          }
          current.push(line);
          currentHeight += lineH;
        }
        if (current.length) chunks.push(current);
        return chunks;
      };

      pdfFaqs.forEach((faq, index) => {
        const questionText = `${index + 1}. ${faq.question}`;
        const questionH = 20;
        // Pre-wrap answers into single-row lines first: a lone oversized
        // paragraph must be splittable across pages, never drawn unsplit.
        const answerLines = wrapRichLinesToWidth(
          htmlToRichTextLines(faq.answer),
          faqTextW,
          faqSize,
          faqFactor,
        );
        const remaining = faqChunks(answerLines, bodyBottom() - y - questionH - 24);
        remaining.forEach((chunk, chunkIndex) => {
          const chunkH = measureRichHeight(chunk, faqTextW, faqSize, faqFactor);
          if (bodyBottom() - y < questionH + chunkH + 20)
            addContentPage('Frequently Asked Questions');
          if (chunkIndex === 0) {
            doc.font('Bold').fontSize(12).fillColor(NAVY);
            doc.text(questionText, M + 32, y, { width: faqTextW, lineBreak: false });
            y += questionH;
          }
          y = drawRichLines(chunk, M + 32, y, faqTextW, faqSize, INK, faqFactor) + 12;
        });
        y += 8;
      });
    }
  };

  // =========================================================================
  // SECTION DISPATCH — the saved weblink order drives the sequence when one
  // is saved (shared with Classic/Weblink); otherwise Stylish renders its own
  // default sequence: itinerary, hotels, flights, cruise, transportation,
  // services, add-ons, policies, destination expert, FAQs. Classic keeps the
  // legacy default in pdf.service.ts.
  // =========================================================================
  const sectionDrawers: Partial<Record<QuotationPdfSectionId, () => void>> = {
    flights: drawFlightsSection,
    hotels: drawHotelsSection,
    itinerary: drawItinerarySection,
    transportation: () => drawServiceGroup('vehicle'),
    cruise: () => drawServiceGroup('cruise'),
    services: () => drawServiceGroup('other'),
    addons: drawAddonsSection,
    policies: drawPoliciesSection,
    destinationExpert: drawDestinationExpertSection,
    faqs: drawFaqsSection,
  };
  const savedSectionOrder: unknown = input.version.weblinkSectionOrder;
  const sectionOrder: QuotationPdfSectionId[] =
    Array.isArray(savedSectionOrder) && savedSectionOrder.length > 0
      ? resolveQuotationPdfSectionOrder(savedSectionOrder)
      : [
          'itinerary',
          'hotels',
          'flights',
          'cruise',
          'transportation',
          'services',
          'addons',
          'policies',
          'destinationExpert',
          'faqs',
        ];
  for (const id of sectionOrder) {
    sectionDrawers[id]?.();
  }

  // Price Breakdown — professional premium pricing (By Section). Hidden entirely
  // for By Traveler (per-person) quotations.
  if (pricing.pricingMode === 'SECTION_WISE') {
    const pricingHeading =
      (input.version as { pricingHeading?: string }).pricingHeading || 'Price Breakdown';
    const pricingSubheading =
      (input.version as { pricingSubheading?: string | null }).pricingSubheading || null;
    const pricingOrder = Array.isArray(
      (input.version as { pricingDisplayOrder?: unknown }).pricingDisplayOrder,
    )
      ? ((input.version as { pricingDisplayOrder?: unknown }).pricingDisplayOrder as string[])
      : null;
    const orderedSections = pricingOrder
      ? [...pricing.sections].sort((a, b) => {
          const ia = pricingOrder.indexOf(a.id);
          const ib = pricingOrder.indexOf(b.id);
          return (ia < 0 ? pricingOrder.length : ia) - (ib < 0 ? pricingOrder.length : ib);
        })
      : pricing.sections;
    addContentPage(pricingHeading);
    if (pricingSubheading) {
      doc.font('Body').fontSize(9).fillColor(GOLD).text(pricingSubheading, M + 21, y, { width: CONTENT_W - 42 });
      y += 15;
    }
    const amountW = 150;
    const labelX = M + 21;
    const amountX = M + CONTENT_W - 21 - amountW;
    for (const section of orderedSections.filter((sectionRow) => sectionRow.amount > 0)) {
      if (section.id === 'flight') {
        const breakdown = getFlightPerTravelerBreakdown(
          (input.version as unknown as { flightDetails?: unknown }).flightDetails,
          {
            adults: Number((input.quotation as unknown as { adults?: unknown }).adults ?? 0),
            childrenWithBed: Number((input.quotation as unknown as { childrenWithBed?: unknown }).childrenWithBed ?? 0),
            childrenWithoutBed: Number((input.quotation as unknown as { childrenWithoutBed?: unknown }).childrenWithoutBed ?? 0),
            infants: Number((input.quotation as unknown as { infants?: unknown }).infants ?? 0),
          },
        );
        if (breakdown) {
          if (y + 18 > bodyBottom()) addContentPage(pricingHeading);
          doc.font('Bold').fontSize(10).fillColor(NAVY).text('Flights', labelX, y, { width: CONTENT_W - 42 - amountW });
          doc.font('Bold').fontSize(10).fillColor(NAVY).text(money(section.amount, pricing.currency), amountX, y, { width: amountW, align: 'right' });
          y += 16;
          for (const row of breakdown) {
            if (y + 18 > bodyBottom()) addContentPage(pricingHeading);
            doc.font('Body').fontSize(10).fillColor(INK).text(`${row.label}: ${row.count} × ${money(row.rate, pricing.currency)}`, labelX, y, { width: CONTENT_W - 42 - amountW });
            doc.font('Body').fontSize(10).fillColor(INK).text(money(row.total, pricing.currency), amountX, y, { width: amountW, align: 'right' });
            y += 16;
          }
          if (y + 18 > bodyBottom()) addContentPage(pricingHeading);
          doc.font('Bold').fontSize(10).fillColor(NAVY).text('Flight Total', labelX, y, { width: CONTENT_W - 42 - amountW });
          doc.font('Bold').fontSize(10).fillColor(NAVY).text(money(section.amount, pricing.currency), amountX, y, { width: amountW, align: 'right' });
          y += 16;
          continue;
        }
      }
      if (y + 18 > bodyBottom()) addContentPage(pricingHeading);
      doc.font('Body').fontSize(10).fillColor(INK).text(section.label, labelX, y, { width: CONTENT_W - 42 - amountW });
      doc.font('Bold').fontSize(10).fillColor(INK).text(money(section.amount, pricing.currency), amountX, y, { width: amountW, align: 'right' });
      y += 16;
    }
    if (pricing.discountAmount > 0 || pricing.taxAmount > 0) {
      if (y + 18 > bodyBottom()) addContentPage(pricingHeading);
      doc.font('Bold').fontSize(10).fillColor(NAVY).text('Subtotal', labelX, y, { width: CONTENT_W - 42 - amountW });
      doc.font('Bold').fontSize(10).fillColor(NAVY).text(money(pricing.sectionTotal, pricing.currency), amountX, y, { width: amountW, align: 'right' });
      y += 16;
    }
    if (pricing.discountAmount > 0) {
      if (y + 18 > bodyBottom()) addContentPage(pricingHeading);
      doc.font('Body').fontSize(10).fillColor(INK).text('Discount', labelX, y, { width: CONTENT_W - 42 - amountW });
      doc.font('Body').fontSize(10).fillColor(INK).text(`- ${money(pricing.discountAmount, pricing.currency)}`, amountX, y, { width: amountW, align: 'right' });
      y += 16;
    }
    if (pricing.taxAmount > 0) {
      if (y + 18 > bodyBottom()) addContentPage(pricingHeading);
      doc.font('Body').fontSize(10).fillColor(INK).text(`Tax${pricing.taxRate ? ` (${pricing.taxRate}%)` : ''}`, labelX, y, { width: CONTENT_W - 42 - amountW });
      doc.font('Body').fontSize(10).fillColor(INK).text(money(pricing.taxAmount, pricing.currency), amountX, y, { width: amountW, align: 'right' });
      y += 16;
    }
    if (y + 24 > bodyBottom()) addContentPage(pricingHeading);
    doc.font('Bold').fontSize(12).fillColor(NAVY).text('Grand Total', labelX, y, { width: CONTENT_W - 42 - amountW });
    doc.font('Bold').fontSize(12).fillColor(GOLD).text(money(pricing.grandTotal, pricing.currency), amountX, y, { width: amountW, align: 'right' });
    y += 22;
  }

  // Thank-you page ---------------------------------------------------------
  realAddPage({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill(NAVY_DARK);
  doc.save().fillColor('#ffffff').fillOpacity(0.025);
  doc.circle(W - 20, 34, 205).fill();
  doc.circle(24, H - 10, 170).fill();
  doc.restore();
  doc.save().fillColor(GOLD).fillOpacity(0.08);
  doc.polygon([W - 180, 0], [W, 0], [W, 265]).fill();
  doc.restore();
  if (styledLogo) drawImage(styledLogo, W / 2 - 28, 82, 56, 42, 'contain', 0);
  else {
    doc
      .circle(W / 2, 101, 21)
      .lineWidth(1.2)
      .strokeColor(GOLD)
      .stroke();
    drawDiamond(W / 2, 101, 7, GOLD);
  }
  doc
    .font('Bold')
    .fontSize(29)
    .fillColor('#ffffff')
    .text('THANK YOU', M, 139, { width: CONTENT_W, align: 'center', characterSpacing: 1.6 });
  doc
    .font('Body')
    .fontSize(9)
    .fillColor(GOLD)
    .text('FOR CHOOSING US AS YOUR TRAVEL PARTNER', M, 180, {
      width: CONTENT_W,
      align: 'center',
      characterSpacing: 0.8,
    });
  doc
    .moveTo(W / 2 - 48, 205)
    .lineTo(W / 2 + 48, 205)
    .lineWidth(1)
    .strokeColor(GOLD)
    .stroke();
  doc
    .font('Body')
    .fontSize(9.2)
    .fillColor('#c6d1e3')
    .text(
      `Dear ${input.quotation.customerName}, we truly appreciate your trust in us. Our team is committed to crafting an unforgettable travel experience for you. Should you have any questions, feel free to reach out anytime.`,
      90,
      228,
      { width: W - 180, align: 'center', lineGap: 2 },
    );
  type ContactIcon = 'phone' | 'message' | 'email' | 'web';
  const drawContactIcon = (kind: ContactIcon, centerX: number, centerY: number) => {
    doc.circle(centerX, centerY, 15).fill(GOLD);
    doc.save().lineWidth(1.35).strokeColor(NAVY_DARK).fillColor(NAVY_DARK);
    if (kind === 'phone') {
      doc
        .path(
          `M ${centerX - 6} ${centerY - 7} C ${centerX - 8} ${centerY - 2}, ${centerX - 2} ${centerY + 6}, ${centerX + 5} ${centerY + 7} L ${centerX + 8} ${centerY + 3} L ${centerX + 3} ${centerY} L ${centerX} ${centerY + 2} C ${centerX - 2} ${centerY + 1}, ${centerX - 4} ${centerY - 2}, ${centerX - 3} ${centerY - 4} L ${centerX - 6} ${centerY - 7}`,
        )
        .fill();
    } else if (kind === 'message') {
      // Recognisable WhatsApp-style chat bubble with a phone handset, drawn as
      // vector paths so it remains crisp at every PDF zoom level.
      doc.circle(centerX, centerY - 0.5, 7).stroke();
      doc
        .moveTo(centerX - 4.8, centerY + 4.2)
        .lineTo(centerX - 6.2, centerY + 7.4)
        .lineTo(centerX - 2.5, centerY + 5.8)
        .stroke();
      doc
        .path(
          `M ${centerX - 3.2} ${centerY - 3.5} C ${centerX - 4} ${centerY - 1}, ${centerX - 0.7} ${centerY + 3.2}, ${centerX + 3.2} ${centerY + 3.4} L ${centerX + 4.4} ${centerY + 1.4} L ${centerX + 1.8} ${centerY + 0.2} L ${centerX + 0.5} ${centerY + 1.2} C ${centerX - 0.8} ${centerY + 0.5}, ${centerX - 1.8} ${centerY - 0.8}, ${centerX - 1.2} ${centerY - 1.7} L ${centerX - 3.2} ${centerY - 3.5}`,
        )
        .fill();
    } else if (kind === 'email') {
      doc.rect(centerX - 7, centerY - 5, 14, 10).stroke();
      doc
        .moveTo(centerX - 7, centerY - 5)
        .lineTo(centerX, centerY + 1)
        .lineTo(centerX + 7, centerY - 5)
        .stroke();
    } else {
      doc.circle(centerX, centerY, 7).stroke();
      doc.ellipse(centerX, centerY, 3.2, 7).stroke();
      doc
        .moveTo(centerX - 7, centerY)
        .lineTo(centerX + 7, centerY)
        .stroke();
    }
    doc.restore();
  };
  const contactCards = [
    ['phone', 'CALL US', company?.phone],
    ['message', 'WHATSAPP', company?.phone],
    ['email', 'EMAIL US', company?.email],
    ['web', 'VISIT US', company?.website],
  ] as const;
  contactCards.forEach(([icon, label, value], index) => {
    const left = index % 2 === 0 ? 64 : W / 2 + 12;
    const top = 298 + Math.floor(index / 2) * 68;
    const width = W / 2 - 76;
    doc
      .save()
      .fillColor('#ffffff')
      .fillOpacity(0.06)
      .roundedRect(left, top, width, 56, 10)
      .fill()
      .restore();
    doc.roundedRect(left, top, width, 56, 10).lineWidth(0.55).strokeColor('#344e79').stroke();
    drawContactIcon(icon, left + 29, top + 28);
    doc
      .font('Bold')
      .fontSize(6.8)
      .fillColor(GOLD)
      .text(label, left + 54, top + 13, { characterSpacing: 0.65 });
    doc
      .font('Body')
      .fontSize(8.2)
      .fillColor('#e4eaf4')
      .text(value || '-', left + 54, top + 31, { width: width - 65, ellipsis: true });
  });
  if (company?.address)
    doc
      .font('Body')
      .fontSize(7.6)
      .fillColor('#91a3c1')
      .text(company.address, 105, 443, { width: W - 210, align: 'center' });
  doc
    .save()
    .fillColor('#ffffff')
    .fillOpacity(0.045)
    .roundedRect(64, 480, W - 128, 86, 12)
    .fill()
    .restore();
  doc
    .roundedRect(64, 480, W - 128, 86, 12)
    .lineWidth(0.8)
    .strokeColor('#40577d')
    .stroke();
  const achievements = [
    [company?.tripsSold ?? '-', 'Trips Completed'],
    [
      company?.operatingSinceYear
        ? `${new Date().getFullYear() - company.operatingSinceYear}+`
        : '-',
      'Years Experience',
    ],
    ['GST', 'Registered Company'],
  ];
  achievements.forEach(([value, label], index) => {
    const left = 72 + index * 151;
    if (index > 0)
      doc
        .moveTo(left - 1, 500)
        .lineTo(left - 1, 548)
        .lineWidth(0.5)
        .strokeColor('#53698c')
        .stroke();
    doc
      .font('Bold')
      .fontSize(17)
      .fillColor('#ffffff')
      .text(String(value), left, 500, { width: 132, align: 'center' });
    doc.font('Body').fontSize(6.7).fillColor(GOLD).text(String(label).toUpperCase(), left, 533, {
      width: 132,
      align: 'center',
      characterSpacing: 0.45,
    });
  });
  doc
    .font('Body')
    .fontSize(6.5)
    .fillColor('#647799')
    .text(
      [
        company?.tan ? `TAN: ${company.tan}` : null,
        company?.taxRegistrationNumber ? `GST: ${company.taxRegistrationNumber}` : null,
      ]
        .filter(Boolean)
        .join('  |  '),
      M,
      582,
      { width: CONTENT_W, align: 'center' },
    );
  doc
    .moveTo(174, 625)
    .lineTo(W - 174, 625)
    .lineWidth(1)
    .strokeColor(GOLD)
    .stroke();
  doc
    .font('Bold')
    .fontSize(12)
    .fillColor('#ffffff')
    .text((company?.name ?? 'TRAVEL COMPANY').toUpperCase(), M, 650, {
      width: CONTENT_W,
      align: 'center',
      characterSpacing: 1,
    });
  doc.font('Body').fontSize(7.5).fillColor(GOLD).text('YOUR TRUSTED TRAVEL PARTNER', M, 673, {
    width: CONTENT_W,
    align: 'center',
    characterSpacing: 0.7,
  });

  for (const pageIndex of numberedPages) {
    doc.switchToPage(pageIndex);
    pageFooter(pageIndex);
  }
  doc.end();
  return complete;
}

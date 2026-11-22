import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { prisma } from './src/config/prisma.js';
import {
  dayDestinationFallbackKeys,
  destinationImageCandidates,
  fullImageNameCandidates,
  selectDestinationImageRecord,
} from './src/modules/quotations/quotations.service.js';
import { renderStylishQuotationPdf } from './src/modules/quotations/stylish-pdf.service.js';

// READ-ONLY real-data verification for QT-001082 Day 06 (Singapore globe bug).
// No DB writes, no storage writes, no record modifications — PDFs go to tmp/.

const STORAGE_ROOT = path.resolve(process.cwd(), '.local-storage');
const readKey = async (key: string | null | undefined): Promise<Buffer | null> => {
  if (!key) return null;
  try {
    const p = path.resolve(STORAGE_ROOT, key);
    return existsSync(p) ? await readFile(p) : null;
  } catch {
    return null;
  }
};

const QID = '452e5ea4-7058-4f05-9f68-7b05cd3c733b';
const VID = 'e3fa2cd8-f8f1-4bb6-b55c-276e24659a5e';

const version = (await prisma.quotationVersion.findUniqueOrThrow({
  where: { id: VID },
  include: {
    itinerary: { orderBy: { sequence: 'asc' } },
    hotels: { orderBy: { sequence: 'asc' } },
    services: { orderBy: { sequence: 'asc' } },
    inclusions: { orderBy: { sequence: 'asc' } },
    exclusions: { orderBy: { sequence: 'asc' } },
    terms: { orderBy: { sequence: 'asc' } },
  },
})) as unknown as Record<string, unknown>;
const quotation = (await prisma.quotation.findUniqueOrThrow({
  where: { id: QID },
  include: { query: { select: { itinerary: true } } },
})) as unknown as {
  quotationNumber: string; customerName: string; customerEmail: string | null; customerPhone: string;
  destinationSummary: string; travelStartDate: Date | null; travelEndDate: Date | null;
  adults: number; childrenWithBed: number; childrenWithoutBed: number; infants: number; rooms: number;
  validUntil: Date | null;
  query: { itinerary: Array<{ country?: string | null; destination?: string | null }> | null } | null;
  companyId: string;
};
const companyRow = (await prisma.company.findUniqueOrThrow({
  where: { id: quotation.companyId },
  select: { name: true, operatingSinceYear: true, tripsSold: true },
})) as { name: string; operatingSinceYear: number | null; tripsSold: number | null };

type Act = Record<string, unknown>;
const ssData = version.sightseeingDetails as { days?: Array<Record<string, unknown>> };
console.log('ss days:', (ssData?.days ?? []).length,
  '| version.itinerary rows:', Array.isArray(version.itinerary) ? (version.itinerary as unknown[]).length : 'n/a',
  '| lead itinerary rows:', (quotation.query?.itinerary ?? []).length);
const itineraryImageMap: Record<string, Buffer> = {};
const pdfDays: Array<Record<string, unknown>> = [];
const sightseeingIds: string[] = [];
const itineraryDocumentIds: string[] = [];
for (const [di, day] of ((ssData.days ?? []) as Array<Record<string, unknown>>).entries()) {
  const acts = (Array.isArray(day.activities) ? day.activities : []) as Act[];
  const pdfActs: Act[] = [];
  for (const [ai, act] of acts.entries()) {
    const galleryPresent =
      typeof act.imageSnapshotPresent === 'boolean'
        ? act.imageSnapshotPresent
        : Array.isArray(act.images);
    if (galleryPresent) {
      const key = `quotation-gallery:${di + 1}:${ai + 1}`;
      const imgs = (Array.isArray(act.images) ? act.images : []) as Array<{ id?: string | null; url?: string | null; objectKey?: string | null }>;
      const selected =
        imgs.find((im) => (im.id || im.url) === (act.pdfImageUrl as string | null)) ?? imgs[0] ?? null;
      const bytes = selected?.objectKey ? await readKey(selected.objectKey) : null;
      if (bytes) itineraryImageMap[key] = bytes;
      pdfActs.push({ ...act, imageUrl: key, imageDocumentId: null, sightseeingId: null });
      continue;
    }
    if (typeof act.sightseeingId === 'string' && act.sightseeingId) sightseeingIds.push(act.sightseeingId);
    if (typeof act.imageDocumentId === 'string' && act.imageDocumentId) itineraryDocumentIds.push(act.imageDocumentId);
    pdfActs.push(act);
  }
  pdfDays.push({ ...day, activities: pdfActs });
}
console.log('gallery bytes resolved:', Object.keys(itineraryImageMap));

const ssMasters = sightseeingIds.length
  ? await prisma.sightseeing.findMany({
      where: { id: { in: [...new Set(sightseeingIds)] } },
      select: { id: true, imageObjectKey: true },
    })
  : [];
const sightseeingImages: Record<string, Buffer> = {};
for (const m of ssMasters) {
  const bytes = await readKey(m.imageObjectKey);
  if (bytes) sightseeingImages[m.id] = bytes;
}
const imageDocs = itineraryDocumentIds.length
  ? await prisma.quotationDocument.findMany({
      where: { id: { in: [...new Set(itineraryDocumentIds)] }, status: 'AVAILABLE', deletedAt: null },
      select: { id: true, objectKey: true },
    })
  : [];
const itineraryDocumentImages: Record<string, Buffer> = {};
for (const d of imageDocs) {
  const bytes = await readKey(d.objectKey);
  if (bytes) itineraryDocumentImages[d.id] = bytes;
}

// Cover — identical logic to generatePdf.
const companyId = quotation.companyId;
const destRows = await prisma.destination.findMany({
  where: { companyId, imageObjectKey: { not: null }, imageConfirmedAt: { not: null } },
  select: { id: true, name: true, normalizedName: true, imageObjectKey: true, imageFileName: true },
});
const leadItinerary = quotation.query?.itinerary ?? null;
const coverRec = selectDestinationImageRecord(
  destRows,
  fullImageNameCandidates(quotation.destinationSummary, leadItinerary),
  destinationImageCandidates(quotation.destinationSummary, leadItinerary),
);
const cover = coverRec ? await readKey(coverRec.imageObjectKey) : null;
console.log('cover record:', coverRec?.name, '| bytes:', cover?.length ?? null);

// destinationImages — identical logic to the new server block.
const legacyDests = Array.isArray(version.itinerary)
  ? (version.itinerary as Array<{ destination?: unknown }>).map((r) => String(r.destination ?? ''))
  : [];
const { cities, cityToCountry, soleCountry } = dayDestinationFallbackKeys(
  [...pdfDays.map((d) => String(d.city ?? '')), ...legacyDests],
  leadItinerary,
);
const lookupNames = new Set(cities);
for (const c of cities) {
  const cc = cityToCountry[c] ?? soleCountry;
  if (cc) lookupNames.add(cc);
}
const byKey = new Map<string, string>();
for (const m of destRows) {
  if (!m.imageObjectKey) continue;
  for (const label of [m.name, m.normalizedName]) {
    const k = (label ?? '').trim().toLowerCase();
    if (k && !byKey.has(k)) byKey.set(k, m.imageObjectKey);
  }
}
const cache = new Map<string, Buffer>();
const bytesFor = async (name: string): Promise<Buffer | null> => {
  const hit = cache.get(name);
  if (hit) return hit;
  const bytes = await readKey(byKey.get(name));
  if (bytes) cache.set(name, bytes);
  return bytes;
};
const destinationImages: Record<string, Buffer> = {};
for (const city of cities) {
  const direct = await bytesFor(city);
  if (direct) {
    destinationImages[city] = direct;
    continue;
  }
  const country = cityToCountry[city] ?? soleCountry;
  if (country) {
    const inherited = await bytesFor(country);
    if (inherited) destinationImages[city] = inherited;
  }
}
console.log('destinationImages keys:', Object.keys(destinationImages),
  'singapore bytes:', destinationImages.singapore?.length ?? null);

const input = {
  company: {
    name: companyRow.name, email: null, phone: null, website: null, address: null,
    primaryColor: '#17386f', operatingSinceYear: companyRow.operatingSinceYear,
    tripsSold: companyRow.tripsSold, tan: null, taxRegistrationNumber: null, logo: null,
  },
  consultant: { name: null, phone: null, email: null },
  quotation: {
    quotationNumber: quotation.quotationNumber, customerName: quotation.customerName,
    customerEmail: quotation.customerEmail, customerPhone: quotation.customerPhone,
    destinationSummary: quotation.destinationSummary, destinations: quotation.destinationSummary,
    travelStartDate: quotation.travelStartDate, travelEndDate: quotation.travelEndDate,
    adults: quotation.adults, childrenWithBed: quotation.childrenWithBed,
    childrenWithoutBed: quotation.childrenWithoutBed, infants: quotation.infants,
    rooms: quotation.rooms, validUntil: quotation.validUntil,
  },
  version: { ...(version as object), sightseeingDetails: { ...ssData, days: pdfDays } },
  images: { cover, sightseeing: sightseeingImages, itinerary: itineraryImageMap, itineraryDocuments: itineraryDocumentImages, ...(Object.keys(destinationImages).length ? { destinationImages } : {}) },
} as unknown as Parameters<typeof renderStylishQuotationPdf>[0];

const pdf = await renderStylishQuotationPdf(input);
writeFileSync('../../tmp/footer-verify/day06-real-fresh.pdf', pdf);
console.log('fresh bytes', pdf.length);

// Locate Day 06 page in the fresh PDF.
const NPAGES = Number(execFileSync('pdfinfo', ['../../tmp/footer-verify/day06-real-fresh.pdf']).toString().match(/Pages:\s+(\d+)/)?.[1]);
let day6Page = 0;
for (let p = 1; p <= NPAGES; p += 1) {
  const txt = execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), '../../tmp/footer-verify/day06-real-fresh.pdf', '-']).toString();
  if (txt.includes('Universal Studios') && /0?6/.test(txt)) {
    day6Page = p;
    break;
  }
}
console.log('fresh Day06 page:', day6Page);
if (!day6Page) throw new Error('Day 06 page not found in fresh PDF');
execFileSync('pdftoppm', ['-png', '-r', '150', '-f', String(day6Page), '-l', String(day6Page), '../../tmp/footer-verify/day06-real-fresh.pdf', '../../tmp/footer-verify/day06fresh']);

// Old stored PDF (pre-fix artifact) for before/after.
const stored = await prisma.quotationDocument.findFirst({
  where: { quotationId: QID, quotationVersionId: VID, documentType: 'QUOTATION_PDF', fileName: { endsWith: '-stylish-quotation.pdf' }, status: 'AVAILABLE' },
  orderBy: { createdAt: 'desc' },
  select: { fileName: true, createdAt: true, objectKey: true },
});
console.log('latest stored stylish PDF:', stored?.fileName, stored?.createdAt);
let oldDay6Page = 0;
if (stored) {
  const oldBytes = await readKey(stored.objectKey);
  if (oldBytes) {
    writeFileSync('../../tmp/footer-verify/day06-real-old.pdf', oldBytes);
    const oldN = Number(execFileSync('pdfinfo', ['../../tmp/footer-verify/day06-real-old.pdf']).toString().match(/Pages:\s+(\d+)/)?.[1]);
    for (let p = 1; p <= oldN; p += 1) {
      const txt = execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), '../../tmp/footer-verify/day06-real-old.pdf', '-']).toString();
      if (txt.includes('Universal Studios')) {
        oldDay6Page = p;
        break;
      }
    }
    if (oldDay6Page) execFileSync('pdftoppm', ['-png', '-r', '150', '-f', String(oldDay6Page), '-l', String(oldDay6Page), '../../tmp/footer-verify/day06-real-old.pdf', '../../tmp/footer-verify/day06old']);
    console.log('old Day06 page:', oldDay6Page, 'of', oldN);
  }
}

// Compare image boxes: old (globe) vs fresh.
const S = 150 / 72;
const boxMean = async (file: string, top: number): Promise<[number, number, number]> => {
  const img = sharp(file).extract({ left: Math.round(54 * S), top: Math.round((top + 12) * S), width: Math.round(198 * S), height: Math.round(170 * S) }).raw();
  const buf = await img.toBuffer();
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < buf.length; i += 3) { r += buf[i]!; g += buf[i + 1]!; b += buf[i + 2]!; }
  const n = buf.length / 3;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
};
const oldTop = 85; // non-first itinerary pages in both layouts
const freshTop = 85;
const oldMean = oldDay6Page ? await boxMean(`../../tmp/footer-verify/day06old-${String(oldDay6Page).padStart(2, '0')}.png`, oldTop) : null;
const freshMean = await boxMean(`../../tmp/footer-verify/day06fresh-${String(day6Page).padStart(2, '0')}.png`, freshTop);
console.log('old box mean:', oldMean, '| fresh box mean:', freshMean);
const dist = (a: [number, number, number], b: [number, number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const placeholder: [number, number, number] = [227, 235, 243];
let failures = 0;
if (oldMean) {
  // Old must look like the globe placeholder.
  if (dist(oldMean, placeholder) > 90) { console.log('NOTE: old box is not placeholder-like'); }
  else console.log('CONFIRMED: old stored PDF shows the placeholder on Day 06');
  if (dist(freshMean, oldMean) < 60) { console.log('FAIL: fresh box identical to old globe box'); failures += 1; }
  else console.log('PASS: fresh box differs from old globe box');
}
if (dist(freshMean, placeholder) < 60) { console.log('FAIL: fresh box still placeholder-like'); failures += 1; }
else console.log('PASS: fresh box is a real image, not the placeholder');
if (failures) process.exit(1);
console.log('REAL-DATA DAY06 VERIFICATION PASSED');
await prisma.$disconnect();

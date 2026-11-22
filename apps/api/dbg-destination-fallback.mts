import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderStylishQuotationPdf } from './src/modules/quotations/stylish-pdf.service.js';

// Solid colours per slot so the rendered box colour proves the source:
// day-specific = green, Singapore destination = blue, Malaysia = red.
const mk = (r: number, g: number, b: number) =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
const hero = await mk(96, 128, 168);
const logo = await mk(212, 164, 65);
const dayGreen = await mk(60, 140, 100);
const destSingaporeBlue = await mk(60, 100, 160);
const destMalaysiaRed = await mk(160, 60, 60);
const corruptBytes = Buffer.from('not-a-decodable-image');

const day = (
  dayNumber: number,
  title: string,
  city: string,
  description: string,
  activityExtra: Record<string, unknown> = {},
) => ({
  dayNumber,
  title,
  city,
  date: '2026-12-12',
  activities: [{ name: title, description, ...activityExtra }],
});

const sight = {
  include: true,
  sectionTitle: 'Day Wise Itinerary',
  amount: '0',
  description: null as string | null,
  days: [
    // Case 1: day-specific image available -> must show the GREEN day image.
    day(1, 'Day One Has Own Image', 'Singapore', '<p>Case one description.</p>', {
      sightseeingId: 's-day',
    }),
    // Case 2: day image missing -> must show BLUE Singapore destination image.
    day(2, 'Day Two Missing Image', 'Singapore', '<p>Case two description.</p>'),
    // Case 3: day image present but undecodable -> must fall back to BLUE.
    day(3, 'Day Three Corrupt Image', 'Singapore', '<p>Case three description.</p>', {
      imageUrl: 'bad-url',
    }),
    // Case 4: day + destination both missing -> existing globe fallback.
    day(4, 'Day Four No Image Anywhere', 'Atlantis', '<p>Case four description.</p>'),
    // Case 5a: city with no destination entry -> globe, NOT blue/red.
    day(5, 'Day Five Other City', 'Kuala Lumpur', '<p>Case five description.</p>'),
    // Case 5b/6: second destination resolves its own RED image.
    day(6, 'Day Six Malaysia Image', 'Malaysia', '<p>Case six description.</p>'),
  ],
};

const input = {
  company: {
    name: 'Vacation Triangle', email: 'c@t.t', phone: '+91', website: null, address: null,
    primaryColor: '#17386f', operatingSinceYear: 2016, tripsSold: 1, tan: null,
    taxRegistrationNumber: null, logo,
  },
  consultant: { name: 'Aditi Rao', phone: '+911100000001', email: 'a@b.c' },
  quotation: {
    quotationNumber: 'QT-1', customerName: 'Rahul Sharma', customerEmail: null, customerPhone: '+91',
    destinationSummary: 'Singapore Malaysia', destinations: 'Singapore Malaysia',
    travelStartDate: new Date('2026-12-12'), travelEndDate: new Date('2026-12-18'),
    adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0, rooms: 1, validUntil: null,
  },
  version: {
    versionNumber: 1, title: 'Singapore Malaysia', introduction: null, currency: 'INR',
    finalAmount: '0', notes: null, perAdultPrice: '50000', perChildWithBedPrice: '0',
    perChildWithoutBedPrice: '0', perInfantPrice: '0', taxNote: null, initialPaymentAmount: '0',
    paymentLink: null, inclusionsHtml: null, exclusionsHtml: null, paymentPolicies: null,
    cancellationPolicies: null, bookingTerms: null, includeVisa: false, visaSectionTitle: null,
    visaAmount: '0', visaType: null, visaServiceCharge: '0', visaGstPercent: '0',
    visaVfsCharge: '0', flightDetails: null, hotels: [], itinerary: [],
    services: [{ serviceType: 'TRANSFER' }], inclusions: [], exclusions: [],
    terms: [], sightseeingDetails: sight, discountAmount: '0',
    packageCustomItems: [],
  },
  images: {
    cover: null, // force null so attributable days can never leak the cover
    sightseeing: { 's-day': dayGreen },
    itinerary: { 'bad-url': corruptBytes } as unknown as Record<string, Buffer>,
    destinationImages: {
      singapore: destSingaporeBlue,
      malaysia: destMalaysiaRed,
    },
  },
} as unknown as Parameters<typeof renderStylishQuotationPdf>[0];

const pdf = await renderStylishQuotationPdf(input);
writeFileSync('../../tmp/footer-verify/itinerary-destfallback.pdf', pdf);
console.log('bytes', pdf.length);

// Assert the rendered image-box colour per itinerary page (pages 3-8).
// Box geometry (pt): x=M+12, y=top+12, w=198, h=170; first page top=132.
const { default: sharpLib } = await import('sharp');
const S = 150 / 72;
const pngPrefix = '../../tmp/footer-verify/destfb';
const { execFileSync } = await import('node:child_process');
execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '3', '-l', '8',
  '../../tmp/footer-verify/itinerary-destfallback.pdf', pngPrefix]);
const expected: Array<{ page: number; label: string; rgb: [number, number, number] | 'globe' }> = [
  { page: 3, label: 'case1-day-green', rgb: [60, 140, 100] },
  { page: 4, label: 'case2-singapore-blue', rgb: [60, 100, 160] },
  { page: 5, label: 'case3-corrupt-falls-back-blue', rgb: [60, 100, 160] },
  { page: 6, label: 'case4-atlantis-globe', rgb: 'globe' },
  { page: 7, label: 'case5-kl-globe-not-blue', rgb: 'globe' },
  { page: 8, label: 'case6-malaysia-red', rgb: [160, 60, 60] },
];
let failures = 0;
for (const { page, label, rgb } of expected) {
  const file = `${pngPrefix}-0${page}.png`;
  // Centre of the image box; top=132 on first itinerary page, 85 afterwards.
  const top = page === 3 ? 132 : 85;
  const boxLeft = Math.round((42 + 12) * S);
  const boxTop = Math.round((top + 12) * S);
  // Solid image fills: sample the centre. Placeholder: sample the top-left
  // corner, away from the centred globe emoji.
  const patch = rgb === 'globe'
    ? { left: boxLeft + 8, top: boxTop + 8, width: 30, height: 30 }
    : { left: Math.round((42 + 12 + 198 / 2) * S) - 20, top: Math.round((top + 12 + 170 / 2) * S) - 20, width: 40, height: 40 };
  const sample = await sharpLib(file).extract(patch).raw().toBuffer();
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < sample.length; i += 3) { r += sample[i]!; g += sample[i + 1]!; b += sample[i + 2]!; }
  const n = sample.length / 3;
  const mean: [number, number, number] = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  const close = (a: [number, number, number], c: [number, number, number]) =>
    Math.abs(a[0] - c[0]) < 30 && Math.abs(a[1] - c[1]) < 30 && Math.abs(a[2] - c[2]) < 30;
  let ok: boolean;
  let detail: string;
  if (rgb === 'globe') {
    // Placeholder fill is #e3ebf3 (227,235,243); emoji at centre may tint it.
    ok = close(mean, [227, 235, 243]);
    detail = `mean rgb(${mean}) vs placeholder #e3ebf3`;
  } else {
    ok = close(mean, rgb);
    detail = `mean rgb(${mean}) vs expected rgb(${rgb})`;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} page ${page} ${label}: ${detail}`);
  if (!ok) failures += 1;
}
if (failures) {
  console.error(`${failures} case(s) FAILED`);
  process.exit(1);
}
console.log('ALL DESTINATION-FALLBACK CASES PASSED');

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { renderStylishQuotationPdf } from './src/modules/quotations/stylish-pdf.service.js';

const mk = (r: number, g: number, b: number) =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();

type Day = {
  dayNumber: number; title: string; city: string; date: string;
  description: string; activityName?: string; startTime?: string; duration?: string;
  meals?: boolean; transfer?: string; sightseeingId?: string;
};

const day = (d: Day) => ({
  dayNumber: d.dayNumber,
  title: d.title,
  city: d.city,
  date: d.date,
  dailyTransfer: d.transfer ?? null,
  meals: d.meals ? { breakfast: true, lunch: false, dinner: false } : { breakfast: false, lunch: false, dinner: false },
  mealMode: d.meals ? 'HOTEL' : null,
  activities: [
    {
      name: d.activityName ?? d.title,
      sightseeingId: d.sightseeingId ?? null,
      description: d.description,
      ...(d.startTime ? { startTime: d.startTime } : {}),
      ...(d.duration ? { duration: d.duration } : {}),
    },
  ],
});

const short1 = '<p>Arrive at Chandigarh Airport and drive towards Shimla, enjoying beautiful mountain views. Check in the hotel, enjoy dinner, and overnight stay in Shimla.</p>';
const short2 = '<p>After breakfast, drive towards Sangla Valley and Chitkul, enjoying scenic Himalayan landscapes. Dinner and overnight stay in Sangla.</p>';
const short3 = '<p>Morning walk through apple orchards, then leisure time at the riverside camps.</p>';
const bullets = (n: number, label: string) =>
  `<p><strong>Attractions Covered:</strong></p><ul>${Array.from({ length: n }, (_, i) => `<li><strong>${label} stop ${i + 1}</strong> - Scenic views, photo points and local stories for the whole family to enjoy together.</li>`).join('')}</ul><p><strong>Inclusions:</strong></p><ul><li>Guided tour</li><li>All transfers</li></ul>`;
const longDesc = `<p>Day three explores the city from dawn to dusk with a packed schedule of sightseeing.</p>` + bullets(12, 'Grand');
const veryLongDesc = `<p>An epic full-day exploration across valleys, monasteries and high passes.</p>` + bullets(30, 'Epic');

async function renderCase(name: string, days: ReturnType<typeof day>[], images: Record<string, Buffer> = {}, destImages: Record<string, Buffer> = {}) {
  const hero = await mk(96, 128, 168);
  const logo = await mk(212, 164, 65);
  const sight: Record<string, Buffer> = {};
  for (const [k, v] of Object.entries(images)) sight[k] = v;
  const input = {
    company: { name: 'Vacation Triangle', email: 'c@t.t', phone: '+91', website: null, address: null, primaryColor: '#17386f', operatingSinceYear: 2016, tripsSold: 1, tan: null, taxRegistrationNumber: null, logo },
    consultant: { name: 'Aditi Rao', phone: '+911100000001', email: 'a@b.c' },
    quotation: {
      quotationNumber: 'QT-PG', customerName: 'Rahul Sharma', customerEmail: null, customerPhone: '+91',
      destinationSummary: 'Himachal', destinations: 'Himachal',
      travelStartDate: new Date('2026-12-08'), travelEndDate: new Date('2026-12-15'),
      adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0, rooms: 1, validUntil: null,
    },
    version: {
      versionNumber: 1, title: 'Himachal', introduction: null, currency: 'INR', finalAmount: '0', notes: null,
      perAdultPrice: '50000', perChildWithBedPrice: '0', perChildWithoutBedPrice: '0', perInfantPrice: '0', taxNote: null,
      initialPaymentAmount: '0', paymentLink: null, inclusionsHtml: null, exclusionsHtml: null, paymentPolicies: null,
      cancellationPolicies: null, bookingTerms: null, includeVisa: false, visaSectionTitle: null, visaAmount: '0',
      visaType: null, visaServiceCharge: '0', visaGstPercent: '0', visaVfsCharge: '0', flightDetails: null, hotels: [],
      itinerary: [], services: [{ serviceType: 'TRANSFER' }], inclusions: [], exclusions: [], terms: [],
      sightseeingDetails: { include: true, sectionTitle: 'S', amount: '0', description: null, days },
      discountAmount: '0', packageCustomItems: [],
    },
    images: { cover: hero, sightseeing: sight, ...(Object.keys(destImages).length ? { destinationImages: destImages } : {}) },
  } as unknown as Parameters<typeof renderStylishQuotationPdf>[0];
  const pdf = await renderStylishQuotationPdf(input);
  writeFileSync(`../../tmp/footer-verify/pg-${name}.pdf`, pdf);
  console.log(`wrote pg-${name}.pdf (${pdf.length} bytes)`);
}

// A: two short days share one page.
await renderCase('a-short2', [
  day({ dayNumber: 1, title: 'Chandigarh to Shimla', city: 'Shimla', date: '2026-12-08', description: short1, meals: true, transfer: 'PRIVATE' }),
  day({ dayNumber: 2, title: 'Shimla to Sangla & Chitkul', city: 'Sangla', date: '2026-12-09', description: short2, meals: true, transfer: 'PRIVATE' }),
]);
// B: three short days pack efficiently.
await renderCase('b-short3', [
  day({ dayNumber: 1, title: 'Arrival Day One', city: 'Shimla', date: '2026-12-08', description: short3 }),
  day({ dayNumber: 2, title: 'Valley Day Two', city: 'Sangla', date: '2026-12-09', description: short3 }),
  day({ dayNumber: 3, title: 'River Day Three', city: 'Chitkul', date: '2026-12-10', description: short3 }),
]);
// C: short day + long day that must move to a fresh page.
await renderCase('c-shortlong', [
  day({ dayNumber: 1, title: 'Quick Arrival', city: 'Shimla', date: '2026-12-08', description: short3 }),
  day({ dayNumber: 2, title: 'Grand Long Tour', city: 'Sangla', date: '2026-12-09', description: longDesc, activityName: 'Grand Tour Activity', startTime: '08:00', duration: '10 hours', meals: true, transfer: 'SHARED' }),
]);
// D: single day with a description longer than one page.
await renderCase('d-verylong', [
  day({ dayNumber: 1, title: 'Epic Mega Tour', city: 'Leh', date: '2026-12-08', description: veryLongDesc, activityName: 'Epic Activity', startTime: '07:00', duration: '12 hours' }),
]);
// E: mixed lengths.
await renderCase('e-mixed', [
  day({ dayNumber: 1, title: 'Arrival One', city: 'Shimla', date: '2026-12-08', description: short1 }),
  day({ dayNumber: 2, title: 'Grand Two', city: 'Sangla', date: '2026-12-09', description: longDesc, activityName: 'Grand Activity' }),
  day({ dayNumber: 3, title: 'Short Three', city: 'Chitkul', date: '2026-12-10', description: short3 }),
  day({ dayNumber: 4, title: 'Short Four', city: 'Kalpa', date: '2026-12-11', description: short2 }),
  day({ dayNumber: 5, title: 'Epic Five', city: 'Kaza', date: '2026-12-12', description: veryLongDesc, activityName: 'Epic Activity' }),
]);
// F: multiple destinations + image fallbacks.
const green = await mk(60, 140, 100);
const blue = await mk(60, 100, 160);
const red = await mk(160, 60, 60);
await renderCase('f-multidest', [
  day({ dayNumber: 1, title: 'Singapore Day', city: 'Singapore', date: '2026-12-08', description: short3 }),
  day({ dayNumber: 2, title: 'Malaysia Day', city: 'Malaysia', date: '2026-12-09', description: short3 }),
  day({ dayNumber: 3, title: 'Own Image Day', city: 'Singapore', date: '2026-12-10', description: short3, sightseeingId: 'own' }),
  day({ dayNumber: 4, title: 'Nowhere Day', city: 'Atlantis', date: '2026-12-11', description: short3 }),
], { own: green }, { singapore: blue, malaysia: red });
console.log('ALL PAGINATION CASES RENDERED');

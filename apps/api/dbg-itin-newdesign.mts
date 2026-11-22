import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderStylishQuotationPdf } from './src/modules/quotations/stylish-pdf.service.js';

const mk = (r: number, g: number, b: number) =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
const hero = await mk(96, 128, 168);
const logo = await mk(212, 164, 65);
const c1 = await mk(150, 90, 60);
const c2 = await mk(60, 140, 100);
const c3 = await mk(60, 100, 160);
const c4 = await mk(140, 120, 60);

const short1 = '<p>Arrive at <strong>Chandigarh Airport</strong> and drive towards Shimla, enjoying beautiful mountain views. Check in at the hotel, enjoy dinner, and overnight stay in <strong>Shimla</strong>.</p>';
const short2 = '<p>After breakfast, drive towards <strong>Sangla Valley and Chitkul</strong>, enjoying scenic Himalayan landscapes. Dinner and overnight stay in <strong>Sangla</strong>.</p>';
const bullets = (n: number, label: string) =>
  `<p><strong>Attractions Covered:</strong></p><ul>${Array.from({ length: n }, (_, i) => `<li><strong>${label} stop ${i + 1}</strong> - Scenic views and photo spots for the whole family.</li>`).join('')}</ul><p><strong>Inclusions:</strong></p><ul><li>Guided tour</li><li>All transfers</li></ul>`;
const longDesc = `<p>Day three explores the city from dawn to dusk with a packed schedule.</p>` + bullets(12, 'Grand');
const veryLongDesc = `<p>An epic full-day exploration across valleys and high passes.</p>` + bullets(30, 'Epic');

const sight = {
  include: true, sectionTitle: 'S', amount: '0', description: null as string | null,
  days: [
    {
      dayNumber: 1, title: 'Chandigarh to Shimla', city: 'Shimla', date: '2026-12-08',
      dailyTransfer: 'PRIVATE', meals: { breakfast: false, lunch: false, dinner: true },
      activities: [{ name: 'Chandigarh to Shimla', sightseeingId: 's0', description: short1 }],
    },
    {
      dayNumber: 2, title: 'Shimla to Sangla & Chitkul Valley Extended Tour', city: 'Sangla', date: '2026-12-09',
      dailyTransfer: 'PRIVATE', meals: { breakfast: true, lunch: false, dinner: false }, mealMode: 'HOTEL',
      activities: [{ name: 'Shimla to Sangla', sightseeingId: 's1', description: short2 }],
    },
    // Day 3: no image, no meals, no transfer, no date, long title — optionals must vanish cleanly.
    {
      dayNumber: 3, title: 'A Very Long Itinerary Title That Must Wrap Gracefully Onto Multiple Lines Without Clipping', city: null, date: null,
      activities: [{ name: 'Something Else Entirely', description: '<p>Minimal day, nothing extra attached to it.</p>' }],
    },
    // Day 4: long description forces a fresh page, then flows onward.
    {
      dayNumber: 4, title: 'Grand Long Tour', city: 'Chitkul', date: '2026-12-11',
      dailyTransfer: 'SHARED', meals: { breakfast: false, lunch: true, dinner: false },
      activities: [{ name: 'Grand Activity', sightseeingId: 's2', description: longDesc, startTime: '08:00', duration: '10 hours' }],
    },
    // Day 5: very long description exceeds one page.
    {
      dayNumber: 5, title: 'Epic Mega Tour', city: 'Leh', date: '2026-12-12',
      activities: [{ name: 'Epic Activity', sightseeingId: 's3', description: veryLongDesc }],
    },
  ],
};

const input = {
  company: { name: 'Vacation Triangle', email: 'c@t.t', phone: '+91', website: null, address: null, primaryColor: '#17386f', operatingSinceYear: 2016, tripsSold: 1, tan: null, taxRegistrationNumber: null, logo },
  consultant: { name: 'Aditi Rao', phone: '+911100000001', email: 'a@b.c' },
  quotation: {
    quotationNumber: 'QT-D', customerName: 'Rahul Sharma', customerEmail: null, customerPhone: '+91',
    destinationSummary: 'Himachal', destinations: 'Himachal',
    travelStartDate: new Date('2026-12-08'), travelEndDate: new Date('2026-12-15'),
    adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0, rooms: 1, validUntil: null,
  },
  version: {
    versionNumber: 1, title: 'Himachal', introduction: null, currency: 'INR', finalAmount: '0', notes: null,
    perAdultPrice: '50000', perChildWithBedPrice: '0', perChildWithoutBedPrice: '0', perInfantPrice: '0', taxNote: null,
    initialPaymentAmount: '0', paymentLink: null, inclusionsHtml: null, exclusionsHtml: null, paymentPolicies: null,
    cancellationPolicies: null, bookingTerms: null, includeVisa: false, visaSectionTitle: null, visaAmount: '0',
    visaType: null, visaServiceCharge: '0', visaGstPercent: '0', visaVfsCharge: '0', flightDetails: null, hotels: [], itinerary: [],
    services: [{ serviceType: 'TRANSFER' }], inclusions: [], exclusions: [], terms: [],
    sightseeingDetails: sight, discountAmount: '0', packageCustomItems: [],
  },
  images: { cover: hero, sightseeing: { s0: c1, s1: c2, s2: c3, s3: c4 } },
} as unknown as Parameters<typeof renderStylishQuotationPdf>[0];

const pdf = await renderStylishQuotationPdf(input);
writeFileSync('../../tmp/footer-verify/itin-newdesign.pdf', pdf);
console.log('bytes', pdf.length);

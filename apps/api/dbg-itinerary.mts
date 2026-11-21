import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderStylishQuotationPdf } from './src/modules/quotations/stylish-pdf.service.js';

const mk = (r: number, g: number, b: number) =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
const hero = await sharp({
  create: { width: 900, height: 700, channels: 3, background: { r: 96, g: 128, b: 168 } },
})
  .png()
  .toBuffer();
const logo = await mk(212, 164, 65);
const c1 = await mk(150, 90, 60);
const c2 = await mk(60, 140, 100);
const c3 = await mk(60, 100, 160);

const sentosaDesc = `<p><strong>Sentosa Island</strong> is Singapore's vibrant resort island, known for its beautiful beaches, exciting attractions and world-class entertainment. Enjoy a memorable experience exploring some of Sentosa's most popular attractions.</p><p><strong>Attractions Covered:</strong></p><ul><li><strong>Singapore Cable Car - One Way</strong> - Enjoy panoramic views of Singapore Harbour and Sentosa Island.</li><li><strong>Madame Tussauds Singapore - 4-in-1 Experience</strong> - Get up close with lifelike wax figures of famous celebrities and personalities.</li><li><strong>Wings of Time</strong> - Enjoy a spectacular outdoor show featuring lights, lasers, water effects, music and special effects.</li></ul><p><strong>Inclusions:</strong></p><ul><li>Sentosa Island Experience</li><li>Singapore Cable Car - One Way</li><li>Madame Tussauds 4-in-1</li><li>Wings of Time</li><li>Return Transfers</li></ul>`;

const longDesc =
  `<p>Day three explores the city from dawn to dusk with a packed schedule of sightseeing, shopping and local food tasting across multiple neighbourhoods.</p>` +
  `<p><strong>Attractions Covered:</strong></p><ul>` +
  Array.from({ length: 12 }, (_, i) => `<li><strong>Stop ${i + 1}</strong> - A wonderful place to visit with family and friends, full of photo spots and local stories.</li>`).join('') +
  `</ul><p><strong>Inclusions:</strong></p><ul>` +
  Array.from({ length: 10 }, (_, i) => `<li>Inclusion item number ${i + 1} with helpful detail</li>`).join('') +
  `</ul>` +
  `<p>We return to the hotel in the evening after a full day, with memories and souvenirs from a wonderful tour.</p>`.repeat(6);

const sight = {
  include: true,
  sectionTitle: 'Day Wise Itinerary',
  amount: '0',
  description: null as string | null,
  days: [
    {
      dayNumber: 1,
      title: 'Sentosa Island - Cable Car, Madame Tussauds & Wings of Time',
      city: 'Singapore',
      date: '2026-12-12',
      dailyTransfer: 'PRIVATE',
      meals: { breakfast: true, lunch: false, dinner: false },
      mealMode: 'HOTEL',
      activities: [
        {
          name: 'Sentosa Island - Cable Car, Madame Tussauds & Wings of Time',
          sightseeingId: 's0',
          description: sentosaDesc,
          startTime: '09:00',
          duration: '7 hours',
        },
      ],
    },
    {
      dayNumber: 2,
      title: 'Marina Bay City Tour',
      city: 'Singapore',
      date: '2026-12-13',
      activities: [
        {
          name: 'Marina Bay City Tour',
          sightseeingId: 's1',
          description: '<p>A relaxed half-day city tour covering Marina Bay Sands, Gardens by the Bay and the Merlion.</p>',
        },
      ],
    },
    {
      dayNumber: 3,
      title: 'Full Day Grand Tour',
      city: 'Singapore',
      date: '2026-12-14',
      dailyTransfer: 'SHARED',
      meals: { breakfast: false, lunch: true, dinner: false },
      activities: [
        {
          name: 'Grand Tour Activity',
          sightseeingId: 's2',
          description: longDesc,
          startTime: '08:00',
          duration: '10 hours',
        },
      ],
    },
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
    destinationSummary: 'Singapore', destinations: 'Singapore',
    travelStartDate: new Date('2026-12-12'), travelEndDate: new Date('2026-12-14'),
    adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0, rooms: 1, validUntil: null,
  },
  version: {
    versionNumber: 1, title: 'Singapore', introduction: null, currency: 'INR',
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
  images: { cover: hero, sightseeing: { s0: c1, s1: c2, s2: c3 } },
} as unknown as Parameters<typeof renderStylishQuotationPdf>[0];

const pdf = await renderStylishQuotationPdf(input);
writeFileSync('../../tmp/footer-verify/itinerary-nobox.pdf', pdf);
console.log('bytes', pdf.length);

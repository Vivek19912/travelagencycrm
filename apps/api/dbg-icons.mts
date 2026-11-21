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

const sight = {
  include: true, sectionTitle: 'S', amount: '0', description: null as string | null,
  days: [
    { dayNumber: 1, title: 'D1', city: 'Baga', date: '2026-10-05', activities: [{ name: 's', sightseeingId: 's0', description: 'v' }] },
    { dayNumber: 2, title: 'D2', city: 'Cal', date: '2026-10-05', activities: [{ name: 's', sightseeingId: 's1', description: 'v' }] },
    { dayNumber: 3, title: 'D3', city: 'Anj', date: '2026-10-05', activities: [{ name: 's', sightseeingId: 's2', description: 'v' }] },
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
    destinationSummary: 'Goa', destinations: 'Goa',
    travelStartDate: new Date('2026-10-05'), travelEndDate: new Date('2026-10-12'),
    adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0, rooms: 1, validUntil: null,
  },
  version: {
    versionNumber: 1, title: 'Goa', introduction: null, currency: 'INR',
    finalAmount: '0', notes: null, perAdultPrice: '50000', perChildWithBedPrice: '0',
    perChildWithoutBedPrice: '0', perInfantPrice: '0', taxNote: null, initialPaymentAmount: '0',
    paymentLink: null, inclusionsHtml: null, exclusionsHtml: null, paymentPolicies: null,
    cancellationPolicies: null, bookingTerms: null, includeVisa: false, visaSectionTitle: null,
    visaAmount: '0', visaType: null, visaServiceCharge: '0', visaGstPercent: '0',
    visaVfsCharge: '0', flightDetails: null, hotels: [], itinerary: [],
    services: [{ serviceType: 'TRANSFER' }], inclusions: [], exclusions: [],
    terms: [], sightseeingDetails: sight, discountAmount: '0',
    packageCustomItems: [
      { label: 'Flight Charges', amount: 9999 },
      { label: 'Visa Charges', amount: 100 },
      { label: 'International Flight Tickets', amount: 5000 },
      { label: 'Singapore Visa Fees', amount: 200 },
      { label: 'eating', amount: 12 },
      { label: 'Hotel Charges', amount: 3000 },
      { label: 'FLIGHT TICKETS', amount: 10 },
      { label: 'ViSa Processing', amount: 20 },
    ],
  },
  images: { cover: hero, sightseeing: { s0: c1, s1: c2, s2: c3 } },
} as unknown as Parameters<typeof renderStylishQuotationPdf>[0];

const pdf = await renderStylishQuotationPdf(input);
writeFileSync('../../tmp/footer-verify/icons-flightvisa.pdf', pdf);
console.log('bytes', pdf.length);

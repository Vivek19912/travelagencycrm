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

async function renderCase(name: string, opts: {
  pax?: { adults?: number; cwb?: number; cwob?: number; infants?: number };
  rates?: { adult?: string; cwb?: string; cwob?: string; infant?: string };
  custom?: Array<{ label: string; amount: number }>;
  discount?: string; currency?: string; taxNote?: string | null; booking?: string;
}) {
  const pax = { adults: 2, cwb: 0, cwob: 0, infants: 0, ...opts.pax };
  const rates = { adult: '50000', cwb: '0', cwob: '0', infant: '0', ...opts.rates };
  const input = {
    company: {
      name: 'Vacation Triangle', email: 'c@t.t', phone: '+91', website: null, address: null,
      primaryColor: '#17386f', operatingSinceYear: 2016, tripsSold: 1, tan: null,
      taxRegistrationNumber: null, logo,
    },
    consultant: { name: 'Aditi Rao', phone: '+911100000001', email: 'a@b.c' },
    quotation: {
      quotationNumber: 'QT-001083', customerName: 'Akash Sahni', customerEmail: null, customerPhone: '+91',
      destinationSummary: 'Singapore Heaven Delight', destinations: 'Singapore Heaven Delight',
      travelStartDate: new Date('2026-12-12'), travelEndDate: new Date('2026-12-18'),
      adults: pax.adults, childrenWithBed: pax.cwb, childrenWithoutBed: pax.cwob,
      infants: pax.infants, rooms: 1, validUntil: null,
    },
    version: {
      versionNumber: 1, title: 'Singapore Heaven Delight', introduction: null, currency: opts.currency ?? 'INR',
      finalAmount: '0', notes: null, perAdultPrice: rates.adult, perChildWithBedPrice: rates.cwb,
      perChildWithoutBedPrice: rates.cwob, perInfantPrice: rates.infant,
      taxNote: opts.taxNote === undefined ? 'Inclusive of all taxes' : opts.taxNote,
      initialPaymentAmount: opts.booking ?? '0', paymentLink: 'https://pay.example.test/abc',
      inclusionsHtml: null, exclusionsHtml: null, paymentPolicies: null,
      cancellationPolicies: null, bookingTerms: null, includeVisa: false, visaSectionTitle: null,
      visaAmount: '0', visaType: null, visaServiceCharge: '0', visaGstPercent: '0',
      visaVfsCharge: '0', flightDetails: null, hotels: [], itinerary: [],
      services: [{ serviceType: 'TRANSFER' }], inclusions: [], exclusions: [],
      terms: [], sightseeingDetails: sight, discountAmount: opts.discount ?? '0',
      packageCustomItems: opts.custom,
    },
    images: { cover: hero, sightseeing: { s0: c1, s1: c2, s2: c3 } },
  } as unknown as Parameters<typeof renderStylishQuotationPdf>[0];
  const pdf = await renderStylishQuotationPdf(input);
  writeFileSync(`../../tmp/footer-verify/custom2-${name}.pdf`, pdf);
  console.log(`wrote custom2-${name}.pdf (${pdf.length} bytes)`);
}

await renderCase('screenshot', {
  pax: { adults: 3, cwb: 1, cwob: 3, infants: 1 },
  rates: { adult: '4000', cwb: '5000', cwob: '90000', infant: '18' },
  custom: [
    { label: 'Flight Charges', amount: 9999 },
    { label: 'Visa Charges', amount: 100 },
    { label: 'eating', amount: 12 },
  ],
  discount: '999',
});
await renderCase('none', {}, {});
await renderCase('one', { custom: [{ label: 'Travel Insurance', amount: 2500 }] }, {});
await renderCase('longlabel', { custom: [{ label: 'A very long custom package item label that must wrap cleanly', amount: 1234 }] }, {});
await renderCase('usd', { currency: 'USD', custom: [{ label: 'Service Fee', amount: 50 }] }, {});
await renderCase('legacy', {}, {});
await renderCase('booking', { custom: [{ label: 'Flight Charges', amount: 9999 }, { label: 'Visa Charges', amount: 100 }], booking: '5000' }, {});
console.log('ALL RENDERED');

import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderStylishQuotationPdf } from './src/modules/quotations/stylish-pdf.service.js';

const mk = (r: number, g: number, b: number) =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
const hero = await mk(96, 128, 168);
const logo = await mk(212, 164, 65);
const h1 = await mk(150, 90, 60);
const h2 = await mk(60, 140, 100);
const h3 = await mk(60, 100, 160);
const h4 = await mk(140, 120, 60);
const h5 = await mk(90, 90, 140);
const h6 = await mk(120, 60, 120);
const h7 = await mk(70, 130, 130);
const h8 = await mk(130, 130, 70);

type H = Record<string, unknown>;
const hotel = (o: H): H => ({ selected: true, city: 'City', ...o });

const hotels: H[] = [
  // 1. Long address, 3 stars, NO dates, single room + single meal plan.
  hotel({ hotelName: 'Classic Luxury Resorts', category: '3 Star', city: 'Srinagar', roomType: 'Deluxe Room', rooms: 1, mealPlan: 'Breakfast' }),
  // 2. Long address, 2 stars, both dates.
  hotel({ hotelName: 'De Greenish Village Langkawi', category: '2', city: 'Langkawi', roomType: 'Superior Room', rooms: 1, checkInDate: new Date('2026-11-08'), checkOutDate: new Date('2026-11-13') }),
  // 3. Mockup ibis: short address, 3 stars, both dates, TWO room types.
  hotel({
    hotelName: 'ibis Singapore Novena', category: '3 Star', city: 'Singapore',
    checkInDate: new Date('2026-11-21'), checkOutDate: new Date('2026-11-28'),
    roomLines: [
      { roomType: 'Junior Suite Room', rooms: 1, extraBedQuantity: 2 },
      { roomType: 'Suite Room', rooms: 4 },
    ],
  }),
  // 4. No dates at all, 5 stars.
  hotel({ hotelName: 'Grand Palace No Dates', category: '5 Star', city: 'Jaipur', roomType: 'Royal Suite', rooms: 2, extraBedQuantity: 1 }),
  // 5. Only check-in.
  hotel({ hotelName: 'Checkin Only Inn', category: '4 Star', city: 'Udaipur', roomType: 'Lake View', rooms: 1, checkInDate: new Date('2026-12-01') }),
  // 6. Only check-out.
  hotel({ hotelName: 'Checkout Only Lodge', category: '4 Star', city: 'Jodhpur', roomType: 'Fort View', rooms: 1, checkOutDate: new Date('2026-12-05') }),
  // 7. No star category, short address, both dates.
  hotel({ hotelName: 'Unrated Guest House', category: null, city: 'Pushkar', roomType: 'Standard', rooms: 1, checkInDate: new Date('2026-12-10'), checkOutDate: new Date('2026-12-12') }),
  // 8. Multi-room + multi meal plans.
  hotel({
    hotelName: 'Multi Room Resort', category: '4 Star', city: 'Goa',
    checkInDate: new Date('2026-12-15'), checkOutDate: new Date('2026-12-20'),
    roomLines: [
      { roomType: 'Deluxe Sea View with Balcony and Bathtub', rooms: 2, extraBedQuantity: 1, childWithoutBedQuantity: 1 },
      { roomType: 'Premium Room', rooms: 1 },
      { roomType: 'Executive Suite', rooms: 3 },
    ],
    mealPlanLines: [{ mealPlan: 'Breakfast' }, { mealPlan: 'Half Board' }],
  }),
];

const presentations = [
  { starCategory: 3, address: 'Padshahi Bagh Lasjan Rd, Padshahi Bagh, K P Bagh, Srinagar, Jammu and Kashmir', starRating: '4.5', reviewLink: 'https://reviews.example.test/classic' },
  { starCategory: 2, address: 'Mukim Kuah, Jalan Ayer Hangat, 07000 Langkawi, Kedah, Malaysia', starRating: '3.9', reviewLink: 'https://reviews.example.test/greenish' },
  { starCategory: 3, address: '6 Irrawaddy Road, Singapore 329543', starRating: '4.0', reviewLink: 'https://reviews.example.test/ibis' },
  { starCategory: 5, address: 'MI Road, Jaipur 302001', starRating: null, reviewLink: null },
  { starCategory: 4, address: 'Lake Pichola Road, Udaipur', starRating: null, reviewLink: null },
  { starCategory: 4, address: 'Fort Road, Jodhpur', starRating: null, reviewLink: null },
  { starCategory: null, address: 'Main Market, Pushkar', starRating: null, reviewLink: null },
  { starCategory: 4, address: 'Beach Road, Calangute, Goa', starRating: null, reviewLink: null },
];

const inputFor = (hotels: H[], presentations: Record<string, unknown>[], images: Buffer[]) => ({
  company: { name: 'Canara Tales', email: 'canaratales@gmail.com', phone: '6363852132', website: 'https://canaratales.com/', address: null, primaryColor: '#17386f', operatingSinceYear: 2009, tripsSold: 5000, tan: 'LON012345B', taxRegistrationNumber: '29ABCDE1234F1Z5', logo },
  consultant: { name: 'Asha Rao', phone: '+911100000001', email: 'a@b.c' },
  quotation: {
    quotationNumber: 'QT-HOTEL', customerName: 'Rahul Sharma', customerEmail: null, customerPhone: '+91',
    destinationSummary: 'Singapore Malaysia India', destinations: 'Singapore Malaysia India',
    travelStartDate: new Date('2026-11-08'), travelEndDate: new Date('2026-12-20'),
    adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0, rooms: 1, validUntil: null,
  },
  version: {
    versionNumber: 1, title: 'Multi Hotel Stay', introduction: null, currency: 'INR', finalAmount: '0', notes: null,
    perAdultPrice: '50000', perChildWithBedPrice: '0', perChildWithoutBedPrice: '0', perInfantPrice: '0', taxNote: null,
    initialPaymentAmount: '0', paymentLink: null, inclusionsHtml: null, exclusionsHtml: null, paymentPolicies: null,
    cancellationPolicies: null, bookingTerms: null, includeVisa: false, visaSectionTitle: null, visaAmount: '0',
    visaType: null, visaServiceCharge: '0', visaGstPercent: '0', visaVfsCharge: '0', flightDetails: null, hotels,
    itinerary: [], services: [{ serviceType: 'TRANSFER' }], inclusions: [], exclusions: [], terms: [],
    sightseeingDetails: null, discountAmount: '0', packageCustomItems: [],
  },
  hotelPresentations: presentations,
  images: { cover: hero, hotels: images },
});

async function renderCase(name: string, hotels: H[], presentations: Record<string, unknown>[], images: Buffer[]) {
  const input = inputFor(hotels, presentations, images);
  const pdf = await renderStylishQuotationPdf(
    input as unknown as Parameters<typeof renderStylishQuotationPdf>[0],
  );
  writeFileSync(`../../tmp/footer-verify/${name}.pdf`, pdf);
  console.log(`wrote ${name}.pdf (${pdf.length} bytes)`);
}

await renderCase('hotels-mockup', hotels, presentations, [h1, h2, h3, h4, h5, h6, h7, h8]);
await renderCase('hotels-single-nodates', [hotels[3]!], [presentations[3]!], [h4]);
await renderCase('hotels-single-checkin', [hotels[4]!], [presentations[4]!], [h5]);
await renderCase('hotels-single-checkout', [hotels[5]!], [presentations[5]!], [h6]);
console.log('ALL HOTEL CASES RENDERED');

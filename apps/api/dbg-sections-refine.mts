import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { renderStylishQuotationPdf } from './src/modules/quotations/stylish-pdf.service.js';

const mk = (r: number, g: number, b: number) =>
  sharp({ create: { width: 600, height: 400, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
// Vehicle/cruise photos use `contain` fit, so these match the 219.8x154 box
// aspect exactly (full-bleed measurement); add-on/hero art uses `cover`.
const mkBox = (r: number, g: number, b: number) =>
  sharp({ create: { width: 620, height: 434, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
const hero = await mk(96, 128, 168);
const logo = await mk(212, 164, 65);
const fh = await mk(150, 90, 60);
const hh1 = await mk(60, 140, 100);
const hh2 = await mk(60, 100, 160);
const hh3 = await mk(140, 120, 60);
const vh1 = await mkBox(160, 60, 60);
const vh2 = await mkBox(60, 160, 140);
const ch1 = await mkBox(140, 60, 140);
const ad1 = await mk(200, 50, 150);
const ad2 = await mk(110, 90, 120);

const flightDetails = {
  include: true,
  sectionTitle: 'Flight Details',
  entryMode: 'MANUAL',
  flights: [
    {
      bookmarkCode: null,
      journeyType: 'ROUND_TRIP',
      outbound: {
        fromCity: 'New Delhi', toCity: 'Hanoi',
        segments: [
          {
            airlineId: null, airlineName: 'IndiGo', flightNumber: '6E 1633', travelClass: 'ECONOMY',
            from: 'Indira Gandhi International Airport', to: 'Noi Bai International Airport',
            departureDate: '2026-12-01', departureTime: '12:20', arrivalDate: '2026-12-01', arrivalTime: '18:05',
            duration: '5h 45m', cabinLuggage: '10kg', checkInLuggage: '30kg', notes: '<p>First ticket note.</p>',
          },
        ],
      },
      returnJourney: {
        fromCity: 'Hanoi', toCity: 'New Delhi',
        segments: [
          {
            airlineId: null, airlineName: 'VietJet', flightNumber: 'VJ 896', travelClass: 'ECONOMY',
            from: 'Noi Bai International Airport', to: 'Indira Gandhi International Airport',
            departureDate: '2026-12-08', departureTime: '19:40', arrivalDate: '2026-12-08', arrivalTime: '22:55',
            duration: '5h 45m', cabinLuggage: '7kg', checkInLuggage: '20kg', notes: null,
          },
        ],
      },
    },
  ],
};

const hotels = [
  {
    hotelName: 'Hotel Boss', category: '3 Star', city: 'Singapore', selected: true,
    checkInDate: new Date('2026-11-01'), checkOutDate: new Date('2026-11-21'),
    roomLines: [
      { roomType: 'Standard Room', rooms: 4 },
      { roomType: 'Suite Room', rooms: 1, extraBedQuantity: 1 },
      { roomType: 'Deluxe Room', rooms: 4 },
    ],
    mealPlanLines: [{ mealPlan: 'Breakfast' }, { mealPlan: 'Breakfast + Dinner (Veg)' }],
  },
  {
    hotelName: 'Skyfarm Resorts', category: '3 Star', city: 'Pahalgam', selected: true,
    checkInDate: null, checkOutDate: null, roomType: 'Deluxe', rooms: 1,
  },
  {
    hotelName: 'Heritage Luxury', category: '3 Star', city: 'Srinagar', selected: true,
    checkInDate: null, checkOutDate: null, roomType: 'Super Deluxe', rooms: 2,
  },
];
const presentations = [
  { starCategory: 3, address: '500 Jln Sultan, Singapore 199020', starRating: null, reviewLink: null },
  { starCategory: 3, address: 'Awoora, Dehwattu, Pahalgam, Anantnag, Jammu and Kashmir 192401', starRating: null, reviewLink: null },
  { starCategory: 3, address: "Police Hq's, Airport Road Hyderpora Near, Srinagar, Jammu and Kashmir 190014", starRating: null, reviewLink: null },
];

const services = [
  { serviceType: 'VEHICLE_TRANSFER', name: 'Innova Crysta', city: 'Delhi', notes: 'Sightseeing', description: 'This vehicle will be used for sightseeing.', taxCategory: 'Transportation', quantity: 1, unitSellingPrice: 5000 },
  { serviceType: 'VEHICLE_TRANSFER', name: 'Tempo Traveller', city: 'Delhi', notes: null, description: 'Group transfers for the full tour.', taxCategory: 'Transportation', quantity: 1, unitSellingPrice: 9000 },
  {
    serviceType: 'CRUISE', name: 'Amanda Halong Cruise', city: 'Halong Bay', notes: 'All meals aboard', description: 'Cruise for you. Enjoy and thank you for choosing.',
    quantity: 1, unitSellingPrice: 12000, cruiseNights: 3,
  },
  {
    serviceType: 'OTHER_ADD_ON', addOnServiceId: 'addon-zoo', name: 'Add-on Hanoi Zoo', city: null, notes: null,
    description: "Visit Vietnam's famous national zoo featuring over 5,000 animals, including the adorable giant pandas and exotic wildlife.",
    quantity: 1, unitSellingPrice: 0,
    pricingSnapshot: [
      { id: 'p1', label: 'Adult', price: 2000, currency: 'INR' },
      { id: 'p2', label: 'Child', price: 1000, currency: 'INR' },
    ],
  },
  {
    serviceType: 'OTHER_ADD_ON', addOnServiceId: 'addon-visa', name: 'Visa Assistance With Complete Documentation Support and Appointment Scheduling Services', city: null, notes: null,
    description: 'Complete visa documentation support with appointment scheduling.',
    quantity: 1, unitSellingPrice: 0,
    pricingSnapshot: [{ id: 'p3', label: 'Per Person', price: 1500, currency: 'INR' }],
  },
];

const inclusionsHtml = `<ul><li>06 Nights accommodation (2N Hanoi + 2N Da Nang + 2N Phu Quoc)</li><li>Daily breakfast at the hotel</li><li>Ha Long Bay Day Cruise (SIC) with lunch</li></ul>`;
const exclusionsHtml = `<ul><li>x International and domestic flight tickets</li><li>x 2% TCS (Tax collected at source) Vietnam visa charges</li><li>x Travel insurance</li><li>x Personal expenses such as laundry, telephone, minibar, etc.</li><li>x Meals and drinks not mentioned in the itinerary</li><li>x Early check-in or late check-out charges</li><li>x Optional tours and activities not mentioned in the itinerary</li><li>x Tips and gratuities for guides and drivers</li><li>x Any services not specifically mentioned under inclusions</li></ul>`;
const childPolicy = `<ul><li>Age 1-2: Free (no bed, entrance fee by guest)</li><li>Age 3-4: 30% of adult price (no bed)</li><li>Age 5-8: 50% of adult price (no bed)</li><li>Age 9-11: 75% of adult price (no bed)- with bed 85%</li><li>Age 12 and above: Adult price (with bed)</li></ul>`;

const input = {
  company: { name: 'XYZ Travel Agency', email: 'contact@xyztravelagency.in', phone: '9987789123', website: 'https://app.travelagencycrm.in', address: null, primaryColor: '#17386f', operatingSinceYear: 2001, tripsSold: 21000, tan: 'MUMA12345B', taxRegistrationNumber: '27ABCDE1234F1Z3', logo },
  consultant: { name: 'Aditi Rao', phone: '+911100000001', email: 'a@b.c' },
  quotation: {
    quotationNumber: 'QT-SEC', customerName: 'Vivek Lodhi', customerEmail: null, customerPhone: '+91',
    destinationSummary: 'Vietnam', destinations: 'Vietnam',
    travelStartDate: new Date('2026-12-01'), travelEndDate: new Date('2026-12-08'),
    adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0, rooms: 1, validUntil: null,
  },
  version: {
    versionNumber: 1, title: 'Vietnam Package', introduction: null, currency: 'INR', finalAmount: '0', notes: null,
    perAdultPrice: '50000', perChildWithBedPrice: '0', perChildWithoutBedPrice: '0', perInfantPrice: '0',
    taxNote: 'Inclusive of all taxes', initialPaymentAmount: '0', paymentLink: null,
    inclusionsHtml, exclusionsHtml, paymentPolicies: '<p>30% advance payment is required at the time of booking.</p>',
    cancellationPolicies: '<p>Hotel: As per the hotel policy.</p>', bookingTerms: null,
    includeVisa: false, visaSectionTitle: null, visaAmount: '0', visaType: null, visaServiceCharge: '0',
    visaGstPercent: '0', visaVfsCharge: '0', flightDetails, hotels, itinerary: [], services,
    inclusions: [], exclusions: [], terms: [], sightseeingDetails: null, discountAmount: '0', packageCustomItems: [],
    childPolicy,
  },
  hotelPresentations: presentations,
  images: { cover: hero, flight: fh, hotels: [hh1, hh2, hh3], services: [vh1, vh2, ch1, ad1, ad2] },
} as unknown as Parameters<typeof renderStylishQuotationPdf>[0];

const pdf = await renderStylishQuotationPdf(input);
writeFileSync('../../tmp/footer-verify/sections-refine.pdf', pdf);
console.log('bytes', pdf.length);

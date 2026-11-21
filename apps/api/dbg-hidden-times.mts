import { execFileSync } from 'node:child_process';
import { renderStylishQuotationPdf } from './src/modules/quotations/stylish-pdf.service.js';

const timedHotel = {
  city: 'Singapore', hotelName: 'Marina Bay Hotel', category: '5 Star', roomType: 'Deluxe',
  mealPlan: 'Breakfast', rooms: null, nights: 2, selected: true,
  checkInDate: new Date('2027-01-06'), checkOutDate: new Date('2027-01-08'),
  checkInTime: '15:30', checkOutTime: '11:15', notes: null,
};
const base = {
  company: { name: 'T', email: null, phone: null, website: null, address: null, primaryColor: '#2563eb', operatingSinceYear: null, tripsSold: null, tan: null, taxRegistrationNumber: null, logo: null },
  quotation: { quotationNumber: 'QT-X', customerName: 'M', customerEmail: null, customerPhone: '+91', destinationSummary: 'Kerala', travelStartDate: null, travelEndDate: null, adults: 2, childrenWithBed: 0, childrenWithoutBed: 0, infants: 0, rooms: 1, validUntil: null },
  images: { cover: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') },
};
const pdfText = (b: Buffer) => execFileSync('pdftotext', ['-layout', '-', '-'], { input: b }).toString();
const hiddenCheckIn = {
  ...base,
  version: {
    versionNumber: 1, title: 'T', introduction: null, currency: 'INR', finalAmount: '100', notes: null,
    perAdultPrice: '50', perChildWithBedPrice: '0', perChildWithoutBedPrice: '0', perInfantPrice: '0', taxNote: null,
    initialPaymentAmount: '0', paymentLink: null, inclusionsHtml: null, exclusionsHtml: null, paymentPolicies: null,
    cancellationPolicies: null, bookingTerms: null, includeVisa: false, visaSectionTitle: null, visaAmount: '0',
    visaType: null, visaServiceCharge: '0', visaGstPercent: '0', visaGSTPercent: '0', visaVfsCharge: '0',
    flightDetails: null, sightseeingDetails: null, hotels: [{ ...timedHotel, rooms: null, showCheckInTime: false, showCheckOutTime: true }],
    itinerary: [], services: [], inclusions: [], exclusions: [], terms: [],
  },
  hotelPresentations: [{ starCategory: 5, address: '10 Bayfront, Singapore', starRating: null, reviewLink: null }],
};
const t: string = execFileSync('pdftotext', ['-layout', '-', '-'], { input: await renderStylishQuotationPdf(hiddenCheckIn as never) }).toString();
const hotelPage: string = execFileSync('pdftotext', ['-layout', '-f', '3', '-l', '3', '-', '-'], { input: await renderStylishQuotationPdf(hiddenCheckIn as never) }).toString();
const checks: Array<[boolean, string]> = [
  [!t.includes('3:30 PM'), 'no check-in time'],
  [!t.includes('11:15 AM'), 'no check-out time'],
  [t.includes('8 Jan 2027'), 'check-out date present'],
  [t.includes('6 Jan 2027'), 'check-in date present'],
  [!hotelPage.includes('As advised'), 'no As advised on hotel page'],
];
let fail = 0;
for (const [ok, label] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} hiddenCheckIn stylish: ${label}`);
  if (!ok) fail += 1;
}
process.exit(fail ? 1 : 0);

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
const hiddenCheckIn = {
  ...base,
  version: {
    versionNumber: 1, title: 'T', introduction: null, currency: 'INR', finalAmount: '100', notes: null, perAdultPrice: '50', perChildWithBedPrice: '0', perChildWithoutBedPrice: '0', perInfantPrice: '0', taxNote: null, initialPaymentAmount: '0', paymentLink: null, inclusionsHtml: null, exclusionsHtml: null, paymentPolicies: null, cancellationPolicies: null, bookingTerms: null, includeVisa: false, visaSectionTitle: null, visaAmount: '0', visaType: null, visaServiceCharge: '0', visaGstPercent: '0', visaVfsCharge: '0', flightDetails: null, sightseeingDetails: null,
    hotels: [{ ...timedHotel, rooms: null, showCheckInTime: false, showCheckOutTime: true }], itinerary: [], services: [], inclusions: [], exclusions: [], terms: [],
  },
  hotelPresentations: [{ starCategory: 5, address: '10 Bayfront, Singapore', starRating: null, reviewLink: null }],
};
const t: string = execFileSync('pdftotext', ['-layout', '-', '-'], { input: await renderStylishQuotationPdf(hiddenCheckIn as never) }).toString();
for (const line of t.split('\n')) if (line.includes('As advised')) console.log('CTX: ' + JSON.stringify(line));

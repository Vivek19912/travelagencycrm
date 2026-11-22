import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  formatItineraryDayTitle,
  resolveItineraryActivityImage,
  resolveItineraryDayImage,
  stripItineraryDayPrefixes,
} from '@interscale/shared';
import {
  CONTENT_BOTTOM_LIMIT,
  PDF_BOTTOM_MARGIN,
  PDF_FOOTER_HEIGHT,
  PDF_MIN_PAGE_HEIGHT,
  PDF_PAGE_HEIGHT,
  PDF_PAGE_WIDTH,
  PDF_POST_CONTENT_GAP,
  PDF_TOP_MARGIN,
  computePageHeight,
  htmlToLines,
  htmlToRichTextLines,
  pdfActivityImageOrCover,
  pdfDayAllowsDestinationFallback,
  renderQuotationPdf,
  type QuotationPdfDestinationExpert,
} from '../src/modules/quotations/pdf.service.js';
import { renderStylishQuotationPdf } from '../src/modules/quotations/stylish-pdf.service.js';
import { renderBookingConfirmationPdf } from '../src/modules/bookings/booking-pdf.service.js';
import {
  renderBookingInvoicePdf,
  renderBookingTaxInvoicePdf,
  renderBookingVoucherPdf,
} from '../src/modules/bookings/booking-invoice.service.js';

/**
 * PDF rendering robustness. Exercises every customer-facing document with
 * deliberately long content (long names/addresses, many travellers, many
 * services, long itinerary and terms) and asserts the output is a valid,
 * multi-page PDF that never leaks internal cost. Not a pixel snapshot.
 */

const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-';
const pageCount = (buffer: Buffer) =>
  (buffer.toString('latin1').match(/\/Type\s*\/Page(?![sR])/g) ?? []).length;

/** Per-page physical dimensions from each /MediaBox. */
const pageMediaBoxes = (buffer: Buffer): Array<{ width: number; height: number }> => {
  const raw = buffer.toString('latin1');
  const re = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g;
  const boxes: Array<{ width: number; height: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    boxes.push({ width: Number(match[1]), height: Number(match[2]) });
  }
  return boxes;
};

/** Word bounding boxes via poppler's pdftotext -bbox (y measured from the top). */
function wordBoxes(buffer: Buffer): Array<{
  text: string;
  xMin: number;
  yBottomFromTop: number;
}> {
  const bbox = execFileSync('pdftotext', ['-bbox', '-', '-'], {
    input: buffer,
    maxBuffer: 32 * 1024 * 1024,
  }).toString('utf8');
  return [
    ...bbox.matchAll(
      /<word[^>]*xMin="([\d.]+)"[^>]*yMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*yMax="([\d.]+)"[^>]*>(.*?)<\/word>/g,
    ),
  ].map((m) => ({ text: m[5] ?? '', xMin: Number(m[1]), yBottomFromTop: Number(m[4]) }));
}

function pageWordBoxes(buffer: Buffer): Array<{
  height: number;
  words: Array<{ text: string; yMax: number }>;
}> {
  const bbox = execFileSync('pdftotext', ['-bbox', '-', '-'], {
    input: buffer,
    maxBuffer: 32 * 1024 * 1024,
  }).toString('utf8');
  return [...bbox.matchAll(/<page\s+width="[\d.]+"\s+height="([\d.]+)">([\s\S]*?)<\/page>/g)].map(
    (page) => ({
      height: Number(page[1]),
      words: [...(page[2] ?? '').matchAll(/<word[^>]*yMax="([\d.]+)"[^>]*>(.*?)<\/word>/g)].map(
        (word) => ({ text: word[2] ?? '', yMax: Number(word[1]) }),
      ),
    }),
  );
}

/** Company with no footer section data, so only the Page badge sits low. */
const footerEmptyCompanyForOverlap = () => ({
  name: 'Alpha Travel',
  email: '',
  phone: null,
  website: null,
  address: null,
  primaryColor: '#2563eb',
  operatingSinceYear: null,
  tripsSold: null,
  tan: null,
  taxRegistrationNumber: null,
  logo: null,
});

describe('Stylish quotation PDF', () => {
  it('renders versioned customer copy in both styles without leaking internal notes', async () => {
    const longIntroduction = Array.from(
      { length: 90 },
      (_, index) =>
        `Introduction line ${index + 1}: your planned journey remains carefully documented.`,
    ).join('\n');
    const longNotes = Array.from(
      { length: 90 },
      (_, index) => `Customer note ${index + 1}: passport and booking conditions remain important.`,
    ).join('\n');
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        introduction: longIntroduction,
        notes: longNotes,
      },
      images: { cover: PNG_1PX },
    };
    (input.version as typeof input.version & { internalNotes: string }).internalNotes =
      'INTERNAL-PDF-SECRET';

    for (const rendered of [
      await renderStylishQuotationPdf(input),
      await renderQuotationPdf(input),
    ]) {
      const text = pdfText(rendered);
      expect(text).toContain('Introduction line 1');
      expect(text).toContain('Introduction line 90');
      expect(text).toContain('Customer note 1');
      expect(text).toMatch(/Customer note\s+90/);
      expect(text).not.toContain('INTERNAL-PDF-SECRET');
      const pages = pageWordBoxes(rendered);
      for (const page of pages)
        expect(Math.max(0, ...page.words.map((word) => word.yMax))).toBeLessThanOrEqual(
          page.height,
        );
      expect(pdfTextPage(rendered, pageCount(rendered))).toMatch(/THANK\s+YOU/i);
    }
  });

  it('omits empty customer-copy headings in both styles', async () => {
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: baseVersionOverlap(),
      images: { cover: PNG_1PX },
    };
    for (const rendered of [
      await renderStylishQuotationPdf(input),
      await renderQuotationPdf(input),
    ]) {
      const text = pdfText(rendered);
      expect(text).not.toContain('NOTES FOR CUSTOMER');
      expect(text).not.toContain('INTRODUCTION');
    }
  });

  it('omits a whitespace-only introduction in both PDF styles', async () => {
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: { ...baseVersionOverlap(), introduction: '   \n   ' },
      images: { cover: PNG_1PX },
    };
    for (const rendered of [
      await renderStylishQuotationPdf(input),
      await renderQuotationPdf(input),
    ]) {
      expect(pdfText(rendered)).not.toContain('INTRODUCTION');
    }
  });

  it('renders a non-empty introduction in both PDF styles', async () => {
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        introduction: 'Welcome aboard this curated coastal journey.',
      },
      images: { cover: PNG_1PX },
    };
    for (const rendered of [
      await renderStylishQuotationPdf(input),
      await renderQuotationPdf(input),
    ]) {
      expect(pdfText(rendered)).toContain('INTRODUCTION');
      expect(pdfText(rendered)).toContain('Welcome aboard this curated coastal journey.');
    }
  });

  it('omits an empty Visa card from the Stylish Add-On Services section', async () => {
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        // Visa flag is on but there is no actual visa content.
        includeVisa: true,
        visaSectionTitle: 'Visa',
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
      },
      images: { cover: PNG_1PX },
    };
    const rendered = await renderStylishQuotationPdf(input);
    const text = pdfText(rendered);
    // No Visa section, no empty card, no generated Add-On Services page.
    expect(text).not.toContain('ADD-ON SERVICES');
    expect(text).not.toMatch(/Visa/);
    // Removing the empty Visa page leaves no extra or blank page: the baseline
    // empty proposal is cover + personalised letter + thank you (3 pages).
    const total = pageCount(rendered);
    expect(total).toBe(3);
    expect(pdfTextPage(rendered, total)).toMatch(/THANK\s+YOU/i);
  });

  it('still renders the Visa card in the Stylish PDF when visa content exists', async () => {
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        includeVisa: true,
        visaSectionTitle: 'Visa Details',
        visaAmount: '2000.00',
        visaDestination: 'Singapore',
        visaType: 'Tourist',
        visaServiceCharge: '500.00',
        visaGstPercent: '18',
        visaVfsCharge: '300.00',
      },
      images: { cover: PNG_1PX },
    };
    const rendered = await renderStylishQuotationPdf(input);
    const text = pdfText(rendered);
    expect(text).toContain('ADD-ON SERVICES');
    expect(text).toMatch(/Visa Details/);
    expect(text).toContain('Singapore');
    expect(text).toContain('Tourist');
  });

  it('keeps long policy content out of the footer area across many pages', async () => {
    const veryLongPolicy =
      'Cancellation, refund, force-majeure and liability terms. '.repeat(200);
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        inclusionsHtml: `<ul>${'<li>An included amenity with enough words to wrap onto many rows and force multiple policy pages.</li>'.repeat(150)}</ul>`,
        exclusionsHtml: `<ul>${'<li>An excluded item with enough words to wrap onto many rows across several pages.</li>'.repeat(150)}</ul>`,
        paymentPolicies: `<p>${veryLongPolicy}</p>`,
        cancellationPolicies: `<p>${veryLongPolicy}</p>`,
        bookingTerms: `<p>${veryLongPolicy}</p>`,
      },
      images: { cover: PNG_1PX },
    };
    const rendered = await renderStylishQuotationPdf(input);
    expect(isPdf(rendered)).toBe(true);
    const total = pageCount(rendered);
    // Deliberately long policy content must span multiple pages.
    expect(total).toBeGreaterThan(3);
    expect(pdfTextPage(rendered, total)).toMatch(/THANK\s+YOU/i);

    // No body content word may sit inside a page's reserved footer area, and no
    // word may render outside the physical page. Footer columns are the only
    // words expected below the footer divider.
    const footerTokens = new Set([
      'CONTACT',
      'US',
      'OUR',
      'ACHIEVEMENTS',
      'LEGAL',
      'INFO',
      'TRAVEL',
      'HOLIDAYS',
      'Page',
      'of',
    ]);
    for (const [pageIndex, page] of pageWordBoxes(rendered).entries()) {
      // Page 1 is the cover, which carries no footer (the consultant strip is a
      // designed cover element). Only numbered content pages have a footer.
      if (pageIndex === 0) continue;
      const footerTop = page.height - (841.89 - 769);
      for (const word of page.words) {
        expect(word.yMax).toBeLessThanOrEqual(page.height);
        if (word.yMax <= footerTop - 1) continue;
        // Words below the footer divider must belong to the footer itself.
        expect(footerTokens.has(word.text) || /^\d+$/.test(word.text)).toBe(true);
      }
    }
  });

  it('renders vehicle title, usage and description consistently in both PDF styles', async () => {
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        addOnDetails: { include: true },
        services: [
          {
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Airport transfer',
            description: 'Private airport pickup in a clean vehicle.',
            city: 'Sports Racing',
            notes: '3333 days',
            taxCategory: 'Transportation',
            quantity: 1,
            unitSellingPrice: 100,
          },
        ],
      },
      images: {
        cover: PNG_1PX,
        services: [PNG_1PX],
      },
    };
    const pdf = await renderStylishQuotationPdf(input);
    const classicPdf = await renderQuotationPdf(input);

    const coverText = pdfTextPage(pdf, 1);
    expect(coverText).toContain('Transport');
    expect(coverText).not.toContain('Add-ons');
    for (const rendered of [pdf, classicPdf]) {
      const text = pdfText(rendered);
      expect(text.toLowerCase()).toContain('transportation');
      expect(text).toContain('Sports Racing');
      expect(text).toContain('3333 days');
      expect(text).toContain('Private airport pickup in a clean vehicle.');
    }
  });

  it('renders a fixed-A4 photo-led proposal while preserving rich text', async () => {
    const pdf = await renderStylishQuotationPdf({
      company: {
        ...footerEmptyCompanyForOverlap(),
        email: 'hello@example.test',
        phone: '+91 90000 00000',
        website: 'https://example.test',
        operatingSinceYear: 2012,
        tripsSold: 600,
        logo: PNG_1PX,
      },
      consultant: { name: 'Rahul Tiwari', phone: '+91 90000 00000', email: 'rahul@example.test' },
      quotation: {
        ...quotationOverlap(),
        destinations: 'Singapore',
        travelStartDate: new Date('2027-01-06T00:00:00.000Z'),
        travelEndDate: new Date('2027-01-12T00:00:00.000Z'),
      },
      version: {
        ...baseVersionOverlap(),
        title: 'Singapore Package for Mira Shah',
        finalAmount: '384000',
        initialPaymentAmount: '50000',
        inclusionsHtml: '<ul><li>Hotel accommodation</li><li>Shared transfers</li></ul>',
        exclusionsHtml: '<ul><li>Personal expenses</li></ul>',
        paymentPolicies: '<p><strong>Initial payment</strong> confirms the booking.</p>',
        cancellationPolicies: '<p>Cancellation charges apply.</p>',
        bookingTerms: '<p>Rates remain subject to availability.</p>',
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 4,
              title: 'Day 4: Universal Studios',
              city: 'Singapore',
              date: '2027-01-09',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Universal Studios Singapore',
                  description:
                    '<p>Highlights &amp; Rides:</p><ul><li>🦖 <strong>Jurassic Park Rapids Adventure</strong> – exciting river-rafting adventure</li><li>🚀 <strong>Battlestar Galactica</strong> – high-speed roller coasters</li></ul>',
                  startTime: '09:00',
                },
              ],
            },
          ],
        },
      },
      images: { cover: PNG_1PX },
    });

    expect(isPdf(pdf)).toBe(true);
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(5);
    for (const box of pageMediaBoxes(pdf)) {
      expect(box.width).toBeCloseTo(595.28, 1);
      expect(box.height).toBeCloseTo(841.89, 1);
    }
    const visible = pdfText(pdf);
    expect(visible).toContain('Singapore Package for Mira Shah');
    expect(visible).toContain('DAY WISE ITINERARY');
    expect(visible).toContain('Sat, 09 Jan 2027');
    expect(visible).not.toContain('9:00 AM');
    expect(visible).toContain('Jurassic Park Rapids Adventure');
    expect(visible).toContain('THANK YOU');
  });

  it('keeps long add-on descriptions inside a compact card and hides add-on money', async () => {
    const description =
      'This add-on description is intentionally long so it wraps across several lines while remaining fully inside its card. '.repeat(
        5,
      );
    const pdf = await renderStylishQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        addOnDetails: { include: true },
        services: [
          {
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'visa-master',
            name: 'Visa assistance',
            description,
            city: null,
            quantity: 1,
            unitSellingPrice: 98765,
          },
        ],
      },
      images: { cover: PNG_1PX },
    });
    const visible = pdfText(pdf);
    expect(visible).toContain('ADD-ON SERVICES');
    expect(visible).toContain('Visa assistance');
    expect(visible).toContain('remaining fully inside its card');
    expect(visible).not.toContain('98,765');
    expect(pageMediaBoxes(pdf).some((box) => box.height < PDF_PAGE_HEIGHT)).toBe(true);
  });

  it('renders editor emojis in both add-on PDF styles without missing glyph boxes', async () => {
    const input: Parameters<typeof renderStylishQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        addOnDetails: { include: true },
        services: [
          {
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'visa-master',
            name: 'Visa assistance',
            description:
              '<p>🇮🇳 India Visa Assistance</p><p>✅ Assistance</p><p>📄 Documents</p><p>✈️ Travel recommendation</p>',
            city: null,
            quantity: 1,
            unitSellingPrice: 0,
          },
        ],
      },
      images: { cover: PNG_1PX },
    };
    const stylishPdf = await renderStylishQuotationPdf(input);
    expect(pdfText(stylishPdf)).not.toContain('YOUR JOURNEY, BEAUTIFULLY PLANNED');
    for (const pdf of [stylishPdf, await renderQuotationPdf(input)]) {
      const visible = pdfText(pdf);
      expect(visible).toContain('India Visa Assistance');
      expect(visible).toContain('Assistance');
      expect(visible).toContain('Documents');
      expect(visible).toContain('Travel recommendation');
      expect(visible).not.toContain('□');
      const imageObjects = pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? [];
      expect(imageObjects.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('keeps duplicate flight, hotel and sightseeing rows out of Travel Services', async () => {
    const pdf = await renderStylishQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        services: [
          {
            serviceType: 'FLIGHT',
            name: 'duplicate flight card',
            description: null,
            city: null,
            quantity: 1,
            unitSellingPrice: 0,
          },
          {
            serviceType: 'HOTEL',
            name: 'duplicate hotel card',
            description: null,
            city: null,
            quantity: 1,
            unitSellingPrice: 0,
          },
          {
            serviceType: 'SIGHTSEEING',
            name: 'duplicate sightseeing card',
            description: null,
            city: null,
            quantity: 1,
            unitSellingPrice: 0,
          },
          {
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Private SUV',
            description: 'Private transportation throughout the trip.',
            city: 'SUV',
            notes: '5 Days',
            taxCategory: 'Transportation',
            quantity: 1,
            unitSellingPrice: 0,
          },
          {
            serviceType: 'CRUISE',
            name: 'Kerala Backwater Cruise',
            description: 'Private houseboat cruise through the backwaters.',
            city: 'Deluxe Cabin',
            notes: '2 Nights',
            quantity: 1,
            unitSellingPrice: 0,
          },
          {
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'addon-master',
            name: 'Priority assistance',
            description: 'Optional assistance service.',
            city: null,
            quantity: 1,
            unitSellingPrice: 5000,
          },
        ],
      },
      images: {
        cover: PNG_1PX,
        services: [null, null, null, PNG_1PX, PNG_1PX, null],
      },
    });
    const visible = pdfText(pdf);
    expect(visible).toContain('CRUISE DETAILS');
    expect(visible).toContain('Kerala Backwater Cruise');
    expect(visible).toContain('Deluxe Cabin');
    expect(visible).toContain('2 Nights');
    expect(visible).toContain('Private houseboat cruise through the backwaters.');
    expect(visible).not.toContain('duplicate flight card');
    expect(visible).not.toContain('duplicate hotel card');
    expect(visible).not.toContain('duplicate sightseeing card');
    expect(pdfTextPage(pdf, 3)).toContain('TRANSPORTATION');
    expect(pdfTextPage(pdf, 3)).not.toContain('CRUISE DETAILS');
    expect(pdfTextPage(pdf, 4)).toContain('CRUISE DETAILS');
    expect(pdfTextPage(pdf, 4)).not.toContain('ADD-ON SERVICES');
    expect(pdfTextPage(pdf, 5)).toContain('ADD-ON SERVICES');
    expect(pdfTextPage(pdf, 5)).not.toContain('CRUISE DETAILS');
    expect(visible).not.toContain('5,000');
  });

  it('renders optional per-stay hotel times and omits them when blank', async () => {
    const timedHotel = {
      city: 'Singapore',
      hotelName: 'Marina Bay Hotel',
      category: '5 Star',
      roomType: 'Deluxe',
      mealPlan: 'Breakfast',
      rooms: 1,
      nights: 2,
      selected: true,
      checkInDate: new Date('2027-01-06'),
      checkOutDate: new Date('2027-01-08'),
      checkInTime: '15:30',
      checkOutTime: '11:15',
      notes: null,
    };
    const input: Parameters<typeof renderQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: { ...baseVersionOverlap(), hotels: [timedHotel] },
      hotelPresentations: [
        {
          starCategory: 5,
          starRating: '4.6',
          address: '10 Bayfront Avenue, Singapore 018956',
          reviewLink: 'https://example.com/hotels/marina-bay',
        },
      ],
      images: { cover: PNG_1PX },
    };

    for (const pdf of [await renderQuotationPdf(input), await renderStylishQuotationPdf(input)]) {
      const visible = pdfText(pdf);
      expect(visible).toContain('6 Jan 2027');
      expect(visible).toContain('8 Jan 2027');
    }
    // Classic keeps the per-stay times; Stylish renders prominent plain-text
    // dates with no times, boxes, pills or review links (approved mockup).
    const classicTimesText = pdfText(await renderQuotationPdf(input));
    expect(classicTimesText).toContain('3:30 PM');
    expect(classicTimesText).toContain('11:15 AM');
    const stylishTimesText = pdfText(await renderStylishQuotationPdf(input));
    expect(stylishTimesText).not.toContain('3:30 PM');
    expect(stylishTimesText).not.toContain('11:15 AM');

    const stylishHotelPdf = await renderStylishQuotationPdf(input);
    const stylishHotelText = pdfText(stylishHotelPdf);
    expect(stylishHotelText).toContain('★★★★★');
    expect(stylishHotelText).toContain('10 Bayfront Avenue, Singapore 018956');
    expect(stylishHotelText).toContain('Check-in');
    expect(stylishHotelText).toContain('Check-out');
    // No numerical ratings, review links or review URIs in Stylish output.
    expect(stylishHotelText).not.toContain('4.6');
    expect(stylishHotelText).not.toContain('Check Hotel Review');
    expect(stylishHotelPdf.toString('latin1')).not.toContain('example.com/hotels/marina-bay');

    const noReviewPdf = await renderStylishQuotationPdf({
      ...input,
      hotelPresentations: [{ ...input.hotelPresentations?.[0], reviewLink: null }],
    });
    const noReviewText = pdfText(noReviewPdf);
    expect(noReviewText).not.toContain('4.6');
    expect(noReviewText).not.toContain('Check Hotel Review');

    const classicVisible = pdfText(await renderQuotationPdf(input));
    expect(classicVisible).toContain('Check-in: 6 Jan 2027 | 3:30 PM');
    expect(classicVisible).toContain('Check-out: 8 Jan 2027 | 11:15 AM');

    const blankPdf = await renderQuotationPdf({
      ...input,
      version: {
        ...input.version,
        hotels: [{ ...timedHotel, checkInTime: null, checkOutTime: null }],
      },
    });
    const blankVisible = pdfText(blankPdf);
    expect(blankVisible).not.toContain('3:30 PM');
    expect(blankVisible).not.toContain('11:15 AM');
    expect(blankVisible).not.toContain(' | ');

    const hiddenCheckIn = {
      ...input,
      version: {
        ...input.version,
        hotels: [
          {
            ...timedHotel,
            rooms: null,
            showCheckInTime: false,
            showCheckOutTime: true,
          },
        ],
      },
    };
    const hiddenClassicText = pdfText(await renderQuotationPdf(hiddenCheckIn));
    expect(hiddenClassicText).not.toContain('3:30 PM');
    expect(hiddenClassicText).toContain('11:15 AM');
    // Stylish shows plain-text dates only — no times at all.
    const hiddenStylishText = pdfText(await renderStylishQuotationPdf(hiddenCheckIn));
    expect(hiddenStylishText).not.toContain('3:30 PM');
    expect(hiddenStylishText).not.toContain('11:15 AM');
    expect(hiddenStylishText).toContain('8 Jan 2027');
    expect(pdfText(await renderQuotationPdf(hiddenCheckIn))).not.toContain('Rooms:');
  });

  it('uses destination itinerary nights for duration instead of hotel nights', async () => {
    const input: Parameters<typeof renderQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: {
        ...quotationOverlap(),
        durationNights: 11,
        travelStartDate: new Date('2026-09-05'),
        travelEndDate: new Date('2026-09-09'),
      },
      version: {
        ...baseVersionOverlap(),
        hotels: [
          {
            city: 'Singapore',
            hotelName: 'Long Stay Hotel',
            category: '4 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 32,
            selected: true,
            notes: null,
          },
        ],
      },
      images: { cover: PNG_1PX },
    };

    for (const pdf of [await renderQuotationPdf(input), await renderStylishQuotationPdf(input)]) {
      const visible = pdfText(pdf);
      expect(visible).toContain('11 Nights / 12 Days');
      expect(visible).not.toContain('32 Nights / 33 Days');
    }
  });

  it('renders flight segment times with AM and PM in both quotation PDFs', async () => {
    const input: Parameters<typeof renderQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        flightDetails: {
          include: true,
          journeyType: 'ONEWAY_OUTBOUND',
          outbound: {
            fromCity: 'Chaudhary Charan Singh International Airport, Terminal 3',
            toCity: 'Kempegowda International Airport Bengaluru',
            segments: [
              {
                airlineName: 'Indigo',
                from: 'Rajkot',
                to: 'Singapore',
                departureDate: '2026-09-05',
                departureTime: '02:00',
                arrivalDate: '2026-09-05',
                arrivalTime: '13:00',
                duration: '11h 0m',
                notes: '<p><strong>Terminal note:</strong> Verify before departure.</p>',
              },
              {
                airlineName: 'Thai Airways',
                from: 'India',
                to: 'Singapore',
                departureDate: '2026-08-14',
                departureTime: '10:00',
                arrivalDate: '2026-08-22',
                arrivalTime: '13:00',
                duration: '195h 0m',
              },
            ],
          },
          returnJourney: { segments: [] },
        },
      },
      images: { cover: PNG_1PX },
    };

    const classic = await renderQuotationPdf(input);
    const stylish = await renderStylishQuotationPdf(input);
    for (const pdf of [classic, stylish]) {
      const visible = pdfText(pdf);
      expect(visible).toContain('2:00 AM');
      expect(visible).toContain('1:00 PM');
      expect(visible).toContain('10:00 AM');
    }
    expect(pdfText(stylish)).toContain('Terminal note: Verify before departure.');
    expect(pdfText(stylish)).not.toContain('<p>');
    expect(pdfText(stylish)).not.toContain('Baggage:');
    // The route bar (and its arrow) is gone from the Stylish flight pages;
    // airport names live in the flight-details card instead.
    expect(pdfText(stylish)).not.toContain('→');
    const stylishBoxes = pageMediaBoxes(stylish);
    expect(stylishBoxes.some((box) => box.height < PDF_PAGE_HEIGHT - 1)).toBe(true);
    expect(stylishBoxes.every((box) => box.height >= PDF_MIN_PAGE_HEIGHT - 1)).toBe(true);

    // Regression for the classic card: the AM suffix must share the exact
    // baseline with 10:00 instead of wrapping onto the departure date.
    const words = wordBoxes(classic);
    const tenIndex = words.findIndex((word) => word.text === '10:00');
    expect(tenIndex).toBeGreaterThanOrEqual(0);
    expect(words[tenIndex + 1]?.text).toBe('AM');
    expect(
      Math.abs(words[tenIndex]!.yBottomFromTop - words[tenIndex + 1]!.yBottomFromTop),
    ).toBeLessThan(1);
    const stylishWords = wordBoxes(stylish);
    // The flight-details card keeps departure/arrival on one baseline.
    const routeStart = stylishWords.find((word) => word.text === 'Rajkot');
    const routeEnd = stylishWords.find((word) => word.text === 'Singapore');
    expect(routeStart).toBeDefined();
    expect(routeEnd).toBeDefined();
    expect(Math.abs(routeStart!.yBottomFromTop - routeEnd!.yBottomFromTop)).toBeLessThan(1);
    const stylishTenIndex = stylishWords.findIndex((word) => word.text === '10:00');
    expect(stylishTenIndex).toBeGreaterThanOrEqual(0);
    expect(stylishWords[stylishTenIndex + 1]?.text).toBe('AM');
    expect(
      Math.abs(
        stylishWords[stylishTenIndex]!.yBottomFromTop -
          stylishWords[stylishTenIndex + 1]!.yBottomFromTop,
      ),
    ).toBeLessThan(1);
  });

  it('renders every flight record in order in both quotation PDFs', async () => {
    const flightRecord = (
      bookmarkCode: string | null,
      journeyType: string,
      from: string,
      to: string,
      flightNumber: string,
    ) => ({
      bookmarkCode,
      journeyType,
      outbound: {
        fromCity: from,
        toCity: to,
        travelClass: 'Economy',
        segments: [
          {
            airlineName: 'Test Airways',
            from,
            to,
            flightNumber,
            departureDate: '2026-09-05',
            departureTime: '10:00',
            arrivalDate: '2026-09-05',
            arrivalTime: '13:00',
          },
        ],
      },
      returnJourney: { segments: [] },
    });
    const input: Parameters<typeof renderQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        flightDetails: {
          include: true,
          flights: [
            flightRecord('FLT-000001', 'ONEWAY_OUTBOUND', 'DEL', 'BOM', 'AI101'),
            flightRecord('FLT-000002', 'ONEWAY_OUTBOUND', 'BOM', 'GOI', '6E202'),
          ],
        },
      },
      images: { cover: PNG_1PX },
    };
    for (const pdf of [await renderQuotationPdf(input), await renderStylishQuotationPdf(input)]) {
      const visible = pdfText(pdf);
      expect(visible).toContain('AI101');
      expect(visible).toContain('6E202');
      // Stored order is preserved: the first flight renders first.
      expect(visible.indexOf('AI101')).toBeLessThan(visible.indexOf('6E202'));
    }
    // Parent flight entries share the builder's Flight Details N labels.
    const classicText = pdfText(await renderQuotationPdf(input));
    expect(classicText).toContain('Flight Details 1 · Outbound Journey');
    expect(classicText).toContain('Flight Details 2 · Outbound Journey');
    expect(classicText).not.toContain('Flight 1 ·');
    expect(classicText).not.toContain('Flight 2 ·');
    const stylishText = pdfText(await renderStylishQuotationPdf(input));
    expect(stylishText).toContain('FLIGHT DETAILS 1 · OUTBOUND');
    expect(stylishText).toContain('FLIGHT DETAILS 2 · OUTBOUND');
    expect(stylishText).not.toContain('FLIGHT 1 ·');
    expect(stylishText).not.toContain('FLIGHT 2 ·');
  });

  it('renders legacy single-flight rows without a flights array', async () => {
    const input: Parameters<typeof renderQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        flightDetails: {
          include: true,
          journeyType: 'ONEWAY_OUTBOUND',
          outbound: {
            fromCity: 'DEL',
            toCity: 'BOM',
            segments: [
              {
                airlineName: 'Test Airways',
                from: 'DEL',
                to: 'BOM',
                flightNumber: 'AI101',
                departureDate: '2026-09-05',
                departureTime: '10:00',
                arrivalDate: '2026-09-05',
                arrivalTime: '13:00',
              },
            ],
          },
          returnJourney: { segments: [] },
        },
      },
      images: { cover: PNG_1PX },
    };
    for (const pdf of [await renderQuotationPdf(input), await renderStylishQuotationPdf(input)]) {
      expect(pdfText(pdf)).toContain('AI101');
    }
    // A lone flight keeps its bare journey title: no numbered parent label.
    for (const pdf of [await renderQuotationPdf(input), await renderStylishQuotationPdf(input)]) {
      expect(pdfText(pdf)).not.toContain('Flight Details 1');
    }
  });

  it('renders every populated sightseeing time in 12-hour format regardless of the legacy flag', async () => {
    const input: Parameters<typeof renderQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Full Day',
              city: 'Singapore',
              date: '2027-01-06',
              meals: { breakfast: false, lunch: false, dinner: false },
              dailyTransfer: 'SHARED',
              activities: [
                { name: 'Morning Tour', description: null, startTime: '09:00', showTime: true },
                {
                  name: 'Evening Tour',
                  description: null,
                  startTime: '18:30',
                  showTime: false,
                },
                { name: 'Untimed Visit', description: null, startTime: null, showTime: true },
              ],
            },
          ],
        },
      },
      images: { cover: PNG_1PX },
    };

    for (const pdf of [await renderQuotationPdf(input), await renderStylishQuotationPdf(input)]) {
      const visible = pdfText(pdf);
      expect(visible).toContain('Morning Tour');
      expect(visible).toContain('Evening Tour');
      expect(visible).toContain('Untimed Visit');
    }
    // Times render in 12-hour format in the Classic PDF (a populated time
    // shows even when the removed checkbox stored false). The approved
    // Stylish day header shows the date instead and carries no per-activity
    // times.
    const classicVisible = pdfText(await renderQuotationPdf(input));
    expect(classicVisible).toContain('9:00 AM');
    expect(classicVisible).toContain('6:30 PM');
    const stylishVisible = pdfText(await renderStylishQuotationPdf(input));
    expect(stylishVisible).not.toContain('9:00 AM');
    expect(stylishVisible).not.toContain('6:30 PM');
  });
});

const quotationOverlap = () => ({
  quotationNumber: 'QT-OVERLAP-0002',
  customerName: 'Mira Shah',
  customerEmail: null,
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Kerala',
  travelStartDate: null,
  travelEndDate: null,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  validUntil: null,
});

/** Minimal valid version; focused tests override the section they exercise. */
const baseVersionOverlap = () => ({
  versionNumber: 1,
  title: 'Kerala Escape',
  introduction: null,
  currency: 'INR',
  finalAmount: '100',
  notes: null,
  perAdultPrice: '50',
  perChildWithBedPrice: '0',
  perChildWithoutBedPrice: '0',
  perInfantPrice: '0',
  taxNote: null,
  initialPaymentAmount: '0',
  paymentLink: null,
  inclusionsHtml: null,
  exclusionsHtml: null,
  paymentPolicies: null,
  cancellationPolicies: null,
  bookingTerms: null,
  includeVisa: false,
  visaSectionTitle: null,
  visaAmount: '0',
  visaDestination: null,
  visaType: null,
  visaServiceCharge: '0',
  visaGstPercent: '0',
  visaVfsCharge: '0',
  flightDetails: null,
  sightseeingDetails: null,
  hotels: [],
  itinerary: [],
  services: [],
  inclusions: [],
  exclusions: [],
  terms: [],
});

/** 1x1 PNG used to prove images (hero/logo) are embedded without crashing. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Distinct 1x1 red PNG so the expert photo is never byte-deduped with the cover. */
const PNG_1PX_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * Visible text extraction via poppler's pdftotext (the DejaVu fonts embed real
 * ToUnicode maps, so this returns searchable text, unlike the raw extractor).
 */
function pdfText(buffer: Buffer): string {
  return execFileSync('pdftotext', ['-layout', '-', '-'], {
    input: buffer,
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

function pdfTextPage(buffer: Buffer, page: number): string {
  return execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', '-', '-'], {
    input: buffer,
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');
}

/**
 * Best-effort text search: include the raw bytes (pdfkit may leave content
 * streams uncompressed) plus any inflatable FlateDecode streams, so drawn text
 * can be searched regardless of the compression setting.
 */
function extractText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const parts: string[] = [raw];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    try {
      parts.push(zlib.inflateSync(Buffer.from(match[1] ?? '', 'latin1')).toString('latin1'));
    } catch {
      /* not a flate stream; skip */
    }
  }
  return parts.join('\n');
}

const LONG_NAME =
  'Interscale Global Luxury Bespoke Holidays and Destination Management Company Pvt Ltd';
const LONG_ADDRESS =
  'Level 14, Tower B, One World Business Park, Sarjapur Outer Ring Road, Bellandur, ' +
  'Bengaluru, Karnataka 560103, India (near the very long landmark name plaza complex)';
const LONG_TERMS = 'Cancellation, refund, force-majeure and liability terms. '.repeat(60);

const company = {
  name: LONG_NAME,
  email: 'reservations@interscale.example',
  phone: '+91 90000 00000',
  website: 'https://interscale.example',
  address: LONG_ADDRESS,
  primaryColor: '#2563eb',
  operatingSinceYear: 2015,
  tripsSold: 550,
  tan: 'ABC12345E',
  taxRegistrationNumber: '29ABCDE1234F1Z5',
  logo: null,
};
const invoiceCompany = {
  ...company,
  taxRegistrationNumber: '29ABCDE1234F1Z5',
  bank: {
    accountHolderName: LONG_NAME,
    bankName: 'Very Long National Commercial Bank of the Southern Region',
    branchName: 'Outer Ring Road Premium Business Banking Branch',
    ifscCode: 'VLNC0001234',
    accountNumberMasked: '••••6789',
  },
};

const travellers = Array.from({ length: 40 }, (_, index) => ({
  title: 'Mr',
  firstName: `Traveller${index + 1}`,
  middleName: 'Middlename',
  lastName: `Longsurname-${index + 1}`,
}));
const invoiceServices = Array.from({ length: 30 }, (_, index) => ({
  name: `Premium guided experience number ${index + 1} with a rather long descriptive title`,
  serviceType: 'SIGHTSEEING',
  city: `City ${index + 1}`,
  startDate: new Date('2026-08-01'),
  endDate: new Date('2026-08-02'),
  confirmationStatus: 'CONFIRMED',
  confirmationNumber: `CNF-${index + 1}`,
  supplierReference: `REF-${index + 1}`,
  customerSellingAmount: '12500.00',
}));

const invoiceBooking = {
  bookingNumber: 'BK-LONGDOC-0001',
  customerName: 'Aishwarya Venkataraman Subramaniam Longcustomername',
  customerEmail: 'customer@example.com',
  customerPhone: '+91 98888 88888',
  destinationSummary:
    'Bengaluru → Coorg → Ooty → Kodaikanal → Munnar → Alleppey → Kochi (long trip)',
  travelStartDate: new Date('2026-08-01'),
  travelEndDate: new Date('2026-08-15'),
  currency: 'INR',
  totalSellingAmount: '450000.00',
  gstAmount: '22500.00',
  tcsAmount: '4500.00',
  totalPayable: '477000.00',
  totalCustomerPaid: '200000.00',
  totalCustomerOutstanding: '277000.00',
  travellers,
  services: invoiceServices,
};

describe('PDF rendering with long content', () => {
  it('keeps rich-text list markers with their content and preserves emoji', () => {
    expect(
      htmlToLines(
        '<ul><li><p>First inclusion</p></li><li><p>🦖 Jurassic Park Rapids</p></li></ul>',
      ),
    ).toEqual(['• First inclusion', '• 🦖 Jurassic Park Rapids']);
  });

  it('retains bold runs while flattening sightseeing editor HTML', () => {
    expect(
      htmlToRichTextLines(
        '<p>Highlights &amp; Rides:</p><ul><li><p>🦖 <strong>Jurassic Park Rapids Adventure</strong> – Exciting ride</p></li></ul>',
      ),
    ).toEqual([
      [{ text: 'Highlights & Rides:', bold: false }],
      [
        { text: '• 🦖 ', bold: false },
        { text: 'Jurassic Park Rapids Adventure', bold: true },
        { text: ' – Exciting ride', bold: false },
      ],
    ]);
  });

  it('embeds colour sightseeing emoji images in the quotation PDF', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 2,
              title: 'Day 2: Universal Studios',
              city: 'Singapore',
              activities: [
                {
                  name: 'Universal Studios',
                  description:
                    '<p>🎬 Universal Studios Singapore</p><ul><li><p>🦖 <strong>Jurassic Park Rapids</strong></p></li><li><p>🎢 Battlestar Galactica</p></li><li><p>🤖 Transformers</p></li></ul>',
                  imageUrl: null,
                  sightseeingId: null,
                },
              ],
            },
          ],
        },
      },
      images: { cover: PNG_1PX },
    });
    const text = pdfText(pdf);
    expect(text).toContain('Universal Studios Singapore');
    expect(text).toContain('Jurassic Park Rapids');
    expect(text).toContain('Battlestar Galactica');
    expect(text).toContain('Transformers');

    // One cover image plus all four distinct colour emoji PNGs, including the
    // robot that previously appeared as a missing-glyph square.
    const imageObjects = pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? [];
    expect(imageObjects.length).toBeGreaterThanOrEqual(5);
  });

  it('renders multiple uploaded flight itinerary images with descriptions and preview links instead of segment cards', async () => {
    const input: Parameters<typeof renderQuotationPdf>[0] = {
      company: footerEmptyCompanyForOverlap(),
      consultant: null,
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        flightDetails: {
          include: true,
          sectionTitle: 'My Flights',
          entryMode: 'IMAGE',
          images: [
            {
              documentId: '11111111-2222-4333-8444-555555555555',
              fileName: 'outbound.png',
              description: 'Outbound flight ticket',
            },
            {
              documentId: '11111111-2222-4333-8444-555555555556',
              fileName: 'return.png',
              description: null,
            },
          ],
          journeyType: 'ROUND_TRIP',
          outbound: { segments: [] },
          returnJourney: { segments: [] },
        },
      },
      images: {
        flights: [
          {
            description: 'Outbound flight ticket',
            image: PNG_1PX,
            url: 'https://files.example.test/outbound.png',
          },
          { description: null, image: PNG_1PX, url: 'https://files.example.test/return.png' },
        ],
      },
    };
    const pdf = await renderQuotationPdf(input);
    expect(isPdf(pdf)).toBe(true);
    expect(pdfText(pdf)).toContain('MY FLIGHTS');
    expect(pdfText(pdf)).toContain('Outbound flight ticket');
    expect(pdfText(pdf)).toContain('Preview');
    expect(pdf.toString('latin1')).toContain('https://files.example.test/outbound.png');
    expect(
      pdf.toString('latin1').match(/\/Subtype\s*\/Image/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    const stylish = await renderStylishQuotationPdf(input);
    expect(isPdf(stylish)).toBe(true);
    expect(pdfText(stylish)).toContain('Outbound flight ticket');
    expect(pdfText(stylish)).toContain('Preview');
    expect(pdfTextPage(stylish, 1)).not.toMatch(/\bROOMS\b/i);
    expect(stylish.toString('latin1')).toContain('https://files.example.test/outbound.png');
    expect(
      stylish.toString('latin1').match(/\/Subtype\s*\/Image/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  it('renders a multi-page quotation PDF with a long itinerary and terms', async () => {
    const longInput: Parameters<typeof renderQuotationPdf>[0] = {
      company: { ...company, logo: PNG_1PX },
      consultant: {
        name: 'Vivek Sharma',
        phone: '+91 90000 00001',
        email: 'vivek@interscale.example',
      },
      quotation: {
        quotationNumber: 'QT-LONGDOC-0001',
        customerName: invoiceBooking.customerName,
        customerEmail: 'c@example.com',
        customerPhone: '+91 98888 88888',
        destinationSummary: invoiceBooking.destinationSummary,
        travelStartDate: new Date('2026-08-01'),
        travelEndDate: new Date('2026-08-15'),
        adults: 4,
        childrenWithBed: 2,
        childrenWithoutBed: 1,
        infants: 1,
        rooms: 3,
        validUntil: new Date('2026-07-31'),
      },
      images: { cover: PNG_1PX },
      version: {
        versionNumber: 1,
        title: 'Grand South India Discovery — 15 Nights',
        introduction: LONG_TERMS,
        currency: 'INR',
        finalAmount: '450000.00',
        notes: LONG_TERMS,
        perAdultPrice: '40000.00',
        perChildWithBedPrice: '30000.00',
        perChildWithoutBedPrice: '20000.00',
        perInfantPrice: '5000.00',
        taxNote: 'Inclusive of all taxes, excluding TCS',
        initialPaymentAmount: '50000.00',
        paymentLink: 'https://example.com/pay',
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: `<p>${'Pay early. '.repeat(10)}</p>`,
        cancellationPolicies: '<ul><li>Cancellation applies</li></ul>',
        bookingTerms: null,
        includeVisa: true,
        visaSectionTitle: 'Visa Details',
        visaAmount: '2000.00',
        visaDestination: 'Singapore',
        visaType: 'Tourist',
        visaServiceCharge: '500.00',
        visaGstPercent: '18',
        visaVfsCharge: '300.00',
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Arrival in Singapore',
              city: 'Singapore',
              date: '2026-10-23',
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [{ name: 'Airport transfer', description: '<p>Meet and greet.</p>' }],
            },
          ],
        },
        flightDetails: {
          include: true,
          journeyType: 'ROUND_TRIP',
          outbound: {
            fromCity: 'Kolkata',
            toCity: 'Singapore',
            segments: [
              {
                airlineName: 'Indigo',
                flightNumber: '6E1015',
                travelClass: 'Economy',
                from: 'Kolkata',
                to: 'Singapore',
                departureDate: '2026-10-23',
                departureTime: '02:05',
                arrivalDate: '2026-10-23',
                arrivalTime: '09:00',
                duration: '4h 55m',
                cabinLuggage: '7kg',
                checkInLuggage: '30kg',
              },
            ],
          },
          returnJourney: { fromCity: 'Singapore', toCity: 'Kolkata', segments: [] },
        },
        hotels: Array.from({ length: 10 }, (_, i) => ({
          city: `City ${i + 1}`,
          hotelName: `Very Grand Heritage Palace Resort and Spa ${i + 1}`,
          category: '5 Star',
          roomType: 'Deluxe',
          mealPlan: 'MAP',
          nights: 2,
          rooms: 3,
          selected: true,
          notes: 'Long note. '.repeat(20),
        })),
        itinerary: Array.from({ length: 15 }, (_, i) => ({
          dayNumber: i + 1,
          title: `Day ${i + 1} — a fairly long descriptive itinerary day title goes here`,
          destination: `City ${i + 1}`,
          description: 'Detailed day description. '.repeat(40),
          meals: 'Breakfast, Lunch, Dinner',
          overnightLocation: `City ${i + 1}`,
        })),
        services: invoiceServices.map((s) => ({
          serviceType: s.serviceType,
          name: s.name,
          description: 'Service description. '.repeat(15),
          city: s.city,
          quantity: '1',
          unitSellingPrice: '1000',
        })),
        inclusions: Array.from({ length: 25 }, (_, i) => ({ content: `Inclusion ${i + 1}` })),
        exclusions: Array.from({ length: 25 }, (_, i) => ({ content: `Exclusion ${i + 1}` })),
        terms: Array.from({ length: 15 }, (_, i) => ({ content: `${LONG_TERMS} (${i + 1})` })),
      },
    };
    const pdf = await renderQuotationPdf(longInput);
    const stylishAudit = await renderStylishQuotationPdf(longInput);
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pageCount(pdf)).toBeGreaterThan(1);
    const text = extractText(pdf);
    expect(text).not.toMatch(/internal cost|vendor cost|supplier cost|gross profit|net profit/i);

    // --- Populated page-1 content and repeating footer (visible text) ---------
    const visible = pdfText(pdf);
    const raw = pdf.toString('latin1');
    const total = pageCount(pdf);

    // Destination hero image is embedded as an image XObject.
    expect(raw.match(/\/Subtype\s*\/Image/g)?.length ?? 0).toBeGreaterThan(0);
    // Consultant strip values.
    expect(visible).toContain('Consultant: Vivek Sharma');
    expect(visible).toContain('Phone: +91 90000 00001');
    expect(visible).toContain('Email: vivek@interscale.example');
    // Package title is present (uppercased by the renderer).
    expect(visible).toContain('GRAND SOUTH INDIA DISCOVERY');
    // Room count is hidden from the opening summary, while hotel cards retain it.
    expect(pdfTextPage(pdf, 1)).not.toMatch(/^Rooms:/m);
    expect(visible).toContain('Rooms: 3');
    // Tax note appears exactly once.
    const taxMatches = visible.match(/Inclusive of all taxes, excluding TCS/g) ?? [];
    expect(taxMatches).toHaveLength(1);
    // Secure Your Booking block + Pay Now button.
    expect(visible).toContain('Secure Your Booking');
    expect(visible).toContain('Pay Now');
    // The raw payment URL is a link annotation, never visible text.
    expect(raw).toContain('/URI');
    expect(visible).not.toContain('https://pay.example.com/secure');
    // Footer columns on every physical page with the correct page counter.
    for (let page = 1; page <= total; page += 1) {
      const pageText = pdfTextPage(pdf, page);
      expect(pageText).toContain('CONTACT US');
      expect(pageText).toContain('OUR ACHIEVEMENTS');
      expect(pageText).toContain('LEGAL INFO');
      expect(pageText).toContain(`Page ${page}/${total}`);
    }
    // Contact / achievements / legal values.
    expect(visible).toContain('Ph: +91 90000 00000');
    expect(visible).toContain('Em: reservations@interscale.example');
    expect(visible).toContain('550 Trips Sold');
    expect(visible).toContain('Est: 2015');
    expect(visible).toContain('TAN: ABC12345E');
    expect(visible).toContain('GSTIN: 29ABCDE1234F1Z5');
    // No junk values anywhere in the visible document.
    expect(visible).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b|\[object Object\]/);

    const stylishTotal = pageCount(stylishAudit);
    const stylishText = pdfText(stylishAudit);
    expect(stylishText).not.toMatch(/<\/?(?:p|strong|span|div)\b/i);
    expect(pdfTextPage(stylishAudit, stylishTotal)).toContain('THANK YOU');
    for (let page = 2; page < stylishTotal; page += 1) {
      const pageText = pdfTextPage(stylishAudit, page);
      expect(pageText).toContain('INTERSCALE GLOBAL LUXURY');
      expect(pageText).toContain('CONTACT US');
      // Repeating footer shows the bare page number only (no "Page"/total).
      expect(pageText).not.toContain(`Page ${page} of ${stylishTotal}`);
      expect(pageText).not.toContain(`Page ${page}/${stylishTotal}`);
      expect(
        pageText.split('\n').map((line) => line.trim()),
      ).toContain(`${page}`);
    }
    const stylishAuditBoxes = pageMediaBoxes(stylishAudit);
    expect(stylishAuditBoxes.some((box) => box.height < PDF_PAGE_HEIGHT - 1)).toBe(true);
    expect(stylishAuditBoxes.every((box) => box.height >= PDF_MIN_PAGE_HEIGHT - 1)).toBe(true);
    expect(stylishAuditBoxes.every((box) => box.height <= PDF_PAGE_HEIGHT + 1)).toBe(true);

    // Pages retain A4 width and the existing bounded dynamic-height behavior.
    const boxes = pageMediaBoxes(pdf);
    expect(boxes).toHaveLength(total);
    for (const box of boxes) {
      expect(box.width).toBeCloseTo(PDF_PAGE_WIDTH, 0);
      expect(box.height).toBeGreaterThanOrEqual(PDF_MIN_PAGE_HEIGHT - 1);
      expect(box.height).toBeLessThanOrEqual(PDF_PAGE_HEIGHT + 1);
    }
  });

  it('maps Destination (Malaysia) while keeping city content (Kuala Lumpur) intact', async () => {
    const pdf = await renderQuotationPdf({
      company: { ...company, logo: PNG_1PX },
      quotation: {
        quotationNumber: 'QT-MY-KL-0001',
        customerName: 'Rajesh Kumar',
        customerEmail: 'rajesh@example.com',
        customerPhone: '+91 90000 00002',
        destinationSummary: 'Kuala Lumpur',
        // Destination/Master-country (Malaysia) from the lead itinerary.
        destinations: 'Malaysia',
        travelStartDate: new Date('2026-10-23'),
        travelEndDate: new Date('2026-10-27'),
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: new Date('2026-10-20'),
      },
      version: {
        versionNumber: 1,
        title: 'Kuala Lumpur Package for Rajesh Kumar',
        introduction: null,
        currency: 'INR',
        finalAmount: '80000.00',
        notes: null,
        perAdultPrice: '40000.00',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: null,
        initialPaymentAmount: '20000.00',
        paymentLink: null,
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Kuala Lumpur',
              city: 'Kuala Lumpur',
              date: '2026-10-23',
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [{ name: 'Batu Caves Tour', description: null }],
            },
          ],
        },
        flightDetails: {
          include: true,
          journeyType: 'ONEWAY_OUTBOUND',
          outbound: {
            fromCity: 'Delhi',
            toCity: 'Kuala Lumpur',
            segments: [
              {
                airlineName: 'AirAsia',
                flightNumber: 'AK101',
                travelClass: 'Economy',
                from: 'Delhi',
                to: 'Kuala Lumpur',
                departureDate: '2026-10-23',
                departureTime: '23:55',
                arrivalDate: '2026-10-24',
                arrivalTime: '05:10',
                duration: '5h 15m',
              },
            ],
          },
          returnJourney: { fromCity: 'Kuala Lumpur', toCity: 'Delhi', segments: [] },
        },
        hotels: [
          {
            city: 'Kuala Lumpur',
            hotelName: 'Grand KL Hotel',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'MAP',
            nights: 4,
            selected: true,
            notes: null,
          },
        ],
        itinerary: [
          {
            dayNumber: 1,
            title: 'Day 1: Kuala Lumpur',
            destination: 'Kuala Lumpur',
            description: 'Arrival and city tour.',
            meals: null,
            overnightLocation: 'Kuala Lumpur',
          },
        ],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const visible = pdfText(pdf);
    // The hero/package heading keeps the city (Kuala Lumpur) — may wrap across
    // lines in the extracted layout text, so collapse whitespace before matching.
    expect(visible.replace(/\s+/g, ' ')).toContain('KUALA LUMPUR PACKAGE FOR RAJESH KUMAR');
    // The Destination summary row shows the Master country (Malaysia).
    expect(visible).toContain('Destination: Malaysia');
    // City-specific content stays Kuala Lumpur.
    expect(visible).toContain('Kuala Lumpur');
    expect(visible).toContain('Grand KL Hotel');
    expect(visible.replace(/\s+/g, ' ')).toContain('Day 1: Kuala Lumpur');
  });

  it('renders a quotation PDF with missing optional data without junk or broken blocks', async () => {
    const pdf = await renderQuotationPdf({
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSinceYear: null,
        tripsSold: null,
        tan: null,
        taxRegistrationNumber: null,
        logo: null,
      },
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: {
        quotationNumber: 'QT-MIN-0001',
        customerName: 'Mira Shah',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Kerala Escape',
        introduction: null,
        currency: 'INR',
        finalAmount: '100',
        notes: null,
        perAdultPrice: '50',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: null,
        initialPaymentAmount: '0',
        paymentLink: null,
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        sightseeingDetails: null,
        hotels: [],
        itinerary: [],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const visible = pdfText(pdf);
    const total = pageCount(pdf);
    // Consultant name renders; missing phone/email leave no empty labels.
    expect(visible).toContain('Consultant: Only Name');
    expect(visible).not.toMatch(/Phone:\s*$/m);
    expect(visible).not.toMatch(/Email:\s*$/m);
    // Contact Us keeps only the email line.
    expect(visible).toContain('CONTACT US');
    expect(visible).toContain('Em: hello@alpha.test');
    expect(visible).not.toContain('Ph:');
    expect(visible).not.toContain('Web:');
    // Empty Achievements / Legal sections are hidden entirely (no heading, no
    // empty column) — only populated footer sections render.
    expect(visible).not.toContain('OUR ACHIEVEMENTS');
    expect(visible).not.toContain('LEGAL INFO');
    expect(visible).not.toMatch(/Trips Sold/);
    expect(visible).not.toMatch(/Est:/);
    expect(visible).not.toMatch(/TAN:/);
    expect(visible).not.toMatch(/GSTIN:/);
    // Page number appears on every generated page.
    for (let page = 1; page <= total; page += 1) {
      expect(pdfTextPage(pdf, page)).toContain(`Page ${page}/${total}`);
    }
    // No junk values and no broken-image label.
    expect(visible).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b|\[object Object\]/);
    expect(visible).not.toMatch(/broken|image placeholder/i);
  });

  it('renders a minimal quotation with exactly the necessary pages', async () => {
    const pdf = await renderQuotationPdf({
      company,
      quotation: {
        quotationNumber: 'QT-MIN-0002',
        customerName: 'Tiny Trip',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 1,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Goa Day Trip',
        introduction: null,
        currency: 'INR',
        finalAmount: '5000',
        notes: null,
        perAdultPrice: '5000',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: null,
        initialPaymentAmount: '0',
        paymentLink: null,
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        sightseeingDetails: null,
        hotels: [],
        itinerary: [],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    // Page 1 (summary) + final Thank You page; nothing extra.
    const total = pageCount(pdf);
    expect(total).toBe(2);
    // No footer-only or blank page; every page carries the footer + counter.
    for (let page = 1; page <= total; page += 1) {
      const pageText = pdfTextPage(pdf, page);
      expect(pageText).toContain('CONTACT US');
      expect(pageText).toContain(`Page ${page}/${total}`);
    }
    // Both pages share A4 width and retain measured dynamic heights.
    const boxes = pageMediaBoxes(pdf);
    expect(boxes).toHaveLength(total);
    for (const box of boxes) {
      expect(box.width).toBeCloseTo(PDF_PAGE_WIDTH, 0);
      expect(box.height).toBeGreaterThanOrEqual(PDF_MIN_PAGE_HEIGHT - 1);
      expect(box.height).toBeLessThanOrEqual(PDF_PAGE_HEIGHT + 1);
    }
    // Thank You remains the final page.
    expect(pdfTextPage(pdf, total)).toContain('THANK');
  });

  it('paginates short and long content into bounded dynamic-height pages', async () => {
    // Short document: cover + thank-you only.
    const short = await renderQuotationPdf({
      company,
      quotation: {
        quotationNumber: 'QT-SHORT-0001',
        customerName: 'Short Trip',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 1,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Goa Day Trip',
        introduction: null,
        currency: 'INR',
        finalAmount: '5000',
        notes: null,
        perAdultPrice: '5000',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: null,
        initialPaymentAmount: '0',
        paymentLink: null,
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        sightseeingDetails: null,
        hotels: [],
        itinerary: [],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
    });
    // Long document: cover + flights + hotels + itinerary + add-ons + policies.
    const long = await renderQuotationPdf({
      company,
      quotation: {
        quotationNumber: 'QT-LONG-0001',
        customerName: 'Long Trip',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Singapore',
        travelStartDate: new Date('2026-11-13'),
        travelEndDate: new Date('2026-11-18'),
        adults: 2,
        childrenWithBed: 1,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Singapore Long Package',
        introduction: null,
        currency: 'INR',
        finalAmount: '80000',
        notes: null,
        perAdultPrice: '35000',
        perChildWithBedPrice: '10000',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: 'Inclusive of all taxes, excluding TCS',
        initialPaymentAmount: '20000',
        paymentLink: 'https://pay.example.com/secure',
        inclusionsHtml: '<ul><li>Transfers</li><li>Breakfast</li></ul>',
        exclusionsHtml: null,
        paymentPolicies: '<p>Pay early.</p>',
        cancellationPolicies: '<p>Cancellation applies.</p>',
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: {
          include: true,
          journeyType: 'ROUND_TRIP',
          outbound: {
            fromCity: 'Mumbai',
            toCity: 'Singapore',
            segments: [
              {
                airlineId: null,
                airlineName: 'Singapore Airlines',
                flightNumber: 'SQ423',
                travelClass: 'Economy',
                from: 'Mumbai',
                to: 'Singapore',
                departureDate: '2026-11-13',
                departureTime: '02:05',
                arrivalDate: '2026-11-13',
                arrivalTime: '09:00',
                duration: '4h 55m',
                cabinLuggage: '7kg',
                checkInLuggage: '30kg',
                notes: '<p>Long note that keeps growing. '.repeat(8) + '</p>',
              },
            ],
          },
          returnJourney: {
            fromCity: 'Singapore',
            toCity: 'Mumbai',
            segments: [
              {
                airlineId: null,
                airlineName: 'Singapore Airlines',
                flightNumber: 'SQ422',
                travelClass: 'Economy',
                from: 'Singapore',
                to: 'Mumbai',
                departureDate: '2026-11-18',
                departureTime: '10:00',
                arrivalDate: '2026-11-18',
                arrivalTime: '12:30',
                duration: '5h 30m',
                cabinLuggage: '7kg',
                checkInLuggage: '30kg',
                notes: null,
              },
            ],
          },
        },
        sightseeingDetails: null,
        hotels: [
          {
            city: 'Singapore',
            hotelName: 'Marina Bay Sands',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'BB',
            nights: 5,
            selected: true,
            notes: null,
          },
        ],
        itinerary: [],
        services: [
          {
            serviceType: 'TRAVEL_INSURANCE',
            name: 'Travel Insurance',
            description: '<p>Coverage for the whole trip.</p>',
            city: null,
            quantity: '1',
            unitSellingPrice: '3000',
          },
        ],
        inclusions: [{ content: 'Transfers' }],
        exclusions: [],
        terms: [{ content: 'Standard terms apply.' }],
      },
    });
    const shortBoxes = pageMediaBoxes(short);
    const longBoxes = pageMediaBoxes(long);
    expect(shortBoxes.every((b) => Math.abs(b.width - PDF_PAGE_WIDTH) < 1)).toBe(true);
    expect(longBoxes.every((b) => Math.abs(b.width - PDF_PAGE_WIDTH) < 1)).toBe(true);
    // Every page stays within the supported dynamic physical-height range.
    expect(shortBoxes.some((box) => box.height < PDF_PAGE_HEIGHT - 1)).toBe(true);
    expect(shortBoxes.every((box) => box.height >= PDF_MIN_PAGE_HEIGHT - 1)).toBe(true);
    expect(longBoxes.every((box) => box.height >= PDF_MIN_PAGE_HEIGHT - 1)).toBe(true);
    expect(longBoxes.every((box) => box.height <= PDF_PAGE_HEIGHT + 1)).toBe(true);
    // The long document has more pages than the short one (content paginates
    // within the fixed sheet rather than growing the page).
    expect(longBoxes.length).toBeGreaterThan(shortBoxes.length);
  });

  it('anchors the footer to each measured physical page bottom', () => {
    for (const contentHeight of [120, 260, 400, 600]) {
      const layout = computePageHeight(contentHeight);
      expect(layout.pageHeight).toBeGreaterThanOrEqual(PDF_MIN_PAGE_HEIGHT);
      expect(layout.pageHeight).toBeLessThanOrEqual(PDF_PAGE_HEIGHT);
      expect(layout.footerTop).toBeCloseTo(
        layout.pageHeight - PDF_BOTTOM_MARGIN - PDF_FOOTER_HEIGHT,
        4,
      );
    }
    // The footer never overlaps content: it sits at least POST_GAP below the
    // measured body unless the sensible minimum page height adds more space.
    const small = computePageHeight(80);
    expect(small.footerTop - small.contentBottom).toBeGreaterThanOrEqual(
      PDF_POST_CONTENT_GAP - 0.001,
    );
  });

  it('keeps the page count unchanged when the footer is drawn on a long, sparse multi-page document', async () => {
    // A long quotation with many hotels and many sparse (short) itinerary-day
    // pages. The footer pass previously drew below a sparse page's physical
    // height, PDFKit paginated, and the page-count guard threw (23 -> 54 in
    // production). The footer pass must add zero pages.
    const hotels = Array.from({ length: 40 }, (_, index) => ({
      city: `City ${index + 1}`,
      hotelName: `Grand Luxury Hotel & Resort Number ${index + 1} International`,
      category: '5 Star',
      roomType: 'Deluxe King Room with Sea View and Balcony',
      mealPlan: 'Breakfast Included',
      rooms: 2,
      nights: 3,
      selected: true,
      checkInDate: new Date('2026-11-01'),
      checkOutDate: new Date('2026-11-04'),
      notes: 'A fairly long remark describing the stay details for the traveller.',
    }));
    const days = Array.from({ length: 30 }, (_, index) => ({
      dayNumber: index + 1,
      title: `Day ${index + 1} in the itinerary for this long quotation`,
      date: new Date(`2026-11-${String(index + 1).padStart(2, '0')}`),
      meals: { breakfast: true },
      activities: [
        {
          name: `Morning activity ${index + 1}`,
          description: 'A short description.',
          startTime: '09:00',
          transfer: 'PRIVATE',
        },
      ],
    }));
    // A successful render means the internal page-count guard passed, i.e. the
    // page count before the footer pass equals the page count after it.
    const pdf = await renderQuotationPdf({
      company,
      quotation: {
        quotationNumber: 'QT-LONGFOOTER-0001',
        customerName: 'Long Sparse Trip',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Singapore',
        travelStartDate: new Date('2026-11-13'),
        travelEndDate: new Date('2026-11-18'),
        adults: 2,
        childrenWithBed: 1,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Singapore Long Sparse Package',
        introduction: null,
        currency: 'INR',
        finalAmount: '80000',
        notes: null,
        perAdultPrice: '35000',
        perChildWithBedPrice: '10000',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: 'Inclusive of all taxes, excluding TCS',
        initialPaymentAmount: '20000',
        paymentLink: null,
        inclusionsHtml: '<ul><li>Transfers</li><li>Breakfast</li></ul>',
        exclusionsHtml: null,
        paymentPolicies: '<p>Pay early.</p>',
        cancellationPolicies: '<p>Cancellation applies.</p>',
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Tours',
          amount: 0,
          description: null,
          days,
        },
        hotels,
        itinerary: [],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const count = pageCount(pdf);
    expect(count).toBeGreaterThan(20);
    // Every page still has real content (footer + body) — no trailing or
    // interleaved blank pages were introduced by the footer pass.
    const pages = pageWordBoxes(pdf);
    expect(pages.length).toBe(count);
    expect(pages.every((page) => page.words.length > 0)).toBe(true);
    // The final page is the content-sized thank-you page, not a blank page.
    expect(pdfTextPage(pdf, count)).toContain('THANK');
  });

  it('reserves a footer-safe zone below the content bottom limit', () => {
    // Content must stop before the footer divider on every measured page.
    const fullContentHeight = CONTENT_BOTTOM_LIMIT - PDF_TOP_MARGIN;
    const footerDividerY = computePageHeight(fullContentHeight).footerTop;
    expect(CONTENT_BOTTOM_LIMIT).toBeLessThan(footerDividerY);
    // A comfortable gap separates body content from the footer.
    expect(footerDividerY - CONTENT_BOTTOM_LIMIT).toBeGreaterThanOrEqual(
      PDF_POST_CONTENT_GAP - 0.001,
    );
    // Sparse pages have a shorter physical page and therefore a higher footer.
    const a = computePageHeight(100);
    const b = computePageHeight(fullContentHeight);
    expect(a.footerTop).toBeLessThan(b.footerTop);
    expect(b.footerTop).toBeCloseTo(footerDividerY, 4);
  });

  it('keeps long/sparse content out of the footer and packs days efficiently', async () => {
    // One itinerary day carries a description far longer than a page so its
    // bullets must split across page-safe blocks; the rest are sparse so the
    // days must pack onto shared pages instead of wasting one page each.
    const longDescription = Array.from(
      { length: 30 },
      (_, index) =>
        `Highlight bullet number ${index + 1} describing a genuine detail of this activity in full sentences.`,
    ).join('\n');
    const days = Array.from({ length: 20 }, (_, index) => ({
      dayNumber: index + 1,
      title: `Day ${index + 1} itinerary heading`,
      date: new Date(`2026-11-${String(index + 1).padStart(2, '0')}`),
      meals: { breakfast: true },
      activities:
        index === 10
          ? [
              {
                name: 'Long activity with extensive detail',
                description: longDescription,
                startTime: '09:00',
                dailyTransfer: 'PRIVATE',
              },
            ]
          : [
              {
                name: `Morning activity ${index + 1}`,
                description: 'A short description.',
                startTime: '09:00',
                dailyTransfer: 'PRIVATE',
              },
            ],
    }));
    const pdf = await renderQuotationPdf({
      company,
      quotation: {
        quotationNumber: 'QT-PAGINATION-0001',
        customerName: 'Pagination Test',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Singapore',
        travelStartDate: new Date('2026-11-13'),
        travelEndDate: new Date('2026-11-18'),
        adults: 2,
        childrenWithBed: 1,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Singapore Pagination Package',
        introduction: null,
        currency: 'INR',
        finalAmount: '80000',
        notes: null,
        perAdultPrice: '35000',
        perChildWithBedPrice: '10000',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: 'Inclusive of all taxes, excluding TCS',
        initialPaymentAmount: '20000',
        paymentLink: null,
        inclusionsHtml: '<ul><li>Transfers</li><li>Breakfast</li></ul>',
        exclusionsHtml: null,
        paymentPolicies: '<p>Pay early.</p>',
        cancellationPolicies: '<p>Cancellation applies.</p>',
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Tours',
          amount: 0,
          description: null,
          days,
        },
        hotels: [
          {
            city: 'Singapore',
            hotelName: 'Marina Bay Sands',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'BB',
            rooms: 1,
            nights: 5,
            selected: true,
            checkInDate: new Date('2026-11-13'),
            checkOutDate: new Date('2026-11-18'),
            notes: null,
          },
        ],
        itinerary: [],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    // Footer pass added no pages: the internal page-count guard passed, and the
    // rendered buffer contains exactly the planned pages.
    const pages = pageWordBoxes(pdf);
    const count = pageCount(pdf);
    expect(count).toBe(pages.length);
    // No blank or mostly-empty intermediate pages anywhere.
    for (const page of pages) {
      expect(page.words.length).toBeGreaterThan(0);
    }
    // Zero body/footer overlap: nothing is drawn in the safe-gap band directly
    // above the footer divider (body stops at CONTENT_BOTTOM_LIMIT, a POST_GAP
    // above the divider; footer text starts below it).
    for (const page of pages) {
      const footerTop = page.height - PDF_BOTTOM_MARGIN - PDF_FOOTER_HEIGHT;
      const inBand = page.words.filter(
        (word) => Math.abs(word.yMax - footerTop) < PDF_POST_CONTENT_GAP,
      );
      expect(inBand).toEqual([]);
    }
    // Long description bullets split safely across pages — the final bullet is
    // fully present in the rendered PDF rather than clipped into the footer.
    const text = pdfText(pdf);
    expect(text).toContain('Highlight bullet number 30');
    expect(text).toContain('describing a genuine detail of this activity');
    // The private transfer badge renders with its activity, never alone.
    expect(text).toContain('Private Transfer');
    // The thank-you page remains the final page — zero trailing blank pages.
    expect(pdfTextPage(pdf, count)).toContain('THANK');
  });

  it('renders cruise descriptions with images without footer overlap or trailing blanks', async () => {
    const longDescription = `<p>${Array.from(
      { length: 150 },
      (_, index) =>
        `Cruise detail ${index + 1} explains onboard dining, entertainment, embarkation and customer guidance.`,
    ).join(' ')}</p>`;
    expect(longDescription.length).toBeGreaterThan(10_000);
    const pdf = await renderQuotationPdf({
      company,
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        title: 'Cruise Description Package',
        services: [
          {
            serviceType: 'CRUISE',
            name: 'Genting Dream',
            description: '<p>Experience an unforgettable cruise aboard Genting Dream.</p>',
            city: 'Balcony',
            quantity: '1',
            unitSellingPrice: '100',
            notes: '3 NIGHTS',
          },
          {
            serviceType: 'CRUISE',
            name: 'Spectrum of the Seas',
            description: longDescription,
            city: 'Suite',
            quantity: '1',
            unitSellingPrice: '100',
            notes: '4 NIGHTS',
          },
        ],
      },
      images: { cover: PNG_1PX, services: [PNG_1PX, PNG_1PX] },
    });

    expect(isPdf(pdf)).toBe(true);
    const text = pdfText(pdf);
    expect(text).toContain('CRUISE DETAILS');
    expect(text).toContain('Genting Dream');
    expect(text).toContain('Experience an unforgettable cruise aboard Genting Dream.');
    expect(text).toContain('Spectrum of the Seas');
    expect(text).toContain('Cruise detail 150');
    expect(text).toContain('onboard dining');

    const count = pageCount(pdf);
    const pages = pageWordBoxes(pdf);
    expect(pages).toHaveLength(count);
    expect(pages.every((page) => page.words.length > 0)).toBe(true);
    for (const page of pages) {
      const footerTop = page.height - PDF_BOTTOM_MARGIN - PDF_FOOTER_HEIGHT;
      const inBand = page.words.filter(
        (word) => Math.abs(word.yMax - footerTop) < PDF_POST_CONTENT_GAP,
      );
      expect(inBand).toEqual([]);
    }
    expect(pdfTextPage(pdf, count)).toContain('THANK');
  });

  it('renders add-on service snapshot images in both PDF styles', async () => {
    const addonService = {
      serviceType: 'OTHER_ADD_ON',
      addOnServiceId: 'addon-visa-1',
      name: 'Singapore Visa',
      description: '<p>Visa assistance with documentation.</p>',
      city: null,
      quantity: '1',
      unitSellingPrice: '100',
      notes: null,
    };
    const versionWithImage = {
      ...baseVersionOverlap(),
      title: 'Add-on Image Package',
      services: [addonService],
    };
    const countImages = (pdf: Buffer) =>
      (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;

    const classicWithImage = await renderQuotationPdf({
      company,
      quotation: quotationOverlap(),
      version: versionWithImage,
      images: { cover: PNG_1PX, services: [PNG_1PX] },
    });
    expect(isPdf(classicWithImage)).toBe(true);
    const classicWithoutImage = await renderQuotationPdf({
      company,
      quotation: quotationOverlap(),
      version: versionWithImage,
      images: { cover: PNG_1PX, services: [] },
    });
    expect(isPdf(classicWithoutImage)).toBe(true);
    // The image-carrying row embeds one more image object than the legacy text block.
    expect(countImages(classicWithImage)).toBeGreaterThan(countImages(classicWithoutImage));

    const stylishInputBase = {
      company: footerEmptyCompanyForOverlap(),
      quotation: quotationOverlap(),
      version: versionWithImage,
    };
    const stylishWithImage = await renderStylishQuotationPdf({
      ...stylishInputBase,
      images: { cover: PNG_1PX, services: [PNG_1PX] },
    });
    expect(isPdf(stylishWithImage)).toBe(true);
    const stylishWithoutImage = await renderStylishQuotationPdf({
      ...stylishInputBase,
      images: { cover: PNG_1PX, services: [] },
    });
    expect(isPdf(stylishWithoutImage)).toBe(true);
    expect(countImages(stylishWithImage)).toBeGreaterThan(countImages(stylishWithoutImage));
  });

  it('leaves a uniform vertical gap between classic add-on cards', async () => {
    const pdf = await renderQuotationPdf({
      company,
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        title: 'Add-on Spacing Package',
        services: ['BUY COFFEE', 'VISA SERVICE', 'CITY TOUR'].map((name, index) => ({
          serviceType: 'OTHER_ADD_ON',
          addOnServiceId: `addon-${index + 1}`,
          name,
          description: '<p>Short desc.</p>',
          city: null,
          quantity: '1',
          unitSellingPrice: '100',
          notes: null,
          sequence: index + 1,
        })),
      },
      images: { cover: PNG_1PX, services: [PNG_1PX, PNG_1PX, PNG_1PX] },
    });
    expect(isPdf(pdf)).toBe(true);
    // Bordered card outlines are stroked rounded rects spanning the content
    // width: top edge `46 Y m ... 549.28 Y l`, bottom edge ending `... 46 Y l`.
    const raw = pdf.toString('latin1');
    const streams: string[] = [];
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let streamMatch: RegExpExecArray | null;
    while ((streamMatch = streamRe.exec(raw))) {
      try {
        streams.push(zlib.inflateSync(Buffer.from(streamMatch[1] ?? '', 'latin1')).toString('latin1'));
      } catch {
        streams.push(streamMatch[1] ?? '');
      }
    }
    const joined = streams.join('\n');
    const tops = [...joined.matchAll(/46 ([\d.]+) m\n549\.28 \1 l/g)].map((m) => Number(m[1]));
    const bottoms = [...joined.matchAll(/ c\n46 ([\d.]+) l\n/g)].map((m) => Number(m[1]));
    const seen = new Set<string>();
    const boxes: Array<{ top: number; bottom: number }> = [];
    for (const top of tops) {
      const bottom = bottoms
        .filter((candidate) => candidate > top)
        .sort((a, b) => a - b)[0];
      if (bottom === undefined) continue;
      const key = `${top}:${bottom}`;
      if (seen.has(key)) continue;
      seen.add(key);
      boxes.push({ top, bottom });
    }
    // The three identical add-on cards share one exact height; any other
    // bordered element differs.
    const byHeight = new Map<number, Array<{ top: number; bottom: number }>>();
    for (const box of boxes) {
      const height = Math.round((box.bottom - box.top) * 100) / 100;
      byHeight.set(height, [...(byHeight.get(height) ?? []), box]);
    }
    const trios = [...byHeight.values()].filter((group) => group.length === 3);
    expect(trios).toHaveLength(1);
    const cards = trios[0]!.sort((a, b) => a.top - b.top);
    const gaps = cards.slice(1).map((card, index) => card.top - cards[index]!.bottom);
    expect(gaps).toHaveLength(2);
    // No touching or overlap: the explicit spacer block separates every card.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(7.5);
      expect(gap).toBeLessThan(8.5);
    }
  });

  it('keeps cruise PDF layout stable when description is absent', async () => {
    const pdf = await renderQuotationPdf({
      company,
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        title: 'Cruise Without Description',
        services: [
          {
            serviceType: 'CRUISE',
            name: 'Genting Dream',
            description: null,
            city: 'Balcony',
            quantity: '1',
            unitSellingPrice: '100',
            notes: '3 NIGHTS',
          },
        ],
      },
      images: { cover: PNG_1PX, services: [PNG_1PX] },
    });

    const text = pdfText(pdf);
    expect(text).toContain('Genting Dream');
    expect(text).toContain('Duration: 3 NIGHTS');
    expect(text).not.toContain('Description:');
    expect(pdfTextPage(pdf, pageCount(pdf))).toContain('THANK');
  });

  it('renders hotel cards that keep every field inside the rounded border', async () => {
    // Long hotel titles / room types that previously overflowed the fixed 150pt
    // card border. The card must size itself to the content and keep Check-out
    // on the same physical page above the footer.
    const pdf = await renderQuotationPdf({
      company,
      quotation: {
        quotationNumber: 'QT-HOTEL-0001',
        customerName: 'Hotel Test',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Kuala Lumpur',
        travelStartDate: new Date('2026-09-02'),
        travelEndDate: new Date('2026-09-07'),
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Kuala Lumpur Package',
        introduction: null,
        currency: 'INR',
        finalAmount: '50000',
        notes: null,
        perAdultPrice: '50000',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: null,
        initialPaymentAmount: '0',
        paymentLink: null,
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        sightseeingDetails: null,
        hotels: [
          {
            city: 'Kuala Lumpur',
            hotelName: 'Berjaya Times Square Hotel, Kuala Lumpur',
            category: '5 Star',
            roomType: 'Superior room with Bathtub',
            mealPlan: 'CP Breakfast',
            rooms: 3,
            nights: 4,
            selected: true,
            checkInDate: new Date('2026-09-02'),
            checkOutDate: new Date('2026-09-06'),
            notes: null,
          },
        ],
        itinerary: [],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    // Hotel pages also keep the existing bounded dynamic height.
    for (const box of pageMediaBoxes(pdf)) {
      expect(box.width).toBeCloseTo(PDF_PAGE_WIDTH, 0);
      expect(box.height).toBeGreaterThanOrEqual(PDF_MIN_PAGE_HEIGHT - 1);
      expect(box.height).toBeLessThanOrEqual(PDF_PAGE_HEIGHT + 1);
    }
    const text = pdfText(pdf);
    expect(text).toContain('Berjaya Times Square Hotel');
    expect(text).toContain('Room Type: Superior room with Bathtub');
    expect(text).toContain('Rooms: 3');
    expect(text).toContain('Check-out:');
    // The hotel page still carries the identical footer.
    const pages = pageCount(pdf);
    for (let p = 1; p <= pages; p += 1) {
      const pageText = pdfTextPage(pdf, p);
      expect(pageText).toContain('CONTACT US');
      expect(pageText).toContain(`Page ${p}/${pages}`);
    }
  });

  it('renders the cover destination title directly over the image without a dark band', async () => {
    // Cover: KUALA LUMPUR heading + Destination: Malaysia summary + image.
    const pdf = await renderQuotationPdf({
      company,
      quotation: {
        quotationNumber: 'QT-COVER-0001',
        customerName: 'Rajesh Kumar',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Kuala Lumpur',
        destinations: 'Malaysia',
        travelStartDate: new Date('2026-11-20'),
        travelEndDate: new Date('2026-11-24'),
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Kuala Lumpur Package',
        introduction: null,
        currency: 'INR',
        finalAmount: '65000',
        notes: null,
        perAdultPrice: '60000',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: null,
        initialPaymentAmount: '0',
        paymentLink: null,
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        sightseeingDetails: null,
        hotels: [],
        itinerary: [],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      images: { cover: PNG_1PX },
    });
    const firstPage = pdfTextPage(pdf, 1).toUpperCase();
    expect(firstPage).toContain('KUALA LUMPUR');
    expect(pdfText(pdf)).toContain('Destination: Malaysia');
    // The cover text sits on the first page above the footer divider.
    const layout = computePageHeight(0);
    expect(layout.footerTop).toBeGreaterThan(PDF_TOP_MARGIN + 200);
  });

  it('renders a multi-page booking confirmation with many travellers and services', async () => {
    const pdf = await renderBookingConfirmationPdf({
      company,
      booking: {
        ...invoiceBooking,
        sourceTerms: [LONG_TERMS],
        services: invoiceServices,
        itinerary: Array.from({ length: 15 }, (_, i) => ({
          dayNumber: i + 1,
          title: `Day ${i + 1}`,
          destination: `City ${i + 1}`,
          description: 'Day description. '.repeat(30),
          meals: 'B/L/D',
          overnightLocation: `City ${i + 1}`,
        })),
      },
    });
    expect(isPdf(pdf)).toBe(true);
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(extractText(pdf)).not.toMatch(
      /internal cost|vendor cost|gross profit|net profit|profit margin/i,
    );
  });

  it('renders the invoice and keeps it distinct from the tax invoice', async () => {
    const invoice = await renderBookingInvoicePdf({
      company: invoiceCompany,
      booking: invoiceBooking,
    });
    const taxInvoice = await renderBookingTaxInvoicePdf({
      company: invoiceCompany,
      booking: invoiceBooking,
    });
    expect(isPdf(invoice)).toBe(true);
    expect(isPdf(taxInvoice)).toBe(true);
    const invoiceText = extractText(invoice);
    const taxText = extractText(taxInvoice);
    // The tax invoice adds a GST/TCS breakdown and total payable; the plain
    // invoice does not, so it is a genuinely different, larger document.
    expect(invoice.equals(taxInvoice)).toBe(false);
    expect(taxInvoice.length).toBeGreaterThan(invoice.length);
    // Neither customer document leaks internal cost (defense in depth; the
    // render input types structurally exclude cost fields).
    expect(invoiceText).not.toMatch(
      /internal cost|vendor cost|supplier cost|gross profit|net profit/i,
    );
    expect(taxText).not.toMatch(/internal cost|vendor cost|supplier cost|gross profit|net profit/i);
  });

  it('renders the voucher with many travellers and no financials', async () => {
    const pdf = await renderBookingVoucherPdf({ company: invoiceCompany, booking: invoiceBooking });
    expect(isPdf(pdf)).toBe(true);
    expect(pageCount(pdf)).toBeGreaterThan(1);
    const text = extractText(pdf);
    // The voucher is operational only — none of the invoice's financial labels.
    expect(text).not.toMatch(
      /internal cost|vendor cost|net profit|total payable|tax summary|payment summary/i,
    );
  });

  it('keeps long body bullets above the footer divider (no footer overlap)', async () => {
    // One inclusion bullet long enough to wrap well beyond a single page used to
    // overflow straight through the reserved footer zone. Body text must never
    // enter the footer area — overflow continues on the next page instead.
    const giantBullet = 'Long inclusion bullet with repeated clauses. '.repeat(500);
    const footerEmptyCompany = {
      name: 'Alpha Travel',
      email: '',
      phone: null,
      website: null,
      address: null,
      primaryColor: '#2563eb',
      operatingSinceYear: null,
      tripsSold: null,
      tan: null,
      taxRegistrationNumber: null,
      logo: null,
    };
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompany,
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: {
        quotationNumber: 'QT-OVERLAP-0001',
        customerName: 'Overlap Test',
        customerEmail: null,
        customerPhone: '+91 90000 00000',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
      },
      version: {
        versionNumber: 1,
        title: 'Overlap Probe',
        introduction: null,
        currency: 'INR',
        finalAmount: '100',
        notes: null,
        perAdultPrice: '50',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: null,
        initialPaymentAmount: '0',
        paymentLink: null,
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        flightDetails: null,
        sightseeingDetails: null,
        hotels: [],
        itinerary: [],
        services: [],
        inclusions: [{ content: giantBullet }],
        exclusions: [],
        terms: [],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    // A single bullet taller than a page must paginate onto multiple pages
    // rather than squeezing or clipping.
    expect(pageCount(pdf)).toBeGreaterThan(1);
    // The footer company has no contact/achievements/legal data, so the only
    // text allowed below the divider is the "Page X/Y" badge.
    const footerTop = PDF_PAGE_HEIGHT - PDF_BOTTOM_MARGIN - PDF_FOOTER_HEIGHT;
    const offender = wordBoxes(pdf).find(
      (word) => word.yBottomFromTop > footerTop && !/^(Page|\d+\/\d+)$/.test(word.text.trim()),
    );
    expect(offender).toBeUndefined();
  });

  it('keeps long policy paragraphs, headings, and the footer in separate bounded areas', async () => {
    const repeated = (marker: string) =>
      `<p>${`${marker} passenger refund and unused service conditions. `.repeat(35)}</p>` +
      `<ul><li>${`${marker} wrapped bullet condition. `.repeat(40)}</li></ul>`;
    const pdf = await renderQuotationPdf({
      company: {
        ...company,
        logo: PNG_1PX,
        email: 'reservations-for-very-long-contact-address@a-very-long-example-domain.test',
        website: 'https://www.a-very-long-example-domain.test/quotation-support',
      },
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        inclusionsHtml: repeated('INCLUSIONDETAIL'),
        exclusionsHtml: repeated('EXCLUSIONDETAIL'),
        paymentPolicies: repeated('PAYMENTDETAIL'),
        cancellationPolicies: repeated('CANCELLATIONDETAIL'),
        bookingTerms: repeated('BOOKINGDETAIL'),
      },
    });
    const total = pageCount(pdf);
    const pages = pageWordBoxes(pdf);
    expect(pages).toHaveLength(total);
    const policyWord =
      /^(INCLUSIONDETAIL|EXCLUSIONDETAIL|PAYMENTDETAIL|CANCELLATIONDETAIL|BOOKINGDETAIL)$/;
    pages.forEach((page, index) => {
      const contentBottom =
        page.height - PDF_BOTTOM_MARGIN - PDF_FOOTER_HEIGHT - PDF_POST_CONTENT_GAP;
      expect(
        page.words.filter((word) => policyWord.test(word.text) && word.yMax > contentBottom),
        `policy body crossed the footer boundary on page ${index + 1}`,
      ).toEqual([]);
      expect(pdfTextPage(pdf, index + 1)).toContain(`Page ${index + 1}/${total}`);
    });
    for (const [heading, marker] of [
      ['INCLUSIONS', 'INCLUSIONDETAIL'],
      ['EXCLUSIONS', 'EXCLUSIONDETAIL'],
      ['PAYMENT POLICIES', 'PAYMENTDETAIL'],
      ['CANCELLATION POLICIES', 'CANCELLATIONDETAIL'],
      ['BOOKING TERMS', 'BOOKINGDETAIL'],
    ] as const) {
      const headingPage = Array.from({ length: total }, (_, i) => pdfTextPage(pdf, i + 1)).find(
        (text) => text.includes(heading),
      );
      expect(headingPage).toContain(marker);
    }
    expect(pdfTextPage(pdf, total)).toContain('THANK');
    expect(pdfTextPage(pdf, total)).toContain('YOU');
  });

  it('uses one canonical itinerary image precedence for Weblink and PDF values', () => {
    const source = {
      document: (key: string) => (key === 'document-a' ? 'document-value' : null),
      snapshot: (key: string) => (key === 'snapshot-a' ? 'snapshot-value' : null),
      sightseeing: (key: string) => `${key}-value`,
      destination: 'destination-value',
    };
    expect(
      resolveItineraryDayImage(
        [{ imageDocumentId: 'document-a', imageUrl: 'snapshot-a', sightseeingId: 'master-a' }],
        source,
      ),
    ).toBe('document-value');
    expect(
      resolveItineraryActivityImage(
        { imageDocumentId: 'document-a', imageUrl: 'snapshot-a', sightseeingId: 'master-a' },
        source,
      ),
    ).toBe('document-value');
    expect(
      resolveItineraryDayImage([{ imageUrl: 'snapshot-a', sightseeingId: 'master-a' }], source),
    ).toBe('snapshot-value');
    expect(
      resolveItineraryActivityImage({ imageUrl: 'snapshot-a', sightseeingId: 'master-a' }, source),
    ).toBe('snapshot-value');
    expect(resolveItineraryDayImage([{ sightseeingId: 'master-b' }], source)).toBe(
      'master-b-value',
    );
    expect(resolveItineraryDayImage([{ imageUrl: 'missing' }], source)).toBe('destination-value');
    expect(resolveItineraryActivityImage({ imageUrl: 'missing' }, source)).toBeNull();
  });

  it('does not replace an explicitly emptied activity gallery with destination art', () => {
    expect(pdfDayAllowsDestinationFallback([{ imageSnapshotPresent: true }])).toBe(false);
    expect(pdfDayAllowsDestinationFallback([{ imageSnapshotPresent: false }, {}])).toBe(true);
    expect(
      pdfActivityImageOrCover({ imageSnapshotPresent: true }, null, 'destination-cover'),
    ).toBeNull();
    expect(
      pdfActivityImageOrCover(
        { imageSnapshotPresent: true },
        'quotation-selected-image',
        'destination-cover',
      ),
    ).toBe('quotation-selected-image');
    expect(
      pdfActivityImageOrCover({ imageSnapshotPresent: false }, null, 'destination-cover'),
    ).toBe('destination-cover');
  });

  it('renders stored day titles verbatim without generating separators', () => {
    expect(stripItineraryDayPrefixes('Day 5: Day 4: Day 3: Singapore City Tour')).toBe(
      'Singapore City Tour',
    );
    expect(formatItineraryDayTitle(5, 'Day 4: Marina Bay')).toBe('Day 4: Marina Bay');
    expect(formatItineraryDayTitle(4, 'Day 3: Singapore City Tour')).toBe(
      'Day 3: Singapore City Tour',
    );
    expect(formatItineraryDayTitle(1, 'Night safari')).toBe('Night safari');
  });

  it('uses the destination image for a single Day at Leisure without an activity image', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 5,
              title: 'Day 5: Day at Leisure',
              city: 'Singapore',
              activities: [
                {
                  name: 'Day at Leisure',
                  description: 'Explore Singapore.',
                  imageUrl: null,
                  sightseeingId: null,
                },
              ],
            },
          ],
        },
      },
      images: { cover: PNG_1PX },
    });
    expect(pdfText(pdf)).toContain('Day 5: Day at Leisure');
    expect(
      (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('renders only selected add-on rows in the PDF (linked to an add-on master)', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        addOnDetails: { include: true },
        services: [
          {
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'master-visa',
            name: 'Singapore Visa',
            description: null,
            city: null,
            notes: null,
            quantity: '1',
            unitSellingPrice: '1500',
          },
          {
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: null,
            name: 'other add on',
            description: null,
            city: null,
            notes: null,
            quantity: '1',
            unitSellingPrice: '500',
          },
        ],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const visible = pdfText(pdf);
    expect(visible).toContain('ADD-ON SERVICES');
    expect(visible).toContain('Singapore Visa');
    // The unselected add-on row must not appear.
    expect(visible).not.toContain('other add on');
  });

  it('renders every add-on pricing option as compact boxes (classic + stylish)', async () => {
    const services = [
      {
        serviceType: 'OTHER_ADD_ON' as const,
        addOnServiceId: 'master-visa',
        name: 'Singapore Visa',
        description: null,
        city: null,
        notes: null,
        quantity: '1',
        unitSellingPrice: '1500',
        pricingSnapshot: [
          { id: 'opt-adult', label: 'Adult', price: 6000, currency: 'INR' },
          { id: 'opt-child', label: 'Child', price: 4000, currency: 'INR' },
          { id: 'opt-group', label: 'Per Group', price: 20000, currency: 'USD' },
        ],
      },
    ];
    const classic = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        addOnDetails: { include: true },
        services,
      },
    });
    expect(isPdf(classic)).toBe(true);
    for (const word of ['Adult', 'Child', 'Per Group', '6,000', '4,000', '20,000']) {
      expect(pdfText(classic)).toContain(word);
    }
    // Label sits above its price inside the tile (same page).
    const tilePage = pageWordBoxes(classic).find((page) =>
      page.words.some((w) => w.text.endsWith('6,000')),
    );
    expect(tilePage).toBeDefined();
    const labelY = tilePage!.words.find((w) => w.text === 'Adult')?.yMax;
    const priceY = tilePage!.words.find((w) => w.text.endsWith('6,000'))?.yMax;
    expect(labelY).toBeDefined();
    expect(priceY).toBeDefined();
    expect(labelY!).toBeLessThan(priceY!);
    const stylish = await renderStylishQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        addOnDetails: { include: true },
        services,
      },
    });
    expect(isPdf(stylish)).toBe(true);
    for (const word of ['Adult', 'Child', 'Per Group', '6,000', '4,000', '20,000']) {
      expect(pdfText(stylish)).toContain(word);
    }
  });

  it('hides the ADD-ON SERVICES section when no add-on row is selected', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        addOnDetails: { include: true },
        services: [
          {
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: null,
            name: 'other add on',
            description: null,
            city: null,
            notes: null,
            quantity: '1',
            unitSellingPrice: '500',
          },
          {
            serviceType: 'TRAVEL_INSURANCE',
            addOnServiceId: null,
            name: 'Singapore Visa',
            description: null,
            city: null,
            notes: null,
            quantity: '1',
            unitSellingPrice: '1500',
          },
        ],
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const visible = pdfText(pdf);
    expect(visible).not.toContain('ADD-ON SERVICES');
    expect(visible).not.toContain('other add on');
    expect(visible).not.toContain('Singapore Visa');
  });

  it('prefixes Classic PDF tour-itinerary day headings with DAY N like the Weblink', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'Arrival in Singapore',
              city: 'Singapore',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                { name: 'Night Safari', description: null, startTime: null },
                { name: 'Universal Studios', description: null, startTime: null },
              ],
            },
            {
              dayNumber: 2,
              title: 'DAY 2 | Singapore City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              dailyTransfer: 'NO_TRANSFER',
              activities: [{ name: 'Shopping', description: null, startTime: null }],
            },
          ],
        },
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const flat = pdfText(pdf).replace(/\s+/g, ' ');
    // CASE 1: bare day title gains the generated prefix.
    expect(flat).toContain('DAY 1 | Arrival in Singapore');
    // CASE 2: stored prefix preserved exactly.
    expect(flat).toContain('DAY 2 | Singapore City Tour');
    // CASE 3: same-day activities keep their own names with no repeated prefix.
    expect(flat).toContain('Night Safari');
    expect(flat).toContain('Universal Studios');
    expect(flat).toContain('Shopping');
    expect(flat).not.toContain('DAY 1 | Night Safari');
    expect(flat).not.toContain('DAY 1 | Universal Studios');
    expect(flat).not.toContain('DAY 2 | Shopping');
    // CASE 5: never duplicated.
    expect(flat).not.toMatch(/DAY 1 \| DAY 1/);
    expect(flat).not.toMatch(/DAY 2 \| DAY 2/);
  });

  it('renders the saved per-meal transfer mode in the itinerary meals (No Transfer)', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Kochi',
              date: null,
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              mealPreferences: { breakfast: { mode: 'NO_TRANSFER', transferDetails: null } },
              dailyTransfer: 'SHARED',
              activities: [{ name: 'City tour', description: null, startTime: null }],
            },
          ],
        },
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const visible = pdfText(pdf);
    // The saved No Transfer preference wins over the legacy "Hotel" default.
    expect(visible).toContain('(B) Breakfast (No Transfer)');
    expect(visible).not.toContain('(B) Breakfast (Hotel)');
  });

  it('keeps (B) Breakfast (Hotel) when the saved meal mode is include-at-hotel', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Kochi',
              date: null,
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'NO_TRANSFER',
              mealPreferences: { breakfast: { mode: 'INCLUDE_AT_HOTEL', transferDetails: null } },
              dailyTransfer: 'SHARED',
              activities: [{ name: 'City tour', description: null, startTime: null }],
            },
          ],
        },
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const visible = pdfText(pdf);
    expect(visible).toContain('(B) Breakfast (Hotel)');
  });

  it('renders each itinerary activity as its own block with its own transfer', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 2,
              title: 'Day 2: Mandai Wildlife Reserve Adventure',
              city: 'Singapore',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Singapore City Tour',
                  description: '<p>City tour.</p>',
                  startTime: '09:00',
                  sightseeingId: null,
                  imageUrl: null,
                  dailyTransfer: 'SHARED',
                },
                {
                  name: 'Singapore Zoo',
                  description: '<p>Zoo visit.</p>',
                  startTime: '10:00',
                  sightseeingId: null,
                  imageUrl: null,
                  dailyTransfer: 'NO_TRANSFER',
                },
                {
                  name: 'Day at Cruise',
                  description: '<p>Cruise day.</p>',
                  startTime: '11:00',
                  sightseeingId: null,
                  imageUrl: null,
                  dailyTransfer: 'PRIVATE',
                },
              ],
            },
          ],
        },
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const visible = pdfText(pdf);
    expect(visible).toContain('Day 2: Mandai Wildlife Reserve Adventure');
    expect(visible).toContain('Singapore City Tour');
    expect(visible).toContain('Singapore Zoo');
    expect(visible).toContain('Day at Cruise');
    // Each activity shows its OWN transfer value.
    expect(visible).toContain('Shared Transfer');
    expect(visible).toContain('No Transfer');
    expect(visible).toContain('Private Transfer');
  });

  it('embeds every itinerary activity image (not just the first)', async () => {
    const pdf = await renderQuotationPdf({
      company: footerEmptyCompanyForOverlap(),
      consultant: { name: 'Only Name', phone: null, email: null },
      quotation: quotationOverlap(),
      version: {
        ...baseVersionOverlap(),
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 2,
              title: 'Day 2',
              city: 'Singapore',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              activities: [
                {
                  name: 'Singapore City Tour',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: 'https://storage.example.test/city-tour.jpg',
                  dailyTransfer: null,
                },
                {
                  name: 'Singapore Zoo',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: 'https://storage.example.test/zoo.jpg',
                  dailyTransfer: null,
                },
                {
                  name: 'Day at Cruise',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: 'https://storage.example.test/cruise.jpg',
                  dailyTransfer: null,
                },
              ],
            },
          ],
        },
      },
      images: {
        itinerary: {
          'https://storage.example.test/city-tour.jpg': PNG_1PX,
          'https://storage.example.test/zoo.jpg': PNG_1PX,
          'https://storage.example.test/cruise.jpg': PNG_1PX,
        },
      },
    });
    expect(isPdf(pdf)).toBe(true);
    const raw = pdf.toString('latin1');
    const imageCount = (raw.match(/\/Subtype\s*\/Image/g) ?? []).length;
    // Three distinct activity images are embedded (no reuse of one image).
    expect(imageCount).toBeGreaterThanOrEqual(3);
  });
});

// =============================================================================
// Destination Expert + Frequently Asked Questions in BOTH quotation PDF styles
// (same server-resolved data the public weblink uses; sections must render in
// weblink order — Expert → FAQs → Thank You — and never overlap the footer).
// =============================================================================

const expertFixture: QuotationPdfDestinationExpert = {
  fullName: 'Tisha Menon',
  heading: 'Your Malaysia Destination Expert',
  customIntroduction:
    '<p>From planning your itinerary to ensuring a smooth travel experience, I am here to help you make the most of your Malaysia trip.</p>',
  whatsappNumber: '+919820012345',
  callNumber: '+919820054321',
  email: 'tisha@example.test',
  jobTitle: 'Senior Travel Consultant',
  bio: null,
  specialization: 'Malaysia & Singapore',
  showWhatsapp: true,
  showCall: true,
  showEmail: true,
};

const faqFixture = [
  {
    question: 'Is this package suitable for families with children?',
    answer: '<p>Yes, the itinerary can be planned according to your family preferences.</p>',
  },
  {
    question: 'Can we choose our preferred hotel?',
    answer: '<p>Absolutely, hotel upgrades are available on request.</p>',
  },
];

type ExpertPdfOverrides = {
  destinationExpert?: typeof expertFixture | null;
  includeExpertKey?: boolean;
  faqs?: Array<{ question: string; answer: string }> | null;
  includeFaqsKey?: boolean;
  expertProfile?: Buffer;
};

/** Minimal input with only the fields under test; mirrors an old snapshot. */
function expertTestInput(overrides: ExpertPdfOverrides = {}) {
  const version: Record<string, unknown> = { ...baseVersionOverlap() };
  if (overrides.includeFaqsKey !== false && overrides.faqs !== undefined)
    version.faqs = overrides.faqs;
  const input: Record<string, unknown> = {
    company: footerEmptyCompanyForOverlap(),
    quotation: quotationOverlap(),
    version,
    images: { cover: PNG_1PX },
  };
  if (overrides.expertProfile) {
    (input.images as Record<string, unknown>).expertProfile = overrides.expertProfile;
  }
  if (overrides.destinationExpert !== undefined || overrides.includeExpertKey) {
    input.destinationExpert = overrides.destinationExpert ?? null;
  }
  return input as unknown as Parameters<typeof renderStylishQuotationPdf>[0];
}

describe('Destination Expert and FAQs in both PDF styles', () => {
  it('renders Destination Expert and FAQs in order before Thank You in both styles', async () => {
    const input = expertTestInput({
      destinationExpert: expertFixture,
      includeExpertKey: true,
      faqs: faqFixture,
    });
    for (const rendered of [
      await renderQuotationPdf(input),
      await renderStylishQuotationPdf(input),
    ]) {
      const text = pdfText(rendered);
      // Expert section content.
      expect(text).toContain('TISHA');
      expect(text.toLowerCase()).toContain('your malaysia destination expert');
      expect(text).toContain('ensuring a smooth travel experience');
      expect(text).toContain('Malaysia trip.');
      // Contact rows with clickable values.
      expect(text).toContain('+919820012345');
      expect(text).toContain('+919820054321');
      expect(text).toContain('tisha@example.test');
      // FAQ section content, numbered, in order.
      expect(text.toLowerCase()).toContain('frequently asked questions');
      expect(text).toContain('Is this package suitable for families with children?');
      expect(text).toContain('planned according to your family preferences');
      expect(text).toContain('Can we choose our preferred hotel?');
      expect(text).toContain('hotel upgrades are available on request');
      // Answers are rendered as clean text, never as raw HTML.
      expect(text).not.toContain('<p>');
      expect(text).not.toContain('<li>');
      const lower = text.toLowerCase();
      const expertAt = lower.indexOf('your malaysia destination expert');
      const faqAt = lower.indexOf('frequently asked questions');
      const q1At = text.indexOf('Is this package suitable for families');
      const q2At = text.indexOf('Can we choose our preferred hotel?');
      const thankAt = text.search(/thank\s+you/i);
      expect(expertAt).toBeGreaterThanOrEqual(0);
      expect(faqAt).toBeGreaterThan(expertAt);
      expect(q1At).toBeGreaterThan(faqAt);
      expect(q2At).toBeGreaterThan(q1At);
      // Thank You remains the final intended page.
      const pages = pageCount(rendered);
      expect(pages).toBeGreaterThan(1);
      expect(pdfTextPage(rendered, pages)).toMatch(/THANK\s+YOU/i);
      expect(thankAt).toBeGreaterThan(q2At);
    }
  });

  it('embeds the expert profile photo in both styles', async () => {
    const input = expertTestInput({
      destinationExpert: expertFixture,
      includeExpertKey: true,
      faqs: null,
      expertProfile: PNG_1PX_RED,
    });
    for (const rendered of [
      await renderQuotationPdf(input),
      await renderStylishQuotationPdf(input),
    ]) {
      const imageObjects = rendered.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? [];
      // Cover image plus the resolved expert profile photo.
      expect(imageObjects.length).toBeGreaterThanOrEqual(2);
      expect(pdfText(rendered)).toContain('TISHA');
    }
  });

  it('omits the expert image cleanly when no photo was resolved (no placeholder box)', async () => {
    const withoutPhoto = expertTestInput({
      destinationExpert: expertFixture,
      includeExpertKey: true,
      faqs: null,
    });
    const withPhoto = expertTestInput({
      destinationExpert: expertFixture,
      includeExpertKey: true,
      faqs: null,
      expertProfile: PNG_1PX_RED,
    });
    for (const [style, rendered, photoRendered] of [
      ['classic', await renderQuotationPdf(withoutPhoto), await renderQuotationPdf(withPhoto)],
      [
        'stylish',
        await renderStylishQuotationPdf(withoutPhoto),
        await renderStylishQuotationPdf(withPhoto),
      ],
    ] as const) {
      const countImages = (buffer: Buffer) =>
        (buffer.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
      // Adding the resolved profile photo embeds exactly one more image; the
      // no-photo render must not invent a placeholder image box.
      expect(countImages(photoRendered)).toBe(countImages(rendered) + 1);
      const text = pdfText(rendered);
      expect(text).toContain('TISHA');
      if (style === 'classic') {
        // Without a photo the classic style must not reserve a photo column:
        // the intro's first word starts at the page's left margin.
        const introWord = wordBoxes(rendered).find((word) => word.text === 'From');
        expect(introWord).toBeDefined();
        expect(introWord!.xMin).toBeLessThan(50);
      }
    }
  });

  it('hides expert contact rows whose values are empty or toggled off', async () => {
    const input = expertTestInput({
      destinationExpert: {
        ...expertFixture,
        whatsappNumber: null,
        callNumber: null,
        email: null,
        showWhatsapp: false,
        showCall: false,
        showEmail: false,
      },
      includeExpertKey: true,
      faqs: null,
    });
    for (const rendered of [
      await renderQuotationPdf(input),
      await renderStylishQuotationPdf(input),
    ]) {
      const text = pdfText(rendered);
      expect(text).toContain('TISHA');
      expect(text).not.toContain('9820012345');
      expect(text).not.toContain('9820054321');
      expect(text).not.toContain('tisha@example.test');
    }
  });

  it('hides the whole FAQ section when there are no FAQs', async () => {
    const input = expertTestInput({
      destinationExpert: expertFixture,
      includeExpertKey: true,
      faqs: [],
    });
    for (const rendered of [
      await renderQuotationPdf(input),
      await renderStylishQuotationPdf(input),
    ]) {
      const text = pdfText(rendered).toLowerCase();
      expect(text).not.toContain('frequently asked questions');
      expect(text).toContain('tisha');
      // Invalid FAQ rows (empty question/answer) are dropped too.
    }
    const invalidInput = expertTestInput({
      destinationExpert: expertFixture,
      includeExpertKey: true,
      faqs: [
        { question: '', answer: 'orphan answer' },
        { question: 'Orphan question', answer: '' },
      ],
    });
    for (const rendered of [
      await renderQuotationPdf(invalidInput),
      await renderStylishQuotationPdf(invalidInput),
    ]) {
      const text = pdfText(rendered);
      expect(text.toLowerCase()).not.toContain('frequently asked questions');
      expect(text).not.toContain('orphan answer');
      expect(text).not.toContain('Orphan question');
    }
  });

  it('keeps long FAQ answers fully rendered, paginated and out of the footer zone', async () => {
    const sentence =
      'Refund conditions remain documented for every traveller and every unused service. ';
    const longAnswer = `<p>${Array.from(
      { length: 45 },
      (_, i) => `FAQDETAIL${String(i + 1).padStart(2, '0')} ${sentence}`,
    ).join('')}</p>`;
    const input = expertTestInput({
      destinationExpert: expertFixture,
      includeExpertKey: true,
      faqs: [...faqFixture, { question: 'What is the cancellation policy?', answer: longAnswer }],
    });
    for (const [style, rendered] of [
      ['classic', await renderQuotationPdf(input)],
      ['stylish', await renderStylishQuotationPdf(input)],
    ] as const) {
      const text = pdfText(rendered);
      // Every marker survives pagination — nothing is clipped or dropped.
      for (let i = 1; i <= 45; i += 1) {
        expect(text).toContain(`FAQDETAIL${String(i).padStart(2, '0')}`);
      }
      expect(pageCount(rendered)).toBeGreaterThan(3);
      // No FAQ body word may enter the reserved footer area of any page.
      const footerTop =
        style === 'classic' ? PDF_PAGE_HEIGHT - PDF_BOTTOM_MARGIN - PDF_FOOTER_HEIGHT : 756; // stylish BODY_BOTTOM
      const offender = wordBoxes(rendered).find(
        (word) =>
          word.text.startsWith('FAQDETAIL') &&
          word.yBottomFromTop > footerTop &&
          !/^(Page|\d+\/\d+)$/.test(word.text.trim()),
      );
      expect(offender).toBeUndefined();
    }
  });

  it('keeps a very long expert introduction paginated and out of the footer zone', async () => {
    const sentence =
      'I personally double-check every booking detail, transfer timing and hotel allocation. ';
    const longIntro = `<p>${Array.from(
      { length: 90 },
      (_, i) => `EXPERTDETAIL${String(i + 1).padStart(2, '0')} ${sentence}`,
    ).join('')}</p>`;
    const input = expertTestInput({
      destinationExpert: { ...expertFixture, customIntroduction: longIntro },
      includeExpertKey: true,
      faqs: faqFixture,
    });
    for (const [style, rendered] of [
      ['classic', await renderQuotationPdf(input)],
      ['stylish', await renderStylishQuotationPdf(input)],
    ] as const) {
      const text = pdfText(rendered);
      for (let i = 1; i <= 90; i += 1) {
        expect(text).toContain(`EXPERTDETAIL${String(i).padStart(2, '0')}`);
      }
      const footerTop =
        style === 'classic' ? PDF_PAGE_HEIGHT - PDF_BOTTOM_MARGIN - PDF_FOOTER_HEIGHT : 756; // stylish BODY_BOTTOM
      const offender = wordBoxes(rendered).find(
        (word) =>
          word.text.startsWith('EXPERTDETAIL') &&
          word.yBottomFromTop > footerTop &&
          !/^(Page|\d+\/\d+)$/.test(word.text.trim()),
      );
      expect(offender).toBeUndefined();
      // Thank You still closes the document.
      expect(pdfTextPage(rendered, pageCount(rendered))).toMatch(/THANK\s+YOU/i);
    }
  });

  it('renders older snapshots without expert/FAQ data without junk or extra pages', async () => {
    // Neither key present at all — exactly what pre-feature snapshots look like.
    const input = expertTestInput({});
    for (const rendered of [
      await renderQuotationPdf(input),
      await renderStylishQuotationPdf(input),
    ]) {
      const text = pdfText(rendered);
      expect(isPdf(rendered)).toBe(true);
      expect(text.toLowerCase()).not.toContain('destination expert');
      expect(text.toLowerCase()).not.toContain('frequently asked questions');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
      // No trailing blank page: the last physical page carries the Thank You.
      const pages = pageWordBoxes(rendered);
      expect(pages.length).toBe(pageCount(rendered));
      expect(pdfTextPage(rendered, pages.length)).toMatch(/THANK\s+YOU/i);
      expect(pages[pages.length - 1]!.words.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Section reorder — ONE shared saved order (the quotation's weblinkSectionOrder)
// drives BOTH PDF styles. No custom order → the legacy PDF layout is kept.
// =============================================================================

const reorderHotel = {
  city: 'Kuala Lumpur',
  hotelName: 'Reorder Grand Hotel',
  category: '5 Star',
  roomType: 'Deluxe',
  mealPlan: 'Breakfast',
  rooms: 1,
  nights: 2,
  selected: true,
  notes: null,
};

const reorderFlightDetails = {
  include: true,
  journeyType: 'ONEWAY_OUTBOUND',
  outbound: {
    fromCity: 'Mumbai Airport',
    toCity: 'Kuala Lumpur Airport',
    segments: [
      {
        airlineName: 'FlyFast Airways',
        from: 'Mumbai',
        to: 'Kuala Lumpur',
        departureDate: '2027-02-01',
        departureTime: '09:00',
        arrivalDate: '2027-02-01',
        arrivalTime: '16:00',
        duration: '6h 30m',
      },
    ],
  },
  returnJourney: { segments: [] },
};

/** Full input with every reorderable section present, in a saved order or not. */
function reorderInput(weblinkSectionOrder: unknown) {
  return {
    company: footerEmptyCompanyForOverlap(),
    quotation: quotationOverlap(),
    version: {
      ...baseVersionOverlap(),
      flightDetails: reorderFlightDetails,
      hotels: [reorderHotel],
      sightseeingDetails: {
        include: true,
        days: [
          {
            dayNumber: 1,
            title: 'Arrival Day Reorder',
            city: 'Kuala Lumpur',
            meals: { breakfast: false, lunch: false, dinner: false },
            activities: [
              {
                name: 'City Orientation Drive Reorder',
                description: '<p>Panoramic city orientation drive.</p>',
              },
            ],
          },
        ],
      },
      inclusionsHtml: '<ul><li>DepositProtectionMarker for policies</li></ul>',
      faqs: faqFixture,
      ...(Array.isArray(weblinkSectionOrder) || weblinkSectionOrder === null
        ? { weblinkSectionOrder }
        : {}),
    },
    images: { cover: PNG_1PX },
    destinationExpert: expertFixture,
  } as unknown as Parameters<typeof renderStylishQuotationPdf>[0];
}

describe('PDF section reorder (single shared weblink order)', () => {
  it('follows one custom order in both PDF styles', async () => {
    // Deliberately reversed relative to the legacy layout.
    const savedOrder = [
      'faqs',
      'destinationExpert',
      'policies',
      'hotels',
      'itinerary',
      'flights',
      'transportation',
      'cruise',
      'services',
      'addons',
      'visa',
    ];
    const input = reorderInput(savedOrder);
    for (const rendered of [
      await renderQuotationPdf(input),
      await renderStylishQuotationPdf(input),
    ]) {
      const lower = pdfText(rendered).toLowerCase();
      expect(lower).toContain('frequently asked questions');
      expect(lower).toContain('tisha menon');
      expect(lower).toContain('depositprotectionmarker');
      expect(lower).toContain('reorder grand hotel');
      expect(lower).toContain('panoramic city orientation drive');
      expect(lower).toContain('flyfast airways');
      const faqAt = lower.indexOf('frequently asked questions');
      const expertAt = lower.indexOf('tisha menon');
      const policiesAt = lower.indexOf('depositprotectionmarker');
      const hotelsAt = lower.indexOf('reorder grand hotel');
      const itineraryAt = lower.indexOf('panoramic city orientation drive');
      const flightsAt = lower.indexOf('flyfast airways');
      expect(faqAt).toBeGreaterThanOrEqual(0);
      expect(expertAt).toBeGreaterThan(faqAt);
      expect(policiesAt).toBeGreaterThan(expertAt);
      expect(hotelsAt).toBeGreaterThan(policiesAt);
      expect(itineraryAt).toBeGreaterThan(hotelsAt);
      expect(flightsAt).toBeGreaterThan(itineraryAt);
      // Thank You still closes the document.
      expect(pdfTextPage(rendered, pageCount(rendered))).toMatch(/THANK\s+YOU/i);
    }
  });

  it('keeps the legacy layout when no custom order is saved', async () => {
    const absent = reorderInput(undefined); // key omitted entirely (old snapshots)
    const empty = reorderInput(null); // normalized null on newer rows
    for (const input of [absent, empty]) {
      for (const rendered of [
        await renderQuotationPdf(input),
        await renderStylishQuotationPdf(input),
      ]) {
        const lower = pdfText(rendered).toLowerCase();
        const flightsAt = lower.indexOf('flyfast airways');
        const hotelsAt = lower.indexOf('reorder grand hotel');
        const itineraryAt = lower.indexOf('panoramic city orientation drive');
        const policiesAt = lower.indexOf('depositprotectionmarker');
        const faqAt = lower.indexOf('frequently asked questions');
        expect(flightsAt).toBeGreaterThanOrEqual(0);
        expect(hotelsAt).toBeGreaterThan(flightsAt);
        expect(itineraryAt).toBeGreaterThan(hotelsAt);
        expect(policiesAt).toBeGreaterThan(itineraryAt);
        expect(faqAt).toBeGreaterThan(policiesAt);
        expect(pdfTextPage(rendered, pageCount(rendered))).toMatch(/THANK\s+YOU/i);
      }
    }
  });

  it('falls back safely when the saved order contains unknown values', async () => {
    const input = reorderInput(['bogus-section', 42, null, '   ', 'faqs']);
    for (const rendered of [
      await renderQuotationPdf(input),
      await renderStylishQuotationPdf(input),
    ]) {
      const lower = pdfText(rendered).toLowerCase();
      // Known id honoured; unknown/garbage dropped; remaining ids appended so
      // no section ever disappears.
      const faqAt = lower.indexOf('frequently asked questions');
      const flightsAt = lower.indexOf('flyfast airways');
      expect(faqAt).toBeGreaterThanOrEqual(0);
      expect(flightsAt).toBeGreaterThan(faqAt);
      expect(lower).toContain('reorder grand hotel');
      expect(lower).toContain('panoramic city orientation drive');
      expect(lower).toContain('depositprotectionmarker');
    }
  });
});

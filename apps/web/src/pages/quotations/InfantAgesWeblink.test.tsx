import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { PublicQuotationPage } from './PublicQuotationPage';

function publicQuotation(ages: {
  infants?: number;
  infantAges?: number[] | null;
  childrenWithBed?: number;
  childrenWithBedAges?: number[] | null;
  childrenWithoutBed?: number;
  childrenWithoutBedAges?: number[] | null;
}) {
  return {
    company: {
      name: 'Alpha Travel',
      email: 'hello@alpha.test',
      phone: '919876543210',
      website: null,
      address: null,
      primaryColor: '#2563eb',
      operatingSince: 2015,
      tripsSold: 4200,
      tan: 'ABCD12345E',
      taxRegistrationNumber: '29ABCDE1234F1Z5',
      logoUrl: null,
    },
    quotation: {
      quotationNumber: 'QT-2026-000001',
      customerName: 'Aarav Mehta',
      destinationSummary: 'Goa',
      travelStartDate: null,
      travelEndDate: null,
      adults: 2,
      childrenWithBed: ages.childrenWithBed ?? 0,
      childrenWithoutBed: ages.childrenWithoutBed ?? 0,
      infants: ages.infants ?? 0,
      rooms: 1,
      childrenWithBedAges: ages.childrenWithBedAges ?? null,
      childrenWithoutBedAges: ages.childrenWithoutBedAges ?? null,
      infantAges: ages.infantAges ?? null,
      validUntil: null,
      createdAt: '2026-08-04T10:00:00.000Z',
      status: 'VIEWED',
    },
    version: {
      title: 'Goa proposal',
      versionNumber: 1,
      currency: 'INR',
      finalAmount: '19000',
      pricingMode: 'SECTION_WISE',
      flightDetails: null,
      hotelDetails: null,
      hotels: [],
      services: [],
      itinerary: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      inclusionsHtml: null,
      exclusionsHtml: null,
      paymentPolicies: null,
      cancellationPolicies: null,
      bookingTerms: null,
      childPolicy: null,
      pricingHeading: 'Price Breakdown',
      pricingSubheading: null,
      pricingDisplayOrder: null,
      createdAt: '2026-08-04T10:00:00.000Z',
      status: 'VIEWED',
    } as unknown as Record<string, unknown>,
    heroImageUrl: null,
  };
}

function mockFetch(ages: Parameters<typeof publicQuotation>[0]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public/quotations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: publicQuotation(ages) }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, data: {} }),
    } as unknown as Response;
  });
}

function renderWeblink() {
  renderWithProviders(
    <Routes>
      <Route path="/q/:token" element={<PublicQuotationPage />} />
    </Routes>,
    { route: '/q/test-token-infant' },
  );
}

describe('Infant Ages - Weblink', () => {
  it('shows a single infant age explicitly in months', async () => {
    vi.stubGlobal('fetch', mockFetch({ infants: 1, infantAges: [8] }));
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.getAllByText('Infant Ages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8 months').length).toBeGreaterThan(0);
  });

  it('shows every infant age with month units', async () => {
    vi.stubGlobal('fetch', mockFetch({ infants: 2, infantAges: [8, 10] }));
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.getAllByText('8 months, 10 months').length).toBeGreaterThan(0);
  });

  it('omits the Infant Ages line when ages are missing', async () => {
    vi.stubGlobal('fetch', mockFetch({ infants: 1, infantAges: null }));
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.queryByText('Infant Ages')).not.toBeInTheDocument();
  });

  it('shows CWB ages with explicit year units (singular/plural)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ infants: 1, infantAges: [8], childrenWithBed: 1, childrenWithBedAges: [8, 10] }),
    );
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.getAllByText('CWB Ages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8 years, 10 years').length).toBeGreaterThan(0);
    expect(screen.getAllByText('8 months').length).toBeGreaterThan(0);
  });

  it('uses the singular year for age 1', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ childrenWithBed: 2, childrenWithBedAges: [1, 2] }),
    );
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.getAllByText('1 year, 2 years').length).toBeGreaterThan(0);
  });

  it('shows CWOB ages with explicit year units', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ childrenWithoutBed: 3, childrenWithoutBedAges: [1, 2, 4] }),
    );
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.getAllByText('CWOB Ages').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 year, 2 years, 4 years').length).toBeGreaterThan(0);
  });

  it('omits the CWB Ages line when ages are missing', async () => {
    vi.stubGlobal('fetch', mockFetch({ childrenWithBed: 1, childrenWithBedAges: null }));
    renderWeblink();
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.queryByText('CWB Ages')).not.toBeInTheDocument();
  });
});

describe('formatChildAgeListYears', () => {
  it('formats singular/plural, preserves order, and skips invalid values', async () => {
    const { formatChildAgeListYears } = await import('./PublicQuotationPage');
    expect(formatChildAgeListYears([3, 2])).toBe('3 years, 2 years');
    expect(formatChildAgeListYears([1])).toBe('1 year');
    expect(formatChildAgeListYears([1, 2, 4])).toBe('1 year, 2 years, 4 years');
    expect(formatChildAgeListYears([8, null, 10])).toBe('8 years, 10 years');
    expect(formatChildAgeListYears(null)).toBeNull();
    expect(formatChildAgeListYears([])).toBeNull();
    expect(formatChildAgeListYears([null, undefined, ''])).toBeNull();
  });
});

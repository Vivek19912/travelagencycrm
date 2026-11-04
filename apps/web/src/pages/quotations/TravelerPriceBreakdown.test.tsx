import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { resolveQuotationPricing } from '@interscale/shared';
import { PublicQuotationPage } from './PublicQuotationPage';

const publicQuotation = (
  versionOverrides: Record<string, unknown> = {},
  quotationOverrides: Record<string, unknown> = {},
) => ({
  company: {
    name: 'Alpha Travel',
    email: 'hello@alpha.test',
    phone: '+91 90000 00001',
    website: null,
    address: null,
    primaryColor: '#2563eb',
    logoUrl: null,
  },
  quotation: {
    quotationNumber: 'QT-2026-000001',
    customerName: 'Aarav Mehta',
    destinationSummary: 'Goa',
    travelStartDate: null,
    travelEndDate: null,
    adults: 3,
    childrenWithBed: 2,
    childrenWithoutBed: 2,
    infants: 0,
    rooms: 1,
    createdAt: '2026-08-04T10:00:00.000Z',
    ...quotationOverrides,
  },
  version: {
    title: 'Goa proposal',
    versionNumber: 1,
    currency: 'INR',
    finalAmount: '0',
    pricingMode: 'PER_PERSON',
    perAdultPrice: '100',
    perChildWithBedPrice: '200',
    perChildWithoutBedPrice: '300',
    perInfantPrice: '500',
    discountAmount: '0',
    taxRate: '0',
    taxNote: null,
    initialPaymentAmount: '0',
    paymentLink: null,
    flightDetails: null,
    hotelDetails: null,
    hotels: [],
    services: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    terms: [],
    addOnDetails: { include: true },
    sightseeingDetails: { include: true, days: [] },
    pricingHeading: 'Price Breakdown',
    pricingSubheading: null,
    createdAt: '2026-08-04T10:00:00.000Z',
    status: 'VIEWED',
    ...versionOverrides,
  },
  heroImageUrl: null,
});

function mockFetch(payload: unknown) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/public/quotations')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, data: payload }),
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

function renderWeblink(payload: unknown, token = 'token-breakdown') {
  vi.stubGlobal('fetch', mockFetch(payload));
  renderWithProviders(
    <Routes>
      <Route path="/q/:token" element={<PublicQuotationPage />} />
    </Routes>,
    { route: `/q/${token}` },
  );
}

const breakdownSection = () => screen.getByTestId('traveler-price-breakdown');

describe('Public weblink — By Traveler package price breakdown', () => {
  it('shows the existing total card AND the new breakdown with per-category subtotals', async () => {
    const payload = publicQuotation();
    renderWeblink(payload);
    await screen.findByText('Custom Package for Aarav Mehta');

    // Existing total card stays exactly as before.
    expect(screen.getByText('Total Package Price', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contact Now/ })).toBeInTheDocument();

    // New additive breakdown.
    expect(
      screen.getByRole('heading', { name: 'Price Breakdown' }),
    ).toBeInTheDocument();
    const section = breakdownSection();
    expect(within(section).getByText('Adults')).toBeInTheDocument();
    expect(within(section).getByText('Child With Bed (CWB)')).toBeInTheDocument();
    expect(within(section).getByText('Child Without Bed (CWOB)')).toBeInTheDocument();

    // qty × rate lines.
    expect(within(section).getByText('3 × ₹100')).toBeInTheDocument();
    expect(within(section).getByText('2 × ₹200')).toBeInTheDocument();
    expect(within(section).getByText('2 × ₹300')).toBeInTheDocument();
    // Per-category subtotals: 3×100=300, 2×200=400, 2×300=600.
    expect(within(section).getByText('₹300')).toBeInTheDocument();
    expect(within(section).getByText('₹400')).toBeInTheDocument();
    expect(within(section).getByText('₹600')).toBeInTheDocument();
    // With no discount/tax the subtotal equals the total, so it is not shown a
    // second time; only the prominent total line carries the amount.
    expect(within(section).queryByText('Package subtotal')).not.toBeInTheDocument();
    expect(within(section).getByText('Total Package Price')).toBeInTheDocument();
    expect(within(section).getAllByText('₹1,300').length).toBe(1);
  });

  it('matches the authoritative total from the shared pricing resolver', async () => {
    const payload = publicQuotation();
    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    // The shared engine is the single source of truth for the numbers.
    expect(pricing.pricingMode).toBe('PER_PERSON');
    expect(pricing.packageTotal).toBe(1300);
    expect(pricing.grandTotal).toBe(1300);

    renderWeblink(payload, 'token-authoritative');
    await screen.findByText('Custom Package for Aarav Mehta');
    // Total card and the breakdown's prominent total both show grandTotal.
    const card = screen.getByText('Total Package Price', { selector: 'p' }).closest('div');
    expect(within(card as HTMLElement).getByText('₹1,300')).toBeInTheDocument();
    expect(within(breakdownSection()).getByText('Total Package Price')).toBeInTheDocument();
  });

  it('omits zero-count categories and keeps only applicable rows', async () => {
    const payload = publicQuotation({}, { childrenWithoutBed: 0, infants: 0, childrenWithBed: 1 });
    renderWeblink(payload, 'token-zero-counts');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    expect(within(section).getByText('Adults')).toBeInTheDocument();
    expect(within(section).getByText('Child With Bed (CWB)')).toBeInTheDocument();
    // No CWOB and no Infants row when their count is zero.
    expect(within(section).queryByText('Child Without Bed (CWOB)')).not.toBeInTheDocument();
    expect(within(section).queryByText('Infants')).not.toBeInTheDocument();
    // 3×100 + 1×200 = 500.
    expect(within(section).getAllByText('₹500').length).toBeGreaterThanOrEqual(1);
  });

  it('includes infants when applicable', async () => {
    const payload = publicQuotation({}, { infants: 1, childrenWithoutBed: 0 });
    renderWeblink(payload, 'token-infants');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    expect(within(section).getByText('Infants')).toBeInTheDocument();
    expect(within(section).getByText('1 × ₹500')).toBeInTheDocument();
    // 3×100 + 2×200 + 1×500 = 1,200 — carried once, by the total line.
    expect(within(section).getAllByText('₹1,200').length).toBe(1);
  });

  it('formats every amount in the quotation currency', async () => {
    const payload = publicQuotation({ currency: 'EUR' });
    const money = (value: number) =>
      new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(value);
    renderWeblink(payload, 'token-currency');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    // Rate + subtotal + totals all use the quotation currency formatter.
    expect(within(section).getByText(`3 × ${money(100)}`)).toBeInTheDocument();
    expect(within(section).getByText(money(300))).toBeInTheDocument();
    expect(within(section).getAllByText(money(1300)).length).toBe(1);
    expect(money(1300)).not.toContain('₹');
  });

  it('applies discount and tax once without double-counting', async () => {
    const payload = publicQuotation({ discountAmount: '100', taxRate: '5' });
    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    // Subtotal 1,300 → −100 = 1,200 → +5% = 60 → 1,260 (pipeline applied once).
    expect(pricing.subtotal).toBe(1300);
    expect(pricing.taxAmount).toBe(60);
    expect(pricing.grandTotal).toBe(1260);

    renderWeblink(payload, 'token-adjustments');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    // With an adjustment the subtotal differs from the total, so it is shown.
    expect(within(section).getByText('Package subtotal')).toBeInTheDocument();
    expect(within(section).getAllByText('₹1,300').length).toBe(1);
    expect(within(section).getByText('Discount')).toBeInTheDocument();
    expect(within(section).getByText('-₹100')).toBeInTheDocument();
    expect(within(section).getByText('Tax (5%)')).toBeInTheDocument();
    expect(within(section).getByText('₹60')).toBeInTheDocument();
    expect(within(section).getByText('Total Package Price')).toBeInTheDocument();
    expect(within(section).getByText('₹1,260')).toBeInTheDocument();
  });

  it('does not render the traveler breakdown for By Section pricing', async () => {
    const payload = publicQuotation({
      pricingMode: 'SECTION_WISE',
      hotelDetails: { include: true, amount: '20000' },
    });
    renderWeblink(payload, 'token-section-wise');
    await screen.findByText('Custom Package for Aarav Mehta');
    // Section behavior is preserved: the section-wise card + total price show.
    expect(screen.queryByTestId('traveler-price-breakdown')).not.toBeInTheDocument();
    expect(screen.getByText('Quotation Total', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Price Breakdown')).toBeInTheDocument();
  });

  it('keeps the breakdown overflow-safe for narrow viewports', async () => {
    renderWeblink(publicQuotation(), 'token-mobile');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    // No fixed widths and no horizontal-scroll traps: the section clips any
    // stray overflow and every amount stays on one line next to its label,
    // which wraps freely — so nothing can push the page wider than the screen.
    expect(section.className).toContain('overflow-hidden');
    const amounts = [
      ...section.querySelectorAll('[data-testid="breakdown-amount"]'),
      ...section.querySelectorAll('[data-testid="breakdown-total-amount"]'),
    ];
    expect(amounts.length).toBeGreaterThan(0);
    for (const amount of amounts) {
      expect(amount.className).toContain('whitespace-nowrap');
    }
  });

  it('leaves the existing Contact Now and total-price card unchanged', async () => {
    renderWeblink(publicQuotation(), 'token-contact');
    await screen.findByText('Custom Package for Aarav Mehta');
    const contact = screen.getByRole('link', { name: /Contact Now/ });
    expect(contact).toHaveAttribute('href', 'tel:+91 90000 00001');
    const label = screen.getByText('Total Package Price', { selector: 'p' });
    const card = label.closest('div.bg-emerald-600');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText('₹1,300')).toBeInTheDocument();
  });

  it('renders Additional Price Items as their own fixed rows and adds them to the total', async () => {
    const payload = publicQuotation({
      packageCustomItems: [
        { label: 'Flight tickets', amount: 5000 },
        { label: 'Visa fees', amount: 3000 },
      ],
    });
    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    // Traveler subtotal 1,300 + 5,000 + 3,000 flat.
    expect(pricing.customItems.subtotal).toBe(8000);
    expect(pricing.packageTotal).toBe(9300);
    expect(pricing.grandTotal).toBe(9300);

    renderWeblink(payload, 'token-custom-items');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    expect(within(section).getByText('Flight tickets')).toBeInTheDocument();
    expect(within(section).getByText('Visa fees')).toBeInTheDocument();
    // Custom rows show only the label — no "Fixed amount" subtitle.
    expect(within(section).queryByText('Fixed amount')).not.toBeInTheDocument();
    expect(within(section).getByText('₹5,000')).toBeInTheDocument();
    expect(within(section).getByText('₹3,000')).toBeInTheDocument();
    expect(within(section).getAllByText('₹9,300').length).toBe(1);
  });

  it('renders the predefined Flight Charges and Visa Charges labels in the weblink', async () => {
    const payload = publicQuotation({
      packageCustomItems: [
        { label: 'Flight Charges', amount: 5000 },
        { label: 'Visa Charges', amount: 3000 },
      ],
    });
    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    expect(pricing.customItems.subtotal).toBe(8000);

    renderWeblink(payload, 'token-suggested-labels');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    expect(within(section).getByText('Flight Charges')).toBeInTheDocument();
    expect(within(section).getByText('Visa Charges')).toBeInTheDocument();
    expect(within(section).getByText('₹5,000')).toBeInTheDocument();
    expect(within(section).getByText('₹3,000')).toBeInTheDocument();
  });

  it('renders rows in the quotation’s saved pricingRowOrder', async () => {
    const payload = publicQuotation(
      { pricingRowOrder: ['infants', 'cwb', 'adults', 'cwob'] },
      { infants: 1 },
    );
    renderWeblink(payload, 'token-row-order');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    const labels = within(section)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('p')?.textContent);
    expect(labels).toEqual([
      'Infants',
      'Child With Bed (CWB)',
      'Adults',
      'Child Without Bed (CWOB)',
    ]);
  });

  it('applies the discount/tax pipeline once on the traveler + items subtotal', async () => {
    const payload = publicQuotation({
      packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
      discountAmount: '100',
      taxRate: '5',
    });
    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    // 1,300 + 5,000 = 6,300 → −100 = 6,200 → +5% = 310 → 6,510.
    expect(pricing.subtotal).toBe(6300);
    expect(pricing.taxAmount).toBe(310);
    expect(pricing.grandTotal).toBe(6510);

    renderWeblink(payload, 'token-custom-adjust');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    expect(within(section).getByText('Package subtotal')).toBeInTheDocument();
    expect(within(section).getByText('₹6,300')).toBeInTheDocument();
    expect(within(section).getByText('-₹100')).toBeInTheDocument();
    expect(within(section).getByText('₹310')).toBeInTheDocument();
    expect(within(section).getByText('₹6,510')).toBeInTheDocument();
  });

  it('renders the breakdown for a custom-items-only quotation (no traveler rates)', async () => {
    const payload = publicQuotation({
      perAdultPrice: '0',
      perChildWithBedPrice: '0',
      perChildWithoutBedPrice: '0',
      perInfantPrice: '0',
      packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
    });
    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    expect(pricing.travelerPricing.rows.length).toBe(0);
    expect(pricing.packageTotal).toBe(5000);

    renderWeblink(payload, 'token-custom-only');
    await screen.findByText('Custom Package for Aarav Mehta');
    const section = breakdownSection();
    expect(within(section).getByText('Flight tickets')).toBeInTheDocument();
    expect(within(section).queryByText('Fixed amount')).not.toBeInTheDocument();
    // The single item row and the headline total both carry ₹5,000.
    expect(within(section).getAllByText('₹5,000').length).toBe(2);
  });

  it('ignores Additional Price Items for By Section pricing', async () => {
    const payload = publicQuotation({
      pricingMode: 'SECTION_WISE',
      hotelDetails: { include: true, amount: '20000' },
      packageCustomItems: [{ label: 'Flight tickets', amount: 5000 }],
    });
    const pricing = resolveQuotationPricing({
      version: payload.version,
      quotation: payload.quotation,
    });
    // Items never leak into section-wise pricing.
    expect(pricing.customItems.subtotal).toBe(0);
    expect(pricing.sectionTotal).toBe(20000);

    renderWeblink(payload, 'token-section-custom');
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.queryByTestId('traveler-price-breakdown')).not.toBeInTheDocument();
    expect(screen.queryByText('Flight tickets')).not.toBeInTheDocument();
    expect(screen.getByText('Price Breakdown')).toBeInTheDocument();
  });
});

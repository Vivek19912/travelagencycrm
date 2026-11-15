import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const detail = () => ({
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  queryId: 'lead-1',
  currentVersionId: 'version-1',
  status: 'DRAFT',
  customerName: 'Aarav Mehta',
  customerEmail: 'aarav@example.test',
  customerPhone: '+91 90000 00000',
  destinationSummary: 'Goa',
  travelStartDate: null,
  travelEndDate: null,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  rooms: 1,
  validUntil: null,
  createdBy: person,
  query: {
    id: 'lead-1',
    queryNumber: 'QRY-1',
    leadStage: 'QUOTATION_SENT',
    assignedToId: 'user-1',
    createdById: 'user-1',
    services: [
      { serviceType: 'FLIGHT' },
      { serviceType: 'HOTEL' },
      { serviceType: 'SIGHTSEEING' },
      { serviceType: 'CRUISE' },
      { serviceType: 'VEHICLE_TRANSFER' },
    ],
  },
  versions: [
    {
      id: 'version-1',
      versionNumber: 1,
      title: 'Goa proposal',
      introduction: null,
      destinationSummary: 'Goa',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '0',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '0',
      pricingMode: 'PER_PERSON',
      perAdultPrice: '0',
      perChildWithBedPrice: '0',
      perChildWithoutBedPrice: '0',
      perInfantPrice: '0',
      taxNote: null,
      netAmount: '0',
      initialPaymentAmount: '0',
      paymentLink: null,
      status: 'DRAFT',
      finalizedAt: null,
      createdAt: '2026-07-21T00:00:00.000Z',
      createdBy: person,
      itinerary: [],
      hotels: [],
      services: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      addOnDetails: { include: true },
    },
  ],
  documents: [],
  emailLogs: [],
  activityTimeline: [],
});

function builderFetch(base: unknown) {
  const routes: Record<string, unknown> = {
    '/masters/hotels': { success: true, data: [], pagination: { total: 0 } },
    '/masters/airlines': { success: true, data: [], pagination: { total: 0 } },
    '/masters/cruises': { success: true, data: [], pagination: { total: 0 } },
    '/masters/vehicles': { success: true, data: [], pagination: { total: 0 } },
    '/masters/sightseeing': { success: true, data: [], pagination: { total: 0 } },
    '/masters/sightseeing/activities': { success: true, data: [], pagination: { total: 0 } },
    '/masters/add-on-services': { success: true, data: [], pagination: { total: 0 } },
    '/masters/faqs': { success: true, data: [], pagination: { total: 0 } },
    '/users': { success: true, data: [], pagination: { total: 0 } },
    '/settings': {
      success: true,
      data: { profile: { phone: null, email: 'a@b.test' }, quotationDefaults: {} },
    },
    '/destination-expert/presets': { success: true, data: [] },
  };
  return vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    void options;
    const url = String(input);
    for (const [prefix, body] of Object.entries(routes).sort(([a], [b]) => b.length - a.length))
      if (url.includes(prefix)) return response(body);
    return response(base);
  });
}

const renderBuilder = () =>
  renderWithProviders(
    <Routes>
      <Route
        path="/quotations/:quotationId/versions/:versionId/edit"
        element={<QuotationBuilderPage />}
      />
    </Routes>,
    { route: '/quotations/quotation-1/versions/version-1/edit' },
  );

const tabButton = (name: string) => screen.getByRole('button', { name });
const underlineOf = (button: HTMLElement) =>
  button.querySelector('span[aria-hidden="true"]');

describe('Quotation Builder sub-tab styling', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('active tab uses blue text and a blue underline with no background fill', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const active = tabButton('Flight');
    // Blue label, transparent background (no pill/fill). Class-level: jsdom
    // does not resolve Tailwind utilities into computed styles.
    expect(active.className).toContain('text-brand-600');
    expect(active.className).toContain('bg-transparent');
    expect(active.className).not.toContain('bg-brand-50');
    // 3px rounded blue underline aligned to the tab width.
    const underline = underlineOf(active);
    expect(underline).not.toBeNull();
    expect(underline!.className).toContain('bg-brand-600');
    expect(underline!.className).toContain('h-[3px]');
    expect(underline!.className).toContain('rounded-full');
    expect(underline!.className).toContain('inset-x-0');
  });

  it('inactive tabs are transparent with no underline by default', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    for (const name of ['Hotel', 'Pricing', 'Settings']) {
      const button = tabButton(name);
      expect(button.className).toContain('bg-transparent');
      expect(button.className).toContain('text-slate-600');
      expect(underlineOf(button)).toBeNull();
    }
  });

  it('hover only tints the background without moving or resizing tabs', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const button = tabButton('Hotel');
    // Subtle neutral hover background, no transform/scale/translate utilities.
    expect(button.className).toContain('hover:bg-slate-50');
    const layoutChanging = [
      'hover:scale',
      'hover:translate',
      'hover:-translate',
      'hover:rotate',
      'transition-transform',
      'transform',
      'hover:bg-brand',
    ];
    for (const cls of layoutChanging) expect(button.className).not.toContain(cls);
    expect(button.className).toContain('transition-colors');
    // Hovering never adds an underline to an inactive tab.
    expect(underlineOf(button)).toBeNull();
  });

  it('keeps red required asterisks on lead-requested tabs', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    for (const name of ['Flight', 'Hotel', 'Sightseeing', 'Cruise', 'Vehicle']) {
      const asterisk = tabButton(name).querySelector('span.text-red-500');
      expect(asterisk?.textContent).toBe('*');
    }
    expect(tabButton('Pricing').querySelector('span.text-red-500')).toBeNull();
  });

  it('switching tabs moves the underline and preserves form values', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(tabButton('Hotel'));
    // Underline follows the newly active tab.
    expect(underlineOf(tabButton('Hotel'))).not.toBeNull();
    expect(tabButton('Hotel').className).toContain('text-brand-600');
    expect(underlineOf(tabButton('Flight'))).toBeNull();
    // Form state survives tab switches (hidden title value intact).
    expect(screen.getByDisplayValue('Goa proposal')).toBeInTheDocument();
    await userEvent.click(tabButton('Flight'));
    expect(underlineOf(tabButton('Flight'))).not.toBeNull();
    expect(screen.getByDisplayValue('Goa proposal')).toBeInTheDocument();
  });

  it('keeps a single-row scrollable tab bar without wrapping', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const bar = tabButton('Flight').parentElement!;
    expect(bar.className).toContain('overflow-x-auto');
    expect(tabButton('Hotel').className).toContain('whitespace-nowrap');
    // All expected labels render in the approved order in one row.
    const labels = Array.from(bar.querySelectorAll('button')).map((b) =>
      (b.getAttribute('aria-label') ?? '').replace(/\*$/, ''),
    );
    expect(labels).toEqual([
      'Sightseeing',
      'Hotel',
      'Cruise',
      'Vehicle',
      'Flight',
      'Add-on Services',
      'Inclusions & Exclusions',
      'Pricing',
      'Settings',
    ]);
  });

  it('renders a restrained card container with separators between tabs', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    const { container } = renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const bar = tabButton('Flight').parentElement!;
    // Full-width white container: neutral border, rounded corners, no shadow.
    const card = bar.parentElement!;
    expect(card.className).toContain('rounded-xl');
    expect(card.className).toContain('border');
    expect(card.className).toContain('bg-card');
    expect(card.className).not.toContain('shadow');
    // Thin light-gray vertical dividers between adjacent tabs only.
    const buttons = Array.from(bar.querySelectorAll(':scope > button'));
    const separators = Array.from(
      bar.querySelectorAll(':scope > span[aria-hidden="true"]'),
    );
    expect(buttons.length).toBeGreaterThan(1);
    expect(separators).toHaveLength(buttons.length - 1);
    for (const separator of separators) {
      expect(separator.className).toContain('w-px');
      expect(separator.className).toContain('h-6');
    }
    // Separators are layout-stable: none appear inside tab buttons.
    expect(container.querySelectorAll('button span.w-px')).toHaveLength(0);
  });

  it('hides edge arrows when the strip fits and shows them on overflow', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // No overflow in the test viewport: no arrows.
    expect(screen.queryByRole('button', { name: 'Scroll tabs left' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scroll tabs right' })).toBeNull();

    // Simulate an overflowing strip, scrolled to the start.
    const bar = tabButton('Flight').parentElement as HTMLElement;
    Object.defineProperty(bar, 'scrollWidth', { value: 1200, configurable: true });
    Object.defineProperty(bar, 'clientWidth', { value: 600, configurable: true });
    Object.defineProperty(bar, 'scrollLeft', { value: 0, configurable: true, writable: true });
    bar.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(
      await screen.findByRole('button', { name: 'Scroll tabs right' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Scroll tabs left' })).toBeNull();

    // Right arrow scrolls the strip; left arrow appears once scrolled.
    const scrolled = vi.fn();
    (bar as unknown as { scrollBy: unknown }).scrollBy = scrolled;
    await userEvent.click(screen.getByRole('button', { name: 'Scroll tabs right' }));
    expect(scrolled).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.any(Number) }),
    );
  });

  it('removes Visa and Destination Expert from the Weblink Section Order editor', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(tabButton('Settings'));
    await userEvent.click(screen.getByRole('button', { name: /Weblink Section Order/i }));

    const panel = document.getElementById('weblink-section-order-panel') as HTMLElement;
    const order = () =>
      Array.from(panel.querySelectorAll('button[aria-label$=" up"]')).map((el) =>
        el.getAttribute('aria-label')!.replace(/^Move /, '').replace(/ up$/, ''),
      );
    const defaultVisible = [
      'services',
      'itinerary',
      'hotels',
      'flights',
      'transportation',
      'cruise',
      'addons',
      'policies',
      'faqs',
    ];

    // Count and listed rows exclude the two hidden sections.
    expect(screen.getByText('9 sections')).toBeInTheDocument();
    expect(order()).toEqual(defaultVisible);
    for (const hidden of ['visa', 'destinationExpert']) {
      expect(screen.queryByRole('button', { name: `Move ${hidden} up` })).toBeNull();
      expect(screen.queryByRole('button', { name: `Move ${hidden} down` })).toBeNull();
    }

    // Up/Down still reorder the remaining sections (bounds use visible rows).
    expect(screen.getByRole('button', { name: 'Move services up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move faqs down' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move hotels up' }));
    expect(order()).toEqual([
      'services',
      'hotels',
      'itinerary',
      'flights',
      'transportation',
      'cruise',
      'addons',
      'policies',
      'faqs',
    ]);

    // Resetting restores the default order without bringing them back.
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default order' }));
    expect(order()).toEqual(defaultVisible);
    expect(screen.queryByRole('button', { name: 'Move visa up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move destinationExpert up' })).toBeNull();
  });
});

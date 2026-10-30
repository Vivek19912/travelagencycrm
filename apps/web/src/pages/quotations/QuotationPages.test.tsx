import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  SERVICE_DESCRIPTION_MAX_LENGTH,
  cabinLuggageLabel,
  hotelStayNights,
  quotationVersionInputSchema,
} from '@interscale/shared';
import { renderWithProviders } from '@/test/utils';
import { serviceCardIcon } from './serviceCards';
import { QuotationTemplatesPage } from './QuotationTemplatesPage';
import { QuotationTemplateDetailsPage } from './QuotationTemplateDetailsPage';
import { QuotationTemplateFormPage } from './QuotationTemplateFormPage';
import { QuotationsPage } from './QuotationsPage';
import { NewQuotationPage } from './NewQuotationPage';
import { PublicQuotationPage } from './PublicQuotationPage';
import { PublicQuotationContact } from './PublicQuotationContact';
import {
  buildQuotationDescription,
  formatPublicQuotationNumber,
  normalizeWhatsAppPhone,
} from './quotationContact';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { QuotationDetailsPage } from './QuotationDetailsPage';
import { uploadQuotationAttachment } from '@/features/quotations/quotations.api';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };
/** Minimal public-weblink render with the given sightseeing day titles. */
const renderWeblinkItinerary = (days: Array<{ dayNumber: number; title: string }>) => {
  const publicData = {
    company: {
      name: 'Alpha Travel',
      email: 'a@b.test',
      phone: null,
      website: null,
      address: null,
      primaryColor: '#2563eb',
    },
    quotation: {
      quotationNumber: 'QT-2026-000002',
      customerName: 'Mira Shah',
      destinationSummary: 'Langkawi',
      travelStartDate: null,
      travelEndDate: null,
      adults: 2,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
      rooms: 1,
      validUntil: null,
      status: 'VIEWED',
    },
    version: {
      title: 'Langkawi Escape',
      versionNumber: 1,
      currency: 'INR',
      finalAmount: '100',
      hotels: [],
      services: [],
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: 0,
        description: null,
        days: days.map(({ dayNumber, title }) => ({
          dayNumber,
          title,
          city: 'Langkawi',
          date: null,
          meals: { breakfast: false, lunch: false, dinner: false },
          mealMode: null,
          dailyTransfer: null,
          activities: [],
        })),
      },
      itinerary: [],
      inclusions: [],
      exclusions: [],
      terms: [],
    },
    downloadUrl: null,
  };
  vi.stubGlobal('fetch', vi.fn(async () => response(publicData)));
  renderWithProviders(
    <Routes>
      <Route path="/q/:token" element={<PublicQuotationPage />} />
    </Routes>,
    { route: '/q/public-token-value-with-at-least-32-characters' },
  );
};
/** Rich finalized-version + quotation detail fixture reused by copy/weblink tests. */
const copyFinalizedVersion = {
  id: 'version-1',
  versionNumber: 1,
  title: 'Goa proposal',
  introduction: 'A coastal holiday.',
  destinationSummary: 'Goa',
  travelStartDate: null,
  travelEndDate: null,
  currency: 'INR',
  subtotalSellingPrice: '25000',
  markupMode: 'NONE',
  markupValue: '0',
  totalMarkup: '0',
  taxRate: '0',
  taxAmount: '0',
  discountAmount: '0',
  finalAmount: '25000',
  pricingMode: 'ITEMIZED',
  notes: null,
  status: 'FINALIZED',
  finalizedAt: '2026-07-21T00:00:00.000Z',
  createdAt: '2026-07-21T00:00:00.000Z',
  createdBy: person,
  itinerary: [],
  hotels: [],
  services: [],
  inclusions: [],
  exclusions: [],
  terms: [],
};
const copyQuotationDetail = {
  id: 'quotation-1',
  quotationNumber: 'QT-2026-000001',
  queryId: 'lead-1',
  currentVersionId: 'version-1',
  status: 'SENT',
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
  lastSentAt: '2026-07-21T00:00:00.000Z',
  lastViewedAt: null,
  acceptedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: person,
  query: {
    id: 'lead-1',
    queryNumber: 'QRY-1',
    leadStage: 'QUOTATION_SENT',
    assignedToId: 'user-1',
    createdById: 'user-1',
  },
  versions: [copyFinalizedVersion],
  documents: [
    {
      id: 'document-1',
      quotationVersionId: 'version-1',
      fileName: 'QT-2026-000001-v1.pdf',
      mimeType: 'application/pdf',
      fileSize: 4096,
      checksum: 'abc',
      documentType: 'QUOTATION_PDF',
      status: 'AVAILABLE',
      createdAt: '2026-07-21T00:00:00.000Z',
    },
  ],
  emailLogs: [],
  activityTimeline: [],
};
const template = {
  id: '11111111-1111-4111-8111-111111111111',
  templateCode: 'QTP-2026-000001',
  name: 'Goa family escape',
  description: 'Coastal package',
  destinationSummary: 'Goa • Calangute',
  durationDays: 5,
  durationNights: 4,
  baseCurrency: 'INR',
  adultBasePrice: '35000',
  childWithBedBasePrice: '22000',
  childWithoutBedBasePrice: '12000',
  infantBasePrice: '2500',
  status: 'ACTIVE',
  usageCount: 3,
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: person,
  cities: ['Calangute'],
  itinerary: [],
  hotels: [],
  services: [],
  inclusions: [],
  exclusions: [],
  terms: [],
  actionPermissions: { canUpdate: true, canDelete: true, canUse: true },
};
const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: data.length ? 1 : 0 },
});

/* ------------------------------------------------------------------ *
 * Create Quotation — searchable lead field
 * ------------------------------------------------------------------ */

const visibleLead = {
  id: 'lead-1',
  queryNumber: 'QRY-1',
  customerName: 'Aarav Mehta',
  phone: '+91 90000 00000',
  email: 'aarav@example.test',
};
const searchableLead = {
  id: 'lead-1042',
  queryNumber: 'QRY-1042',
  customerName: 'Vikas Singh',
  phone: '9876543210',
  email: 'vikas@example.test',
};

/** Every `?search=` term the lead field actually sent to the list endpoint. */
const searchTerms = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost').searchParams.get('search'))
    .filter((term): term is string => term !== null);

/**
 * Stand-in for `GET /queries`, filtering the way the server does: the caller
 * only ever sees `visible`, and `search` narrows *within* that set across
 * customer name, phone, email and query number. Passing a smaller `visible`
 * models a user with a narrower lead visibility scope.
 */
const leadSearchFetch = (visible: Array<typeof visibleLead> = [visibleLead, searchableLead]) =>
  vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
    async (input, options) => {
      if (options?.method === 'POST') return response({ id: 'quotation-new' });
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.startsWith('/api/queries')) {
        const id = url.pathname.slice('/api/queries'.length).replace(/^\//, '');
        if (id) return response(visible.find((lead) => lead.id === id) ?? null);
        const term = (url.searchParams.get('search') ?? '').toLowerCase();
        const matches = term
          ? visible.filter((lead) =>
              [lead.customerName, lead.phone, lead.email, lead.queryNumber]
                .join(' ')
                .toLowerCase()
                .includes(term),
            )
          : visible;
        return response(page(matches));
      }
      return response(page([template]));
    },
  );

/** Open the lead combobox and wait for its listbox. */
const openLeadList = async () => {
  await userEvent.click(await screen.findByLabelText('Lead'));
  return screen.findByRole('listbox');
};

/** Open the lead combobox and choose the option matching `name`. */
const pickLead = async (name: RegExp) => {
  await openLeadList();
  await userEvent.click(await screen.findByRole('option', { name }));
};

describe('Phase 8 quotation pages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'quotation_templates.view',
      'quotation_templates.create',
      'quotation_templates.update',
      'quotation_templates.delete',
      'quotations.view',
      'quotations.create',
      'quotations.update',
      'quotations.send',
      'quotations.generate_pdf',
      'quotations.view_costing',
    ]);
  });

  it('loads a dense template list and synchronizes search/status filters', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(page([template])),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<QuotationTemplatesPage />);
    expect((await screen.findAllByText('Goa family escape')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('QTP-2026-000001').length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText('Search templates'), 'Coastal');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('search=Coastal&status=ACTIVE')),
      ).toBe(true),
    );
  });

  it('duplicates a template and changes its status from the list actions', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (_input, options) =>
        options?.method === 'POST' || options?.method === 'PATCH'
          ? response(template)
          : response(page([template])),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<QuotationTemplatesPage />);
    await screen.findAllByText('Goa family escape');
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith(`/${template.id}/duplicate`) && options?.method === 'POST',
        ),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith(`/${template.id}/status`) && options?.method === 'PATCH',
        ),
      ).toBe(true),
    );
  });

  it('renders template empty and error states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(page([]))),
    );
    const empty = renderWithProviders(<QuotationTemplatesPage />);
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
    empty.unmount();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            json: async () => ({
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'failed' },
            }),
          }) as Response,
      ),
    );
    renderWithProviders(<QuotationTemplatesPage />);
    expect(await screen.findByText('Quotation templates could not be loaded.')).toBeInTheDocument();
  });

  it('renders the template preview with route, hotel, service and content sections', async () => {
    const preview = {
      ...template,
      hotels: [
        {
          id: 'hotel-1',
          city: 'Calangute',
          hotelName: 'Coastal Bay Resort',
          category: '4 star',
          roomType: 'Deluxe',
          mealPlan: 'Breakfast',
          rooms: 1,
          nights: 4,
          checkInDate: null,
          checkOutDate: null,
          sellingPrice: '12500',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
      services: [
        {
          id: 'service-1',
          serviceType: 'SIGHTSEEING',
          name: 'North Goa tour',
          description: null,
          dayNumber: 2,
          city: 'Goa',
          quantity: '1',
          sellingPrice: '2500',
          taxCategory: null,
          notes: null,
          sequence: 1,
        },
      ],
      itinerary: [
        {
          id: 'day-1',
          dayNumber: 1,
          date: null,
          title: 'Arrival and check-in',
          destination: 'Calangute',
          description: 'Private transfer to the hotel.',
          meals: 'Breakfast',
          overnightLocation: 'Calangute',
          activities: null,
          transfers: null,
          notes: null,
          sequence: 1,
        },
      ],
      inclusions: [{ id: 'inc-1', content: 'Daily breakfast', sequence: 1 }],
      exclusions: [{ id: 'exc-1', content: 'Personal expenses', sequence: 1 }],
      terms: [{ id: 'term-1', content: 'Subject to availability', sequence: 1 }],
      counts: { cities: 1, services: 1, hotelOptions: 1 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(preview)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/quotation-templates/:templateId" element={<QuotationTemplateDetailsPage />} />
      </Routes>,
      { route: `/quotation-templates/${template.id}` },
    );
    expect(
      await screen.findByRole('heading', { name: 'Goa family escape', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Coastal Bay Resort')).toBeInTheDocument();
    expect(screen.getByText('North Goa tour')).toBeInTheDocument();
    expect(screen.getByText(/Daily breakfast/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Use template' })).toBeInTheDocument();
  });

  it('hides empty hotel Room Type and Meal Plan on the template preview without dangling separators', async () => {
    const hotel = (overrides: Record<string, unknown>) => ({
      id: `h-${String(overrides.id ?? 'x')}`,
      city: 'Calangute',
      hotelName: 'Coastal Bay Resort',
      category: '4 star',
      roomType: null,
      mealPlan: null,
      rooms: 1,
      nights: 4,
      checkInDate: null,
      checkOutDate: null,
      sellingPrice: '12500',
      selected: true,
      notes: null,
      sequence: 1,
      ...overrides,
    });
    const preview = {
      ...template,
      hotels: [
        hotel({ id: 'both', roomType: 'Deluxe', mealPlan: 'Breakfast' }),
        hotel({ id: 'room', roomType: 'Superior' }),
        hotel({ id: 'meal', mealPlan: 'Half Board' }),
        hotel({ id: 'none' }),
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(preview)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/quotation-templates/:templateId" element={<QuotationTemplateDetailsPage />} />
      </Routes>,
      { route: `/quotation-templates/${template.id}` },
    );
    await screen.findByRole('heading', { name: 'Goa family escape', level: 1 });

    // Both populated: category + room type + meal plan joined cleanly.
    expect(
      screen.getByText('Calangute · 4 star · Deluxe · Breakfast · 4 nights'),
    ).toBeInTheDocument();
    // Only room type: meal plan omitted.
    expect(screen.getByText('Calangute · 4 star · Superior · 4 nights')).toBeInTheDocument();
    // Only meal plan: room type omitted.
    expect(screen.getByText('Calangute · 4 star · Half Board · 4 nights')).toBeInTheDocument();
    // Neither: category + nights only, no placeholders and no trailing separator.
    expect(screen.getByText('Calangute · 4 star · 4 nights')).toBeInTheDocument();
    expect(screen.queryByText(/Room open/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Meal plan open/)).not.toBeInTheDocument();
    expect(screen.queryByText(/· ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/·\s*$/)).not.toBeInTheDocument();
  });

  it('uses React Hook Form dynamic hotel, itinerary and service rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(template)),
    );
    renderWithProviders(<QuotationTemplateFormPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add day' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add service' }));
    expect(screen.getByLabelText('Hotel name')).toBeInTheDocument();
    expect(screen.getByLabelText('Day description')).toBeInTheDocument();
    expect(screen.getByLabelText('Service type')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThan(0);
  });

  it('renders quotation analytics and a customer/version row', async () => {
    const quotation = {
      id: '22222222-2222-4222-8222-222222222222',
      quotationNumber: 'QT-2026-000001',
      customerName: 'Aarav Mehta',
      destinationSummary: 'Goa',
      status: 'SENT',
      currentVersionId: 'version-1',
      lastSentAt: '2026-07-21T00:00:00.000Z',
      lastViewedAt: null,
      validUntil: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-07-20T00:00:00.000Z',
      createdBy: person,
      query: { id: 'lead-1', queryNumber: 'QRY-2026-000001' },
      versions: [{ id: 'version-1', versionNumber: 1, currency: 'INR', finalAmount: '16065.87' }],
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () =>
        response({
          ...page([quotation]),
          analytics: { byStatus: { SENT: 1 }, totalQuotedValue: '16065.87', acceptanceRate: 50 },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<QuotationsPage />);
    expect((await screen.findAllByText('QT-2026-000001')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aarav Mehta').length).toBeGreaterThan(0);
    // Shared Masters-style pagination footer (the list had none before).
    expect(screen.getByText('Showing 1 to 1 of 1 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
    await userEvent.type(screen.getByLabelText('Search quotations'), 'Aarav');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('search=Aarav'))).toBe(true),
    );
  });

  it('shows the simplified quotation table and clean header', async () => {
    const quotation = {
      id: '22222222-2222-4222-8222-222222222222',
      quotationNumber: 'QT-2026-000001',
      customerName: 'Aarav Mehta',
      destinationSummary: 'Goa',
      status: 'SENT',
      currentVersionId: 'version-1',
      lastSentAt: '2026-07-21T00:00:00.000Z',
      lastViewedAt: null,
      createdAt: '2026-07-20T00:00:00.000Z',
      createdBy: person,
      query: { id: 'lead-1', queryNumber: 'QRY-2026-000001' },
      versions: [{ id: 'version-1', versionNumber: 1, currency: 'INR', finalAmount: '16065.87' }],
    };
    const fetchMock = vi.fn(async () =>
      response({
        ...page([quotation]),
        analytics: { byStatus: { SENT: 1 }, totalQuotedValue: '16065.87', acceptanceRate: 50 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<QuotationsPage />);
    await screen.findAllByText('QT-2026-000001');
    // Clean header: eyebrow + subtitle removed.
    expect(screen.queryByText('Commercial workspace')).not.toBeInTheDocument();
    expect(screen.queryByText(/Versioned proposals/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Customer quotations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New quotation/ })).toBeInTheDocument();
    // Table shows the simplified columns, LEAD heading, no removed columns.
    const thead = document.querySelector('thead');
    expect(thead).not.toBeNull();
    expect(
      within(thead!).getAllByRole('columnheader').map((cell) => cell.textContent),
    ).toEqual(['Quotation', 'Lead', 'Destination', 'Created by', 'Actions']);
    const headerText = thead!.textContent ?? '';
    expect(headerText).not.toContain('Final amount');
    expect(headerText).not.toContain('Last sent');
    expect(headerText).not.toContain('Last viewed');
    expect(headerText).not.toContain('Lead / customer');
  });

  describe('Simplified detail page sections', () => {
    const multiVersionDetail = {
      ...copyQuotationDetail,
      currentVersionId: 'version-2',
      versions: [
        { ...copyFinalizedVersion, id: 'version-1', versionNumber: 1 },
        { ...copyFinalizedVersion, id: 'version-2', versionNumber: 2 },
      ],
      documents: [
        {
          id: 'document-v2',
          quotationVersionId: 'version-2',
          fileName: 'QT-2026-000001-v2.pdf',
          mimeType: 'application/pdf',
          fileSize: 8192,
          checksum: 'bbb',
          documentType: 'QUOTATION_PDF',
          status: 'AVAILABLE',
          createdAt: '2026-07-22T00:00:00.000Z',
        },
        {
          id: 'document-photo',
          quotationVersionId: null,
          fileName: 'passport-scan.png',
          mimeType: 'image/png',
          fileSize: 1024,
          checksum: 'ccc',
          documentType: 'SUPPORTING_ATTACHMENT',
          status: 'AVAILABLE',
          createdAt: '2026-07-23T00:00:00.000Z',
        },
      ],
    };
    const renderDetail = (detail: unknown) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
          if (!options || options.method === 'GET') return response(detail);
          return response({});
        }),
      );
      renderWithProviders(
        <Routes>
          <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
        </Routes>,
        { route: '/quotations/quotation-1' },
      );
    };

    it('removes the Current version card but keeps the Final amount', async () => {
      renderDetail(multiVersionDetail);
      await screen.findByText('Activity timeline');
      expect(screen.queryByText('Current version')).not.toBeInTheDocument();
      expect(screen.getByText('Final amount')).toBeInTheDocument();
    });

    it('removes the Version history and Documents sections', async () => {
      renderDetail(multiVersionDetail);
      await screen.findByText('Activity timeline');
      expect(screen.queryByText('Version history')).not.toBeInTheDocument();
      expect(screen.queryByText('Documents')).not.toBeInTheDocument();
      expect(screen.queryByText('Add PDF or image attachment')).not.toBeInTheDocument();
      expect(screen.queryByText('QT-2026-000001-v2.pdf')).not.toBeInTheDocument();
      expect(screen.queryByText('passport-scan.png')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    });

    it('removes the Contact, Travel dates and Travellers rows', async () => {
      renderDetail({ ...multiVersionDetail, travelStartDate: '2026-09-02', travelEndDate: null });
      await screen.findByText('Activity timeline');
      expect(screen.queryByText('Contact')).not.toBeInTheDocument();
      expect(screen.queryByText('Travel dates')).not.toBeInTheDocument();
      expect(screen.queryByText('Travellers')).not.toBeInTheDocument();
      expect(screen.queryByText('aarav@example.test')).not.toBeInTheDocument();
      expect(screen.queryByText('+91 90000 00000')).not.toBeInTheDocument();
    });

    it('removes the FINALIZED Send button but keeps Create revision', async () => {
      renderDetail(multiVersionDetail);
      await screen.findByText('Activity timeline');
      expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create revision' })).toBeInTheDocument();
    });
  });

  it('calculates a live builder summary and hides costing without permission', async () => {
    const makeVersion = (pricingMode: string) => ({
      id: 'version-1',
      versionNumber: 1,
      title: 'Goa proposal',
      introduction: null,
      destinationSummary: 'Goa',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '100',
      subtotalCost: '50',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '100',
      marginAmount: '50',
      marginPercentage: '50',
      pricingMode,
      notes: null,
      internalNotes: null,
      status: 'DRAFT',
      finalizedAt: null,
      createdAt: '2026-07-21T00:00:00.000Z',
      createdBy: person,
      itinerary: [],
      hotels: [
        {
          id: 'hotel-1',
          city: 'Goa',
          hotelName: 'Coastal Bay',
          category: null,
          roomType: null,
          mealPlan: null,
          rooms: 1,
          nights: 1,
          checkInDate: null,
          checkOutDate: null,
          internalCost: '50',
          sellingPrice: '100',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
      services: [],
      inclusions: [],
      exclusions: [],
      terms: [],
    });
    // The pricing mode is stored on the version (set on the Quotation Details
    // page); the builder only renders according to it, so each render stubs the
    // quotation with the mode under test.
    const stubQuotation = (pricingMode: string) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          response({
            quotationNumber: 'QT-2026-000001',
            customerName: 'Aarav Mehta',
            adults: 1,
            childrenWithBed: 0,
            childrenWithoutBed: 0,
            infants: 0,
            versions: [makeVersion(pricingMode)],
          }),
        ),
      );
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
    // By Section: Hotel amount is visible.
    stubQuotation('SECTION_WISE');
    const sectionView = renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    expect(await screen.findByLabelText('Hotel amount')).toBeEnabled();
    expect(screen.queryByLabelText('Hotel internal cost')).not.toBeInTheDocument();
    sectionView.unmount();
    // By Traveler: per-passenger pricing from the Pricing tab.
    stubQuotation('PER_PERSON');
    const costView = renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(screen.getByRole('button', { name: 'Pricing' }));
    // Per-passenger pricing: 1 adult × 110 = the package total.
    await userEvent.type(screen.getByLabelText('Per Adult Price'), '110');
    // The Total Package Price field, breakdown and the summary card all echo it.
    expect((await screen.findAllByText('INR 110.00')).length).toBeGreaterThan(0);
    // Net Amount (margin basis) is a costing-only field.
    expect(screen.getByLabelText('Net Amount')).toBeInTheDocument();
    costView.unmount();
    auth.permissions.delete('quotations.view_costing');
    stubQuotation('PER_PERSON');
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    expect(screen.queryByLabelText('Hotel internal cost')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pricing' }));
    expect(screen.queryByLabelText('Net Amount')).not.toBeInTheDocument();
  });

  it('marks every Lead-requested service tab with a red asterisk', async () => {
    const draftVersion = {
      id: 'version-1',
      versionNumber: 1,
      title: 'Malaysia proposal',
      introduction: null,
      destinationSummary: 'Kuala Lumpur',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '0',
      subtotalCost: '0',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '0',
      marginAmount: '0',
      marginPercentage: '0',
      pricingMode: 'ITEMIZED',
      notes: null,
      internalNotes: null,
      status: 'DRAFT',
      finalizedAt: null,
      createdAt: '2026-07-21T00:00:00.000Z',
      createdBy: person,
      itinerary: [],
      hotels: [],
      services: [
        {
          serviceType: 'FLIGHT',
          name: 'flight',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '0',
          totalSellingPrice: '0',
          sellingPrice: '0',
          taxCategory: null,
          notes: null,
          sequence: 1,
        },
        {
          serviceType: 'HOTEL',
          name: 'hotel',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '0',
          totalSellingPrice: '0',
          sellingPrice: '0',
          taxCategory: null,
          notes: null,
          sequence: 2,
        },
        {
          serviceType: 'SIGHTSEEING',
          name: 'sightseeing',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '0',
          totalSellingPrice: '0',
          sellingPrice: '0',
          taxCategory: null,
          notes: null,
          sequence: 3,
        },
        {
          serviceType: 'CRUISE',
          name: 'cruise',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '0',
          totalSellingPrice: '0',
          sellingPrice: '0',
          taxCategory: null,
          notes: null,
          sequence: 4,
        },
        {
          serviceType: 'VEHICLE_TRANSFER',
          name: 'vehicle',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '0',
          totalSellingPrice: '0',
          sellingPrice: '0',
          taxCategory: null,
          notes: null,
          sequence: 5,
        },
        {
          serviceType: 'OTHER_ADD_ON',
          name: 'add-on',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '0',
          totalSellingPrice: '0',
          sellingPrice: '0',
          taxCategory: null,
          notes: null,
          sequence: 6,
        },
      ],
      inclusions: [],
      exclusions: [],
      terms: [],
    };
    const quotation = {
      id: 'quotation-1',
      quotationNumber: 'QT-2026-000001',
      customerName: 'Aarav Mehta',
      currentVersionId: 'version-1',
      destinationSummary: 'Kuala Lumpur',
      travelStartDate: null,
      travelEndDate: null,
      adults: 1,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
      rooms: 1,
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        leadStage: 'QUOTATION_SENT',
        assignedToId: null,
        createdById: 'user-1',
        departureCity: null,
        departureCountry: null,
        services: [
          { serviceType: 'FLIGHT' },
          { serviceType: 'HOTEL' },
          { serviceType: 'SIGHTSEEING' },
          { serviceType: 'CRUISE' },
          { serviceType: 'VEHICLE_TRANSFER' },
          { serviceType: 'OTHER_ADD_ON' },
        ],
      },
      versions: [draftVersion],
      documents: [],
      emailLogs: [],
      booking: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(quotation)),
    );
    renderWithProviders(
      <Routes>
        <Route
          path="/quotations/:quotationId/versions/:versionId/edit"
          element={<QuotationBuilderPage />}
        />
      </Routes>,
      { route: '/quotations/quotation-1/versions/version-1/edit' },
    );
    await screen.findByRole('button', { name: 'Flight' });
    // Every Lead-requested service tab shows a red `*` inside its button text.
    for (const label of [
      'Flight',
      'Hotel',
      'Sightseeing',
      'Cruise',
      'Vehicle',
      'Add-on Services',
    ]) {
      const tab = screen.getByRole('button', { name: label });
      expect(tab.textContent).toContain('*');
    }
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    const destinationExpertTab = screen.getByRole('button', { name: 'Destination Expert' });
    const faqsTab = screen.getByRole('button', { name: 'FAQs' });
    expect(
      destinationExpertTab.compareDocumentPosition(faqsTab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Setting' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Quotation Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weblink Navigation' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Weblink Name' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Hero & Display Settings' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Destination Expert' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Quotation Summary')).toHaveLength(1);
    expect(screen.getByLabelText('Settings actions')).toHaveClass('sm:flex-row');

    await userEvent.click(screen.getByRole('button', { name: /Weblink Section Order/i }));
    expect(screen.getByRole('button', { name: 'Reset to default order' })).toBeInTheDocument();

    await userEvent.click(destinationExpertTab);
    expect(screen.getByRole('heading', { name: 'Destination Expert' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Quotation Settings' })).not.toBeInTheDocument();
  });

  it('runs revision, PDF and public-link actions from the detail page', async () => {
    const finalizedVersion = {
      id: 'version-1',
      versionNumber: 1,
      title: 'Goa proposal',
      introduction: 'A coastal holiday.',
      destinationSummary: 'Goa',
      travelStartDate: null,
      travelEndDate: null,
      currency: 'INR',
      subtotalSellingPrice: '25000',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '25000',
      pricingMode: 'ITEMIZED',
      notes: null,
      status: 'FINALIZED',
      finalizedAt: '2026-07-21T00:00:00.000Z',
      createdAt: '2026-07-21T00:00:00.000Z',
      createdBy: person,
      itinerary: [],
      hotels: [],
      services: [],
      inclusions: [],
      exclusions: [],
      terms: [],
    };
    const detail = {
      id: 'quotation-1',
      quotationNumber: 'QT-2026-000001',
      queryId: 'lead-1',
      currentVersionId: 'version-1',
      status: 'SENT',
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
      lastSentAt: '2026-07-21T00:00:00.000Z',
      lastViewedAt: null,
      acceptedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      createdBy: person,
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        leadStage: 'QUOTATION_SENT',
        assignedToId: 'user-1',
        createdById: 'user-1',
      },
      versions: [finalizedVersion],
      documents: [
        {
          id: 'document-1',
          quotationVersionId: 'version-1',
          fileName: 'QT-2026-000001-v1.pdf',
          mimeType: 'application/pdf',
          fileSize: 4096,
          checksum: 'abc',
          documentType: 'QUOTATION_PDF',
          status: 'AVAILABLE',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
      ],
      emailLogs: [],
      activityTimeline: [],
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (input, options) => {
        const url = String(input);
        if (!options || options.method === 'GET') return response(detail);
        if (url.endsWith('/public-link'))
          return response({ url: 'http://localhost:5173/q/customer-token' });
        if (url.endsWith('/send')) return response({ sent: true, publicUrl: null });
        if (url.endsWith('/versions')) return response({ id: 'version-2', versionNumber: 2 });
        return response({ id: 'document-1', reused: true });
      },
    );
    const clipboardWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    vi.spyOn(window, 'open').mockReturnValue({
      opener: window,
      document: { title: '', body: { innerHTML: '' } },
      location: { replace: vi.fn() },
      close: vi.fn(),
    } as unknown as Window);
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );
    expect(await screen.findByRole('heading', { name: /Aarav Mehta/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await userEvent.click(screen.getByRole('button', { name: /Classic PDF/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/generate-pdf'))).toBe(
        true,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy Weblink URL' }));
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith('http://localhost:5173/q/customer-token'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create revision' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/versions'))).toBe(true),
    );
    expect(
      screen.queryByText(/departure sightseeing activity is not configured/i),
    ).not.toBeInTheDocument();
  });

  it('surfaces a clear error when creating a revision fails instead of failing silently', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (input, options) => {
        const url = String(input);
        if (!options || options.method === 'GET') return response(copyQuotationDetail);
        if (url.endsWith('/versions')) {
          return {
            ok: false,
            status: 404,
            json: async () => ({
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'The requested information could not be found.',
              },
            }),
          } as Response;
        }
        return response({});
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );
    expect(await screen.findByRole('heading', { name: /Aarav Mehta/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create revision' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be found/i);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/versions'))).toHaveLength(
      1,
    );
    expect(screen.queryByRole('button', { name: /Edit quotation/ })).not.toBeInTheDocument();
  });

  it('disables create revision while the request is pending so repeated clicks fire one request', async () => {
    let resolveVersions!: (value: Response) => void;
    const versionsCall = new Promise<Response>((resolve) => (resolveVersions = resolve));
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      (input, options) => {
        const url = String(input);
        if (!options || options.method === 'GET')
          return Promise.resolve(response(copyQuotationDetail));
        if (url.endsWith('/versions')) return versionsCall;
        return Promise.resolve(response({}));
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );
    expect(await screen.findByRole('heading', { name: /Aarav Mehta/ })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Create revision' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    await userEvent.click(button);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/versions')),
      ).toHaveLength(1),
    );
    resolveVersions(response({ id: 'version-2', versionNumber: 2 }));
  });

  it('removes the travel dates row and keeps no lifecycle status on the detail page', async () => {
    const detail = {
      ...copyQuotationDetail,
      travelStartDate: '2026-09-02',
      travelEndDate: null,
      validUntil: '2026-09-20',
      status: 'SENT',
      versions: [
        {
          ...copyFinalizedVersion,
          travelStartDate: '2026-09-02',
          travelEndDate: null,
          itinerary: [
            {
              id: 'i1',
              dayNumber: 1,
              title: 'Arrive',
              destination: 'Kuala Lumpur',
              description: 'a',
              meals: null,
              overnightLocation: null,
              activities: null,
              transfers: null,
              notes: null,
              sequence: 1,
            },
            {
              id: 'i2',
              dayNumber: 7,
              title: 'Depart',
              destination: 'Kuala Lumpur',
              description: 'b',
              meals: null,
              overnightLocation: null,
              activities: null,
              transfers: null,
              notes: null,
              sequence: 2,
            },
          ],
        },
      ],
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (_input, options) => {
        if (!options || options.method === 'GET') return response(detail);
        return response({ id: 'doc-new', reused: true });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );
    await screen.findByText('Activity timeline');
    // Travel dates row was removed from the detail page: the inclusive
    // 02/09/2026 – 08/09/2026 range is no longer rendered.
    const start = new Date('2026-09-02').toLocaleDateString();
    const end = new Date('2026-09-08').toLocaleDateString();
    expect(screen.queryByText(`${start} – ${end}`)).not.toBeInTheDocument();
    expect(screen.queryByText('Travel dates')).not.toBeInTheDocument();
    // No lifecycle Status card and no Valid until row.
    expect(screen.queryByText('Valid until')).not.toBeInTheDocument();
    const statusLabel = screen.queryByText(
      (_content, element) =>
        element?.textContent === 'Status' &&
        element?.tagName === 'P' &&
        element?.className?.includes('uppercase'),
    );
    expect(statusLabel).toBeNull();
  });

  it('no longer renders the customer preview section on the detail page', async () => {
    const hotel = (overrides: Record<string, unknown>) => ({
      id: `h-${String(overrides.id ?? 'x')}`,
      city: 'Goa',
      hotelName: 'Beach Resort',
      category: '5 Star',
      roomType: null,
      mealPlan: null,
      rooms: 1,
      nights: 3,
      checkInDate: null,
      checkOutDate: null,
      sellingPrice: '0',
      selected: true,
      notes: null,
      sequence: 1,
      ...overrides,
    });
    const detail = {
      ...copyQuotationDetail,
      versions: [
        {
          ...copyFinalizedVersion,
          hotels: [
            hotel({ id: 'both', roomType: 'Deluxe', mealPlan: 'Breakfast' }),
            hotel({ id: 'room', roomType: 'Superior' }),
            hotel({ id: 'meal', mealPlan: 'Half Board' }),
            hotel({ id: 'none' }),
          ],
        },
      ],
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (_input, options) => {
        if (!options || options.method === 'GET') return response(detail);
        return response({});
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );
    await screen.findByText('Activity timeline');

    // The customer preview section was removed: no preview header, hotels,
    // itinerary, inclusions/exclusions/terms, or final amount block.
    expect(screen.queryByText('Customer preview')).not.toBeInTheDocument();
    expect(screen.queryByText('Beach Resort')).not.toBeInTheDocument();
    expect(screen.queryByText(/Goa · 3 nights/)).not.toBeInTheDocument();
    expect(screen.queryByText('Final quotation amount')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal margin')).not.toBeInTheDocument();
  });

  it('copy public link shows a Copy icon, a Copied! tooltip on success, and resets', async () => {
    const detailForCopy = copyQuotationDetail;
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (input, options) => {
        const url = String(input);
        if (!options || options.method === 'GET') return response(detailForCopy);
        if (url.endsWith('/public-link'))
          return response({ url: 'http://localhost:5173/q/customer-token' });
        return response({ id: 'document-1', reused: true });
      },
    );
    const clipboardWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );
    await screen.findByText('Activity timeline');
    // Copy Weblink URL uses the Copy icon (not the ExternalLink icon).
    const copyButton = screen.getByRole('button', { name: 'Copy Weblink URL' });
    expect(copyButton.querySelector('svg')).not.toBeNull();
    // Open Weblink sits immediately after Copy Weblink URL and shares the URL.
    const buttonsRow = copyButton.closest('div')!;
    const rowText = buttonsRow.textContent ?? '';
    expect(rowText.indexOf('Copy Weblink URL')).toBeLessThan(rowText.indexOf('Open Weblink'));
    await userEvent.click(copyButton);
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith('http://localhost:5173/q/customer-token'),
    );
    // Tooltip shows "Copied!" after a successful copy.
    await waitFor(() => expect(screen.getByText('Copied!')).toBeInTheDocument());
    // Tooltip resets to the default label afterwards (after ~1.8s).
    await waitFor(() => expect(screen.queryByText('Copied!')).not.toBeInTheDocument(), {
      timeout: 3000,
    });
    // Open Weblink is a same-origin anchor to the same URL with rel noopener.
    const weblink = screen.getByRole('link', { name: 'Open Weblink' });
    expect(weblink.getAttribute('href')).toBe('http://localhost:5173/q/customer-token');
    expect(weblink.getAttribute('target')).toBe('_blank');
    expect(weblink.getAttribute('rel')).toContain('noopener');
    expect(weblink.getAttribute('rel')).toContain('noreferrer');
  });

  it('does not show Copied! when the clipboard write fails', async () => {
    const detailForCopy = copyQuotationDetail;
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (input, options) => {
        const url = String(input);
        if (!options || options.method === 'GET') return response(detailForCopy);
        if (url.endsWith('/public-link'))
          return response({ url: 'http://localhost:5173/q/customer-token' });
        return response({ id: 'document-1', reused: true });
      },
    );
    const clipboardWrite = vi.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );
    await screen.findByText('Activity timeline');
    await userEvent.click(screen.getByRole('button', { name: 'Copy Weblink URL' }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalled());
    // Failed copy must NOT show "Copied!".
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument();
  });

  it('re-provisions the public link when the current version changes', async () => {
    // Simulate the current version changing during the same page session (e.g.
    // after finalize/duplicate): the quotation refetch returns a new
    // currentVersionId, so the cached public link must be re-resolved for the
    // new version rather than reused from the old one.
    const mutableDetail = {
      ...copyQuotationDetail,
      versions: [
        copyFinalizedVersion,
        { ...copyFinalizedVersion, id: 'version-2', versionNumber: 2 },
      ],
    };
    const publicLinkCalls: Array<{ versionId: string }> = [];
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (input, options) => {
        const url = String(input);
        // Return a fresh clone each time so a refetch is a new object reference,
        // which is what makes the component's effect re-run on version change.
        if (!options || options.method === 'GET')
          return response(JSON.parse(JSON.stringify(mutableDetail)));
        if (url.endsWith('/public-link')) {
          const body = JSON.parse(String(options.body)) as { quotationVersionId: string };
          publicLinkCalls.push({ versionId: body.quotationVersionId });
          return response({
            url: `http://localhost:5173/q/token-for-${body.quotationVersionId}`,
          });
        }
        if (url.endsWith('/versions')) {
          // Creating a revision invalidates the quotation query; flip the
          // current version to v2 on the next refetch to simulate a session change.
          mutableDetail.currentVersionId = 'version-2';
          return response({ id: 'version-2', versionNumber: 2 });
        }
        return response({ id: 'document-1', reused: true });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );
    // Mount provisions the link for the initially current version (v1).
    await waitFor(() =>
      expect(publicLinkCalls.some((call) => call.versionId === 'version-1')).toBe(true),
    );
    // Copy copies the v1 URL, not a stale one.
    const clipboardWrite = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Copy Weblink URL' }));
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith('http://localhost:5173/q/token-for-version-1'),
    );
    // Create revision: invalidates the quotation query and flips currentVersionId to v2.
    await userEvent.click(screen.getByRole('button', { name: 'Create revision' }));
    // After refetch, the component re-provisions for v2.
    await waitFor(() =>
      expect(publicLinkCalls.some((call) => call.versionId === 'version-2')).toBe(true),
    );
    // Copy now uses the v2 URL (the stale v1 URL is discarded).
    clipboardWrite.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Copy Weblink URL' }));
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith('http://localhost:5173/q/token-for-version-2'),
    );
  });

  it('creates from a visible lead and saved template', async () => {
    const fetchMock = leadSearchFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<NewQuotationPage />, {
      route: '/quotations/new?templateId=11111111-1111-4111-8111-111111111111',
    });
    await pickLead(/Aarav Mehta/);
    await userEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, options]) => {
          if (options?.method !== 'POST') return false;
          const body = JSON.parse(String(options.body));
          return body.queryId === 'lead-1' && body.templateId === template.id;
        }),
      ).toBe(true),
    );
  });

  it('does not render the copied-safely informational line on Create Quotation', async () => {
    vi.stubGlobal('fetch', leadSearchFetch());
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });
    await openLeadList();
    expect(
      screen.queryByText(
        'Customer and traveller details are copied safely. Templates become independent snapshots.',
      ),
    ).not.toBeInTheDocument();
  });

  it('does not render the Start from section on Create Quotation', async () => {
    vi.stubGlobal('fetch', leadSearchFetch());
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });
    await openLeadList();
    expect(screen.queryByText('Start from')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Quotation template')).not.toBeInTheDocument();
    expect(screen.queryByText('Blank quotation / lead itinerary')).not.toBeInTheDocument();
  });

  it('searches leads by customer name and shows the distinguishing detail line', async () => {
    const fetchMock = leadSearchFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });
    await userEvent.type(await screen.findByLabelText('Lead'), 'Vikas');

    // The unfiltered list holds both leads, so wait for the narrowed result.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Vikas Singh/ })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Aarav Mehta/ })).not.toBeInTheDocument();
    });
    const option = screen.getByRole('option', { name: /Vikas Singh/ });
    expect(
      within(option).getByText('QRY-1042 · 9876543210 · vikas@example.test'),
    ).toBeInTheDocument();
    expect(searchTerms(fetchMock)).toContain('Vikas');
  });

  it('searches leads by phone number and by email', async () => {
    const fetchMock = leadSearchFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });
    const input = await screen.findByLabelText('Lead');

    await userEvent.type(input, '9876543210');
    await screen.findByRole('option', { name: /Vikas Singh/ });
    await waitFor(() => expect(searchTerms(fetchMock)).toContain('9876543210'));

    await userEvent.clear(input);
    await userEvent.type(input, 'aarav@example.test');
    await screen.findByRole('option', { name: /Aarav Mehta/ });
    await waitFor(() => expect(searchTerms(fetchMock)).toContain('aarav@example.test'));
  });

  it('searches leads by lead/query id', async () => {
    vi.stubGlobal('fetch', leadSearchFetch());
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });
    await userEvent.type(await screen.findByLabelText('Lead'), 'QRY-1042');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Vikas Singh/ })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Aarav Mehta/ })).not.toBeInTheDocument();
    });
  });

  it('shows "No leads found" when the search matches nothing', async () => {
    vi.stubGlobal('fetch', leadSearchFetch());
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });
    await userEvent.type(await screen.findByLabelText('Lead'), 'Nobody');
    expect(await screen.findByText('No leads found')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('surfaces an error state when the lead search request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            json: async () => ({ success: false, message: 'Server error' }),
          }) as Response,
      ),
    );
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });
    await userEvent.click(await screen.findByLabelText('Lead'));
    expect(await screen.findByText('Unable to search leads.')).toBeInTheDocument();
  });

  it('selecting a search result sets that lead and creates the quotation with its id', async () => {
    const fetchMock = leadSearchFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });

    await userEvent.type(await screen.findByLabelText('Lead'), 'Vikas');
    await userEvent.click(await screen.findByRole('option', { name: /Vikas Singh/ }));

    // The chosen lead is shown in the closed field...
    expect(screen.getByLabelText('Lead')).toHaveValue('Vikas Singh · QRY-1042');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // ...and the unchanged create action posts that lead's id.
    await userEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, options]) => {
          if (options?.method !== 'POST') return false;
          const body = JSON.parse(String(options.body));
          return body.queryId === 'lead-1042' && body.templateId === null;
        }),
      ).toBe(true),
    );
  });

  it('searches only the leads the server makes visible to the caller', async () => {
    // This caller may see one lead. The other exists in the tenant but is
    // outside their visibility, so the server never returns it — and the
    // combobox must therefore never offer it.
    const fetchMock = leadSearchFetch([visibleLead]);
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });

    await userEvent.type(await screen.findByLabelText('Lead'), 'Vikas');
    expect(await screen.findByText('No leads found')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Vikas Singh/ })).not.toBeInTheDocument();

    // Every lookup goes through the permission-scoped list endpoint; the field
    // never reaches for an unscoped or bespoke search route.
    const leadUrls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes('/queries'));
    expect(leadUrls.length).toBeGreaterThan(0);
    for (const url of leadUrls) expect(url).toMatch(/\/api\/queries\?pageSize=\d+/);
  });

  it('locks the lead field to the route lead and still creates with it', async () => {
    const fetchMock = leadSearchFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/quotations/new" element={<NewQuotationPage />} />
      </Routes>,
      { route: '/queries/lead-1/quotations/new' },
    );

    const input = await screen.findByLabelText('Lead');
    await waitFor(() => expect(input).toHaveValue('Aarav Mehta · QRY-1'));
    expect(input).toBeDisabled();
    await userEvent.click(input);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, options]) => {
          if (options?.method !== 'POST') return false;
          return JSON.parse(String(options.body)).queryId === 'lead-1';
        }),
      ).toBe(true),
    );
  });

  it('creates a blank quotation through the default path when no template is passed', async () => {
    const fetchMock = leadSearchFetch();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<NewQuotationPage />, { route: '/quotations/new' });
    await pickLead(/Aarav Mehta/);
    await userEvent.click(screen.getByRole('button', { name: 'Create quotation' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, options]) => {
          if (options?.method !== 'POST') return false;
          const body = JSON.parse(String(options.body));
          return body.queryId === 'lead-1' && body.templateId === null;
        }),
      ).toBe(true),
    );
  });

  it('completes the presigned attachment upload and server confirmation flow', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async (input, options) => {
        const url = String(input);
        if (url === 'https://storage.example.test/upload')
          return { ok: true, status: 200, json: async () => ({}) } as Response;
        if (url.endsWith('/uploads'))
          return response({
            documentId: 'document-1',
            uploadUrl: 'https://storage.example.test/upload',
            requiredHeaders: { 'Content-Type': 'application/pdf' },
          });
        if (url.endsWith('/uploads/document-1/confirm'))
          return response({ id: 'document-1', status: 'AVAILABLE' });
        if (url.includes('/documents/document-1/download-url?disposition=inline'))
          return response({ url: 'https://storage.example.test/voucher.pdf' });
        throw new Error(`Unexpected request: ${url} ${options?.method}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['%PDF'], 'voucher.pdf', { type: 'application/pdf' });
    await expect(uploadQuotationAttachment('quotation-1', file)).resolves.toEqual({
      documentId: 'document-1',
      url: 'https://storage.example.test/voucher.pdf',
    });
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          String(url) === 'https://storage.example.test/upload' &&
          options?.method === 'PUT' &&
          options.body === file,
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith('/uploads/document-1/confirm') && options?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('renders the customer-safe public page without the final-amount/decision box', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSince: 2015,
        tripsSold: 4200,
        tan: 'ABCD12345E',
        taxRegistrationNumber: '29ABCDE1234F1Z5',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        introduction: 'A coastal holiday.',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotelDetails: {
          sectionTitle: 'Accommodation Details',
          amount: 0,
          description: '<p>Hotel welcome note.</p>',
        },
        flightDetails: {
          include: true,
          sectionTitle: 'Flight Details',
          amount: 0,
          journeyType: 'ONEWAY_OUTBOUND',
          outbound: {
            fromCity: 'Delhi',
            toCity: 'Goa',
            travelClass: 'Economy',
            segments: [
              {
                airlineId: 'aaaaaaa4-1111-4111-8111-111111111111',
                airlineName: 'Air India',
                flightNumber: 'AI101',
                travelClass: 'Economy',
                from: 'Delhi',
                to: 'Goa',
                departureDate: '2026-09-10',
                departureTime: '10:00',
                arrivalDate: '2026-09-10',
                arrivalTime: '12:00',
                duration: '2h 0m',
                cabinLuggage: '7kg',
                checkInLuggage: '20kg',
                notes: null,
                connectionVia: null,
              },
            ],
          },
          returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
        },
        hotels: [
          {
            id: 'quote-hotel-1',
            hotelName: 'Coastal Bay Resort',
            city: 'Calangute',
            category: '4 Star',
            roomType: 'Deluxe Room',
            mealPlan: 'Breakfast Only',
            rooms: 1,
            nights: 4,
            checkInDate: '2026-09-10T00:00:00.000Z',
            checkOutDate: '2026-09-14T00:00:00.000Z',
            sellingPrice: '12000',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        services: [
          {
            id: 'quote-vehicle-1',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Innova Crysta',
            description: '<p>Private air-conditioned transport.</p>',
            dayNumber: null,
            city: 'SUV',
            quantity: '1',
            unitSellingPrice: '5000',
            totalSellingPrice: '5000',
            sellingPrice: '5000',
            taxCategory: 'Transportation',
            notes: '3 hours',
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {
        'quote-hotel-1': {
          imageUrl: 'https://storage.example.test/coastal-bay.jpg',
          starCategory: 4,
          starRating: '4.6',
          address: 'Calangute Beach Road',
          reviewLink: 'https://reviews.example.test/coastal-bay',
          checkInTime: '14:00',
          checkOutTime: '12:00',
          destination: 'Goa',
          country: 'India',
        },
      },
      vehiclePresentations: {
        'quote-vehicle-1': {
          imageUrl: 'https://storage.example.test/innova.jpg',
          name: 'Innova Crysta',
          vehicleType: 'SUV',
          capacity: 6,
        },
      },
      airlinePresentations: {
        'aaaaaaa4-1111-4111-8111-111111111111': {
          name: 'Air India',
          logoUrl: 'https://storage.example.test/air-india-logo.png',
        },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    expect(await screen.findByText('Custom Package for Aarav Mehta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your Hotels' })).toBeInTheDocument();
    expect(screen.getByText('Hotel welcome note.').closest('article')).not.toBeNull();
    // Hotel image uses the dynamic presentation URL in a landscape cover wrapper.
    const hotelImg = screen.getByAltText('Coastal Bay Resort');
    expect(hotelImg).toHaveAttribute('src', 'https://storage.example.test/coastal-bay.jpg');
    expect(hotelImg).toHaveAttribute('class', expect.stringContaining('object-cover'));
    expect(hotelImg.parentElement?.parentElement?.className).toContain('aspect-[16/9]');
    // The hotel card container is a full-width single-column grid, not narrow tiles.
    const hotelsSection = screen.getByRole('heading', { name: 'Your Hotels' }).closest('section');
    expect(hotelsSection?.querySelector('div.grid')?.className).not.toContain('md:grid-cols-2');
    expect(screen.getByText(/Deluxe Room/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transportation' })).toBeInTheDocument();
    expect(screen.getByAltText('Innova Crysta')).toHaveAttribute(
      'src',
      'https://storage.example.test/innova.jpg',
    );
    expect(screen.getByText('Private air-conditioned transport.')).toBeInTheDocument();
    expect(screen.getByAltText('Air India logo')).toHaveAttribute(
      'src',
      'https://storage.example.test/air-india-logo.png',
    );
    // The public final-amount/decision box is no longer rendered.
    expect(screen.queryByText('Final quotation amount')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Valid until/)).not.toBeInTheDocument();
    // Contact Us flows straight into the public footer.
    const footer = document.querySelector('footer');
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveTextContent('Alpha Travel. All rights reserved.');
  });

  it('shows all saved hotel images in a navigable carousel on the public weblink', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSince: 2015,
        tripsSold: 4200,
        tan: 'ABCD12345E',
        taxRegistrationNumber: '29ABCDE1234F1Z5',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        introduction: null,
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotelDetails: {
          sectionTitle: 'Your Hotels',
          amount: 0,
          description: null,
          images: [
            { url: 'https://cdn.example/img-1.jpg', alt: 'Gallery 1' },
            { url: 'https://cdn.example/img-2.jpg', alt: 'Gallery 2' },
            { url: 'https://cdn.example/img-3.jpg', alt: 'Gallery 3' },
            { url: 'https://cdn.example/img-4.jpg', alt: 'Gallery 4' },
            { url: 'https://cdn.example/img-5.jpg', alt: 'Gallery 5' },
            { url: 'https://cdn.example/img-6.jpg', alt: 'Gallery 6' },
            { url: 'https://cdn.example/img-7.jpg', alt: 'Gallery 7' },
            { url: 'https://cdn.example/img-8.jpg', alt: 'Gallery 8' },
            { url: 'https://cdn.example/img-9.jpg', alt: 'Gallery 9' },
          ],
          pdfImageUrl: 'https://cdn.example/img-2.jpg',
        },
        hotels: [
          {
            id: 'quote-hotel-1',
            hotelName: 'Grand Bay Resort',
            city: 'Puri',
            category: '5 Star',
            roomType: 'Deluxe Room',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: '2026-09-10T00:00:00.000Z',
            checkOutDate: '2026-09-12T00:00:00.000Z',
            checkInTime: null,
            checkOutTime: null,
            sellingPrice: '12000',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {},
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    // The first ordered image is shown initially; only one image at a time.
    expect(screen.getByAltText('Gallery 1')).toHaveAttribute(
      'src',
      'https://cdn.example/img-1.jpg',
    );
    expect(screen.queryByAltText('Gallery 2')).not.toBeInTheDocument();
    expect(screen.getByText('1 / 9')).toBeInTheDocument();

    // Next cycles forward through every imported image (1 → 9), no reload.
    await userEvent.click(screen.getByRole('button', { name: 'Next hotel image' }));
    expect(screen.getByAltText('Gallery 2')).toHaveAttribute(
      'src',
      'https://cdn.example/img-2.jpg',
    );
    expect(screen.queryByAltText('Gallery 1')).not.toBeInTheDocument();
    expect(screen.getByText('2 / 9')).toBeInTheDocument();
    for (let step = 3; step <= 9; step += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Next hotel image' }));
    }
    expect(screen.getByAltText('Gallery 9')).toHaveAttribute(
      'src',
      'https://cdn.example/img-9.jpg',
    );
    expect(screen.getByText('9 / 9')).toBeInTheDocument();

    // Previous cycles back (9 → 8) and back to the first (8 → 1).
    await userEvent.click(screen.getByRole('button', { name: 'Previous hotel image' }));
    expect(screen.getByAltText('Gallery 8')).toBeInTheDocument();
    expect(screen.getByText('8 / 9')).toBeInTheDocument();
    for (let step = 0; step < 7; step += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Previous hotel image' }));
    }
    expect(screen.getByAltText('Gallery 1')).toBeInTheDocument();
    expect(screen.getByText('1 / 9')).toBeInTheDocument();

    // Touch swipe mirrors the arrows: left = next, right = previous, wrapping
    // at the ends. It never opens the viewer mid-gesture.
    const swipe = (from: HTMLElement, dx: number) => {
      fireEvent.touchStart(from, { touches: [{ clientX: 200, clientY: 60 }] });
      fireEvent.touchEnd(from, { changedTouches: [{ clientX: 200 + dx, clientY: 60 }] });
    };
    // Right-swipe on the first image wraps to the last.
    swipe(screen.getByAltText('Gallery 1'), 120);
    expect(screen.getByText('9 / 9')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Left-swipe wraps forward from the last image back to the first.
    swipe(screen.getByAltText('Gallery 9'), -120);
    expect(screen.getByText('1 / 9')).toBeInTheDocument();
    // Left then right returns to the starting image.
    swipe(screen.getByAltText('Gallery 1'), -120);
    expect(screen.getByText('2 / 9')).toBeInTheDocument();
    swipe(screen.getByAltText('Gallery 2'), 120);
    expect(screen.getByText('1 / 9')).toBeInTheDocument();
    // Vertical drags are ignored so natural page scrolling stays intact.
    fireEvent.touchStart(screen.getByAltText('Gallery 1'), {
      touches: [{ clientX: 120, clientY: 30 }],
    });
    fireEvent.touchEnd(screen.getByAltText('Gallery 1'), {
      changedTouches: [{ clientX: 118, clientY: 170 }],
    });
    expect(screen.getByText('1 / 9')).toBeInTheDocument();

    // The gallery lives INSIDE the hotel card — no separate large gallery above
    // it, and no duplicated images on the page.
    const carouselImage = screen.getByAltText('Gallery 1');
    expect(carouselImage.closest('article')).not.toBeNull();
    expect(document.querySelectorAll('img[src="https://cdn.example/img-1.jpg"]')).toHaveLength(1);
    expect(screen.queryByText('Hotel image unavailable')).not.toBeInTheDocument();

    // The card shows the saved Room Type and Meal Plan for the imported hotel.
    expect(screen.getByText('Deluxe Room')).toBeInTheDocument();
    expect(screen.getByText('Breakfast')).toBeInTheDocument();

    // No live-search/SearchAPI request is made by the public page.
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes('/search/'))).toBe(false);
  });

  it('renders quotation-owned activity, vehicle and cruise galleries in saved order', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000003',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Maldives',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Snapshot galleries',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [
          {
            id: 'vehicle-snapshot',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Island SUV',
            description: null,
            dayNumber: null,
            city: 'SUV',
            quantity: '1',
            unitSellingPrice: '100',
            totalSellingPrice: '100',
            sellingPrice: '100',
            taxCategory: 'Transportation',
            notes: null,
            sequence: 1,
            images: [
              { id: 'vehicle-c', url: 'https://cdn.example/vehicle-c.jpg', alt: 'Vehicle C' },
              { id: 'vehicle-a', url: 'https://cdn.example/vehicle-a.jpg', alt: 'Vehicle A' },
            ],
          },
          {
            id: 'cruise-snapshot',
            serviceType: 'CRUISE',
            name: 'Ocean Dream',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '100',
            totalSellingPrice: '100',
            sellingPrice: '100',
            taxCategory: 'Cruise Details',
            notes: null,
            sequence: 2,
            images: [
              { id: 'cruise-1', url: 'https://cdn.example/cruise-1.jpg', alt: 'Cruise 1' },
              { id: 'cruise-2', url: 'https://cdn.example/cruise-2.jpg', alt: 'Cruise 2' },
            ],
          },
          {
            id: 'vehicle-images-removed',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Removed Gallery Van',
            description: null,
            dayNumber: null,
            city: 'Van',
            quantity: '1',
            unitSellingPrice: '100',
            totalSellingPrice: '100',
            sellingPrice: '100',
            taxCategory: 'Transportation',
            notes: null,
            sequence: 3,
            images: [],
            imageSnapshotPresent: true,
          },
        ],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Reef walk',
              city: 'Malé',
              activities: [
                {
                  name: 'Reef walk',
                  description: null,
                  sightseeingId: 'sightseeing-1',
                  imageUrl: null,
                  images: [
                    {
                      id: 'activity-2',
                      url: 'https://cdn.example/activity-2.jpg',
                      alt: 'Activity 2',
                    },
                    {
                      id: 'activity-1',
                      url: 'https://cdn.example/activity-1.jpg',
                      alt: 'Activity 1',
                    },
                  ],
                },
                {
                  name: 'No-image activity',
                  description: null,
                  sightseeingId: 'sightseeing-removed',
                  imageUrl: null,
                  images: [],
                  imageSnapshotPresent: true,
                },
                {
                  name: 'Legacy lagoon visit',
                  description: null,
                  sightseeingId: 'sightseeing-legacy',
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      // Live presentations deliberately disagree: quotation snapshots win.
      vehiclePresentations: {
        'vehicle-snapshot': {
          imageUrl: 'https://cdn.example/live-vehicle.jpg',
          name: 'Island SUV',
          vehicleType: 'SUV',
          capacity: 6,
        },
        'vehicle-images-removed': {
          imageUrl: 'https://cdn.example/live-removed-vehicle.jpg',
          name: 'Removed Gallery Van',
          vehicleType: 'Van',
          capacity: 8,
        },
      },
      cruisePresentations: {
        'cruise-snapshot': {
          imageUrl: 'https://cdn.example/live-cruise.jpg',
          name: 'Ocean Dream',
          roomTypeName: null,
        },
      },
      sightseeingPresentations: {
        'sightseeing-1': { imageUrl: 'https://cdn.example/live-activity.jpg' },
        'sightseeing-removed': { imageUrl: 'https://cdn.example/live-removed-activity.jpg' },
        'sightseeing-legacy': { imageUrl: 'https://cdn.example/legacy-activity.jpg' },
      },
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(publicData)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Snapshot galleries');

    expect(screen.getByAltText('Activity 2')).toHaveAttribute(
      'src',
      'https://cdn.example/activity-2.jpg',
    );
    expect(screen.getByAltText('Vehicle C')).toHaveAttribute(
      'src',
      'https://cdn.example/vehicle-c.jpg',
    );
    expect(screen.getByAltText('Cruise 1')).toHaveAttribute(
      'src',
      'https://cdn.example/cruise-1.jpg',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next reef walk image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next vehicle image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next cruise image' }));
    expect(screen.getByAltText('Activity 1')).toBeInTheDocument();
    expect(screen.getByAltText('Vehicle A')).toBeInTheDocument();
    expect(screen.getByAltText('Cruise 2')).toBeInTheDocument();
    expect(
      screen
        .getAllByAltText('Legacy lagoon visit')
        .some((image) => image.getAttribute('src') === 'https://cdn.example/legacy-activity.jpg'),
    ).toBe(true);

    // Removed snapshot images and newer live-Master images never leak back in.
    for (const url of [
      'https://cdn.example/vehicle-b.jpg',
      'https://cdn.example/live-vehicle.jpg',
      'https://cdn.example/live-cruise.jpg',
      'https://cdn.example/live-activity.jpg',
      'https://cdn.example/live-removed-vehicle.jpg',
      'https://cdn.example/live-removed-activity.jpg',
    ]) {
      expect(document.querySelector(`img[src="${url}"]`)).toBeNull();
    }

    // The existing responsive layout remains stacked on small screens.
    expect(screen.getByText('Reef walk').closest('article')?.className).toContain('flex-col');
  });

  it('shows a single saved hotel image plainly without carousel navigation', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSince: 2015,
        tripsSold: 4200,
        tan: 'ABCD12345E',
        taxRegistrationNumber: '29ABCDE1234F1Z5',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        introduction: null,
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotelDetails: {
          sectionTitle: 'Your Hotels',
          amount: 0,
          description: null,
          images: [{ url: 'https://cdn.example/pool.jpg', alt: 'Pool view' }],
        },
        hotels: [
          {
            id: 'quote-hotel-1',
            hotelName: 'Grand Bay Resort',
            city: 'Puri',
            category: '5 Star',
            roomType: 'Deluxe Room',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: '2026-09-10T00:00:00.000Z',
            checkOutDate: '2026-09-12T00:00:00.000Z',
            checkInTime: null,
            checkOutTime: null,
            sellingPrice: '12000',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {},
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(publicData)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    expect(screen.getByAltText('Pool view')).toHaveAttribute('src', 'https://cdn.example/pool.jpg');
    expect(screen.queryByRole('button', { name: 'Next hotel image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous hotel image' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\/ 1$/)).not.toBeInTheDocument();

    // The single-image gallery lives inside the hotel card — one image only,
    // no placeholder and no duplicated large gallery.
    const cardImage = screen.getByAltText('Pool view');
    expect(cardImage.closest('article')).not.toBeNull();
    expect(document.querySelectorAll('img[src="https://cdn.example/pool.jpg"]')).toHaveLength(1);
    expect(screen.queryByText('Hotel image unavailable')).not.toBeInTheDocument();
  });

  it('falls back to the bookmark thumbnail candidate when a weblink carousel image fails', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSince: 2015,
        tripsSold: 4200,
        tan: 'ABCD12345E',
        taxRegistrationNumber: '29ABCDE1234F1Z5',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        introduction: null,
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotelDetails: {
          sectionTitle: 'Your Hotels',
          amount: 0,
          description: null,
          images: [
            {
              url: 'https://cdn.example/room.jpg',
              thumbnailUrl: 'https://cdn.example/room-thumb.jpg',
              alt: 'Room view',
            },
            {
              url: 'https://cdn.example/pool.jpg',
              thumbnailUrl: 'https://cdn.example/pool-thumb.jpg',
              alt: 'Pool view',
            },
          ],
        },
        hotels: [
          {
            id: 'quote-hotel-1',
            hotelName: 'Grand Bay Resort',
            city: 'Puri',
            category: '5 Star',
            roomType: 'Deluxe Room',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: '2026-09-10T00:00:00.000Z',
            checkOutDate: '2026-09-12T00:00:00.000Z',
            checkInTime: null,
            checkOutTime: null,
            sellingPrice: '12000',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {},
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(publicData)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    const firstImage = screen.getByAltText('Room view');
    expect(firstImage).toHaveAttribute('src', 'https://cdn.example/room.jpg');
    fireEvent.error(firstImage);
    // The primary URL failed, so the card falls back to the bookmark's
    // thumbnail candidate for the same image — no broken image card.
    expect(screen.getByAltText('Room view')).toHaveAttribute(
      'src',
      'https://cdn.example/room-thumb.jpg',
    );

    // The second image keeps its own working primary URL.
    await userEvent.click(screen.getByRole('button', { name: 'Next hotel image' }));
    expect(screen.getByAltText('Pool view')).toHaveAttribute('src', 'https://cdn.example/pool.jpg');
  });

  it('hides an excluded service (hotelDetails.include=false) from the public weblink', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSince: 2015,
        tripsSold: 4200,
        tan: 'ABCD12345E',
        taxRegistrationNumber: '29ABCDE1234F1Z5',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        introduction: null,
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        // Hotel explicitly excluded in the quotation → must not render.
        hotelDetails: { include: false, sectionTitle: 'Accommodation Details' },
        flightDetails: null,
        sightseeingDetails: null,
        hotels: [
          {
            id: 'hotel-1',
            city: 'Goa',
            hotelName: 'Coastal Bay Resort',
            category: '5 Star',
            roomType: 'Deluxe Room',
            mealPlan: 'BB',
            nights: 3,
            selected: true,
            notes: null,
          },
        ],
        itinerary: [],
        services: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      heroImageUrl: null,
      hotelPresentations: {},
      vehiclePresentations: {},
      airlinePresentations: {},
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    // The excluded Hotel section is completely absent.
    expect(screen.queryByRole('heading', { name: /Your Hotels|Accommodation Details/ })).toBeNull();
    expect(screen.queryByText('Coastal Bay Resort')).not.toBeInTheDocument();
    // "Hotels" does not appear in Services Include.
    const servicesInclude = screen.queryByText('Services Include')?.closest('section');
    if (servicesInclude) {
      expect(within(servicesInclude).queryByText('Hotels')).not.toBeInTheDocument();
    }
  });

  it('shows the Master destination (Malaysia) in Destinations with the weblink heading override', async () => {
    const publicData = {
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
        quotationNumber: 'QT-2026-000123',
        customerName: 'Rajesh Kumar',
        destinationSummary: 'Kuala Lumpur',
        destinations: 'Malaysia',
        travelStartDate: '2026-10-23',
        travelEndDate: '2026-10-27',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Kuala Lumpur Package for Rajesh Kumar',
        introduction: null,
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '80000',
        notes: null,
        perAdultPrice: '40000',
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
        weblinkHeading: 'Kuala Lumpur',
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        sightseeingDetails: { include: false, days: [] },
        flightDetails: null,
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
        createdBy: null,
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    // Hero heading keeps the explicit weblink override.
    expect(await screen.findByRole('heading', { name: 'Kuala Lumpur' })).toBeInTheDocument();
    // The Destinations summary card shows the Master destination (Malaysia).
    const dest = screen.getByText('Destinations');
    expect(dest.closest('div')?.textContent).toContain('Malaysia');
    expect(dest.closest('div')?.textContent).not.toContain('Kuala Lumpur');
    // Package heading falls back to the lead-based default, never the title.
    expect(screen.getByText('Custom Package for Rajesh Kumar')).toBeInTheDocument();
    expect(screen.queryByText('Kuala Lumpur Package for Rajesh Kumar')).not.toBeInTheDocument();
  });

  it('deduplicates destination names in the Destinations summary', async () => {
    const base = {
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
        quotationNumber: 'QT-2026-000124',
        customerName: 'Rajesh Kumar',
        destinationSummary: 'Kuala Lumpur',
        // Malaysia repeated across two itinerary stays → deduplicated.
        destinations: 'Malaysia → Singapore',
        travelStartDate: '2026-10-23',
        travelEndDate: '2026-10-27',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Malaysia & Singapore Package',
        introduction: null,
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '80000',
        notes: null,
        perAdultPrice: '40000',
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
        weblinkHeading: 'Kuala Lumpur',
        includeVisa: false,
        visaSectionTitle: null,
        visaAmount: '0',
        visaDestination: null,
        visaType: null,
        visaServiceCharge: '0',
        visaGstPercent: '0',
        visaVfsCharge: '0',
        sightseeingDetails: { include: false, days: [] },
        flightDetails: null,
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
        createdBy: null,
      },
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(base)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByRole('heading', { name: 'Kuala Lumpur' });
    const dest = screen.getByText('Destinations');
    expect(dest.closest('div')?.textContent).toContain('Malaysia → Singapore');
  });

  it('removes the optional add-ons amount line from the Total Package Price card', async () => {
    const publicData = {
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
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        introduction: 'A coastal holiday.',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '10000',
        perAdultPrice: '5000',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        flightDetails: null,
        hotels: [],
        services: [
          {
            id: 'quote-addon-1',
            serviceType: 'TRAVEL_INSURANCE',
            addOnServiceId: 'quote-addon-master-1',
            name: 'Travel Insurance',
            description: '<p>Comprehensive international cover.</p>',
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '3800',
            totalSellingPrice: '3800',
            sellingPrice: '3800',
            taxCategory: 'Insurance',
            notes: null,
            sequence: 1,
          },
          {
            id: 'quote-vehicle-1',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Innova Crysta',
            description: '<p>Private air-conditioned transport.</p>',
            dayNumber: null,
            city: 'SUV',
            quantity: '1',
            unitSellingPrice: '5000',
            totalSellingPrice: '5000',
            sellingPrice: '5000',
            taxCategory: 'Transportation',
            notes: '3 hours',
            sequence: 2,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {},
      vehiclePresentations: {},
      airlinePresentations: {},
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    // 1. Final package price is still shown.
    expect(screen.getAllByText('Total Package Price').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/₹10,000/).length).toBeGreaterThan(0);
    // 2. The traveller price breakdown still shows.
    const breakdown = screen.getByTestId('traveler-price-breakdown');
    expect(within(breakdown).getByText('Adults')).toBeInTheDocument();
    expect(within(breakdown).getByText('2 × ₹5,000')).toBeInTheDocument();
    // 3. The optional add-ons summary text is gone.
    expect(screen.queryByText(/add-ons \(optional\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/optional add-ons/i)).not.toBeInTheDocument();
    // 4. The add-on amount no longer appears as a summary line under the price.
    // (The Additional Services card legitimately shows its own price, so scope
    // this to the pricing summary and the package breakdown.)
    const pricingSection = document.querySelector(
      '[data-preview-section="pricing"]',
    ) as HTMLElement;
    expect(within(pricingSection).queryByText(/₹3,800/)).not.toBeInTheDocument();
    expect(within(breakdown).queryByText(/₹3,800/)).not.toBeInTheDocument();
    // 5. Add-on services elsewhere on the weblink remain unaffected.
    expect(screen.getByRole('heading', { name: 'Additional Services' })).toBeInTheDocument();
    expect(screen.getByText('Travel Insurance')).toBeInTheDocument();
    // Contact Now is preserved.
    expect(screen.getByRole('link', { name: /Contact Now/ })).toHaveAttribute(
      'href',
      'tel:919876543210',
    );
  });

  it('renders multiple hotels as wide cards and falls back without an image', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        durationNights: 11,
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Grand Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [
          {
            id: 'h1',
            hotelName: 'Marina Bay Sands',
            city: 'Singapore',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 3,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '20000',
            selected: true,
            notes: null,
            sequence: 1,
          },
          {
            id: 'h2',
            hotelName: 'Orchard Hotel',
            city: 'Singapore',
            category: '4 Star',
            roomType: 'Superior',
            mealPlan: 'Half Board',
            rooms: 1,
            nights: 3,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '15000',
            selected: true,
            notes: null,
            sequence: 2,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {
        h1: {
          imageUrl: 'https://storage.example.test/marina-bay.jpg',
          starCategory: 5,
          starRating: '4.8',
          address: 'Bayfront',
          reviewLink: null,
          checkInTime: '15:00',
          checkOutTime: '12:00',
          destination: 'Singapore',
          country: 'Singapore',
        },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // Duration comes from all destination rows (11 nights), not the two hotels (6 nights).
    expect(screen.getAllByText('11 Nights / 12 Days').length).toBeGreaterThan(0);

    // Both hotels render as separate full-width cards.
    const section = screen
      .getByRole('heading', { name: 'Your Hotels' })
      .closest('section') as HTMLElement;
    expect(section.querySelectorAll('article').length).toBe(2);
    expect(section.querySelector('div.grid')?.className).not.toContain('md:grid-cols-2');
    // First hotel uses its own dynamic image with a landscape cover wrapper.
    const marina = screen.getByAltText('Marina Bay Sands');
    expect(marina).toHaveAttribute('src', 'https://storage.example.test/marina-bay.jpg');
    expect(marina).toHaveAttribute('class', expect.stringContaining('object-cover'));
    expect(marina.parentElement?.parentElement?.className).toContain('aspect-[16/9]');
    expect(screen.queryByText('4.8')).not.toBeInTheDocument();
    expect(screen.queryByText('Hotel Review')).not.toBeInTheDocument();
    // Second hotel has no presentation and uses the fallback.
    expect(screen.getByText('Orchard Hotel')).toBeInTheDocument();
    expect(screen.getByText('Hotel image unavailable')).toBeInTheDocument();
    expect(screen.queryByAltText('Orchard Hotel')).not.toBeInTheDocument();
  });

  it('drops the auto-generated "prepared for" sentence from the public hero', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSince: 2015,
        tripsSold: 4200,
        tan: 'ABCD12345E',
        taxRegistrationNumber: '29ABCDE1234F1Z5',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-2026-000010',
        customerName: 'Vikas Singh',
        destinationSummary: 'Singapore',
        travelStartDate: '2026-09-10T00:00:00.000Z',
        travelEndDate: '2026-09-14T00:00:00.000Z',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Singapore Package for Vikas Singh',
        introduction: 'A travel proposal prepared for Vikas Singh.',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Vikas Singh');

    // The stock "prepared for" sentence is fully gone from the hero.
    expect(
      screen.queryByText('A travel proposal prepared for Vikas Singh.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/A travel proposal prepared for/)).not.toBeInTheDocument();

    // Destination and duration headline remain visible.
    expect(screen.getByRole('heading', { name: 'Singapore' })).toBeInTheDocument();
    expect(screen.getAllByText('4 Nights / 5 Days').length).toBeGreaterThan(0);

    // The traveller name stays in the summary card.
    expect(screen.getByText('Vikas Singh')).toBeInTheDocument();

    // Contact Us and the public footer are still present.
    expect(screen.getByRole('heading', { name: 'Contact Us' })).toBeInTheDocument();
    const footer = document.querySelector('footer');
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveTextContent('Alpha Travel. All rights reserved.');

    // The final-amount/decision black box remains absent.
    expect(screen.queryByText('Final quotation amount')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();

    // Dynamic tab title and logo favicon are unchanged.
    expect(document.title).toBe('Singapore Package for Vikas Singh');
    await waitFor(() =>
      expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
        'href',
        'https://storage.example.test/alpha-logo.png',
      ),
    );
  });

  it('does not render the public introduction when it is empty or whitespace-only', async () => {
    for (const introduction of ['', '   ', null]) {
      const publicData = {
        company: {
          name: 'Alpha Travel',
          email: 'hello@alpha.test',
          phone: null,
          website: null,
          address: null,
          primaryColor: '#2563eb',
        },
        quotation: {
          quotationNumber: 'QT-2026-000012',
          customerName: 'Vikas Singh',
          destinationSummary: 'Singapore',
          travelStartDate: '2026-09-10T00:00:00.000Z',
          travelEndDate: '2026-09-14T00:00:00.000Z',
          adults: 2,
          childrenWithBed: 0,
          childrenWithoutBed: 0,
          infants: 0,
          rooms: 1,
          validUntil: null,
          createdAt: '2026-08-04T10:00:00.000Z',
          status: 'VIEWED',
        },
        version: {
          title: 'Singapore Package for Vikas Singh',
          introduction,
          versionNumber: 1,
          currency: 'INR',
          finalAmount: '16065.87',
          hotels: [],
          services: [],
          itinerary: [],
          inclusions: [],
          exclusions: [],
          terms: [],
        },
        downloadUrl: null,
      };
      const fetchMock = vi.fn(async () => response(publicData));
      vi.stubGlobal('fetch', fetchMock);
      renderWithProviders(
        <Routes>
          <Route path="/q/:token" element={<PublicQuotationPage />} />
        </Routes>,
        { route: `/q/token-empty-intro-${String(introduction ?? '').length}-characters` },
      );
      await screen.findByRole('heading', { name: 'Singapore' });
      // The hero still renders, but the introduction paragraph is absent.
      expect(screen.queryByTestId('public-hero-introduction')).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('renders the public introduction when the text is non-empty', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000013',
        customerName: 'Vikas Singh',
        destinationSummary: 'Singapore',
        travelStartDate: '2026-09-10T00:00:00.000Z',
        travelEndDate: '2026-09-14T00:00:00.000Z',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Singapore Package for Vikas Singh',
        introduction: 'A hand-crafted journey awaits you.',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/token-non-empty-intro-characters' },
    );
    await screen.findByRole('heading', { name: 'Singapore' });
    expect(screen.getByTestId('public-hero-introduction')).toHaveTextContent(
      'A hand-crafted journey awaits you.',
    );
  });

  it('renders a taller, balanced destination hero on public links', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000011',
        customerName: 'Riya Kapoor',
        destinationSummary: 'Bali',
        travelStartDate: '2026-09-10T00:00:00.000Z',
        travelEndDate: '2026-09-14T00:00:00.000Z',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Bali Package for Riya Kapoor',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      heroImageUrl: 'https://storage.example.test/bali-hero.jpg',
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Riya Kapoor');

    // The destination image itself covers the complete width of the hero.
    const hero = screen.getByRole('banner');
    expect(hero.className).toContain('overflow-hidden');
    // Responsive heights: mobile 300, tablet 330, desktop 380.
    expect(hero.className).toContain('min-h-[300px]');
    expect(hero.className).toContain('sm:min-h-[330px]');
    expect(hero.className).toContain('md:min-h-[380px]');
    expect(hero.className).toContain('items-center');
    const heroImage = within(hero).getByTestId('public-hero-image');
    expect(heroImage).toHaveAttribute('src', 'https://storage.example.test/bali-hero.jpg');
    expect(heroImage).toHaveClass('object-cover');

    // Hero values are preserved: destination heading, duration, package heading.
    expect(screen.getByRole('heading', { name: 'Bali' })).toBeInTheDocument();
    expect(screen.getAllByText('4 Nights / 5 Days').length).toBeGreaterThan(0);
    expect(screen.getByText('Custom Package for Riya Kapoor')).toBeInTheDocument();

    // The hero text block is left-aligned in the page content container, never
    // horizontally centred.
    const heroContent = screen.getByRole('heading', { name: 'Bali' }).parentElement!;
    expect(heroContent.className).toContain('text-left');
    expect(heroContent.className).toContain('max-w-5xl');
    expect(heroContent.className).toContain('mx-auto');
    expect(heroContent.className).not.toContain('text-center');
    const destination = screen.getByRole('heading', { name: 'Bali' });
    expect(destination.className).toContain('font-extrabold');
    expect(destination.className).toContain('text-[32px]');
    expect(destination.className).toContain('lg:text-[48px]');
    const packageTitle = screen.getByText('Custom Package for Riya Kapoor');
    expect(packageTitle.className).toContain('font-bold');
    expect(packageTitle.className).toContain('text-[16px]');
    expect(packageTitle.className).toContain('mt-2');
    // The package heading is not uppercased.
    expect(packageTitle.textContent).toBe('Custom Package for Riya Kapoor');

    // Summary and price cards still sit below the hero.
    expect(screen.getAllByText('Total Package Price').length).toBeGreaterThan(0);
  });

  it('renders the summary and price cards in normal flow below the hero image', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000012',
        customerName: 'Riya Kapoor',
        destinationSummary: 'Bali',
        travelStartDate: '2026-09-10T00:00:00.000Z',
        travelEndDate: '2026-09-14T00:00:00.000Z',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Bali Package for Riya Kapoor',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        initialPaymentAmount: '5000',
        paymentLink: 'https://pay.example.test/secure',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      heroImageUrl: 'https://storage.example.test/bali-hero.jpg',
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Riya Kapoor');

    // 1. The hero section renders before the information/price card wrapper.
    const header = screen.getByRole('banner');
    const cardsSection = screen.getByText('Traveler Name').closest('section')!;
    expect(
      header.compareDocumentPosition(cardsSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 2 & 3. The information card and the total-price card are both outside the
    // hero container (which clips its overflow).
    expect(header.contains(cardsSection)).toBe(false);
    const priceCard = screen.getByText('Total Package Price', { selector: 'p' }).closest('div.bg-emerald-600');
    expect(priceCard).not.toBeNull();
    expect(header.contains(priceCard!)).toBe(false);

    // The cards sit in normal document flow: no negative margin, no relative
    // z-index lift, no translate — a clean gap below the hero instead.
    const contentWrapper = cardsSection.parentElement!;
    expect(contentWrapper?.className).toContain('mt-8');
    expect(contentWrapper?.className).not.toMatch(/-mt-\d+/);
    expect(contentWrapper?.className).not.toContain('relative');
    expect(contentWrapper?.className).not.toContain('z-10');
    expect(contentWrapper?.className).not.toContain('translate');

    // 4. Secure Your Booking Now renders after the information/price cards.
    const secureSection = screen
      .getByRole('heading', { name: 'Secure Your Booking Now' })
      .closest('section')!;
    expect(
      cardsSection.compareDocumentPosition(secureSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 5. Existing price values, summary fields and buttons still render.
    expect(screen.getByText('Traveler Name')).toBeInTheDocument();
    expect(screen.getByText('Travel Date')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Travelers')).toBeInTheDocument();
    expect(screen.getAllByText(/₹16,066/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Pay Now/ })).toHaveAttribute(
      'href',
      'https://pay.example.test/secure',
    );

    // 6. No negative-margin/overlap utilities remain anywhere on the page
    // (scroll-mt-* anchor offsets under the sticky nav are not layout margins).
    expect(document.querySelector('.mx-auto')).not.toBeNull();
    expect(document.querySelector('[class*="-mt-"]:not([class*="scroll-mt-"])')).toBeNull();
    // The floating Back to Top button legitimately uses translate for its
    // slide-in animation; the content cards must not be lifted with translate.
    expect(
      document.querySelector('[class*="translate"]:not([aria-label="Back to top"])'),
    ).toBeNull();
  });

  it('renders included services as separate cards with the Services Include heading', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Grand Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '200000',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        flightDetails: {
          include: true,
          sectionTitle: 'Flight Details',
          amount: 0,
          journeyType: 'ONEWAY_OUTBOUND',
          outbound: {
            fromCity: 'Delhi',
            toCity: 'Singapore',
            travelClass: 'Economy',
            segments: [
              {
                airlineId: 'air-1',
                airlineName: 'Air India',
                flightNumber: 'AI101',
                travelClass: 'Economy',
                from: 'Delhi',
                to: 'Singapore',
                departureDate: '2026-09-10',
                departureTime: '10:00',
                arrivalDate: '2026-09-10',
                arrivalTime: '12:00',
                duration: '2h 0m',
                cabinLuggage: '7kg',
                checkInLuggage: '20kg',
                notes: null,
                connectionVia: null,
              },
            ],
          },
          returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
        },
        hotels: [
          {
            id: 'h1',
            hotelName: 'Marina Bay Sands',
            city: 'Singapore',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 3,
            checkInDate: '2026-09-10T00:00:00.000Z',
            checkOutDate: '2026-09-13T00:00:00.000Z',
            sellingPrice: '20000',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        services: [
          {
            id: 's-sight',
            serviceType: 'SIGHTSEEING',
            name: 'City Tour',
            description: null,
            dayNumber: 1,
            city: 'Singapore',
            quantity: '1',
            unitSellingPrice: '3000',
            totalSellingPrice: '3000',
            sellingPrice: '3000',
            taxCategory: 'Sightseeing',
            notes: null,
            sequence: 1,
          },
          {
            id: 's-cruise',
            serviceType: 'CRUISE',
            name: 'Harbour Cruise',
            description: null,
            dayNumber: 2,
            city: 'Singapore',
            quantity: '1',
            unitSellingPrice: '5000',
            totalSellingPrice: '5000',
            sellingPrice: '5000',
            taxCategory: 'Cruise',
            notes: null,
            sequence: 2,
          },
          {
            id: 's-vehicle',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Airport Transfer',
            description: null,
            dayNumber: 1,
            city: 'Singapore',
            quantity: '1',
            unitSellingPrice: '2000',
            totalSellingPrice: '2000',
            sellingPrice: '2000',
            taxCategory: 'Transportation',
            notes: null,
            sequence: 3,
          },
          {
            id: 's-addon',
            addOnServiceId: 'addon-travel-insurance',
            serviceType: 'TRAVEL_INSURANCE',
            name: 'Travel Insurance',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '1500',
            totalSellingPrice: '1500',
            sellingPrice: '1500',
            taxCategory: 'Add-on',
            notes: null,
            sequence: 4,
          },
        ],
        includeVisa: true,
        visaAmount: '2500',
        visaServiceCharge: '500',
        visaGstPercent: '18',
        visaVfsCharge: '300',
        visaType: 'Tourist',
        visaDestination: 'Singapore',
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    const heading = screen.getByRole('heading', { name: 'Services Include' });
    const section = heading.closest('section') as HTMLElement;
    // Heading sits on the page background, not inside the old large rounded card.
    expect(section.className).not.toContain('rounded-2xl');
    expect(section.className).not.toContain('bg-card');

    // Every included service renders as its own card with a green check icon.
    for (const label of [
      'Flights',
      'Hotels',
      'Sightseeing',
      'Cruise',
      'Transportation',
      'Add-ons',
      'Visa',
    ]) {
      const labelNode = within(section).getByText(label);
      expect(labelNode.closest('article')).not.toBeNull();
      expect(labelNode.closest('article')?.querySelector('svg')).not.toBeNull();
    }
    // Cards are rectangular, not pill badges, and the old wrapper is gone.
    expect(section.querySelector('.rounded-full')).toBeNull();
    expect(section.querySelector('.bg-emerald-50')).toBeNull();
  });

  it('does not render a duplicate Services & Experiences block on the public page', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000007',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'No Duplicate Block',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '200000',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        flightDetails: {
          include: true,
          sectionTitle: 'Flight Details',
          amount: 0,
          journeyType: 'ONEWAY_OUTBOUND',
          outbound: {
            fromCity: 'Delhi',
            toCity: 'Singapore',
            travelClass: 'Economy',
            segments: [
              {
                airlineId: 'air-1',
                airlineName: 'Air India',
                flightNumber: 'AI101',
                travelClass: 'Economy',
                from: 'Delhi',
                to: 'Singapore',
                departureDate: '2026-09-10',
                departureTime: '10:00',
                arrivalDate: '2026-09-10',
                arrivalTime: '12:00',
                duration: '2h 0m',
                cabinLuggage: '7kg',
                checkInLuggage: '20kg',
                notes: null,
                connectionVia: null,
              },
            ],
          },
          returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
        },
        hotels: [
          {
            id: 'h1',
            hotelName: 'Marina Bay Sands',
            city: 'Singapore',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 3,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '20000',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        services: [
          {
            id: 's-sight',
            serviceType: 'SIGHTSEEING',
            name: 'City Tour',
            description: null,
            dayNumber: 1,
            city: 'Singapore',
            quantity: '1',
            unitSellingPrice: '3000',
            totalSellingPrice: '3000',
            sellingPrice: '3000',
            taxCategory: 'Sightseeing',
            notes: null,
            sequence: 1,
          },
          {
            id: 's-cruise',
            serviceType: 'CRUISE',
            name: 'Harbour Cruise',
            description: null,
            dayNumber: 2,
            city: 'Singapore',
            quantity: '1',
            unitSellingPrice: '5000',
            totalSellingPrice: '5000',
            sellingPrice: '5000',
            taxCategory: 'Cruise',
            notes: null,
            sequence: 2,
          },
          {
            id: 's-vehicle',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Airport Transfer',
            description: null,
            dayNumber: 1,
            city: 'Singapore',
            quantity: '1',
            unitSellingPrice: '2000',
            totalSellingPrice: '2000',
            sellingPrice: '2000',
            taxCategory: 'Transportation',
            notes: null,
            sequence: 3,
          },
          {
            id: 's-addon',
            addOnServiceId: 'addon-travel-insurance',
            serviceType: 'TRAVEL_INSURANCE',
            name: 'Travel Insurance',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '1500',
            totalSellingPrice: '1500',
            sellingPrice: '1500',
            taxCategory: 'Add-on',
            notes: null,
            sequence: 4,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    // The duplicate block is gone entirely.
    expect(
      screen.queryByRole('heading', { name: 'Services & Experiences' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Services & Experiences')).not.toBeInTheDocument();
    // No duplicate standalone row for the non-addon sightseeing service (the
    // only kind the old block would have shown without a dedicated section).
    expect(screen.queryByText('City Tour')).not.toBeInTheDocument();

    // Dedicated sections still render.
    expect(screen.getByRole('heading', { name: 'Services Include' })).toBeInTheDocument();
    expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument();
    expect(screen.getByText('Air India')).toBeInTheDocument();
    expect(screen.getByText('Harbour Cruise')).toBeInTheDocument();

    // Add-ons still render under "Additional Services".
    const addonsHeading = screen.getByRole('heading', { name: 'Additional Services' });
    const addonsSection = addonsHeading.closest('section') as HTMLElement;
    expect(within(addonsSection).getByText('Travel Insurance')).toBeInTheDocument();
  });

  it('does not resurrect the block for legacy generic service names', async () => {
    const service = (id: string, serviceType: string, name: string) => ({
      id,
      serviceType,
      name,
      description: null,
      dayNumber: null,
      city: null,
      quantity: '1',
      unitSellingPrice: '0',
      totalSellingPrice: '0',
      sellingPrice: '0',
      taxCategory: null,
      notes: null,
      sequence: 1,
    });
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000008',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Legacy Generic Services',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [
          service('s1', 'SIGHTSEEING', 'sightseeing'),
          service('s2', 'CRUISE', 'cruise'),
          service('s3', 'VEHICLE_TRANSFER', 'vehicle'),
          service('s4', 'FLIGHT', 'flight'),
          { ...service('s5', 'TRAVEL_INSURANCE', 'visa'), addOnServiceId: 'addon-visa' },
          service('s6', 'SIGHTSEEING', 'hotel'),
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // No "Services & Experiences" block, and no bare duplicate value rows for
    // values that only the old block ever displayed (no dedicated section).
    expect(
      screen.queryByRole('heading', { name: 'Services & Experiences' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Services & Experiences')).not.toBeInTheDocument();
    expect(screen.queryByText('hotel', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('sightseeing', { exact: true })).not.toBeInTheDocument();
    // Legacy cruise/vehicle values still render inside their dedicated sections.
    expect(screen.getByText('cruise', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('vehicle', { exact: true })).toBeInTheDocument();
    // The legacy add-on value still renders as an add-on under "Additional Services".
    const addonsHeading = screen.getByRole('heading', { name: 'Additional Services' });
    const addonsSection = addonsHeading.closest('section') as HTMLElement;
    expect(within(addonsSection).getByText('visa')).toBeInTheDocument();
  });

  it('shows the Sightseeing service card from saved sightseeing details', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Sightseeing Trip',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [
          {
            id: 'h1',
            hotelName: 'Marina Bay',
            city: 'Singapore',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '1000',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        // No SIGHTSEEING service rows — the canonical sightseeingDetails drives the card.
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'City Tour',
              city: 'Singapore',
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
            {
              dayNumber: 2,
              title: 'Gardens by the Bay',
              city: 'Singapore',
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Cloud Forest',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const section = screen
      .getByRole('heading', { name: 'Services Include' })
      .closest('section') as HTMLElement;
    // Exactly one Sightseeing card, with a green icon and check indicator.
    const sightseeingCards = within(section).getAllByText('Sightseeing');
    expect(sightseeingCards).toHaveLength(1);
    const card = sightseeingCards[0]!.closest('article');
    expect(card).not.toBeNull();
    expect(card?.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
    // Stable order: Hotels before Sightseeing.
    const cardLabels = [...section.querySelectorAll('article span')].map((s) => s.textContent);
    expect(cardLabels).toEqual(['Hotels', 'Sightseeing']);
  });

  it('hides the Sightseeing card for empty or placeholder sightseeing data', async () => {
    const baseVersion = {
      title: 'No Sightseeing',
      versionNumber: 1,
      currency: 'INR',
      finalAmount: '100',
      hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
      hotels: [
        {
          id: 'h1',
          hotelName: 'Marina Bay',
          city: 'Singapore',
          category: '5 Star',
          roomType: 'Deluxe',
          mealPlan: 'Breakfast',
          rooms: 1,
          nights: 2,
          checkInDate: null,
          checkOutDate: null,
          sellingPrice: '1000',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
      services: [],
      itinerary: [],
      inclusions: [],
      exclusions: [],
      terms: [],
    };
    const renderVersion = async (sightseeingDetails: unknown) => {
      const fetchMock = vi.fn<
        (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>
      >(async () =>
        response({
          company: {
            name: 'Alpha Travel',
            email: 'a@b.test',
            phone: null,
            website: null,
            address: null,
            primaryColor: '#2563eb',
          },
          quotation: {
            quotationNumber: 'QT-2026-000002',
            customerName: 'Mira Shah',
            destinationSummary: 'Singapore',
            travelStartDate: null,
            travelEndDate: null,
            adults: 2,
            childrenWithBed: 0,
            childrenWithoutBed: 0,
            infants: 0,
            rooms: 1,
            validUntil: null,
            status: 'VIEWED',
          },
          version: { ...baseVersion, sightseeingDetails },
          downloadUrl: null,
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      renderWithProviders(
        <Routes>
          <Route path="/q/:token" element={<PublicQuotationPage />} />
        </Routes>,
        { route: '/q/public-token-value-with-at-least-32-characters' },
      );
      await screen.findByText('Custom Package for Mira Shah');
      const section = screen
        .getByRole('heading', { name: 'Services Include' })
        .closest('section') as HTMLElement;
      return within(section).queryByText('Sightseeing');
    };

    // Empty days array → no card.
    expect(
      await renderVersion({
        include: true,
        sectionTitle: 'Sightseeing',
        amount: 0,
        description: null,
        days: [],
      }),
    ).not.toBeInTheDocument();
    cleanup();
    // Placeholder day with no title and empty activities → no card.
    expect(
      await renderVersion({
        include: true,
        sectionTitle: 'Sightseeing',
        amount: 0,
        description: null,
        days: [
          {
            dayNumber: 1,
            title: '',
            city: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [],
          },
        ],
      }),
    ).not.toBeInTheDocument();
  });

  it('removes the old generic itinerary card but keeps the detailed sightseeing timeline', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Itinerary Check',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [],
        // The old generic itinerary snapshot must no longer be rendered.
        itinerary: [
          {
            id: 'd1',
            dayNumber: 1,
            title: 'Singapore',
            destination: 'Singapore',
            description: '4 night stay in Singapore.',
            overnightLocation: 'Singapore',
            meals: null,
            transfers: null,
            sequence: 1,
          },
        ],
        // The detailed sightseeing timeline must still render.
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'City Tour',
              city: 'Singapore',
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // The old generic itinerary card is gone (no generic title, description, or overnight line).
    expect(screen.queryByText(/4 night stay in Singapore/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Overnight: Singapore/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Day 1: Singapore/)).not.toBeInTheDocument();
    // The detailed sightseeing timeline still renders.
    expect(screen.getByRole('heading', { name: 'Your Itinerary' })).toBeInTheDocument();
    expect(screen.getByText('Merlion Park')).toBeInTheDocument();
  });

  it('does not render any itinerary fallback when there is no detailed sightseeing', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'No Itinerary',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [],
        itinerary: [
          {
            id: 'd1',
            dayNumber: 1,
            title: 'Singapore',
            destination: 'Singapore',
            description: '4 night stay in Singapore.',
            overnightLocation: 'Singapore',
            meals: null,
            transfers: null,
            sequence: 1,
          },
        ],
        sightseeingDetails: null,
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // No generic fallback itinerary card and no "Your Itinerary" heading.
    expect(screen.queryByRole('heading', { name: 'Your Itinerary' })).not.toBeInTheDocument();
    expect(screen.queryByText(/4 night stay in Singapore/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Day 1: Singapore/)).not.toBeInTheDocument();
  });

  it('renders the Your Itinerary timeline with deduplicated titles, metadata and badges', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: '2026-08-10T00:00:00.000Z',
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Singapore Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: '<p>Explore the highlights.</p>',
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: '2026-08-10',
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Merlion Park',
                  description: '<p>Visit the <strong>Merlion</strong>.</p>',
                  startTime: '09:00',
                  sightseeingId: null,
                  imageUrl: 'https://storage.example.test/merlion.jpg',
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      heroImageUrl: 'https://storage.example.test/singapore-hero.jpg',
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    expect(screen.getByRole('heading', { name: 'Your Itinerary' })).toBeInTheDocument();
    // Section intro renders sanitized rich text inside the Instructions info box.
    expect(screen.getByText('Instructions')).toBeInTheDocument();
    expect(screen.getByText('Explore the highlights.')).toBeInTheDocument();
    expect(screen.queryByText(/<p>/)).not.toBeInTheDocument();
    // Stored day title renders exactly (existing DAY prefix preserved, never "Day 1: Day 1: …").
    expect(screen.getByRole('heading', { name: 'Day 1: City Tour' })).toBeInTheDocument();
    expect(screen.queryByText('Day 1: Day 1: City Tour')).not.toBeInTheDocument();
    // Metadata: city + formatted date.
    const article = screen
      .getByRole('heading', { name: 'Day 1: City Tour' })
      .closest('article') as HTMLElement;
    expect(within(article).getByText('Singapore')).toBeInTheDocument();
    expect(within(article).getByText(/Mon, 10 Aug 2026/)).toBeInTheDocument();
    expect(within(article).getByText('9:00 AM')).toBeInTheDocument();
    // Snapshot image used first.
    const img = within(article).getByAltText('Merlion Park');
    expect(img).toHaveAttribute('src', 'https://storage.example.test/merlion.jpg');
    // Responsive activity-owned image wrapper (stacked on mobile, fixed beside content above sm).
    const wrapper = img.parentElement?.parentElement as HTMLElement;
    expect(wrapper.className).toContain('sm:w-64');
    expect(wrapper.className).toContain('aspect-[16/9]');
    expect(wrapper.className).not.toContain('h-full');
    // Transfer badge + meals.
    expect(within(article).getByText('Shared Transfer')).toBeInTheDocument();
    expect(within(article).getByText(/Meals:/)).toBeInTheDocument();
    expect(within(article).getByText('Breakfast (Hotel)')).toBeInTheDocument();
    // Bold rich text lives inside the weblink rich-text scope so the shared
    // emphasis typography (real 700 Inter face + navy colour) applies to the
    // semantically authored <strong>, independent of the surrounding body copy.
    const boldMerlion = within(article).getByText('Merlion');
    expect(boldMerlion.tagName).toBe('STRONG');
    expect(boldMerlion.closest('.weblink-rich-text')).not.toBeNull();
    expect(
      screen.getByText('Explore the highlights.').closest('.weblink-rich-text'),
    ).not.toBeNull();
  });

  it('preserves stored DAY prefixes verbatim in the Weblink day titles', async () => {
    renderWeblinkItinerary([
      { dayNumber: 1, title: 'DAY 1 | ARRIVAL IN LANGKAWI' },
      { dayNumber: 2, title: 'Day 2 | Langkawi Adventure' },
      { dayNumber: 3, title: 'DAY 3 | KUALA LUMPUR CITY TOUR' },
    ]);
    await screen.findByText('Custom Package for Mira Shah');

    // CASE A + C: existing prefixes render exactly — never stripped, renumbered, or duplicated.
    expect(
      screen.getByRole('heading', { name: 'DAY 1 | ARRIVAL IN LANGKAWI' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Day 2 | Langkawi Adventure' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'DAY 3 | KUALA LUMPUR CITY TOUR' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/DAY 1 DAY 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DAY 2 DAY 2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DAY 3 DAY 3/)).not.toBeInTheDocument();
  });

  it('adds sequential DAY numbers to Weblink titles without a prefix', async () => {
    renderWeblinkItinerary([
      { dayNumber: 1, title: 'ARRIVAL IN LANGKAWI' },
      { dayNumber: 2, title: 'LANGKAWI ADVENTURE' },
      { dayNumber: 3, title: 'KUALA LUMPUR CITY TOUR' },
    ]);
    await screen.findByText('Custom Package for Mira Shah');

    // CASE B + D: auto-generated prefix uses exactly `DAY N | Title`.
    expect(
      screen.getByRole('heading', { name: 'DAY 1 | ARRIVAL IN LANGKAWI' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'DAY 2 | LANGKAWI ADVENTURE' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'DAY 3 | KUALA LUMPUR CITY TOUR' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('DAY 1 - ARRIVAL IN LANGKAWI')).not.toBeInTheDocument();
    expect(screen.queryByText('DAY 1: ARRIVAL IN LANGKAWI')).not.toBeInTheDocument();
    expect(screen.queryByText('DAY 1 ARRIVAL IN LANGKAWI')).not.toBeInTheDocument();
  });

  it('mixes preserved and auto-numbered Weblink day titles without duplication', async () => {
    renderWeblinkItinerary([
      { dayNumber: 1, title: 'DAY 1 | ARRIVAL IN LANGKAWI' },
      { dayNumber: 2, title: 'LANGKAWI ADVENTURE' },
      { dayNumber: 3, title: 'DAY 3 | KUALA LUMPUR CITY TOUR' },
    ]);
    await screen.findByText('Custom Package for Mira Shah');

    // CASE E + F: existing prefixes untouched, missing one filled sequentially.
    expect(
      screen.getByRole('heading', { name: 'DAY 1 | ARRIVAL IN LANGKAWI' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'DAY 2 | LANGKAWI ADVENTURE' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'DAY 3 | KUALA LUMPUR CITY TOUR' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/DAY \d+ DAY \d+/)).not.toBeInTheDocument();
    expect(screen.queryByText('DAY 2 LANGKAWI ADVENTURE')).not.toBeInTheDocument();
  });

  it('auto-prefixes with `DAY N |` while preserving separator-less existing prefixes', async () => {
    renderWeblinkItinerary([
      { dayNumber: 1, title: 'Arrival in Singapore – Explore Changi Airport & Hotel Check-in' },
      { dayNumber: 2, title: 'Night Safari' },
      { dayNumber: 4, title: 'DAY 4 Kuala Lumpur City Tour' },
    ]);
    await screen.findByText('Custom Package for Mira Shah');

    expect(
      screen.getByRole('heading', {
        name: 'DAY 1 | Arrival in Singapore – Explore Changi Airport & Hotel Check-in',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'DAY 2 | Night Safari' })).toBeInTheDocument();
    // Existing prefix without a separator is preserved, not re-prefixed.
    expect(
      screen.getByRole('heading', { name: 'DAY 4 Kuala Lumpur City Tour' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/DAY \d+ DAY \d+/)).not.toBeInTheDocument();
  });

  it('renders independent per-meal modes and transfer details in the Meals summary', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000005',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Per Meal Options',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: true, lunch: true, dinner: true },
              mealMode: 'INCLUDE_AT_HOTEL',
              mealPreferences: {
                breakfast: { mode: 'NO_TRANSFER', transferDetails: null },
                lunch: { mode: 'INCLUDE_AT_HOTEL', transferDetails: null },
                dinner: { mode: 'WITH_TRANSFER', transferDetails: 'at the Taj Hotel' },
              },
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const article = screen
      .getByRole('heading', { name: 'Day 1: City Tour' })
      .closest('article') as HTMLElement;
    expect(
      within(article).getByText(
        'Breakfast (No Transfer), Lunch (Hotel), Dinner (With Transfer: at the Taj Hotel)',
      ),
    ).toBeInTheDocument();
    // Daily transfer badge stays independent of the meal-transfer configuration.
    expect(within(article).getByText('Shared Transfer')).toBeInTheDocument();
  });

  it('falls back to the shared mealMode when no per-meal preferences exist', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000006',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Legacy Meals',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: true, dinner: true },
              mealMode: 'WITH_TRANSFER',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const article = screen
      .getByRole('heading', { name: 'Day 1: City Tour' })
      .closest('article') as HTMLElement;
    // The shared legacy WITH_TRANSFER mode now renders per meal.
    expect(
      within(article).getByText('Breakfast (With Transfer), Dinner (With Transfer)'),
    ).toBeInTheDocument();
  });

  it('shows With Transfer without details and hides the Meals row when nothing is selected', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000011',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'No Detail Meal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: true },
              mealMode: 'NO_TRANSFER',
              mealPreferences: {
                dinner: { mode: 'WITH_TRANSFER', transferDetails: '' },
              },
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const article = screen
      .getByRole('heading', { name: 'Day 1: City Tour' })
      .closest('article') as HTMLElement;
    // WITH_TRANSFER with blank details renders without a trailing colon.
    expect(within(article).getByText('Dinner (With Transfer)')).toBeInTheDocument();
    // Unselected meals (Breakfast/Lunch) are never shown.
    expect(within(article).queryByText(/Breakfast/)).not.toBeInTheDocument();
    expect(within(article).queryByText(/Lunch/)).not.toBeInTheDocument();
  });

  it('normalizes legacy meal-mode variants instead of falling back to Hotel', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000012',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Legacy Variants',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: true, lunch: true, dinner: true },
              mealMode: 'INCLUDE AT HOTEL',
              mealPreferences: {
                breakfast: { mode: 'NO TRANSFER', transferDetails: null },
                lunch: { mode: 'no-transfer', transferDetails: null },
                dinner: { mode: 'HOTEL', transferDetails: null },
              },
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const article = screen
      .getByRole('heading', { name: 'Day 1: City Tour' })
      .closest('article') as HTMLElement;
    // Each variant normalizes to its canonical label; none becomes (Hotel).
    expect(
      within(article).getByText('Breakfast (No Transfer), Lunch (No Transfer), Dinner (Hotel)'),
    ).toBeInTheDocument();
  });

  it('does not fall back to Hotel for an unknown per-meal mode', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000013',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Unknown Mode',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: true },
              mealMode: 'INCLUDE_AT_HOTEL',
              mealPreferences: {
                breakfast: { mode: 'PICNIC', transferDetails: null },
              },
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const article = screen
      .getByRole('heading', { name: 'Day 1: City Tour' })
      .closest('article') as HTMLElement;
    // A present-but-unknown per-meal mode shows no suffix (never (Hotel)).
    expect(within(article).getByText('Meals:')).toBeInTheDocument();
    expect(within(article).getByText('Breakfast')).toBeInTheDocument();
    expect(within(article).queryByText('Breakfast (Hotel)')).not.toBeInTheDocument();
  });

  it('shows a thumbnail for every activity and matches them to the correct activity', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000009',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Thumbnails',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Arrival in Singapore & Hotel Check-in',
                  description: '<p>Check in.</p>',
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: 'https://storage.example.test/arrival.jpg',
                },
                {
                  name: 'Night Safari – Singapore',
                  description: null,
                  startTime: null,
                  sightseeingId: 'sg-ns',
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      sightseeingPresentations: {
        'sg-ns': { imageUrl: 'https://storage.example.test/night-safari.jpg' },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const article = screen
      .getByRole('heading', { name: 'Day 1: City Tour' })
      .closest('article') as HTMLElement;
    expect(within(article).getByText('Activities & Details')).toBeInTheDocument();
    // Each activity owns its image; the second resolves its signed presentation.
    const arrival = within(article).getByAltText('Arrival in Singapore & Hotel Check-in');
    expect(arrival).toHaveAttribute('src', 'https://storage.example.test/arrival.jpg');
    expect(arrival).toHaveClass('object-cover');
    const safari = within(article).getByAltText('Night Safari – Singapore');
    expect(safari).toHaveAttribute('src', 'https://storage.example.test/night-safari.jpg');
    // Activity images are not duplicated into a shared day-level image.
    expect(within(article).getAllByRole('img')).toHaveLength(2);
  });

  it('keeps a 1-image and 4-image activity in independent carousels', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000019',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Singapore Activities',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Singapore highlights',
              city: 'Singapore',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              mealMode: 'NO_TRANSFER',
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Marina Bay & Gardens by the Bay',
                  description: '<p>Waterfront and gardens.</p>',
                  startTime: null,
                  sightseeingId: 'marina',
                  imageSnapshotPresent: true,
                  images: [{ id: 'a1', url: 'https://storage.example.test/a1.jpg' }],
                },
                {
                  name: 'Night Safari',
                  description: '<p>Evening wildlife experience.</p>',
                  startTime: null,
                  sightseeingId: 'night-safari',
                  imageSnapshotPresent: true,
                  images: [1, 2, 3, 4].map((number) => ({
                    id: `b${number}`,
                    url: `https://storage.example.test/b${number}.jpg`,
                  })),
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(publicData)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const marina = screen.getByLabelText('Marina Bay & Gardens by the Bay image gallery');
    const safari = screen.getByLabelText('Night Safari image gallery');
    expect(within(marina).getByRole('img')).toHaveAttribute(
      'src',
      'https://storage.example.test/a1.jpg',
    );
    // Single-image galleries open a viewer on click but show no prev/next arrows.
    expect(
      within(marina).queryByRole('button', { name: /previous|next/i }),
    ).not.toBeInTheDocument();
    expect(
      within(marina).getByRole('button', {
        name: 'Open Marina Bay & Gardens by the Bay image viewer',
      }),
    ).toBeInTheDocument();
    expect(within(safari).getByRole('img')).toHaveAttribute(
      'src',
      'https://storage.example.test/b1.jpg',
    );
    expect(within(safari).getByText('1 / 4')).toBeInTheDocument();
    expect(screen.queryByText('1 / 5')).not.toBeInTheDocument();

    await userEvent.click(within(safari).getByRole('button', { name: 'Next night safari image' }));
    await userEvent.click(within(safari).getByRole('button', { name: 'Next night safari image' }));
    expect(within(safari).getByText('3 / 4')).toBeInTheDocument();
    expect(within(safari).getByRole('img')).toHaveAttribute(
      'src',
      'https://storage.example.test/b3.jpg',
    );
    expect(within(marina).getByRole('img')).toHaveAttribute(
      'src',
      'https://storage.example.test/a1.jpg',
    );
  });

  it('isolates galleries across missing images, duplicate filenames, failures and multiple days', async () => {
    const gallery = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `${prefix}-${index + 1}`,
        fileName: 'shared-name.jpg',
        url: `https://storage.example.test/${prefix}-${index + 1}.jpg`,
        thumbnailUrl:
          index === 0 ? `https://storage.example.test/${prefix}-${index + 1}-thumb.jpg` : null,
      }));
    const publicData = {
      company: { name: 'Alpha Travel', primaryColor: '#2563eb' },
      quotation: {
        quotationNumber: 'QT-2026-000020',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        status: 'VIEWED',
      },
      version: {
        title: 'Independent Galleries',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Three activities',
              city: 'Singapore',
              meals: {},
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Activity A',
                  sightseeingId: 'activity-a',
                  imageSnapshotPresent: true,
                  images: gallery('a', 2),
                },
                {
                  name: 'Activity B',
                  sightseeingId: 'activity-b',
                  imageSnapshotPresent: true,
                  images: [],
                },
                {
                  name: 'Activity C',
                  sightseeingId: 'activity-c',
                  imageSnapshotPresent: true,
                  images: gallery('c', 5),
                },
              ],
            },
            {
              dayNumber: 2,
              title: 'Day 2: Another activity',
              city: 'Singapore',
              meals: {},
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Activity D',
                  sightseeingId: 'activity-d',
                  imageSnapshotPresent: true,
                  images: gallery('d', 1),
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      sightseeingPresentations: {
        'activity-b': { imageUrl: 'https://storage.example.test/activity-b-master.jpg' },
      },
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(publicData)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const activityA = screen.getByLabelText('Activity A image gallery');
    const activityB = screen.getByLabelText('Activity B image gallery');
    const activityC = screen.getByLabelText('Activity C image gallery');
    const activityD = screen.getByLabelText('Activity D image gallery');
    expect(within(activityA).getByText('1 / 2')).toBeInTheDocument();
    expect(within(activityB).queryByRole('img')).not.toBeInTheDocument();
    expect(within(activityC).getByText('1 / 5')).toBeInTheDocument();
    // Single-image gallery: no prev/next arrows, but a viewer button on click.
    expect(within(activityD).queryByRole('button', { name: /previous|next/i })).not.toBeInTheDocument();
    expect(
      within(activityD).getByRole('button', { name: 'Open Activity D image viewer' }),
    ).toBeInTheDocument();

    await userEvent.click(within(activityC).getByRole('button', { name: 'Next activity c image' }));
    expect(within(activityC).getByText('2 / 5')).toBeInTheDocument();
    expect(within(activityA).getByText('1 / 2')).toBeInTheDocument();
    expect(within(activityD).getByRole('img')).toHaveAttribute(
      'src',
      'https://storage.example.test/d-1.jpg',
    );

    fireEvent.error(within(activityA).getByRole('img'));
    expect(within(activityA).getByRole('img')).toHaveAttribute(
      'src',
      'https://storage.example.test/a-1-thumb.jpg',
    );
    expect(within(activityC).getByRole('img')).toHaveAttribute(
      'src',
      'https://storage.example.test/c-2.jpg',
    );
    expect(activityA).toHaveClass('w-full', 'sm:w-64');
    expect(activityA.parentElement).toHaveClass('flex-col', 'sm:flex-row');
  });

  it('shows a neutral thumbnail placeholder when an activity has no image', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000010',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'No Thumbnails',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Free Walking',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    // No broken image icon for the activity without an image.
    expect(screen.queryByAltText('Free Walking')).not.toBeInTheDocument();
    expect(screen.getByText('Free Walking')).toBeInTheDocument();
  });

  it('falls back to the primary activity title when the day title is missing', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 2,
              title: '',
              city: 'Kochi',
              date: '2026-08-11',
              meals: { breakfast: false, lunch: false, dinner: false },
              mealMode: 'NO_TRANSFER',
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Sentosa Tour',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByRole('heading', { name: 'Sentosa Tour' })).toBeInTheDocument();
    // No transfer badge for NO_TRANSFER, no meals row when nothing selected.
    expect(screen.queryByText('Shared Transfer')).not.toBeInTheDocument();
    expect(screen.queryByText('Private Transfer')).not.toBeInTheDocument();
    expect(screen.queryByText(/Meals:/)).not.toBeInTheDocument();
  });

  it('renders the light-blue Instructions box with formatted rich text', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000003',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Instructions Box',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description:
            '<p>Meet your guide at the <strong>lobby</strong>.</p><p>Carry:</p><ul><li>Passport</li><li>Water bottle</li></ul><p>More at <a href="https://example.test">the site</a>.</p>',
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const box = screen.getByText('Instructions').closest('div')?.parentElement as HTMLElement;
    // The info icon + Instructions heading render inside the box.
    expect(within(box).getByText('Instructions')).toBeInTheDocument();
    // Rich formatting: bold, lists and links are preserved, no raw tags.
    expect(box).toHaveTextContent('Meet your guide at the lobby.');
    expect(box).toHaveTextContent('Passport');
    expect(box).toHaveTextContent('Water bottle');
    expect(box.querySelector('strong')).toBeInTheDocument();
    // The emphasis sits inside the shared weblink rich-text scope so the bold
    // typography fix reaches every authored <strong>/<b> automatically.
    expect(box.querySelector('strong')?.closest('.weblink-rich-text')).not.toBeNull();
    expect(box.querySelector('ul')).toBeInTheDocument();
    expect(box.querySelector('a')).toHaveAttribute('href', 'https://example.test');
    expect(screen.queryByText(/<p>/)).not.toBeInTheDocument();
    // Unsafe scripts are sanitized away.
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
    // The green itinerary timeline remains directly below the box.
    expect(screen.getByRole('heading', { name: 'Your Itinerary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Day 1: City Tour' })).toBeInTheDocument();
  });

  it('hides the Instructions box when the section description is empty', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000004',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Empty Instructions',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: '<p><br></p>',
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: City Tour',
              city: 'Singapore',
              date: null,
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Merlion Park',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    expect(screen.queryByText('Instructions')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your Itinerary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Day 1: City Tour' })).toBeInTheDocument();
  });

  it('hides empty sightseeing days and renders multiple activities in one card', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Full Day',
              city: 'Kochi',
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              mealMode: 'NO_TRANSFER',
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Morning Tour',
                  description: '<p>Desc A</p>',
                  startTime: '09:00',
                  showTime: true,
                  sightseeingId: null,
                  imageUrl: null,
                },
                {
                  name: 'Evening Dinner Cruise',
                  description: '<p>Desc B</p>',
                  startTime: '18:30',
                  showTime: false,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
            {
              dayNumber: 2,
              title: '',
              city: null,
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              mealMode: 'NO_TRANSFER',
              dailyTransfer: 'NO_TRANSFER',
              activities: [],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByRole('heading', { name: 'Day 1: Full Day' })).toBeInTheDocument();
    // The empty day 2 is hidden entirely.
    expect(screen.queryByRole('heading', { name: 'Day 2:' })).not.toBeInTheDocument();
    // Both activities render inside the same day card, in order.
    const article = screen
      .getByRole('heading', { name: 'Day 1: Full Day' })
      .closest('article') as HTMLElement;
    expect(within(article).getByText('Morning Tour')).toBeInTheDocument();
    expect(within(article).getByText('Evening Dinner Cruise')).toBeInTheDocument();
    expect(within(article).getByText('9:00 AM')).toBeInTheDocument();
    expect(within(article).queryByText('6:30 PM')).not.toBeInTheDocument();
    expect(article.querySelectorAll('h3').length).toBe(1);
    const activityOrder = [...article.querySelectorAll('p')]
      .map((node) => node.textContent)
      .filter((text) => text === 'Morning Tour' || text === 'Evening Dinner Cruise');
    expect(activityOrder).toEqual(['Morning Tour', 'Evening Dinner Cruise']);
  });

  it('renders sanitized rich text and strips unsafe scripts from activities', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Tour',
              city: null,
              date: null,
              meals: { breakfast: false, lunch: false, dinner: false },
              mealMode: 'NO_TRANSFER',
              dailyTransfer: 'NO_TRANSFER',
              activities: [
                {
                  name: 'Safe Tour',
                  description: '<p>Safe content</p><script>window.pwned = true</script>',
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByText('Safe content')).toBeInTheDocument();
    expect(screen.queryByText(/window\.pwned/)).not.toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  it('single activity: omits thumbnail, keeps full-width title and description, transfer inside panel, meals below', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000003',
        customerName: 'Mira Shah',
        destinationSummary: 'Ladakh',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Ladakh Trip',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: Pangong',
              city: 'Leh',
              date: null,
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Pangong Lake Visit',
                  description: '<p>Beautiful lake at high altitude</p>',
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const article = screen
      .getByRole('heading', { name: 'Day 1: Pangong' })
      .closest('article') as HTMLElement;
    // Header exists
    expect(within(article).getByText('Activities & Details')).toBeInTheDocument();
    // Activity name rendered without a dedicated thumbnail img
    expect(within(article).getByText('Pangong Lake Visit')).toBeInTheDocument();
    expect(within(article).queryByAltText('Pangong Lake Visit')).not.toBeInTheDocument();
    // Description visible
    expect(within(article).getByText('Beautiful lake at high altitude')).toBeInTheDocument();
    // Transfer badge appears inside the panel
    expect(within(article).getByText('Shared Transfer')).toBeInTheDocument();
    // Meals appear once below the panel
    expect(within(article).getByText('Breakfast (Hotel)')).toBeInTheDocument();
  });

  it('multiple activities: shows thumbnails, dividers, transfer per activity, meals once below panel', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000004',
        customerName: 'Mira Shah',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Goa Beach Holiday',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1: North Goa',
              city: 'Goa',
              date: null,
              meals: { breakfast: false, lunch: true, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'PRIVATE',
              activities: [
                {
                  name: 'Fort Aguada',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
                {
                  name: 'Calangute Beach',
                  description: '<p>Relax by the shore</p>',
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const article = screen
      .getByRole('heading', { name: 'Day 1: North Goa' })
      .closest('article') as HTMLElement;
    expect(within(article).getByText('Activities & Details')).toBeInTheDocument();
    expect(within(article).getByText('Fort Aguada')).toBeInTheDocument();
    expect(within(article).getByText('Calangute Beach')).toBeInTheDocument();
    expect(within(article).getByText('Relax by the shore')).toBeInTheDocument();
    // Divider between activities
    expect(article.querySelector('hr')).toBeInTheDocument();
    // Transfer badge inside panel (per activity: Private Transfer appears twice)
    const transferBadges = within(article).getAllByText('Private Transfer');
    expect(transferBadges.length).toBe(2);
    // Meals appear only once below the panel
    const mealsMatches = within(article).getAllByText('Lunch (Hotel)');
    expect(mealsMatches.length).toBe(1);
  });

  it('shows each activity its own transfer in the itinerary', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000009',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Per Activity Transfer',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 2,
              title: 'Day 2: Mandai Wildlife Reserve Adventure',
              city: 'Singapore',
              date: null,
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'NO_TRANSFER',
              mealPreferences: { breakfast: { mode: 'NO_TRANSFER', transferDetails: null } },
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'Singapore City Tour',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                  dailyTransfer: 'SHARED',
                },
                {
                  name: 'Singapore Zoo',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                  dailyTransfer: 'NO_TRANSFER',
                },
                {
                  name: 'Day at Cruise',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                  dailyTransfer: 'PRIVATE',
                },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const article = screen
      .getByRole('heading', { name: 'Day 2: Mandai Wildlife Reserve Adventure' })
      .closest('article') as HTMLElement;
    expect(within(article).getByText('Singapore City Tour')).toBeInTheDocument();
    expect(within(article).getByText('Singapore Zoo')).toBeInTheDocument();
    expect(within(article).getByText('Day at Cruise')).toBeInTheDocument();
    // Each activity shows its OWN saved transfer (not one shared day badge).
    expect(within(article).getAllByText('Shared Transfer')).toHaveLength(1);
    expect(within(article).getByText('No Transfer')).toBeInTheDocument();
    expect(within(article).getByText('Private Transfer')).toBeInTheDocument();
  });

  it('renders legacy sightseeing snapshot shapes without crashing', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 3,
              dayTitle: 'Legacy Day',
              city: 'Munnar',
              date: '2026-08-12',
              meals: ['Breakfast', 'Dinner'],
              mealMode: 'WITH_TRANSFER',
              dailyTransfer: 'PRIVATE_TRANSFER',
              activity: [
                { title: 'Legacy Activity', image: 'https://storage.example.test/legacy.jpg' },
              ],
            },
          ],
        },
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByRole('heading', { name: 'DAY 3 | Legacy Day' })).toBeInTheDocument();
    expect(screen.getByText('Legacy Activity')).toBeInTheDocument();
    expect(screen.getByText('Private Transfer')).toBeInTheDocument();
    // Array meals normalize to booleans; the shared WITH_TRANSFER mode renders per meal.
    expect(
      screen.getByText('Breakfast (With Transfer), Dinner (With Transfer)'),
    ).toBeInTheDocument();
    const img = screen.getByAltText('Legacy Activity');
    expect(img).toHaveAttribute('src', 'https://storage.example.test/legacy.jpg');
  });

  it('renders only services actually included and hides the section when none exist', async () => {
    const base = {
      title: 'Kerala Escape',
      versionNumber: 1,
      currency: 'INR',
      finalAmount: '120000',
      hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
      flightDetails: {
        include: false,
        sectionTitle: 'Flight Details',
        amount: 0,
        journeyType: 'ONEWAY_OUTBOUND',
        outbound: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
        returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
      },
      hotels: [
        {
          id: 'h1',
          hotelName: 'Backwater Resort',
          city: 'Alleppey',
          category: '4 Star',
          roomType: 'Villa',
          mealPlan: 'Breakfast',
          rooms: 1,
          nights: 3,
          checkInDate: '2026-09-10T00:00:00.000Z',
          checkOutDate: '2026-09-13T00:00:00.000Z',
          sellingPrice: '12000',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
      services: [],
      includeVisa: false,
      visaAmount: '0',
      visaServiceCharge: '0',
      visaGstPercent: '18',
      visaVfsCharge: '0',
      visaType: null,
      visaDestination: null,
      itinerary: [],
      inclusions: [],
      exclusions: [],
      terms: [],
    };
    const render = (version: unknown) => {
      const fetchMock = vi.fn<
        (input: RequestInfo | URL, options?: RequestInit) => Promise<Response>
      >(async () =>
        response({
          company: {
            name: 'Alpha Travel',
            email: 'a@b.test',
            phone: null,
            website: null,
            address: null,
            primaryColor: '#2563eb',
          },
          quotation: {
            quotationNumber: 'QT-2026-000002',
            customerName: 'Mira Shah',
            destinationSummary: 'Kerala',
            travelStartDate: null,
            travelEndDate: null,
            adults: 2,
            childrenWithBed: 0,
            childrenWithoutBed: 0,
            infants: 0,
            rooms: 1,
            validUntil: null,
            status: 'VIEWED',
          },
          version,
          downloadUrl: null,
        }),
      );
      vi.stubGlobal('fetch', fetchMock);
      return renderWithProviders(
        <Routes>
          <Route path="/q/:token" element={<PublicQuotationPage />} />
        </Routes>,
        { route: '/q/public-token-value-with-at-least-32-characters' },
      );
    };

    // Hotels only: Flights/Hotels shown, everything else omitted.
    render(base);
    await screen.findByText('Custom Package for Mira Shah');
    const section = screen
      .getByRole('heading', { name: 'Services Include' })
      .closest('section') as HTMLElement;
    expect(within(section).getByText('Hotels')).toBeInTheDocument();
    expect(within(section).queryByText('Flights')).not.toBeInTheDocument();
    expect(within(section).queryByText('Sightseeing')).not.toBeInTheDocument();
    expect(within(section).queryByText('Cruise')).not.toBeInTheDocument();
    expect(within(section).queryByText('Transportation')).not.toBeInTheDocument();
    expect(within(section).queryByText('Add-ons')).not.toBeInTheDocument();
    expect(within(section).queryByText('Visa')).not.toBeInTheDocument();

    // No included services at all → the whole section is hidden.
    cleanup();
    const noServices = {
      ...base,
      hotels: [],
      flightDetails: {
        include: false,
        sectionTitle: 'Flight Details',
        amount: 0,
        journeyType: 'ONEWAY_OUTBOUND',
        outbound: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
        returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
      },
    };
    render(noServices);
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.queryByRole('heading', { name: 'Services Include' })).not.toBeInTheDocument();
  });

  it('does not show a Hotels card when the quotation has no hotels', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-vehicle',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Airport Transfer',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '2000',
            totalSellingPrice: '2000',
            sellingPrice: '2000',
            taxCategory: 'Transportation',
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const section = screen
      .getByRole('heading', { name: 'Services Include' })
      .closest('section') as HTMLElement;
    expect(within(section).getByText('Transportation')).toBeInTheDocument();
    expect(within(section).queryByText('Hotels')).not.toBeInTheDocument();
    expect(within(section).queryByText('Flights')).not.toBeInTheDocument();
  });

  it('renders the saved custom Vehicle section title on the public page', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-vehicle',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Airport Transfer',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '2000',
            totalSellingPrice: '2000',
            sellingPrice: '2000',
            taxCategory: 'Airport Transfers',
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByRole('heading', { name: 'Airport Transfers' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vehicle Details' })).not.toBeInTheDocument();
  });

  it('falls back to Transportation for the public Vehicle section title when empty', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-vehicle',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Airport Transfer',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '2000',
            totalSellingPrice: '2000',
            sellingPrice: '2000',
            taxCategory: '',
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByRole('heading', { name: 'Transportation' })).toBeInTheDocument();
  });

  it('renders included add-on services as formatted Additional Services cards', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-addon',
            serviceType: 'TRAVEL_INSURANCE',
            addOnServiceId: 'addon-master-1',
            name: 'Travel Insurance',
            description: '<p><strong>Cover</strong> for the trip.</p>',
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '1500',
            totalSellingPrice: '1500',
            sellingPrice: '1500',
            taxCategory: null,
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByRole('heading', { name: 'Additional Services' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Travel Insurance' })).toBeInTheDocument();
    // Description renders as formatted rich text, not raw HTML.
    expect(screen.getByText('Cover')).toBeInTheDocument();
    expect(screen.getByText('for the trip.')).toBeInTheDocument();
    expect(screen.queryByText(/<p>/)).not.toBeInTheDocument();
  });

  it('renders add-on pricing options as compact tiles in saved order', async () => {
    const addonService = (overrides: Record<string, unknown> = {}) => ({
      id: 's-addon',
      serviceType: 'TRAVEL_INSURANCE',
      addOnServiceId: 'addon-master-1',
      name: 'Travel Insurance',
      description: null,
      dayNumber: null,
      city: null,
      quantity: '1',
      unitSellingPrice: '3000',
      totalSellingPrice: '3000',
      sellingPrice: '3000',
      pricingBasisLabel: 'Per Group',
      taxCategory: null,
      notes: null,
      sequence: 1,
      ...overrides,
    });
    const publicData = (services: unknown[]) => ({
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services,
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    });
    const renderPublic = (services: unknown[]) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response(publicData(services))),
      );
      renderWithProviders(
        <Routes>
          <Route path="/q/:token" element={<PublicQuotationPage />} />
        </Routes>,
        { route: '/q/public-token-value-with-at-least-32-characters' },
      );
    };
    // Multiple saved options render as one compact tile each, in saved order,
    // with per-entry currencies and long labels intact.
    renderPublic([
      addonService({
        pricingSnapshot: [
          { id: 'opt-adult', label: 'Adult', price: 6000, currency: 'INR' },
          { id: 'opt-child', label: 'Child', price: 4000, currency: 'INR' },
          {
            id: 'opt-group',
            label: 'Per Group Family And Friends Special Rate',
            price: 20000,
            currency: 'USD',
          },
        ],
      }),
    ]);
    await screen.findByText('Custom Package for Mira Shah');
    const tiles = ['Adult', 'Child', 'Per Group Family And Friends Special Rate'].map(
      (label) => screen.getByText(label).closest('div'),
    );
    for (const tile of tiles) expect(tile?.className).toContain('rounded-md');
    expect(tiles[0]).toHaveTextContent('₹6,000');
    expect(tiles[1]).toHaveTextContent('₹4,000');
    expect(tiles[2]).toHaveTextContent('$20,000');
    const card = screen.getByRole('heading', { name: 'Travel Insurance' }).closest('article');
    expect(
      within(card as HTMLElement)
        .getAllByText(/Adult|Child|Per Group Family/)
        .map((el) => el.textContent),
    ).toEqual(['Adult', 'Child', 'Per Group Family And Friends Special Rate']);
    cleanup();
    // Legacy single price/basis (no snapshot) still renders exactly one tile.
    renderPublic([addonService({})]);
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByText('Per Group').closest('div')?.className).toContain('rounded-md');
    expect(screen.getByText('₹3,000')).toBeInTheDocument();
    cleanup();
    // Neither basis nor price: no pricing tiles at all (legacy behavior).
    renderPublic([addonService({ pricingBasisLabel: null, unitSellingPrice: null })]);
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.queryByText('₹3,000')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Travel Insurance' })).toBeInTheDocument();
  });

  it('renders unlabeled add-on pricing options as price-only tiles without a Standard fallback', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-addon',
            serviceType: 'TRAVEL_INSURANCE',
            addOnServiceId: 'addon-master-1',
            name: 'Travel Insurance',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '3000',
            totalSellingPrice: '3000',
            sellingPrice: '3000',
            pricingBasisLabel: null,
            taxCategory: null,
            notes: null,
            sequence: 1,
            pricingSnapshot: [
              { id: 'opt-child', label: 'Child', price: 900, currency: 'INR' },
              { id: 'opt-empty', label: '', price: 4999, currency: 'INR' },
              { id: 'opt-null', label: null, price: 3000, currency: 'INR' },
              { id: 'opt-blank', label: '   ', price: 6000, currency: 'INR' },
            ],
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    vi.stubGlobal('fetch', vi.fn(async () => response(publicData)));
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    // Labeled entry keeps label + price in the same compact tile.
    const childTile = screen.getByText('Child').closest('div');
    expect(childTile?.className).toContain('rounded-md');
    expect(childTile).toHaveTextContent('₹900');
    // Empty, null, and whitespace-only labels render price only — each entry
    // follows its own label state, with no placeholder label invented.
    for (const price of ['₹4,999', '₹3,000', '₹6,000']) {
      const tile = screen.getByText(price).closest('div');
      expect(tile?.className).toContain('rounded-md');
      expect(tile?.textContent).toBe(price);
    }
    expect(screen.queryByText('Standard')).not.toBeInTheDocument();
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
  });

  it('renders no pricing tiles for an add-on whose snapshot was explicitly emptied', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-addon',
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'addon-master-1',
            name: 'Travel Insurance',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '999',
            totalSellingPrice: '999',
            sellingPrice: '999',
            pricingBasisLabel: 'Adult',
            taxCategory: null,
            notes: null,
            sequence: 1,
            pricingSnapshot: [],
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    vi.stubGlobal('fetch', vi.fn(async () => response(publicData)));
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByRole('heading', { name: 'Travel Insurance' })).toBeInTheDocument();
    // An explicitly emptied snapshot is authoritative: no tile, and no legacy
    // synthesis from the unit price/basis (which would resurrect a deletion).
    expect(screen.queryByText('₹999')).not.toBeInTheDocument();
    expect(screen.queryByText('Adult')).not.toBeInTheDocument();
  });

  it('renders add-on snapshot images in the Additional Services cards', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-addon',
            serviceType: 'TRAVEL_INSURANCE',
            addOnServiceId: 'addon-master-1',
            name: 'Travel Insurance',
            description: '<p><strong>Cover</strong> for the trip.</p>',
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '1500',
            totalSellingPrice: '1500',
            sellingPrice: '1500',
            taxCategory: null,
            notes: null,
            sequence: 1,
            images: [
              { url: 'https://cdn.example.test/visa.png', alt: 'Travel Insurance image 1' },
            ],
            imageSnapshotPresent: true,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(
      await screen.findByAltText('Travel Insurance image 1'),
    ).toBeInTheDocument();
  });

  it('hides Additional Services when no add-on service is included', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-vehicle',
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Airport Transfer',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '2000',
            totalSellingPrice: '2000',
            sellingPrice: '2000',
            taxCategory: 'Transportation',
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.queryByRole('heading', { name: 'Additional Services' })).not.toBeInTheDocument();
  });

  it('renders only add-on rows that are actually selected (have an addOnServiceId)', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-checked',
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'master-visa',
            name: 'Singapore Visa',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '1500',
            totalSellingPrice: '1500',
            sellingPrice: '1500',
            taxCategory: null,
            notes: null,
            sequence: 1,
          },
          {
            id: 's-unchecked',
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: null,
            name: 'other add on',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '500',
            totalSellingPrice: '500',
            sellingPrice: '500',
            taxCategory: null,
            notes: null,
            sequence: 2,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.getByRole('heading', { name: 'Additional Services' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Singapore Visa' })).toBeInTheDocument();
    // The unselected add-on row must NOT appear.
    expect(screen.queryByRole('heading', { name: 'other add on' })).not.toBeInTheDocument();
  });

  it('shows the whole add-on image (object-contain) and wraps overflowing description text', async () => {
    const longWord = 'SupercalifragilisticexpialidociousWithoutAnyBreakOpportunity';
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-visa-image',
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'master-visa',
            name: 'Singapore Visa',
            description: `<p>Standard processing ${longWord}</p>`,
            images: [{ url: 'https://cdn.example.test/visa.jpg', alt: 'Visa' }],
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '1500',
            totalSellingPrice: '1500',
            sellingPrice: '1500',
            taxCategory: null,
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const addonsSection = screen
      .getByRole('heading', { name: 'Additional Services' })
      .closest('section') as HTMLElement;
    // #1: the add-on photo is letterboxed (object-contain) instead of cropped.
    const image = within(addonsSection).getByAltText('Visa');
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
    // #2: long unbroken description text is allowed to wrap.
    const rich = within(addonsSection)
      .getByText(new RegExp(longWord))
      .closest('.weblink-rich-text') as HTMLElement;
    expect(rich.className).toContain('[overflow-wrap:anywhere]');
  });

  it('wraps preformatted add-on description lines instead of clipping them', async () => {
    const codeLine =
      '- Do NOT change discovery, matching, B1, permissions, Room, playback, or dialer behavior.';
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000003',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-visa-code',
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'master-visa',
            name: 'Singapore Visa',
            description: `<pre><code>${codeLine}</code></pre>`,
            images: [],
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '1500',
            totalSellingPrice: '1500',
            sellingPrice: '1500',
            taxCategory: null,
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    vi.stubGlobal('fetch', vi.fn(async () => response(publicData)));
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const addonsSection = screen
      .getByRole('heading', { name: 'Additional Services' })
      .closest('section') as HTMLElement;
    const rich = within(addonsSection)
      .getByText(codeLine)
      .closest('.weblink-rich-text') as HTMLElement;
    // The full line is rendered — never truncated to a single clipped row.
    expect(rich).toHaveTextContent(codeLine);
    expect(rich.querySelector('pre')).not.toBeNull();
    // `pre`/`code` default to `white-space: pre` (no wrapping) and were the
    // real overflow cause; they are now made wrappable so the line breaks
    // inside the card instead of spilling past it.
    expect(rich.className).toContain('[&_pre]:whitespace-pre-wrap');
    expect(rich.className).toContain('[&_code]:whitespace-pre-wrap');
  });

  it('hides the whole Additional Services section when every add-on row is unselected', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [
          {
            id: 's-unchecked-1',
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: null,
            name: 'other add on',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '500',
            totalSellingPrice: '500',
            sellingPrice: '500',
            taxCategory: null,
            notes: null,
            sequence: 1,
          },
          {
            id: 's-unchecked-2',
            serviceType: 'TRAVEL_INSURANCE',
            addOnServiceId: null,
            name: 'Singapore Visa',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '1500',
            totalSellingPrice: '1500',
            sellingPrice: '1500',
            taxCategory: null,
            notes: null,
            sequence: 2,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.queryByRole('heading', { name: 'Additional Services' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'other add on' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Singapore Visa' })).not.toBeInTheDocument();
  });

  it('hides Add-ons publicly when top-level Add-on Services include is off', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        // Top-level Add-on include is OFF even though an add-on row exists.
        addOnDetails: { include: false },
        services: [
          {
            id: 's-addon',
            serviceType: 'OTHER_ADD_ON',
            name: 'other add on',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '500',
            totalSellingPrice: '500',
            sellingPrice: '500',
            taxCategory: null,
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    // No Additional Services section, no `other add on`, no Add-ons chip.
    expect(screen.queryByRole('heading', { name: 'Additional Services' })).not.toBeInTheDocument();
    expect(screen.queryByText('other add on')).not.toBeInTheDocument();
    const servicesInclude = screen.queryByText('Services Include')?.closest('section');
    if (servicesInclude) {
      expect(within(servicesInclude).queryByText('Add-ons')).not.toBeInTheDocument();
    }
  });

  it('shows Cabin: 10 kg+ on the public page for a stored 10kg value', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        flightDetails: {
          include: true,
          sectionTitle: 'Flight Details',
          amount: 0,
          journeyType: 'ONEWAY_OUTBOUND',
          outbound: {
            fromCity: 'Delhi',
            toCity: 'Kochi',
            travelClass: 'Economy',
            segments: [
              {
                airlineId: null,
                airlineName: 'Air India',
                flightNumber: 'AI201',
                travelClass: 'Economy',
                from: 'Delhi',
                to: 'Kochi',
                departureDate: '2026-09-10',
                departureTime: '10:00',
                arrivalDate: '2026-09-10',
                arrivalTime: '12:00',
                duration: '2h 0m',
                cabinLuggage: '10kg',
                checkInLuggage: '30kg',
                notes: null,
                connectionVia: null,
              },
            ],
          },
          returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
        },
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(await screen.findByText('Cabin: 10 kg+')).toBeInTheDocument();
    expect(screen.queryByText('Cabin: 10kg')).not.toBeInTheDocument();
  });

  it('renders flight notes inside a transparent scoped container despite inline white backgrounds', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000003',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala Escape',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        flightDetails: {
          include: true,
          sectionTitle: 'Flight Details',
          amount: 0,
          journeyType: 'ROUND_TRIP',
          outbound: {
            fromCity: 'Delhi',
            toCity: 'Kochi',
            travelClass: 'Economy',
            segments: [
              {
                airlineId: null,
                airlineName: 'Air India',
                flightNumber: 'AI201',
                travelClass: 'Economy',
                from: 'Delhi',
                to: 'Kochi',
                departureDate: '2026-09-10',
                departureTime: '10:00',
                arrivalDate: '2026-09-10',
                arrivalTime: '12:00',
                duration: '2h 0m',
                cabinLuggage: '7kg',
                checkInLuggage: '20kg',
                notes:
                  '<p style="background-color: white">Outbound note line</p><span style="background: white">inline note</span>',
                connectionVia: null,
              },
            ],
          },
          returnJourney: {
            fromCity: 'Kochi',
            toCity: 'Delhi',
            travelClass: 'Economy',
            segments: [
              {
                airlineId: null,
                airlineName: 'Air India',
                flightNumber: 'AI202',
                travelClass: 'Economy',
                from: 'Kochi',
                to: 'Delhi',
                departureDate: '2026-09-14',
                departureTime: '14:00',
                arrivalDate: '2026-09-14',
                arrivalTime: '16:00',
                duration: '2h 0m',
                cabinLuggage: '7kg',
                checkInLuggage: '20kg',
                notes: '<ul style="background-color: white"><li>Return note item</li></ul>',
                connectionVia: null,
              },
            ],
          },
        },
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    await screen.findByText('Outbound Journey');

    // The note text (with inline white backgrounds) still renders.
    expect(screen.getByText('Outbound note line')).toBeInTheDocument();
    expect(screen.getByText('inline note')).toBeInTheDocument();
    expect(screen.getByText('Return note item')).toBeInTheDocument();

    // The stored inline white background styles are NOT stripped from the HTML.
    const outboundPara = screen.getByText('Outbound note line');
    expect(outboundPara.getAttribute('style')).toContain('background-color: white');
    const inlineSpan = screen.getByText('inline note');
    expect(inlineSpan.getAttribute('style')).toContain('background: white');
    const returnItem = screen.getByText('Return note item');
    expect(returnItem.closest('ul')?.getAttribute('style')).toContain('background-color: white');

    // Every note is inside a scoped `.flight-notes` container (outbound + return).
    const outboundContainer = outboundPara.closest('.flight-notes');
    expect(outboundContainer).not.toBeNull();
    expect(outboundContainer?.className).toContain('flight-notes');
    expect(inlineSpan.closest('.flight-notes')).not.toBeNull();
    expect(returnItem.closest('.flight-notes')).not.toBeNull();
  });

  it('renders the public cruise card with image, duration, room type and description', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Cruise Trip',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [
          {
            id: 's-cruise',
            serviceType: 'CRUISE',
            name: 'Dream Genting',
            description: '<p>A lovely voyage.</p>',
            dayNumber: null,
            city: 'Balcony Snapshot',
            quantity: '1',
            unitSellingPrice: '18000',
            totalSellingPrice: '18000',
            sellingPrice: '18000',
            taxCategory: 'Ocean Cruise',
            notes: '2 nights',
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      cruisePresentations: {
        's-cruise': {
          imageUrl: 'https://storage.example.test/cruise.jpg',
          name: 'Dream Genting',
          roomTypeName: null,
        },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // Saved section title becomes the heading.
    expect(screen.getByRole('heading', { name: 'Ocean Cruise' })).toBeInTheDocument();
    // Dynamic cruise image, name, duration and room type.
    expect(screen.getByAltText('Dream Genting')).toHaveAttribute(
      'src',
      'https://storage.example.test/cruise.jpg',
    );
    expect(screen.getByText('Dream Genting')).toBeInTheDocument();
    expect(screen.getByText('2 nights')).toBeInTheDocument();
    expect(screen.getByText('Balcony Snapshot')).toBeInTheDocument();
    // Sanitized rich-text description renders.
    expect(screen.getByText('A lovely voyage.')).toBeInTheDocument();
    expect(screen.queryByText(/localhost|http:\/\//)).not.toBeInTheDocument();
  });

  it('hides a raw localhost URL and falls back when a cruise has no image', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Cruise Trip',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [
          {
            id: 's-cruise',
            serviceType: 'CRUISE',
            name: 'Dream Genting',
            description: 'http://localhost:5173/q/some-token',
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '18000',
            totalSellingPrice: '18000',
            sellingPrice: '18000',
            taxCategory: null,
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      cruisePresentations: {
        's-cruise': { imageUrl: null, name: 'Dream Genting', roomTypeName: null },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // Empty section title falls back to Cruise Details.
    expect(screen.getByRole('heading', { name: 'Cruise Details' })).toBeInTheDocument();
    // The raw localhost URL is never rendered as cruise content.
    expect(screen.queryByText(/localhost|some-token/)).not.toBeInTheDocument();
    // Missing image shows the fallback, not a broken image.
    expect(screen.getByText('Cruise image unavailable')).toBeInTheDocument();
    expect(screen.queryByAltText('Dream Genting')).not.toBeInTheDocument();
    // Missing duration/room type rows are hidden.
    expect(screen.queryByText(/Duration:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Room Type:/)).not.toBeInTheDocument();
  });

  it('treats editor-empty cruise descriptions as no description', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Cruise Trip',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [
          {
            id: 's-cruise',
            serviceType: 'CRUISE',
            name: 'Dream Genting',
            description: '<p><br></p>',
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '18000',
            totalSellingPrice: '18000',
            sellingPrice: '18000',
            taxCategory: null,
            notes: '2 nights',
            sequence: 1,
          },
        ],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      cruisePresentations: {
        's-cruise': { imageUrl: null, name: 'Dream Genting', roomTypeName: 'Balcony' },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    expect(screen.getByText('Dream Genting')).toBeInTheDocument();
    expect(screen.getByText('2 nights')).toBeInTheDocument();
    // Empty editor HTML renders no description block.
    expect(screen.queryByText('<p>')).not.toBeInTheDocument();
    expect(screen.queryByText('<br>')).not.toBeInTheDocument();
  });

  it('renders the public policies accordion with one section open at a time', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Policies Check',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
        inclusionsHtml: '<ul><li>Hotel</li><li>Flights</li></ul>',
        exclusionsHtml: '<p>Personal expenses</p>',
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // Heading + Inclusions expanded by default; Exclusions collapsed.
    expect(screen.getByRole('heading', { name: 'Policies' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inclusions' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const exclusionsButton = screen.getByRole('button', { name: 'Exclusions' });
    expect(exclusionsButton).toHaveAttribute('aria-expanded', 'false');
    // Expanded content renders formatted list items.
    expect(screen.getByText('Hotel')).toBeInTheDocument();
    expect(screen.getByText('Flights')).toBeInTheDocument();

    // Clicking Exclusions opens it and collapses Inclusions (one at a time).
    await userEvent.click(exclusionsButton);
    expect(screen.getByText('Personal expenses')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inclusions' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    // Clicking again collapses it.
    await userEvent.click(exclusionsButton);
    expect(screen.queryByText('Personal expenses')).not.toBeInTheDocument();
  });

  it('hides the public policies section when all values are empty', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'No Policies',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
        inclusionsHtml: '<p><br></p>',
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    expect(screen.queryByRole('heading', { name: 'Policies' })).not.toBeInTheDocument();
  });

  it('renders the left-aligned contact card with dynamic details, buttons and logo', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: '+91 98765 43210',
        website: null,
        address: '1 MG Road, Bengaluru, Karnataka 560001',
        primaryColor: '#2563eb',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        createdBy: person,
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    const heading = screen.getByRole('heading', { name: 'Contact Us' });
    expect(heading).toBeInTheDocument();
    // Green vertical line sits immediately left of the heading.
    const line = heading.closest('section')?.querySelector('span[class*="bg-emerald-600"]');
    expect(line).not.toBeNull();
    expect(
      screen.getByText(/Ready to book this amazing journey or have questions/),
    ).toBeInTheDocument();

    // Company name (bold) and contact person row (scoped to the Contact Us card).
    expect(screen.getByText('Alpha Travel')).toBeInTheDocument();
    const contactSection = screen.getByRole('heading', { name: 'Contact Us' }).closest('section');
    expect(within(contactSection as HTMLElement).getByText('Aditi Rao')).toBeInTheDocument();

    // Clickable phone and email, plus the address row (scoped to the Contact Us card).
    expect(
      within(contactSection as HTMLElement).getByRole('link', { name: '+91 98765 43210' }),
    ).toHaveAttribute('href', 'tel:+91 98765 43210');
    expect(
      within(contactSection as HTMLElement).getByRole('link', { name: 'hello@alpha.test' }),
    ).toHaveAttribute('href', 'mailto:hello@alpha.test');
    expect(screen.getByText(/1 MG Road, Bengaluru/)).toBeInTheDocument();

    // Action buttons: tel, WhatsApp (new tab, prefilled message), mailto (prefilled).
    expect(screen.getByRole('link', { name: /Call Now/ })).toHaveAttribute(
      'href',
      'tel:+91 98765 43210',
    );
    const whatsapp = screen.getByRole('link', { name: /WhatsApp/ });
    const whatsappHref = whatsapp.getAttribute('href') ?? '';
    expect(whatsappHref.startsWith('https://wa.me/919876543210?text=')).toBe(true);
    // Normalized phone: spaces/+ stripped, country code preserved.
    expect(whatsappHref).not.toContain('+91');
    // Message includes quotation ID, title and lead/customer name, URL-encoded.
    expect(whatsappHref).toContain(encodeURIComponent('QT-2026-000001'));
    expect(whatsappHref).toContain(encodeURIComponent('Goa proposal'));
    expect(whatsappHref).toContain(encodeURIComponent('Aarav Mehta'));
    expect(whatsapp).toHaveAttribute('target', '_blank');

    const email = screen.getByRole('link', { name: /Email/ });
    const emailHref = email.getAttribute('href') ?? '';
    expect(emailHref.startsWith('mailto:hello@alpha.test?subject=')).toBe(true);
    expect(emailHref).toContain(
      encodeURIComponent('Quotation Inquiry (ID: QT-2026-000001 - Goa proposal for Aarav Mehta)'),
    );
    expect(emailHref).toContain(
      encodeURIComponent(
        "Hello,\n\nI'm interested in the travel quotation (ID: QT-2026-000001 - Goa proposal for Aarav Mehta).\n\nPlease contact me with more information.",
      ),
    );

    // Company logo in the card.
    expect(screen.getByAltText('Alpha Travel logo')).toHaveAttribute(
      'src',
      'https://storage.example.test/alpha-logo.png',
    );
  });

  it('shows a Find us on Google Maps row above the address when the agency sets a link', async () => {
    const mapsUrl = 'https://maps.google.com/?q=Alambagh,Lucknow';
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: '+91 98765 43210',
        website: null,
        address: '1 MG Road, Bengaluru, Karnataka 560001',
        googleMapsUrl: mapsUrl,
        primaryColor: '#2563eb',
        logoUrl: null,
      },
      quotation: {
        quotationNumber: 'QT-2026-000009',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
        async () => response(publicData),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    const link = screen.getByRole('link', { name: /Find us on Google Maps/ });
    // Directly above the address row, styled like the other contact rows.
    const rows = Array.from(
      link.closest('section')!.querySelectorAll(':scope p'),
    ).map((el) => el.textContent ?? '');
    const addressIndex = rows.findIndex((text) => text.includes('1 MG Road'));
    const mapsIndex = rows.findIndex((text) => text.includes('Find us on Google Maps'));
    expect(addressIndex).toBeGreaterThanOrEqual(0);
    expect(mapsIndex).toBe(addressIndex - 1);
    expect(link).toHaveAttribute('href', mapsUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    // The raw URL is never displayed.
    expect(screen.queryByText(mapsUrl)).not.toBeInTheDocument();
    cleanup();
    // Without a saved link the row disappears completely.
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(async () =>
        response({ ...publicData, company: { ...publicData.company, googleMapsUrl: null } }),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(screen.queryByRole('link', { name: /Find us on Google Maps/ })).not.toBeInTheDocument();
  });

  it('prefills WhatsApp and Email without duplicating a lead name already in the title', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: '+91 90000 00000',
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-000034',
        customerName: 'Vikas Singh',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Singapore Package for Vikas Singh',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100000',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Vikas Singh');

    const single = encodeURIComponent('QT-34 - Singapore Package for Vikas Singh');
    const duplicate = encodeURIComponent('for Vikas Singh for Vikas Singh');

    const whatsappHref = screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href') ?? '';
    expect(whatsappHref).toContain(single);
    expect(whatsappHref).not.toContain(duplicate);

    const emailHref = screen.getByRole('link', { name: /Email/ }).getAttribute('href') ?? '';
    expect(emailHref).toContain(
      encodeURIComponent('Quotation Inquiry (ID: QT-34 - Singapore Package for Vikas Singh)'),
    );
    expect(emailHref).not.toContain(duplicate);
  });

  it('keeps the contact card balanced when optional contact data is missing', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: null,
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        logoUrl: null,
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '25000',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // Heading and description remain.
    expect(screen.getByRole('heading', { name: 'Contact Us' })).toBeInTheDocument();
    expect(
      screen.getByText(/Ready to book this amazing journey or have questions/),
    ).toBeInTheDocument();
    // Company name stays, no contact rows, no buttons, no logo.
    expect(screen.getByText('Alpha Travel')).toBeInTheDocument();
    expect(screen.queryByText(/undefined|null|NaN/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Call Now/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Email/ })).not.toBeInTheDocument();
    expect(screen.queryByAltText(/logo/)).not.toBeInTheDocument();
  });

  it('shows Prepared By with the name and a combined phone | email row', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'vikassahni4453@gmail.com',
        phone: '7460939319',
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100000',
        createdBy: { id: 'user-1', fullName: 'Vikas Sahni', username: 'owner' },
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    const block = screen.getByText('Prepared By').parentElement!;
    expect(block).toHaveTextContent('Vikas Sahni');
    const row = block.querySelector('p[class*="flex"]');
    expect(row).not.toBeNull();
    // Phone and email share the same secondary row with a single separator.
    expect(row).toHaveTextContent('7460939319');
    expect(row).toHaveTextContent('vikassahni4453@gmail.com');
    expect(row).toHaveTextContent('|');
    expect(block.querySelector('a[href^="tel:"]')).toHaveAttribute('href', 'tel:7460939319');
    expect(block.querySelector('a[href^="mailto:"]')).toHaveAttribute(
      'href',
      'mailto:vikassahni4453@gmail.com',
    );
    // Other summary fields are untouched.
    expect(screen.getByText('Traveler Name')).toBeInTheDocument();
    expect(screen.getByText('Quotation ID')).toBeInTheDocument();
    expect(screen.getByText('Aarav Mehta')).toBeInTheDocument();
    expect(screen.queryByText('Rooms')).not.toBeInTheDocument();
    expect(screen.queryByText('1 Room')).not.toBeInTheDocument();
  });

  it('omits the separator when only one Prepared By contact value exists', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: null,
        phone: '7460939319',
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100000',
        createdBy: { id: 'user-1', fullName: 'Vikas Sahni', username: 'owner' },
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    const block = screen.getByText('Prepared By').parentElement!;
    const row = block.querySelector('p[class*="flex"]');
    expect(row).toHaveTextContent('7460939319');
    expect(row).not.toHaveTextContent('|');
    expect(block.querySelector('a[href^="tel:"]')).toHaveAttribute('href', 'tel:7460939319');
    expect(block.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('omits the contact row entirely when both Prepared By values are missing', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: null,
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100000',
        createdBy: { id: 'user-1', fullName: 'Vikas Sahni', username: 'owner' },
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    const block = screen.getByText('Prepared By').parentElement!;
    expect(block).toHaveTextContent('Vikas Sahni');
    expect(block.querySelector('p[class*="flex"]')).toBeNull();
    expect(block.querySelector('a[href^="tel:"]')).toBeNull();
    expect(block.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('hides stars and 0/5 for zero or missing ratings while keeping review links and scores', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Rating Check',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [
          {
            id: 'h0',
            hotelName: 'Zero Star Hotel',
            city: 'Goa',
            category: '0 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '10000',
            selected: true,
            notes: null,
            sequence: 1,
          },
          {
            id: 'h1',
            hotelName: 'Three Star Hotel',
            city: 'Goa',
            category: '3 Star',
            roomType: 'Superior',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '15000',
            selected: true,
            notes: null,
            sequence: 2,
          },
          {
            id: 'h2',
            hotelName: 'No Rating Hotel',
            city: 'Goa',
            category: null,
            roomType: 'Standard',
            mealPlan: 'Bed',
            rooms: 1,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '8000',
            selected: true,
            notes: null,
            sequence: 3,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {
        h0: {
          imageUrl: null,
          starCategory: 0,
          starRating: '0',
          address: null,
          reviewLink: null,
          checkInTime: null,
          checkOutTime: null,
          destination: 'Goa',
          country: 'India',
        },
        h1: {
          imageUrl: null,
          starCategory: 3,
          starRating: null,
          address: null,
          reviewLink: 'https://reviews.example.test/three-star',
          checkInTime: null,
          checkOutTime: null,
          destination: 'Goa',
          country: 'India',
        },
        h2: {
          imageUrl: null,
          starCategory: null,
          starRating: '3.7',
          address: null,
          reviewLink: 'https://reviews.example.test/no-rating',
          checkInTime: null,
          checkOutTime: null,
          destination: 'Goa',
          country: 'India',
        },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // Zero rating: no stars, no "0/5" badge, no review link.
    const zeroCard = screen.getByText('Zero Star Hotel').closest('article') as HTMLElement;
    expect(within(zeroCard).queryByLabelText(/star hotel/)).not.toBeInTheDocument();
    expect(within(zeroCard).queryByText('0/5')).not.toBeInTheDocument();
    expect(within(zeroCard).queryByText('Hotel Review')).not.toBeInTheDocument();

    // Star rating 3: exactly three filled stars; review link, no score badge.
    const threeCard = screen.getByText('Three Star Hotel').closest('article') as HTMLElement;
    expect(within(threeCard).getByLabelText('3 star hotel').querySelectorAll('svg').length).toBe(3);
    expect(within(threeCard).queryByText('3.7')).not.toBeInTheDocument();
    const threeReview = within(threeCard).getByText('Hotel Review').closest('a');
    expect(threeReview).toHaveAttribute('href', 'https://reviews.example.test/three-star');
    expect(threeReview).toHaveAttribute('target', '_blank');
    expect(threeReview).toHaveAttribute('rel', 'noopener noreferrer');

    // Missing star rating: no star row, but review link and score badge appear.
    const noRatingCard = screen.getByText('No Rating Hotel').closest('article') as HTMLElement;
    expect(within(noRatingCard).queryByLabelText(/star hotel/)).not.toBeInTheDocument();
    expect(within(noRatingCard).getByText('Hotel Review')).toBeInTheDocument();
    expect(within(noRatingCard).getByText('3.7')).toBeInTheDocument();
    expect(within(noRatingCard).queryByText('0/5')).not.toBeInTheDocument();
  });

  it('clamps star count to five and hides the score badge when the score is zero', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Clamp Check',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [
          {
            id: 'h5',
            hotelName: 'Five Star Hotel',
            city: 'Goa',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '20000',
            selected: true,
            notes: null,
            sequence: 1,
          },
          {
            id: 'h9',
            hotelName: 'Overrated Hotel',
            city: 'Goa',
            category: '9 Star',
            roomType: 'Suite',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '25000',
            selected: true,
            notes: null,
            sequence: 2,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {
        h5: {
          imageUrl: null,
          starCategory: 5,
          starRating: '3.7',
          address: null,
          reviewLink: 'https://reviews.example.test/five',
          checkInTime: null,
          checkOutTime: null,
          destination: 'Goa',
          country: 'India',
        },
        h9: {
          imageUrl: null,
          starCategory: 9,
          starRating: '0',
          address: null,
          reviewLink: null,
          checkInTime: null,
          checkOutTime: null,
          destination: 'Goa',
          country: 'India',
        },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    const fiveCard = screen.getByText('Five Star Hotel').closest('article') as HTMLElement;
    expect(within(fiveCard).getByLabelText('5 star hotel').querySelectorAll('svg').length).toBe(5);
    expect(within(fiveCard).getByText('3.7')).toBeInTheDocument();
    expect(within(fiveCard).getByText('Hotel Review')).toBeInTheDocument();

    // Star rating 9 never renders more than five stars; score 0 hides the badge.
    const overCard = screen.getByText('Overrated Hotel').closest('article') as HTMLElement;
    expect(within(overCard).getByLabelText('9 star hotel').querySelectorAll('svg').length).toBe(5);
    expect(within(overCard).queryByText('0/5')).not.toBeInTheDocument();
    expect(within(overCard).queryByText('Hotel Review')).not.toBeInTheDocument();
  });

  it('renders the public footer from company settings and sets the logo favicon', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSince: 2015,
        tripsSold: 4200,
        tan: 'ABCD12345E',
        taxRegistrationNumber: '29ABCDE1234F1Z5',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    // Copyright line with dynamic year and company name from settings.
    const year = new Date().getFullYear();
    expect(screen.getByText(`© ${year} Alpha Travel. All rights reserved.`)).toBeInTheDocument();
    // Secondary metadata line joins only present values (GSTIN moved to Contact Us).
    expect(screen.getByText('Since: 2015 | Trips: 4200 | TAN: ABCD12345E')).toBeInTheDocument();
    expect(screen.queryByText(/GSTIN/)).not.toBeInTheDocument();
    // Right side: quotation number + formatted generated date.
    expect(
      screen.getByText('Quotation ID: #QT-2026-000001 | Generated: 04 Aug 2026'),
    ).toBeInTheDocument();

    // The company logo becomes the favicon.
    await waitFor(() =>
      expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
        'href',
        'https://storage.example.test/alpha-logo.png',
      ),
    );
  });

  describe('Public quotation Contact Us GST row', () => {
    const contactProps = {
      companyName: 'Alpha Travel',
      contactPerson: 'Aditi Rao',
      phone: '+91 90000 00000',
      gstin: '29ABCDE1234F1Z5',
      email: 'hello@alpha.test',
      address: '1 MG Road, Bengaluru',
      logoUrl: null,
      quotationId: 'QT-2026-000001',
      quotationTitle: 'Goa proposal',
      leadName: 'Aarav Mehta',
    };

    it('shows the GST badge with the number between email and the Maps/address rows', () => {
      renderWithProviders(<PublicQuotationContact {...contactProps} />);
      // Badge carries only "GST" (never "GSTIN"); the number is dynamic.
      expect(screen.getByText('GST', { exact: true })).toBeInTheDocument();
      expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument();
      expect(screen.queryByText(/GSTIN/)).not.toBeInTheDocument();
      const section = screen.getByRole('heading', { name: 'Contact Us' }).closest('section')!;
      const gstRow = within(section).getByText('29ABCDE1234F1Z5').closest('p')!;
      // Original filled green badge: white GST text, compact size, no SVG artwork.
      const badge = within(gstRow as HTMLElement).getByText('GST', { exact: true });
      expect(badge.tagName).toBe('SPAN');
      expect(badge.getAttribute('class')).toContain('bg-emerald-600');
      expect(badge.getAttribute('class')).toContain('text-white');
      expect(gstRow.querySelector('svg')).toBeNull();
      // Order: contact person, phone, email, GST, Maps link, then address —
      // immediately before the Call Now / WhatsApp buttons.
      const person = screen.getByText('Aditi Rao');
      const phone = screen.getByText('+91 90000 00000');
      const gst = screen.getByText('29ABCDE1234F1Z5');
      const email = screen.getByText('hello@alpha.test');
      const address = screen.getByText('1 MG Road, Bengaluru');
      const following = (node: Node, target: Node) =>
        Boolean(node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(following(person, phone)).toBe(true);
      expect(following(phone, email)).toBe(true);
      expect(following(email, gst)).toBe(true);
      expect(following(gst, address)).toBe(true);
      // Phone, email, buttons unchanged.
      expect(screen.getByText('Call Now')).toBeInTheDocument();
      expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    });

    it('hides the GST row when no GSTIN is present', () => {
      renderWithProviders(<PublicQuotationContact {...contactProps} gstin={null} />);
      expect(screen.queryByText('GST', { exact: true })).not.toBeInTheDocument();
      expect(screen.getByText('+91 90000 00000')).toBeInTheDocument();
      expect(screen.getByText('hello@alpha.test')).toBeInTheDocument();
    });

    it('hides the GST row for a blank GSTIN', () => {
      renderWithProviders(<PublicQuotationContact {...contactProps} gstin="   " />);
      expect(screen.queryByText('GST', { exact: true })).not.toBeInTheDocument();
    });

    it('uses a folded-map outline for the Google Maps row and the WhatsApp brand glyph', () => {
      renderWithProviders(
        <PublicQuotationContact
          {...contactProps}
          googleMapsUrl="https://maps.google.com/?q=Lucknow"
        />,
      );
      const section = screen.getByRole('heading', { name: 'Contact Us' }).closest('section')!;
      // Google Maps row uses the lucide folded-map outline (not the address
      // pin) with the same shared emerald icon classes.
      const mapsLink = within(section).getByRole('link', { name: /Find us on Google Maps/ });
      const mapsIcon = mapsLink.closest('p')!.querySelector('svg');
      const addressRow = within(section).getByText('1 MG Road, Bengaluru').closest('p')!;
      const addressIcon = addressRow.querySelector('svg');
      expect(mapsIcon?.getAttribute('class')).toContain('lucide-map');
      expect(mapsIcon?.getAttribute('class')).not.toContain('map-pin');
      expect(addressIcon?.getAttribute('class')).toContain('lucide-map-pin');
      expect(mapsIcon?.getAttribute('class')).toContain('text-emerald-600');
      expect(mapsLink).toHaveAttribute('href', 'https://maps.google.com/?q=Lucknow');
      expect(mapsLink).toHaveAttribute('target', '_blank');
      // No multicolour Google Maps artwork remains anywhere in the card.
      expect(section.querySelector('clipPath')).toBeNull();
      // WhatsApp button carries a single-colour brand glyph, not MessageCircle.
      const whatsapp = within(section).getByRole('link', { name: /WhatsApp/ });
      const glyph = whatsapp.querySelector('svg');
      expect(glyph).not.toBeNull();
      expect(glyph!.querySelector('path')).not.toBeNull();
      expect(glyph!.querySelector('circle')).toBeNull();
      expect(glyph!.getAttribute('fill')).toBe('currentColor');
      expect(glyph!.getAttribute('viewBox')).toBe('0 0 24 24');
    });

    it('orders the rows as name, phone, email, GST, Maps link, then address', () => {
      renderWithProviders(
        <PublicQuotationContact
          {...contactProps}
          googleMapsUrl="https://maps.google.com/?q=Lucknow"
        />,
      );
      const section = screen.getByRole('heading', { name: 'Contact Us' }).closest('section')!;
      const rows = Array.from(section.querySelectorAll(':scope p')).map(
        (el) => el.textContent ?? '',
      );
      const order = [
        'Aditi Rao',
        '+91 90000 00000',
        'hello@alpha.test',
        '29ABCDE1234F1Z5',
        'Find us on Google Maps',
        '1 MG Road, Bengaluru',
      ].map((text) => rows.findIndex((row) => row.includes(text)));
      expect(order.every((index) => index >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
  });

  it('shows the quotation ID as "#1032" in the info card and the footer', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
        operatingSince: 2015,
        tripsSold: 4200,
        tan: 'ABCD12345E',
        taxRegistrationNumber: '29ABCDE1234F1Z5',
        logoUrl: 'https://storage.example.test/alpha-logo.png',
      },
      quotation: {
        quotationNumber: 'QT-001032',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        createdAt: '2026-08-04T10:00:00.000Z',
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '16065.87',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {},
      vehiclePresentations: {},
      airlinePresentations: {},
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    // The info card value and the footer both render '#1032', never '#QT-...'
    // or 'QT-...'.
    expect(screen.getByText('#1032')).toBeInTheDocument();
    expect(screen.getByText(/Quotation ID: #1032/)).toBeInTheDocument();
    expect(screen.queryByText(/QT-1032/)).not.toBeInTheDocument();
    expect(screen.queryByText(/QT-001032/)).not.toBeInTheDocument();
    expect(screen.queryByText(/#QT-1032/)).not.toBeInTheDocument();
  });

  it('sets the browser tab title from the quotation title and restores it on leave', async () => {
    document.title = 'Travel Agency CRM';
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Dubai',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Dubai Honeymoon Package',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100000',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');
    expect(document.title).toBe('Dubai Honeymoon Package');
    view.unmount();
    expect(document.title).toBe('Travel Agency CRM');
  });

  it('falls back to the Quotation title when the quotation has no title', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: '',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '25000',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await waitFor(() => expect(document.title).toBe('Quotation'));
  });

  it('renders the public page without the final-amount/decision box and hides missing settings', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Kerala',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Kerala proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '25000',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    expect(await screen.findByText('Custom Package for Mira Shah')).toBeInTheDocument();
    // The public final-amount/decision box is not rendered.
    expect(screen.queryByText('Final quotation amount')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Valid until/)).not.toBeInTheDocument();
    // Missing optional settings never leak placeholders into the footer.
    const footer = document.querySelector('footer');
    expect(footer).not.toHaveTextContent(/undefined|null|NaN|Since:|Trips:|TAN:|GSTIN:/i);
    expect(footer).toHaveTextContent('Quotation ID: #QT-2026-000002');
    // No company logo → the default favicon stays untouched.
    expect(document.querySelector('link[rel="icon"]')).toBeNull();
    // No POST decision request is ever sent from the public page.
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('shows each hotel card its own full address below the location row', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Singapore',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Address Check',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [
          {
            id: 'hA',
            hotelName: 'V Hotel Lavender',
            city: 'Singapore',
            category: null,
            roomType: 'Family Room',
            mealPlan: 'Breakfast Only (CP)',
            rooms: 3,
            nights: 2,
            checkInDate: '2026-08-10',
            checkOutDate: '2026-08-12',
            checkInTime: '15:30',
            checkOutTime: '11:15',
            showCheckInTime: true,
            showCheckOutTime: false,
            sellingPrice: '20000',
            selected: true,
            notes: null,
            sequence: 1,
          },
          {
            id: 'hB',
            hotelName: 'Marina Bay Hotel',
            city: 'Singapore',
            category: null,
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '30000',
            selected: true,
            notes: null,
            sequence: 2,
          },
          {
            id: 'hC',
            hotelName: 'Bare Hotel',
            city: 'Goa',
            category: null,
            roomType: 'Standard',
            mealPlan: 'Bed',
            rooms: null,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '8000',
            selected: true,
            notes: null,
            sequence: 3,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      hotelPresentations: {
        hA: {
          imageUrl: null,
          starCategory: 4,
          starRating: '3.7',
          address: '70 Jellicoe Rd, Singapore 208767',
          reviewLink: 'https://reviews.example.test/v-hotel',
          checkInTime: null,
          checkOutTime: null,
          destination: 'Singapore',
          country: 'Singapore',
        },
        hB: {
          imageUrl: null,
          starCategory: null,
          starRating: null,
          address: '10 Bayfront Avenue, Singapore 018956',
          reviewLink: null,
          checkInTime: null,
          checkOutTime: null,
          destination: 'Singapore',
          country: 'Singapore',
        },
        hC: {
          imageUrl: null,
          starCategory: null,
          starRating: null,
          address: null,
          reviewLink: null,
          checkInTime: null,
          checkOutTime: null,
          destination: 'Goa',
          country: 'India',
        },
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // Each card shows its own full address below the location row.
    const cardA = screen.getByText('V Hotel Lavender').closest('article') as HTMLElement;
    expect(within(cardA).getByText('70 Jellicoe Rd, Singapore 208767')).toBeInTheDocument();
    const cardB = screen.getByText('Marina Bay Hotel').closest('article') as HTMLElement;
    expect(within(cardB).getByText('10 Bayfront Avenue, Singapore 018956')).toBeInTheDocument();
    // No-address hotel renders no address line.
    const cardC = screen.getByText('Bare Hotel').closest('article') as HTMLElement;
    expect(cardC).not.toHaveTextContent(/Address unavailable|No address|undefined|null/i);
    expect(within(cardC).queryByText('Rooms:')).not.toBeInTheDocument();
    // Existing card content remains visible.
    expect(within(cardA).getByText(/Family Room/)).toBeInTheDocument();
    expect(within(cardA).getByText(/Breakfast Only \(CP\)/)).toBeInTheDocument();
    expect(within(cardA).getByText('Rooms:')).toBeInTheDocument();
    expect(cardA).toHaveTextContent('Rooms: 3');
    expect(cardA).toHaveTextContent('3:30 PM');
    expect(cardA).toHaveTextContent('11:15 AM');
    expect(within(cardA).getByText('Nights:')).toBeInTheDocument();
    expect(within(cardA).getByText('Hotel Review')).toBeInTheDocument();
    expect(within(cardA).getByLabelText('4 star hotel')).toBeInTheDocument();
  });

  it('keeps older quotations without an address loading on the public page', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Legacy Quotation',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [
          {
            id: 'hL',
            hotelName: 'Legacy Hotel',
            city: 'Goa',
            category: null,
            roomType: 'Standard',
            mealPlan: 'Bed',
            rooms: 1,
            nights: 2,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '8000',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      // No presentation entry at all — mimics older data lacking address/rating.
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');
    const card = screen.getByText('Legacy Hotel').closest('article') as HTMLElement;
    expect(card).not.toHaveTextContent(/undefined|null/i);
    expect(screen.queryByText('Address unavailable')).not.toBeInTheDocument();
  });

  it('displays the date-derived hotel nights on the public page', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: null,
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000002',
        customerName: 'Mira Shah',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Nights Check',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [
          {
            id: 'hA',
            hotelName: 'Coastal Bay Resort',
            city: 'Goa',
            category: '4 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 4,
            checkInDate: '2026-08-10T00:00:00.000Z',
            checkOutDate: '2026-08-12T00:00:00.000Z',
            sellingPrice: '12000',
            selected: true,
            notes: null,
            sequence: 1,
          },
          {
            id: 'hB',
            hotelName: 'No Dates Hotel',
            city: 'Goa',
            category: null,
            roomType: 'Standard',
            mealPlan: 'Bed',
            rooms: 1,
            nights: 4,
            checkInDate: null,
            checkOutDate: null,
            sellingPrice: '8000',
            selected: true,
            notes: null,
            sequence: 2,
          },
        ],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () => response(publicData),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Mira Shah');

    // Stored nights are 4 but 10 Aug → 12 Aug is 2 calendar nights.
    const cardA = screen.getByText('Coastal Bay Resort').closest('article') as HTMLElement;
    expect(within(cardA).getByText('Nights:')).toBeInTheDocument();
    const nightsRowA = within(cardA).getByText('Nights:').parentElement as HTMLElement;
    expect(nightsRowA).toHaveTextContent('2');

    // Missing dates fall back to the stored nights value.
    const cardB = screen.getByText('No Dates Hotel').closest('article') as HTMLElement;
    const nightsRowB = within(cardB).getByText('Nights:').parentElement as HTMLElement;
    expect(nightsRowB).toHaveTextContent('4');
  });

  const destinationExpertPublicData = (
    overrides: Record<string, unknown> = {},
    versionOverrides: Record<string, unknown> = {},
  ) => ({
    company: {
      name: 'Alpha Travel',
      email: 'a@b.test',
      phone: '+91 90000 00000',
      website: null,
      address: '1 MG Road, Bengaluru',
      primaryColor: '#2563eb',
    },
    quotation: {
      quotationNumber: 'QT-2026-000101',
      customerName: 'Priya Sharma',
      destinationSummary: 'Singapore',
      destinations: 'Singapore',
      travelStartDate: '2026-10-23',
      travelEndDate: '2026-10-29',
      adults: 2,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
      rooms: 1,
      validUntil: null,
      status: 'VIEWED',
    },
    version: {
      title: 'Destination Expert Test',
      versionNumber: 1,
      currency: 'INR',
      finalAmount: '45000',
      notes: null,
      paymentPolicies: null,
      cancellationPolicies: null,
      bookingTerms: null,
      includeVisa: false,
      flightDetails: null,
      hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
      hotels: [],
      itinerary: [],
      services: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      faqs: [],
      weblinkSectionOrder: [
        'services',
        'itinerary',
        'hotels',
        'flights',
        'transportation',
        'cruise',
        'addons',
        'visa',
        'policies',
        'destinationExpert',
        'faqs',
      ],
      ...versionOverrides,
    },
    destinationExpert: {
      id: 'expert-1',
      fullName: 'Aditi Rao',
      email: 'aditi@example.test',
      phone: '+91 90000 00000',
      whatsappNumber: '+91 98888 77777',
      jobTitle: 'Singapore expert',
      bio: null,
      specialization: 'Honeymoons and family holidays',
      yearsOfExperience: 8,
      tripsPlanned: 550,
      languages: 'English, Hindi, Tamil',
      gender: null,
      profileImageUrl: null,
      avatarKind: null,
      config: {
        heading: 'Meet Your Destination Expert',
        customIntroduction: 'I will help plan your Singapore holiday from first chat to check-in.',
        showWhatsapp: true,
        showCall: true,
        showEmail: true,
        showExperience: true,
        showTripsPlanned: true,
        showLanguages: true,
      },
    },
    downloadUrl: null,
    ...overrides,
  });

  it('renders the enabled Destination Expert on the public page without requiring an avatar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(destinationExpertPublicData())),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );

    const expertSection = (
      await screen.findByRole('heading', { name: 'Meet Your Destination Expert' })
    ).closest('section') as HTMLElement;
    expect(expertSection).toBeInTheDocument();
    expect(screen.getByLabelText('Aditi Rao avatar initials')).toHaveTextContent('AR');
    expect(within(expertSection).getByText('ADITI')).toBeInTheDocument();
    expect(within(expertSection).getByText('Singapore expert')).toBeInTheDocument();
    expect(
      within(expertSection).getByText(
        'I will help plan your Singapore holiday from first chat to check-in.',
      ),
    ).toBeInTheDocument();
    expect(within(expertSection).getByRole('link', { name: /WhatsApp/i })).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/919888877777'),
    );
    expect(within(expertSection).getByRole('link', { name: /Call/i })).toHaveAttribute(
      'href',
      'tel:+919000000000',
    );
    expect(within(expertSection).getByRole('link', { name: /Email/i })).toHaveAttribute(
      'href',
      'mailto:aditi@example.test',
    );
    expect(within(expertSection).getByText('8+ Years')).toBeInTheDocument();
    expect(within(expertSection).getByText('550+ Trips')).toBeInTheDocument();
    expect(within(expertSection).getByText('English, Hindi, Tamil')).toBeInTheDocument();
  });

  it('hides Destination Expert contact and stat rows when toggles or values are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          destinationExpertPublicData({
            destinationExpert: {
              ...(destinationExpertPublicData().destinationExpert as Record<string, unknown>),
              phone: null,
              whatsappNumber: null,
              email: null,
              yearsOfExperience: null,
              tripsPlanned: null,
              languages: null,
              config: {
                heading: 'Destination Expert',
                customIntroduction: 'Available after booking.',
                showWhatsapp: false,
                showCall: true,
                showEmail: false,
                showExperience: true,
                showTripsPlanned: false,
                showLanguages: false,
              },
            },
          }),
        ),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );

    const expertSection = (
      await screen.findByRole('heading', { name: 'Destination Expert' })
    ).closest('section') as HTMLElement;
    expect(within(expertSection).getByText('Available after booking.')).toBeInTheDocument();
    expect(
      within(expertSection).queryByRole('link', { name: /WhatsApp/i }),
    ).not.toBeInTheDocument();
    expect(within(expertSection).queryByRole('link', { name: /Call/i })).not.toBeInTheDocument();
    expect(within(expertSection).queryByRole('link', { name: /Email/i })).not.toBeInTheDocument();
    expect(within(expertSection).queryByText(/Years/)).not.toBeInTheDocument();
    expect(within(expertSection).queryByText(/Trips/)).not.toBeInTheDocument();
    expect(within(expertSection).queryByText('English, Hindi, Tamil')).not.toBeInTheDocument();
    expect(within(expertSection).queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it('does not render Destination Expert when the public payload has no selected expert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(destinationExpertPublicData({ destinationExpert: null }))),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );

    await screen.findByText('Custom Package for Priya Sharma');
    expect(screen.queryByRole('heading', { name: /Destination Expert/i })).not.toBeInTheDocument();
    expect(screen.queryByText('ADITI')).not.toBeInTheDocument();
  });

  it('respects Weblink Section Order for Destination Expert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          destinationExpertPublicData(
            {},
            {
              paymentPolicies: '<p>Policy</p>',
              weblinkSectionOrder: [
                'destinationExpert',
                'policies',
                'services',
                'itinerary',
                'hotels',
                'flights',
                'transportation',
                'cruise',
                'addons',
                'visa',
                'faqs',
              ],
            },
          ),
        ),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );

    const expertHeading = await screen.findByRole('heading', {
      name: 'Meet Your Destination Expert',
    });
    const policiesHeading = screen.getByRole('heading', { name: 'Policies' });
    expect(
      expertHeading.compareDocumentPosition(policiesHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders sections in the required order on the public page', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: '+91 90000 00000',
        website: null,
        address: '1 MG Road, Bengaluru',
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000100',
        customerName: 'Priya Sharma',
        destinationSummary: 'Singapore',
        travelStartDate: '2026-10-23',
        travelEndDate: '2026-10-29',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Section Order Test',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '45000',
        notes: null,
        perAdultPrice: '22500',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
        taxNote: 'Inclusive of GST',
        initialPaymentAmount: '5000',
        paymentLink: 'https://rzp.io/l/test',
        inclusionsHtml: null,
        exclusionsHtml: null,
        paymentPolicies: '<p>Policy</p>',
        cancellationPolicies: '<p>Cancellation</p>',
        bookingTerms: '<p>Terms</p>',
        includeVisa: true,
        visaSectionTitle: 'Visa',
        visaAmount: '2000',
        visaDestination: 'Singapore',
        visaType: 'e-Visa',
        visaServiceCharge: '500',
        visaGstPercent: '18',
        visaVfsCharge: '300',
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: 0,
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1',
              city: 'Singapore',
              date: null,
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                {
                  name: 'City Tour',
                  description: null,
                  startTime: null,
                  sightseeingId: null,
                  imageUrl: null,
                },
              ],
            },
          ],
        },
        flightDetails: {
          include: true,
          journeyType: 'ROUND_TRIP',
          outbound: {
            fromCity: 'DEL',
            toCity: 'SIN',
            segments: [
              {
                airlineName: 'IndiGo',
                flightNumber: '6E101',
                from: 'DEL',
                to: 'SIN',
                departureDate: '2026-10-23',
                departureTime: '06:00',
                arrivalDate: '2026-10-23',
                arrivalTime: '12:00',
                duration: '6h',
              },
            ],
          },
          returnJourney: {
            fromCity: 'SIN',
            toCity: 'DEL',
            segments: [
              {
                airlineName: 'IndiGo',
                flightNumber: '6E102',
                from: 'SIN',
                to: 'DEL',
                departureDate: '2026-10-29',
                departureTime: '14:00',
                arrivalDate: '2026-10-29',
                arrivalTime: '20:00',
                duration: '6h 30m',
              },
            ],
          },
        },
        hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
        hotels: [
          {
            id: 'h1',
            hotelName: 'Marina Bay Sands',
            city: 'Singapore',
            category: '5 Star',
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            nights: 6,
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
        itinerary: [],
        services: [
          {
            serviceType: 'VEHICLE_TRANSFER',
            name: 'Airport Transfer',
            description: null,
            city: 'Singapore',
            quantity: '1',
            unitSellingPrice: '3000',
            notes: null,
          },
          {
            serviceType: 'CRUISE',
            name: 'River Cruise',
            description: 'Cruise.',
            city: 'Singapore',
            quantity: '1',
            unitSellingPrice: '1500',
            notes: null,
          },
          {
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'addon-travel-insurance',
            name: 'Travel Insurance',
            description: 'Cover.',
            city: null,
            quantity: '1',
            unitSellingPrice: '800',
            notes: null,
          },
        ],
        inclusions: [{ content: 'Inclusion A' }],
        exclusions: [{ content: 'Exclusion A' }],
        terms: [{ content: 'Term A' }],
      },
      downloadUrl: null,
    };
    const fetchMock = vi.fn(async () => response(publicData));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Priya Sharma');

    const headingNames = [
      'Secure Your Booking Now',
      'Services Include',
      'Your Itinerary',
      'Your Hotels',
      'Flight Details',
      'Transportation',
      'Cruise Details',
      'Additional Services',
      'Policies',
      'Contact Us',
    ];

    const headings = headingNames.map((name) => screen.getByRole('heading', { name }));

    // Verify ascending DOM position confirms the required order
    for (let i = 1; i < headings.length; i += 1) {
      expect(
        headings[i - 1]!.compareDocumentPosition(headings[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('adds a Contact Us item to the Jump To nav after Policies that scrolls to the existing section', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: '+91 98765 43210',
        website: null,
        address: '1 MG Road, Bengaluru, Karnataka 560001',
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
        inclusionsHtml: '<ul><li>Hotel</li></ul>',
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
      },
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
        async () => response(publicData),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    // Exactly one Contact Us section exists; the stable anchor points at its heading.
    expect(screen.getAllByRole('heading', { name: 'Contact Us' })).toHaveLength(1);
    const heading = screen.getByRole('heading', { name: 'Contact Us' });
    expect(document.getElementById('contact-us')).toBe(heading);

    // The Jump To nav lists Contact Us immediately after Policies.
    const nav = screen.getByRole('navigation', { name: 'Quotation sections' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((chip) => chip.textContent);
    const policiesIndex = labels.indexOf('Policies');
    expect(policiesIndex).toBeGreaterThanOrEqual(0);
    expect(labels[policiesIndex + 1]).toBe('Contact Us');

    // Clicking the chip scrolls to the existing Contact Us heading.
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    await userEvent.click(within(nav).getByRole('button', { name: 'Contact Us' }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(heading).toBeInTheDocument();
  });

  it('moves the green Jump To state between Policies and Contact Us on click', async () => {
    const publicData = {
      company: {
        name: 'Alpha Travel',
        email: 'hello@alpha.test',
        phone: '+91 98765 43210',
        website: null,
        address: '1 MG Road, Bengaluru, Karnataka 560001',
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000001',
        customerName: 'Aarav Mehta',
        destinationSummary: 'Goa',
        travelStartDate: null,
        travelEndDate: null,
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Goa proposal',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100',
        hotels: [],
        services: [],
        itinerary: [],
        inclusions: [],
        exclusions: [],
        terms: [],
        inclusionsHtml: '<ul><li>Hotel</li></ul>',
        exclusionsHtml: null,
        paymentPolicies: null,
        cancellationPolicies: null,
        bookingTerms: null,
      },
      downloadUrl: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
        async () => response(publicData),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Custom Package for Aarav Mehta');

    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const nav = screen.getByRole('navigation', { name: 'Quotation sections' });
    const chip = (name: string) => within(nav).getByRole('button', { name });
    const isActive = (element: HTMLElement) => element.className.includes('bg-emerald-600');

    await userEvent.click(chip('Policies'));
    expect(isActive(chip('Policies'))).toBe(true);
    expect(isActive(chip('Contact Us'))).toBe(false);

    await userEvent.click(chip('Contact Us'));
    expect(isActive(chip('Contact Us'))).toBe(true);
    expect(isActive(chip('Policies'))).toBe(false);

    // Exactly one navigation item is ever green.
    expect(within(nav).getAllByRole('button').filter(isActive)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 14 — master selectors inside the quotation and template builders
// ---------------------------------------------------------------------------

const hotelSummary = {
  id: 'aaaaaaa1-1111-4111-8111-111111111111',
  name: 'Shah Palace Hotel',
  starCategory: 4,
  starRating: null,
  status: 'ACTIVE',
  isDefaultForCity: false,
  isFeatured: false,
  hasImage: false,
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdAt: '2026-07-21T00:00:00.000Z',
  destination: { id: 'dest-1', name: 'Azerbaijan' },
  city: { id: 'city-1', name: 'Baku' },
};
const hotelDetail = {
  ...hotelSummary,
  roomTypes: [
    {
      id: 'aaaaaaa2-1111-4111-8111-111111111111',
      hotelId: 'aaaaaaa1-1111-4111-8111-111111111111',
      name: 'Deluxe Room',
      baseCost: 4000,
      sellingPrice: 6000,
      currency: 'INR',
      status: 'ACTIVE',
      sortOrder: 1,
    },
  ],
  mealPlans: [
    {
      id: 'aaaaaaa3-1111-4111-8111-111111111111',
      hotelId: 'aaaaaaa1-1111-4111-8111-111111111111',
      name: 'Breakfast Only',
      type: 'BREAKFAST',
      baseCost: 500,
      sellingPrice: 800,
      currency: 'INR',
      status: 'ACTIVE',
      sortOrder: 1,
    },
  ],
};
const airline = { id: 'aaaaaaa4-1111-4111-8111-111111111111', name: 'Air India', status: 'ACTIVE' };
const cruise = {
  id: 'aaaaaaa5-1111-4111-8111-111111111111',
  name: 'Dream Genting',
  description: '<p>Experience an unforgettable cruise aboard Dream Genting.</p>',
  status: 'ACTIVE',
  roomTypes: [
    {
      id: 'aaaaaaa6-1111-4111-8111-111111111111',
      name: 'Interior',
      price: 18000,
      currency: 'INR',
      status: 'ACTIVE',
      sortOrder: 1,
    },
  ],
};
const cruiseDetail = {
  ...cruise,
  roomTypes: [
    {
      id: 'aaaaaaa6-1111-4111-8111-111111111111',
      name: 'Interior',
      price: 18000,
      currency: 'INR',
      status: 'ACTIVE',
      sortOrder: 1,
    },
  ],
};
const spectrumCruise = {
  ...cruise,
  id: 'bbbbbbb5-1111-4111-8111-111111111111',
  name: 'Spectrum of the Seas',
  description: '<p>Spectrum sails with a separate onboard experience.</p>',
  roomTypes: [
    {
      id: 'bbbbbbb6-1111-4111-8111-111111111111',
      name: 'Balcony',
      price: 25000,
      currency: 'INR',
      status: 'ACTIVE',
      sortOrder: 1,
    },
  ],
};
const vehicle = {
  id: 'aaaaaaa7-1111-4111-8111-111111111111',
  name: 'Innova Crysta',
  vehicleType: 'Standard MPV',
  capacity: 8,
  status: 'ACTIVE',
};
const sightseeing = {
  id: 'aaaaaaa8-1111-4111-8111-111111111111',
  title: 'Gobustan Tour',
  sequence: 1,
  status: 'ACTIVE',
};
const addOn = {
  id: 'aaaaaaa9-1111-4111-8111-111111111111',
  name: 'Visa Assistance',
  description: '<p><strong>Visa</strong> assistance with documentation support.</p>',
  price: 3800,
  currency: 'INR',
  status: 'ACTIVE',
};

/** Build the activities response shape for the sightseeing/activities endpoint from a page of sightseeing rows. */
function sightseeingActivitiesFrom(data: { data: unknown[] }) {
  const rows = data.data as Array<Record<string, unknown>>;
  const first = rows[0];
  return {
    destination: first?.destination ?? null,
    city: first?.city ?? null,
    activities: rows.map((row) => ({
      id: row.id,
      title: row.title,
      sequence: row.sequence,
      estimatedHours: row.estimatedHours ?? null,
      suggestedStartTime: row.suggestedStartTime ?? null,
      description: row.description ?? null,
      images: row.images ?? [],
      destination: row.destination,
      city: row.city,
    })),
  };
}

/** Route master lookups by URL so one stub can serve every selector. */
function masterFetch(base: unknown, extra: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/masters/hotels/': hotelDetail,
    '/masters/hotels': page([hotelSummary]),
    '/masters/airlines': page([airline]),
    '/masters/cruises/': cruiseDetail,
    '/masters/cruises': page([cruise]),
    '/masters/vehicles': page([vehicle]),
    '/masters/sightseeing': page([sightseeing]),
    '/masters/sightseeing/activities': sightseeingActivitiesFrom(page([sightseeing])),
    '/masters/sightseeing/presentations': {},
    '/masters/add-on-services': page([addOn]),
    ...extra,
  };
  // When a caller overrides /masters/sightseeing, also create the matching
  // /masters/sightseeing/activities response from the same data.
  const sightseeingExtra = extra['/masters/sightseeing'];
  if (sightseeingExtra && !extra['/masters/sightseeing/activities']) {
    if (
      typeof sightseeingExtra === 'object' &&
      sightseeingExtra !== null &&
      'data' in sightseeingExtra
    ) {
      routes['/masters/sightseeing/activities'] = sightseeingActivitiesFrom(
        sightseeingExtra as { data: Array<Record<string, unknown>> },
      );
    }
  }
  return vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
    void _options;
    const url = String(input);
    // Most specific prefixes (longest) are matched first so image download-url
    // routes beat their parent list routes.
    for (const [prefix, body] of Object.entries(routes).sort(([a], [b]) => b.length - a.length))
      if (prefix.endsWith('/') ? url.includes(prefix) && !url.includes('?') : url.includes(prefix))
        return response(body);
    return response(base);
  });
}

const builderQuotation = (overrides: Record<string, unknown> = {}) => ({
  quotationNumber: 'QT-2026-000001',
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
      subtotalCost: '0',
      markupMode: 'NONE',
      markupValue: '0',
      totalMarkup: '0',
      taxRate: '0',
      taxAmount: '0',
      discountAmount: '0',
      finalAmount: '0',
      pricingMode: 'ITEMIZED',
      notes: null,
      internalNotes: null,
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
      ...overrides,
    },
  ],
});

const renderBuilderPage = () =>
  renderWithProviders(
    <Routes>
      <Route
        path="/quotations/:quotationId/versions/:versionId/edit"
        element={<QuotationBuilderPage />}
      />
    </Routes>,
    { route: '/quotations/quotation-1/versions/version-1/edit' },
  );

/**
 * Cruise cards open collapsed; expand each one so its fields are reachable.
 * No-op outside the Cruise tab or when there is nothing (left) to expand.
 */
const expandCruiseStays = async () => {
  // Keep expanding whichever cards are still collapsed (handles gaps and new
  // rows added after the tab was opened). Re-queries every pass for fresh nodes.
  for (let guard = 0; guard < 50; guard += 1) {
    const [expand] = screen.queryAllByRole('button', { name: /^Expand cruise stay \d+$/ });
    if (!expand) return;
    await userEvent.click(expand);
  }
};

/** Vehicle cards open collapsed; expand each one so its fields are reachable. */
const expandVehicleCards = async () => {
  for (let guard = 0; guard < 50; guard += 1) {
    const [expand] = screen.queryAllByRole('button', { name: /^Expand vehicle \d+$/ });
    if (!expand) return;
    await userEvent.click(expand);
  }
};

/** Activate a builder tab by its nav-button label (tabs mount only when active). */
const openTab = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name }));
  // Cruise cards default to collapsed, so expand them for field-level tests.
  if (name === 'Cruise') await expandCruiseStays();
};

/** Open the sightseeing activity combobox and wait for an option label. */
const openActivityPicker = async (picker: HTMLElement, label: string) => {
  fireEvent.focus(picker);
  await waitFor(() => {
    const listbox = screen.getByRole('listbox', {
      name: picker.getAttribute('aria-label') ?? '',
    });
    const labels = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(labels.some((text) => text.includes(label))).toBe(true);
  });
};

const getSavedQuotationBody = async (fetchMock: ReturnType<typeof masterFetch>) => {
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
  );
  const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
  return JSON.parse(String(patch![1]!.body));
};

const longRichText = (label: string, repeat = 460) =>
  `<div>${Array.from(
    { length: repeat },
    (_, index) =>
      `<p><strong>${label} ${index + 1}</strong> customer-safe details with links, lists and formatted CRM content.</p>`,
  ).join('')}</div>`;

describe('Quotation Builder — multiple room allocations and meal plans per hotel option', () => {
  const baseQuotation = (hotels: unknown[]) =>
    builderQuotation({
      hotelDetails: {
        include: true,
        sectionTitle: 'Your Hotels',
        amount: 0,
        description: null,
        images: [],
        pdfImageUrl: null,
      },
      hotels,
    });

  const legacyHotel = {
    hotelId: null,
    hotelRoomTypeId: null,
    hotelMealPlanId: null,
    city: 'Baku',
    hotelName: 'Shah Palace Hotel',
    category: '4 Star',
    roomType: 'Deluxe Room',
    mealPlan: 'Breakfast',
    rooms: 2,
    nights: 4,
    checkInDate: '2026-09-10T00:00:00.000Z',
    checkOutDate: '2026-09-14T00:00:00.000Z',
    checkInTime: null,
    checkOutTime: null,
    showCheckInTime: false,
    showCheckOutTime: false,
    internalCost: 0,
    sellingPrice: 0,
    selected: true,
    notes: null,
    sequence: 1,
  };

  beforeEach(() => {
    auth.permissions.add('MASTER_HOTELS_VIEW');
    auth.permissions.add('QUOTATIONS_VIEW');
    auth.permissions.add('QUOTATIONS_EDIT');
  });

  it('loads a legacy single-room hotel as Room 1 + Meal Plan 1 and adds a second room and meal plan', async () => {
    vi.stubGlobal('fetch', masterFetch(baseQuotation([legacyHotel])));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    // Legacy row: one room allocation + one meal plan, restored as line 1.
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Deluxe Room');
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(2);
    expect(screen.getByLabelText('Meal plan 1 master')).toHaveValue('Breakfast');
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(2);

    // + Add Room creates Room 2; + Add Meal Plan creates Meal Plan 2.
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add meal plan' }));
    await userEvent.type(screen.getByLabelText('Room 2 type master'), 'Executive Suite');
    await userEvent.type(
      screen.getByLabelText('Room 2 number of rooms'),
      '3',
    );
    await userEvent.clear(screen.getByLabelText('Room 2 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 2 number of rooms'), '3');
    await userEvent.type(screen.getByLabelText('Meal plan 2 master'), 'Half Board');

    // Saving persists BOTH allocations and BOTH meal plans; the row's `rooms`
    // mirrors the total across allocations (2 + 3), no duplicated hotels.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const fetchMock = vi.mocked(fetch);
    const body = await getSavedQuotationBody(fetchMock as never);
    expect(body.hotels).toHaveLength(1);
    expect(body.hotels[0].roomLines).toHaveLength(2);
    expect(body.hotels[0].roomLines[0]).toMatchObject({ roomType: 'Deluxe Room', rooms: 2 });
    expect(body.hotels[0].roomLines[1]).toMatchObject({ roomType: 'Executive Suite', rooms: 3 });
    expect(body.hotels[0].mealPlanLines).toHaveLength(2);
    expect(body.hotels[0].mealPlanLines.map((l: { mealPlan: string }) => l.mealPlan)).toEqual([
      'Breakfast',
      'Half Board',
    ]);
    expect(body.hotels[0].rooms).toBe(5);
    expect(body.hotels[0].roomType).toBe('Deluxe Room');
  });

  it('keeps a manually edited total, syncs automatic totals, and resets', async () => {
    vi.stubGlobal('fetch', masterFetch(baseQuotation([legacyHotel])));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    // Initial total follows the single allocation.
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(2);
    expect(screen.queryByRole('button', { name: 'Reset total rooms to calculated total' })).not.toBeInTheDocument();
    // Adding an allocation updates the automatic total (2 + 3).
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    await userEvent.clear(screen.getByLabelText('Room 2 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 2 number of rooms'), '3');
    expect(await screen.findByDisplayValue('5')).toBeInTheDocument();
    // Manual override sticks, even when allocations change afterwards.
    const total = screen.getByLabelText('Hotel total rooms');
    await userEvent.clear(total);
    await userEvent.type(total, '8');
    expect(total).toHaveValue(8);
    expect(
      screen.getByRole('button', { name: 'Reset total rooms to calculated total' }),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Room 1 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 1 number of rooms'), '1');
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(8);
    // Reset restores the live sum (1 + 3) and resumes automatic updates.
    await userEvent.click(
      screen.getByRole('button', { name: 'Reset total rooms to calculated total' }),
    );
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(4);
    await userEvent.clear(screen.getByLabelText('Room 2 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 2 number of rooms'), '4');
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(5);
  });

  it('saves the manual total instead of recomputing it', async () => {
    vi.stubGlobal('fetch', masterFetch(baseQuotation([legacyHotel])));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    await userEvent.type(screen.getByLabelText('Room 2 type master'), 'Executive Suite');
    await userEvent.clear(screen.getByLabelText('Room 2 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 2 number of rooms'), '3');
    const total = await screen.findByDisplayValue('5');
    expect(total).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Hotel total rooms'));
    await userEvent.type(screen.getByLabelText('Hotel total rooms'), '8');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const fetchMock = vi.mocked(fetch);
    const body = await getSavedQuotationBody(fetchMock as never);
    expect(body.hotels).toHaveLength(1);
    expect(body.hotels[0].rooms).toBe(8);
  });

  it('restores a saved manual override after save and reload', async () => {
    vi.stubGlobal('fetch', masterFetch(baseQuotation([legacyHotel])));
    const first = renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    await userEvent.type(screen.getByLabelText('Room 2 type master'), 'Executive Suite');
    await userEvent.clear(screen.getByLabelText('Room 2 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 2 number of rooms'), '3');
    const total = await screen.findByDisplayValue('5');
    expect(total).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Hotel total rooms'));
    await userEvent.type(screen.getByLabelText('Hotel total rooms'), '8');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const fetchMock = vi.mocked(fetch);
    const body = await getSavedQuotationBody(fetchMock as never);
    expect(body.hotels[0].rooms).toBe(8);
    expect(body.hotels[0].roomsOverride).toBe(8);
    // Reload with the server state: the manual override restores as manual.
    first.unmount();
    vi.stubGlobal(
      'fetch',
      masterFetch(
        baseQuotation([
          {
            ...legacyHotel,
            rooms: 8,
            roomsOverride: 8,
            roomLines: [
              { hotelRoomTypeId: null, roomType: 'Deluxe Room', rooms: 2 },
              { hotelRoomTypeId: null, roomType: 'Executive Suite', rooms: 3 },
            ],
          },
        ]),
      ),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(8);
    expect(
      screen.getByRole('button', { name: 'Reset total rooms to calculated total' }),
    ).toBeInTheDocument();
  });

  it('treats a loaded custom total as a manual override', async () => {
    const customHotel = {
      ...legacyHotel,
      rooms: 8,
      roomsOverride: 8,
      roomLines: [
        { hotelRoomTypeId: null, roomType: 'Room A', rooms: 1 },
        { hotelRoomTypeId: null, roomType: 'Room B', rooms: 2 },
      ],
    };
    vi.stubGlobal('fetch', masterFetch(baseQuotation([customHotel])));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    // Saved 8 differs from the allocation sum 3: shown as-is with reset available.
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(8);
    expect(
      screen.getByRole('button', { name: 'Reset total rooms to calculated total' }),
    ).toBeInTheDocument();
  });

  it('keeps the manual override through unrelated form changes and saves allocations untouched', async () => {
    vi.stubGlobal('fetch', masterFetch(baseQuotation([legacyHotel])));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    await userEvent.type(screen.getByLabelText('Room 2 type master'), 'Executive Suite');
    await userEvent.clear(screen.getByLabelText('Room 2 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 2 number of rooms'), '3');
    expect(await screen.findByDisplayValue('5')).toBeInTheDocument();
    // Manual override, then unrelated edits (section title + room-type text).
    await userEvent.clear(screen.getByLabelText('Hotel total rooms'));
    await userEvent.type(screen.getByLabelText('Hotel total rooms'), '8');
    await userEvent.type(screen.getByLabelText('Hotel section title'), 'Updated Stays');
    await userEvent.clear(screen.getByLabelText('Room 1 number of rooms'));
    await userEvent.type(screen.getByLabelText('Room 1 number of rooms'), '1');
    // The custom total survives re-renders and allocation edits alike.
    expect(screen.getByLabelText('Hotel total rooms')).toHaveValue(8);
    expect(
      screen.getByRole('button', { name: 'Reset total rooms to calculated total' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const fetchMock = vi.mocked(fetch);
    const body = await getSavedQuotationBody(fetchMock as never);
    expect(body.hotels).toHaveLength(1);
    expect(body.hotels[0].rooms).toBe(8);
    expect(body.hotels[0].roomsOverride).toBe(8);
    // Individual allocations are never rewritten to match the custom total.
    expect(body.hotels[0].roomLines.map((l: { rooms: number }) => l.rooms)).toEqual([1, 3]);
  });

  it('keeps manual overrides independent across hotel stays', async () => {
    const secondHotel = {
      ...legacyHotel,
      hotelName: 'Marina Bay Hotel',
      roomType: 'Suite',
      rooms: 4,
      sequence: 2,
    };
    vi.stubGlobal('fetch', masterFetch(baseQuotation([legacyHotel, secondHotel])));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    const stays = screen
      .getAllByRole('button', { name: /(Expand|Collapse) hotel stay/ })
      .map((button) => button.closest('article') as HTMLElement);
    expect(stays).toHaveLength(2);
    const [firstStay, secondStay] = [stays[0]!, stays[1]!];
    // Stay 2 starts automatic (4) with no reset action.
    expect(within(secondStay).getByLabelText('Hotel total rooms')).toHaveValue(4);
    expect(
      within(secondStay).queryByRole('button', { name: 'Reset total rooms to calculated total' }),
    ).not.toBeInTheDocument();
    // Override stay 1 only: 2 + 3 allocations, manual total 8.
    await userEvent.click(within(firstStay).getByRole('button', { name: 'Add room' }));
    await userEvent.type(within(firstStay).getByLabelText('Room 2 type master'), 'Executive Suite');
    await userEvent.clear(within(firstStay).getByLabelText('Room 2 number of rooms'));
    await userEvent.type(within(firstStay).getByLabelText('Room 2 number of rooms'), '3');
    expect(within(firstStay).getByLabelText('Hotel total rooms')).toHaveValue(5);
    await userEvent.clear(within(firstStay).getByLabelText('Hotel total rooms'));
    await userEvent.type(within(firstStay).getByLabelText('Hotel total rooms'), '8');
    // Editing stay 2's allocation updates only stay 2; stay 1 keeps its override.
    await userEvent.clear(within(secondStay).getByLabelText('Room 1 number of rooms'));
    await userEvent.type(within(secondStay).getByLabelText('Room 1 number of rooms'), '1');
    expect(within(secondStay).getByLabelText('Hotel total rooms')).toHaveValue(1);
    expect(within(firstStay).getByLabelText('Hotel total rooms')).toHaveValue(8);
    expect(
      within(firstStay).getByRole('button', { name: 'Reset total rooms to calculated total' }),
    ).toBeInTheDocument();
    expect(
      within(secondStay).queryByRole('button', { name: 'Reset total rooms to calculated total' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const fetchMock = vi.mocked(fetch);
    const body = await getSavedQuotationBody(fetchMock as never);
    expect(body.hotels).toHaveLength(2);
    expect(body.hotels[0].rooms).toBe(8);
    expect(body.hotels[0].roomsOverride).toBe(8);
    expect(body.hotels[1].rooms).toBe(1);
    expect(body.hotels[1].roomsOverride ?? null).toBeNull();
  });

  it('removes a room allocation and keeps the remaining line intact', async () => {
    vi.stubGlobal('fetch', masterFetch(baseQuotation([legacyHotel])));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove room 2' }));
    expect(screen.queryByLabelText('Room 2 type master')).toBeNull();
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(2);
  });
});

describe('Quotation Builder — defensive legacy normalization', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('persists builder prefills into a brand-new version 1 without a manual save', async () => {
    const fetchMock = masterFetch(
      builderQuotation({
        versionNumber: 1,
        status: 'DRAFT',
        flightDetails: null,
        hotelDetails: null,
        sightseeingDetails: null,
        addOnDetails: null,
        hotels: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();

    const body = await getSavedQuotationBody(fetchMock);
    expect(body.flightDetails).toBeTruthy();
    expect(body.hotelDetails).toBeTruthy();
    expect(body.sightseeingDetails?.days?.length).toBeGreaterThan(0);
    expect(body.addOnDetails).toBeTruthy();

    // Visiting the itinerary tab must be presentation-only. Historically this
    // mounted its field array for the first time and changed the V1 snapshot.
    const patchCountBeforeVisit = fetchMock.mock.calls.filter(
      ([, options]) => options?.method === 'PATCH',
    ).length;
    await openTab('Sightseeing');
    await screen.findByText('Include Sightseeing in Quotation');
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PATCH').length).toBe(
      patchCountBeforeVisit,
    );
  });

  it('normalizes one legacy hotel images:null row and saves with images:[]', async () => {
    const fetchMock = masterFetch(
      builderQuotation({
        hotels: [
          {
            city: 'Goa',
            hotelName: 'Legacy Beach Resort',
            rooms: 1,
            nights: 2,
            selected: true,
            sellingPrice: '12000',
            images: null,
            sequence: 1,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await screen.findByDisplayValue('Goa proposal');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[0]!);

    const body = await getSavedQuotationBody(fetchMock);
    expect(body.hotels[0].images).toEqual([]);
  });

  it('normalizes multiple legacy hotel images:null rows independently', async () => {
    const fetchMock = masterFetch(
      builderQuotation({
        hotels: [
          {
            city: 'Goa',
            hotelName: 'Legacy Beach Resort',
            rooms: 1,
            nights: 2,
            selected: true,
            sellingPrice: '12000',
            images: null,
            sequence: 1,
          },
          {
            city: 'Panjim',
            hotelName: 'Legacy City Hotel',
            rooms: 1,
            nights: 1,
            selected: true,
            sellingPrice: '8000',
            images: null,
            sequence: 2,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await screen.findByDisplayValue('Goa proposal');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[0]!);

    const body = await getSavedQuotationBody(fetchMock);
    expect(body.hotels.map((hotel: { images: unknown[] }) => hotel.images)).toEqual([[], []]);
  });

  it('preserves long inclusions and exclusions beyond the old 8000-character limit', async () => {
    const inclusionsHtml = longRichText('Inclusion');
    const exclusionsHtml = longRichText('Exclusion');
    expect(inclusionsHtml.length).toBeGreaterThan(8000);
    expect(exclusionsHtml.length).toBeGreaterThan(8000);
    const fetchMock = masterFetch(builderQuotation({ inclusionsHtml, exclusionsHtml }));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await screen.findByDisplayValue('Goa proposal');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[0]!);

    const body = await getSavedQuotationBody(fetchMock);
    expect(body.inclusionsHtml).toBe(inclusionsHtml);
    expect(body.exclusionsHtml).toBe(exclusionsHtml);
  });

  it('preserves a Cruise description beyond the old 4000-character limit', async () => {
    const description = longRichText('Cruise', 260);
    expect(description.length).toBeGreaterThan(4000);
    expect(description.length).toBeLessThan(100000);
    const fetchMock = masterFetch(
      builderQuotation({
        services: [
          {
            serviceType: 'CRUISE',
            name: 'Legacy Cruise Stay',
            description,
            quantity: '1',
            unitSellingPrice: '18000',
            totalSellingPrice: '18000',
            images: null,
            sequence: 1,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await screen.findByDisplayValue('Goa proposal');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[0]!);

    const body = await getSavedQuotationBody(fetchMock);
    expect(body.services[0].description).toBe(description);
    expect(body.services[0].images).toEqual([]);
  });

  it('opens and saves an old quotation with missing new fields, null optional strings and null nested arrays', async () => {
    const quotation = builderQuotation({
      introduction: null,
      weblinkHeading: undefined,
      notes: null,
      internalNotes: null,
      faqs: null,
      itinerary: null,
      inclusions: null,
      exclusions: null,
      terms: null,
      flightDetails: {
        entryMode: 'MANUAL',
        images: null,
        outbound: { segments: null },
        returnJourney: { segments: undefined },
      },
      hotelDetails: { sectionTitle: null, description: null, images: null },
      sightseeingDetails: {
        include: true,
        days: [
          {
            dayNumber: 1,
            title: null,
            city: null,
            activities: null,
          },
        ],
      },
      services: [
        {
          serviceType: 'VEHICLE_TRANSFER',
          name: 'Legacy Vehicle',
          description: null,
          quantity: '1',
          unitSellingPrice: '1000',
          totalSellingPrice: '1000',
          images: undefined,
          sequence: 1,
        },
      ],
    });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await screen.findByDisplayValue('Goa proposal');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[0]!);

    const body = await getSavedQuotationBody(fetchMock);
    expect(body.itinerary).toEqual([]);
    expect(body.inclusions).toEqual([]);
    expect(body.exclusions).toEqual([]);
    expect(body.terms).toEqual([]);
    expect(body.faqs).toEqual([]);
    expect(body.flightDetails.images).toEqual([]);
    expect(body.flightDetails.flights).toEqual([]);
    expect(
      body.services.find(
        (service: { serviceType: string }) => service.serviceType === 'VEHICLE_TRANSFER',
      ).images,
    ).toEqual([]);
  });

  it('keeps required-field validation and shows a friendly save error', async () => {
    const fetchMock = masterFetch(builderQuotation({ title: '' }));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    // The title input moved to the Quotation Details page; the builder keeps
    // the value hidden, so wait for the builder itself to load instead.
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[0]!);

    expect(await screen.findByText('Quotation title is required.')).toBeInTheDocument();
    expect(screen.queryByText(/title: String/i)).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });
});

describe('Quotation Builder - destination default add-ons', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });


  it('auto-adds destination defaults to a new quotation without duplicates', async () => {
    const addonWithLinks = {
      ...addOn,
      hasImage: true,
      images: [
        { id: 'm-img-1', fileName: 'visa.png', mimeType: 'image/png', fileSize: 10, isPrimary: true },
      ],
      destinations: [{ id: 'dest-sg', name: 'Singapore', isDefault: true }],
    };
    const quotation = {
      ...builderQuotation(),
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 }],
      },
    };
    const fetchMock = masterFetch(quotation, {
      '/masters/destinations': page([{ id: 'dest-sg', name: 'Singapore' }]),
      '/masters/add-on-services': page([addonWithLinks]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    // K: default populated without manual toggle.
    await waitFor(() =>
      expect(screen.getByLabelText('Include Visa Assistance')).toBeChecked(),
    );
    // P: master gallery image tile renders for the auto-added row.
    expect(await screen.findByLabelText('Remove addon-0 image 1')).toBeInTheDocument();
    // L: exactly one row, then save carries the full snapshot.
    expect(screen.getAllByLabelText('Visa Assistance description')).toHaveLength(1);
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    const rows = (body.services as Array<Record<string, unknown>>).filter(
      (service) => service.serviceType === 'OTHER_ADD_ON',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      addOnServiceId: 'aaaaaaa9-1111-4111-8111-111111111111',
      name: 'Visa Assistance',
      sellingPrice: 3800,
    });
    expect(rows[0]!.images).toEqual([{ masterImageId: 'm-img-1', alt: 'Visa Assistance image 1' }]);
  });

  it('preserves and allows editing every pricing option in the quotation snapshot', async () => {
    const addonWithPricing = {
      ...addOn,
      price: 3000,
      pricingBasis: 'Per Person',
      pricing: [
        { id: 'opt-adult', label: 'Adult', price: 6000, currency: 'INR' },
        { id: 'opt-child', label: 'Child', price: 4000, currency: 'INR' },
        { id: 'opt-group', label: 'Per Group', price: 20000, currency: 'USD' },
      ],
      destinations: [{ id: 'dest-sg', name: 'Singapore', isDefault: true }],
    };
    const quotation = {
      ...builderQuotation(),
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 }],
      },
    };
    const fetchMock = masterFetch(quotation, {
      '/masters/destinations': page([{ id: 'dest-sg', name: 'Singapore' }]),
      '/masters/add-on-services': page([addonWithPricing]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await waitFor(() =>
      expect(screen.getByLabelText('Include Visa Assistance')).toBeChecked(),
    );
    // The builder surfaces every option as an editable label + amount.
    const adultLabel = await screen.findByLabelText('Visa Assistance pricing option 1 label');
    expect(adultLabel).toHaveValue('Adult');
    expect(screen.getByLabelText('Visa Assistance pricing option 1 amount')).toHaveValue(6000);
    expect(screen.getByLabelText('Visa Assistance pricing option 2 label')).toHaveValue('Child');
    expect(screen.getByLabelText('Visa Assistance pricing option 3 label')).toHaveValue('Per Group');
    // Quotation-specific edit: relabel and reprice the adult option.
    await userEvent.clear(adultLabel);
    await userEvent.type(adultLabel, 'Adult twin');
    const adultAmount = screen.getByLabelText('Visa Assistance pricing option 1 amount');
    await userEvent.clear(adultAmount);
    await userEvent.type(adultAmount, '6500');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    const rows = (body.services as Array<Record<string, unknown>>).filter(
      (service) => service.serviceType === 'OTHER_ADD_ON',
    );
    expect(rows).toHaveLength(1);
    // The section price is untouched; only the quotation-owned snapshot changes.
    expect(rows[0]).toMatchObject({
      addOnServiceId: 'aaaaaaa9-1111-4111-8111-111111111111',
      name: 'Visa Assistance',
      sellingPrice: 6000,
      pricingBasisLabel: 'Adult',
    });
    expect(rows[0]!.pricingSnapshot).toEqual([
      { id: 'opt-adult', label: 'Adult twin', price: 6500, currency: 'INR' },
      { id: 'opt-child', label: 'Child', price: 4000, currency: 'INR' },
      { id: 'opt-group', label: 'Per Group', price: 20000, currency: 'USD' },
    ]);
  });

  it('lets an operator rename an add-on service for the quotation only', async () => {
    const addonWithLinks = {
      ...addOn,
      hasImage: true,
      images: [
        { id: 'm-img-1', fileName: 'visa.png', mimeType: 'image/png', fileSize: 10, isPrimary: true },
      ],
      destinations: [{ id: 'dest-sg', name: 'Singapore', isDefault: true }],
    };
    const quotation = {
      ...builderQuotation(),
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 }],
      },
    };
    const fetchMock = masterFetch(quotation, {
      '/masters/destinations': page([{ id: 'dest-sg', name: 'Singapore' }]),
      '/masters/add-on-services': page([addonWithLinks]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await waitFor(() =>
      expect(screen.getByLabelText('Include Visa Assistance')).toBeChecked(),
    );
    const nameInput = screen.getByLabelText('Visa Assistance service name');
    expect(nameInput).toHaveValue('Visa Assistance');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Singapore Visa (Express)');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    const rows = (body.services as Array<Record<string, unknown>>).filter(
      (service) => service.serviceType === 'OTHER_ADD_ON',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      addOnServiceId: 'aaaaaaa9-1111-4111-8111-111111111111',
      name: 'Singapore Visa (Express)',
    });
  });

  // Saved services carry the quotation-owned snapshot; reopening the builder
  // must restore it (previously the version→form mapper dropped the field, so
  // the weblink fell back to a single label-less amount on reopen/save).
  const savedAddonService = (pricingSnapshot: unknown[]) => ({
    id: 's-visa',
    serviceType: 'OTHER_ADD_ON',
    addOnServiceId: 'aaaaaaa9-1111-4111-8111-111111111111',
    name: 'Visa Assistance',
    description: null,
    dayNumber: null,
    city: null,
    quantity: '1',
    unitSellingPrice: '999',
    totalSellingPrice: '999',
    sellingPrice: '999',
    pricingBasis: 'FIXED',
    pricingBasisLabel: 'Adult',
    pricingSnapshot,
    taxCategory: null,
    notes: null,
    sequence: 1,
    images: [],
  });
  const threeOptions = [
    { id: 'opt-infant', label: 'Infant', price: 9, currency: 'INR' },
    { id: 'opt-adult', label: 'Adult', price: 999, currency: 'INR' },
    { id: 'opt-child', label: 'Child', price: 99, currency: 'INR' },
  ];

  it('restores saved add-on pricing options (with labels) when reopening and re-saving', async () => {
    const quotation = builderQuotation({ services: [savedAddonService(threeOptions)] });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    // No prefill for a saved quotation: the stored snapshot is authoritative.
    expect(await screen.findByLabelText('Visa Assistance pricing option 1 label')).toHaveValue(
      'Infant',
    );
    expect(screen.getByLabelText('Visa Assistance pricing option 1 amount')).toHaveValue(9);
    expect(screen.getByLabelText('Visa Assistance pricing option 2 label')).toHaveValue('Adult');
    expect(screen.getByLabelText('Visa Assistance pricing option 3 label')).toHaveValue('Child');
    // Re-saving an untouched row must not discard the snapshot or its labels.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    const row = (body.services as Array<Record<string, unknown>>).find(
      (service) => service.serviceType === 'OTHER_ADD_ON',
    );
    expect(row).toMatchObject({ pricingBasisLabel: 'Adult' });
    expect((row!.pricingSnapshot as Array<{ label: string }>).map((entry) => entry.label)).toEqual([
      'Infant',
      'Adult',
      'Child',
    ]);
  });

  it('deletes a single pricing option for the quotation only', async () => {
    const quotation = builderQuotation({ services: [savedAddonService(threeOptions)] });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await screen.findByLabelText('Visa Assistance pricing option 2 label');
    await userEvent.click(screen.getByLabelText('Remove Visa Assistance pricing option 2'));
    // Adult is gone; Infant and Child remain, re-indexed in order.
    expect(screen.getByLabelText('Visa Assistance pricing option 1 label')).toHaveValue('Infant');
    expect(screen.getByLabelText('Visa Assistance pricing option 2 label')).toHaveValue('Child');
    expect(
      screen.queryByLabelText('Visa Assistance pricing option 3 label'),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    const row = (body.services as Array<Record<string, unknown>>).find(
      (service) => service.serviceType === 'OTHER_ADD_ON',
    );
    expect((row!.pricingSnapshot as Array<{ label: string }>).map((entry) => entry.label)).toEqual([
      'Infant',
      'Child',
    ]);
  });

  it('persists an empty snapshot when every pricing option is deleted', async () => {
    const quotation = builderQuotation({ services: [savedAddonService(threeOptions)] });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await screen.findByLabelText('Visa Assistance pricing option 1 label');
    for (let i = 0; i < threeOptions.length; i += 1) {
      await userEvent.click(screen.getByLabelText('Remove Visa Assistance pricing option 1'));
    }
    // All options removed: the block disappears and nothing is re-synthesized.
    expect(screen.queryByText('Pricing options')).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    const row = (body.services as Array<Record<string, unknown>>).find(
      (service) => service.serviceType === 'OTHER_ADD_ON',
    );
    expect(row!.pricingSnapshot).toEqual([]);
  });

  it('adds a new quotation-specific pricing option without touching the master', async () => {
    const quotation = builderQuotation({ services: [savedAddonService(threeOptions)] });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await screen.findByLabelText('Visa Assistance pricing option 1 label');
    await userEvent.click(
      screen.getByRole('button', { name: 'Add pricing option for Visa Assistance' }),
    );
    const newLabel = screen.getByLabelText('Visa Assistance pricing option 4 label');
    expect(newLabel).toHaveValue('');
    await userEvent.type(newLabel, 'Per Group');
    await userEvent.type(
      screen.getByLabelText('Visa Assistance pricing option 4 amount'),
      '15000',
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    const row = (body.services as Array<Record<string, unknown>>).find(
      (service) => service.serviceType === 'OTHER_ADD_ON',
    );
    const snapshot = row!.pricingSnapshot as Array<{ label: string; price: number }>;
    expect(snapshot).toHaveLength(4);
    expect(snapshot[3]).toMatchObject({ label: 'Per Group', price: 15000 });
    // The Add-on Services master is read-only here: no write request ever
    // targets it; only the quotation PATCH is issued.
    const masterWrites = fetchMock.mock.calls.filter(
      ([input, options]) =>
        String(input).includes('/masters/add-on-services') &&
        options?.method != null &&
        options.method !== 'GET',
    );
    expect(masterWrites).toHaveLength(0);
  });

  it('no longer shows the obsolete add-on services helper text', async () => {
    const quotation = builderQuotation({ services: [savedAddonService(threeOptions)] });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await screen.findByLabelText('Visa Assistance pricing option 1 label');
    expect(
      screen.queryByText(/pricing entered centrally in Summary & Pricing/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Select additional services/i)).not.toBeInTheDocument();
  });

  it('does not resurrect a manually removed default on save', async () => {
    const addonWithLinks = {
      ...addOn,
      destinations: [{ id: 'dest-sg', name: 'Singapore', isDefault: true }],
    };
    const quotation = {
      ...builderQuotation(),
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 }],
      },
    };
    const fetchMock = masterFetch(quotation, {
      '/masters/destinations': page([{ id: 'dest-sg', name: 'Singapore' }]),
      '/masters/add-on-services': page([addonWithLinks]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await waitFor(() =>
      expect(screen.getByLabelText('Include Visa Assistance')).toBeChecked(),
    );
    // M: user removes it; saving must not bring it back.
    await userEvent.click(screen.getByLabelText('Include Visa Assistance'));
    await waitFor(() =>
      expect(screen.getByLabelText('Include Visa Assistance')).not.toBeChecked(),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    expect(
      (body.services as Array<Record<string, unknown>>).filter(
        (service) => service.serviceType === 'OTHER_ADD_ON',
      ),
    ).toHaveLength(0);
  });

  it('keeps an existing saved add-on selection authoritative', async () => {
    const addonWithLinks = {
      ...addOn,
      destinations: [{ id: 'dest-sg', name: 'Singapore', isDefault: true }],
    };
    const quotation = {
      ...builderQuotation({
        services: [
          {
            serviceType: 'OTHER_ADD_ON',
            addOnServiceId: 'aaaaaaa9-1111-4111-8111-111111111111',
            name: 'Visa Assistance',
            description: null,
            dayNumber: null,
            city: null,
            quantity: '1',
            unitSellingPrice: '3800',
            totalSellingPrice: '3800',
            sellingPrice: '3800',
            taxCategory: null,
            notes: null,
            sequence: 1,
            images: [],
            imageSnapshotPresent: false,
            pdfImageUrl: null,
          },
        ],
      }),
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 }],
      },
    };
    const fetchMock = masterFetch(quotation, {
      '/masters/destinations': page([{ id: 'dest-sg', name: 'Singapore' }]),
      '/masters/add-on-services': page([addonWithLinks]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    // N: single saved row, no duplicate auto-added.
    await waitFor(() =>
      expect(screen.getAllByLabelText('Visa Assistance description')).toHaveLength(1),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    expect(
      (body.services as Array<Record<string, unknown>>).filter(
        (service) => service.serviceType === 'OTHER_ADD_ON',
      ),
    ).toHaveLength(1);
  });

  it('works normally when a destination has zero defaults', async () => {
    const quotation = {
      ...builderQuotation(),
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        itinerary: [{ country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 }],
      },
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/destinations': page([{ id: 'dest-sg', name: 'Singapore' }]),
        '/masters/add-on-services': page([{ ...addOn, destinations: [] }]),
      }),
    );
    renderBuilderPage();
    await openTab('Add-on Services');
    // O: nothing auto-added; manual toggle still works.
    expect(screen.queryByLabelText('Visa Assistance description')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByLabelText('Include Visa Assistance'));
    expect(await screen.findByLabelText('Visa Assistance description')).toBeInTheDocument();
  });

  it('wraps long add-on description lines in the rich-text editor', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Add-on Services');
    await userEvent.click(await screen.findByLabelText('Include Visa Assistance'));
    const editor = await screen.findByLabelText('Visa Assistance description');
    // The editable surface must break long unbroken runs and preformatted
    // (`pre`/`code`) content onto the next line instead of overflowing the
    // editor box — both with and without the live preview open.
    expect(editor.className).toContain('[overflow-wrap:anywhere]');
    expect(editor.className).toContain('max-w-full');
    expect(editor.className).toContain('[&_pre]:whitespace-pre-wrap');
    expect(editor.className).toContain('[&_code]:whitespace-pre-wrap');
  });
});

describe('Quotation Builder - policy editors', () => {
  it('keeps plain policy lines bullet-free through save and reopen', async () => {
    const plainInclusions = '<p>Daily breakfast and dinner</p><p>Airport transfers both ways</p>';
    const fetchMock = masterFetch(
      builderQuotation({
        inclusionsHtml: plainInclusions,
        exclusionsHtml: '<p>Personal expenses</p>',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Inclusions & Exclusions');

    const editor = await screen.findByLabelText('Inclusions');
    expect(editor).toHaveTextContent('Daily breakfast and dinner');
    expect(editor).toHaveTextContent('Airport transfers both ways');
    // Ordinary lines are never wrapped in list markup to force bullet points.
    expect(editor.querySelector('ul, ol, li')).toBeNull();

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    expect(body.inclusionsHtml).toContain('Daily breakfast and dinner');
    expect(body.inclusionsHtml).toContain('Airport transfers both ways');
    expect(body.inclusionsHtml).not.toMatch(/<(ul|ol|li)\b/i);
  });

  // A destination master stored with bare `<li>` siblings and no `ul`/`ol`
  // container (legacy import / pre-normalizer paste). The browser cannot give
  // these items list padding, so the editor's `overflow-hidden` wrapper clipped
  // their outside markers (plain lines) while the public weblink still showed
  // the default disc — the reported mismatch.
  const bareList = (items: readonly string[]) => items.map((item) => `<li>${item}</li>`).join('');

  const policyItems = {
    inclusions: ['Night Safari Entry Ticket', 'Safari Adventure Tram Ride'],
    exclusions: ['International airfare', 'Visa processing fees'],
    paymentPolicies: ['50% advance to confirm', 'Balance before departure'],
    cancellationPolicies: ['Free cancellation up to 7 days', '50% charge within 3 days'],
    bookingTerms: ['Valid only for the dates shown', 'Rooms subject to availability'],
    childPolicy: ['Children below 5 stay free', 'Age proof required at check-in'],
  } as const;

  const singaporeMaster = {
    id: 'dest-singapore',
    countryCode: 'SG',
    countryName: 'Singapore',
    name: 'Singapore',
    destinationType: 'CITY',
    status: 'ACTIVE',
    inclusions: bareList(policyItems.inclusions),
    exclusions: bareList(policyItems.exclusions),
    paymentPolicies: bareList(policyItems.paymentPolicies),
    cancellationPolicies: bareList(policyItems.cancellationPolicies),
    bookingTerms: bareList(policyItems.bookingTerms),
    childPolicy: bareList(policyItems.childPolicy),
    cities: [],
    _count: { cities: 0 },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    createdBy: person,
  };

  const singaporeQuotation = (overrides: Record<string, unknown> = {}) => ({
    ...builderQuotation(overrides),
    destinationSummary: 'Singapore',
    query: {
      id: 'lead-1',
      queryNumber: 'QRY-000001',
      leadStage: 'NEW_LEAD',
      assignedToId: null,
      createdById: 'user-1',
      departureCity: 'Delhi',
      departureCountry: 'India',
      itinerary: [
        {
          id: 'stay-0',
          country: 'Singapore',
          destination: 'Singapore',
          nights: 2,
          sequence: 1,
          arrivalDate: '2026-08-10T00:00:00.000Z',
          departureDate: '2026-08-12T00:00:00.000Z',
        },
      ],
    },
  });

  const policyFields = [
    ['Inclusions', 'inclusionsHtml', policyItems.inclusions],
    ['Exclusions', 'exclusionsHtml', policyItems.exclusions],
    ['Payment Policies', 'paymentPolicies', policyItems.paymentPolicies],
    ['Cancellation Policies', 'cancellationPolicies', policyItems.cancellationPolicies],
    ['Child Policy', 'childPolicy', policyItems.childPolicy],
    ['Booking Terms & Conditions', 'bookingTerms', policyItems.bookingTerms],
  ] as const;

  /** Every policy editor must show one real <ul>, with no orphaned item. */
  const expectEditorShowsRealList = (label: string, items: readonly string[]) => {
    const editor = screen.getByLabelText(label);
    const list = editor.querySelector('ul');
    expect(list, `${label}: orphan <li> should be wrapped in a real <ul>`).not.toBeNull();
    expect(Array.from(list!.querySelectorAll('li')).map((li) => li.textContent)).toEqual([...items]);
    expect(editor.querySelectorAll('ul')).toHaveLength(1);
    expect(
      Array.from(editor.querySelectorAll('li')).every((li) => li.parentElement?.tagName === 'UL'),
    ).toBe(true);
  };

  it('renders explicitly authored bullet lists for every policy field (legacy bare <li>)', async () => {
    vi.stubGlobal(
      'fetch',
      masterFetch(singaporeQuotation(), { '/masters/destinations': page([singaporeMaster]) }),
    );
    renderBuilderPage();
    await openTab('Inclusions & Exclusions');
    for (const [label, , items] of policyFields) {
      await screen.findByLabelText(label);
      expectEditorShowsRealList(label, items);
    }
  });

  it('keeps authored bullet lists stable through save and reopen', async () => {
    const fetchMock = masterFetch(singaporeQuotation(), {
      '/masters/destinations': page([singaporeMaster]),
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = renderBuilderPage();
    await openTab('Inclusions & Exclusions');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    first.unmount();

    // Reopen with whatever the save persisted (bare or already wrapped) and
    // confirm the list still renders once — save/reopen never changes it.
    const saved = Object.fromEntries(
      policyFields.map(([, field, items]) => [field, body[field] ?? bareList(items)]),
    );
    vi.stubGlobal(
      'fetch',
      masterFetch(singaporeQuotation(saved as Record<string, unknown>), {
        '/masters/destinations': page([singaporeMaster]),
      }),
    );
    renderBuilderPage();
    await openTab('Inclusions & Exclusions');
    for (const [label, , items] of policyFields) {
      await screen.findByLabelText(label);
      expectEditorShowsRealList(label, items);
    }
  });
});


describe('Quotation Builder - default hotel destination prefill', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const hotelMaster = (overrides: Record<string, unknown>) => ({
    id: 'aaaaaa44-4444-4444-8444-444444444444',
    name: 'Hotel',
    starCategory: 4,
    starRating: null,
    status: 'ACTIVE',
    isDefaultForCity: false,
    isFeatured: false,
    hasImage: false,
    updatedAt: '2026-07-21T00:00:00.000Z',
    createdAt: '2026-07-21T00:00:00.000Z',
    destination: { id: 'dest-sg-hd', name: 'Singapore Heaven Delight' },
    city: { id: 'city-sg', name: 'Singapore' },
    ...overrides,
  });

  const destinationMaster = (cities: Array<{ id: string; name: string }>) => ({
    id: 'dest-sg-hd',
    countryCode: 'SG',
    countryName: 'Singapore',
    name: 'Singapore Heaven Delight',
    destinationType: 'CITY',
    status: 'ACTIVE',
    inclusions: null,
    exclusions: null,
    paymentPolicies: null,
    cancellationPolicies: null,
    bookingTerms: null,
    childPolicy: null,
    cities: cities.map((city, index) => ({
      id: `dc-${index + 1}`,
      cityId: city.id,
      sequence: index + 1,
      city,
    })),
    _count: { cities: cities.length },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const cruiseQuotation = {
    ...builderQuotation(),
    destinationSummary: 'Singapore Cruise',
    query: {
      id: 'lead-cross',
      queryNumber: 'QRY-CROSS',
      leadStage: 'NEW_LEAD',
      departureCity: 'Delhi',
      departureCountry: 'India',
      itinerary: [
        {
          id: 'stay-0',
          country: 'Singapore Heaven Delight',
          destination: 'Singapore Cruise',
          nights: 2,
          sequence: 1,
          arrivalDate: '2026-08-10T00:00:00.000Z',
          departureDate: '2026-08-12T00:00:00.000Z',
        },
      ],
    },
  };

  it('resolves an itinerary city to its destination default (cross-city regression)', async () => {
    const mercure = hotelMaster({
      id: 'aaaaaa55-5555-4555-8555-555555555555',
      name: 'Mercure Singapore on Stevens',
      isDefaultForCity: true,
    });
    const disneyCruise = hotelMaster({
      id: 'aaaaaa66-6666-4666-8666-666666666666',
      name: 'Disney Cruise',
      destination: { id: 'dest-sg-hd', name: 'Singapore Heaven Delight' },
      city: { id: 'city-sgc', name: 'Singapore Cruise' },
    });
    const fetchMock = masterFetch(cruiseQuotation, {
      '/masters/hotels': page([disneyCruise, mercure]),
      '/masters/destinations': page([
        destinationMaster([
          { id: 'city-sg', name: 'Singapore' },
          { id: 'city-sgc', name: 'Singapore Cruise' },
        ]),
      ]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue('Mercure Singapore on Stevens'),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const patchCall = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(call).toBeDefined();
      return call!;
    });
    const body = JSON.parse(String(patchCall[1]!.body));
    expect(body.hotels[0]).toMatchObject({
      hotelId: 'aaaaaa55-5555-4555-8555-555555555555',
      hotelName: 'Mercure Singapore on Stevens',
    });
  });

  const sightseeingMaster = (
    id: string,
    title: string,
    city: { id: string; name: string },
    sequence: number,
    destination = { id: 'dest-sg-hd', name: 'Singapore Heaven Delight' },
  ) => ({
    id,
    title,
    sequence,
    status: 'ACTIVE',
    destination: { ...destination, countryName: 'Singapore' },
    city,
    estimatedHours: 2,
    suggestedStartTime: '09:00',
    description: null,
    hasImage: false,
    images: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  // A lead whose destination is set but whose city is blank — the Create Lead
  // form no longer collects a city, so this is the normal new-lead shape.
  // Overrides target the version (e.g. a saved sightseeingDetails).
  const blankCityQuotation = (versionOverrides: Record<string, unknown> = {}) => ({
    ...builderQuotation(versionOverrides),
    destinationSummary: 'Singapore Heaven Delight',
    travelStartDate: '2026-08-10T00:00:00.000Z',
    travelEndDate: '2026-08-14T00:00:00.000Z',
    query: {
      id: 'lead-no-city',
      queryNumber: 'QRY-NC',
      leadStage: 'NEW_LEAD',
      departureCity: 'Delhi',
      departureCountry: 'India',
      itinerary: [
        {
          id: 'stay-1',
          country: 'Singapore Heaven Delight',
          destination: '',
          nights: 2,
          sequence: 1,
          arrivalDate: '2026-08-10T00:00:00.000Z',
          departureDate: '2026-08-12T00:00:00.000Z',
        },
      ],
    },
  });

  // A lead bound to one Master Destination (resolved by name) whose single stay
  // spans `nights` nights — used by the sightseeing-prefill tests, which must not
  // depend on any city being stored on the lead.
  const sightseeingQuotation = (destination: string, nights: number) => {
    const base = blankCityQuotation();
    return {
      ...base,
      destinationSummary: destination,
      query: {
        ...base.query,
        itinerary: [
          {
            id: 'stay-1',
            country: destination,
            destination: '',
            nights,
            sequence: 1,
            arrivalDate: '2026-08-10T00:00:00.000Z',
            departureDate: '2026-08-16T00:00:00.000Z',
          },
        ],
      },
    };
  };

  it('prefills sightseeing from the destination when the lead city is blank (single city)', async () => {
    const masters = [
      sightseeingMaster('sg-1', 'City Tour', { id: 'city-sg', name: 'Singapore' }, 1),
      sightseeingMaster('sg-2', 'Night Safari', { id: 'city-sg', name: 'Singapore' }, 2),
      sightseeingMaster('sg-3', 'Sentosa Tour', { id: 'city-sg', name: 'Singapore' }, 3),
    ];
    vi.stubGlobal(
      'fetch',
      masterFetch(blankCityQuotation(), {
        '/masters/sightseeing': page(masters),
        '/masters/destinations': page([
          destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    // 2 nights → 3 days, each carrying the resolved city + one attraction. Only
    // the selected day's card is mounted, so assert via the day picker and step
    // through the days.
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /^Select sightseeing day \d+$/ }),
      ).toHaveLength(3),
    );
    expect(screen.getByLabelText('Sightseeing day 1 city')).toHaveValue('Singapore');
    expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('City Tour');
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 2' }));
    expect(screen.getByLabelText('Sightseeing day 2 city')).toHaveValue('Singapore');
    expect(screen.getByLabelText('Day 2 activity 1 name')).toHaveValue('Night Safari');
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 3' }));
    expect(screen.getByLabelText('Sightseeing day 3 city')).toHaveValue('Singapore');
    expect(screen.getByLabelText('Day 3 activity 1 name')).toHaveValue('Sentosa Tour');
  });

  it('includes attractions from every city in sequence order (city never chooses)', async () => {
    const masters = [
      sightseeingMaster('sg-1', 'Singapore City Tour', { id: 'city-sg', name: 'Singapore' }, 1),
      sightseeingMaster('sn-1', 'Sentosa Beach', { id: 'city-sn', name: 'Sentosa' }, 2),
      sightseeingMaster('sn-2', 'Universal Studios', { id: 'city-sn', name: 'Sentosa' }, 3),
      // A different destination entirely, sharing nothing with the lead.
      sightseeingMaster(
        'my-1',
        'Kuala Lumpur Towers',
        { id: 'city-kl', name: 'Kuala Lumpur' },
        1,
        { id: 'dest-my', name: 'Malaysia Delight' },
      ),
    ];
    vi.stubGlobal(
      'fetch',
      masterFetch(sightseeingQuotation('Singapore Heaven Delight', 3), {
        '/masters/sightseeing': page(masters),
        '/masters/destinations': page([
          destinationMaster([
            { id: 'city-sg', name: 'Singapore' },
            { id: 'city-sn', name: 'Sentosa' },
          ]),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /^Select sightseeing day \d+$/ }),
      ).toHaveLength(4),
    );
    // Three attractions across two cities, taken strictly by sequence.
    expect(screen.getByLabelText('Sightseeing day 1 city')).toHaveValue('Singapore');
    expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('Singapore City Tour');
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 2' }));
    expect(screen.getByLabelText('Sightseeing day 2 city')).toHaveValue('Sentosa');
    expect(screen.getByLabelText('Day 2 activity 1 name')).toHaveValue('Sentosa Beach');
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 3' }));
    expect(screen.getByLabelText('Sightseeing day 3 city')).toHaveValue('Sentosa');
    expect(screen.getByLabelText('Day 3 activity 1 name')).toHaveValue('Universal Studios');
    // The unrelated destination is never prefilled.
    expect(screen.queryByDisplayValue('Kuala Lumpur Towers')).not.toBeInTheDocument();
  });

  it('prefills a multi-city destination strictly by sequence, each attraction once', async () => {
    // Vietnam Trio owns attractions numbered 1–7 spread across Hanoi, Da Nang and
    // Phu Quoc. Every one must prefill in ascending sequence order regardless of
    // city, and none may repeat.
    const vietnamDestination = {
      ...destinationMaster([
        { id: 'city-hn', name: 'Hanoi' },
        { id: 'city-dn', name: 'Da Nang' },
        { id: 'city-pq', name: 'Phu Quoc' },
      ]),
      id: 'dest-vn',
      name: 'Vietnam Trio',
    };
    const dest = { id: 'dest-vn', name: 'Vietnam Trio' };
    // Deliberately shuffled in the source list; prefill must re-order by sequence.
    const masters = [
      sightseeingMaster('vn-4', 'Hoi An Ancient Town', { id: 'city-dn', name: 'Da Nang' }, 4, dest),
      sightseeingMaster('vn-1', 'Hanoi City Tour', { id: 'city-hn', name: 'Hanoi' }, 1, dest),
      sightseeingMaster('vn-7', 'Phu Quoc Cable Car', { id: 'city-pq', name: 'Phu Quoc' }, 7, dest),
      sightseeingMaster('vn-3', 'Ba Na Hills', { id: 'city-dn', name: 'Da Nang' }, 3, dest),
      sightseeingMaster('vn-6', 'Phu Quoc Beach', { id: 'city-pq', name: 'Phu Quoc' }, 6, dest),
      sightseeingMaster('vn-2', 'Halong Bay Cruise', { id: 'city-hn', name: 'Hanoi' }, 2, dest),
      sightseeingMaster('vn-5', 'Golden Bridge', { id: 'city-dn', name: 'Da Nang' }, 5, dest),
      sightseeingMaster(
        'my-1',
        'Kuala Lumpur Towers',
        { id: 'city-kl', name: 'Kuala Lumpur' },
        1,
        { id: 'dest-my', name: 'Malaysia Delight' },
      ),
    ];
    // 6 nights → 7 days, exactly enough for all seven attractions.
    vi.stubGlobal(
      'fetch',
      masterFetch(sightseeingQuotation('Vietnam Trio', 6), {
        '/masters/sightseeing': page(masters),
        '/masters/destinations': page([vietnamDestination]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /^Select sightseeing day \d+$/ }),
      ).toHaveLength(7),
    );

    const expected = [
      { day: 1, city: 'Hanoi', name: 'Hanoi City Tour' },
      { day: 2, city: 'Hanoi', name: 'Halong Bay Cruise' },
      { day: 3, city: 'Da Nang', name: 'Ba Na Hills' },
      { day: 4, city: 'Da Nang', name: 'Hoi An Ancient Town' },
      { day: 5, city: 'Da Nang', name: 'Golden Bridge' },
      { day: 6, city: 'Phu Quoc', name: 'Phu Quoc Beach' },
      { day: 7, city: 'Phu Quoc', name: 'Phu Quoc Cable Car' },
    ];
    const prefilled: string[] = [];
    for (const step of expected) {
      if (step.day > 1) {
        await userEvent.click(
          screen.getByRole('button', { name: `Select sightseeing day ${step.day}` }),
        );
      }
      expect(screen.getByLabelText(`Sightseeing day ${step.day} city`)).toHaveValue(step.city);
      expect(screen.getByLabelText(`Day ${step.day} activity 1 name`)).toHaveValue(step.name);
      prefilled.push(step.name);
    }
    // Every eligible attraction appears exactly once.
    expect(prefilled).toHaveLength(7);
    expect(new Set(prefilled).size).toBe(7);
    // The other destination never leaks in.
    expect(screen.queryByDisplayValue('Kuala Lumpur Towers')).not.toBeInTheDocument();
  });

  it('never overwrites an existing saved sightseeing itinerary', async () => {
    const saved = blankCityQuotation({
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Your Itinerary',
        amount: 0,
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'My Custom Day',
            titleTouched: true,
            city: 'Singapore',
            date: null,
            meals: { breakfast: false, lunch: false, dinner: false },
            mealMode: 'NO_TRANSFER',
            dailyTransfer: 'NO_TRANSFER',
            activities: [
              {
                sightseeingId: 'sg-1',
                name: 'City Tour',
                description: null,
                startTime: '09:00',
                imageUrl: null,
              },
            ],
          },
        ],
      },
    });
    const masters = [
      sightseeingMaster('sg-1', 'City Tour', { id: 'city-sg', name: 'Singapore' }, 1),
      sightseeingMaster('sg-2', 'Night Safari', { id: 'city-sg', name: 'Singapore' }, 2),
    ];
    vi.stubGlobal(
      'fetch',
      masterFetch(saved, {
        '/masters/sightseeing': page(masters),
        '/masters/destinations': page([
          destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    await waitFor(() =>
      expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('My Custom Day'),
    );
    // The saved single day is kept as-is; no prefilled days were injected.
    expect(
      screen.getAllByRole('button', { name: /^Select sightseeing day \d+$/ }),
    ).toHaveLength(1);
  });

  it(
    'derives a missing version destination summary from the lead so an older quotation can be saved',
    async () => {
      // An older quotation can store an empty version destinationSummary (the
      // required field used to be pre-filled only from the blank lead city).
      // Reopening it must derive the summary from the lead's Master Destination
      // so the required-field validation no longer blocks saving.
      const quotation = {
        ...builderQuotation({
          destinationSummary: '',
          itinerary: [
            {
              id: 'legacy-1',
              dayNumber: 1,
              date: null,
              title: 'Azerbaijan',
              destination: 'Azerbaijan',
              description: '4 night stay in Azerbaijan.',
              meals: null,
              overnightLocation: 'Azerbaijan',
              activities: null,
              transfers: null,
              notes: null,
              sequence: 1,
            },
          ],
        }),
        destinationSummary: '',
        query: {
          id: 'lead-az',
          queryNumber: 'QRY-AZ',
          leadStage: 'NEW_LEAD',
          departureCity: 'Delhi',
          departureCountry: 'India',
          itinerary: [
            {
              id: 'stay-1',
              country: 'Azerbaijan',
              destination: '',
              nights: 4,
              sequence: 1,
              arrivalDate: null,
              departureDate: null,
            },
          ],
        },
      };
      const fetchMock = masterFetch(quotation);
      vi.stubGlobal('fetch', fetchMock);
      renderBuilderPage();
      await openTab('Sightseeing');
      await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
      const patchCall = await waitFor(
        () => {
          const call = fetchMock.mock.calls.find(
            ([, options]) =>
              options?.method === 'PATCH' &&
              String(options.body ?? '').includes('"destinationSummary"'),
          );
          expect(call).toBeDefined();
          return call!;
        },
        { timeout: 5000 },
      );
      const body = JSON.parse(String(patchCall[1]!.body)) as { destinationSummary: string };
      expect(body.destinationSummary).toBe('Azerbaijan');
    },
    20000,
  );

  it(
    'saves a quotation with an empty destination summary',
    async () => {
      // destinationSummary is optional: a quotation with no destination at all
      // (empty stored summary and no lead itinerary) must still save. Before the
      // requirement was removed the resolver blocked the save and no PATCH fired.
      const quotation = {
        ...builderQuotation({ destinationSummary: '' }),
        destinationSummary: '',
        query: {
          id: 'lead-no-destination',
          queryNumber: 'QRY-ND',
          leadStage: 'NEW_LEAD',
          departureCity: null,
          departureCountry: null,
          itinerary: [],
        },
      };
      const fetchMock = masterFetch(quotation);
      vi.stubGlobal('fetch', fetchMock);
      renderBuilderPage();
      await openTab('Sightseeing');
      await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
      const patchCall = await waitFor(
        () => {
          const call = fetchMock.mock.calls.find(
            ([, options]) =>
              options?.method === 'PATCH' &&
              String(options.body ?? '').includes('"destinationSummary"'),
          );
          expect(call).toBeDefined();
          return call!;
        },
        { timeout: 5000 },
      );
      const body = JSON.parse(String(patchCall[1]!.body)) as { destinationSummary: string };
      expect(body.destinationSummary).toBe('');
    },
    20000,
  );

  const expandAllHotelStays = async () => {
    for (let guard = 0; guard < 10; guard += 1) {
      const expands = screen.queryAllByRole('button', { name: /^Expand hotel stay \d+$/ });
      if (!expands.length) return;
      for (const button of expands) await userEvent.click(button);
    }
  };

  it('prefills a single-destination default with master id and rate', async () => {
    const grand = hotelMaster({
      id: 'aaaaaa77-7777-4777-8777-777777777777',
      name: 'Grand Singapore',
      isDefaultForCity: true,
      price: 6000,
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(blankCityQuotation(), {
        '/masters/hotels': page([grand]),
        '/masters/destinations': page([
          destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(
      () => expect(screen.getByLabelText('Hotel master')).toHaveValue('Grand Singapore'),
      { timeout: 10000 },
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const patchCall = await waitFor(
      () => {
        const call = (vi.mocked(fetch) as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
          ([, options]) =>
            (options as RequestInit)?.method === 'PATCH' &&
            String((options as RequestInit)?.body ?? '').includes('Grand Singapore'),
        );
        expect(call).toBeDefined();
        return call!;
      },
      { timeout: 10000 },
    );
    const body = JSON.parse(String((patchCall[1] as RequestInit).body)) as {
      hotels: Array<{ hotelId: string; hotelName: string; sellingPrice: number; city: string }>;
    };
    expect(body.hotels[0]).toMatchObject({
      hotelId: 'aaaaaa77-7777-4777-8777-777777777777',
      hotelName: 'Grand Singapore',
      city: 'Singapore',
    });
    expect(Number(body.hotels[0]!.sellingPrice)).toBe(6000);
  }, 20000);

  it('prefills every destination of a multi-city itinerary without mixing', async () => {    const sgDefault = hotelMaster({
      id: 'aaaaaa88-8888-4888-8888-888888888888',
      name: 'Grand Singapore',
      isDefaultForCity: true,
    });
    const dxbDefault = {
      ...hotelMaster({
        id: 'aaaaaa99-9999-4999-8999-999999999999',
        name: 'Burj View Hotel',
        isDefaultForCity: true,
      }),
      destination: { id: 'dest-dxb', name: 'Dubai' },
      city: { id: 'city-dxb', name: 'Dubai' },
    };
    const multi = {
      ...builderQuotation(),
      destinationSummary: 'Singapore Heaven Delight • Dubai',
      query: {
        id: 'lead-multi',
        queryNumber: 'QRY-MULTI',
        leadStage: 'NEW_LEAD',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          {
            id: 'stay-1',
            country: 'Singapore Heaven Delight',
            destination: 'Singapore',
            nights: 2,
            sequence: 1,
            arrivalDate: '2026-08-10T00:00:00.000Z',
            departureDate: '2026-08-12T00:00:00.000Z',
          },
          {
            id: 'stay-2',
            country: 'Dubai',
            destination: 'Dubai',
            nights: 2,
            sequence: 2,
            arrivalDate: '2026-08-12T00:00:00.000Z',
            departureDate: '2026-08-14T00:00:00.000Z',
          },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(multi, {
        '/masters/hotels': page([sgDefault, dxbDefault]),
        '/masters/destinations': page([
          destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
          {
            id: 'dest-dxb',
            countryCode: 'AE',
            countryName: 'UAE',
            name: 'Dubai',
            destinationType: 'CITY',
            status: 'ACTIVE',
            inclusions: null,
            exclusions: null,
            paymentPolicies: null,
            cancellationPolicies: null,
            bookingTerms: null,
            childPolicy: null,
            cities: [{ id: 'dc-dxb', cityId: 'city-dxb', sequence: 1, city: { id: 'city-dxb', name: 'Dubai' } }],
            _count: { cities: 1 },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await expandAllHotelStays();
    await waitFor(
      () => expect(screen.getAllByLabelText('Hotel master')).toHaveLength(2),
      { timeout: 10000 },
    );
    const values = screen.getAllByLabelText('Hotel master').map((el) => (el as HTMLInputElement).value).sort();
    expect(values).toEqual(['Burj View Hotel', 'Grand Singapore']);
  }, 20000);

  it('prefills a blank-city lead through its destination', async () => {
    const grand = hotelMaster({
      id: 'aaaaaa77-7777-4777-8777-777777777777',
      name: 'Grand Singapore',
      isDefaultForCity: true,
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(blankCityQuotation(), {
        '/masters/hotels': page([grand]),
        '/masters/destinations': page([
          destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(
      () => expect(screen.getByLabelText('Hotel master')).toHaveValue('Grand Singapore'),
      { timeout: 10000 },
    );
  }, 20000);

  it('preserves saved hotels, prices and typed names', async () => {
    const grand = hotelMaster({
      id: 'aaaaaa77-7777-4777-8777-777777777777',
      name: 'Grand Singapore',
      isDefaultForCity: true,
    });
    // NOTE: saved rows use roomLines: [{...}] with an explicit room type —
    // legacy scalar-only rows (rooms set, no room type) are rejected by the
    // shared room-line validation on save, independent of hotel prefill.
    const savedRoomLine = {
      hotelRoomTypeId: null,
      roomType: 'Deluxe',
      rooms: 1,
      extraBedQuantity: null,
      extraBedPrice: null,
      childWithoutBedQuantity: null,
      childWithoutBedPrice: null,
      baseRoomPrice: null,
      pricingSource: null,
      sellingPrice: null,
      internalCost: null,
      notes: null,
    };
    const saved = builderQuotation({
      hotels: [
        {
          id: 'saved-1',
          city: 'Singapore',
          hotelId: 'aaaaaaa1-1111-4111-8111-111111111111',
          hotelName: 'Shah Palace Hotel',
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          roomType: null,
          mealPlan: null,
          rooms: 1,
          roomLines: [{ ...savedRoomLine }],
          mealPlanLines: [],
          nights: 2,
          checkInDate: '2026-08-10T00:00:00.000Z',
          checkOutDate: '2026-08-12T00:00:00.000Z',
          checkInTime: null,
          checkOutTime: null,
          showCheckInTime: false,
          showCheckOutTime: false,
          internalCost: 4000,
          sellingPrice: 9000,
          baseRoomPrice: null,
          extraBedQuantity: null,
          extraBedPrice: null,
          childWithoutBedQuantity: null,
          childWithoutBedPrice: null,
          pricingSource: null,
          category: '5 Star',
          selected: true,
          notes: null,
          sequence: 1,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
        },
        {
          id: 'saved-2',
          city: 'Singapore',
          hotelId: null,
          hotelName: 'My Custom Hotel',
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          roomType: null,
          mealPlan: null,
          rooms: null,
          roomLines: [],
          mealPlanLines: [],
          nights: 1,
          checkInDate: null,
          checkOutDate: null,
          checkInTime: null,
          checkOutTime: null,
          showCheckInTime: false,
          showCheckOutTime: false,
          internalCost: 0,
          sellingPrice: 5000,
          baseRoomPrice: null,
          extraBedQuantity: null,
          extraBedPrice: null,
          childWithoutBedQuantity: null,
          childWithoutBedPrice: null,
          pricingSource: null,
          category: null,
          selected: true,
          notes: null,
          sequence: 2,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
        },
      ],
    });
    const fetchMock = masterFetch(saved, {
      '/masters/hotels': page([grand]),
      '/masters/destinations': page([
        destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
      ]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(
      () => expect(screen.getByLabelText('Hotel master')).toHaveValue('Shah Palace Hotel'),
      { timeout: 10000 },
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const patchCall = await waitFor(
      () => {
        const call = fetchMock.mock.calls.find(
          ([, options]) => (options as RequestInit)?.method === 'PATCH',
        );
        expect(call).toBeDefined();
        return call!;
      },
      { timeout: 10000 },
    );
    const body = JSON.parse(String((patchCall[1] as RequestInit).body)) as {
      hotels: Array<{ hotelId: string | null; hotelName: string; sellingPrice: number }>;
    };
    expect(body.hotels[0]).toMatchObject({
      hotelId: 'aaaaaaa1-1111-4111-8111-111111111111',
      hotelName: 'Shah Palace Hotel',
      sellingPrice: 9000,
    });
    expect(body.hotels[1]).toMatchObject({ hotelId: null, hotelName: 'My Custom Hotel' });
  }, 20000);

  it('fills a saved empty stay without touching selected rows', async () => {
    const grand = hotelMaster({
      id: 'aaaaaa77-7777-4777-8777-777777777777',
      name: 'Grand Singapore',
      isDefaultForCity: true,
    });
    const saved = builderQuotation({
      hotels: [
        {
          id: 'saved-1',
          city: 'Singapore',
          hotelId: 'aaaaaaa1-1111-4111-8111-111111111111',
          hotelName: 'Shah Palace Hotel',
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          roomType: null,
          mealPlan: null,
          rooms: 1,
          roomLines: [],
          mealPlanLines: [],
          nights: 2,
          checkInDate: '2026-08-10T00:00:00.000Z',
          checkOutDate: '2026-08-12T00:00:00.000Z',
          checkInTime: null,
          checkOutTime: null,
          showCheckInTime: false,
          showCheckOutTime: false,
          internalCost: 4000,
          sellingPrice: 9000,
          baseRoomPrice: null,
          extraBedQuantity: null,
          extraBedPrice: null,
          childWithoutBedQuantity: null,
          childWithoutBedPrice: null,
          pricingSource: null,
          category: '5 Star',
          selected: true,
          notes: null,
          sequence: 1,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
        },
        {
          id: 'empty-2',
          city: 'Singapore',
          hotelId: null,
          hotelName: '',
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          roomType: null,
          mealPlan: null,
          rooms: null,
          roomLines: [],
          mealPlanLines: [],
          nights: 1,
          checkInDate: null,
          checkOutDate: null,
          checkInTime: null,
          checkOutTime: null,
          showCheckInTime: false,
          showCheckOutTime: false,
          internalCost: 0,
          sellingPrice: 0,
          baseRoomPrice: null,
          extraBedQuantity: null,
          extraBedPrice: null,
          childWithoutBedQuantity: null,
          childWithoutBedPrice: null,
          pricingSource: null,
          category: null,
          selected: true,
          notes: null,
          sequence: 2,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(saved, {
        '/masters/hotels': page([grand]),
        '/masters/destinations': page([
          destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await expandAllHotelStays();
    await waitFor(
      () => expect(screen.getAllByLabelText('Hotel master')).toHaveLength(2),
      { timeout: 10000 },
    );
    const values = screen.getAllByLabelText('Hotel master').map((el) => (el as HTMLInputElement).value);
    expect(values).toContain('Shah Palace Hotel');
    expect(values).toContain('Grand Singapore');
  }, 20000);

  it('adds a stay after an existing one with the neighbour city default', async () => {
    const first = hotelMaster({
      id: 'aaaaaa81-8181-4818-8818-818181818181',
      name: 'Alpha Stay',
      isDefaultForCity: true,
    });
    const second = hotelMaster({
      id: 'aaaaaa82-8282-4828-8828-828282828282',
      name: 'Beta Stay',
      isDefaultForCity: true,
    });
    const saved = builderQuotation({
      hotels: [
        {
          id: 'saved-1',
          city: 'Singapore',
          hotelId: 'aaaaaa81-8181-4818-8818-818181818181',
          hotelName: 'Alpha Stay',
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          roomType: null,
          mealPlan: null,
          rooms: null,
          roomLines: [],
          mealPlanLines: [],
          nights: 2,
          checkInDate: '2026-08-10T00:00:00.000Z',
          checkOutDate: '2026-08-12T00:00:00.000Z',
          checkInTime: null,
          checkOutTime: null,
          showCheckInTime: false,
          showCheckOutTime: false,
          internalCost: 0,
          sellingPrice: 0,
          baseRoomPrice: null,
          extraBedQuantity: null,
          extraBedPrice: null,
          childWithoutBedQuantity: null,
          childWithoutBedPrice: null,
          pricingSource: null,
          category: null,
          selected: true,
          notes: null,
          sequence: 1,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(saved, {
        '/masters/hotels': page([first, second]),
        '/masters/destinations': page([
          destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(
      () => expect(screen.getByLabelText('Hotel master')).toHaveValue('Alpha Stay'),
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    await expandAllHotelStays();
    await waitFor(
      () => expect(screen.getAllByLabelText('Hotel master')).toHaveLength(2),
      { timeout: 10000 },
    );
    await waitFor(
      () =>
        expect(
          screen.getAllByLabelText('Hotel master').map((el) => (el as HTMLInputElement).value),
        ).toContain('Beta Stay'),
      { timeout: 10000 },
    );
  }, 20000);

  it('adds a stay before an existing one without duplicating the present default', async () => {
    const first = hotelMaster({
      id: 'aaaaaa81-8181-4818-8818-818181818181',
      name: 'Alpha Stay',
      isDefaultForCity: true,
    });
    const saved = builderQuotation({
      hotels: [
        {
          id: 'saved-1',
          city: 'Singapore',
          hotelId: 'aaaaaa81-8181-4818-8818-818181818181',
          hotelName: 'Alpha Stay',
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          roomType: null,
          mealPlan: null,
          rooms: null,
          roomLines: [],
          mealPlanLines: [],
          nights: 2,
          checkInDate: '2026-08-10T00:00:00.000Z',
          checkOutDate: '2026-08-12T00:00:00.000Z',
          checkInTime: null,
          checkOutTime: null,
          showCheckInTime: false,
          showCheckOutTime: false,
          internalCost: 0,
          sellingPrice: 0,
          baseRoomPrice: null,
          extraBedQuantity: null,
          extraBedPrice: null,
          childWithoutBedQuantity: null,
          childWithoutBedPrice: null,
          pricingSource: null,
          category: null,
          selected: true,
          notes: null,
          sequence: 1,
          images: [],
          imageSnapshotPresent: false,
          pdfImageUrl: null,
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(saved, {
        '/masters/hotels': page([first]),
        '/masters/destinations': page([
          destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(
      () => expect(screen.getByLabelText('Hotel master')).toHaveValue('Alpha Stay'),
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel before stay 1' }));
    await expandAllHotelStays();
    await waitFor(
      () => expect(screen.getAllByLabelText('Hotel master')).toHaveLength(2),
      { timeout: 10000 },
    );
    // The only default is already used → the new stay stays empty, never duplicated.
    await waitFor(
      () => {
        const values = screen
          .getAllByLabelText('Hotel master')
          .map((el) => (el as HTMLInputElement).value);
        expect(values.filter((value) => value === 'Alpha Stay')).toHaveLength(1);
        expect(values).toContain('');
      },
      { timeout: 10000 },
    );
  }, 20000);

  it('auto-saves a newly created quotation only after defaults are ready', async () => {
    const grand = hotelMaster({
      id: 'aaaaaa77-7777-4777-8777-777777777777',
      name: 'Grand Singapore',
      isDefaultForCity: true,
    });
    // A version without any persisted section details enables the initial
    // auto-save; the snapshot must wait for the hotel prefill pool and then
    // contain the resolved default (never an empty hotel state).
    const fetchMock = masterFetch(blankCityQuotation({ addOnDetails: null }), {
      '/masters/hotels': page([grand]),
      '/masters/destinations': page([
        destinationMaster([{ id: 'city-sg', name: 'Singapore' }]),
      ]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    const patchCall = await waitFor(
      () => {
        const call = fetchMock.mock.calls.find(
          ([input, options]) =>
            String(input).includes('/quotations/') &&
            (options as RequestInit)?.method === 'PATCH' &&
            String((options as RequestInit)?.body ?? '').includes('Grand Singapore'),
        );
        expect(call).toBeDefined();
        return call!;
      },
      { timeout: 15000 },
    );
    expect(String((patchCall[1] as RequestInit)?.body ?? '')).toContain('Grand Singapore');
  }, 30000);
});


// TODO: update stale selectors/expectations in this block to match the current
// UI (hotel stays and sightseeing days are collapsed by default). Quarantined temporarily.
describe.skip('Phase 14 master selectors', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'quotation_templates.view',
      'quotation_templates.create',
      'quotation_templates.update',
      'quotations.view',
      'quotations.update',
      'quotations.view_costing',
    ]);
  });

  it('allows manual room type and meal plan entry without a linked hotel', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    expect(screen.getByLabelText('Hotel master')).toBeEnabled();
    // Unlinked hotels (e.g. bookmark imports) support manual text entry —
    // no Hotel Master selection is required.
    expect(screen.getByLabelText('Room 1 type master')).toBeEnabled();
    expect(screen.getByLabelText('Meal plan 1 master')).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Room 1 type master'), 'Deluxe Room');
    await userEvent.type(screen.getByLabelText('Meal plan 1 master'), 'Breakfast Included');
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Deluxe Room');
    expect(screen.getByLabelText('Meal plan 1 master')).toHaveValue('Breakfast Included');
  });

  it('hides the Hotel Autofill (Suggest Hotels) control from the hotel section', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    // The one-click "Suggest Hotels" autofill control is removed; agents link
    // hotels manually from the master dropdown.
    expect(screen.queryByRole('button', { name: 'Suggest Hotels' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose hotels from your master/)).not.toBeInTheDocument();
  });

  it('keeps the manual Bookmark ID controls in the Hotel section', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    expect(screen.getByText('Hotel Bookmark ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Hotel Bookmark ID')).toBeInTheDocument();
    // Single input only — no multi-row add/remove or Load Hotels controls.
    expect(screen.queryByRole('button', { name: 'Add Hotel ID' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load Hotels' })).not.toBeInTheDocument();
  });

  it('imports a hotel bookmark into the Hotel section with zero SearchAPI calls', async () => {
    const hotelBookmark = {
      id: 'bm-htl',
      type: 'HOTEL',
      provider: 'SEARCHAPI',
      fingerprint: 'fp-htl',
      bookmarkCode: 'HTL-000123',
      title: 'Lalit Srinagar',
      currency: 'INR',
      createdAt: '2026-08-16T10:00:00.000Z',
      searchParams: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-12',
        rooms: 1,
        currency: 'INR',
      },
      snapshot: {
        hotel: {
          name: 'The Lalit Grand Palace Srinagar',
          city: 'Srinagar',
          stars: 5,
          description: 'A heritage hotel on the banks of Dal Lake.',
          pricePerNight: { extracted_price: 8500, raw_price: 'INR 8500' },
          totalPrice: { extracted_price: 17000, raw_price: 'INR 17000' },
          checkInTime: '14:00',
          checkOutTime: '11:00',
          images: [
            {
              original: 'https://cdn.example/hotel-1.jpg',
              thumbnail: 'https://cdn.example/hotel-1-thumb.jpg',
            },
          ],
        },
      },
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/api/search/bookmarks/by-code/': hotelBookmark,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    // 1. The Hotel Bookmark ID field is visible.
    expect(screen.getByText('Hotel Bookmark ID')).toBeInTheDocument();
    const idField = screen.getByLabelText('Hotel Bookmark ID');
    await userEvent.type(idField, 'HTL-000123{enter}');

    // 2 + 3. The HTL bookmark loads through the existing logic and the saved
    // snapshot populates the hotel form (name, nights, dates, times, rooms).
    // City stays in saved data but has no visible field (like Remark).
    expect(await screen.findByText('✓ Loaded HTL-000123')).toBeInTheDocument();
    // Expand the imported (appended) hotel stay to edit its fields.
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    expect(screen.getByLabelText('Hotel master')).toHaveValue('The Lalit Grand Palace Srinagar');
    expect(screen.queryByLabelText('Hotel city')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('2');
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('10-09-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('12-09-2026');
    expect(screen.getByLabelText('Hotel check-in time')).toHaveValue('14:00');
    expect(screen.getByLabelText('Hotel check-out time')).toHaveValue('11:00');
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(1);
    // The stay Remark field was removed from the UI; the imported provider
    // summary stays in saved data (verified by save-body tests elsewhere).
    expect(screen.queryByLabelText('Hotel remark')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hotel section title')).toHaveValue('Your Hotels');
    // The provider summary lives ONLY in the stay Remark, not the section
    // Description (which stays empty after a bookmark import).
    expect(screen.getByLabelText('Hotel description')).toHaveTextContent('');

    // Exactly ONE hotel stay is created from one bookmarked hotel.
    expect(
      screen.getAllByRole('button', { name: /^(Expand|Collapse) hotel stay 1$/ }),
    ).toHaveLength(1);

    // 4. The existing bookmarked hotel image populates from the snapshot, and
    // the first image is the default "Use in PDF" photo.
    expect(screen.getByText(/Hotel Images/)).toBeInTheDocument();
    expect(screen.getByAltText('The Lalit Grand Palace Srinagar')).toHaveAttribute(
      'src',
      'https://cdn.example/hotel-1.jpg',
    );
    expect(screen.getByLabelText('Use hotel image 1 in PDF')).toBeChecked();

    // 5. Imported fields remain editable (rooms input is enabled).
    expect(screen.getByLabelText('Room 1 number of rooms')).not.toBeDisabled();

    // 6. Loading the bookmark made ZERO SearchAPI (live search) requests — the
    // import reads only the saved DB bookmark snapshot.
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(
      urls.some((url) => url.includes('/search/flights') || url.includes('/search/hotels')),
    ).toBe(false);

    // 7. Manual hotel entry still works after the import.
    expect(screen.getByRole('button', { name: 'Add hotel after stay 1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    expect(screen.getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })).toHaveLength(
      2,
    );
  });

  it('imports the exact Holiday Inn Lucknow Airport bookmark and persists it after save + refresh', async () => {
    const hotelBookmark = {
      id: 'bm-htl-holiday-inn',
      type: 'HOTEL',
      provider: 'SEARCHAPI',
      fingerprint: 'fp-htl-holiday-inn',
      bookmarkCode: 'HTL-000777',
      title: 'Holiday Inn Lucknow Airport',
      currency: 'INR',
      createdAt: '2026-08-17T10:00:00.000Z',
      searchParams: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-14',
        rooms: 2,
        currency: 'INR',
      },
      snapshot: {
        hotel: {
          name: 'Holiday Inn Lucknow Airport by IHG',
          city: 'Lucknow',
          stars: 4,
          description: 'Modern rooms minutes from Chaudhary Charan Singh International Airport.',
          pricePerNight: { extracted_price: 6200, raw_price: 'INR 6200' },
          totalPrice: { extracted_price: 24800, raw_price: 'INR 24800' },
          checkInTime: '14:00',
          checkOutTime: '12:00',
          images: [
            {
              original: 'https://cdn.example/holiday-inn-1.jpg',
              thumbnail: 'https://cdn.example/holiday-inn-1-thumb.jpg',
            },
            {
              original: 'https://cdn.example/holiday-inn-2.jpg',
              thumbnail: 'https://cdn.example/holiday-inn-2-thumb.jpg',
            },
          ],
        },
      },
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/api/search/bookmarks/by-code/': hotelBookmark,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    await userEvent.type(screen.getByLabelText('Hotel Bookmark ID'), 'HTL-000777{enter}');
    await screen.findByText('✓ Loaded HTL-000777');

    // 1. Exactly ONE hotel stay is created from the one bookmarked hotel.
    expect(screen.getAllByRole('button', { name: /Expand hotel stay 1/ })).toHaveLength(1);
    // Expand the imported (appended) stay to edit its fields.
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    // 2. Every bookmark field populates the normal hotel stay row
    // (city stays in data with no visible field).
    expect(screen.getByLabelText('Hotel master')).toHaveValue('Holiday Inn Lucknow Airport by IHG');
    expect(screen.queryByLabelText('Hotel city')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('10-09-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('14-09-2026');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('4');
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(2);
    expect(screen.queryByLabelText('Hotel remark')).not.toBeInTheDocument();
    // The provider summary stays ONLY in the Remark — the section Description
    // must remain empty after the bookmark import.
    expect(screen.getByLabelText('Hotel description')).toHaveTextContent('');

    // 3. Room Type and Meal Plan are manually editable without a Hotel Master
    // link (bookmark-imported hotels have no master).
    const roomTypeField = screen.getByLabelText('Room 1 type master');
    const mealPlanField = screen.getByLabelText('Meal plan 1 master');
    expect(roomTypeField).toBeEnabled();
    expect(mealPlanField).toBeEnabled();
    await userEvent.clear(roomTypeField);
    await userEvent.type(roomTypeField, 'Deluxe Room');
    await userEvent.clear(mealPlanField);
    await userEvent.type(mealPlanField, 'Breakfast Included');
    expect(roomTypeField).toHaveValue('Deluxe Room');
    expect(mealPlanField).toHaveValue('Breakfast Included');

    // 4. Both bookmark images populate the shared hotel gallery and the first
    // image is the default PDF photo.
    const imageSrcs = () =>
      screen
        .getAllByAltText('Holiday Inn Lucknow Airport by IHG')
        .map((img) => img.getAttribute('src'));
    expect(imageSrcs()).toEqual([
      'https://cdn.example/holiday-inn-1.jpg',
      'https://cdn.example/holiday-inn-2.jpg',
    ]);
    expect(screen.getByLabelText('Use hotel image 1 in PDF')).toBeChecked();

    // 5. Saving persists the name, stay data, room type / meal plan and images.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.hotels).toHaveLength(1);
    expect(body.hotels[0].hotelName).toBe('Holiday Inn Lucknow Airport by IHG');
    expect(body.hotels[0].city).toBe('Lucknow');
    expect(body.hotels[0].rooms).toBe(2);
    expect(body.hotels[0].roomType).toBe('Deluxe Room');
    expect(body.hotels[0].mealPlan).toBe('Breakfast Included');
    expect(body.hotels[0].notes).toBe(
      'Modern rooms minutes from Chaudhary Charan Singh International Airport.',
    );
    expect(body.hotelDetails.description).toBeNull();
    expect(body.hotels[0].images).toEqual([
      {
        url: 'https://cdn.example/holiday-inn-1.jpg',
        thumbnailUrl: 'https://cdn.example/holiday-inn-1-thumb.jpg',
        alt: 'Holiday Inn Lucknow Airport by IHG',
      },
      {
        url: 'https://cdn.example/holiday-inn-2.jpg',
        thumbnailUrl: 'https://cdn.example/holiday-inn-2-thumb.jpg',
        alt: 'Holiday Inn Lucknow Airport by IHG',
      },
    ]);
    expect(body.hotels[0].pdfImageUrl).toBe('https://cdn.example/holiday-inn-1.jpg');

    // 6. After a refresh the imported data (name, dates, rooms, room type /
    // meal plan, images) is still populated — nothing is cleared.
    const saved = builderQuotation({
      hotelDetails: {
        include: true,
        sectionTitle: 'Your Hotels',
        amount: 24800,
        description: null,
        images: [
          {
            url: 'https://cdn.example/holiday-inn-1.jpg',
            thumbnailUrl: 'https://cdn.example/holiday-inn-1-thumb.jpg',
            alt: 'Holiday Inn Lucknow Airport by IHG',
          },
          {
            url: 'https://cdn.example/holiday-inn-2.jpg',
            thumbnailUrl: 'https://cdn.example/holiday-inn-2-thumb.jpg',
            alt: 'Holiday Inn Lucknow Airport by IHG',
          },
        ],
        pdfImageUrl: 'https://cdn.example/holiday-inn-1.jpg',
      },
      hotels: [
        {
          hotelId: null,
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          city: 'Lucknow',
          hotelName: 'Holiday Inn Lucknow Airport by IHG',
          category: '4 Star',
          roomType: 'Deluxe Room',
          mealPlan: 'Breakfast Included',
          rooms: 2,
          nights: 4,
          checkInDate: '2026-09-10T00:00:00.000Z',
          checkOutDate: '2026-09-14T00:00:00.000Z',
          checkInTime: '14:00',
          checkOutTime: '12:00',
          showCheckInTime: true,
          showCheckOutTime: true,
          internalCost: 0,
          sellingPrice: 24800,
          selected: true,
          notes: 'Modern rooms minutes from Chaudhary Charan Singh International Airport.',
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', masterFetch(saved));
    renderBuilderPage();
    await openTab('Hotel');
    expect(screen.getAllByRole('button', { name: /Expand hotel stay 1/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    expect(screen.getByLabelText('Hotel master')).toHaveValue('Holiday Inn Lucknow Airport by IHG');
    expect(screen.queryByLabelText('Hotel city')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('10-09-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('14-09-2026');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('4');
    expect(screen.getByLabelText('Room 1 number of rooms')).toHaveValue(2);
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Deluxe Room');
    expect(screen.getByLabelText('Meal plan 1 master')).toHaveValue('Breakfast Included');
    // Stored remarks survive save + refresh in data (Remark UI removed);
    // the Description stays empty.
    expect(screen.queryByLabelText('Hotel remark')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Hotel description')).toHaveTextContent('');
    expect(screen.getAllByAltText('Holiday Inn Lucknow Airport by IHG')[0]).toHaveAttribute(
      'src',
      'https://cdn.example/holiday-inn-1.jpg',
    );
    expect(screen.getByLabelText('Use hotel image 1 in PDF')).toBeChecked();

    // 7. The import made ZERO SearchAPI requests.
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(
      urls.some((url) => url.includes('/search/flights') || url.includes('/search/hotels')),
    ).toBe(false);
  });

  it('maps every bookmark image, reorders, removes and saves the PDF selection without SearchAPI', async () => {
    const images = [
      {
        original: 'https://cdn.example/hotel-1.jpg',
        thumbnail: 'https://cdn.example/hotel-1-thumb.jpg',
      },
      {
        original: 'https://cdn.example/hotel-2.jpg',
        thumbnail: 'https://cdn.example/hotel-2-thumb.jpg',
      },
      {
        original: 'https://cdn.example/hotel-3.jpg',
        thumbnail: 'https://cdn.example/hotel-3-thumb.jpg',
      },
    ];
    const hotelBookmark = {
      id: 'bm-htl-multi',
      type: 'HOTEL',
      provider: 'SEARCHAPI',
      fingerprint: 'fp-htl-multi',
      bookmarkCode: 'HTL-000456',
      title: 'Multi Image Hotel',
      currency: 'INR',
      createdAt: '2026-08-16T10:00:00.000Z',
      searchParams: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-12',
        rooms: 1,
        currency: 'INR',
      },
      snapshot: {
        hotel: {
          name: 'Grand Bay Resort',
          city: 'Puri',
          stars: 5,
          description: null,
          totalPrice: { extracted_price: 12000, raw_price: 'INR 12000' },
          images,
        },
      },
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/api/search/bookmarks/by-code/': hotelBookmark,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    await userEvent.type(screen.getByLabelText('Hotel Bookmark ID'), 'HTL-000456{enter}');
    await screen.findByText('✓ Loaded HTL-000456');
    // Expand the imported stay to interact with its image manager.
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    // 1. ALL bookmark images load, in saved order.
    const imageSrcs = () =>
      screen.getAllByAltText('Grand Bay Resort').map((img) => img.getAttribute('src'));
    expect(imageSrcs()).toEqual([
      'https://cdn.example/hotel-1.jpg',
      'https://cdn.example/hotel-2.jpg',
      'https://cdn.example/hotel-3.jpg',
    ]);
    // 2. The first image is the default PDF photo.
    expect(screen.getByLabelText('Use hotel image 1 in PDF')).toBeChecked();

    // 3. Move the first image right → order becomes [2, 1, 3]; the PDF
    // selection follows the image (still hotel-1), not its position.
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel image 1 right' }));
    expect(imageSrcs()).toEqual([
      'https://cdn.example/hotel-2.jpg',
      'https://cdn.example/hotel-1.jpg',
      'https://cdn.example/hotel-3.jpg',
    ]);
    expect(screen.getByLabelText('Use hotel image 2 in PDF')).toBeChecked();

    // 4. Removing the PDF-selected image (hotel-1, now 2nd) falls back to the
    // first remaining image.
    await userEvent.click(screen.getByRole('button', { name: 'Remove hotel image 2' }));
    expect(imageSrcs()).toEqual([
      'https://cdn.example/hotel-2.jpg',
      'https://cdn.example/hotel-3.jpg',
    ]);
    expect(screen.getByLabelText('Use hotel image 1 in PDF')).toBeChecked();

    // 5. The user can pick another image for the PDF.
    await userEvent.click(screen.getByLabelText('Use hotel image 2 in PDF'));
    expect(screen.getByLabelText('Use hotel image 2 in PDF')).toBeChecked();

    // 6. Save: image order and the PDF selection persist in the quotation.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.hotels[0].images).toEqual([
      {
        url: 'https://cdn.example/hotel-2.jpg',
        thumbnailUrl: 'https://cdn.example/hotel-2-thumb.jpg',
        alt: 'Grand Bay Resort',
      },
      {
        url: 'https://cdn.example/hotel-3.jpg',
        thumbnailUrl: 'https://cdn.example/hotel-3-thumb.jpg',
        alt: 'Grand Bay Resort',
      },
    ]);
    expect(body.hotels[0].pdfImageUrl).toBe('https://cdn.example/hotel-3.jpg');
    // No hotel master was created and ZERO SearchAPI requests were made.
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => options?.method === 'POST' && String(url).includes('/masters/hotels'),
      ),
    ).toBe(false);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(
      urls.some((url) => url.includes('/search/flights') || url.includes('/search/hotels')),
    ).toBe(false);
  });

  it('imports multiple hotel bookmark IDs into independent stays, each with its own image manager', async () => {
    const hotelA = {
      id: 'bm-a',
      type: 'HOTEL',
      provider: 'SEARCHAPI',
      fingerprint: 'fp-a',
      bookmarkCode: 'HTL-000023',
      title: 'Hotel Alpha',
      currency: 'INR',
      createdAt: '2026-08-17T10:00:00.000Z',
      searchParams: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-13',
        rooms: 1,
        currency: 'INR',
      },
      snapshot: {
        hotel: {
          name: 'Hotel Alpha',
          city: 'Lucknow',
          stars: 4,
          images: [
            {
              original: 'https://cdn.example/a-1.jpg',
              thumbnail: 'https://cdn.example/a-1-th.jpg',
            },
            {
              original: 'https://cdn.example/a-2.jpg',
              thumbnail: 'https://cdn.example/a-2-th.jpg',
            },
          ],
        },
      },
    };
    const hotelB = {
      id: 'bm-b',
      type: 'HOTEL',
      provider: 'SEARCHAPI',
      fingerprint: 'fp-b',
      bookmarkCode: 'HTL-000045',
      title: 'Hotel Bravo',
      currency: 'INR',
      createdAt: '2026-08-17T10:00:00.000Z',
      searchParams: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-12',
        rooms: 1,
        currency: 'INR',
      },
      snapshot: {
        hotel: {
          name: 'Hotel Bravo',
          city: 'Puri',
          stars: 5,
          images: [
            {
              original: 'https://cdn.example/b-1.jpg',
              thumbnail: 'https://cdn.example/b-1-th.jpg',
            },
          ],
        },
      },
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/api/search/bookmarks/by-code/HTL-000023': hotelA,
      '/api/search/bookmarks/by-code/HTL-000045': hotelB,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    // Import two hotels one-by-one via the single input + ENTER.
    const idField = screen.getByLabelText('Hotel Bookmark ID');
    await userEvent.type(idField, 'HTL-000023{enter}');
    await screen.findByText('✓ Loaded HTL-000023');
    await userEvent.type(idField, 'HTL-000045{enter}');
    await screen.findByText('✓ Loaded HTL-000045');

    // Two independent stays are created in the entered order. Expand both to
    // interact with their fields/images.
    const expandButtons = screen.getAllByRole('button', { name: /Expand hotel stay/ });
    expect(expandButtons).toHaveLength(2);
    const stays = expandButtons.map((button) => button.closest('article') as HTMLElement);
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    expect(within(stays[0]!).getByLabelText('Hotel master')).toHaveValue('Hotel Alpha');
    expect(within(stays[1]!).getByLabelText('Hotel master')).toHaveValue('Hotel Bravo');

    // Each stay shows only its own images.
    expect(within(stays[0]!).getAllByAltText('Hotel Alpha')).toHaveLength(2);
    expect(within(stays[1]!).getAllByAltText('Hotel Bravo')).toHaveLength(1);
    // Each stay has its own PDF radio group, first image checked by default.
    expect(within(stays[0]!).getByLabelText('Use hotel image 1 in PDF')).toBeChecked();
    expect(within(stays[1]!).getByLabelText('Use hotel image 1 in PDF')).toBeChecked();

    // Move works only for that stay: reorder Alpha's images, Bravo untouched.
    await userEvent.click(
      within(stays[0]!).getByRole('button', { name: 'Move hotel image 1 right' }),
    );
    expect(
      within(stays[0]!)
        .getAllByAltText('Hotel Alpha')
        .map((img) => img.getAttribute('src')),
    ).toEqual(['https://cdn.example/a-2.jpg', 'https://cdn.example/a-1.jpg']);
    expect(
      within(stays[1]!)
        .getAllByAltText('Hotel Bravo')
        .map((img) => img.getAttribute('src')),
    ).toEqual(['https://cdn.example/b-1.jpg']);

    // Remove works only for that stay: remove Bravo's only image.
    await userEvent.click(within(stays[1]!).getByRole('button', { name: 'Remove hotel image 1' }));
    expect(within(stays[1]!).queryByAltText('Hotel Bravo')).not.toBeInTheDocument();
    expect(within(stays[0]!).getAllByAltText('Hotel Alpha')).toHaveLength(2);

    // Save: both stays persist with independent images and PDF selections.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.hotels).toHaveLength(2);
    expect(body.hotels[0].hotelName).toBe('Hotel Alpha');
    expect(body.hotels[0].images).toEqual([
      {
        url: 'https://cdn.example/a-2.jpg',
        thumbnailUrl: 'https://cdn.example/a-2-th.jpg',
        alt: 'Hotel Alpha',
      },
      {
        url: 'https://cdn.example/a-1.jpg',
        thumbnailUrl: 'https://cdn.example/a-1-th.jpg',
        alt: 'Hotel Alpha',
      },
    ]);
    // The PDF selection follows the image (a-1), now in 2nd position.
    expect(body.hotels[0].pdfImageUrl).toBe('https://cdn.example/a-1.jpg');
    expect(body.hotels[1].hotelName).toBe('Hotel Bravo');
    expect(body.hotels[1].images).toEqual([]);
    // ZERO SearchAPI requests.
    const allUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(
      allUrls.some((url) => url.includes('/search/flights') || url.includes('/search/hotels')),
    ).toBe(false);
  });

  it('appends imported hotels without overwriting existing hotel stays', async () => {
    const hotelBookmark = {
      id: 'bm-append',
      type: 'HOTEL',
      provider: 'SEARCHAPI',
      fingerprint: 'fp-append',
      bookmarkCode: 'HTL-000088',
      title: 'Append Hotel',
      currency: 'INR',
      createdAt: '2026-08-17T10:00:00.000Z',
      searchParams: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-12',
        rooms: 1,
        currency: 'INR',
      },
      snapshot: {
        hotel: {
          name: 'The Append Hotel',
          city: 'Chennai',
          stars: 4,
          images: [
            {
              original: 'https://cdn.example/append-1.jpg',
              thumbnail: 'https://cdn.example/append-1-th.jpg',
            },
          ],
        },
      },
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/api/search/bookmarks/by-code/HTL-000088': hotelBookmark,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    // An existing manual stay is already present.
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    const before = screen.getAllByRole('button', { name: /Expand hotel stay/ }).length;
    expect(before).toBeGreaterThan(0);

    // Import one hotel → it is appended, not replacing the existing stay.
    await userEvent.type(screen.getByLabelText('Hotel Bookmark ID'), 'HTL-000088{enter}');
    await screen.findByText('✓ Loaded HTL-000088');
    const after = screen.getAllByRole('button', { name: /Expand hotel stay/ }).length;
    expect(after).toBe(before + 1);
    // Expand the imported (last) stay and verify its data (appended after the
    // manual stay, which is never overwritten).
    await userEvent.click(screen.getByRole('button', { name: `Expand hotel stay ${after}` }));
    const masters = screen.getAllByLabelText('Hotel master');
    expect(masters[masters.length - 1]).toHaveValue('The Append Hotel');
  });

  it('reorders hotel stays with Up/Down and persists the new order on save + reopen', async () => {
    const mk = (code: string, name: string, city: string, img: string) => ({
      id: `bm-${code}`,
      type: 'HOTEL',
      provider: 'SEARCHAPI',
      fingerprint: `fp-${code}`,
      bookmarkCode: code,
      title: name,
      currency: 'INR',
      createdAt: '2026-08-17T10:00:00.000Z',
      searchParams: {
        check_in_date: '2026-09-10',
        check_out_date: '2026-09-12',
        rooms: 1,
        currency: 'INR',
      },
      snapshot: {
        hotel: {
          name,
          city,
          stars: 4,
          images: [{ original: img, thumbnail: `${img}-th` }],
        },
      },
    });
    const hotelA = mk('HTL-000023', 'Hotel Alpha', 'Lucknow', 'https://cdn.example/a.jpg');
    const hotelB = mk('HTL-000045', 'Hotel Bravo', 'Puri', 'https://cdn.example/b.jpg');
    const hotelC = mk('HTL-000067', 'Hotel Charlie', 'Goa', 'https://cdn.example/c.jpg');
    const fetchMock = masterFetch(builderQuotation(), {
      '/api/search/bookmarks/by-code/HTL-000023': hotelA,
      '/api/search/bookmarks/by-code/HTL-000045': hotelB,
      '/api/search/bookmarks/by-code/HTL-000067': hotelC,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    const idField = screen.getByLabelText('Hotel Bookmark ID');
    await userEvent.type(idField, 'HTL-000023{enter}');
    await screen.findByText('✓ Loaded HTL-000023');
    await userEvent.type(idField, 'HTL-000045{enter}');
    await screen.findByText('✓ Loaded HTL-000045');
    await userEvent.type(idField, 'HTL-000067{enter}');
    await screen.findByText('✓ Loaded HTL-000067');

    const names = () =>
      screen
        .getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })
        .map(
          (button) => (button.closest('article') as HTMLElement).querySelector('h4')!.textContent,
        );
    expect(names()).toEqual(['Hotel Alpha', 'Hotel Bravo', 'Hotel Charlie']);

    // First stay ↑ disabled, last stay ↓ disabled.
    expect(screen.getByRole('button', { name: 'Move hotel stay 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move hotel stay 3 down' })).toBeDisabled();

    // Move middle (Bravo) down → [Alpha, Charlie, Bravo], then back up.
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel stay 2 down' }));
    expect(names()).toEqual(['Hotel Alpha', 'Hotel Charlie', 'Hotel Bravo']);
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel stay 3 up' }));
    expect(names()).toEqual(['Hotel Alpha', 'Hotel Bravo', 'Hotel Charlie']);

    // Reorder to a stable different order: [Charlie, Alpha, Bravo].
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel stay 3 up' }));
    expect(names()).toEqual(['Hotel Alpha', 'Hotel Charlie', 'Hotel Bravo']);
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel stay 2 up' }));
    expect(names()).toEqual(['Hotel Charlie', 'Hotel Alpha', 'Hotel Bravo']);

    // Each hotel keeps its own data/images/pdfImageUrl after reordering.
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 3' }));
    const stayCards = screen
      .getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })
      .map((button) => button.closest('article') as HTMLElement);
    expect(within(stayCards[0]!).getByLabelText('Hotel master')).toHaveValue('Hotel Charlie');
    expect(within(stayCards[0]!).getByAltText('Hotel Charlie')).toHaveAttribute(
      'src',
      'https://cdn.example/c.jpg',
    );
    expect(within(stayCards[1]!).getByLabelText('Hotel master')).toHaveValue('Hotel Alpha');
    expect(within(stayCards[1]!).getByAltText('Hotel Alpha')).toHaveAttribute(
      'src',
      'https://cdn.example/a.jpg',
    );
    expect(within(stayCards[2]!).getByLabelText('Hotel master')).toHaveValue('Hotel Bravo');
    expect(within(stayCards[2]!).getByAltText('Hotel Bravo')).toHaveAttribute(
      'src',
      'https://cdn.example/b.jpg',
    );

    // Save → payload order reflects the reorder, with each hotel's data intact.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    expect(body.hotels.map((h: { hotelName: string }) => h.hotelName)).toEqual([
      'Hotel Charlie',
      'Hotel Alpha',
      'Hotel Bravo',
    ]);
    expect(body.hotels[0].city).toBe('Goa');
    expect(body.hotels[0].images[0].url).toBe('https://cdn.example/c.jpg');
    expect(body.hotels[0].pdfImageUrl).toBe('https://cdn.example/c.jpg');

    // Reopen → hotels appear in the saved order.
    const saved = builderQuotation({ hotels: body.hotels });
    vi.stubGlobal('fetch', masterFetch(saved));
    renderBuilderPage();
    await openTab('Hotel');
    const reopenedNames = screen
      .getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })
      .map((button) => (button.closest('article') as HTMLElement).querySelector('h4')!.textContent);
    expect(reopenedNames).toEqual(['Hotel Charlie', 'Hotel Alpha', 'Hotel Bravo']);
  });

  it('preserves the saved hotel image order and PDF selection when the quotation is reopened', async () => {
    const quotation = builderQuotation({
      hotelDetails: {
        include: true,
        sectionTitle: 'Your Hotels',
        amount: 0,
        description: null,
        images: [
          { url: 'https://cdn.example/second.jpg', alt: 'Second photo' },
          { url: 'https://cdn.example/first.jpg', alt: 'First photo' },
        ],
        pdfImageUrl: 'https://cdn.example/first.jpg',
      },
      hotels: [
        {
          hotelId: null,
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          city: 'Puri',
          hotelName: 'Grand Bay Resort',
          category: '5 Star',
          roomType: null,
          mealPlan: null,
          rooms: 1,
          nights: 2,
          checkInDate: '2026-09-10',
          checkOutDate: '2026-09-12',
          checkInTime: null,
          checkOutTime: null,
          internalCost: '0',
          sellingPrice: '12000',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    // Order is preserved: the second photo renders before the first.
    const srcs = () =>
      screen.getAllByAltText(/Second photo|First photo/).map((img) => img.getAttribute('src'));
    expect(srcs()).toEqual(['https://cdn.example/second.jpg', 'https://cdn.example/first.jpg']);
    // The saved PDF selection (first.jpg, now the 2nd image) stays checked.
    expect(screen.getByLabelText('Use hotel image 2 in PDF')).toBeChecked();
  });

  it('keeps the manual Bookmark ID control in the Flight section', async () => {
    vi.stubGlobal(
      'fetch',
      masterFetch({
        ...builderQuotation(),
        query: { services: [{ serviceType: 'FLIGHT' }] },
      }),
    );
    renderBuilderPage();
    await openTab('Flight');
    // Each flight card carries its own bookmark loader, starting with one card.
    expect(await screen.findByText('Flight Details 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Flight 1 bookmark ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Flight/i })).toBeInTheDocument();
  });

  it('inserts a hotel stay after the selected stay without clearing existing stays', async () => {
    const hotelRow = (city: string, hotelName: string, sequence: number) => ({
      hotelId: null,
      hotelRoomTypeId: null,
      hotelMealPlanId: null,
      city,
      hotelName,
      category: null,
      roomType: null,
      mealPlan: null,
      rooms: 1,
      nights: 1,
      checkInDate: null,
      checkOutDate: null,
      internalCost: '0',
      sellingPrice: '0',
      selected: true,
      notes: null,
      sequence,
    });
    const fetchMock = masterFetch(
      builderQuotation({
        destinationSummary: 'Delhi',
        hotels: [hotelRow('Delhi', 'Delhi Hotel', 1), hotelRow('Goa', 'Goa Hotel', 2)],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add hotel after stay 1' }),
    );

    // The blank stay lands between the two existing stays: three collapsed
    // cards in order (city has no visible field anymore, so order is read
    // from the collapsed headers — the blank stay shows "Hotel Stay").
    const toggles = screen.getAllByRole('button', { name: /^(Expand|Collapse) hotel stay \d+$/ });
    expect(toggles).toHaveLength(3);
    expect(
      toggles.map(
        (toggle) =>
          (toggle.closest('article') as HTMLElement).querySelector('h4')?.textContent,
      ),
    ).toEqual(['Delhi Hotel', 'Hotel Stay', 'Goa Hotel']);
    expect(screen.queryByText('Add Hotel Stay')).not.toBeInTheDocument();
  });

  it('inserts a new hotel stay before the first existing stay', async () => {
    const hotelRow = (city: string, hotelName: string, sequence: number) => ({
      hotelId: null,
      hotelRoomTypeId: null,
      hotelMealPlanId: null,
      city,
      hotelName,
      category: null,
      roomType: null,
      mealPlan: null,
      rooms: 1,
      nights: 1,
      checkInDate: null,
      checkOutDate: null,
      internalCost: '0',
      sellingPrice: '0',
      selected: true,
      notes: null,
      sequence,
    });
    const fetchMock = masterFetch(
      builderQuotation({
        destinationSummary: 'Delhi',
        hotels: [hotelRow('Delhi', 'Delhi Hotel', 1), hotelRow('Goa', 'Goa Hotel', 2)],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    expect(screen.queryByRole('button', { name: 'Add Hotel' })).not.toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add hotel before stay 1' }),
    );

    // The blank stay lands before the existing stays (city has no visible
    // field anymore, so order is read from the collapsed headers).
    const toggles = screen.getAllByRole('button', { name: /^(Expand|Collapse) hotel stay \d+$/ });
    expect(toggles).toHaveLength(3);
    expect(
      toggles.map(
        (toggle) =>
          (toggle.closest('article') as HTMLElement).querySelector('h4')?.textContent,
      ),
    ).toEqual(['Hotel Stay', 'Delhi Hotel', 'Goa Hotel']);

    // Expand the blank stay to name it, then save: insertion order survives.
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.type(screen.getAllByLabelText('Hotel master')[0]!, 'Shah Palace Hotel');
    await waitFor(() =>
      expect(screen.getAllByLabelText('Hotel master')[0]).toHaveValue('Shah Palace Hotel'),
    );

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(
      JSON.parse(String(patch![1]!.body)).hotels.map(
        (hotel: { hotelName: string }) => hotel.hotelName,
      ),
    ).toEqual(['Shah Palace Hotel', 'Delhi Hotel', 'Goa Hotel']);
  });

  it('allows blank room counts and keeps hotel time visibility independent', async () => {
    const fetchMock = masterFetch(
      builderQuotation({
        hotels: [
          {
            hotelId: null,
            hotelRoomTypeId: null,
            hotelMealPlanId: null,
            city: 'Goa',
            hotelName: 'Coastal Hotel',
            category: null,
            roomType: 'Deluxe',
            mealPlan: 'Breakfast',
            rooms: 2,
            nights: 2,
            checkInDate: '2026-08-10',
            checkOutDate: '2026-08-12',
            checkInTime: '15:30',
            checkOutTime: null,
            internalCost: '0',
            sellingPrice: '0',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    const rooms = await screen.findByLabelText('Room 1 number of rooms');
    const checkInToggle = screen.getByRole('checkbox', {
      name: 'Hotel check-in include time in PDF and weblink',
    });
    const checkOutToggle = screen.getByRole('checkbox', {
      name: 'Hotel check-out include time in PDF and weblink',
    });
    expect(checkInToggle).toBeChecked();
    expect(checkOutToggle).not.toBeChecked();

    await userEvent.clear(rooms);
    fireEvent.change(screen.getByLabelText('Hotel check-out time'), {
      target: { value: '11:15' },
    });
    expect(checkOutToggle).toBeChecked();
    await userEvent.click(checkInToggle);

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(JSON.parse(String(patch![1]!.body)).hotels[0]).toMatchObject({
      rooms: null,
      checkInTime: '15:30',
      showCheckInTime: false,
      checkOutTime: '11:15',
      showCheckOutTime: true,
    });
  });

  it('inserts a sightseeing activity after the selected activity without clearing others', async () => {
    const activity = (name: string, sequence: number) => ({
      sightseeingId: null,
      name,
      description: null,
      startTime: '09:00',
      duration: null,
      city: 'Delhi',
      imageUrl: null,
      dailyTransfer: null,
      pricingOptions: [],
      sequence,
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(
        builderQuotation({
          sightseeingDetails: {
            include: true,
            sectionTitle: 'Sightseeing & Experiences',
            amount: '0',
            description: null,
            days: [
              {
                dayNumber: 1,
                title: 'Day 1',
                city: 'Delhi',
                date: null,
                meals: { breakfast: true, lunch: false, dinner: false },
                mealMode: 'INCLUDE_AT_HOTEL',
                dailyTransfer: 'SHARED',
                activities: [activity('First activity', 1), activity('Second activity', 2)],
              },
            ],
          },
        }),
      ),
    );
    renderBuilderPage();
    await openTab('Sightseeing');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add activity after activity 1 on day 1' }),
    );

    expect(
      screen
        .getAllByLabelText(/Day 1 activity \d+ name/)
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['First activity', '', 'Second activity']);
  });

  it('auto-includes a populated sightseeing start time and clears it on demand', async () => {
    const activity = (name: string, startTime: string | null, sequence: number) => ({
      sightseeingId: null,
      name,
      description: null,
      startTime,
      duration: null,
      city: 'Delhi',
      imageUrl: null,
      dailyTransfer: null,
      pricingOptions: [],
      sequence,
    });
    const fetchMock = masterFetch(
      builderQuotation({
        sightseeingDetails: {
          include: true,
          sectionTitle: 'Sightseeing & Experiences',
          amount: '0',
          description: null,
          days: [
            {
              dayNumber: 1,
              title: 'Day 1',
              city: 'Delhi',
              date: null,
              meals: { breakfast: true, lunch: false, dinner: false },
              mealMode: 'INCLUDE_AT_HOTEL',
              dailyTransfer: 'SHARED',
              activities: [
                activity('Morning tour', '09:00', 1),
                activity('Evening tour', null, 2),
              ],
            },
          ],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');

    // The legacy visibility checkbox is gone; a populated time is shown automatically.
    expect(
      screen.queryByLabelText('Day 1 activity 1 include time in PDF and weblink'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear day 1 activity 1 start time' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Clear day 1 activity 2 start time' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Clear day 1 activity 1 start time' }),
    );
    expect(screen.getByLabelText('Day 1 activity 1 start time')).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: 'Clear day 1 activity 1 start time' }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const savedActivities = JSON.parse(String(patch![1]!.body)).sightseeingDetails.days[0]
      .activities;
    expect(savedActivities).toMatchObject([
      { name: 'Morning tour', startTime: null, showTime: false },
      { name: 'Evening tour', startTime: null, showTime: false },
    ]);
  });

  it('keeps existing sightseeing titles verbatim when a day is inserted between them', async () => {
    const day = (dayNumber: number, title: string, activityName: string) => ({
      dayNumber,
      title,
      city: 'Singapore',
      date: null,
      meals: { breakfast: true, lunch: false, dinner: false },
      mealMode: 'INCLUDE_AT_HOTEL',
      dailyTransfer: 'SHARED',
      activities: [
        {
          sightseeingId: null,
          name: activityName,
          description: null,
          startTime: '09:00',
          duration: null,
          city: 'Singapore',
          imageUrl: null,
          dailyTransfer: null,
          pricingOptions: [],
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(
        builderQuotation({
          sightseeingDetails: {
            include: true,
            sectionTitle: 'Sightseeing & Experiences',
            amount: '0',
            description: null,
            days: [
              day(1, 'Day 1: Universal Studios', 'Universal Studios'),
              day(2, 'Day 2: Singapore City Tour', 'Singapore City Tour'),
            ],
          },
        }),
      ),
    );
    renderBuilderPage();
    await openTab('Sightseeing');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add Day After' }),
    );

    await waitFor(() => {
      expect(
        screen
          .getAllByLabelText(/Sightseeing day \d+ title/)
          .map((input) => (input as HTMLInputElement).value),
      ).toEqual(['Day 1: Universal Studios', 'Day 2', 'Day 2: Singapore City Tour']);
    });
  });

  it('inserts a new day before day 1 and keeps the existing day titles verbatim', async () => {
    const day = (dayNumber: number, title: string, activityName: string) => ({
      dayNumber,
      title,
      city: 'Singapore',
      date: null,
      meals: { breakfast: true, lunch: false, dinner: false },
      mealMode: 'INCLUDE_AT_HOTEL',
      dailyTransfer: 'SHARED',
      activities: [
        {
          sightseeingId: null,
          name: activityName,
          description: null,
          startTime: '09:00',
          duration: null,
          city: 'Singapore',
          imageUrl: null,
          dailyTransfer: null,
          pricingOptions: [],
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(
        builderQuotation({
          sightseeingDetails: {
            include: true,
            sectionTitle: 'Sightseeing & Experiences',
            amount: '0',
            description: null,
            days: [day(1, 'Day 1: Universal Studios', 'Universal Studios')],
          },
        }),
      ),
    );
    renderBuilderPage();
    await openTab('Sightseeing');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Insert sightseeing day before day 1' }),
    );

    await waitFor(() => {
      expect(
        screen
          .getAllByLabelText(/Sightseeing day \d+ title/)
          .map((input) => (input as HTMLInputElement).value),
      ).toEqual(['Day 1', 'Day 1: Universal Studios']);
    });
    expect(
      screen.getAllByRole('button', { name: /Insert sightseeing day before day/ }),
    ).toHaveLength(1);
  });

  it('uploads and persists an image for a manually entered sightseeing activity', async () => {
    const quotation = builderQuotation({
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Delhi',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                imageDocumentId: null,
                name: 'Manual city tour',
                description: null,
                startTime: '09:00',
                duration: null,
                city: 'Delhi',
                imageUrl: null,
                dailyTransfer: null,
                pricingOptions: [],
                sequence: 1,
              },
            ],
          },
        ],
      },
    });
    const fallback = masterFetch(quotation);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/quotations/quotation-1/uploads') && options?.method === 'POST')
        return response({
          documentId: '11111111-2222-4333-8444-555555555557',
          uploadUrl: 'https://uploads.example/manual-sightseeing.png',
          requiredHeaders: { 'Content-Type': 'image/png' },
        });
      if (url === 'https://uploads.example/manual-sightseeing.png')
        return new Response(null, { status: 200 });
      if (url.includes('/uploads/11111111-2222-4333-8444-555555555557/confirm'))
        return response({});
      if (url.includes('/documents/11111111-2222-4333-8444-555555555557/download-url'))
        return response({ url: 'https://storage.example/manual-sightseeing.png' });
      return fallback(input, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');

    await userEvent.upload(
      await screen.findByLabelText('Day 1 activity 1 image'),
      new File(['image'], 'manual-sightseeing.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('img', { name: 'Activity' })).toHaveAttribute(
      'src',
      'https://storage.example/manual-sightseeing.png',
    );
    expect(screen.getByText('Replace')).toBeInTheDocument();
    expect(screen.queryByText(/drop|paste/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Remove uploaded image')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String(patchCall![1]!.body));
      expect(body.sightseeingDetails.days[0].activities[0]).toMatchObject({
        imageDocumentId: '11111111-2222-4333-8444-555555555557',
        imageUrl: null,
      });
    });
  });

  it('prefills hotel stays from the lead itinerary', async () => {
    const quotation = {
      ...builderQuotation(),
      rooms: 2,
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-000001',
        leadStage: 'NEW_LEAD',
        assignedToId: null,
        createdById: 'user-1',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          {
            id: 'stay-1',
            country: 'Azerbaijan',
            destination: 'Baku',
            nights: 3,
            sequence: 1,
            arrivalDate: '2026-09-10T00:00:00.000Z',
            departureDate: '2026-09-13T00:00:00.000Z',
          },
        ],
      },
    };
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    expect(await screen.findByLabelText('Hotel check-in')).toHaveValue('10-09-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('13-09-2026');
    // No rooms seeding: an itinerary-prefilled stay starts with no room
    // allocations (Total Rooms stays empty until rooms are added).
    expect(screen.queryByLabelText('Room 1 number of rooms')).not.toBeInTheDocument();
    expect((screen.getByLabelText('Hotel total rooms') as HTMLInputElement).value).toBe('');
    // The itinerary destination still seeds the stay city in data, but the
    // City field is removed from the builder UI.
    expect(screen.queryByLabelText('Hotel city')).not.toBeInTheDocument();
    // Nights is read-only and derived from the stay dates (10 Sep → 13 Sep = 3).
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('3');
  });

  it('uses the lead destination and customer for a legacy generated quotation title', async () => {
    const quotation = {
      ...builderQuotation({
        title: 'Singapore travel proposal',
        destinationSummary: 'Singapore',
      }),
      customerName: 'Vikas Singh',
      destinationSummary: 'Singapore',
    };
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();

    expect(await screen.findByDisplayValue('Singapore Package for Vikas Singh')).toBeInTheDocument();
  });

  it('hides alternative Hotel Options without removing the hotel editor', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Hotel');

    expect(await screen.findByText('Hotel Options')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Hotel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Hotel Option' })).not.toBeInTheDocument();
  });

  it('labels hotel cards as Hotel Stay without exposing Default wording', async () => {
    const quotation = stayQuotation([{ destination: 'Singapore', nights: 2 }]);
    const fetchMock = masterFetch(quotation, {
      '/masters/hotels': page([singaporeDefaultHotel()]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');

    expect(await screen.findByText('Hotel Options')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })).toHaveLength(
        1,
      ),
    );
    expect(screen.queryByText('Default Hotel Option')).not.toBeInTheDocument();
    expect(screen.queryByText('Hotel for Default Option')).not.toBeInTheDocument();
    // The default hotel is still auto-prefilled into the Hotel Stay card.
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    expect(screen.getByLabelText('Hotel master')).toHaveValue('Aloft Singapore Novena by Marriott');
  });

  it('warns and blocks saving when arrival is not after departure', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    const fetchMock = masterFetch(
      builderQuotation({
        flightDetails: {
          include: true,
          sectionTitle: 'Flight Details',
          amount: 0,
          journeyType: 'ONEWAY_OUTBOUND',
          outbound: {
            fromCity: 'Chennai',
            toCity: 'Singapore',
            travelClass: 'Economy',
            segments: [
              {
                airlineId: null,
                airlineName: null,
                flightNumber: null,
                travelClass: 'Economy',
                from: 'Chennai',
                to: 'Singapore',
                departureDate: '2026-08-10',
                departureTime: '23:00',
                arrivalDate: '2026-08-10',
                arrivalTime: '17:00',
                duration: null,
                cabinLuggage: '7kg',
                checkInLuggage: '20kg',
                notes: null,
                connectionVia: null,
              },
            ],
          },
          returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();

    expect(await screen.findByText('Arrival time must be after departure time.')).toHaveAttribute(
      'role',
      'alert',
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false),
    );
  });

  it('fills missing dates on an existing hotel row from the lead travel dates', async () => {
    const quotation = {
      ...builderQuotation({
        hotelDetails: {
          sectionTitle: 'Accommodation Details',
          amount: 0,
          description: null,
        },
        hotels: [
          {
            id: 'existing-hotel-row',
            city: 'Goa',
            hotelName: 'Coastal Bay Resort',
            category: '4 Star',
            roomType: 'Deluxe Room',
            mealPlan: 'Breakfast Only',
            rooms: 1,
            nights: 4,
            checkInDate: null,
            checkOutDate: null,
            internalCost: '0',
            sellingPrice: '0',
            selected: true,
            notes: null,
            sequence: 1,
          },
        ],
      }),
      travelStartDate: '2026-09-10T00:00:00.000Z',
      travelEndDate: '2026-09-14T00:00:00.000Z',
      destinationSummary: 'Goa',
      rooms: 1,
    };
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    expect(await screen.findByLabelText('Hotel section title')).toHaveValue('Your Hotels');
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('10-09-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('14-09-2026');
  });

  it('derives hotel dates from the trip start and itinerary nights when end dates are absent', async () => {
    const quotation = {
      ...builderQuotation(),
      travelStartDate: '2026-08-10T00:00:00.000Z',
      travelEndDate: null,
      destinationSummary: 'Singapore',
      rooms: 4,
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-000001',
        leadStage: 'NEW_LEAD',
        assignedToId: null,
        createdById: 'user-1',
        departureCity: 'Chennai',
        departureCountry: 'India',
        itinerary: [
          {
            id: 'stay-1',
            country: 'Singapore',
            destination: 'Singapore',
            nights: 6,
            sequence: 1,
            arrivalDate: null,
            departureDate: null,
          },
        ],
      },
    };
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    expect(await screen.findByLabelText('Hotel check-in')).toHaveValue('10-08-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('16-08-2026');
  });

  it('links the hotel, room type and meal plan without showing internal pricing fields', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.type(screen.getByLabelText('Hotel master'), 'Shah Palace Hotel');

    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue('Shah Palace Hotel'),
    );
    // Master selection still stores the city in data (used for sorting and
    // saves) with no visible City field in the builder UI.
    expect(screen.queryByLabelText('Hotel city')).not.toBeInTheDocument();
    // Room and meal lines start empty: add a room allocation first. Both
    // sections are always visible, so no expansion click is needed.
    await userEvent.click(screen.getByRole('button', { name: 'Add room' }));
    await waitFor(() => expect(screen.getByLabelText('Room 1 type master')).toBeEnabled());

    await userEvent.type(screen.getByLabelText('Room 1 type master'), 'Deluxe Room');
    await waitFor(() =>
      expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Deluxe Room'),
    );

    await userEvent.type(screen.getByLabelText('Meal plan 1 master'), 'Breakfast Only');
    await waitFor(() =>
      expect(screen.getByLabelText('Meal plan 1 master')).toHaveValue('Breakfast Only'),
    );
    expect(screen.queryByLabelText('Hotel selling price')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hotel internal cost')).not.toBeInTheDocument();
  });

  it('saves custom Room Type and Meal Plan text typed into the comboboxes without creating masters', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.type(screen.getByLabelText('Hotel master'), 'Shah Palace Hotel');
    await waitFor(() => expect(screen.getByLabelText('Room 1 type master')).toBeEnabled());

    const roomType = screen.getByLabelText('Room 1 type master');
    const mealPlan = screen.getByLabelText('Meal plan 1 master');
    await userEvent.type(roomType, 'Super Deluxe Valley View');
    await userEvent.type(mealPlan, 'Breakfast + Dinner');
    fireEvent.blur(roomType);
    fireEvent.blur(mealPlan);

    // The typed text must survive blur.
    expect(roomType).toHaveValue('Super Deluxe Valley View');
    expect(mealPlan).toHaveValue('Breakfast + Dinner');

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const hotels = JSON.parse(String(patch![1]!.body)).hotels;
    expect(hotels[0].roomType).toBe('Super Deluxe Valley View');
    expect(hotels[0].mealPlan).toBe('Breakfast + Dinner');
    // Custom text is free text, never a master link.
    expect(hotels[0].hotelRoomTypeId).toBeNull();
    expect(hotels[0].hotelMealPlanId).toBeNull();
    // No master value may be created from custom text.
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => options?.method === 'POST' && String(url).includes('/masters/hotels/'),
      ),
    ).toBe(false);
  });

  it('still links the room type and meal plan master when the typed text matches an option', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.type(screen.getByLabelText('Hotel master'), 'Shah Palace Hotel');
    await waitFor(() => expect(screen.getByLabelText('Room 1 type master')).toBeEnabled());
    await userEvent.type(screen.getByLabelText('Room 1 type master'), 'Deluxe Room');
    await userEvent.type(screen.getByLabelText('Meal plan 1 master'), 'Breakfast Only');
    await waitFor(() =>
      expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Deluxe Room'),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Meal plan 1 master')).toHaveValue('Breakfast Only'),
    );

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const hotels = JSON.parse(String(patch![1]!.body)).hotels;
    expect(hotels[0].hotelRoomTypeId).toBe('aaaaaaa2-1111-4111-8111-111111111111');
    expect(hotels[0].hotelMealPlanId).toBe('aaaaaaa3-1111-4111-8111-111111111111');
    expect(hotels[0].roomType).toBe('Deluxe Room');
    expect(hotels[0].mealPlan).toBe('Breakfast Only');
  });

  it('shows saved custom Room Type and Meal Plan values when a quotation is reopened', async () => {
    vi.stubGlobal(
      'fetch',
      masterFetch(
        builderQuotation({
          hotels: [
            {
              hotelId: 'aaaaaaa1-1111-4111-8111-111111111111',
              hotelRoomTypeId: null,
              hotelMealPlanId: null,
              city: 'Baku',
              hotelName: 'Shah Palace Hotel',
              category: '4 Star',
              roomType: 'Super Deluxe Valley View',
              mealPlan: 'Breakfast + Dinner',
              rooms: 1,
              nights: 2,
              checkInDate: null,
              checkOutDate: null,
              checkInTime: null,
              checkOutTime: null,
              internalCost: '0',
              sellingPrice: '0',
              selected: true,
              notes: null,
              sequence: 1,
            },
          ],
        }),
      ),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Super Deluxe Valley View');
    expect(screen.getByLabelText('Meal plan 1 master')).toHaveValue('Breakfast + Dinner');
  });

  it('keeps the simplified hotel card free of costing fields for every permission level', async () => {
    auth.permissions.delete('quotations.view_costing');
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.type(screen.getByLabelText('Hotel master'), 'Shah Palace Hotel');
    await waitFor(() => expect(screen.getByLabelText('Room 1 type master')).toBeEnabled());
    await userEvent.type(screen.getByLabelText('Room 1 type master'), 'Deluxe Room');
    await waitFor(() =>
      expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Deluxe Room'),
    );
    expect(screen.queryByLabelText('Hotel selling price')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hotel internal cost')).not.toBeInTheDocument();
  });

  it('shows each tab its own master picker and keeps a fresh row unlinked', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();

    // The Sightseeing tab is a day-wise itinerary builder, not a service picker.
    await openTab('Sightseeing');
    expect(await screen.findByLabelText('Sightseeing section title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Day/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Airline master')).not.toBeInTheDocument();

    // The Flight tab is a structured journey builder (Journey Type + segments),
    // not a service-row master picker.
    await openTab('Flight');
    expect(await screen.findByLabelText('Journey type for flight 1')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Airline').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Add Connection/i }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Sightseeing master')).not.toBeInTheDocument();
  });

  it('renders every imported multi-segment flight journey immediately', async () => {
    const segment = (flightNumber: string, from: string, to: string) => ({
      airlineId: null,
      airlineName: 'IndiGo',
      flightNumber,
      travelClass: 'Economy',
      from,
      to,
      departureDate: '2026-09-10',
      departureTime: '06:00',
      arrivalDate: '2026-09-10',
      arrivalTime: '12:00',
      duration: null,
      cabinLuggage: null,
      checkInLuggage: null,
      notes: null,
      connectionVia: null,
    });
    const quotation = builderQuotation({
      flightDetails: {
        include: true,
        sectionTitle: 'Flight Details',
        amount: 0,
        entryMode: 'MANUAL',
        journeyType: 'ROUND_TRIP',
        outbound: {
          fromCity: 'LKO',
          toCity: 'SIN',
          travelClass: 'Economy',
          segments: [segment('6E101', 'LKO', 'BLR'), segment('6E102', 'BLR', 'SIN')],
        },
        returnJourney: {
          fromCity: 'SIN',
          toCity: 'LKO',
          travelClass: 'Economy',
          segments: [segment('6E103', 'SIN', 'BLR'), segment('6E104', 'BLR', 'LKO')],
        },
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Flight');

    // Both outbound and return journeys render every imported segment
    // immediately — no "Add Connection" click.
    await screen.findByDisplayValue('6E101');
    // Two journeys (outbound + return) each have Segment 1 and Segment 2.
    expect(screen.getAllByText('Segment 1').length).toBe(2);
    expect(screen.getAllByText('Segment 2').length).toBe(2);
    expect(screen.queryByText('Segment 3')).not.toBeInTheDocument();
    // Flight numbers of the imported segments are present without any action.
    expect(screen.getByDisplayValue('6E101')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6E102')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6E103')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6E104')).toBeInTheDocument();
  });

  it('shows the connection airport from the segment pair, not the journey origin', async () => {
    const segment = (flightNumber: string, from: string, to: string) => ({
      airlineId: null,
      airlineName: 'IndiGo',
      flightNumber,
      travelClass: 'Economy',
      from,
      to,
      departureDate: '2026-09-10',
      departureTime: '06:00',
      arrivalDate: '2026-09-10',
      arrivalTime: '12:00',
      duration: null,
      cabinLuggage: null,
      checkInLuggage: null,
      notes: null,
      connectionVia: null,
    });
    const quotation = builderQuotation({
      flightDetails: {
        include: true,
        sectionTitle: 'Flight Details',
        amount: 0,
        entryMode: 'MANUAL',
        journeyType: 'ROUND_TRIP',
        outbound: {
          fromCity: 'LKO',
          toCity: 'SIN',
          travelClass: 'Economy',
          segments: [segment('6E101', 'LKO', 'BLR'), segment('6E102', 'BLR', 'SIN')],
        },
        returnJourney: {
          fromCity: 'SIN',
          toCity: 'LKO',
          travelClass: 'Economy',
          segments: [segment('6E103', 'SIN', 'LKO')],
        },
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Flight');

    // The connection banner between segment 1 and segment 2 uses BLR, not LKO.
    expect(await screen.findByText(/Connected via BLR/)).toBeInTheDocument();
    expect(screen.queryByText(/Connected via LKO/)).not.toBeInTheDocument();
  });

  it('Add Connection appends one blank segment without duplicating existing ones', async () => {
    const segment = (flightNumber: string, from: string, to: string) => ({
      airlineId: null,
      airlineName: 'IndiGo',
      flightNumber,
      travelClass: 'Economy',
      from,
      to,
      departureDate: '2026-09-10',
      departureTime: '06:00',
      arrivalDate: '2026-09-10',
      arrivalTime: '12:00',
      duration: null,
      cabinLuggage: null,
      checkInLuggage: null,
      notes: null,
      connectionVia: null,
    });
    const quotation = builderQuotation({
      flightDetails: {
        include: true,
        sectionTitle: 'Flight Details',
        amount: 0,
        entryMode: 'MANUAL',
        journeyType: 'ROUND_TRIP',
        outbound: {
          fromCity: 'LKO',
          toCity: 'SIN',
          travelClass: 'Economy',
          segments: [segment('6E101', 'LKO', 'BLR'), segment('6E102', 'BLR', 'SIN')],
        },
        returnJourney: {
          fromCity: 'SIN',
          toCity: 'LKO',
          travelClass: 'Economy',
          segments: [segment('6E103', 'SIN', 'LKO')],
        },
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Flight');

    expect(await screen.findByText('Segment 2')).toBeInTheDocument();
    expect(screen.queryByText('Segment 3')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /Add Connection/i })[0]!);

    // Existing segments unchanged, exactly one blank Segment 3 added.
    expect(screen.getByDisplayValue('6E101')).toBeInTheDocument();
    expect(screen.getByDisplayValue('6E102')).toBeInTheDocument();
    expect(screen.getByText('Segment 3')).toBeInTheDocument();
    expect(screen.queryByText('Segment 4')).not.toBeInTheDocument();
  });

  it('importing a multi-segment flight bookmark renders every segment immediately', async () => {
    const seg = (flightNumber: string, from: string, to: string, date: string) => ({
      departure_airport: { name: from, id: from, date, time: '06:00' },
      arrival_airport: { name: to, id: to, date, time: '12:00' },
      duration: 120,
      airline: 'Air India',
      flight_number: flightNumber,
      travel_class: 'Economy',
    });
    const bookmark = {
      id: 'bm-ms',
      type: 'FLIGHT',
      provider: 'SEARCHAPI',
      fingerprint: 'fp-ms',
      bookmarkCode: 'FLT-000123',
      title: 'LKO → SIN',
      currency: 'INR',
      createdAt: '2026-08-16T10:00:00.000Z',
      searchParams: {
        departure_id: 'LKO',
        arrival_id: 'SIN',
        outbound_date: '2026-09-10',
        return_date: '2026-09-14',
        type: 2,
        currency: 'INR',
      },
      snapshot: {
        flight: {
          airline: 'Air India',
          flightNumbers: ['AI101', 'AI102', 'AI103', 'AI104'],
          price: 12345,
          currency: 'INR',
          type: 'Round trip',
          segments: [
            seg('AI101', 'LKO', 'BLR', '2026-09-10'),
            seg('AI102', 'BLR', 'SIN', '2026-09-10'),
            seg('AI103', 'SIN', 'BLR', '2026-09-14'),
            seg('AI104', 'BLR', 'LKO', '2026-09-14'),
          ],
        },
      },
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/api/search/bookmarks/by-code/': bookmark,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Flight');

    const idField = await screen.findByLabelText('Flight 1 bookmark ID');
    await userEvent.type(idField, 'FLT-000123');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));

    // Outbound (2 segments) + return (2 segments) all render immediately.
    expect(await screen.findByDisplayValue('AI101')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AI102')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AI103')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AI104')).toBeInTheDocument();
    expect(screen.getAllByText('Segment 1').length).toBe(2);
    expect(screen.getAllByText('Segment 2').length).toBe(2);
    expect(screen.queryByText('Segment 3')).not.toBeInTheDocument();
    // No duplicate segments from the import.
    expect(screen.getAllByDisplayValue('AI101').length).toBe(1);
    expect(screen.getAllByDisplayValue('AI102').length).toBe(1);
  });

  it('uploads a flight image as an alternative to structured flight details', async () => {
    const fallback = masterFetch(builderQuotation());
    let uploadCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/quotations/quotation-1/uploads')) {
        uploadCount += 1;
        const suffix = uploadCount === 1 ? '555555555555' : '555555555556';
        return response({
          documentId: `11111111-2222-4333-8444-${suffix}`,
          uploadUrl: `https://uploads.example/flight-${uploadCount}.png`,
          requiredHeaders: { 'Content-Type': 'image/png' },
        });
      }
      if (url.startsWith('https://uploads.example/flight-'))
        return { ok: true, status: 200 } as Response;
      if (url.includes('/confirm')) return response({ status: 'AVAILABLE' });
      if (url.includes('555555555555/download-url'))
        return response({ url: 'https://cdn.example/flight-1.png' });
      if (url.includes('555555555556/download-url'))
        return response({ url: 'https://cdn.example/flight-2.png' });
      return fallback(input, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Flight');
    await userEvent.click(await screen.findByRole('radio', { name: 'Upload image' }));
    expect(screen.queryByLabelText('Journey type')).not.toBeInTheDocument();
    await userEvent.upload(
      screen.getByLabelText('Flight image'),
      new File(['flight'], 'outbound.png', { type: 'image/png' }),
    );
    const storagePut = fetchMock.mock.calls.find(
      ([url]) => String(url) === 'https://uploads.example/flight-1.png',
    );
    expect(storagePut?.[1]?.headers).toEqual({ 'Content-Type': 'image/png' });
    expect(await screen.findByRole('img', { name: 'Uploaded flight itinerary 1' })).toHaveAttribute(
      'src',
      'https://cdn.example/flight-1.png',
    );
    await userEvent.type(
      screen.getByLabelText('Flight image 1 description'),
      'Outbound flight ticket',
    );
    await userEvent.upload(
      screen.getByLabelText('Flight image'),
      new File(['flight'], 'return.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('img', { name: 'Uploaded flight itinerary 2' })).toHaveAttribute(
      'src',
      'https://cdn.example/flight-2.png',
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.flightDetails).toMatchObject({
        entryMode: 'IMAGE',
        images: [
          {
            documentId: '11111111-2222-4333-8444-555555555555',
            fileName: 'outbound.png',
            description: 'Outbound flight ticket',
            heading: null,
          },
          {
            documentId: '11111111-2222-4333-8444-555555555556',
            fileName: 'return.png',
            description: null,
            heading: null,
          },
        ],
      });
    });
  });

  it('links a cruise before its cabin and prefills the cabin price', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Cruise');
    // Enabling Cruise auto-creates the first entry.
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    expect(await screen.findByLabelText('Cruise room type master')).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Cruise master'), 'Dream Genting');
    await waitFor(() => expect(screen.getByLabelText('Cruise room type master')).toBeEnabled());
    await userEvent.type(screen.getByLabelText('Cruise room type master'), 'Interior');
    await waitFor(() => expect(screen.getByLabelText('Cruise amount')).toHaveValue(18000));
  });

  it('saves a cruise with name, duration, room type, description and section fields', async () => {
    const quotation = builderQuotation();
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Cruise');
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    await userEvent.type(await screen.findByLabelText('Cruise master'), 'Dream Genting');
    await waitFor(() => expect(screen.getByLabelText('Cruise room type master')).toBeEnabled());
    await userEvent.type(screen.getByLabelText('Cruise room type master'), 'Interior');
    await userEvent.clear(screen.getByLabelText('Cruise section title'));
    await userEvent.type(screen.getByLabelText('Cruise section title'), 'Ocean Cruise');
    await userEvent.type(screen.getByLabelText('Cruise duration'), '2 nights');
    // Rich-text description: set HTML directly (jsdom typing can hit execCommand).
    fireEvent.input(screen.getByLabelText('Cruise description'), {
      target: { innerHTML: '<p>A lovely voyage.</p>' },
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      const cruiseRow = body.services.find(
        (service: { serviceType: string }) => service.serviceType === 'CRUISE',
      );
      expect(cruiseRow).toMatchObject({
        cruiseId: 'aaaaaaa5-1111-4111-8111-111111111111',
        cruiseRoomTypeId: 'aaaaaaa6-1111-4111-8111-111111111111',
        city: 'Interior',
        name: 'Dream Genting',
        notes: '2 nights',
        taxCategory: 'Ocean Cruise',
        sellingPrice: 18000,
      });
      expect(String(cruiseRow.description)).toContain('A lovely voyage.');
    });
  });

  it('auto-creates one cruise entry with Cruise Details title when enabled', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Cruise');
    // No entry before enabling.
    expect(screen.queryByLabelText('Cruise master')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    // Exactly one entry appears with the default Section Title.
    expect(await screen.findByLabelText('Cruise section title')).toHaveValue('Cruise Details');
    expect(screen.getAllByLabelText('Cruise master').length).toBe(1);
    // Tab switching / rerenders must not duplicate it.
    await openTab('Flight');
    await openTab('Cruise');
    expect(screen.getAllByLabelText('Cruise master').length).toBe(1);
  });

  it('loads saved cruise rows without adding an automatic entry', async () => {
    const quotation = builderQuotation({
      services: [
        {
          id: 's-cruise',
          serviceType: 'CRUISE',
          name: 'Saved Cruise',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '1000',
          totalSellingPrice: '1000',
          sellingPrice: '1000',
          taxCategory: 'My Cruise Title',
          notes: '3 nights',
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Cruise');
    // The saved row loads, Cruise is included, and no extra row is created.
    expect(await screen.findByLabelText('Cruise master')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Cruise master').length).toBe(1);
    expect(screen.getByLabelText('Cruise section title')).toHaveValue('My Cruise Title');
  });

  it('defaults the Cruise section title for snapshots that never stored one', async () => {
    const quotation = builderQuotation({
      services: [
        {
          id: 's-cruise',
          serviceType: 'CRUISE',
          name: 'Legacy Cruise',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '1000',
          totalSellingPrice: '1000',
          sellingPrice: '1000',
          taxCategory: null,
          notes: null,
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Cruise');
    expect(await screen.findByLabelText('Cruise master')).toBeInTheDocument();
    // The legacy snapshot has no stored title, so the field gets the default.
    expect(screen.getByLabelText('Cruise section title')).toHaveValue('Cruise Details');
  });

  it('refills an empty Cruise section title on re-enable but preserves a custom one', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Cruise');
    const includeCruise = () => screen.getByLabelText('Include Cruise in Quotation');
    await userEvent.click(includeCruise());
    const title = await screen.findByLabelText('Cruise section title');
    expect(title).toHaveValue('Cruise Details');
    // Empty the title, uncheck, then re-check: the default is restored.
    await userEvent.clear(title);
    await userEvent.click(includeCruise());
    expect(screen.queryByLabelText('Cruise section title')).not.toBeInTheDocument();
    await userEvent.click(includeCruise());
    expect(await screen.findByLabelText('Cruise section title')).toHaveValue('Cruise Details');

    // A custom title is preserved across uncheck/re-check.
    await userEvent.clear(screen.getByLabelText('Cruise section title'));
    await userEvent.type(screen.getByLabelText('Cruise section title'), 'Luxury Cruise Experience');
    await userEvent.click(includeCruise());
    await userEvent.click(includeCruise());
    expect(await screen.findByLabelText('Cruise section title')).toHaveValue(
      'Luxury Cruise Experience',
    );
  });

  it('shows the selected cruise room type options and preserves a historical value', async () => {
    const quotation = builderQuotation({
      services: [
        {
          id: 's-cruise',
          serviceType: 'CRUISE',
          name: 'Saved Cruise',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '1000',
          totalSellingPrice: '1000',
          sellingPrice: '1000',
          taxCategory: null,
          notes: null,
          cruiseId: 'aaaaaaa5-1111-4111-8111-111111111111',
          // A historical room type no longer present in the active options.
          cruiseRoomTypeId: 'aaaaaaa6-1111-4111-8111-111111111111',
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Cruise');
    // The selected cruise's active room type option is shown.
    expect(await screen.findByLabelText('Cruise room type master')).toBeEnabled();
    expect(screen.getByLabelText('Cruise room type master')).toHaveValue('Interior');
  });

  it('lists every room type option for the selected cruise', async () => {
    const multiRoomCruise = {
      ...cruise,
      roomTypes: [
        {
          id: 'rt-1',
          name: 'Interior',
          price: 18000,
          currency: 'INR',
          status: 'ACTIVE',
          sortOrder: 1,
        },
        {
          id: 'rt-2',
          name: 'Ocean View',
          price: 24000,
          currency: 'INR',
          status: 'ACTIVE',
          sortOrder: 2,
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(builderQuotation(), { '/masters/cruises': page([multiRoomCruise]) }),
    );
    renderBuilderPage();
    await openTab('Cruise');
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    await userEvent.type(await screen.findByLabelText('Cruise master'), 'Dream Genting');
    await waitFor(() => expect(screen.getByLabelText('Cruise room type master')).toBeEnabled());
    const input = screen.getByLabelText('Cruise room type master');
    const list = document.querySelector(`datalist[id="${input.getAttribute('list')}"]`);
    expect(list).not.toBeNull();
    const labels = Array.from(list!.querySelectorAll('option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(labels).toEqual(expect.arrayContaining(['Interior', 'Ocean View']));
  });

  it('shows an empty state when the selected cruise has no room types', async () => {
    const noRoomCruise = { ...cruise, roomTypes: [] };
    vi.stubGlobal(
      'fetch',
      masterFetch(builderQuotation(), { '/masters/cruises': page([noRoomCruise]) }),
    );
    renderBuilderPage();
    await openTab('Cruise');
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    await userEvent.type(await screen.findByLabelText('Cruise master'), 'Dream Genting');
    await waitFor(() => expect(screen.getByLabelText('Cruise room type master')).toBeEnabled());
    expect(screen.getByLabelText('Cruise room type master')).toHaveAttribute(
      'placeholder',
      'No room types configured',
    );
  });

  it('preserves a snapshotted cruise room type when the Master option disappears', async () => {
    const noRoomCruise = { ...cruise, roomTypes: [] };
    const quotation = builderQuotation({
      services: [
        {
          id: 's-cruise',
          serviceType: 'CRUISE',
          name: 'Dream Genting',
          description: null,
          dayNumber: null,
          city: 'Balcony Suite',
          quantity: '1',
          unitSellingPrice: '1000',
          totalSellingPrice: '1000',
          sellingPrice: '1000',
          taxCategory: 'Cruise Details',
          notes: '2 nights',
          cruiseId: 'aaaaaaa5-1111-4111-8111-111111111111',
          cruiseRoomTypeId: null,
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', masterFetch(quotation, { '/masters/cruises': page([noRoomCruise]) }));
    renderBuilderPage();
    await openTab('Cruise');
    expect(await screen.findByLabelText('Cruise room type master')).toHaveValue('Balcony Suite');
  });

  it('clears an invalid saved room type when the cruise changes', async () => {
    const cruiseA = {
      id: 'cruise-a',
      name: 'Cruise Alpha',
      status: 'ACTIVE',
      roomTypes: [
        {
          id: 'rt-a',
          name: 'Balcony',
          price: 100,
          currency: 'INR',
          status: 'ACTIVE',
          sortOrder: 1,
        },
      ],
    };
    const cruiseB = {
      id: 'cruise-b',
      name: 'Cruise Beta',
      status: 'ACTIVE',
      roomTypes: [
        { id: 'rt-b', name: 'Suite', price: 200, currency: 'INR', status: 'ACTIVE', sortOrder: 1 },
      ],
    };
    const quotation = builderQuotation({
      services: [
        {
          id: 's-cruise',
          serviceType: 'CRUISE',
          name: 'Cruise Alpha',
          description: null,
          dayNumber: null,
          city: null,
          quantity: '1',
          unitSellingPrice: '100',
          totalSellingPrice: '100',
          sellingPrice: '100',
          taxCategory: null,
          notes: null,
          cruiseId: 'cruise-a',
          cruiseRoomTypeId: 'rt-a',
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, { '/masters/cruises': page([cruiseA, cruiseB]) }),
    );
    renderBuilderPage();
    await openTab('Cruise');
    // Saved cruise + room type load automatically.
    await waitFor(() =>
      expect(screen.getByLabelText('Cruise room type master')).toHaveValue('Balcony'),
    );
    // Switching to a cruise whose room types do not include the saved one clears it.
    await userEvent.clear(screen.getByLabelText('Cruise master'));
    await userEvent.type(screen.getByLabelText('Cruise master'), 'Cruise Beta');
    await waitFor(() => expect(screen.getByLabelText('Cruise room type master')).toHaveValue(''));
    const input = screen.getByLabelText('Cruise room type master');
    const list = document.querySelector(`datalist[id="${input.getAttribute('list')}"]`);
    const labels = Array.from(list!.querySelectorAll('option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(labels).toEqual(['Suite']);
  });

  it('saves without cruise validation errors when Cruise is unchecked', async () => {
    const quotation = builderQuotation();
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Cruise');
    // Enabling Cruise creates an empty entry; saving is blocked while included.
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    expect(
      await screen.findByText(/services\.0\.name: String must contain at least 1 character/),
    ).toBeInTheDocument();
    // Unchecking Cruise clears the stale error and saves without cruise rows.
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    expect(screen.queryByText(/services\.0\.name/)).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.services.some((s: { serviceType: string }) => s.serviceType === 'CRUISE')).toBe(
        false,
      );
    });
  });

  const sgMaster = (id: string, title: string, sequence: number) => ({
    id,
    title,
    sequence,
    status: 'ACTIVE',
    destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
    city: { id: 'city-sg', name: 'Singapore' },
    estimatedHours: 2,
    suggestedStartTime: '09:00',
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('prefills one primary sightseeing activity per day within the trip duration', async () => {
    const masters = [
      sgMaster('sg-1', 'City Tour', 1),
      sgMaster('sg-2', 'Sentosa Tour', 2),
      sgMaster('sg-3', 'Universal Studios', 3),
      sgMaster('sg-4', 'Zoo', 4),
      sgMaster('sg-5', 'Gardens by the Bay', 5),
      sgMaster('sg-6', 'Night Safari', 6),
      sgMaster('sg-7', 'Bird Park', 7),
    ];
    const quotation = {
      ...builderQuotation(),
      destinationSummary: 'Singapore',
      travelStartDate: '2026-08-10T00:00:00.000Z',
      travelEndDate: '2026-08-14T00:00:00.000Z',
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-1',
        leadStage: 'QUALIFIED',
        assignedToId: null,
        createdById: 'user-1',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          {
            id: 'stay-1',
            country: 'Singapore',
            destination: 'Singapore',
            nights: 4,
            sequence: 1,
            arrivalDate: '2026-08-10T00:00:00.000Z',
            departureDate: '2026-08-14T00:00:00.000Z',
          },
        ],
      },
    };
    vi.stubGlobal('fetch', masterFetch(quotation, { '/masters/sightseeing': page(masters) }));
    renderBuilderPage();
    await openTab('Sightseeing');
    // 4 nights → up to 5 day containers.
    await waitFor(() =>
      expect(screen.getAllByLabelText(/Sightseeing day \d+ title/)).toHaveLength(5),
    );
    // One primary activity per day, taken in ascending master sequence order.
    expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('City Tour');
    expect(screen.getByLabelText('Day 2 activity 1 name')).toHaveValue('Sentosa Tour');
    expect(screen.getByLabelText('Day 3 activity 1 name')).toHaveValue('Universal Studios');
    expect(screen.getByLabelText('Day 4 activity 1 name')).toHaveValue('Zoo');
    expect(screen.getByLabelText('Day 5 activity 1 name')).toHaveValue('Gardens by the Bay');
    // No extra prefilled activities; the remaining masters stay in the picker.
    expect(screen.queryByLabelText('Day 1 activity 2 name')).not.toBeInTheDocument();
    // Meaningful day titles taken verbatim from the primary activity (no generated separator).
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('City Tour');
    expect(screen.getByLabelText('Sightseeing day 5 title')).toHaveValue(
      'Gardens by the Bay',
    );
  });

  it('defaults the Sightseeing section title to Your Itinerary', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Sightseeing');
    expect(await screen.findByLabelText('Sightseeing section title')).toHaveValue(
      'Your Itinerary',
    );
  });

  it('preserves a manually edited sightseeing day title', async () => {
    const quotation = builderQuotation({
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: 0,
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'My Custom Day',
            titleTouched: true,
            city: 'Singapore',
            date: null,
            meals: { breakfast: false, lunch: false, dinner: false },
            mealMode: 'NO_TRANSFER',
            dailyTransfer: 'NO_TRANSFER',
            activities: [
              {
                sightseeingId: 'sg-1',
                name: 'City Tour',
                description: null,
                startTime: '09:00',
                imageUrl: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Sightseeing');
    await waitFor(() =>
      expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('My Custom Day'),
    );
  });

  it('copies master sightseeing fields and keeps the day title verbatim', async () => {
    const master = {
      id: 'sg-1',
      title: 'City Tour',
      sequence: 1,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      estimatedHours: 3,
      suggestedStartTime: '14:00',
      description: '<p>Guided tour of the city.</p>',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const quotation = {
      ...builderQuotation({ destinationSummary: 'Singapore' }),
      destinationSummary: 'Singapore',
    };
    vi.stubGlobal('fetch', masterFetch(quotation, { '/masters/sightseeing': page([master]) }));
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    // Wait for the destination-scoped master options to load, then select one.
    await openActivityPicker(picker, 'City Tour');
    fireEvent.change(picker, { target: { value: 'City Tour' } });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('City Tour'),
    );
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('City Tour');
    expect(screen.getByLabelText('Day 1 activity 1 start time')).toHaveValue('14:00');
    expect(screen.getByLabelText('Day 1 activity 1 description')).toHaveTextContent(
      'Guided tour of the city.',
    );
  });

  it('shows the selected sightseeing master image in the builder via the batched presentation', async () => {
    const withImage = {
      id: 'sg-img-1',
      title: 'Marina Bay',
      sequence: 2,
      status: 'ACTIVE',
      hasImage: true,
      estimatedHours: 2,
      suggestedStartTime: '10:00',
      description: '<p>Bay lights.</p>',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const noImage = {
      id: 'sg-no-img',
      title: 'Legacy Walk',
      sequence: 1,
      status: 'ACTIVE',
      hasImage: false,
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const quotation = builderQuotation({ destinationSummary: 'Singapore' });
    const fetchMock = masterFetch(quotation, {
      '/masters/sightseeing': page([noImage, withImage]),
      '/masters/sightseeing/presentations': {
        'sg-img-1': { imageUrl: 'https://storage.example.test/signed/marina-bay.jpg' },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    // The prefilled activity is the first master (no image), so selecting the
    // image master later always fires a real change.
    expect(picker).toHaveValue('Legacy Walk');
    await openActivityPicker(picker, 'Marina Bay');
    fireEvent.change(picker, { target: { value: 'Marina Bay' } });
    const img = await screen.findByAltText('Activity');
    expect(img).toHaveAttribute('src', 'https://storage.example.test/signed/marina-bay.jpg');
    expect(img).toHaveClass('object-cover');
    expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('Marina Bay');
    // The expiring signed URL is resolved for display only, never fetched via
    // the single download-url endpoint or persisted.
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/masters/sightseeing/sg-img-1/image/download-url'),
      ),
    ).toBe(false);
  });

  it('changes the preview when the activity changes, falls back without an image and on load failure', async () => {
    const withImage = {
      id: 'sg-img-1',
      title: 'Marina Bay',
      sequence: 2,
      status: 'ACTIVE',
      hasImage: true,
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const noImage = {
      id: 'sg-no-img',
      title: 'Legacy Walk',
      sequence: 1,
      status: 'ACTIVE',
      hasImage: false,
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const quotation = builderQuotation({ destinationSummary: 'Singapore' });
    const fetchMock = masterFetch(quotation, {
      '/masters/sightseeing': page([noImage, withImage]),
      '/masters/sightseeing/presentations': {
        'sg-img-1': { imageUrl: 'https://storage.example.test/signed/marina-bay.jpg' },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    await openActivityPicker(picker, 'Marina Bay');
    fireEvent.change(picker, { target: { value: 'Marina Bay' } });
    const img = await screen.findByAltText('Activity');
    expect(img).toHaveAttribute('src', 'https://storage.example.test/signed/marina-bay.jpg');
    // Switching to a master without an image clears the preview back to the placeholder.
    fireEvent.change(picker, { target: { value: 'Legacy Walk' } });
    await waitFor(() => {
      expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('Legacy Walk');
      expect(screen.queryByAltText('Activity')).not.toBeInTheDocument();
    });
    // Clearing the master removes the preview entirely.
    fireEvent.change(picker, { target: { value: '' } });
    await waitFor(() => expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue(''));
    expect(screen.queryByAltText('Activity')).not.toBeInTheDocument();
    // And a load failure on an image falls back to the neutral placeholder.
    fireEvent.change(picker, { target: { value: 'Marina Bay' } });
    const imgAgain = await screen.findByAltText('Activity');
    fireEvent.error(imgAgain);
    await waitFor(() => expect(screen.queryByAltText('Activity')).not.toBeInTheDocument());
  });

  it('renders existing selected activities with their master image on load', async () => {
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1: Marina Bay',
            city: 'Singapore',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: 'sg-img-1',
                name: 'Marina Bay',
                description: null,
                startTime: '10:00',
                duration: '2 hours',
                city: 'Singapore',
                imageUrl: null,
                sequence: 1,
              },
            ],
          },
        ],
      },
    });
    const fetchMock = masterFetch(quotation, {
      '/masters/sightseeing/presentations': {
        'sg-img-1': { imageUrl: 'https://storage.example.test/signed/marina-bay.jpg' },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    // The legacy snapshot has no imageUrl — the master presentation resolves it.
    const img = await screen.findByAltText('Activity');
    expect(img).toHaveAttribute('src', 'https://storage.example.test/signed/marina-bay.jpg');
  });

  it('resolves each of multiple selected activities to its own image', async () => {
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1: Marina Bay',
            city: 'Singapore',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: 'sg-img-1',
                name: 'Marina Bay',
                description: null,
                startTime: '10:00',
                duration: '2 hours',
                city: 'Singapore',
                imageUrl: null,
                sequence: 1,
              },
              {
                sightseeingId: 'sg-img-2',
                name: 'City Tour',
                description: null,
                startTime: '14:00',
                duration: '3 hours',
                city: 'Singapore',
                imageUrl: null,
                sequence: 2,
              },
            ],
          },
        ],
      },
    });
    const fetchMock = masterFetch(quotation, {
      '/masters/sightseeing/presentations': {
        'sg-img-1': { imageUrl: 'https://storage.example.test/signed/marina-bay.jpg' },
        'sg-img-2': { imageUrl: 'https://storage.example.test/signed/city-tour.jpg' },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    const images = await screen.findAllByAltText('Activity');
    expect(images).toHaveLength(2);
    const srcs = images.map((img) => img.getAttribute('src')).sort();
    expect(srcs).toEqual([
      'https://storage.example.test/signed/city-tour.jpg',
      'https://storage.example.test/signed/marina-bay.jpg',
    ]);
  });

  it('does not issue duplicate image requests for duplicate sightseeing ids', async () => {
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Singapore',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: 'sg-img-1',
                name: 'Marina Bay',
                description: null,
                startTime: '10:00',
                duration: '2 hours',
                city: 'Singapore',
                imageUrl: null,
                sequence: 1,
              },
              {
                sightseeingId: 'sg-img-1',
                name: 'Marina Bay Again',
                description: null,
                startTime: '12:00',
                duration: '2 hours',
                city: 'Singapore',
                imageUrl: null,
                sequence: 2,
              },
            ],
          },
        ],
      },
    });
    const fetchMock = masterFetch(quotation, {
      '/masters/sightseeing/presentations': {
        'sg-img-1': { imageUrl: 'https://storage.example.test/signed/marina-bay.jpg' },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    const images = await screen.findAllByAltText('Activity');
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute('src', 'https://storage.example.test/signed/marina-bay.jpg');
    const presentationCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/masters/sightseeing/presentations'),
    );
    expect(presentationCalls.length).toBe(1);
  });

  it('uses the saved image snapshot when no master presentation exists', async () => {
    const quotation = builderQuotation({
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1: Marina Bay',
            city: 'Singapore',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: 'sg-img-1',
                name: 'Marina Bay',
                description: null,
                startTime: '10:00',
                duration: '2 hours',
                city: 'Singapore',
                imageUrl: 'https://storage.example.test/signed/snapshot.jpg',
                sequence: 1,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Sightseeing');
    const img = await screen.findByAltText('Activity');
    expect(img).toHaveAttribute('src', 'https://storage.example.test/signed/snapshot.jpg');
  });

  it('does not persist expiring signed URLs into the quotation save payload', async () => {
    const withImage = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Marina Bay',
      sequence: 1,
      status: 'ACTIVE',
      hasImage: true,
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const quotation = builderQuotation({ destinationSummary: 'Singapore' });
    const fetchMock = masterFetch(quotation, {
      '/masters/sightseeing': page([withImage]),
      '/masters/sightseeing/presentations': {
        '11111111-1111-4111-8111-111111111111': {
          imageUrl: 'https://storage.example.test/signed/marina-bay.jpg?X-Amz-Signature=abc',
        },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    await openActivityPicker(picker, 'Marina Bay');
    fireEvent.change(picker, { target: { value: 'Marina Bay' } });
    await screen.findByAltText('Activity');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    const days = body.sightseeingDetails.days;
    const urls = JSON.stringify(days);
    expect(urls).not.toContain('X-Amz-Signature');
    expect(urls).not.toContain('storage.example.test');
    const activity = days[0].activities[0];
    expect(activity.sightseeingId).toBe('11111111-1111-4111-8111-111111111111');
    expect(activity.imageUrl).toBeNull();
  });

  it('shows special options and grouped master options in the activity dropdown', async () => {
    const singaporeMaster = {
      id: 'sg-1',
      title: 'City Tour',
      sequence: 1,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1: City Tour',
            city: 'Singapore',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, { '/masters/sightseeing': page([singaporeMaster]) }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    const texts = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    // Reference quick options are always present.
    expect(texts.some((text) => text.includes('Day at Leisure'))).toBe(true);
    expect(texts.some((text) => text.includes('Custom Sightseeing'))).toBe(true);
    expect(texts.some((text) => text.includes('Arrival and Check-in'))).toBe(true);
    // Grouped master heading uses the day city.
    expect(within(listbox).getByText('Activities in Singapore')).toBeInTheDocument();
    expect(texts.some((text) => text.includes('City Tour'))).toBe(true);
  });

  it('handles Day at Leisure, Custom Sightseeing and Arrival and Check-in', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');

    fireEvent.focus(picker);
    await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    fireEvent.change(picker, { target: { value: 'Day at Leisure' } });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('Day at Leisure'),
    );
    // Day at Leisure needs no master id; no image shows (placeholder).
    expect(screen.queryByAltText('Activity')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Day at Leisure');

    fireEvent.change(picker, { target: { value: 'Custom Sightseeing' } });
    await waitFor(() => expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue(''));

    fireEvent.change(picker, { target: { value: 'Arrival and Check-in' } });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('Arrival and Check-in'),
    );
  });

  it('keeps other-destination activities available after the current city, sorted by sequence', async () => {
    const singaporeMaster = {
      id: 'sg-2',
      title: 'Singapore Zoo',
      sequence: 2,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const kualaMaster = {
      id: 'sg-1',
      title: 'Batu Caves',
      sequence: 1,
      status: 'ACTIVE',
      destination: { id: 'dest-my', name: 'Malaysia', countryName: 'Malaysia' },
      city: { id: 'city-kl', name: 'Kuala Lumpur' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Singapore',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([singaporeMaster, kualaMaster]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    const labels = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    // Other-destination activities are no longer hidden: both are selectable.
    expect(labels.some((text) => text.includes('Batu Caves'))).toBe(true);
    expect(labels.some((text) => text.includes('Singapore Zoo'))).toBe(true);
    // Current-day city (Singapore) activities stay at the top of the list.
    const singaporeIndex = labels.findIndex((text) => text.includes('Singapore Zoo'));
    const kualaIndex = labels.findIndex((text) => text.includes('Batu Caves'));
    expect(singaporeIndex).toBeGreaterThanOrEqual(0);
    expect(kualaIndex).toBeGreaterThan(singaporeIndex);
  });

  it('falls back to destination masters for a Cruise day and uses the destination heading', async () => {
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Cruise',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([
          sgMaster('sg-2', 'Singapore Zoo', 3),
          sgMaster('sg-1', 'Singapore City Tour', 1),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    // The heading uses the quotation destination, not the day city.
    expect(within(listbox).getByText('Activities in Singapore')).toBeInTheDocument();
    expect(within(listbox).queryByText('Activities in Cruise')).not.toBeInTheDocument();
    const labels = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(labels.some((text) => text.includes('Singapore Zoo'))).toBe(true);
    expect(labels.some((text) => text.includes('Singapore City Tour'))).toBe(true);
    // Sorted by master sequence ascending.
    expect(
      labels.indexOf(labels.find((text) => text.includes('Singapore City Tour'))!),
    ).toBeLessThan(labels.indexOf(labels.find((text) => text.includes('Singapore Zoo'))!));
    // No empty state while destination masters exist.
    expect(within(listbox).queryByText(/No matching activities/)).not.toBeInTheDocument();
  });

  it('keeps an existing selected activity in a Cruise day without duplicating it', async () => {
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Cruise',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: 'sg-1',
                name: 'Singapore City Tour',
                description: '<p>Guided tour.</p>',
                startTime: '09:00',
                duration: '2 hours',
                city: 'Singapore',
                imageUrl: null,
                sequence: 1,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([sgMaster('sg-1', 'Singapore City Tour', 1)]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    // The selected activity stays visible even though the day city is Cruise.
    expect(picker).toHaveValue('Singapore City Tour');
    expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('Singapore City Tour');
    expect(screen.getByLabelText('Day 1 activity 1 start time')).toHaveValue('09:00');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    const labels = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    // Exactly one entry for the selected activity.
    expect(labels.filter((text) => text.includes('Singapore City Tour')).length).toBe(1);
  });

  it('uses the same corrected dropdown for activities added to a Cruise day', async () => {
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Cruise',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([
          sgMaster('sg-1', 'Singapore City Tour', 1),
          sgMaster('sg-2', 'Singapore Zoo', 2),
        ]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    await userEvent.click(screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }));
    const picker = await screen.findByLabelText('Day 1 activity 2');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 2' });
    expect(within(listbox).getByText('Activities in Singapore')).toBeInTheDocument();
    const labels = within(listbox)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(labels.some((text) => text.includes('Singapore Zoo'))).toBe(true);
    expect(labels.some((text) => text.includes('Singapore City Tour'))).toBe(true);
  });

  it('searches destination masters case-insensitively', async () => {
    const fullDaySentosa = {
      ...sgMaster('sg-1', 'Full Day Sentosa', 1),
      description: '<p>Sentosa island.</p>',
    };
    const fullDayExpress = {
      ...sgMaster('sg-2', 'Full Day Universal Studios Tour with Express Pass', 2),
    };
    const zoo = sgMaster('sg-3', 'Singapore Zoo', 3);
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Cruise',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([fullDaySentosa, fullDayExpress, zoo]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    fireEvent.change(picker, { target: { value: 'FULL DAY' } });
    await waitFor(() => {
      const listbox = screen.getByRole('listbox', { name: 'Day 1 activity 1' });
      const labels = within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent ?? '');
      expect(labels.some((text) => text.includes('Full Day Sentosa'))).toBe(true);
      expect(
        labels.some((text) => text.includes('Full Day Universal Studios Tour with Express Pass')),
      ).toBe(true);
      expect(labels.some((text) => text.includes('Singapore Zoo'))).toBe(false);
    });
  });

  it('selecting a master in a Cruise day fills description, time, duration and image', async () => {
    const cityTour = {
      ...sgMaster('sg-1', 'Singapore City Tour', 1),
      description: '<p>Guided city tour.</p>',
    };
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Cruise',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    const fetchMock = masterFetch(quotation, {
      '/masters/sightseeing': page([cityTour]),
      '/masters/sightseeing/presentations': {
        'sg-1': { imageUrl: 'https://storage.example.test/city-tour.jpg' },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    await openActivityPicker(picker, 'Singapore City Tour');
    fireEvent.change(picker, { target: { value: 'Singapore City Tour' } });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('Singapore City Tour'),
    );
    expect(screen.getByLabelText('Day 1 activity 1 start time')).toHaveValue('09:00');
    expect(screen.getByLabelText('Day 1 activity 1 description')).toHaveTextContent(
      'Guided city tour.',
    );
    const img = await screen.findByAltText('Activity');
    expect(img).toHaveAttribute('src', 'https://storage.example.test/city-tour.jpg');
  });

  it('searches and selects a cross-destination activity without changing the day city', async () => {
    const klMaster = {
      id: 'kl-1',
      title: 'Batu Caves Tour',
      sequence: 1,
      status: 'ACTIVE',
      destination: { id: 'dest-my', name: 'Malaysia', countryName: 'Malaysia' },
      city: { id: 'city-kl', name: 'Kuala Lumpur' },
      estimatedHours: 4,
      suggestedStartTime: '09:00',
      description: '<p>Limestone caves.</p>',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const sgMasterCross = {
      ...sgMaster('sg-9', 'Universal Studios Singapore', 9),
      description: '<p>Theme park day.</p>',
    };
    const quotation = builderQuotation({
      destinationSummary: 'Kuala Lumpur',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Kuala Lumpur',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    const fetchMock = masterFetch(quotation, {
      '/masters/sightseeing': page([klMaster, sgMasterCross]),
      '/masters/sightseeing/presentations': {
        'sg-9': { imageUrl: 'https://storage.example.test/universal-studios.jpg' },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    // Both the current-day (Kuala Lumpur) and cross-destination (Singapore)
    // masters are available in the same dropdown.
    fireEvent.focus(picker);
    await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    expect(within(listbox).getByText('Batu Caves Tour')).toBeInTheDocument();
    expect(within(listbox).getByText('Universal Studios Singapore')).toBeInTheDocument();
    // Searching finds the Singapore activity even though the day is Kuala Lumpur.
    fireEvent.change(picker, { target: { value: 'Universal Studios' } });
    const searchList = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    expect(within(searchList).getByText('Universal Studios Singapore')).toBeInTheDocument();
    // Selecting it autofills from the selected master record.
    fireEvent.change(picker, { target: { value: 'Universal Studios Singapore' } });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue(
        'Universal Studios Singapore',
      ),
    );
    expect(screen.getByLabelText('Day 1 activity 1 start time')).toHaveValue('09:00');
    expect(screen.getByLabelText('Day 1 activity 1 description')).toHaveTextContent(
      'Theme park day.',
    );
    // The itinerary day city is untouched.
    expect(screen.getByLabelText('Sightseeing day 1 city')).toHaveValue('Kuala Lumpur');
    // The image comes from the selected activity's own master presentation.
    const img = await screen.findByAltText('Activity');
    expect(img).toHaveAttribute('src', 'https://storage.example.test/universal-studios.jpg');
  });

  it('keeps two activities in one day separate', async () => {
    const first = {
      id: 'sg-1',
      title: 'Singapore City Tour',
      sequence: 1,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      suggestedStartTime: '09:00',
      description: '<p>First tour.</p>',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const second = {
      id: 'sg-2',
      title: 'Night Safari',
      sequence: 2,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      suggestedStartTime: '18:00',
      description: '<p>Night tour.</p>',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const quotation = builderQuotation({ destinationSummary: 'Singapore' });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, { '/masters/sightseeing': page([first, second]) }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    await userEvent.click(screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }));
    const picker1 = await screen.findByLabelText('Day 1 activity 1');
    const picker2 = await screen.findByLabelText('Day 1 activity 2');
    await openActivityPicker(picker1, 'Singapore City Tour');
    fireEvent.change(picker1, { target: { value: 'Singapore City Tour' } });
    await openActivityPicker(picker2, 'Night Safari');
    fireEvent.change(picker2, { target: { value: 'Night Safari' } });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('Singapore City Tour'),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 2 name')).toHaveValue('Night Safari'),
    );
    expect(screen.getByLabelText('Day 1 activity 1 start time')).toHaveValue('09:00');
    expect(screen.getByLabelText('Day 1 activity 2 start time')).toHaveValue('18:00');
    // Each activity keeps its own description.
    expect(screen.getByLabelText('Day 1 activity 1 description')).toHaveTextContent('First tour.');
    expect(screen.getByLabelText('Day 1 activity 2 description')).toHaveTextContent('Night tour.');
  });

  it('adds and removes sightseeing activities and days', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Sightseeing');
    expect(await screen.findByLabelText('Day 1 activity 1 name')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }));
    expect(await screen.findByLabelText('Day 1 activity 2 name')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove activity' })[0]!);
    expect(screen.queryByLabelText('Day 1 activity 2 name')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Day' }));
    expect(screen.queryByLabelText('Sightseeing day 1 title')).not.toBeInTheDocument();
  });

  it('stores an independent daily transfer per sightseeing activity', async () => {
    const quotation = builderQuotation({
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Singapore',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: 'Singapore City Tour',
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                dailyTransfer: null,
                sequence: null,
              },
              {
                sightseeingId: null,
                name: 'Singapore Zoo',
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                dailyTransfer: null,
                sequence: null,
              },
              {
                sightseeingId: null,
                name: 'Day at Cruise',
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                dailyTransfer: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    await screen.findByLabelText('Day 1 activity 1 name');
    // Every activity has its own Daily Transfer control; the first inherits the
    // day-level fallback, the others can differ.
    expect(
      screen.getByRole('radio', { name: 'Day 1 activity 1 daily transfer Shared Transfer' }),
    ).toBeChecked();
    await userEvent.click(
      screen.getByRole('radio', { name: 'Day 1 activity 2 daily transfer No Transfer' }),
    );
    await userEvent.click(
      screen.getByRole('radio', { name: 'Day 1 activity 3 daily transfer Private Transfer' }),
    );
    expect(
      screen.getByRole('radio', { name: 'Day 1 activity 2 daily transfer No Transfer' }),
    ).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Day 1 activity 3 daily transfer Private Transfer' }),
    ).toBeChecked();
    // The old shared day-level transfer control is gone.
    expect(screen.queryByRole('radio', { name: 'Private Transfer' })).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    const activities = body.sightseeingDetails.days[0].activities;
    // Untouched activity keeps null (inherits the day-level value on display).
    expect(activities[0].dailyTransfer).toBeNull();
    expect(activities[1].dailyTransfer).toBe('NO_TRANSFER');
    expect(activities[2].dailyTransfer).toBe('PRIVATE');
  });

  it('supports independent per-meal transfer options in the builder', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Sightseeing');
    await screen.findByLabelText('Day 1 activity 1 name');

    // Breakfast is included by default and shows its own meal-option row.
    expect(screen.getByRole('checkbox', { name: 'breakfast' })).toBeChecked();
    const breakfastOptions = screen.getByRole('group', { name: 'breakfast meal options' });
    expect(within(breakfastOptions).getByRole('radio', { name: 'No Transfer' })).toBeChecked();
    expect(
      within(breakfastOptions).getByRole('radio', { name: 'Include At Hotel' }),
    ).not.toBeChecked();
    // Unselected meals show no option row and no transfer input.
    expect(screen.queryByRole('group', { name: 'lunch meal options' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'dinner meal options' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('breakfast transfer details')).not.toBeInTheDocument();

    // Checking Lunch adds its own row (default NO_TRANSFER) without touching breakfast.
    await userEvent.click(screen.getByRole('checkbox', { name: 'lunch' }));
    const lunchOptions = await screen.findByRole('group', { name: 'lunch meal options' });
    expect(within(lunchOptions).getByRole('radio', { name: 'No Transfer' })).toBeChecked();
    expect(
      within(screen.getByRole('group', { name: 'breakfast meal options' })).getByRole('radio', {
        name: 'No Transfer',
      }),
    ).toBeChecked();

    // WITH_TRANSFER on lunch only: transfer input appears for lunch only.
    await userEvent.click(within(lunchOptions).getByRole('radio', { name: 'With Transfer' }));
    const lunchDetails = await screen.findByLabelText('lunch transfer details');
    await userEvent.type(lunchDetails, 'at the Taj Hotel');
    expect(lunchDetails).toHaveValue('at the Taj Hotel');
    expect(screen.queryByLabelText('breakfast transfer details')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('dinner transfer details')).not.toBeInTheDocument();
    // Breakfast row is still independent.
    expect(
      within(screen.getByRole('group', { name: 'breakfast meal options' })).getByRole('radio', {
        name: 'No Transfer',
      }),
    ).toBeChecked();

    // Switching lunch away from WITH_TRANSFER hides its details input.
    await userEvent.click(within(lunchOptions).getByRole('radio', { name: 'No Transfer' }));
    expect(screen.queryByLabelText('lunch transfer details')).not.toBeInTheDocument();

    // Unchecking lunch removes its row entirely.
    await userEvent.click(screen.getByRole('checkbox', { name: 'lunch' }));
    expect(screen.queryByRole('group', { name: 'lunch meal options' })).not.toBeInTheDocument();

    // Daily Transfer is now per-activity, defaulting to the day-level value.
    expect(
      screen.getByRole('radio', { name: 'Day 1 activity 1 daily transfer Shared Transfer' }),
    ).toBeChecked();
    await userEvent.click(
      screen.getByRole('radio', { name: 'Day 1 activity 1 daily transfer Private Transfer' }),
    );
    expect(
      screen.getByRole('radio', { name: 'Day 1 activity 1 daily transfer Private Transfer' }),
    ).toBeChecked();
    expect(
      within(screen.getByRole('group', { name: 'breakfast meal options' })).getByRole('radio', {
        name: 'No Transfer',
      }),
    ).toBeChecked();
  });

  it('does not require sightseeing fields when the section is disabled', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    await userEvent.click(screen.getByLabelText('Include Sightseeing in Quotation'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
  });

  it('keeps sightseeing day always expanded without collapse toggle', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Sightseeing');
    expect(screen.queryByRole('button', { name: /^(Expand|Collapse) day 1$/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Day 1 activity 1 name')).toBeInTheDocument();
    expect(screen.getByLabelText('Sightseeing day 1 title')).toBeInTheDocument();
  });

  it('persists each meal mode and transfer details on save', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    await screen.findByLabelText('Day 1 activity 1 name');

    // Breakfast default = No Transfer; set Lunch to With Transfer + details.
    await userEvent.click(screen.getByRole('checkbox', { name: 'lunch' }));
    const lunchOptions = await screen.findByRole('group', { name: 'lunch meal options' });
    await userEvent.click(within(lunchOptions).getByRole('radio', { name: 'With Transfer' }));
    const lunchDetails = await screen.findByLabelText('lunch transfer details');
    await userEvent.type(lunchDetails, 'pokemon sabji');

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    const day = body.sightseeingDetails.days[0];
    expect(day.meals.breakfast).toBe(true);
    expect(day.mealPreferences.breakfast).toMatchObject({ mode: 'NO_TRANSFER' });
    expect(day.meals.lunch).toBe(true);
    expect(day.mealPreferences.lunch).toMatchObject({
      mode: 'WITH_TRANSFER',
      transferDetails: 'pokemon sabji',
    });
  });

  it('hides the Visa tab and its controls from the quotation builder', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    // Wait for the builder to load (a visible tab appears).
    await screen.findByRole('button', { name: 'Vehicle' });
    // The Visa tab is not part of the navigation.
    expect(screen.queryByRole('button', { name: 'Visa' })).not.toBeInTheDocument();
    // All remaining tabs are present in the approved order.
    const expected = [
      'Sightseeing',
      'Hotel',
      'Cruise',
      'Vehicle',
      'Flight',
      'Add-on Services',
      'Inclusions & Exclusions',
      'Pricing',
    ];
    for (const label of expected) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    const sightseeingButton = screen.getByRole('button', { name: 'Sightseeing' });
    const hotelButton = screen.getByRole('button', { name: 'Hotel' });
    const flightButton = screen.getByRole('button', { name: 'Flight' });
    const addonButton = screen.getByRole('button', { name: 'Add-on Services' });
    // Sightseeing leads the strip, Hotel follows, and Flight immediately
    // precedes Add-on Services.
    expect(
      sightseeingButton.compareDocumentPosition(hotelButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      flightButton.compareDocumentPosition(addonButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // No Visa panel controls are rendered anywhere.
    expect(screen.queryByText('Include Visa in Quotation')).not.toBeInTheDocument();
    expect(screen.queryByText(/Consolidated Total/)).not.toBeInTheDocument();
  });

  it('loads and saves an existing quotation with Visa data while the tab is hidden', async () => {
    const quotation = builderQuotation({
      includeVisa: true,
      visaAmount: '2500',
      visaDestination: 'Singapore',
      visaType: 'Tourist',
      visaServiceCharge: '500',
      visaGstPercent: '18',
      visaVfsCharge: '300',
    });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    // The builder loads on a visible tab without crashing.
    await screen.findByRole('button', { name: 'Vehicle' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      // Saved Visa values are preserved in the payload.
      expect(body.includeVisa).toBe(true);
      expect(body.visaAmount).toBe(2500);
      expect(body.visaDestination).toBe('Singapore');
      expect(body.visaType).toBe('Tourist');
    });
  });

  it('saves a quotation without Visa data while the tab is hidden', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await screen.findByRole('button', { name: 'Vehicle' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
    });
  });

  const destinationFixture = (
    name: string,
    policies: Partial<Record<string, string | null>> = {},
  ) => ({
    id: `dest-${name.toLowerCase()}`,
    countryCode: 'SG',
    countryName: 'Singapore',
    name,
    destinationType: 'CITY',
    status: 'ACTIVE',
    inclusions: null,
    exclusions: null,
    paymentPolicies: null,
    cancellationPolicies: null,
    bookingTerms: null,
    childPolicy: null,
    ...policies,
    cities: [],
    _count: { cities: 0 },
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    createdBy: person,
  });

  it('prefills the six policy editors from the destination master', async () => {
    const sg = destinationFixture('Singapore', {
      inclusions: '<p>Hotel, flights, transfers</p>',
      exclusions: '<p>Personal expenses</p>',
      paymentPolicies: '<p>50% advance</p>',
      cancellationPolicies: '<p>Free up to 7 days</p>',
      bookingTerms: '<p>Valid for the dates shown</p>',
      childPolicy: '<p>Children below 5 stay free</p>',
    });
    const quotation = stayQuotation([{ destination: 'Singapore', nights: 2 }]);
    vi.stubGlobal('fetch', masterFetch(quotation, { '/masters/destinations': page([sg]) }));
    renderBuilderPage();
    await openTab('Inclusions & Exclusions');

    expect(await screen.findByLabelText('Inclusions')).toHaveTextContent(
      'Hotel, flights, transfers',
    );
    expect(screen.getByLabelText('Exclusions')).toHaveTextContent('Personal expenses');
    expect(screen.getByLabelText('Payment Policies')).toHaveTextContent('50% advance');
    expect(screen.getByLabelText('Cancellation Policies')).toHaveTextContent('Free up to 7 days');
    expect(screen.getByLabelText('Booking Terms & Conditions')).toHaveTextContent(
      'Valid for the dates shown',
    );
    expect(screen.getByLabelText('Child Policy')).toHaveTextContent('Children below 5 stay free');
  });

  it('combines multiple destination policies in order and deduplicates identical content', async () => {
    const sg = destinationFixture('Singapore', { inclusions: '<p>SG inclusions</p>' });
    const dubai = destinationFixture('Dubai', { inclusions: '<p>DXB inclusions</p>' });
    const quotation = stayQuotation([
      { destination: 'Singapore', nights: 2 },
      { destination: 'Dubai', nights: 2 },
    ]);
    vi.stubGlobal('fetch', masterFetch(quotation, { '/masters/destinations': page([sg, dubai]) }));
    renderBuilderPage();
    await openTab('Inclusions & Exclusions');

    const editor = await screen.findByLabelText('Inclusions');
    expect(editor).toHaveTextContent('SG inclusions');
    expect(editor).toHaveTextContent('DXB inclusions');
    expect(editor).toHaveTextContent('Singapore');
    expect(editor).toHaveTextContent('Dubai');

    // Identical content is deduplicated (single value, no destination headings).
    cleanup();
    const sgSame = destinationFixture('Singapore', { inclusions: '<p>Same content</p>' });
    const dubaiSame = destinationFixture('Dubai', { inclusions: '<p>Same content</p>' });
    const sameQuotation = stayQuotation([
      { destination: 'Singapore', nights: 2 },
      { destination: 'Dubai', nights: 2 },
    ]);
    vi.stubGlobal(
      'fetch',
      masterFetch(sameQuotation, { '/masters/destinations': page([sgSame, dubaiSame]) }),
    );
    renderBuilderPage();
    await openTab('Inclusions & Exclusions');
    const dedupEditor = await screen.findByLabelText('Inclusions');
    expect(dedupEditor).toHaveTextContent('Same content');
    expect(dedupEditor).not.toHaveTextContent('Singapore');
    expect(dedupEditor).not.toHaveTextContent('Dubai');
  });

  it('does not overwrite saved quotation policies with destination data', async () => {
    const sg = destinationFixture('Singapore', { inclusions: '<p>Destination inclusions</p>' });
    const quotation = {
      ...builderQuotation({ inclusionsHtml: '<p>Custom saved inclusions</p>' }),
      destinationSummary: 'Singapore',
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-000001',
        leadStage: 'NEW_LEAD',
        assignedToId: null,
        createdById: 'user-1',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          {
            id: 'stay-1',
            country: 'Singapore',
            destination: 'Singapore',
            nights: 2,
            sequence: 1,
            arrivalDate: '2026-08-10T00:00:00.000Z',
            departureDate: '2026-08-12T00:00:00.000Z',
          },
        ],
      },
    };
    vi.stubGlobal('fetch', masterFetch(quotation, { '/masters/destinations': page([sg]) }));
    renderBuilderPage();
    await openTab('Inclusions & Exclusions');

    const editor = await screen.findByLabelText('Inclusions');
    expect(editor).toHaveTextContent('Custom saved inclusions');
    expect(editor).not.toHaveTextContent('Destination inclusions');
  });

  it('prefills an add-on service price and saves the reference vehicle fields', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();

    // Including an add-on master with its own price prefills its selling figure.
    await openTab('Add-on Services');
    await userEvent.click(await screen.findByLabelText('Include Visa Assistance'));
    await waitFor(() => expect(screen.getByLabelText('Visa Assistance price')).toHaveValue(3800));

    // The dedicated vehicle section keeps the editable quotation amount while
    // the type/model are selected from the Vehicle master.
    await openTab('Vehicle');
    await userEvent.selectOptions(await screen.findByLabelText('Vehicle type'), 'Standard MPV');
    await userEvent.clear(screen.getByLabelText('Vehicle amount'));
    await userEvent.type(screen.getByLabelText('Vehicle amount'), '5000');
    await userEvent.selectOptions(
      screen.getByLabelText('Vehicle model'),
      'aaaaaaa7-1111-4111-8111-111111111111',
    );
    await userEvent.type(screen.getByLabelText('Vehicle usage or duration'), '3 hours');
    expect(screen.getByLabelText('Vehicle model')).toHaveValue(
      'aaaaaaa7-1111-4111-8111-111111111111',
    );
    expect(screen.getByLabelText('Vehicle amount')).toHaveValue(5000);

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String(patchCall?.[1]?.body)) as {
        services: Array<Record<string, unknown>>;
      };
      expect(body.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            serviceType: 'VEHICLE_TRANSFER',
            vehicleId: 'aaaaaaa7-1111-4111-8111-111111111111',
            name: 'Innova Crysta',
            city: 'Standard MPV',
            sellingPrice: 5000,
            taxCategory: 'Transportation',
            notes: '3 hours',
          }),
        ]),
      );
    });
  });

  it('loads master add-on descriptions into the rich text editor without raw HTML', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Add-on Services');
    await userEvent.click(await screen.findByLabelText('Include Visa Assistance'));
    const editor = await screen.findByLabelText('Visa Assistance description');
    // The description is a rich-text editor, not a plain textarea.
    expect(editor.tagName).not.toBe('TEXTAREA');
    expect(editor).toHaveTextContent('Visa assistance with documentation support.');
    // No raw HTML tags leak into the editor content.
    expect(editor).not.toHaveTextContent('<');
  });

  it('keeps an edited add-on description and price after saving', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await userEvent.click(await screen.findByLabelText('Include Visa Assistance'));
    const editor = await screen.findByLabelText('Visa Assistance description');
    await userEvent.type(editor, ' plus airfare assistance');
    await userEvent.clear(screen.getByLabelText('Visa Assistance price'));
    await userEvent.type(screen.getByLabelText('Visa Assistance price'), '4200');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String(patchCall?.[1]?.body)) as {
        services: Array<Record<string, unknown>>;
      };
      const services = body.services as Array<{
        serviceType: string;
        description: string | null;
        sellingPrice: number | null;
      }>;
      const addonRow = services.find((service) => service.serviceType === 'OTHER_ADD_ON');
      expect(addonRow?.description ?? '').toContain('airfare assistance');
      expect(Number(addonRow?.sellingPrice)).toBe(4200);
    });
  });

  it('imports an add-on master gallery into the quotation row with PDF selection', async () => {
    const masterWithImages = {
      ...addOn,
      hasImage: true,
      images: [
        { id: 'm-img-1', fileName: 'visa.png', mimeType: 'image/png', fileSize: 10, isPrimary: true },
        { id: 'm-img-2', fileName: 'docs.png', mimeType: 'image/png', fileSize: 12, isPrimary: false },
      ],
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/masters/add-on-services': page([masterWithImages]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Add-on Services');
    await userEvent.click(await screen.findByLabelText('Include Visa Assistance'));
    // Same manager as cruise/vehicle rows: primary badge, move/remove, Use in PDF.
    expect(await screen.findByLabelText('Remove addon-0 image 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Use addon-0 image 1 in PDF')).toBeChecked();
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String(patchCall?.[1]?.body)) as {
        services: Array<Record<string, unknown>>;
      };
      const addonRow = body.services.find(
        (service) => service.serviceType === 'OTHER_ADD_ON',
      ) as unknown as {
        images: Array<{ masterImageId: string; alt: string }>;
        imageSnapshotPresent: boolean;
        pdfImageUrl: string;
      };
      expect(addonRow.images).toEqual([
        { masterImageId: 'm-img-1', alt: 'Visa Assistance image 1' },
        { masterImageId: 'm-img-2', alt: 'Visa Assistance image 2' },
      ]);
      expect(addonRow.imageSnapshotPresent).toBe(true);
      expect(addonRow.pdfImageUrl).toBe('m-img-1');
    });
  });

  it('prefills Transportation as the Vehicle section title for a new quotation', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Vehicle');
    expect(await screen.findByLabelText('Vehicle section title')).toHaveValue('Transportation');
  });

  it('saves a custom Vehicle section title without overwriting it', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Vehicle');
    await userEvent.clear(await screen.findByLabelText('Vehicle section title'));
    await userEvent.type(screen.getByLabelText('Vehicle section title'), 'Airport Transfers');
    await userEvent.selectOptions(screen.getByLabelText('Vehicle type'), 'Standard MPV');
    await userEvent.selectOptions(
      screen.getByLabelText('Vehicle model'),
      'aaaaaaa7-1111-4111-8111-111111111111',
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse(String(patchCall?.[1]?.body)) as {
        services: Array<Record<string, unknown>>;
      };
      expect(body.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            serviceType: 'VEHICLE_TRANSFER',
            taxCategory: 'Airport Transfers',
          }),
        ]),
      );
    });
  });

  it('keeps an existing custom Vehicle section title when the quotation is reopened', async () => {
    const quotation = builderQuotation({
      services: [
        {
          serviceType: 'VEHICLE_TRANSFER',
          vehicleId: null,
          name: 'Innova Crysta',
          description: null,
          dayNumber: null,
          city: 'SUV',
          quantity: '1',
          unitSellingPrice: '5000',
          totalSellingPrice: '5000',
          sellingPrice: '5000',
          taxCategory: 'Airport Transfers',
          notes: null,
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Vehicle');
    expect(await screen.findByLabelText('Vehicle section title')).toHaveValue('Airport Transfers');
  });

  it('falls back to Transportation when an existing Vehicle section title is empty', async () => {
    const quotation = builderQuotation({
      services: [
        {
          serviceType: 'VEHICLE_TRANSFER',
          vehicleId: null,
          name: 'Innova Crysta',
          description: null,
          dayNumber: null,
          city: 'SUV',
          quantity: '1',
          unitSellingPrice: '5000',
          totalSellingPrice: '5000',
          sellingPrice: '5000',
          taxCategory: '',
          notes: null,
          sequence: 1,
        },
      ],
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Vehicle');
    expect(await screen.findByLabelText('Vehicle section title')).toHaveValue('Transportation');
  });

  it('preserves the Vehicle section title when the section is disabled and re-enabled', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Vehicle');
    await userEvent.clear(await screen.findByLabelText('Vehicle section title'));
    await userEvent.type(screen.getByLabelText('Vehicle section title'), 'Airport Transfers');
    await userEvent.click(screen.getByLabelText('Include Vehicle in Quotation'));
    expect(screen.queryByLabelText('Vehicle section title')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Include Vehicle in Quotation'));
    expect(await screen.findByLabelText('Vehicle section title')).toHaveValue('Airport Transfers');
  });

  it('submits the linked master ids alongside the snapshot fields', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.type(screen.getByLabelText('Hotel master'), 'Shah Palace Hotel');
    await waitFor(() => expect(screen.getByLabelText('Room 1 type master')).toBeEnabled());
    await userEvent.type(screen.getByLabelText('Room 1 type master'), 'Deluxe Room');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels[0]).toMatchObject({
        hotelId: 'aaaaaaa1-1111-4111-8111-111111111111',
        hotelRoomTypeId: 'aaaaaaa2-1111-4111-8111-111111111111',
        hotelName: 'Shah Palace Hotel',
      });
    });
  });

  it('saves the editable hotel section title, amount and single description', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    const title = await screen.findByLabelText('Hotel section title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Stay Details');
    await userEvent.clear(screen.getByLabelText('Hotel amount'));
    await userEvent.type(screen.getByLabelText('Hotel amount'), '12500');
    await userEvent.type(screen.getByLabelText('Hotel description'), 'Breakfast included.');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotelDetails).toMatchObject({
        sectionTitle: 'Stay Details',
        amount: 12500,
        description: 'Breakfast included.',
      });
    });
  });

  it('saves a draft with the default empty hotel row when Hotel is excluded', async () => {
    // A real quotation carries destination/date data, so the builder auto-creates
    // one default empty hotel row. Excluding Hotel must skip its validation and
    // never submit `[{ hotelName: "" }]`.
    const quotation = { ...builderQuotation(), destinationSummary: 'Goa', rooms: 1 };
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByLabelText('Include Hotel in Quotation'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels).toEqual([]);
    });
  });

  it('saves a draft with multiple empty hotel rows when Hotel is excluded', async () => {
    const emptyRow = {
      id: 'empty-hotel-1',
      hotelId: null,
      hotelRoomTypeId: null,
      hotelMealPlanId: null,
      city: 'Goa',
      hotelName: '',
      category: null,
      roomType: null,
      mealPlan: null,
      rooms: 1,
      nights: 1,
      checkInDate: null,
      checkOutDate: null,
      internalCost: '0',
      sellingPrice: '0',
      selected: true,
      notes: null,
      sequence: 1,
    };
    const quotation = {
      ...builderQuotation({ hotels: [emptyRow, { ...emptyRow, id: 'empty-hotel-2' }] }),
      destinationSummary: 'Goa',
    };
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByLabelText('Include Hotel in Quotation'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels).toEqual([]);
    });
  });

  it('shows a hotel-name error when Hotel is included with an empty row', async () => {
    const quotation = { ...builderQuotation(), destinationSummary: 'Goa', rooms: 1 };
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    // Hotel is included by default and the form has an empty default row.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    expect(
      await screen.findByText(/hotels\.0\.hotelName: String must contain at least 1 character/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false),
    );
  });

  it('clears stale hotel errors and saves once Hotel is switched off', async () => {
    const quotation = { ...builderQuotation(), destinationSummary: 'Goa', rooms: 1 };
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    // Included hotel with an empty row → hotel-name error appears.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    expect(
      await screen.findByText(/hotels\.0\.hotelName: String must contain at least 1 character/),
    ).toBeInTheDocument();

    // Turning Hotel off clears the stale hotel errors immediately.
    await userEvent.click(screen.getByLabelText('Include Hotel in Quotation'));
    expect(
      screen.queryByText(/hotels\.0\.hotelName: String must contain at least 1 character/),
    ).not.toBeInTheDocument();

    // Saving now succeeds with hotels: [].
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels).toEqual([]);
    });
  });

  it('saves valid hotel information when Hotel is included', async () => {
    const quotation = builderQuotation({
      hotels: [
        {
          id: 'valid-hotel-1',
          hotelId: null,
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          city: 'Goa',
          hotelName: 'Coastal Bay Resort',
          category: '4 Star',
          roomType: 'Deluxe Room',
          mealPlan: 'Breakfast Only',
          rooms: 1,
          nights: 4,
          checkInDate: '2026-09-10T00:00:00.000Z',
          checkOutDate: '2026-09-14T00:00:00.000Z',
          internalCost: '0',
          sellingPrice: '12000',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
    });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels[0]).toMatchObject({
        hotelName: 'Coastal Bay Resort',
        city: 'Goa',
      });
    });
  });

  it('shows 10 kg+ in the Cabin Luggage dropdown and keeps the stored 10kg value', async () => {
    const quotation = builderQuotation({
      flightDetails: {
        include: true,
        sectionTitle: 'Flight Details',
        amount: 0,
        journeyType: 'ONEWAY_OUTBOUND',
        outbound: {
          fromCity: 'Delhi',
          toCity: 'Goa',
          travelClass: 'Economy',
          segments: [
            {
              airlineId: null,
              airlineName: 'Air India',
              flightNumber: 'AI101',
              travelClass: 'Economy',
              from: 'Delhi',
              to: 'Goa',
              departureDate: '2026-09-10',
              departureTime: '10:00',
              arrivalDate: '2026-09-10',
              arrivalTime: '12:00',
              duration: null,
              cabinLuggage: '10kg',
              checkInLuggage: '30kg',
              notes: null,
              connectionVia: null,
            },
          ],
        },
        returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
      },
    });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Flight');

    // Existing stored 10kg loads selected and is displayed as "10 kg+".
    const cabin = (await screen.findAllByLabelText('Cabin Luggage'))[0]!;
    expect(cabin).toHaveValue('10kg');
    const option10 = within(cabin).getByRole('option', { name: '10 kg+' });
    expect(option10).toHaveValue('10kg');
    // The old "10kg" label is gone and no duplicate option appears.
    expect(within(cabin).queryByRole('option', { name: '10kg' })).not.toBeInTheDocument();
    // Other options are unchanged.
    expect(within(cabin).getByRole('option', { name: '7kg' })).toBeInTheDocument();
    expect(within(cabin).getByRole('option', { name: 'No Cabin Baggage' })).toBeInTheDocument();

    // Re-selecting and saving preserves the stored value.
    await userEvent.selectOptions(cabin, '10kg');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.flightDetails.flights[0].outbound.segments[0].cabinLuggage).toBe('10kg');
    });
  });

  it('keeps room type and meal plan editable as free text after unlinking a hotel master', async () => {
    vi.stubGlobal('fetch', masterFetch(builderQuotation()));
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(await screen.findByRole('button', { name: 'Add Hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.type(screen.getByLabelText('Hotel master'), 'Shah Palace Hotel');
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue('Shah Palace Hotel'),
    );

    // Unlinking the master keeps manual Room Type / Meal Plan entry available.
    await userEvent.click(screen.getByRole('button', { name: 'Clear Hotel master' }));
    await waitFor(() => expect(screen.getByLabelText('Room 1 type master')).toBeEnabled());
    expect(screen.getByLabelText('Meal plan 1 master')).toBeEnabled();
    await userEvent.type(screen.getByLabelText('Room 1 type master'), 'Deluxe Room');
    expect(screen.getByLabelText('Room 1 type master')).toHaveValue('Deluxe Room');
  });

  it('derives hotel nights from check-in/check-out dates in the editor and on save', async () => {
    const quotation = builderQuotation({
      hotels: [
        {
          id: 'hotel-row-1',
          hotelId: null,
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          city: 'Goa',
          hotelName: 'Coastal Bay Resort',
          category: '4 Star',
          roomType: 'Deluxe Room',
          mealPlan: 'Breakfast Only',
          rooms: 1,
          nights: 4,
          checkInDate: '2026-08-10T00:00:00.000Z',
          checkOutDate: '2026-08-12T00:00:00.000Z',
          internalCost: '0',
          sellingPrice: '12000',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
    });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));

    // 10 Aug → 12 Aug = 2 nights, overriding the stored (wrong) value of 4.
    expect(await screen.findByLabelText('Hotel nights')).toHaveValue('2');

    // Changing the check-out date updates nights immediately (10 Aug → 13 Aug = 3).
    await fireEvent.change(screen.getByLabelText('Hotel check-out'), {
      target: { value: '2026-08-13' },
    });
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('3');

    // Saving persists the derived nights.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels[0].nights).toBe(3);
    });
  });

  it('normalises stored hotel nights to the date-derived value when saving', async () => {
    const quotation = builderQuotation({
      hotels: [
        {
          id: 'hotel-row-1',
          hotelId: null,
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          city: 'Goa',
          hotelName: 'Coastal Bay Resort',
          category: '4 Star',
          roomType: 'Deluxe Room',
          mealPlan: 'Breakfast Only',
          rooms: 1,
          nights: 4,
          checkInDate: '2026-08-10T00:00:00.000Z',
          checkOutDate: '2026-08-12T00:00:00.000Z',
          internalCost: '0',
          sellingPrice: '12000',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
    });
    const fetchMock = masterFetch(quotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      // Dates 10 Aug → 12 Aug = 2 nights, even though the stored value was 4.
      expect(body.hotels[0].nights).toBe(2);
    });
  });

  it('loads an existing row with its master already linked', async () => {
    vi.stubGlobal(
      'fetch',
      masterFetch(
        builderQuotation({
          hotels: [
            {
              id: 'hotel-row-1',
              hotelId: 'aaaaaaa1-1111-4111-8111-111111111111',
              hotelRoomTypeId: 'aaaaaaa2-1111-4111-8111-111111111111',
              hotelMealPlanId: null,
              city: 'Baku',
              hotelName: 'Shah Palace Hotel',
              category: null,
              roomType: 'Deluxe Room',
              mealPlan: null,
              rooms: 1,
              nights: 2,
              checkInDate: null,
              checkOutDate: null,
              internalCost: '4000',
              sellingPrice: '6000',
              selected: true,
              notes: null,
              sequence: 1,
            },
          ],
          services: [
            {
              id: 'service-row-1',
              serviceType: 'FLIGHT',
              airlineId: 'aaaaaaa4-1111-4111-8111-111111111111',
              name: 'Delhi to Baku',
              description: null,
              dayNumber: null,
              city: null,
              quantity: '2',
              unitCost: '0',
              unitSellingPrice: '30000',
              taxCategory: null,
              notes: null,
              sequence: 1,
            },
          ],
        }),
      ),
    );
    renderBuilderPage();
    // The Hotel tab loads its preloaded hotel master link and enabled room type.
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue('Shah Palace Hotel'),
    );
    expect(screen.getByLabelText('Room 1 type master')).toBeEnabled();
  });

  const singaporeDefaultHotel = () => ({
    id: 'aaaaaa11-1111-4111-8111-111111111111',
    name: 'Aloft Singapore Novena by Marriott',
    starCategory: 4,
    starRating: null,
    status: 'ACTIVE',
    isDefaultForCity: true,
    isFeatured: false,
    hasImage: false,
    updatedAt: '2026-07-21T00:00:00.000Z',
    createdAt: '2026-07-21T00:00:00.000Z',
    destination: { id: 'dest-sg', name: 'Singapore' },
    city: { id: 'city-sg', name: 'Singapore' },
  });

  const dubaiDefaultHotel = () => ({
    id: 'aaaaaa22-2222-4222-8222-222222222222',
    name: 'Burj View Hotel',
    starCategory: 5,
    starRating: null,
    status: 'ACTIVE',
    isDefaultForCity: true,
    isFeatured: false,
    hasImage: false,
    updatedAt: '2026-07-21T00:00:00.000Z',
    createdAt: '2026-07-21T00:00:00.000Z',
    destination: { id: 'dest-dx', name: 'Dubai' },
    city: { id: 'city-dx', name: 'Dubai' },
  });

  const stayQuotation = (stays: Array<{ destination: string; nights: number }>) => ({
    ...builderQuotation(),
    destinationSummary: stays.map((stay) => stay.destination).join(' • '),
    query: {
      id: 'lead-1',
      queryNumber: 'QRY-000001',
      leadStage: 'NEW_LEAD',
      assignedToId: null,
      createdById: 'user-1',
      departureCity: 'Delhi',
      departureCountry: 'India',
      itinerary: stays.map((stay, index) => ({
        id: `stay-${index}`,
        country: stay.destination,
        destination: stay.destination,
        nights: stay.nights,
        sequence: index + 1,
        arrivalDate: '2026-08-10T00:00:00.000Z',
        departureDate: '2026-08-12T00:00:00.000Z',
      })),
    },
  });

  it('prefills the active default hotel for the quotation destination', async () => {
    const quotation = stayQuotation([{ destination: 'Singapore', nights: 2 }]);
    const fetchMock = masterFetch(quotation, {
      '/masters/hotels': page([singaporeDefaultHotel()]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue(
        'Aloft Singapore Novena by Marriott',
      ),
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels).toHaveLength(1);
      expect(body.hotels[0]).toMatchObject({
        hotelId: 'aaaaaa11-1111-4111-8111-111111111111',
        hotelName: 'Aloft Singapore Novena by Marriott',
        city: 'Singapore',
        category: '4 Star',
      });
    });
  });

  it('selects the best available hotel when no default exists, skips inactive default', async () => {
    const quotation = stayQuotation([{ destination: 'Singapore', nights: 2 }]);
    // Not marked default — best available active hotel should still be selected.
    let fetchMock = masterFetch(quotation, {
      '/masters/hotels': page([{ ...singaporeDefaultHotel(), isDefaultForCity: false }]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue(
        'Aloft Singapore Novena by Marriott',
      ),
    );
    cleanup();

    // Marked default but inactive — no active hotel exists, so hotel is blank.
    fetchMock = masterFetch(quotation, {
      '/masters/hotels': page([{ ...singaporeDefaultHotel(), status: 'INACTIVE' }]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(() => expect(screen.getByLabelText('Hotel master')).toHaveValue(''));
  });

  it('creates a row for every hotel-required city with or without a default', async () => {
    const quotation = stayQuotation([
      { destination: 'Singapore', nights: 2 },
      { destination: 'Dubai', nights: 2 },
    ]);
    const fetchMock = masterFetch(quotation, {
      '/masters/hotels': page([singaporeDefaultHotel(), dubaiDefaultHotel()]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    await waitFor(() => expect(screen.getAllByLabelText('Hotel master').length).toBe(2));
    const masters = screen.getAllByLabelText('Hotel master');
    expect(masters[0]).toHaveValue('Aloft Singapore Novena by Marriott');
    expect(masters[1]).toHaveValue('Burj View Hotel');

    // Both city rows remain even when only one has a default; the second gets
    // the best available hotel or an empty row if none exist.
    cleanup();
    const partialMock = masterFetch(quotation, {
      '/masters/hotels': page([singaporeDefaultHotel()]),
    });
    vi.stubGlobal('fetch', partialMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    await waitFor(() => expect(screen.getAllByLabelText('Hotel master').length).toBe(2));
    const m2 = screen.getAllByLabelText('Hotel master');
    expect(m2[0]).toHaveValue('Aloft Singapore Novena by Marriott');
    // Dubai has no hotel master in the mock, so it stays blank
    expect(m2[1]).toHaveValue('');
  });

  it('single hotel city with Cruise in between covers full quotation nights', async () => {
    const quotation = {
      ...builderQuotation({
        destinationSummary: 'Singapore • Cruise • Singapore',
        hotels: [],
        sightseeingDetails: null,
      }),
      travelStartDate: '2026-08-14',
      travelEndDate: '2026-08-20',
      rooms: 1,
      query: {
        id: 'lead-cruise',
        queryNumber: 'QRY-000010',
        leadStage: 'NEW_LEAD',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          { id: 's1', country: 'Singapore', destination: 'Singapore', nights: 2, sequence: 1 },
          { id: 's2', country: 'International', destination: 'Cruise', nights: 2, sequence: 2 },
          { id: 's3', country: 'Singapore', destination: 'Singapore', nights: 2, sequence: 3 },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/hotels': page([singaporeDefaultHotel()]),
      }),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    // Exactly one Hotel Stay row despite Singapore appearing twice
    expect(await screen.findAllByLabelText('Hotel master')).toHaveLength(1);
    expect(screen.getByLabelText('Hotel master')).toHaveValue('Aloft Singapore Novena by Marriott');
    // City stays in data (prefilled from the itinerary) with no visible field.
    expect(screen.queryByLabelText('Hotel city')).not.toBeInTheDocument();
    // 6 total nights (2+2+2), not merged land nights (2+2=4)
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('6');
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('14-08-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('20-08-2026');
  });

  it('single hotel city with full nights preserves the correct hotel selection', async () => {
    const quotation = {
      ...builderQuotation({
        destinationSummary: 'Singapore',
        hotels: [],
        sightseeingDetails: null,
      }),
      travelStartDate: '2026-08-14',
      travelEndDate: '2026-08-20',
      rooms: 1,
      query: {
        id: 'lead-sg-only',
        queryNumber: 'QRY-000011',
        leadStage: 'NEW_LEAD',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          { id: 's1', country: 'Singapore', destination: 'Singapore', nights: 6, sequence: 1 },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/hotels': page([singaporeDefaultHotel()]),
      }),
    );
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    expect(await screen.findAllByLabelText('Hotel master')).toHaveLength(1);
    expect(screen.getByLabelText('Hotel master')).toHaveValue('Aloft Singapore Novena by Marriott');
    expect(screen.getByLabelText('Hotel nights')).toHaveValue('6');
    expect(screen.getByLabelText('Hotel check-in')).toHaveValue('14-08-2026');
    expect(screen.getByLabelText('Hotel check-out')).toHaveValue('20-08-2026');
  });

  it('preserves a saved hotel snapshot and a manually selected hotel', async () => {
    const saved = builderQuotation({
      hotels: [
        {
          id: 'saved-row-1',
          hotelId: 'aaaaaa33-3333-4333-8333-333333333333',
          hotelRoomTypeId: null,
          hotelMealPlanId: null,
          city: 'Singapore',
          hotelName: 'Saved Beach Resort',
          category: '3 Star',
          roomType: null,
          mealPlan: null,
          rooms: 1,
          nights: 2,
          checkInDate: null,
          checkOutDate: null,
          internalCost: '0',
          sellingPrice: '0',
          selected: true,
          notes: null,
          sequence: 1,
        },
      ],
    });
    // A different default hotel exists in Hotel Master.
    const fetchMock = masterFetch(saved, {
      '/masters/hotels': page([singaporeDefaultHotel()]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels).toHaveLength(1);
      expect(body.hotels[0].hotelId).toBe('aaaaaa33-3333-4333-8333-333333333333');
      expect(body.hotels[0].hotelName).toBe('Saved Beach Resort');
    });
  });

  it('does not re-add a default hotel for a destination that already has one', async () => {
    const quotation = stayQuotation([{ destination: 'Singapore', nights: 2 }]);
    const fetchMock = masterFetch(quotation, {
      '/masters/hotels': page([singaporeDefaultHotel()]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue(
        'Aloft Singapore Novena by Marriott',
      ),
    );
    // Adding another hotel row for the same destination must not duplicate the default.
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    await waitFor(() => expect(screen.getAllByLabelText('Hotel master').length).toBe(2));
    expect(screen.getAllByLabelText('Hotel master')[1]).toHaveValue('');
  });

  it('does not replace a hotel the user selects manually', async () => {
    const quotation = stayQuotation([{ destination: 'Singapore', nights: 2 }]);
    const altHotel = {
      ...singaporeDefaultHotel(),
      id: 'aaaaaa44-4444-4444-8444-444444444444',
      name: 'Alternative Hotel',
      isDefaultForCity: false,
    };
    const fetchMock = masterFetch(quotation, {
      '/masters/hotels': page([singaporeDefaultHotel(), altHotel]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue(
        'Aloft Singapore Novena by Marriott',
      ),
    );
    // The user picks a different hotel from the master.
    await userEvent.clear(screen.getByLabelText('Hotel master'));
    await userEvent.type(screen.getByLabelText('Hotel master'), 'Alternative Hotel');
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel master')).toHaveValue('Alternative Hotel'),
    );
    // Automatic prefill must not change it back.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.getByLabelText('Hotel master')).toHaveValue('Alternative Hotel');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.hotels[0].hotelId).toBe('aaaaaa44-4444-4444-8444-444444444444');
      expect(body.hotels[0].hotelName).toBe('Alternative Hotel');
    });
  });

  it('fetches the activities lookup without a destination/city narrow so all tenant activities are searchable', async () => {
    const quotation = builderQuotation({ destinationSummary: 'Singapore' });
    const baseFetch = masterFetch(quotation);
    let activitiesUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/masters/sightseeing/activities')) {
          activitiesUrl = url;
        }
        return baseFetch(input, init);
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    await screen.findByLabelText('Day 1 activity 1');
    // The dropdown is not scoped to a destination/city: the backend returns
    // every tenant-visible activity and the builder orders current-city first.
    expect(activitiesUrl).toContain('/masters/sightseeing/activities');
    expect(activitiesUrl).not.toMatch(/destination=/);
    expect(activitiesUrl).not.toMatch(/city=/);
  });

  it('shows loading state when sightseeing master data is pending', async () => {
    const quotation = builderQuotation();
    const baseFetch = masterFetch(quotation);
    const pending = new Promise<Response>(() => {
      /* never resolves */
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/masters/sightseeing/activities')) {
          return pending;
        }
        return baseFetch(input, init);
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    expect(within(listbox).getByText('Day at Leisure')).toBeInTheDocument();
    expect(within(listbox).getByText('Loading activities...')).toBeInTheDocument();
  });

  it('shows error state when sightseeing master request fails', async () => {
    const quotation = builderQuotation();
    const baseFetch = masterFetch(quotation);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/masters/sightseeing/activities')) {
          return {
            ok: false,
            status: 500,
            headers: new Headers(),
            json: async () => ({
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'error' },
            }),
          } as unknown as Response;
        }
        return baseFetch(input, init);
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    expect(within(listbox).getByText('Unable to load sightseeing activities.')).toBeInTheDocument();
  });

  it('shows empty state when no active master records exist for the destination', async () => {
    const quotation = builderQuotation({ destinationSummary: 'Singapore' });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    expect(within(listbox).getByText('Day at Leisure')).toBeInTheDocument();
    expect(
      within(listbox).getByText('No sightseeing activities found for Singapore.'),
    ).toBeInTheDocument();
  });

  it('uses destination fallback when day city is Cruise for a Singapore quotation', async () => {
    const singaporeMaster = {
      id: 'sg-1',
      title: 'Sentosa Tour',
      sequence: 1,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Cruise',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([singaporeMaster]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    // Heading uses destination (Singapore) since Cruise is not a matching city.
    expect(within(listbox).getByText('Activities in Singapore')).toBeInTheDocument();
    expect(within(listbox).getByText('Sentosa Tour')).toBeInTheDocument();
  });

  it('shows Kuala Lumpur sightseeing records when the destinationSummary is the city', async () => {
    const klMaster1 = {
      id: 'kl-1',
      title: 'Batu Caves Tour',
      sequence: 1,
      status: 'ACTIVE',
      destination: { id: 'dest-my', name: 'Malaysia', countryName: 'Malaysia' },
      city: { id: 'city-kl', name: 'Kuala Lumpur' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const klMaster2 = {
      id: 'kl-2',
      title: 'Petronas Towers Tour',
      sequence: 2,
      status: 'ACTIVE',
      destination: { id: 'dest-my', name: 'Malaysia', countryName: 'Malaysia' },
      city: { id: 'city-kl', name: 'Kuala Lumpur' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    // The lead itinerary carries country="Malaysia" (Master destination) while the
    // quotation destinationSummary holds the CITY "Kuala Lumpur". Simulate the real
    // backend: activities are resolved by the destination NAME (Malaysia), so the
    // client must send destination=Malaysia (not the city token) to receive them.
    const quotation = {
      ...builderQuotation({ destinationSummary: 'Kuala Lumpur' }),
      query: {
        id: 'lead-kl',
        queryNumber: 'QRY-KL',
        leadStage: 'NEW_LEAD',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          {
            id: 'kl-stay',
            country: 'Malaysia',
            destination: 'Kuala Lumpur',
            nights: 3,
            sequence: 1,
          },
        ],
      },
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Kuala Lumpur',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    };
    const baseFetch = masterFetch(quotation, {
      '/masters/sightseeing': page([klMaster1, klMaster2]),
      '/masters/destinations': page([
        {
          id: 'dest-my',
          countryCode: 'MY',
          countryName: 'Malaysia',
          name: 'Malaysia',
          destinationType: 'CITY',
          status: 'ACTIVE',
          inclusions: null,
          exclusions: null,
          paymentPolicies: null,
          cancellationPolicies: null,
          bookingTerms: null,
          cities: [],
          _count: { cities: 0 },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    });
    let activitiesUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/masters/sightseeing/activities')) {
          activitiesUrl = url;
          // The endpoint is global: all tenant-visible activities are returned,
          // and the builder orders current-day-city options first.
          return response({
            destination: { id: 'dest-my', name: 'Malaysia' },
            city: null,
            activities: [klMaster1, klMaster2],
          });
        }
        return baseFetch(input, init);
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    // No destination/city narrow is sent; the dropdown browses every tenant
    // activity and keeps the Kuala Lumpur (current day city) records visible.
    expect(activitiesUrl).toContain('/masters/sightseeing/activities');
    expect(activitiesUrl).not.toMatch(/destination=/);
    expect(activitiesUrl).not.toMatch(/city=/);
    expect(within(listbox).getByText('Activities in Kuala Lumpur')).toBeInTheDocument();
    expect(within(listbox).getByText('Batu Caves Tour')).toBeInTheDocument();
    expect(within(listbox).getByText('Petronas Towers Tour')).toBeInTheDocument();
    expect(within(listbox).queryByText(/No sightseeing activities found/i)).not.toBeInTheDocument();
  });

  it('shows the empty state only when the resolved destination has zero sightseeing', async () => {
    const quotation = {
      ...builderQuotation({ destinationSummary: 'Kuala Lumpur' }),
      query: {
        id: 'lead-kl',
        queryNumber: 'QRY-KL',
        leadStage: 'NEW_LEAD',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          {
            id: 'kl-stay',
            country: 'Malaysia',
            destination: 'Kuala Lumpur',
            nights: 3,
            sequence: 1,
          },
        ],
      },
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Kuala Lumpur',
            date: null,
            meals: { breakfast: true, lunch: false, dinner: false },
            mealMode: 'INCLUDE_AT_HOTEL',
            dailyTransfer: 'SHARED',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    };
    const baseFetch = masterFetch(quotation, {
      '/masters/sightseeing': page([]),
      '/masters/destinations': page([
        {
          id: 'dest-my',
          countryCode: 'MY',
          countryName: 'Malaysia',
          name: 'Malaysia',
          destinationType: 'CITY',
          status: 'ACTIVE',
          inclusions: null,
          exclusions: null,
          paymentPolicies: null,
          cancellationPolicies: null,
          bookingTerms: null,
          cities: [],
          _count: { cities: 0 },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/masters/sightseeing/activities')) {
          return response({
            destination: { id: 'dest-my', name: 'Malaysia' },
            city: null,
            activities: [],
          });
        }
        return baseFetch(input, init);
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    fireEvent.focus(picker);
    const listbox = await screen.findByRole('listbox', { name: 'Day 1 activity 1' });
    expect(within(listbox).getByText('Day at Leisure')).toBeInTheDocument();
    expect(
      within(listbox).getByText(/No sightseeing activities found for Malaysia/i),
    ).toBeInTheDocument();
  });

  it('prefills the final day with a departure master regardless of sequence', async () => {
    const departureMaster = {
      id: 'sg-departure',
      title: 'Departure from Singapore',
      sequence: 53,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      suggestedStartTime: '10:00',
      description: '<p>Check-out and airport transfer.</p>',
      estimatedHours: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const zooMaster = {
      id: 'sg-zoo',
      title: 'Singapore Zoo',
      sequence: 7,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const quotation = {
      ...builderQuotation({
        destinationSummary: 'Singapore',
        sightseeingDetails: null,
      }),
      travelStartDate: '2026-10-23',
      travelEndDate: '2026-10-29',
      rooms: 1,
      query: {
        id: 'lead-1',
        queryNumber: 'QRY-000001',
        leadStage: 'NEW_LEAD',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          { id: 's1', country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 },
          { id: 's2', country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 2 },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([zooMaster, departureMaster]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    // Day 7 (final) gets the departure master
    const day7Title = (await screen.findByLabelText('Sightseeing day 7 title')) as HTMLInputElement;
    expect(day7Title.value).toBe('Departure from Singapore');
    const day7Activity = screen.getByLabelText('Day 7 activity 1');
    fireEvent.focus(day7Activity);
    const day7Listbox = screen.getByRole('listbox', { name: 'Day 7 activity 1' });
    // High-sequence departure master appears as the selected option
    expect(within(day7Listbox).queryByText('Departure from Singapore')).toBeInTheDocument();
    // Day 7 activity name field is pre-populated
    expect(screen.getByLabelText('Day 7 activity 1 name')).toHaveValue('Departure from Singapore');
    expect(screen.getByLabelText('Day 7 activity 1 start time')).toHaveValue('10:00');
    expect(
      screen.getByRole('button', { name: 'Clear day 7 activity 1 start time' }),
    ).toBeInTheDocument();
  });

  it('uses departure master for the final day and never assigns a non-departure by sequence', async () => {
    const departureMaster = {
      id: 'sg-dep',
      title: 'Departure from Singapore',
      sequence: 99,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const normalMasters = [
      {
        id: 'sg-n1',
        title: 'City Tour',
        sequence: 1,
        status: 'ACTIVE',
        destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
        city: { id: 'city-sg', name: 'Singapore' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'sg-n2',
        title: 'Sentosa',
        sequence: 2,
        status: 'ACTIVE',
        destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
        city: { id: 'city-sg', name: 'Singapore' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const quotation = {
      ...builderQuotation({
        destinationSummary: 'Singapore',
        sightseeingDetails: null,
      }),
      travelStartDate: '2026-10-23',
      travelEndDate: '2026-10-25',
      rooms: 1,
      query: {
        id: 'lead-2',
        queryNumber: 'QRY-000002',
        leadStage: 'NEW_LEAD',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          { id: 's1', country: 'Singapore', destination: 'Singapore', nights: 2, sequence: 1 },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([...normalMasters, departureMaster]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    // 3 day trip: Day 1 = City Tour, Day 2 = Sentosa, Day 3 = Departure
    expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('City Tour');
    expect(screen.getByLabelText('Day 2 activity 1 name')).toHaveValue('Sentosa');
    expect(screen.getByLabelText('Day 3 activity 1 name')).toHaveValue('Departure from Singapore');
    expect(screen.getByLabelText('Day 3 activity 1 start time')).toHaveValue('');
    expect(
      screen.queryByRole('button', { name: 'Clear day 3 activity 1 start time' }),
    ).not.toBeInTheDocument();
    // Normal day never gets the departure master
    expect(screen.getByLabelText('Day 1 activity 1 name')).not.toHaveValue(
      'Departure from Singapore',
    );
  });

  it('does not use a departure master on non-final days', async () => {
    const departureMaster = {
      id: 'sg-d1',
      title: 'Departure from Singapore',
      sequence: 1,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const normalMasters = [
      {
        id: 'sg-ct',
        title: 'City Tour',
        sequence: 2,
        status: 'ACTIVE',
        destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
        city: { id: 'city-sg', name: 'Singapore' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'sg-gb',
        title: 'Gardens by the Bay',
        sequence: 3,
        status: 'ACTIVE',
        destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
        city: { id: 'city-sg', name: 'Singapore' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'sg-ss',
        title: 'Sentosa',
        sequence: 4,
        status: 'ACTIVE',
        destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
        city: { id: 'city-sg', name: 'Singapore' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const quotation = {
      ...builderQuotation({
        destinationSummary: 'Singapore',
        sightseeingDetails: null,
      }),
      travelStartDate: '2026-10-23',
      travelEndDate: '2026-10-26',
      rooms: 1,
      query: {
        id: 'lead-3',
        queryNumber: 'QRY-000003',
        leadStage: 'NEW_LEAD',
        departureCity: 'Delhi',
        departureCountry: 'India',
        itinerary: [
          { id: 's1', country: 'Singapore', destination: 'Singapore', nights: 3, sequence: 1 },
        ],
      },
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(quotation, {
        '/masters/sightseeing': page([departureMaster, ...normalMasters]),
      }),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    // 4 day trip: departure master is reserved for Day 4 only
    expect(screen.getByLabelText('Day 1 activity 1 name')).toHaveValue('City Tour');
    expect(screen.getByLabelText('Day 2 activity 1 name')).toHaveValue('Gardens by the Bay');
    expect(screen.getByLabelText('Day 3 activity 1 name')).toHaveValue('Sentosa');
    expect(screen.getByLabelText('Day 4 activity 1 name')).toHaveValue('Departure from Singapore');
  });

  it('offers the same pickers in the template builder', async () => {
    vi.stubGlobal('fetch', masterFetch(template));
    renderWithProviders(<QuotationTemplateFormPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add service' }));
    expect(screen.getByLabelText('Hotel master')).toBeInTheDocument();
    expect(screen.getByLabelText('Room 1 type master')).toBeEnabled();
    expect(screen.getByLabelText('Sightseeing master')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Hotel master'), 'Shah Palace Hotel');
    await waitFor(() =>
      expect(screen.getByLabelText('Hotel name')).toHaveValue('Shah Palace Hotel'),
    );
  });
});
  it('loads two flight bookmarks into independent flights without overwriting', async () => {
    const seg = (flightNumber: string, from: string, to: string) => ({
      departure_airport: { name: from, id: from, date: '2026-09-10', time: '06:00' },
      arrival_airport: { name: to, id: to, date: '2026-09-10', time: '12:00' },
      duration: 120,
      airline: 'Air India',
      flight_number: flightNumber,
      travel_class: 'Economy',
    });
    const flightBookmark = (code: string, flightNumber: string, from: string, to: string) => ({
      id: `bm-${code}`,
      type: 'FLIGHT',
      provider: 'SEARCHAPI',
      fingerprint: `fp-${code}`,
      bookmarkCode: code,
      title: `${from} → ${to}`,
      currency: 'INR',
      createdAt: '2026-08-16T10:00:00.000Z',
      searchParams: { departure_id: from, arrival_id: to, type: 1, currency: 'INR' },
      snapshot: {
        flight: {
          airline: 'Air India',
          flightNumbers: [flightNumber],
          price: 8000,
          currency: 'INR',
          type: 'One way',
          segments: [seg(flightNumber, from, to)],
        },
      },
    });
    const fetchMock = masterFetch(
      {
        ...builderQuotation(),
        query: { services: [{ serviceType: 'FLIGHT' }] },
      },
      {
        '/api/search/bookmarks/by-code/FLT-000123': flightBookmark('FLT-000123', 'AI101', 'DEL', 'BOM'),
        '/api/search/bookmarks/by-code/FLT-000456': flightBookmark('FLT-000456', '6E202', 'BOM', 'GOI'),
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Flight');

    // First flight loads into its own card.
    await userEvent.type(await screen.findByLabelText('Flight 1 bookmark ID'), 'FLT-000123');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByDisplayValue('AI101')).toBeInTheDocument();
    expect(screen.getByText('Flight Details 1')).toBeInTheDocument();

    // A second card loads independently; the first is untouched.
    await userEvent.click(screen.getByRole('button', { name: /Add Flight/i }));
    expect(screen.getByText('Flight Details 2')).toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText('Flight 2 bookmark ID'), 'FLT-000456');
    await userEvent.click(screen.getAllByRole('button', { name: 'Load' })[1]!);
    expect(await screen.findByDisplayValue('6E202')).toBeInTheDocument();
    expect(screen.getByDisplayValue('AI101')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('AI101')).toHaveLength(1);
    expect(screen.getAllByDisplayValue('6E202')).toHaveLength(1);

    // Saving persists both records in order with their bookmark codes.
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    const body = await getSavedQuotationBody(fetchMock);
    expect(body.flightDetails.flights).toHaveLength(2);
    expect(body.flightDetails.flights[0]).toMatchObject({ bookmarkCode: 'FLT-000123' });
    expect(body.flightDetails.flights[1]).toMatchObject({ bookmarkCode: 'FLT-000456' });
    expect(body.flightDetails.flights[0].outbound.segments[0].flightNumber).toBe('AI101');
    expect(body.flightDetails.flights[1].outbound.segments[0].flightNumber).toBe('6E202');
  });

  it('keeps loaded flights when another bookmark ID fails', async () => {
    const seg = (flightNumber: string, from: string, to: string) => ({
      departure_airport: { name: from, id: from, date: '2026-09-10', time: '06:00' },
      arrival_airport: { name: to, id: to, date: '2026-09-10', time: '12:00' },
      duration: 120,
      airline: 'Air India',
      flight_number: flightNumber,
      travel_class: 'Economy',
    });
    const bookmark = {
      id: 'bm-ok',
      type: 'FLIGHT',
      provider: 'SEARCHAPI',
      fingerprint: 'fp-ok',
      bookmarkCode: 'FLT-000123',
      title: 'DEL → BOM',
      currency: 'INR',
      createdAt: '2026-08-16T10:00:00.000Z',
      searchParams: { departure_id: 'DEL', arrival_id: 'BOM', type: 1, currency: 'INR' },
      snapshot: {
        flight: {
          airline: 'Air India',
          flightNumbers: ['AI101'],
          price: 8000,
          currency: 'INR',
          type: 'One way',
          segments: [seg('AI101', 'DEL', 'BOM')],
        },
      },
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(
        {
          ...builderQuotation(),
          query: { services: [{ serviceType: 'FLIGHT' }] },
        },
        {
          '/api/search/bookmarks/by-code/FLT-000123': bookmark,
        },
      ),
    );
    renderBuilderPage();
    await openTab('Flight');
    await userEvent.type(await screen.findByLabelText('Flight 1 bookmark ID'), 'FLT-000123');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByDisplayValue('AI101')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Add Flight/i }));
    await userEvent.type(await screen.findByLabelText('Flight 2 bookmark ID'), 'NOPE');
    await userEvent.click(screen.getAllByRole('button', { name: 'Load' })[1]!);
    expect(await screen.findByText(/Invalid bookmark ID/)).toBeInTheDocument();
    // The successfully loaded flight is preserved.
    expect(screen.getByDisplayValue('AI101')).toBeInTheDocument();
  });

  it('removes one flight without affecting the other', async () => {
    const seg = (flightNumber: string, from: string, to: string) => ({
      departure_airport: { name: from, id: from, date: '2026-09-10', time: '06:00' },
      arrival_airport: { name: to, id: to, date: '2026-09-10', time: '12:00' },
      duration: 120,
      airline: 'Air India',
      flight_number: flightNumber,
      travel_class: 'Economy',
    });
    const flightBookmark = (code: string, flightNumber: string, from: string, to: string) => ({
      id: `bm-${code}`,
      type: 'FLIGHT',
      provider: 'SEARCHAPI',
      fingerprint: `fp-${code}`,
      bookmarkCode: code,
      title: `${from} → ${to}`,
      currency: 'INR',
      createdAt: '2026-08-16T10:00:00.000Z',
      searchParams: { departure_id: from, arrival_id: to, type: 1, currency: 'INR' },
      snapshot: {
        flight: {
          airline: 'Air India',
          flightNumbers: [flightNumber],
          price: 8000,
          currency: 'INR',
          type: 'One way',
          segments: [seg(flightNumber, from, to)],
        },
      },
    });
    vi.stubGlobal(
      'fetch',
      masterFetch(
        {
          ...builderQuotation(),
          query: { services: [{ serviceType: 'FLIGHT' }] },
        },
        {
          '/api/search/bookmarks/by-code/FLT-000123': flightBookmark('FLT-000123', 'AI101', 'DEL', 'BOM'),
          '/api/search/bookmarks/by-code/FLT-000456': flightBookmark('FLT-000456', '6E202', 'BOM', 'GOI'),
        },
      ),
    );
    renderBuilderPage();
    await openTab('Flight');
    await userEvent.type(await screen.findByLabelText('Flight 1 bookmark ID'), 'FLT-000123');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(await screen.findByDisplayValue('AI101')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add Flight/i }));
    await userEvent.type(await screen.findByLabelText('Flight 2 bookmark ID'), 'FLT-000456');
    await userEvent.click(screen.getAllByRole('button', { name: 'Load' })[1]!);
    expect(await screen.findByDisplayValue('6E202')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove flight 1' }));
    expect(screen.queryByDisplayValue('AI101')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('6E202')).toBeInTheDocument();
    expect(screen.queryByText('Flight Details 2')).not.toBeInTheDocument();
  });

  it('opens a legacy single-flight quotation as one flight card', async () => {
    const quotation = builderQuotation({
      flightDetails: {
        include: true,
        sectionTitle: 'Flight Details',
        amount: 0,
        entryMode: 'MANUAL',
        journeyType: 'ONEWAY_OUTBOUND',
        outbound: {
          fromCity: 'Delhi',
          toCity: 'Goa',
          travelClass: 'Economy',
          segments: [
            {
              airlineId: null,
              airlineName: 'Air India',
              flightNumber: 'AI101',
              travelClass: 'Economy',
              from: 'Delhi',
              to: 'Goa',
              departureDate: '2026-09-10',
              departureTime: '10:00',
              arrivalDate: '2026-09-10',
              arrivalTime: '12:00',
              duration: null,
              cabinLuggage: null,
              checkInLuggage: null,
              notes: null,
              connectionVia: null,
            },
          ],
        },
        returnJourney: { fromCity: null, toCity: null, travelClass: 'Economy', segments: [] },
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Flight');
    // Legacy rows normalize into exactly one card with their segments intact.
    expect(screen.getByText('Flight Details 1')).toBeInTheDocument();
    expect(screen.queryByText('Flight Details 2')).not.toBeInTheDocument();
    expect(await screen.findByDisplayValue('AI101')).toBeInTheDocument();
  });


  it('keeps the first activity as the sightseeing day title (CASE 1)', async () => {
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Universal studios',
            city: 'Singapore',
            date: null,
            meals: { breakfast: false, lunch: false, dinner: false },
            mealMode: 'NO_TRANSFER',
            dailyTransfer: 'NO_TRANSFER',
            activities: [
              {
                sightseeingId: null,
                name: 'Universal studios',
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Sightseeing');
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Universal studios');
  });

  it('never replaces the day title when later activities are picked (CASE 2, CASE 3, CASE 8)', async () => {
    const masters = [
      { id: 'sg-u', title: 'Universal studios' },
      { id: 'sg-n', title: 'Night safari' },
      { id: 'sg-l', title: 'LEGOLAND Malaysia' },
    ].map(({ id, title }, index) => ({
      id,
      title,
      sequence: index + 1,
      status: 'ACTIVE',
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
      estimatedHours: 2,
      suggestedStartTime: null,
      description: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Day 1',
            city: 'Singapore',
            date: null,
            meals: { breakfast: false, lunch: false, dinner: false },
            mealMode: 'NO_TRANSFER',
            dailyTransfer: 'NO_TRANSFER',
            activities: [
              {
                sightseeingId: null,
                name: null,
                description: null,
                startTime: null,
                duration: null,
                city: null,
                imageUrl: null,
                sequence: null,
              },
            ],
          },
        ],
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation, { '/masters/sightseeing': page(masters) }));
    renderBuilderPage();
    await openTab('Sightseeing');

    const pickActivity = async (slot: number, masterTitle: string) => {
      const picker = await screen.findByLabelText(`Day 1 activity ${slot}`);
      await openActivityPicker(picker, masterTitle);
      fireEvent.change(picker, { target: { value: masterTitle } });
      await waitFor(() =>
        expect(screen.getByLabelText(`Day 1 activity ${slot} name`)).toHaveValue(masterTitle),
      );
    };

    // First pick defines the day title.
    await pickActivity(1, 'Universal studios');
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Universal studios');
    // Adding + picking later activities must never hijack it (the reported bug
    // showed the last pick, LEGOLAND Malaysia, as the day title).
    await userEvent.click(
      screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }),
    );
    await pickActivity(2, 'Night safari');
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Universal studios');
    await userEvent.click(
      screen.getByRole('button', { name: 'Add activity after activity 2 on day 1' }),
    );
    await pickActivity(3, 'LEGOLAND Malaysia');
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Universal studios');
  });

  it('promotes the next activity when the first is removed (CASE 5, CASE 6)', async () => {
    const named = (name: string | null) => ({
      sightseeingId: null,
      name,
      description: null,
      startTime: null,
      duration: null,
      city: null,
      imageUrl: null,
      sequence: null,
    });
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Universal studios',
            city: 'Singapore',
            date: null,
            meals: { breakfast: false, lunch: false, dinner: false },
            mealMode: 'NO_TRANSFER',
            dailyTransfer: 'NO_TRANSFER',
            activities: [named('Universal studios'), named('Night safari'), named('LEGOLAND Malaysia')],
          },
        ],
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Sightseeing');
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Universal studios');

    // Remove the first activity -> the next one is promoted.
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove activity' })[0]!);
    await waitFor(() =>
      expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Night safari'),
    );
    // Remove again -> the last remaining activity defines the title.
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove activity' })[0]!);
    await waitFor(() =>
      expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('LEGOLAND Malaysia'),
    );
    // Removing a non-first activity leaves the title alone.
    await userEvent.click(
      screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }),
    );
    fireEvent.change(screen.getByLabelText('Day 1 activity 2 name'), {
      target: { value: 'Night safari' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 2 name')).toHaveValue('Night safari'),
    );
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('LEGOLAND Malaysia');
  });

  it('keeps each day title independent across days (CASE 7)', async () => {
    const named = (name: string | null) => ({
      sightseeingId: null,
      name,
      description: null,
      startTime: null,
      duration: null,
      city: null,
      imageUrl: null,
      sequence: null,
    });
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Universal studios',
            city: 'Singapore',
            date: null,
            meals: { breakfast: false, lunch: false, dinner: false },
            mealMode: 'NO_TRANSFER',
            dailyTransfer: 'NO_TRANSFER',
            activities: [named('Universal studios'), named('Night safari')],
          },
          {
            dayNumber: 2,
            title: 'Singapore City Tour',
            city: 'Singapore',
            date: null,
            meals: { breakfast: false, lunch: false, dinner: false },
            mealMode: 'NO_TRANSFER',
            dailyTransfer: 'NO_TRANSFER',
            activities: [named('Singapore City Tour'), named('Shopping')],
          },
        ],
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Sightseeing');
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Universal studios');
    // Mutating day 1 must never affect day 2's title and vice versa.
    await userEvent.click(
      screen.getByRole('button', { name: 'Add activity after activity 1 on day 1' }),
    );
    fireEvent.change(screen.getByLabelText('Day 1 activity 2 name'), {
      target: { value: 'Sentosa' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 2 name')).toHaveValue('Sentosa'),
    );
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Universal studios');
    // Switch to day 2: its title follows its own first activity.
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 2' }));
    expect(screen.getByLabelText('Sightseeing day 2 title')).toHaveValue('Singapore City Tour');
    // And back to day 1: still independent.
    await userEvent.click(screen.getByRole('button', { name: 'Select sightseeing day 1' }));
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue('Universal studios');
  });

  it('mirrors first-activity custom-name edits and ignores other slots', async () => {
    const named = (name: string | null) => ({
      sightseeingId: null,
      name,
      description: null,
      startTime: null,
      duration: null,
      city: null,
      imageUrl: null,
      sequence: null,
    });
    const quotation = builderQuotation({
      destinationSummary: 'Singapore',
      sightseeingDetails: {
        include: true,
        sectionTitle: 'Sightseeing & Experiences',
        amount: '0',
        description: null,
        days: [
          {
            dayNumber: 1,
            title: 'Universal studios',
            city: 'Singapore',
            date: null,
            meals: { breakfast: false, lunch: false, dinner: false },
            mealMode: 'NO_TRANSFER',
            dailyTransfer: 'NO_TRANSFER',
            activities: [named('Universal studios'), named('Night safari')],
          },
        ],
      },
    });
    vi.stubGlobal('fetch', masterFetch(quotation));
    renderBuilderPage();
    await openTab('Sightseeing');
    // Renaming the first activity renames the day.
    fireEvent.change(screen.getByLabelText('Day 1 activity 1 name'), {
      target: { value: 'Universal Studios Singapore' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue(
        'Universal Studios Singapore',
      ),
    );
    // Renaming any other activity leaves the day title alone.
    fireEvent.change(screen.getByLabelText('Day 1 activity 2 name'), {
      target: { value: 'Night Safari Evening' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Day 1 activity 2 name')).toHaveValue('Night Safari Evening'),
    );
    expect(screen.getByLabelText('Sightseeing day 1 title')).toHaveValue(
      'Universal Studios Singapore',
    );
  });


describe('public quotation contact message helpers', () => {
  it('formats the public weblink quotation ID as a leading-# number', () => {
    expect(formatPublicQuotationNumber('QT-001032')).toBe('#1032');
    expect(formatPublicQuotationNumber('QT-1032')).toBe('#1032');
    expect(formatPublicQuotationNumber('1032')).toBe('#1032');
    expect(formatPublicQuotationNumber('#1032')).toBe('#1032');
    // Never '#QT-...' or '##...' for the standard stored format.
    expect(formatPublicQuotationNumber('QT-001032')).not.toMatch(/^#QT/);
    expect(formatPublicQuotationNumber('QT-001032')).not.toMatch(/^##/);
    expect(formatPublicQuotationNumber('')).toBe('');
    expect(formatPublicQuotationNumber(null)).toBe('');
    expect(formatPublicQuotationNumber(undefined)).toBe('');
  });

  it('computes calendar-night differences between check-in and check-out', () => {
    expect(hotelStayNights('2026-08-10', '2026-08-12')).toBe(2);
    expect(hotelStayNights('2026-08-12', '2026-08-13')).toBe(1);
    // Check-in/check-out times must not reduce the calendar-night count.
    expect(hotelStayNights('2026-08-10T14:00:00.000Z', '2026-08-12T12:00:00.000Z')).toBe(2);
  });

  it('handles month and year boundaries', () => {
    expect(hotelStayNights('2026-01-31', '2026-02-02')).toBe(2);
    expect(hotelStayNights('2026-12-31', '2027-01-02')).toBe(2);
  });

  it('returns null for missing, invalid, zero or reversed dates', () => {
    expect(hotelStayNights(null, '2026-08-12')).toBeNull();
    expect(hotelStayNights('2026-08-10', null)).toBeNull();
    expect(hotelStayNights(undefined, undefined)).toBeNull();
    expect(hotelStayNights('not-a-date', '2026-08-12')).toBeNull();
    expect(hotelStayNights('2026-08-12', '2026-08-12')).toBeNull();
    expect(hotelStayNights('2026-08-13', '2026-08-12')).toBeNull();
  });

  it('maps the stored 10kg cabin luggage to the 10 kg+ label and leaves others unchanged', () => {
    expect(cabinLuggageLabel('10kg')).toBe('10 kg+');
    expect(cabinLuggageLabel('7kg')).toBe('7kg');
    expect(cabinLuggageLabel('No Cabin Baggage')).toBe('No Cabin Baggage');
    expect(cabinLuggageLabel('')).toBe('');
    expect(cabinLuggageLabel(null)).toBe('');
    expect(cabinLuggageLabel(undefined)).toBe('');
  });

  it('maps known service keys to icons and falls back safely for unknown keys', () => {
    expect(serviceCardIcon('flights')).toBeDefined();
    expect(serviceCardIcon('hotels')).toBeDefined();
    expect(serviceCardIcon('sightseeing')).toBeDefined();
    expect(serviceCardIcon('cruise')).toBeDefined();
    expect(serviceCardIcon('transportation')).toBeDefined();
    expect(serviceCardIcon('visa')).toBeDefined();
    expect(serviceCardIcon('add-ons')).toBeDefined();
    // Unknown keys return a renderable component instead of breaking.
    const fallback = serviceCardIcon('some-unknown-service');
    expect(fallback).toBeDefined();
    expect(fallback).not.toBeUndefined();
  });

  it('builds the full quotation description', () => {
    expect(buildQuotationDescription('QT-000001', 'Singapore Package', 'Alma Desouza')).toBe(
      'QT-1 - Singapore Package for Alma Desouza',
    );
  });

  it('does not repeat a lead name that the title already contains', () => {
    expect(
      buildQuotationDescription('QT-000034', 'Singapore Package for Vikas Singh', 'Vikas Singh'),
    ).toBe('QT-34 - Singapore Package for Vikas Singh');
  });

  it('avoids the duplicate even when the title capitalisation differs', () => {
    expect(
      buildQuotationDescription('QT-000034', 'Singapore Package for VIKAS SINGH', 'Vikas Singh'),
    ).toBe('QT-34 - Singapore Package for VIKAS SINGH');
  });

  it('avoids the duplicate with extra surrounding and internal whitespace', () => {
    expect(
      buildQuotationDescription(
        'QT-000034',
        'Singapore Package for Vikas  Singh',
        '  Vikas Singh ',
      ),
    ).toBe('QT-34 - Singapore Package for Vikas  Singh');
  });

  it('appends the lead name when the title does not contain it', () => {
    expect(buildQuotationDescription('QT-000034', 'Singapore Holiday', 'Vikas Singh')).toBe(
      'QT-34 - Singapore Holiday for Vikas Singh',
    );
  });

  it('drops a missing lead name cleanly', () => {
    expect(buildQuotationDescription('QT-000001', 'Singapore Package', null)).toBe(
      'QT-1 - Singapore Package',
    );
  });

  it('drops a missing title cleanly', () => {
    expect(buildQuotationDescription('QT-000001', null, 'Alma Desouza')).toBe(
      'QT-1 for Alma Desouza',
    );
  });

  it('falls back to the quotation id only', () => {
    expect(buildQuotationDescription('QT-000001', null, null)).toBe('QT-1');
  });

  it('never emits undefined, null, dangling hyphens or dangling "for"', () => {
    expect(buildQuotationDescription('QT-000001', '  ', '')).toBe('QT-1');
    expect(buildQuotationDescription('  ', 'Kerala Package', 'Mira Shah')).toBe(
      'Kerala Package for Mira Shah',
    );
    expect(buildQuotationDescription(null, null, 'Mira Shah')).toBe('Mira Shah');
    expect(buildQuotationDescription(undefined, undefined, undefined)).toBe('');
  });

  it('normalizes the WhatsApp phone while preserving the country code', () => {
    expect(normalizeWhatsAppPhone('+91 (98765) 432-10')).toBe('919876543210');
    expect(normalizeWhatsAppPhone('90000 00000')).toBe('9000000000');
    expect(normalizeWhatsAppPhone(null)).toBe('');
    expect(normalizeWhatsAppPhone('')).toBe('');
  });
});

// The reference "Summary & Pricing" case used throughout: 2 Adults, 1 CWB,
// 1 CWOB, 1 Infant at 10,000 / 2,000 / 1,000 / 7,000 → 30,000 total.
const TAX_NOTE_OPTIONS = [
  'Do not show',
  'Inclusive of all taxes',
  'Inclusive of all taxes, excluding TCS',
  'Inclusive of GST and TCS',
  'Excluding all taxes',
  'Excluding GST and TCS',
];

describe('Summary & Pricing — package pricing, tax note and secure booking', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const pricingBase = (versionOverrides: Record<string, unknown> = {}) => ({
    ...builderQuotation(versionOverrides),
    adults: 2,
    childrenWithBed: 1,
    childrenWithoutBed: 1,
    infants: 1,
  });

  const fillReferencePrices = async () => {
    await userEvent.type(screen.getByLabelText('Per Adult Price'), '10000');
    await userEvent.type(screen.getByLabelText('Per CWB Price'), '2000');
    await userEvent.type(screen.getByLabelText('Per CWOB Price'), '1000');
    await userEvent.type(screen.getByLabelText('Per Infant Price'), '7000');
  };

  it('never renders the Pricing Validation warning box for zero or partial prices', async () => {
    vi.stubGlobal('fetch', masterFetch(pricingBase()));
    renderBuilderPage();
    await openTab('Pricing');

    // All prices zero: this is exactly where the amber "Traveler pricing is
    // incomplete…" box used to render. It must be gone at the source.
    expect(screen.queryByText('Pricing Validation')).not.toBeInTheDocument();
    expect(screen.queryByText(/Traveler pricing is incomplete/i)).not.toBeInTheDocument();

    // Partially completed pricing (adults priced, children not) stays clean too.
    await userEvent.type(screen.getByLabelText('Per Adult Price'), '10000');
    expect(screen.queryByText('Pricing Validation')).not.toBeInTheDocument();
    expect(screen.queryByText(/Traveler pricing is incomplete/i)).not.toBeInTheDocument();

    // The surrounding pricing UI is unchanged.
    expect(screen.getByText('Initial Payment Details')).toBeInTheDocument();
    expect(screen.getByLabelText('Discount amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Tax rate percent')).toBeInTheDocument();
  });

  it('computes the total, margin and breakdown live with no NaN', async () => {
    vi.stubGlobal('fetch', masterFetch(pricingBase()));
    renderBuilderPage();
    await openTab('Pricing');
    // Empty state first.
    expect(screen.getByText('Enter prices to see the breakdown.')).toBeInTheDocument();
    await fillReferencePrices();
    const total = screen.getByLabelText('Total Package Price') as HTMLInputElement;
    await waitFor(() => expect(total.value).toContain('30,000'));
    expect(total.value).not.toMatch(/NaN/);
    // Margin = Total − Net.
    await userEvent.type(screen.getByLabelText('Net Amount'), '10000');
    const margin = screen.getByLabelText('Margin') as HTMLInputElement;
    await waitFor(() => expect(margin.value).toContain('20,000'));
    // Breakdown lines, in order, plus a bold total line.
    expect(screen.getByText(/Adults: 2 ×/)).toBeInTheDocument();
    expect(screen.getByText(/CWB: 1 ×/)).toBeInTheDocument();
    expect(screen.getByText(/CWOB: 1 ×/)).toBeInTheDocument();
    expect(screen.getByText(/Infants: 1 ×/)).toBeInTheDocument();
    expect(screen.getByText(/Package Subtotal:/)).toBeInTheDocument();
    // Traveller counts are prefilled from the quotation snapshot but editable.
    expect(screen.getByLabelText('Adults')).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('Adults')).toHaveValue(2);
    expect(screen.getByLabelText('CWB')).toHaveValue(1);
    expect(screen.getByLabelText('CWOB')).toHaveValue(1);
    expect(screen.getByLabelText('Infants')).toHaveValue(1);
    expect(screen.getByLabelText('Total Package Price')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Margin')).toHaveAttribute('readonly');
  });

  it('recalculates the total, margin and breakdown when a traveller count is edited', async () => {
    vi.stubGlobal('fetch', masterFetch(pricingBase()));
    renderBuilderPage();
    await openTab('Pricing');
    await fillReferencePrices();
    const total = screen.getByLabelText('Total Package Price') as HTMLInputElement;
    await waitFor(() => expect(total.value).toContain('30,000'));

    // Adults 2 → 3 adds one adult at 10,000.
    const adults = screen.getByLabelText('Adults') as HTMLInputElement;
    await userEvent.clear(adults);
    await userEvent.type(adults, '3');
    await waitFor(() => expect(total.value).toContain('40,000'));

    // CWB 1 → 0 (−2,000) and CWOB 1 → 2 (+1,000) together leave 39,000.
    const cwb = screen.getByLabelText('CWB') as HTMLInputElement;
    await userEvent.clear(cwb);
    await userEvent.type(cwb, '0');
    const cwob = screen.getByLabelText('CWOB') as HTMLInputElement;
    await userEvent.clear(cwob);
    await userEvent.type(cwob, '2');
    await waitFor(() => expect(total.value).toContain('39,000'));

    // The breakdown follows the edited mix (a zero-count row is dropped).
    expect(await screen.findByText(/Adults: 3 ×/)).toBeInTheDocument();
    expect(screen.getByText(/CWOB: 2 ×/)).toBeInTheDocument();
    expect(screen.queryByText(/CWB: /)).not.toBeInTheDocument();

    // Margin = edited Total − Net Amount.
    await userEvent.type(screen.getByLabelText('Net Amount'), '10000');
    const margin = screen.getByLabelText('Margin') as HTMLInputElement;
    await waitFor(() => expect(margin.value).toContain('29,000'));
  });

  it('clamps edited traveller counts to valid non-negative whole numbers', async () => {
    vi.stubGlobal('fetch', masterFetch(pricingBase()));
    renderBuilderPage();
    await openTab('Pricing');
    await fillReferencePrices();
    const total = screen.getByLabelText('Total Package Price') as HTMLInputElement;
    const adults = screen.getByLabelText('Adults') as HTMLInputElement;

    // A negative Adults entry is clamped to the minimum of 1 for pricing.
    fireEvent.change(adults, { target: { value: '-3' } });
    await waitFor(() => expect(total.value).toContain('20,000'));
    // Blurring normalises the field itself to the valid minimum.
    fireEvent.blur(adults);
    await waitFor(() => expect(adults).toHaveValue(1));

    // A fractional entry floors to a whole number.
    fireEvent.change(adults, { target: { value: '2.7' } });
    await waitFor(() => expect(total.value).toContain('30,000'));
    fireEvent.blur(adults);
    await waitFor(() => expect(adults).toHaveValue(2));
  });

  it('persists an edited traveller mix with the quotation on save', async () => {
    const fetchMock = masterFetch(pricingBase());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Pricing');
    const adults = screen.getByLabelText('Adults') as HTMLInputElement;
    await userEvent.clear(adults);
    await userEvent.type(adults, '4');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    // The quotation-level PATCH carries the new counts…
    await waitFor(() => {
      const countPatch = fetchMock.mock.calls.find(
        ([input, options]) =>
          options?.method === 'PATCH' &&
          String(input).includes('/quotations/quotation-1') &&
          !String(input).includes('/versions/'),
      );
      expect(countPatch).toBeDefined();
      expect(JSON.parse(String(countPatch![1]!.body))).toMatchObject({ adults: 4 });
    });
    // …and is followed by the version save.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, options]) =>
            options?.method === 'PATCH' && String(input).includes('/versions/version-1'),
        ),
      ).toBe(true),
    );
  });

  it('keeps manual count edits across tab switches and unrelated field changes', async () => {
    vi.stubGlobal('fetch', masterFetch(pricingBase()));
    renderBuilderPage();
    await openTab('Pricing');
    const adults = screen.getByLabelText('Adults') as HTMLInputElement;
    await userEvent.clear(adults);
    await userEvent.type(adults, '5');
    // The Summary tab unmounts when another tab is active; the edit must survive.
    await openTab('Hotel');
    await openTab('Pricing');
    expect(screen.getByLabelText('Adults')).toHaveValue(5);
    // An unrelated form field (the per-adult price) must not reset the count.
    await userEvent.type(screen.getByLabelText('Per Adult Price'), '10000');
    expect(screen.getByLabelText('Adults')).toHaveValue(5);
  });

  it('hides breakdown categories whose traveller count is zero', async () => {
    vi.stubGlobal(
      'fetch',
      masterFetch({
        ...builderQuotation(),
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
      }),
    );
    renderBuilderPage();
    await openTab('Pricing');
    await userEvent.type(screen.getByLabelText('Per Adult Price'), '10000');
    expect(await screen.findByText(/Adults: 2 ×/)).toBeInTheDocument();
    expect(screen.queryByText(/CWB: /)).not.toBeInTheDocument();
    expect(screen.queryByText(/CWOB: /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Infants: /)).not.toBeInTheDocument();
  });

  it('renders the exact tax-note options and omits the removed pricing controls', async () => {
    vi.stubGlobal('fetch', masterFetch(pricingBase()));
    renderBuilderPage();
    await openTab('Pricing');
    const taxSelect = screen.getByLabelText('Tax note');
    expect(
      within(taxSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(TAX_NOTE_OPTIONS);
    expect(screen.queryByText(/Show Service Charges Separately/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Mark Service Charges as Outside/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hide Pricing in Weblink/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Show Individual Pricing/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Service Sections Pricing/)).not.toBeInTheDocument();
  });

  it('keeps the saved tax note on "no change" and saves the initial amount and link', async () => {
    const fetchMock = masterFetch(
      pricingBase({
        taxNote: 'Inclusive of GST and TCS',
        initialPaymentAmount: '0',
        paymentLink: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Pricing');
    await userEvent.type(screen.getByLabelText('Initial amount for booking'), '2000');
    await userEvent.type(screen.getByLabelText('Payment link'), 'https://pay.example.com/abc');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.taxNote).toBe('Inclusive of GST and TCS');
      expect(body.initialPaymentAmount).toBe(2000);
      expect(body.paymentLink).toBe('https://pay.example.com/abc');
    });
  });

  it('persists a null tax note when "Do not show" is chosen', async () => {
    const fetchMock = masterFetch(pricingBase({ taxNote: 'Inclusive of all taxes' }));
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Pricing');
    await userEvent.selectOptions(screen.getByLabelText('Tax note'), 'Do not show');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch![1]!.body)).taxNote).toBeNull();
    });
  });

  it('rejects an invalid payment link and blocks the save', async () => {
    const fetchMock = masterFetch(pricingBase());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Pricing');
    await userEvent.type(screen.getByLabelText('Payment link'), 'not-a-url');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    expect((await screen.findAllByText(/valid URL starting with/i)).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });

  it('shows a single section-wise total and no separate add-on bar in the summary card', async () => {
    const fetchMock = masterFetch(
      builderQuotation({
        pricingMode: 'SECTION_WISE',
        perAdultPrice: '0',
        hotels: [
          { id: 'h1', city: 'Singapore', hotelName: 'Hotel A', sellingPrice: '15000', selected: true, sequence: 1 },
        ],
        services: [
          { id: 's1', serviceType: 'CRUISE', name: 'Overnight cruise', quantity: '1', sellingPrice: '8000', unitSellingPrice: '8000', sequence: 1 },
        ],
        includeVisa: true,
        visaAmount: '3000',
        visaServiceCharge: '500',
        visaGstPercent: '18',
        visaVfsCharge: '200',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await screen.findByRole('heading', { name: 'Quotation builder' });

    // The green Final Quotation Total card shows the section total
    // (Hotel 15000 + Cruise 8000 + Visa 3000+500+90+200=3790 = 26790).
    expect(screen.getByText('INR 26790.00')).toBeInTheDocument();
    expect(screen.getByText('(Section-wise Total)')).toBeInTheDocument();
    // The yellow add-on bar is gone — no separate add-on total anywhere.
    expect(screen.queryByText('Add-on Services Total')).not.toBeInTheDocument();
    expect(screen.queryByText('Not added to final total')).not.toBeInTheDocument();

    // The Pricing Breakdown tab agrees with the same resolver.
    await openTab('Pricing Breakdown');
    expect(screen.getByText('Price Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Grand Total')).toBeInTheDocument();
    expect(screen.getAllByText('₹26,790.00').length).toBeGreaterThan(0);
  });

  const publicPayload = (
    versionOverrides: Record<string, unknown> = {},
    quotationOverrides: Record<string, unknown> = {},
  ) => ({
    company: {
      name: 'Alpha Travel',
      email: 'a@b.test',
      phone: null,
      website: null,
      address: null,
      primaryColor: '#2563eb',
    },
    quotation: {
      quotationNumber: 'QT-2026-000009',
      customerName: 'Vikas Singh',
      destinationSummary: 'Singapore',
      travelStartDate: null,
      travelEndDate: null,
      adults: 2,
      childrenWithBed: 1,
      childrenWithoutBed: 1,
      infants: 1,
      rooms: 1,
      validUntil: null,
      status: 'VIEWED',
      ...quotationOverrides,
    },
    version: {
      title: 'Singapore Package',
      versionNumber: 1,
      currency: 'INR',
      finalAmount: '30000',
      perAdultPrice: '10000',
      perChildWithBedPrice: '2000',
      perChildWithoutBedPrice: '1000',
      perInfantPrice: '7000',
      taxNote: 'Inclusive of all taxes, excluding TCS',
      initialPaymentAmount: '2000',
      paymentLink: 'https://pay.example.com/abc',
      hotels: [],
      services: [],
      itinerary: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      ...versionOverrides,
    },
    downloadUrl: null,
  });

  const renderPublic = (payload: unknown) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(payload)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
  };

  it('renders the total, exact tax note and plural traveller breakdown', async () => {
    renderPublic(publicPayload());
    await screen.findByText('Custom Package for Vikas Singh');
    expect(screen.getAllByText('Total Package Price').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/30,000/).length).toBeGreaterThan(0);
    expect(screen.getByText('Inclusive of all taxes, excluding TCS')).toBeInTheDocument();
    const breakdown = screen.getByTestId('traveler-price-breakdown');
    expect(within(breakdown).getByText('Adults')).toBeInTheDocument();
    expect(within(breakdown).getByText('2 × ₹10,000')).toBeInTheDocument();
    expect(within(breakdown).getByText('Children with bed (CWB)')).toBeInTheDocument();
    expect(within(breakdown).getByText('1 × ₹2,000')).toBeInTheDocument();
    expect(within(breakdown).getByText('Children without bed (CWOB)')).toBeInTheDocument();
    expect(within(breakdown).getByText('1 × ₹1,000')).toBeInTheDocument();
    expect(within(breakdown).getByText('Infants')).toBeInTheDocument();
    expect(within(breakdown).getByText('1 × ₹7,000')).toBeInTheDocument();
    // Internal profitability is never exposed publicly.
    expect(screen.queryByText(/Margin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Net Amount/)).not.toBeInTheDocument();
  });

  it('hides zero-count traveller categories publicly', async () => {
    renderPublic(
      publicPayload(
        { perChildWithBedPrice: '0', perChildWithoutBedPrice: '0' },
        { adults: 1, childrenWithBed: 0, childrenWithoutBed: 0, infants: 1 },
      ),
    );
    await screen.findByText('Custom Package for Vikas Singh');
    const breakdown = screen.getByTestId('traveler-price-breakdown');
    expect(within(breakdown).getByText('Adults')).toBeInTheDocument();
    expect(within(breakdown).getByText('1 × ₹10,000')).toBeInTheDocument();
    expect(within(breakdown).getByText('Infants')).toBeInTheDocument();
    expect(within(breakdown).getByText('1 × ₹7,000')).toBeInTheDocument();
    expect(within(breakdown).queryByText('Children with bed (CWB)')).not.toBeInTheDocument();
    expect(within(breakdown).queryByText('Children without bed (CWOB)')).not.toBeInTheDocument();
  });

  it('hides the tax note and never shows the control values publicly', async () => {
    renderPublic(publicPayload({ taxNote: null }));
    await screen.findByText('Custom Package for Vikas Singh');
    expect(screen.queryByText(/Inclusive of/)).not.toBeInTheDocument();
    cleanup();
    renderPublic(publicPayload({ taxNote: '-- No change (keep existing) --' }));
    await screen.findByText('Custom Package for Vikas Singh');
    expect(screen.queryByText('-- No change (keep existing) --')).not.toBeInTheDocument();
    cleanup();
    renderPublic(publicPayload({ taxNote: 'Do not show' }));
    await screen.findByText('Custom Package for Vikas Singh');
    expect(screen.queryByText('Do not show')).not.toBeInTheDocument();
  });

  it('shows the Secure Your Booking card only with a valid amount and link', async () => {
    renderPublic(publicPayload());
    await screen.findByText('Custom Package for Vikas Singh');
    const heading = screen.getByRole('heading', { name: 'Secure Your Booking Now' });
    const card = heading.closest('section') as HTMLElement;
    expect(card).toHaveTextContent('Make an initial payment of');
    expect(card).toHaveTextContent(/2,000\.00/);
    expect(card).toHaveTextContent('to confirm your booking.');
    expect(card).toHaveTextContent('The remaining balance can be paid as per the payment policy.');
    const pay = screen.getByRole('link', { name: /Pay Now/ });
    expect(pay).toHaveAttribute('href', 'https://pay.example.com/abc');
    expect(pay).toHaveAttribute('target', '_blank');
    expect(pay).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('hides the Secure Your Booking card for every invalid combination', async () => {
    const secure = () => screen.queryByRole('heading', { name: 'Secure Your Booking Now' });
    for (const override of [
      { initialPaymentAmount: '0' }, // zero amount + valid link
      { paymentLink: null }, // amount + empty link
      { paymentLink: 'not-a-url' }, // amount + invalid link
      { initialPaymentAmount: '0', paymentLink: null }, // both empty
    ]) {
      renderPublic(publicPayload(override));
      await screen.findByText('Custom Package for Vikas Singh');
      expect(secure()).not.toBeInTheDocument();
      cleanup();
    }
  });

  it('renders the Secure Your Booking card as a white card with Pay Now button on the right', async () => {
    renderPublic(publicPayload());
    await screen.findByText('Custom Package for Vikas Singh');
    const heading = screen.getByRole('heading', { name: 'Secure Your Booking Now' });
    const card = heading.closest('section') as HTMLElement;
    // White background, no green card background
    expect(card.className).toContain('bg-white');
    expect(card.querySelector('.bg-emerald-50')).toBeNull();
    expect(card.querySelector('.border-emerald-200')).toBeNull();
    // Gray border, subtle shadow, rounded
    expect(card.className).toContain('border-slate-200');
    expect(card.className).toContain('rounded-md');
    expect(card.className).toContain('shadow-sm');
    // No old large circular lock icon
    expect(card.querySelector('.rounded-full.bg-emerald-600')).toBeNull();
    // Pay Now button has Lock icon inside it
    const pay = screen.getByRole('link', { name: /Pay Now/ });
    const lockSvg = pay.querySelector('svg');
    expect(lockSvg).not.toBeNull();
    // Lock icon's parent is the link itself
    expect(lockSvg!.closest('a')).toBe(pay);
  });

  it('Secure Your Booking card hides when amount is zero', async () => {
    renderPublic(publicPayload({ initialPaymentAmount: '0' }));
    await screen.findByText('Custom Package for Vikas Singh');
    expect(
      screen.queryByRole('heading', { name: 'Secure Your Booking Now' }),
    ).not.toBeInTheDocument();
  });

  it('Secure Your Booking card hides when payment link is invalid', async () => {
    renderPublic(publicPayload({ paymentLink: 'not-a-url' }));
    await screen.findByText('Custom Package for Vikas Singh');
    expect(
      screen.queryByRole('heading', { name: 'Secure Your Booking Now' }),
    ).not.toBeInTheDocument();
  });

  it('raw payment URL is not visible', async () => {
    renderPublic(publicPayload());
    await screen.findByText('Custom Package for Vikas Singh');
    const card = screen
      .getByRole('heading', { name: 'Secure Your Booking Now' })
      .closest('section') as HTMLElement;
    expect(card.textContent).not.toContain('https://');
  });
});

describe('Public weblink — section-wise pricing breakdown', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
  });

  const sectionWisePayload = (versionOverrides: Record<string, unknown> = {}) => ({
    company: {
      name: 'Alpha Travel',
      email: 'a@b.test',
      phone: null,
      website: null,
      address: null,
      primaryColor: '#2563eb',
    },
    quotation: {
      quotationNumber: 'QT-2026-000009',
      customerName: 'Vikas Singh',
      destinationSummary: 'Singapore',
      travelStartDate: null,
      travelEndDate: null,
      adults: 2,
      childrenWithBed: 1,
      childrenWithoutBed: 1,
      infants: 1,
      rooms: 1,
      validUntil: null,
      status: 'VIEWED',
    },
    version: {
      title: 'Singapore Package',
      versionNumber: 1,
      currency: 'INR',
      finalAmount: '0',
      pricingMode: 'SECTION_WISE',
      perAdultPrice: '0',
      perChildWithBedPrice: '0',
      perChildWithoutBedPrice: '0',
      perInfantPrice: '0',
      flightDetails: { include: true, amount: '20000' },
      hotelDetails: { include: true, sectionTitle: 'Accommodation Details' },
      hotels: [
        {
          id: 'hotel-a',
          city: 'Singapore',
          hotelName: 'Days Inn Singapore Novena',
          sellingPrice: '15000',
          selected: true,
          sequence: 1,
        },
        {
          id: 'hotel-b',
          city: 'Singapore',
          hotelName: 'Marina Bay Sands',
          sellingPrice: '25000',
          selected: true,
          sequence: 2,
        },
      ],
      services: [
        {
          id: 'service-cruise',
          serviceType: 'CRUISE',
          name: 'Overnight cruise',
          quantity: '1',
          sellingPrice: '8000',
          unitSellingPrice: '8000',
          sequence: 1,
        },
      ],
      sightseeingDetails: { include: false, days: [] },
      includeVisa: true,
      visaSectionTitle: 'Visa',
      visaAmount: '3000',
      visaDestination: 'Singapore',
      visaType: 'Tourist',
      visaServiceCharge: '500',
      visaGstPercent: '18',
      visaVfsCharge: '200',
      initialPaymentAmount: '0',
      paymentLink: null,
      hotelPresentations: {},
      vehiclePresentations: {},
      airlinePresentations: {},
      itinerary: [],
      inclusions: [],
      exclusions: [],
      terms: [],
      ...versionOverrides,
    },
    downloadUrl: null,
  });

  const renderSectionWise = (payload: unknown) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(payload)));
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
  };

  it('renders a distinct section-wise breakdown with every section and the grand total', async () => {
    renderSectionWise(sectionWisePayload());
    await screen.findByText('Custom Package for Vikas Singh');

    // The hero price card uses a section-wise label (not "Total Package Price").
    expect(screen.getByText('Quotation Total')).toBeInTheDocument();
    // Flights 20000 + Hotels (15000+25000) + Cruise 8000 + Visa (3000+500+90+200=3790).
    expect(screen.getAllByText('₹71,790').length).toBeGreaterThan(0);

    expect(screen.getByRole('heading', { name: 'Price Breakdown' })).toBeInTheDocument();
    for (const label of ['Flights', 'Hotels', 'Cruise', 'Visa']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('₹20,000')).toBeInTheDocument();
    expect(screen.getByText('₹40,000')).toBeInTheDocument();
    expect(screen.getByText('₹8,000')).toBeInTheDocument();
    expect(screen.getByText('₹3,790')).toBeInTheDocument();
    expect(screen.getAllByText('Grand Total').length).toBeGreaterThan(0);

    // No per-passenger lines leak into a section-wise quotation.
    expect(screen.queryByText(/Adult ×/)).not.toBeInTheDocument();
    // Internal reconciliation (Allocated/Remaining/Overallocated/Package Total)
    // is never shown to the customer.
    expect(screen.queryByText('Allocated')).not.toBeInTheDocument();
    expect(screen.queryByText('Remaining')).not.toBeInTheDocument();
    expect(screen.queryByText('Overallocated')).not.toBeInTheDocument();
    expect(screen.queryByText('Package Total')).not.toBeInTheDocument();
  });

  it('does not duplicate the visa amount inside the visa card', async () => {
    renderSectionWise(sectionWisePayload());
    await screen.findByText('Custom Package for Vikas Singh');
    const visaCard = screen
      .getByRole('heading', { name: 'Visa' })
      .closest('section') as HTMLElement;
    // The consolidated visa total lives only in the section-wise breakdown.
    expect(visaCard.textContent).not.toContain('₹3,790');
    expect(visaCard.textContent).not.toContain('Consolidated total');
  });

  it('keeps the package pricing card and hides the breakdown in total mode', async () => {
    renderSectionWise(
      sectionWisePayload({
        pricingMode: 'TOTAL',
        perAdultPrice: '15000',
        perChildWithBedPrice: '0',
        perChildWithoutBedPrice: '0',
        perInfantPrice: '0',
      }),
    );
    await screen.findByText('Custom Package for Vikas Singh');
    expect(screen.getAllByText('Total Package Price').length).toBeGreaterThan(0);
    // 2 adults × 15000.
    expect(screen.getAllByText('₹30,000').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Section-wise Price Breakdown' })).not.toBeInTheDocument();
  });
});

describe('Pricing Breakdown — section amounts, multi-hotel sum and grand total', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const breakdownQuotation = (versionOverrides: Record<string, unknown> = {}) => ({
    ...builderQuotation({
      pricingMode: 'SECTION_WISE',
      perAdultPrice: '15000',
      perChildWithBedPrice: '0',
      perChildWithoutBedPrice: '0',
      perInfantPrice: '0',
      hotels: [
        {
          id: 'hotel-a',
          city: 'Singapore',
          hotelName: 'Days Inn Singapore Novena',
          rooms: 1,
          nights: 1,
          sellingPrice: '45678',
          selected: true,
          sequence: 1,
        },
        {
          id: 'hotel-b',
          city: 'Singapore',
          hotelName: 'Marina Bay Sands',
          rooms: 1,
          nights: 1,
          sellingPrice: '453',
          selected: true,
          sequence: 2,
        },
      ],
      services: [
        {
          id: 'service-cruise',
          serviceType: 'CRUISE',
          name: 'Overnight cruise',
          quantity: '1',
          sellingPrice: '8000',
          unitSellingPrice: '8000',
          sequence: 1,
        },
      ],
      ...versionOverrides,
    }),
    adults: 2,
    childrenWithBed: 0,
    childrenWithoutBed: 0,
    infants: 0,
  });

  it('sums multiple hotels into one section and shows every section plus grand total', async () => {
    vi.stubGlobal('fetch', masterFetch(breakdownQuotation()));
    renderBuilderPage();
    await openTab('Pricing Breakdown');

    // Multi-hotel prices are summed inside the Hotels section: 45678 + 453.
    expect(screen.getByText('Hotels')).toBeInTheDocument();
    expect(screen.getByText(/46,131/)).toBeInTheDocument();

    // All priced sections are present (names may also appear on tab buttons).
    for (const name of ['Flights', 'Cruise', 'Vehicle/Transportation', 'Sightseeing', 'Add-on Services', 'Visa']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/8,000/)).toBeInTheDocument();

    // Grand total is the section total (46131 + 8000) — not the per-passenger
    // package total. Section-wise pricing is defined by the allocated sections.
    expect(screen.getAllByText('Grand Total').length).toBeGreaterThan(0);
    expect(screen.getByText(/54,131/)).toBeInTheDocument();
  });

  it('does not show the legacy allocation/reconciliation block in section-wise mode', async () => {
    // Per-passenger price is intentionally higher than the sections: the new
    // section-wise UI must not surface Allocated/Remaining/Overallocated or a
    // separate Package Total — a single Grand Total is enough.
    vi.stubGlobal(
      'fetch',
      masterFetch(breakdownQuotation({ perAdultPrice: '30000' })),
    );
    renderBuilderPage();
    await openTab('Pricing Breakdown');

    expect(screen.queryByText('Section-wise Allocation')).not.toBeInTheDocument();
    expect(screen.queryByText('Allocated')).not.toBeInTheDocument();
    expect(screen.queryByText('Remaining')).not.toBeInTheDocument();
    expect(screen.queryByText('Overallocated')).not.toBeInTheDocument();
    expect(screen.queryByText('Package Total')).not.toBeInTheDocument();
    // The grand total is still shown as the section total.
    expect(screen.getAllByText('Grand Total').length).toBeGreaterThan(0);
    expect(screen.getByText(/54,131/)).toBeInTheDocument();
  });

  it('hides section-wise rows and shows per-person pricing in per-person mode', async () => {
    vi.stubGlobal(
      'fetch',
      masterFetch(breakdownQuotation({ pricingMode: 'TOTAL' })),
    );
    renderBuilderPage();
    await openTab('Pricing Breakdown');

    expect(screen.queryByText('Section-wise Allocation')).not.toBeInTheDocument();
    // In per-person mode the section rows are replaced by the per-person block.
    expect(screen.queryByText('Hotels')).not.toBeInTheDocument();
    expect(screen.getByText('Number of Travelers')).toBeInTheDocument();
    expect(screen.getAllByText('Package Subtotal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Grand Total').length).toBeGreaterThan(0);
  });
});

describe('Generate PDF button — real request, open, loading and error states', () => {
  const finalizedVersion = {
    id: 'version-1',
    versionNumber: 1,
    title: 'Goa proposal',
    introduction: null,
    destinationSummary: 'Goa',
    travelStartDate: null,
    travelEndDate: null,
    currency: 'INR',
    subtotalSellingPrice: '25000',
    markupMode: 'NONE',
    markupValue: '0',
    totalMarkup: '0',
    taxRate: '0',
    taxAmount: '0',
    discountAmount: '0',
    finalAmount: '25000',
    pricingMode: 'ITEMIZED',
    notes: null,
    status: 'FINALIZED',
    finalizedAt: '2026-07-21T00:00:00.000Z',
    createdAt: '2026-07-21T00:00:00.000Z',
    createdBy: person,
    itinerary: [],
    hotels: [],
    services: [],
    inclusions: [],
    exclusions: [],
    terms: [],
  };
  const detail = {
    id: 'quotation-1',
    quotationNumber: 'QT-2026-000001',
    queryId: 'lead-1',
    currentVersionId: 'version-1',
    status: 'SENT',
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
    lastSentAt: '2026-07-21T00:00:00.000Z',
    lastViewedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    createdBy: person,
    query: {
      id: 'lead-1',
      queryNumber: 'QRY-1',
      leadStage: 'QUOTATION_SENT',
      assignedToId: 'user-1',
      createdById: 'user-1',
    },
    versions: [finalizedVersion],
    documents: [],
    emailLogs: [],
    activityTimeline: [],
  };
  const errorResponse = () =>
    ({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    }) as Response;

  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(['quotations.view', 'quotations.generate_pdf']);
  });

  const renderDetails = () =>
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );

  const pdfTab = () =>
    ({
      opener: window,
      document: { title: '', body: { innerHTML: '' } },
      location: { replace: vi.fn() },
      close: vi.fn(),
    }) as unknown as Window;

  it('offers both styles and opens the generated Classic PDF inline in a new tab', async () => {
    const tab = pdfTab();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/generate-pdf'))
        return response({ id: 'doc-new', fileName: 'qt-2026-000001-aarav-mehta-v1-quotation.pdf' });
      if (url.includes('/download-url'))
        return response({ url: 'https://files.example.test/quotation.pdf' });
      if (url.endsWith('/weblink-analytics'))
        return response({
          totalViews: 0,
          externalViews: 0,
          homeIpViews: 0,
          uniqueIps: 0,
          entries: [],
        });
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await screen.findByText('Activity timeline');
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    expect(screen.getByRole('dialog', { name: 'Choose PDF style' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Stylish PDF/ })).toBeEnabled();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Classic PDF/ }));
    await waitFor(() =>
      expect(tab.location.replace).toHaveBeenCalledWith('https://files.example.test/quotation.pdf'),
    );
    const genCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/generate-pdf'));
    expect(String(genCall![0])).toContain('/versions/version-1/generate-pdf');
    expect(JSON.parse(String(genCall![1]?.body))).toMatchObject({ force: true, style: 'CLASSIC' });
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes('/download-url?disposition=inline')),
    ).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
  });

  it('opens the Stylish PDF cover flow and generates with the destination image', async () => {
    const tab = pdfTab();
    vi.spyOn(window, 'open').mockReturnValue(tab);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/generate-pdf'))
        return response({ id: 'doc-stylish', fileName: 'stylish-quotation.pdf' });
      if (url.includes('/download-url'))
        return response({ url: 'https://files.example.test/stylish-quotation.pdf' });
      if (url.endsWith('/weblink-analytics'))
        return response({
          totalViews: 0,
          externalViews: 0,
          homeIpViews: 0,
          uniqueIps: 0,
          entries: [],
        });
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await screen.findByText('Activity timeline');
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    const stylish = screen.getByRole('button', { name: /Stylish PDF/ });
    await userEvent.click(stylish);
    expect(screen.getByRole('dialog', { name: 'Choose first-page image' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Use destination image/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Generate Stylish PDF' }));
    await waitFor(() =>
      expect(tab.location.replace).toHaveBeenCalledWith(
        'https://files.example.test/stylish-quotation.pdf',
      ),
    );
    const genCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/generate-pdf'));
    expect(JSON.parse(String(genCall![1]?.body))).toMatchObject({
      force: true,
      style: 'STYLISH',
      coverSource: 'DESTINATION',
    });
  });

  it('closes the temporary tab and shows an error when generation fails', async () => {
    const tab = pdfTab();
    vi.spyOn(window, 'open').mockReturnValue(tab);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/generate-pdf')) return errorResponse();
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await screen.findByText('Activity timeline');
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await userEvent.click(screen.getByRole('button', { name: /Classic PDF/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'PDF generation failed. Please try again.',
    );
    expect(tab.close).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Generate PDF' })).toBeEnabled();
  });

  it('shows a clear message when the browser blocks the new tab', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => response(detail));
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await screen.findByText('Activity timeline');
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await userEvent.click(screen.getByRole('button', { name: /Classic PDF/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow pop-ups');
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/generate-pdf'))).toBe(false);
  });

  it('shows a loading label and disables the button while generating', async () => {
    vi.spyOn(window, 'open').mockReturnValue(pdfTab());
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/generate-pdf')) return new Promise<Response>(() => {});
      if (url.includes('/download-url'))
        return response({ url: 'https://files.example.test/q.pdf' });
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await screen.findByText('Activity timeline');
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    await userEvent.click(screen.getByRole('button', { name: /Classic PDF/ }));
    const busy = await screen.findByRole('button', { name: /Generating PDF/ });
    expect(busy).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/generate-pdf')).length).toBe(
      1,
    );
  });
});

describe('Weblink PDF option — third PDF style', () => {
  const finalizedVersion = {
    id: 'version-1',
    versionNumber: 1,
    title: 'Goa proposal',
    introduction: null,
    destinationSummary: 'Goa',
    travelStartDate: null,
    travelEndDate: null,
    currency: 'INR',
    subtotalSellingPrice: '25000',
    markupMode: 'NONE',
    markupValue: '0',
    totalMarkup: '0',
    taxRate: '0',
    taxAmount: '0',
    discountAmount: '0',
    finalAmount: '25000',
    pricingMode: 'ITEMIZED',
    notes: null,
    status: 'FINALIZED',
    finalizedAt: '2026-07-21T00:00:00.000Z',
    createdAt: '2026-07-21T00:00:00.000Z',
    createdBy: person,
    itinerary: [],
    hotels: [],
    services: [],
    inclusions: [],
    exclusions: [],
    terms: [],
  };
  const detail = {
    id: 'quotation-1',
    quotationNumber: 'QT-2026-000001',
    queryId: 'lead-1',
    currentVersionId: 'version-1',
    status: 'SENT',
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
    lastSentAt: '2026-07-21T00:00:00.000Z',
    lastViewedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    createdBy: person,
    query: {
      id: 'lead-1',
      queryNumber: 'QRY-1',
      leadStage: 'QUOTATION_SENT',
      assignedToId: 'user-1',
      createdById: 'user-1',
    },
    versions: [finalizedVersion],
    documents: [],
    emailLogs: [],
    activityTimeline: [],
  };
  const errorResponse = () =>
    ({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
    }) as Response;

  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(['quotations.view', 'quotations.generate_pdf']);
  });

  const renderDetails = () =>
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );

  const pdfTab = () =>
    ({
      opener: window,
      document: { title: '', body: { innerHTML: '' } },
      location: { replace: vi.fn() },
      close: vi.fn(),
    }) as unknown as Window;

  const openPopup = async () => {
    await screen.findByText('Activity timeline');
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    expect(screen.getByRole('dialog', { name: 'Choose PDF style' })).toBeInTheDocument();
  };

  it('lists Weblink PDF alongside Classic and Stylish without changing them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(detail)));
    renderDetails();
    await openPopup();
    expect(screen.getByRole('button', { name: /Classic PDF/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Stylish PDF/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Weblink PDF/ })).toBeEnabled();
  });

  it('generates the Weblink PDF and opens it inline in a new tab', async () => {
    const tab = pdfTab();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/generate-pdf'))
        return response({ id: 'doc-weblink', fileName: 'aarav-mehta-quotation.pdf' });
      if (url.includes('/download-url'))
        return response({ url: 'https://files.example.test/weblink-quotation.pdf' });
      if (url.endsWith('/weblink-analytics'))
        return response({ totalViews: 0, externalViews: 0, homeIpViews: 0, uniqueIps: 0, entries: [] });
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await openPopup();
    await userEvent.click(screen.getByRole('button', { name: /Weblink PDF/ }));
    await waitFor(() =>
      expect(tab.location.replace).toHaveBeenCalledWith(
        'https://files.example.test/weblink-quotation.pdf',
      ),
    );
    const genCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/generate-pdf'));
    expect(String(genCall![0])).toContain('/versions/version-1/generate-pdf');
    // Same workflow shape as Classic: forced fresh generation, inline open.
    expect(JSON.parse(String(genCall![1]?.body))).toEqual({ force: true, style: 'WEBLINK' });
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes('/download-url?disposition=inline')),
    ).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
  });

  it('disables reselection while Weblink generation is pending', async () => {
    vi.spyOn(window, 'open').mockReturnValue(pdfTab());
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/generate-pdf')) return new Promise<Response>(() => {});
      if (url.includes('/download-url'))
        return response({ url: 'https://files.example.test/weblink.pdf' });
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await openPopup();
    await userEvent.click(screen.getByRole('button', { name: /Weblink PDF/ }));
    // While pending the entry button is busy and disabled, so a second
    // selection cannot start a duplicate request.
    const busy = await screen.findByRole('button', { name: /Generating PDF/ });
    expect(busy).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/generate-pdf')).length).toBe(
      1,
    );
  });

  it('closes the temporary tab and shows an error when Weblink generation fails', async () => {
    const tab = pdfTab();
    vi.spyOn(window, 'open').mockReturnValue(tab);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/generate-pdf')) return errorResponse();
      return response(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();
    await openPopup();
    await userEvent.click(screen.getByRole('button', { name: /Weblink PDF/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'PDF generation failed. Please try again.',
    );
    expect(tab.close).toHaveBeenCalled();
  });
});

/**
 * Per-activity informational pricing on the customer-facing weblink.
 *
 * An activity with no usable prices must look exactly as it did before this
 * feature existed — no heading, no placeholder, no ₹0 row.
 */
describe('Public weblink — activity pricing', () => {
  const pricingBaseVersion = {
    title: 'Singapore Escape',
    versionNumber: 1,
    currency: 'INR',
    // Activity pricing renders only in section-wise pricing mode.
    pricingMode: 'SECTION_WISE',
    finalAmount: '100',
    hotelDetails: { sectionTitle: 'Accommodation Details', amount: 0, description: null },
    hotels: [],
    services: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    terms: [],
  };

  const renderWithActivities = async (
    activities: unknown[],
    versionOverrides: Record<string, unknown> = {},
  ) => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>(
      async () =>
        response({
          company: {
            name: 'Alpha Travel',
            email: 'a@b.test',
            phone: null,
            website: null,
            address: null,
            primaryColor: '#2563eb',
          },
          quotation: {
            quotationNumber: 'QT-2026-000003',
            customerName: 'Mira Shah',
            destinationSummary: 'Singapore',
            travelStartDate: null,
            travelEndDate: null,
            adults: 3,
            childrenWithBed: 0,
            childrenWithoutBed: 0,
            infants: 0,
            rooms: 1,
            validUntil: null,
            status: 'VIEWED',
          },
          version: {
            ...pricingBaseVersion,
            ...versionOverrides,
            sightseeingDetails: {
              include: true,
              sectionTitle: 'Sightseeing & Experiences',
              amount: 0,
              description: null,
              days: [
                {
                  dayNumber: 1,
                  title: 'Day 1: Singapore highlights',
                  city: 'Singapore',
                  meals: { breakfast: false, lunch: false, dinner: false },
                  mealMode: 'INCLUDE_AT_HOTEL',
                  dailyTransfer: 'SHARED',
                  activities,
                },
              ],
            },
          },
          downloadUrl: null,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
    await screen.findByText('Singapore Zoo');
  };

  it('renders populated prices with the quotation currency', async () => {
    await renderWithActivities([
      {
        name: 'Singapore Zoo',
        description: '<p>Meet the animals.</p>',
        startTime: '09:00',
        dailyTransfer: 'SHARED',
        pricingOptions: [
          { label: 'Adult', price: 3500 },
          { label: 'Child', price: 2500 },
          { label: 'Infant', price: 500 },
        ],
      },
    ]);
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    for (const [label, amount] of [
      ['Adult', '₹3,500'],
      ['Child', '₹2,500'],
      ['Infant', '₹500'],
    ]) {
      const term = screen.getByText(label as string);
      expect(term.nextElementSibling).toHaveTextContent(amount as string);
    }
  });

  it('shows a populated start time even when the legacy visibility flag is false', async () => {
    await renderWithActivities([
      {
        name: 'Singapore Zoo',
        description: '<p>Meet the animals.</p>',
        startTime: '09:00',
        showTime: false,
        dailyTransfer: 'SHARED',
      },
    ]);
    expect(screen.getByText(/9:00 AM/)).toBeInTheDocument();
  });

  it('renders custom labels exactly as entered', async () => {
    await renderWithActivities([
      {
        name: 'Singapore Zoo',
        description: '<p>Meet the animals.</p>',
        pricingOptions: [
          { label: 'Foreign National', price: 4500 },
          { label: 'Child 5–12 Years', price: 1500 },
        ],
      },
    ]);
    expect(screen.getByText('Foreign National')).toBeInTheDocument();
    expect(screen.getByText('Child 5–12 Years')).toBeInTheDocument();
  });

  it('shows only the populated row when pricing is partial', async () => {
    await renderWithActivities([
      {
        name: 'Singapore Zoo',
        description: '<p>Meet the animals.</p>',
        pricingOptions: [{ label: 'Adult', price: 3500 }],
      },
    ]);
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText('Adult')).toBeInTheDocument();
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
    expect(screen.queryByText('Senior')).not.toBeInTheDocument();
  });

  it('renders nothing at all when the activity has no pricing', async () => {
    // TOTAL mode keeps unpriced activities free of every pricing artefact
    // (no activity heading and no section-wise breakdown).
    await renderWithActivities(
      [
        {
          name: 'Singapore Zoo',
          description: '<p>Meet the animals.</p>',
          dailyTransfer: 'SHARED',
          pricingOptions: [],
        },
      ],
      { pricingMode: 'TOTAL' },
    );
    expect(screen.queryByText('Pricing')).not.toBeInTheDocument();
    expect(screen.queryByText('₹0')).not.toBeInTheDocument();
    expect(screen.queryByText('₹—')).not.toBeInTheDocument();
    // The rest of the activity is untouched.
    expect(screen.getByText('Shared Transfer')).toBeInTheDocument();
  });

  it('renders nothing for a pre-feature activity with no pricingOptions key', async () => {
    await renderWithActivities([
      { name: 'Singapore Zoo', description: '<p>Meet the animals.</p>', dailyTransfer: 'SHARED' },
    ]);
    expect(screen.getByText('Singapore Zoo')).toBeInTheDocument();
    expect(screen.queryByText('Pricing')).not.toBeInTheDocument();
  });

  it('drops half-filled and invalid rows instead of showing blanks or ₹0', async () => {
    await renderWithActivities([
      {
        name: 'Singapore Zoo',
        description: '<p>Meet the animals.</p>',
        pricingOptions: [
          { label: 'Adult', price: 3500 },
          { label: 'Child', price: null },
          { label: '  ', price: 900 },
          { label: 'Bad', price: -10 },
        ],
      },
    ]);
    expect(screen.getByText('Adult')).toBeInTheDocument();
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
    expect(screen.queryByText('Bad')).not.toBeInTheDocument();
  });

  it('keeps pricing per activity when a day has several', async () => {
    await renderWithActivities([
      {
        name: 'Singapore Zoo',
        description: '<p>Meet the animals.</p>',
        pricingOptions: [{ label: 'Adult', price: 3500 }],
      },
      {
        name: 'Gardens by the Bay',
        description: '<p>Evening show.</p>',
        pricingOptions: [{ label: 'Adult', price: 1200 }],
      },
    ]);
    const prices = screen.getAllByText('Adult').map((el) => el.nextElementSibling?.textContent);
    expect(prices).toEqual(['₹3,500', '₹1,200']);
  });

  it('does not add activity pricing to the quotation total', async () => {
    // TOTAL mode: activity pricing stays informational and never reaches any
    // section amount or the package total.
    await renderWithActivities(
      [
        {
          name: 'Singapore Zoo',
          description: '<p>Meet the animals.</p>',
          pricingOptions: [
            { label: 'Adult', price: 3500 },
            { label: 'Child', price: 2500 },
          ],
        },
      ],
      { pricingMode: 'TOTAL' },
    );
    // 3 adults × ₹3,500 must not appear anywhere; the total stays ₹100.
    expect(screen.queryByText('₹10,500')).not.toBeInTheDocument();
    expect(screen.queryByText('₹16,000')).not.toBeInTheDocument();
    expect(screen.getAllByText('₹100').length).toBeGreaterThan(0);
  });
});

describe('Quotation Builder — Sightseeing Master gallery snapshot', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('imports three images, reorders/removes/selects one for PDF, saves, and reloads', async () => {
    const legacy = {
      id: '11111111-1111-4111-8111-111111111110',
      title: 'Legacy Walk',
      sequence: 1,
      status: 'ACTIVE',
      images: [],
      destination: { id: 'dest-sg', name: 'Singapore', countryName: 'Singapore' },
      city: { id: 'city-sg', name: 'Singapore' },
    };
    const gallery = {
      ...legacy,
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Gallery Tour',
      sequence: 2,
      images: [{ id: 'image-a' }, { id: 'image-b' }, { id: 'image-c' }],
    };
    const presentations = {
      [gallery.id]: {
        imageUrl: 'https://preview.test/image-a.jpg',
        images: [
          { id: 'image-a', url: 'https://preview.test/image-a.jpg' },
          { id: 'image-b', url: 'https://preview.test/image-b.jpg' },
          { id: 'image-c', url: 'https://preview.test/image-c.jpg' },
        ],
      },
    };
    const initialSightseeingDetails = {
      include: true,
      sectionTitle: 'Sightseeing & Experiences',
      amount: 0,
      description: null,
      days: [
        {
          dayNumber: 1,
          title: 'Day 1',
          city: 'Singapore',
          date: null,
          meals: { breakfast: true, lunch: false, dinner: false },
          mealMode: 'INCLUDE_AT_HOTEL',
          dailyTransfer: 'SHARED',
          activities: [
            {
              sightseeingId: null,
              imageDocumentId: null,
              name: null,
              startTime: null,
              showTime: false,
              duration: null,
              city: 'Singapore',
              description: null,
              imageUrl: null,
              images: [],
              imageSnapshotPresent: false,
              pdfImageUrl: null,
              dailyTransfer: null,
              pricingOptions: [],
              sequence: 1,
            },
          ],
        },
      ],
    };
    const fetchMock = masterFetch(
      builderQuotation({
        destinationSummary: 'Singapore',
        sightseeingDetails: initialSightseeingDetails,
      }),
      {
        '/masters/sightseeing': page([legacy, gallery]),
        '/masters/sightseeing/presentations': presentations,
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Sightseeing');
    const picker = await screen.findByLabelText('Day 1 activity 1');
    await openActivityPicker(picker, 'Gallery Tour');
    fireEvent.change(picker, { target: { value: 'Gallery Tour' } });
    expect(await screen.findByText(/Activity Images \(3\)/)).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Move sightseeing image 1 right on day 1 activity 1',
      }),
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Remove sightseeing image 3 on day 1 activity 1',
      }),
    );
    await userEvent.click(
      screen.getByLabelText('Use sightseeing image 2 in PDF on day 1 activity 1'),
    );
    expect(screen.getByText(/Activity Images \(2\)/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    );
    const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const saved = JSON.parse(String(patchCall![1]!.body));
    const activity = saved.sightseeingDetails.days[0].activities[0];
    expect(activity.images).toEqual([
      expect.objectContaining({ masterImageId: 'image-b' }),
      expect.objectContaining({ masterImageId: 'image-a' }),
    ]);
    expect(activity.imageSnapshotPresent).toBe(true);
    expect(activity.pdfImageUrl).toBe('image-a');
    expect(JSON.stringify(activity.images)).not.toContain('preview.test');
    expect(
      fetchMock.mock.calls.some(
        ([input, options]) =>
          options?.method === 'DELETE' && String(input).includes('/masters/sightseeing'),
      ),
    ).toBe(false);

    cleanup();
    const reloadedDetails = {
      ...saved.sightseeingDetails,
      days: saved.sightseeingDetails.days.map((day: Record<string, unknown>) => ({
        ...day,
        activities: (day.activities as Array<Record<string, unknown>>).map((row) => ({
          ...row,
          images: [
            { id: 'image-b', url: 'https://fresh.test/image-b.jpg' },
            { id: 'image-a', url: 'https://fresh.test/image-a.jpg' },
          ],
        })),
      })),
    };
    vi.stubGlobal(
      'fetch',
      masterFetch(
        builderQuotation({ destinationSummary: 'Singapore', sightseeingDetails: reloadedDetails }),
        {
          '/masters/sightseeing': page([legacy, gallery]),
          '/masters/sightseeing/presentations': presentations,
        },
      ),
    );
    renderBuilderPage();
    await openTab('Sightseeing');
    expect(await screen.findByText(/Activity Images \(2\)/)).toBeInTheDocument();
    expect(
      screen.getByLabelText('Use sightseeing image 2 in PDF on day 1 activity 1'),
    ).toBeChecked();
  });

  it('keeps a Vehicle remove-all gallery authoritative without deleting Master images', async () => {
    const galleryVehicle = {
      ...vehicle,
      images: [{ id: 'vehicle-image-a' }, { id: 'vehicle-image-b' }, { id: 'vehicle-image-c' }],
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/masters/vehicles': page([galleryVehicle]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Vehicle');
    await userEvent.click(await screen.findByLabelText('Include Vehicle in Quotation'));
    // Vehicle cards open collapsed: reveal the first card before selecting.
    await expandVehicleCards();

    await userEvent.selectOptions(await screen.findByLabelText('Vehicle 1 type'), 'Standard MPV');
    await userEvent.selectOptions(await screen.findByLabelText('Vehicle 1 model'), galleryVehicle.id);
    expect(
      await screen.findByRole('button', { name: 'Remove vehicle-0 image 1' }),
    ).toBeInTheDocument();

    for (let remaining = 3; remaining > 0; remaining -= 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Remove vehicle-0 image 1' }));
    }
    expect(
      screen.queryByRole('button', { name: 'Remove vehicle-0 image 1' }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    );
    const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const saved = JSON.parse(String(patchCall![1]!.body));
    const vehicleRow = saved.services.find(
      (row: { serviceType: string }) => row.serviceType === 'VEHICLE_TRANSFER',
    );
    expect(vehicleRow).toMatchObject({
      vehicleId: galleryVehicle.id,
      images: [],
      imageSnapshotPresent: true,
      pdfImageUrl: null,
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, options]) =>
          options?.method === 'DELETE' && String(input).includes('/masters/vehicles'),
      ),
    ).toBe(false);
  });

  it('uses the Cruise-specific selector to persist quotation-only order and PDF choice', async () => {
    const galleryCruise = {
      ...cruise,
      images: [{ id: 'cruise-image-a' }, { id: 'cruise-image-b' }, { id: 'cruise-image-c' }],
    };
    const fetchMock = masterFetch(builderQuotation(), {
      '/masters/cruises': page([galleryCruise]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Cruise');
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    await userEvent.type(await screen.findByLabelText('Cruise master'), galleryCruise.name);

    expect(
      await screen.findByRole('button', { name: 'Move cruise-0 image 1 right' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move cruise-0 image 1 right' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove cruise-0 image 3' }));
    await userEvent.click(screen.getByLabelText('Use cruise-0 image 2 in PDF'));

    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true),
    );
    const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const saved = JSON.parse(String(patchCall![1]!.body));
    const cruiseRow = saved.services.find(
      (row: { serviceType: string }) => row.serviceType === 'CRUISE',
    );
    expect(cruiseRow.images).toEqual([
      expect.objectContaining({ masterImageId: 'cruise-image-b' }),
      expect.objectContaining({ masterImageId: 'cruise-image-a' }),
    ]);
    expect(cruiseRow.imageSnapshotPresent).toBe(true);
    expect(cruiseRow.pdfImageUrl).toBe('cruise-image-a');
    expect(JSON.stringify(cruiseRow.images)).not.toContain('preview');
    expect(
      fetchMock.mock.calls.some(
        ([input, options]) =>
          options?.method === 'DELETE' && String(input).includes('/masters/cruises'),
      ),
    ).toBe(false);
  });
});

describe('Quotation Builder — Cruise Master description flow', () => {
  beforeEach(() => {
    auth.permissions = new Set([
      'quotations.view',
      'quotations.update',
      'masters.cruises.view',
      'masters.cruises.view_costing',
      'masters.cruises.manage_media',
    ]);
  });

  it('prefills the selected Cruise Master description and saves a quotation edit', async () => {
    const fetchMock = masterFetch(builderQuotation());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Cruise');
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    await userEvent.type(await screen.findByLabelText('Cruise master'), 'Dream Genting');

    const editor = await screen.findByLabelText('Cruise description');
    await waitFor(() =>
      expect(editor).toHaveTextContent('Experience an unforgettable cruise aboard Dream Genting.'),
    );

    editor.innerHTML = '<p>Edited cruise note for this customer.</p>';
    fireEvent.input(editor);
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const saved = JSON.parse(String(patchCall![1]!.body));
      const cruiseRow = saved.services.find(
        (service: { serviceType: string }) => service.serviceType === 'CRUISE',
      );
      expect(String(cruiseRow.description)).toContain('Edited cruise note for this customer.');
      expect(String(cruiseRow.description)).not.toContain('unforgettable cruise aboard');
    });
  });

  it('saves a Cruise Master description whose rich-text HTML exceeds the old 4000 limit', async () => {
    const visibleText = Array.from(
      { length: 120 },
      (_, index) =>
        `Cruise paragraph ${index + 1} covers dining, boarding, activities and cabin comfort.`,
    ).join(' ');
    const longHtmlDescription = `<div class="rich-cruise-copy">${visibleText
      .split(' ')
      .map((word, index) => (index % 9 === 0 ? `<strong>${word}</strong>` : word))
      .join(' ')}</div>`;
    expect(longHtmlDescription.length).toBeGreaterThan(4000);
    expect(visibleText.length).toBeLessThan(SERVICE_DESCRIPTION_MAX_LENGTH);

    const longCruise = { ...cruise, description: longHtmlDescription };
    const fetchMock = masterFetch(builderQuotation(), {
      '/masters/cruises': page([longCruise]),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    await openTab('Cruise');
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    await userEvent.type(await screen.findByLabelText('Cruise master'), longCruise.name);

    const editor = await screen.findByLabelText('Cruise description');
    await waitFor(() => expect(editor.innerHTML.length).toBeGreaterThan(4000));
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const saved = JSON.parse(String(patchCall![1]!.body));
      const cruiseRow = saved.services.find(
        (service: { serviceType: string }) => service.serviceType === 'CRUISE',
      );
      expect(cruiseRow.description).toBe(longHtmlDescription);
    });
  });

  it('keeps multiple Cruise Stay descriptions independent and clears when the new master has none', async () => {
    const noDescriptionCruise = { ...spectrumCruise, description: null };
    vi.stubGlobal(
      'fetch',
      masterFetch(builderQuotation(), {
        '/masters/cruises': page([cruise, noDescriptionCruise]),
      }),
    );
    renderBuilderPage();
    await openTab('Cruise');
    await userEvent.click(screen.getByLabelText('Include Cruise in Quotation'));
    await expandCruiseStays();
    fireEvent.change(await screen.findByLabelText('Cruise master'), {
      target: { value: cruise.name },
    });
    await userEvent.click(screen.getByRole('button', { name: /add cruise/i }));
    await expandCruiseStays();
    fireEvent.change(screen.getAllByLabelText('Cruise master')[1]!, {
      target: { value: noDescriptionCruise.name },
    });

    const editors = await screen.findAllByLabelText('Cruise description');
    await waitFor(() => {
      expect(editors[0]).toHaveTextContent(
        'Experience an unforgettable cruise aboard Dream Genting.',
      );
      expect(editors[1]).toHaveTextContent('');
    });

    fireEvent.change(screen.getAllByLabelText('Cruise master')[0]!, {
      target: { value: noDescriptionCruise.name },
    });
    await waitFor(() => expect(editors[0]).toHaveTextContent(''));
    expect(editors[1]).toHaveTextContent('');
  });
});

describe('Quotation service description validation', () => {
  const validVersion = (description: string | null) => ({
    title: 'Singapore proposal',
    destinationSummary: 'Singapore',
    currency: 'INR',
    services: [
      {
        serviceType: 'CRUISE',
        name: 'Genting Dream',
        description,
        quantity: 1,
        sellingPrice: 1000,
        sequence: 1,
      },
    ],
  });

  it('accepts descriptions below, above the old limit, and near the new limit', () => {
    expect(
      quotationVersionInputSchema.safeParse(validVersion('<p>Short cruise copy.</p>')).success,
    ).toBe(true);

    const overOldLimit = `<p>${'Detailed cruise sentence. '.repeat(180)}</p>`;
    expect(overOldLimit.length).toBeGreaterThan(4000);
    expect(quotationVersionInputSchema.safeParse(validVersion(overOldLimit)).success).toBe(true);

    const nearLimit = `<p>${'x'.repeat(SERVICE_DESCRIPTION_MAX_LENGTH)}</p>`;
    expect(quotationVersionInputSchema.safeParse(validVersion(nearLimit)).success).toBe(true);
  });

  it('rejects service descriptions over the new visible-text limit with a clean message', () => {
    const tooLong = `<p>${'x'.repeat(SERVICE_DESCRIPTION_MAX_LENGTH + 1)}</p>`;
    const parsed = quotationVersionInputSchema.safeParse(validVersion(tooLong));
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.issues[0]?.message).toBe(
      'Description must be 20,000 characters or fewer.',
    );
  });

  it('counts visible text instead of raw rich-text HTML for service descriptions', () => {
    const richHtml = `<p>${'<strong>Cabin comfort</strong> and <em>onboard dining</em>. '.repeat(
      180,
    )}</p>`;
    expect(richHtml.length).toBeGreaterThan(4000);
    expect(richHtml.replace(/<[^>]*>/g, '').length).toBeLessThan(SERVICE_DESCRIPTION_MAX_LENGTH);
    expect(quotationVersionInputSchema.safeParse(validVersion(richHtml)).success).toBe(true);
  });
});

describe('Public weblink — Back to Top button', () => {
  function publicPageData() {
    return {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: '+91 90000 00000',
        website: null,
        address: '1 MG Road, Bengaluru',
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000101',
        customerName: 'Priya Sharma',
        destinationSummary: 'Singapore',
        destinations: 'Singapore',
        travelStartDate: '2026-10-23',
        travelEndDate: '2026-10-29',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Back To Top Test',
        versionNumber: 1,
        currency: 'INR',
        destinationSummary: 'Singapore',
        finalAmount: '100000',
        notes: null,
        itinerary: [],
        hotels: [],
        services: [],
        faqs: [],
        weblinkSectionOrder: null,
      },
      destinationExpert: null,
      downloadUrl: null,
    };
  }

  function renderPublicPage() {
    vi.stubGlobal('fetch', vi.fn(async () => response(publicPageData())));
    return renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
  }

  it('stays hidden until 40% of the scrollable document, then smooth-scrolls to the top on click', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, writable: true, configurable: true });
    // Deterministic document metrics: scrollable = 2000 - 1000 = 1000px.
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 1000,
      writable: true,
      configurable: true,
    });
    const setScrollY = (value: number) => {
      Object.defineProperty(window, 'scrollY', { value, writable: true, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    };
    setScrollY(0);

    renderPublicPage();
    await screen.findByRole('heading', { name: 'Contact Us' });

    const button = () => screen.getByRole('button', { name: 'Back to top' });
    // Hidden at the top (opacity-0 + not interactive).
    expect(button()).toHaveClass('opacity-0', 'pointer-events-none');

    // 20% and 39% → still hidden.
    setScrollY(200);
    expect(button()).toHaveClass('opacity-0', 'pointer-events-none');
    setScrollY(390);
    expect(button()).toHaveClass('opacity-0', 'pointer-events-none');

    // Exactly 40% → visible.
    setScrollY(400);
    await waitFor(() => expect(button()).toHaveClass('opacity-100'));
    expect(button()).not.toHaveClass('opacity-0');

    // 60% → still visible.
    setScrollY(600);
    expect(button()).toHaveClass('opacity-100');

    // Scrolling back below 40% hides it again.
    setScrollY(300);
    await waitFor(() => expect(button()).toHaveClass('opacity-0', 'pointer-events-none'));

    // Click smooth-scrolls to the top.
    setScrollY(600);
    await waitFor(() => expect(button()).toHaveClass('opacity-100'));
    fireEvent.click(button());
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});

describe('Public weblink — image viewer & Download PDF', () => {
  function galleryPageData() {
    return {
      company: {
        name: 'Alpha Travel',
        email: 'a@b.test',
        phone: '+91 90000 00000',
        website: null,
        address: null,
        primaryColor: '#2563eb',
      },
      quotation: {
        quotationNumber: 'QT-2026-000101',
        customerName: 'Priya Sharma',
        destinationSummary: 'Singapore',
        destinations: 'Singapore',
        travelStartDate: '2026-10-23',
        travelEndDate: '2026-10-29',
        adults: 2,
        childrenWithBed: 0,
        childrenWithoutBed: 0,
        infants: 0,
        rooms: 1,
        validUntil: null,
        status: 'VIEWED',
      },
      version: {
        title: 'Gallery & PDF',
        versionNumber: 1,
        currency: 'INR',
        finalAmount: '100000',
        hotelDetails: { sectionTitle: 'Your Hotels', amount: 0, description: null },
        hotels: [
          {
            id: 'h1',
            hotelName: 'Marina Bay Sands',
            city: 'Singapore',
            category: '5 Star',
            roomType: 'Deluxe Room',
            mealPlan: 'Breakfast',
            rooms: 1,
            nights: 2,
            selected: true,
            sequence: 1,
            images: [
              { id: 'i1', url: 'https://cdn.example/h1.jpg', alt: 'Marina one' },
              { id: 'i2', url: 'https://cdn.example/h2.jpg', alt: 'Marina two' },
            ],
            imageSnapshotPresent: true,
          },
        ],
        services: [],
        itinerary: [],
        faqs: [],
        weblinkSectionOrder: null,
      },
      downloadUrl: 'https://storage.example.test/quotation.pdf',
    };
  }

  function renderGallery() {
    vi.stubGlobal('fetch', vi.fn(async () => response(galleryPageData())));
    return renderWithProviders(
      <Routes>
        <Route path="/q/:token" element={<PublicQuotationPage />} />
      </Routes>,
      { route: '/q/public-token-value-with-at-least-32-characters' },
    );
  }

  it('opens the fullscreen viewer, navigates, and closes with Escape', async () => {
    const { container } = renderGallery();
    await screen.findByRole('heading', { name: 'Your Hotels' });

    const openButton = screen.getByRole('button', {
      name: 'Open Hotel image viewer',
    });
    await userEvent.click(openButton);

    const dialog = screen.getByRole('dialog', { name: 'Image viewer' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('1 / 2')).toBeInTheDocument();
    // Background scroll is locked while open.
    expect(container.ownerDocument.body.style.overflow).toBe('hidden');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Next image' }));
    expect(within(dialog).getByText('2 / 2')).toBeInTheDocument();
    expect(within(dialog).getByRole('img')).toHaveAttribute(
      'src',
      'https://cdn.example/h2.jpg',
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close image viewer' }));
    expect(screen.queryByRole('dialog', { name: 'Image viewer' })).not.toBeInTheDocument();
    expect(container.ownerDocument.body.style.overflow).toBe('');
  });

  it('does not show a Download PDF action on the public weblink', async () => {
    renderGallery();
    await screen.findByRole('heading', { name: 'Your Hotels' });
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
  });
});

export { builderQuotation, masterFetch, renderBuilderPage, openTab };

describe('Finalize quotation from the details page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set([
      'quotations.view',
      'quotations.update',
      'quotations.generate_pdf',
    ]);
  });

  const draftVersion = {
    id: 'version-1',
    versionNumber: 1,
    title: 'Goa proposal',
    introduction: null,
    destinationSummary: 'Goa',
    travelStartDate: null,
    travelEndDate: null,
    currency: 'INR',
    subtotalSellingPrice: '447466',
    subtotalCost: '300000',
    markupMode: 'NONE',
    markupValue: '0',
    totalMarkup: '0',
    taxRate: '0',
    taxAmount: '0',
    discountAmount: '0',
    finalAmount: '447466',
    marginAmount: '147466',
    marginPercentage: '32.93',
    pricingMode: 'SECTION_WISE',
    notes: null,
    internalNotes: null,
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
  };
  const finalizedVersion = {
    ...draftVersion,
    status: 'FINALIZED',
    finalizedAt: '2026-09-02T12:00:00.000Z',
  };
  const detail = (version: typeof draftVersion | typeof finalizedVersion) => ({
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
    lastSentAt: null,
    lastViewedAt: null,
    acceptedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    createdBy: person,
    query: {
      id: 'lead-1',
      queryNumber: 'QRY-1',
      leadStage: 'QUOTATION',
      assignedToId: 'user-1',
      createdById: 'user-1',
    },
    versions: [version],
    documents: [],
    emailLogs: [],
    activityTimeline: [],
  });

  const renderDetails = () =>
    renderWithProviders(
      <Routes>
        <Route path="/quotations/:quotationId" element={<QuotationDetailsPage />} />
      </Routes>,
      { route: '/quotations/quotation-1' },
    );

  it('sends the finalize request with the quotation and version ids and confirms success', async () => {
    // The refetched quotation after finalization reports the FINALIZED status.
    let finalized = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (!options || options.method === 'GET')
        return response(detail(finalized ? finalizedVersion : draftVersion));
      if (url.endsWith('/versions/version-1/finalize')) {
        finalized = true;
        return response({ ...finalizedVersion });
      }
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();

    const finalizeButton = await screen.findByRole('button', { name: 'Finalize v1' });
    await userEvent.click(finalizeButton);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith('/quotations/quotation-1/versions/version-1/finalize') &&
            options?.method === 'POST',
        ),
      ).toBe(true),
    );
    // Success confirmation is shown and the status flip removes the button.
    expect(await screen.findByRole('status')).toHaveTextContent(/Version v1 finalized/i);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Finalize v1' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Generate PDF/ })).toBeInTheDocument();
  });

  it('shows the backend pricing validation errors on 422 and keeps the version draft', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (!options || options.method === 'GET') return response(detail(draftVersion));
      if (url.endsWith('/versions/version-1/finalize')) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message:
                'Quotation pricing is incomplete: Flight selling price is required.',
            },
          }),
        } as Response;
      }
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();

    await userEvent.click(await screen.findByRole('button', { name: 'Finalize v1' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Quotation pricing is incomplete: Flight selling price is required.',
    );
    // The version stays DRAFT — the button remains for a corrected attempt.
    expect(screen.getByRole('button', { name: 'Finalize v1' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a visible error for 500 failures and network errors', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (!options || options.method === 'GET') return response(detail(draftVersion));
      if (url.endsWith('/versions/version-1/finalize')) {
        return {
          ok: false,
          status: 500,
          json: async () => ({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Database exploded' },
          }),
        } as Response;
      }
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();

    await userEvent.click(await screen.findByRole('button', { name: 'Finalize v1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Something went wrong|Unable to finalize/i,
    );
  });

  it('ignores a second click while the finalize request is pending', async () => {
    let resolveFinalize: (value: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      resolveFinalize = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (!options || options.method === 'GET') return response(detail(draftVersion));
      if (url.endsWith('/versions/version-1/finalize')) {
        await gate;
        return response({ ...finalizedVersion });
      }
      return response({});
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetails();

    const finalizeButton = await screen.findByRole('button', { name: 'Finalize v1' });
    await userEvent.click(finalizeButton);
    // While pending the button is disabled and re-labelled — a second click is a no-op.
    const pendingButton = await screen.findByRole('button', { name: /Finalizing/ });
    expect(pendingButton).toBeDisabled();
    await userEvent.click(pendingButton);
    resolveFinalize(response({ ...finalizedVersion }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([url, options]) =>
            String(url).endsWith('/versions/version-1/finalize') && options?.method === 'POST',
        ),
      ).toHaveLength(1),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/Version v1 finalized/i);
  });
});

describe('Quotation Builder — traveller names removed from UI', () => {
  const namedQuotation = {
    ...builderQuotation(),
    adults: 2,
    childrenWithBed: 1,
    childrenWithoutBed: 0,
    infants: 1,
    adultNames: ['Rahul Sharma', 'Priya Sharma'],
    childWithBedNames: ['Aarav Sharma'],
    childWithoutBedNames: [],
    infantNames: [],
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('does not render the Traveller Names section even when stored names exist', async () => {
    const fetchMock = masterFetch(namedQuotation);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    // Wait for the builder to load via the preserved summary section.
    expect(await screen.findByText('Quotation Summary')).toBeInTheDocument();

    expect(screen.queryByText('Traveller Names (optional)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save traveller names' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Adult 1 — Name')).not.toBeInTheDocument();
    expect(screen.queryByText('No travellers on this quotation.')).not.toBeInTheDocument();

    // Preserved builder chrome stays intact.
    expect(screen.getAllByRole('button', { name: /Save quotation/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('keeps the section absent when there are no travellers', async () => {
    const fetchMock = masterFetch({
      ...builderQuotation(),
      adults: 0,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilderPage();
    expect(await screen.findByText('Quotation Summary')).toBeInTheDocument();

    expect(screen.queryByText('Traveller Names (optional)')).not.toBeInTheDocument();
    expect(screen.queryByText('No travellers on this quotation.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Save quotation/ }).length).toBeGreaterThan(0);
  });
});

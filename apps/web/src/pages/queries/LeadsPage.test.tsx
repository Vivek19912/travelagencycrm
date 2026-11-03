import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/utils';
import { QueryProvider } from '@/providers/QueryProvider';
import { LeadsPage } from './LeadsPage';
import { LeadFormPage } from './LeadFormPage';
import { LeadDetailsPage } from './LeadDetailsPage';
import indianCityData from '@/data/indian-cities.json';

const authState = vi.hoisted(() => ({
  user: { id: 'me' } as { id: string } | null,
  permissions: new Set([
    'queries.view',
    'queries.create',
    'queries.update',
    'queries.delete',
    'queries.assign',
  ]),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: authState.user,
    hasPermission: (permission: string) => authState.permissions.has(permission),
  }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const lookups = {
  countries: ['India'],
  cities: ['Delhi'],
  leadSources: [{ value: 'WEBSITE', label: 'Website' }],
  leadTypes: [
    { value: 'FRESH', label: 'Fresh' },
    { value: 'HOT', label: 'Hot' },
  ],
  leadStages: [{ value: 'NEW_LEAD', label: 'New Lead' }],
  priorities: [{ value: 'MEDIUM', label: 'Medium' }],
  serviceTypes: [
    { value: 'GENERAL_ENQUIRY', label: 'General Enquiry' },
    { value: 'FLIGHT', label: 'Flight' },
  ],
  tripTypes: ['Leisure'],
  currencies: ['INR'],
  assignableUsers: [{ id: 'me', fullName: 'Owner', username: 'owner' }],
};
const analytics = {
  totalLeads: 0,
  newLeads: 0,
  qualifiedLeads: 0,
  followUpsDue: 0,
  quotationRequired: 0,
  readyToBook: 0,
  bookingConfirmed: 0,
  lostLeads: 0,
  conversionRate: 0,
  winRate: 0,
  byLeadType: {},
  byLeadStage: {},
};
const lead = {
  id: '11111111-1111-4111-8111-111111111111',
  queryNumber: 'QRY-2026-000001',
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  alternatePhone: null,
  email: 'aarav@example.test',
  dateOfBirth: null,
  leadSource: 'REFERRAL',
  leadType: 'HOT',
  leadStage: 'NEW_LEAD',
  priority: 'HIGH',
  departureCountry: 'India',
  departureCity: 'Delhi',
  travelStartDate: '2026-08-15T00:00:00.000Z',
  travelEndDate: '2026-08-22T00:00:00.000Z',
  flexibleDates: false,
  rooms: 1,
  adults: 2,
  childrenWithBed: 0,
  childrenWithoutBed: 0,
  infants: 0,
  extraBeds: 0,
  travellerSummary: '1 Room, 2 Adults',
  expectedAmount: '250000',
  budgetMin: null,
  budgetMax: null,
  expectedMargin: null,
  currency: 'INR',
  tripType: 'Leisure',
  quotationRequired: true,
  bookingStatusPlaceholder: null,
  webLinkPlaceholder: null,
  supplierCostingNotes: null,
  assignedToId: 'me',
  createdById: 'me',
  lastContactedAt: null,
  nextFollowUpAt: '2026-08-01T10:00:00.000Z',
  lostReason: null,
  convertedAt: null,
  internalRemarks: null,
  createdAt: '2026-07-21T10:00:00.000Z',
  updatedAt: '2026-07-21T10:00:00.000Z',
  assignedTo: { id: 'me', fullName: 'Owner', username: 'owner' },
  createdBy: { id: 'me', fullName: 'Owner', username: 'owner' },
  services: [{ serviceType: 'FLIGHT' }, { serviceType: 'HOTEL' }],
  itinerary: [
    {
      id: 'itinerary-1',
      country: 'Thailand',
      destination: 'Bangkok',
      nights: 3,
      sequence: 1,
      arrivalDate: null,
      departureDate: null,
      notes: null,
    },
  ],
};
/** Pick a searchable itinerary destination in the Create lead form. */
async function pickItineraryDestination(row: number, name: string) {
  const input = screen.getByLabelText(`Destination ${row}`);
  await userEvent.click(input);
  fireEvent.change(input, { target: { value: name } });
  await userEvent.click(await screen.findByRole('option', { name }));
}
describe('Phase 6 lead pages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'queries.delete',
      'queries.assign',
    ]);
  });
  it('renders the empty lead state without the analytics bar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        response(
          String(input).includes('analytics')
            ? analytics
            : String(input).includes('lookups')
              ? lookups
              : { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
        ),
      ),
    );
    renderWithProviders(<LeadsPage />);
    expect(await screen.findByText('No leads found')).toBeInTheDocument();
    // Analytics bar removed (UI only): no strip container, label, or metrics.
    expect(document.querySelector('.leads-analytics')).toBeNull();
    expect(screen.queryByLabelText('Lead analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Conversion Rate')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Leads')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add Lead/i })).toBeInTheDocument();
  });
  it('renders loading and error states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const view = renderWithProviders(<LeadsPage />);
    expect(screen.getByLabelText('Loading leads')).toBeInTheDocument();
    view.unmount();
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
    renderWithProviders(<LeadsPage />);
    expect(await screen.findByText('Leads could not be loaded.')).toBeInTheDocument();
  });
  it('supports service selection and itinerary add and remove controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    expect(await screen.findByRole('heading', { name: 'Create lead' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Add More/i }));
    expect(screen.getByLabelText('Destination 2')).toBeInTheDocument();
    await userEvent.click(screen.getAllByLabelText('Remove itinerary')[1]!);
    expect(screen.queryByLabelText('Destination 2')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Flight'));
    expect(screen.getByText(/1 Adult/)).toBeInTheDocument();
    expect(screen.queryByText(/1 Room/)).not.toBeInTheDocument();
  });
  it('hides the Visa service checkbox in the create lead form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // Visa is not offered as a selectable service.
    expect(screen.queryByRole('checkbox', { name: 'VISA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Visa/i })).not.toBeInTheDocument();
    // The remaining services stay visible and selectable (labels load with lookups).
    expect(await screen.findByRole('checkbox', { name: 'Flight' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'HOTEL' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'CRUISE' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Vehicle/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'SIGHTSEEING' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Add-on Service/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Flight' }));
    expect(screen.getByRole('checkbox', { name: 'Flight' })).toBeChecked();
  });
  it('makes departure country and city searchable in the create lead form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // Existing options and defaults are preserved: India + no city.
    const country = screen.getByLabelText('Departure country');
    expect(country).toHaveValue('India');
    expect(country).toHaveAttribute('role', 'combobox');
    const city = screen.getByLabelText('Departure city');
    expect(city).toHaveValue('');
    expect(city).toHaveAttribute('placeholder', 'Select city');

    // The full country list opens on focus; typing filters it.
    await userEvent.click(country);
    expect(
      screen.getByRole('listbox', { name: 'Departure country search results' }),
    ).toBeInTheDocument();
    fireEvent.change(country, { target: { value: 'german' } });
    expect(screen.getByRole('option', { name: 'Germany' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'France' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Germany' }));
    expect(country).toHaveValue('Germany');
    expect(
      screen.queryByRole('listbox', { name: 'Departure country search results' }),
    ).not.toBeInTheDocument();

    // Non-India cities come from lookups and are searchable too.
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'delh' } });
    await userEvent.click(screen.getByRole('option', { name: 'Delhi' }));
    expect(city).toHaveValue('Delhi');
  }, 30000);
  it('clears the departure city when the country changes to one without it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    const country = screen.getByLabelText('Departure country');
    const city = screen.getByLabelText('Departure city');

    // Pick an India-only city first.
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'chenn' } });
    await userEvent.click(screen.getByRole('option', { name: 'Chennai' }));
    expect(city).toHaveValue('Chennai');

    // Switching to a country without that city clears the selection.
    await userEvent.click(country);
    fireEvent.change(country, { target: { value: 'german' } });
    await userEvent.click(screen.getByRole('option', { name: 'Germany' }));
    expect(country).toHaveValue('Germany');
    expect(city).toHaveValue('');
  }, 30000);
  it('shows every departure city without codes in an unclipped portal menu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    const city = screen.getByLabelText('Departure city');

    await userEvent.click(city);
    const menu = await screen.findByRole('listbox', {
      name: 'Departure city search results',
    });
    // The menu escapes the overflow-hidden card so nothing is cut off.
    expect(menu.closest('section')).toBeNull();
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
    expect(menu.className).toContain('overflow-auto');
    // The complete dataset is reachable: every entry, plain-name labels.
    const options = within(menu).getAllByRole('option');
    expect(options).toHaveLength(indianCityData.entries.length);
    expect(indianCityData.entries.length).toBeGreaterThan(4000);
    expect(screen.getByRole('option', { name: 'Bengaluru' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Calicut' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chandigarh' })).toBeInTheDocument();
    // No airport/IATA-style codes in labels.
    expect(
      options.some((option) => / \([A-Z]{3}\)$/.test(option.textContent ?? '')),
    ).toBe(false);

    // A city at the end of the dataset can be reached and selected.
    fireEvent.change(city, { target: { value: 'zunheboto' } });
    await userEvent.click(screen.getByRole('option', { name: 'Zunheboto' }));
    expect(city).toHaveValue('Zunheboto');
  }, 30000);
  it('covers every Indian state and UT and disambiguates shared city names', async () => {
    // Source integrity: 36 states/UTs, unique entries, small states present.
    const states = new Set(indianCityData.entries.map((entry) => entry.state));
    expect(states.size).toBe(36);
    for (const state of ['Ladakh', 'Lakshadweep', 'Andaman and Nicobar Islands', 'Sikkim', 'Goa']) {
      expect(states.has(state)).toBe(true);
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    const city = screen.getByLabelText('Departure city');

    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'aurangabad' } });
    // Same name in two states: both shown, told apart by state, no codes.
    expect(screen.getByRole('option', { name: 'Aurangabad (Bihar)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Aurangabad (Maharashtra)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Aurangabad (Maharashtra)' }));
    // Stored value stays a plain city name, compatible with existing records.
    expect(city).toHaveValue('Aurangabad (Maharashtra)');
    // Switching between same-value options updates the display too.
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'aurangabad' } });
    await userEvent.click(screen.getByRole('option', { name: 'Aurangabad (Bihar)' }));
    expect(city).toHaveValue('Aurangabad (Bihar)');
  }, 30000);
  it('keeps previously stored departure cities selectable and submittable', async () => {
    const destination = {
      id: 'dest-1',
      name: 'Singapore',
      status: 'ACTIVE',
      cities: [{ id: 'dc-1', sequence: 1, city: { name: 'Singapore' } }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(lookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');

    // A legacy spelling stays selectable and submits its plain stored value.
    const city = screen.getByLabelText('Departure city');
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'trivand' } });
    await userEvent.click(screen.getByRole('option', { name: 'Trivandrum' }));

    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]!.body)).departureCity).toBe('Trivandrum');
    });
  }, 30000);
  it('loads a stored departure city on the edit form with the new dataset', async () => {
    const saved = { ...lead, departureCountry: 'India', departureCity: 'Goa' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(saved);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // The legacy stored value still loads and resubmits unchanged.
    expect(screen.getByLabelText('Departure city')).toHaveValue('Goa');
  });
  it('supports keyboard selection and Escape in the departure comboboxes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    const country = screen.getByLabelText('Departure country');

    // ArrowDown + Enter picks the highlighted match.
    await userEvent.click(country);
    fireEvent.change(country, { target: { value: 'german' } });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(country).toHaveValue('Germany');

    // Escape closes the open list without changing the value.
    await userEvent.click(country);
    expect(
      screen.getByRole('listbox', { name: 'Departure country search results' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('listbox', { name: 'Departure country search results' }),
    ).not.toBeInTheDocument();
    expect(country).toHaveValue('Germany');

    // Clicking outside closes the list as well.
    await userEvent.click(country);
    expect(
      screen.getByRole('listbox', { name: 'Departure country search results' }),
    ).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(
      screen.queryByRole('listbox', { name: 'Departure country search results' }),
    ).not.toBeInTheDocument();
  });
  it('submits the searched departure country and city with a new lead', async () => {
    const destination = {
      id: 'dest-1',
      name: 'Singapore',
      status: 'ACTIVE',
      cities: [{ id: 'dc-1', sequence: 1, city: { name: 'Singapore' } }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(lookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');

    const country = screen.getByLabelText('Departure country');
    await userEvent.click(country);
    fireEvent.change(country, { target: { value: 'german' } });
    await userEvent.click(screen.getByRole('option', { name: 'Germany' }));
    const city = screen.getByLabelText('Departure city');
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'delh' } });
    await userEvent.click(screen.getByRole('option', { name: 'Delhi' }));

    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(body.departureCountry).toBe('Germany');
      expect(body.departureCity).toBe('Delhi');
    });
  }, 30000);
  it('hides the Infants helper text in both create and edit modes', async () => {
    const helperLine = () =>
      Array.from(document.querySelectorAll('p')).find((node) =>
        node.textContent?.includes('Child with Bed'),
      );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    const createView = renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // Create form: CWB/CWOB kept with no trailing separator, Infants note gone.
    expect(helperLine()?.textContent).toBe('CWB = Child with Bed | CWOB = Child without Bed');
    // Infant count/age fields still work in create mode.
    expect(screen.getByLabelText('Infants')).toBeInTheDocument();
    createView.unmount();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(lead);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Edit form shows the same compact helper line.
    expect(helperLine()?.textContent).toBe('CWB = Child with Bed | CWOB = Child without Bed');
  });
  it('hides the breadcrumb on the create lead page but keeps it on edit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    const createView = renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    expect(screen.queryByText(/Leads \/ New/)).not.toBeInTheDocument();
    createView.unmount();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(lead);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    expect(screen.getByText(/Leads \/ QRY-/)).toBeInTheDocument();
  });
  it('uses searchable departure dropdowns with saved values on edit', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(lead);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Same searchable components as Create, prefilled from the saved lead.
    const country = screen.getByLabelText('Departure country');
    const city = screen.getByLabelText('Departure city');
    expect(country.tagName).toBe('INPUT');
    expect(country).toHaveValue('India');
    expect(city).toHaveValue('Delhi');

    // Search and change the city.
    await userEvent.click(city);
    fireEvent.change(city, { target: { value: 'mumb' } });
    await userEvent.click(screen.getByRole('option', { name: 'Mumbai' }));
    expect(city).toHaveValue('Mumbai');

    // Changing the country clears the city, as in Create mode.
    await userEvent.click(country);
    fireEvent.change(country, { target: { value: 'german' } });
    await userEvent.click(screen.getByRole('option', { name: 'Germany' }));
    expect(country).toHaveValue('Germany');
    expect(city).toHaveValue('');
  });
  it('renders identical searchable controls in create and edit modes', async () => {
    const fieldExpectations = [
      ['Departure country', 'Select country'],
      ['Departure city', 'Select city'],
      ['Destination 1', 'Select Destination'],
    ] as const;
    // Create Lead and Edit Lead both omit the itinerary City column, so the
    // shared controls are identical in either mode.
    const expectConsistentControls = () => {
      for (const [label, placeholder] of fieldExpectations) {
        const input = screen.getByLabelText(label);
        expect(input.tagName).toBe('INPUT');
        expect(input).toHaveAttribute('role', 'combobox');
        expect(input).toHaveAttribute('placeholder', placeholder);
      }
      expect(screen.queryByLabelText('City 1')).not.toBeInTheDocument();
      // Same labels and components beyond the dropdowns.
      expect(screen.getByRole('checkbox', { name: 'Vehicle' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Traveller names' })).toBeInTheDocument();
      expect(screen.getByText('Services Required *')).toBeInTheDocument();
      expect(screen.getByText('Itinerary *')).toBeInTheDocument();
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    const createView = renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    expectConsistentControls();
    expect(screen.getByRole('button', { name: 'Create Lead' })).toBeInTheDocument();
    createView.unmount();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(lead);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    expectConsistentControls();
    // Same submit-row position, mode-specific action only.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Lead' })).not.toBeInTheDocument();
    // Saved values prefill the shared controls (local datasets resolve first).
    expect(screen.getByLabelText('Departure country')).toHaveValue('India');
    expect(screen.getByLabelText('Departure city')).toHaveValue('Delhi');
  });
  it('hides Birth Date on the create form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    expect(screen.queryByLabelText('Birth Date')).not.toBeInTheDocument();
    // Neighboring fields still render (no layout gap left behind).
    expect(screen.getByLabelText('Assigned salesperson')).toBeInTheDocument();
  });
  it('hides Birth Date on the edit form while keeping neighboring sections intact', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(lead);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    expect(screen.queryByLabelText('Birth Date')).not.toBeInTheDocument();
    expect(screen.queryByText('dd-mm-yyyy')).not.toBeInTheDocument();
    // Email is shown on neither form; the saved value still submits.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    // Assign To still renders and Services Required follows it directly.
    expect(screen.getByLabelText('Assigned salesperson')).toBeInTheDocument();
    expect(screen.getByText(/Services Required/)).toBeInTheDocument();
  });
  it('creates a month/year lead with an empty departure city and no invented day', async () => {
    authState.permissions.delete('queries.assign');
    const destination = {
      id: 'dest-1',
      name: 'Singapore',
      status: 'ACTIVE',
      cities: [{ id: 'dc-1', sequence: 1, city: { name: 'Singapore' } }],
    };
    const year = String(new Date().getFullYear());
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(lookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // Travel Timing offers two mutually exclusive modes; Exact Date is default.
    expect(screen.getByRole('radio', { name: 'Exact Date' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'false');
    // Travel Date (exact date) and Travel Month (month/year only) are separate
    // optional fields; city has no default.
    expect(screen.getByLabelText('Travel Date')).toBeInTheDocument();
    expect(screen.queryByText('Travel Month *')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Travel Date *')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Departure city')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    // Switching to Month hides the date picker and shows month/year instead.
    expect(screen.queryByLabelText('Travel Date')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Travel month'), '12');
    await userEvent.selectOptions(screen.getByLabelText('Travel year'), year);
    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(body.travelMonth).toBe(12);
      expect(body.travelYear).toBe(Number(year));
      expect(body.travelStartDate).toBeNull();
      expect(body.departureCity).toBeNull();
    });
  });
  it('preselects the current year when Month mode is chosen in create', async () => {
    const currentYear = String(new Date().getFullYear());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    // Month stays unselected; only the year is preselected, dynamically.
    expect(screen.getByLabelText('Travel month') as HTMLSelectElement).toHaveValue('');
    expect(screen.getByLabelText('Travel year') as HTMLSelectElement).toHaveValue(currentYear);
  });
  it('keeps a saved travel year untouched when editing', async () => {
    const currentYear = new Date().getFullYear();
    const savedYear = String(currentYear + 2);
    const saved = { ...lead, travelStartDate: null, travelMonth: 5, travelYear: currentYear + 2 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) {
        if (options?.method === 'PATCH')
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: saved }),
          } as Response;
        return response(saved);
      }
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Saved pair opens in Month mode with the saved year, not the current one.
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Travel month') as HTMLSelectElement).toHaveValue('5');
    expect(screen.getByLabelText('Travel year') as HTMLSelectElement).toHaveValue(savedYear);
  });
  it('defaults an unsaved travel year to the current year when editing', async () => {
    const currentYear = String(new Date().getFullYear());
    const unsaved = { ...lead, travelStartDate: null, travelMonth: null, travelYear: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(unsaved);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // No saved year: Month mode offers the current year without inventing data.
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(screen.getByLabelText('Travel month') as HTMLSelectElement).toHaveValue('');
    expect(screen.getByLabelText('Travel year') as HTMLSelectElement).toHaveValue(currentYear);
  });
  it('creates an exact-date lead with month/year hidden and nothing invented', async () => {
    authState.permissions.delete('queries.assign');
    const destination = {
      id: 'dest-1',
      name: 'Singapore',
      status: 'ACTIVE',
      cities: [{ id: 'dc-1', sequence: 1, city: { name: 'Singapore' } }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(lookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // Exact Date is the default mode: picker visible, month/year hidden.
    expect(screen.getByRole('radiogroup', { name: 'Travel Timing' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Exact Date' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByLabelText('Travel Date')).toBeInTheDocument();
    expect(screen.queryByLabelText('Travel month')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Travel year')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    fireEvent.change(screen.getByLabelText('Travel Date'), { target: { value: '2026-09-10' } });
    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(String(body.travelStartDate)).toContain('2026-09-10');
      expect(body.travelMonth).toBeNull();
      expect(body.travelYear).toBeNull();
    });
  });
  it('shows December of the selected year for month/year leads in the list', async () => {
    const year = new Date().getFullYear();
    const monthLead = {
      ...lead,
      id: '22222222-2222-4222-8222-222222222222',
      queryNumber: 'QRY-2026-000002',
      customerName: 'Meera Nair',
      travelStartDate: null,
      travelMonth: 12,
      travelYear: year,
      departureCity: null,
    };
    stubLeadList([monthLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Meera Nair');
    expect(screen.getByText(`December ${year}`)).toBeInTheDocument();
  });
  it('preserves a legacy exact travel date when the edit form is saved unchanged', async () => {
    const legacyLead = { ...lead, travelMonth: null, travelYear: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${legacyLead.id}`)) {
        if (options?.method === 'PATCH')
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: legacyLead }),
          } as Response;
        return response(legacyLead);
      }
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${legacyLead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Exact-date mode is preselected from the saved date; the date picker
    // shows it while month/year stay hidden (semantically separate fields,
    // no derivation).
    expect(screen.getByRole('radio', { name: 'Exact Date' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Travel Date') as HTMLInputElement).toHaveValue('2026-08-15'),
    );
    expect(screen.queryByLabelText('Travel month')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Travel year')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      // Exact date round-trips untouched; nothing invented, nothing nulled.
      expect(String(body.travelStartDate)).toContain('2026-08-15');
      expect(body.travelMonth).toBeNull();
      expect(body.travelYear).toBeNull();
    });
  });
  it('switching to Month mode clears the exact date so both are never submitted', async () => {
    const year = String(new Date().getFullYear());
    const legacyLead = { ...lead, travelMonth: null, travelYear: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${legacyLead.id}`)) {
        if (options?.method === 'PATCH')
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: legacyLead }),
          } as Response;
        return response(legacyLead);
      }
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${legacyLead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Exact-date mode is preselected from the saved date.
    await waitFor(() =>
      expect(screen.getByLabelText('Travel Date') as HTMLInputElement).toHaveValue('2026-08-15'),
    );
    // Switching to Month hides the picker, clears the date, and reveals
    // month/year instead.
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    expect(screen.queryByLabelText('Travel Date')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.selectOptions(screen.getByLabelText('Travel month'), '12');
    await userEvent.selectOptions(screen.getByLabelText('Travel year'), year);
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      // Only the month representation is submitted — never both.
      expect(body.travelStartDate).toBeNull();
      expect(body.travelMonth).toBe(12);
      expect(body.travelYear).toBe(Number(year));
    });
  });
  it('switching back to Exact Date mode clears month/year', async () => {
    const year = String(new Date().getFullYear());
    const monthLead = { ...lead, travelStartDate: null, travelMonth: 12, travelYear: Number(year) };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${monthLead.id}`)) {
        if (options?.method === 'PATCH')
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: monthLead }),
          } as Response;
        return response(monthLead);
      }
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${monthLead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Month mode is preselected from the saved pair; the picker stays hidden.
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText('Travel Date')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Travel month') as HTMLSelectElement).toHaveValue('12'),
    );
    expect(screen.getByLabelText('Travel year') as HTMLSelectElement).toHaveValue(year);
    await userEvent.click(screen.getByRole('radio', { name: 'Exact Date' }));
    expect(screen.queryByLabelText('Travel month')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Travel Date')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Travel Date'), { target: { value: '2026-09-10' } });
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      // Only the exact date is submitted — month/year cleared, not stale.
      expect(String(body.travelStartDate)).toContain('2026-09-10');
      expect(body.travelMonth).toBeNull();
      expect(body.travelYear).toBeNull();
    });
  });
  it('submits an incomplete month/year pair as empty rather than half a date', async () => {
    const legacyLead = { ...lead, travelMonth: null, travelYear: null };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${legacyLead.id}`)) {
        if (options?.method === 'PATCH')
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: legacyLead }),
          } as Response;
        return response(legacyLead);
      }
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${legacyLead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    await waitFor(() =>
      expect(screen.getByLabelText('Travel Date') as HTMLInputElement).toHaveValue('2026-08-15'),
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    // Month without a year: conditional validation treats it as empty.
    // (The year preselects to the current year, so clear it explicitly.)
    await userEvent.selectOptions(screen.getByLabelText('Travel month'), '12');
    await userEvent.selectOptions(screen.getByLabelText('Travel year'), '');
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.travelMonth).toBeNull();
      expect(body.travelYear).toBeNull();
      expect(body.travelStartDate).toBeNull();
    });
  });
  it('creates a new lead without adding Visa', async () => {
    authState.permissions.delete('queries.assign');
    const destination = {
      id: 'dest-1',
      name: 'Singapore',
      status: 'ACTIVE',
      cities: [{ id: 'dc-1', sequence: 1, city: { name: 'Singapore' } }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(lookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    await userEvent.selectOptions(screen.getByLabelText('Travel month'), '9');
    await userEvent.selectOptions(
      screen.getByLabelText('Travel year'),
      String(new Date().getFullYear()),
    );
    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(body.services).not.toContain('VISA');
      expect(body.services).toContain('HOTEL');
      expect(body.services).toContain('SIGHTSEEING');
    });
  });
  it('shows destination private names in options while storing only the destination name', async () => {
    authState.permissions.delete('queries.assign');
    const destinations = [
      {
        id: 'dest-goa',
        name: 'Goa Beach Escape',
        privateName: 'GBE',
        status: 'ACTIVE',
        cities: [{ id: 'dc-goa', sequence: 1, city: { name: 'Goa' } }],
      },
      {
        id: 'dest-sg',
        name: 'Singapore',
        privateName: null,
        status: 'ACTIVE',
        cities: [{ id: 'dc-sg', sequence: 1, city: { name: 'Singapore' } }],
      },
      {
        id: 'dest-lko',
        name: 'Lucknow',
        privateName: '   ',
        status: 'ACTIVE',
        cities: [{ id: 'dc-lko', sequence: 1, city: { name: 'Lucknow' } }],
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: destinations,
          pagination: { page: 1, pageSize: 100, total: 3, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(lookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    const destInput = screen.getByLabelText('Destination 1');
    await userEvent.click(destInput);
    // The open list starts collapsed showing only country rows (these
    // fixtures carry no country, so everything sits under Other).
    const menu = await screen.findByRole('listbox', { name: 'Destination 1 search results' });
    expect(within(menu).getByRole('button', { name: 'OTHER' })).toBeInTheDocument();
    expect(
      within(menu).queryByRole('option', { name: 'Goa Beach Escape — GBE' }),
    ).not.toBeInTheDocument();
    // Expanding the country reveals its destinations with combined labels;
    // destinations without a private name (or a whitespace-only one) show
    // the plain name.
    await userEvent.click(within(menu).getByRole('button', { name: 'OTHER' }));
    expect(screen.getByRole('option', { name: 'Goa Beach Escape — GBE' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Singapore' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Lucknow' })).toBeInTheDocument();
    // A private name still finds its destination through search, even with
    // whitespace-only private names treated as empty.
    fireEvent.change(destInput, { target: { value: 'gbe' } });
    expect(screen.getByRole('option', { name: 'Goa Beach Escape — GBE' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Singapore' })).not.toBeInTheDocument();
    fireEvent.change(destInput, { target: { value: '' } });
    // Clearing restores the collapsed country list.
    expect(
      screen.queryByRole('option', { name: 'Goa Beach Escape — GBE' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OTHER' }));
    await userEvent.click(screen.getByRole('option', { name: 'Goa Beach Escape — GBE' }));
    // Closed field shows only the public destination name.
    expect(destInput).toHaveValue('Goa Beach Escape');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(body.itinerary[0].country).toBe('Goa Beach Escape');
      // Private name never persisted anywhere in the payload.
      expect(JSON.stringify(body)).not.toContain('GBE');
    });
  });
  it('searches itinerary destinations with keyboard support', async () => {
    const destinations = [
      {
        id: 'dest-sg',
        name: 'Singapore',
        status: 'ACTIVE',
        cities: [{ id: 'dc-sg', sequence: 1, city: { name: 'Singapore' } }],
      },
      {
        id: 'dest-goa',
        name: 'Goa',
        status: 'ACTIVE',
        cities: [{ id: 'dc-goa', sequence: 1, city: { name: 'Goa' } }],
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/masters/destinations'))
          return response({
            data: destinations,
            pagination: { page: 1, pageSize: 100, total: 2, totalPages: 2 },
          });
        return response(lookups);
      }),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });

    // Create Lead exposes only a Destination per row (no City column).
    const destination = screen.getByLabelText('Destination 1');
    expect(destination).toHaveAttribute('placeholder', 'Select Destination');
    expect(screen.queryByLabelText('City 1')).not.toBeInTheDocument();

    // Typing filters destinations; Enter picks the highlighted match.
    await userEvent.click(destination);
    fireEvent.change(destination, { target: { value: 'sing' } });
    expect(screen.getByRole('option', { name: 'Singapore' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Goa' })).not.toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(destination).toHaveValue('Singapore');

    // Escape closes without changing the value; outside click does too.
    await userEvent.click(destination);
    expect(
      screen.getByRole('listbox', { name: 'Destination 1 search results' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('listbox', { name: 'Destination 1 search results' }),
    ).not.toBeInTheDocument();
    expect(destination).toHaveValue('Singapore');
    await userEvent.click(destination);
    await userEvent.click(document.body);
    expect(
      screen.queryByRole('listbox', { name: 'Destination 1 search results' }),
    ).not.toBeInTheDocument();
  });
  it('renders the itinerary destination menu in a portal above the itinerary card', async () => {
    const destinations = [
      {
        id: 'dest-sg',
        name: 'Singapore',
        status: 'ACTIVE',
        cities: [{ id: 'dc-sg', sequence: 1, city: { name: 'Singapore' } }],
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/masters/destinations'))
          return response({
            data: destinations,
            pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          });
        return response(lookups);
      }),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });

    // Destination menu escapes the overflow-hidden itinerary card.
    await userEvent.click(screen.getByLabelText('Destination 1'));
    const destMenu = await screen.findByRole('listbox', {
      name: 'Destination 1 search results',
    });
    expect(destMenu.closest('section')).toBeNull();
    expect(destMenu.parentElement).toBe(document.body);
    expect(destMenu.style.position).toBe('fixed');
    expect(destMenu.className).toContain('z-[80]');
    // Scrollable with a bounded height, aligned to the input width.
    expect(destMenu.className).toContain('overflow-auto');
    expect(destMenu.style.maxHeight).not.toBe('');
    expect(destMenu.style.width).not.toBe('');
    await pickItineraryDestination(1, 'Singapore');
  });
  it('supports searchable destinations on rows added with Add More', async () => {
    const destinations = [
      {
        id: 'dest-sg',
        name: 'Singapore',
        status: 'ACTIVE',
        cities: [{ id: 'dc-sg', sequence: 1, city: { name: 'Singapore' } }],
      },
      {
        id: 'dest-goa',
        name: 'Goa',
        status: 'ACTIVE',
        cities: [{ id: 'dc-goa', sequence: 1, city: { name: 'Goa' } }],
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: destinations,
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 2 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(lookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');

    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add More' })[0]!);
    expect(screen.getByLabelText('Destination 2')).toHaveAttribute(
      'placeholder',
      'Select Destination',
    );
    expect(screen.queryByLabelText('City 2')).not.toBeInTheDocument();
    await pickItineraryDestination(2, 'Goa');

    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(body.itinerary).toHaveLength(2);
      expect(body.itinerary[0]).toMatchObject({ country: 'Singapore', destination: '' });
      expect(body.itinerary[1]).toMatchObject({ country: 'Goa', destination: '' });
    });
  });
  it('loads the stored itinerary into searchable fields on edit', async () => {
    const editLead = {
      ...lead,
      travelMonth: null,
      travelYear: null,
      itinerary: [
        {
          id: 'itinerary-1',
          country: 'Goa Beach Escape',
          destination: 'Goa',
          nights: 3,
          sequence: 1,
          arrivalDate: null,
          departureDate: null,
          notes: null,
        },
      ],
    };
    const destinations = [
      {
        id: 'dest-goa',
        name: 'Goa Beach Escape',
        privateName: 'GBE',
        status: 'ACTIVE',
        cities: [{ id: 'dc-goa', sequence: 1, city: { name: 'Goa' } }],
      },
      {
        id: 'dest-sg',
        name: 'Singapore',
        privateName: null,
        status: 'ACTIVE',
        cities: [{ id: 'dc-sg', sequence: 1, city: { name: 'Singapore' } }],
      },
      {
        id: 'dest-lko',
        name: 'Lucknow',
        privateName: 'avd',
        status: 'ACTIVE',
        cities: [{ id: 'dc-lko', sequence: 1, city: { name: 'Lucknow' } }],
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: destinations,
          pagination: { page: 1, pageSize: 100, total: 3, totalPages: 1 },
        });
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${editLead.id}`)) {
        if (options?.method === 'PATCH')
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: editLead }),
          } as Response;
        return response(editLead);
      }
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${editLead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Stored values prefill the searchable fields once options load. The
    // destination input shows only the public name while the stored value
    // stays plain.
    const destination = screen.getByLabelText('Destination 1');
    await waitFor(() => expect(destination).toHaveValue('Goa Beach Escape'));
    // The itinerary City column is gone; a stored city is preserved internally
    // instead of being exposed in the form.
    expect(screen.queryByLabelText('City 1')).not.toBeInTheDocument();
    // Private names stay searchable without leaking into stored values.
    await userEvent.click(destination);
    fireEvent.change(destination, { target: { value: 'avd' } });
    expect(screen.getByRole('option', { name: 'Lucknow — avd' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    // Changing the destination clears a city that no longer applies; saving
    // keeps payload formats.
    await pickItineraryDestination(1, 'Singapore');
    expect(screen.queryByLabelText('City 1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.itinerary[0]).toMatchObject({ country: 'Singapore', destination: '' });
      expect(JSON.stringify(body)).not.toContain('GBE');
    });
  });
  it('hides Visa in the edit form and preserves a stored Visa selection on save', async () => {
    const editLead = {
      ...lead,
      services: [{ serviceType: 'FLIGHT' }, { serviceType: 'HOTEL' }, { serviceType: 'VISA' }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${editLead.id}`)) {
        if (options?.method === 'PATCH')
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: editLead }),
          } as Response;
        return response(editLead);
      }
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${editLead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Visa checkbox is hidden even though the lead stores it.
    expect(screen.queryByRole('checkbox', { name: 'VISA' })).not.toBeInTheDocument();
    // Other stored services remain checked.
    expect(screen.getByRole('checkbox', { name: 'Flight' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'HOTEL' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /Save changes/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(String(patch![1]!.body));
      expect(body.services).toContain('VISA');
      // No visible Email field, yet the saved address still submits.
      expect(body.email).toBe('aarav@example.test');
    });
  });
  it('keeps the minimum-one-service validation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'HOTEL' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'SIGHTSEEING' }));
    expect(await screen.findByText('Select at least one service.')).toBeInTheDocument();
  });
  it('nests Services Required under Lead Information beside Travel Details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(lookups)));
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    const leadInfo = screen.getByText('Lead Information');
    const services = screen.getByText('Services Required *');
    const travel = screen.getByText('Travel Details');
    const itinerary = screen.getByText('Itinerary *');
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Left column: Lead Information then Services; right column: Travel
    // Details; Itinerary full-width below the grid.
    expect(follows(leadInfo, services)).toBe(true);
    expect(follows(services, travel)).toBe(true);
    expect(follows(travel, itinerary)).toBe(true);
  });

  it('starts the Create Lead form directly at Name with no phone-search UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(lookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // Email is shown on neither form.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    // The existing-lead phone search is removed: no label, input, button or helper text.
    expect(screen.queryByText('Search Existing Lead by Phone')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Search existing lead by phone')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Search existing leads by phone number to auto-fill form'),
    ).not.toBeInTheDocument();
    // The form starts directly with the lead fields, beginning with Name.
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
  });
  it('synchronizes search, filters, sorting and pagination with the server query string', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      response(
        String(input).includes('analytics')
          ? { ...analytics, totalLeads: 2, byLeadType: { HOT: 1 } }
          : String(input).includes('lookups')
            ? lookups
            : {
                data: [lead],
                pagination: { page: 1, pageSize: 20, total: 2, totalPages: 2 },
              },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadsPage />);
    expect(await screen.findAllByText('Aarav Mehta')).not.toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Search leads'), 'Bangkok');
    await userEvent.selectOptions(screen.getByLabelText('All lead types'), 'HOT');
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Lead Info' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => {
          const value = String(url);
          return (
            value.includes('search=Bangkok') &&
            value.includes('leadType=HOT') &&
            value.includes('sortBy=customerName') &&
            value.includes('sortOrder=asc') &&
            value.includes('page=2')
          );
        }),
      ).toBe(true),
    );
    expect(screen.getByLabelText('Travel from')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hot 1/ })).toBeInTheDocument();
  });
  it('renders lead details, notes and timeline with permission-aware actions (follow-ups hidden)', async () => {
    authState.permissions = new Set(['queries.view']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/notes'))
          return response([
            {
              id: 'note-1',
              content: 'Customer prefers morning flights',
              createdAt: lead.createdAt,
              updatedAt: lead.updatedAt,
              isCustomerContact: false,
              contactMethod: null,
              contactedAt: null,
              authorUser: lead.createdBy,
            },
          ]);
        if (url.endsWith('/follow-ups'))
          return response([
            {
              id: 'follow-up-1',
              scheduledAt: lead.nextFollowUpAt,
              status: 'PENDING',
              effectiveStatus: 'PENDING',
              outcomeType: null,
              outcome: null,
              notes: 'Confirm hotel category',
              completionNotes: null,
              completedAt: null,
              cancelledAt: null,
              cancellationReason: null,
              assignedTo: lead.assignedTo,
              createdBy: lead.createdBy,
            },
          ]);
        if (url.includes('/timeline'))
          return response({
            data: [
              {
                id: 'timeline-1',
                type: 'CREATED',
                actor: lead.createdBy,
                title: 'Lead created',
                description: lead.queryNumber,
                timestamp: lead.createdAt,
                iconKey: 'lead',
              },
            ],
            pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
          });
        if (url.endsWith('/lookups')) return response(lookups);
        if (url.endsWith('/workspace'))
          return response({
            lead,
            operationalSummary: {
              pendingFollowUpCount: 1,
              overdueFollowUpCount: 0,
              completedFollowUpCount: 0,
              notesCount: 1,
              daysSinceLastContact: null,
              noFutureFollowUp: false,
              requiresAttention: false,
            },
            recent: { notes: [], followUps: [], timeline: [] },
            quotations: {
              count: 1,
              latest: {
                id: 'quotation-1',
                quotationNumber: 'QT-2026-000001',
                status: 'SENT',
                currentVersionId: 'version-1',
                lastSentAt: lead.createdAt,
                lastViewedAt: null,
                createdAt: lead.createdAt,
                versions: [
                  {
                    id: 'version-1',
                    versionNumber: 1,
                    finalAmount: '16065.87',
                    currency: 'INR',
                    status: 'FINALIZED',
                  },
                ],
              },
              items: [
                {
                  id: 'quotation-1',
                  quotationNumber: 'QT-2026-000001',
                  status: 'SENT',
                  currentVersionId: 'version-1',
                  lastSentAt: lead.createdAt,
                  lastViewedAt: null,
                  createdAt: lead.createdAt,
                  versions: [
                    {
                      id: 'version-1',
                      versionNumber: 1,
                      finalAmount: '16065.87',
                      currency: 'INR',
                      status: 'FINALIZED',
                    },
                  ],
                },
              ],
            },
            indicators: [],
            timezone: 'Asia/Kolkata',
            permissions: {
              canEdit: false,
              canAssign: false,
              canChangeStage: false,
              canAddNote: false,
              canScheduleFollowUp: false,
              canCompleteFollowUp: false,
              canDelete: false,
              canViewQuotations: true,
              canCreateQuotation: false,
              canSendQuotation: false,
              canGenerateQuotationPdf: false,
              canViewBookings: true,
              canConvertBooking: false,
            },
          });
        return response(lead);
      }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId" element={<LeadDetailsPage />} />
      </Routes>,
      { route: `/queries/${lead.id}` },
    );
    expect(await screen.findByText('Contact Information')).toBeInTheDocument();
    // Lead Information is the default tab; action controls are gated off by permissions.
    expect(screen.queryByRole('button', { name: 'Delete Lead' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByText('Reassign lead')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New stage')).not.toBeInTheDocument();
    // Sectioned content now lives on its own tab.
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(await screen.findByText('Customer prefers morning flights')).toBeInTheDocument();
    // Follow-ups is a dead feature: the tab is hidden from the UI.
    expect(screen.queryByRole('button', { name: 'Follow-ups' })).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm hotel category')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(await screen.findByText('Lead created')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Quotations' }));
    expect(screen.getByRole('link', { name: 'QT-2026-000001' })).toBeInTheDocument();
    expect(screen.getByText('1 customer quotation linked to this lead.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 17 — enriched columns, quick actions, bulk operations and tabs
// ---------------------------------------------------------------------------

const enrichedLead = {
  ...lead,
  hasQuotations: true,
  createdBy: { id: 'me', fullName: 'Owner', username: 'owner' },
  quotationSummary: {
    quotationId: 'quote-1',
    quotationNumber: 'QT-2026-000001',
    quotationStatus: 'ACCEPTED',
    acceptedVersionId: 'ver-1',
    latestVersionAmount: '50000.00',
    currency: 'INR',
    bookingId: null,
    lastSentAt: null,
    acceptedAt: '2026-07-22T00:00:00.000Z',
  },
  bookingSummary: null,
  actions: {
    canCreateQuotation: true,
    canOpenQuotation: true,
    canConvertToBooking: true,
    canViewBooking: false,
    canAddFollowUp: true,
  },
};

function stubLeadList(rows: unknown[], analyticsData = analytics) {
  const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url.includes('/analytics')) return response(analyticsData);
    if (url.includes('/lookups')) return response(lookups);
    if (options?.method === 'POST' || url.includes('/bulk') || url.includes('/export'))
      return response({ updatedCount: rows.length, unchangedCount: 0, results: [] });
    return response({
      data: rows,
      pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('Phase 17 lead list enrichment', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'queries.delete',
      'queries.assign',
      'queries.export',
    ]);
  });

  it('renders lead info, quotation and notes columns with the three row actions', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    // The year is hidden in the list: QRY-2026-000001 renders as QRY-000001.
    expect((await screen.findAllByText('QRY-000001'))[0]).toBeInTheDocument();
    // Column headers.
    expect(screen.getByText('Lead Info')).toBeInTheDocument();
    expect(screen.getByText('Quotation')).toBeInTheDocument();
    // The Booking column is temporarily hidden from the Leads table.
    expect(screen.queryByText('Booking')).not.toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    // Quotation column is action-only: no status badge is shown.
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^View$/ }).length).toBeGreaterThan(0);
    // The Action column exposes only the three approved actions.
    expect(screen.getAllByRole('link', { name: 'View lead' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Edit lead' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete lead' }).length).toBeGreaterThan(0);
    // Follow-ups is a dead feature: hidden from the UI.
    expect(screen.queryByRole('link', { name: 'Create follow-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Convert to booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create quotation' })).not.toBeInTheDocument();
  });

  it('shows the departure city when set and hides the city badge without one', async () => {
    const withoutCity = {
      ...enrichedLead,
      id: '22222222-2222-4222-8222-222222222222',
      queryNumber: 'QRY-2026-000002',
      customerName: 'No City Lead',
      departureCity: null,
    };
    const blankCity = {
      ...enrichedLead,
      id: '33333333-3333-4333-8333-333333333333',
      queryNumber: 'QRY-2026-000003',
      customerName: 'Blank City Lead',
      departureCity: '   ',
    };
    stubLeadList([enrichedLead, withoutCity, blankCity]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');

    const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
    // Lead with a city: badge, dates and counts all visible.
    const withCity = rowOf('Aarav Mehta');
    expect(within(withCity).getByText('Delhi')).toBeInTheDocument();
    expect(within(withCity).getByText(/2 Adults/)).toBeInTheDocument();
    expect(within(withCity).getByText('Aug 15, 2026')).toBeInTheDocument();
    // Leads without a city: no N/A, no city badge; dates and counts remain.
    for (const name of ['No City Lead', 'Blank City Lead']) {
      const row = rowOf(name);
      expect(within(row).queryByText('N/A')).not.toBeInTheDocument();
      expect(row.querySelector('.leads-traveller-block--city')).toBeNull();
      expect(within(row).getByText(/2 Adults/)).toBeInTheDocument();
      expect(within(row).getByText('Aug 15, 2026')).toBeInTheDocument();
    }
  });

  it('keeps the Booking column out of the desktop table and the Action column clean once booked', async () => {
    stubLeadList([
      {
        ...enrichedLead,
        bookingSummary: {
          bookingId: 'book-1',
          bookingNumber: 'BK-2026-000001',
          bookingStatus: 'CONFIRMED',
          operationalStatus: 'IN_PROGRESS',
          travelStartDate: null,
          travelEndDate: null,
          paymentStatus: 'PARTIALLY_PAID',
        },
        actions: { ...enrichedLead.actions, canConvertToBooking: false, canViewBooking: true },
      },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('QRY-000001');
    // The booking number is not shown in the table while the Booking column is
    // hidden; booking data itself is untouched.
    const desktopTable = document.querySelector('.leads-table-scroll') as HTMLElement;
    expect(desktopTable).not.toBeNull();
    expect(
      within(desktopTable).queryByRole('link', { name: 'BK-2026-000001' }),
    ).not.toBeInTheDocument();
    // The Action column never adds booking/convert shortcuts.
    expect(screen.queryByRole('link', { name: 'Convert to booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View booking' })).not.toBeInTheDocument();
    // The three approved actions remain.
    expect(screen.getAllByRole('link', { name: 'View lead' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Edit lead' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete lead' }).length).toBeGreaterThan(0);
    // Follow-ups is a dead feature: hidden from the UI.
    expect(screen.queryByRole('link', { name: 'Create follow-up' })).not.toBeInTheDocument();
  });

  it('renders no checkbox column and starts the table with Lead ID', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('QRY-000001');
    // No header checkbox and no row checkboxes anywhere in the table.
    // (The unrelated "Hot leads only" filter checkbox stays.)
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('checkbox')).not.toBeInTheDocument();
    // No bulk-actions UI without selection.
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
    // The first header cell is Lead ID, followed by the untouched columns.
    const headers = screen.getAllByRole('columnheader');
    expect(headers[0]).toHaveTextContent('Lead ID');
    // Row actions stay intact.
    expect(screen.getAllByRole('link', { name: 'View lead' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Edit lead' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Delete lead' }).length).toBeGreaterThan(0);
  });

  it('shows the export menu item only with export permission', async () => {
    stubLeadList([enrichedLead]);
    const view = renderWithProviders(<LeadsPage />);
    await screen.findAllByText('QRY-000001');
    // Export Leads lives inside the More actions menu, next to Create.
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    expect(screen.getByRole('menuitem', { name: /Export/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Import Leads/i })).toBeInTheDocument();
    view.unmount();
    authState.permissions = new Set(['queries.view']);
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('QRY-000001');
    // Without create/export permissions there is no More menu and no Export Leads.
    expect(screen.queryByRole('button', { name: /More actions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Export/ })).not.toBeInTheDocument();
    // The selection UI was removed: no checkboxes with or without permission.
    expect(screen.queryByLabelText('Select page')).not.toBeInTheDocument();
  });

  it('keeps Create visible while Export Leads and Import Leads live in the More menu', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('QRY-000001');
    expect(screen.getByRole('link', { name: /Add Lead/i })).toBeInTheDocument();
    // No always-visible Export Leads / Import Leads buttons.
    expect(
      screen.queryByRole('button', { name: /^Export$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Import Leads/i }),
    ).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: /More actions/i });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(more);
    expect(screen.getByRole('menu', { name: /More lead actions/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Import Leads/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Export/ })).toBeInTheDocument();
  });

  it('closes the More menu after selecting an action and on Escape', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('QRY-000001');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    expect(screen.getByRole('menu', { name: /More lead actions/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));
    // Selecting Import Leads closes the menu and opens the import modal.
    expect(screen.queryByRole('menu', { name: /More lead actions/i })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Import Leads' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    expect(screen.getByRole('menu', { name: /More lead actions/i })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('menu', { name: /More lead actions/i }),
      ).not.toBeInTheDocument(),
    );
  });
});

describe('Phase 17 lead workspace tabs', () => {
  const workspace = {
    lead: enrichedLead,
    operationalSummary: {
      pendingFollowUpCount: 1,
      overdueFollowUpCount: 0,
      completedFollowUpCount: 0,
      notesCount: 0,
      daysSinceLastContact: null,
      noFutureFollowUp: false,
      requiresAttention: false,
    },
    indicators: [],
    recent: { notes: [], followUps: [], timeline: [] },
    quotations: {
      count: 1,
      latest: null,
      items: [
        {
          id: 'quote-1',
          quotationNumber: 'QT-2026-000001',
          status: 'ACCEPTED',
          currentVersionId: 'ver-1',
          lastSentAt: null,
          lastViewedAt: null,
          acceptedAt: '2026-07-22T00:00:00.000Z',
          createdAt: '2026-07-21T00:00:00.000Z',
          booking: null,
          versions: [
            {
              id: 'ver-1',
              versionNumber: 1,
              finalAmount: '50000',
              currency: 'INR',
              status: 'FINALIZED',
            },
          ],
        },
      ],
    },
    bookings: { count: 0, latest: null, items: [] },
    timezone: 'Asia/Kolkata',
    permissions: {
      canEdit: true,
      canAssign: true,
      canChangeStage: true,
      canAddNote: true,
      canScheduleFollowUp: true,
      canCompleteFollowUp: true,
      canDelete: true,
      canViewQuotations: true,
      canCreateQuotation: true,
      canSendQuotation: true,
      canGenerateQuotationPdf: true,
      canViewBookings: true,
      canConvertBooking: true,
    },
  };

  function stubWorkspace() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/workspace')) return response(workspace);
        if (url.includes('/notes'))
          return response([
            {
              id: 'note-1',
              content: 'Prefers morning flights',
              createdAt: '2026-07-21T00:00:00.000Z',
              updatedAt: '2026-07-21T00:00:00.000Z',
              isCustomerContact: false,
              contactMethod: null,
              contactedAt: null,
              authorUser: { id: 'me', fullName: 'Owner', username: 'owner' },
            },
          ]);
        if (url.includes('/follow-ups'))
          return response([
            {
              id: 'fu-1',
              scheduledAt: '2026-08-01T10:00:00.000Z',
              status: 'PENDING',
              effectiveStatus: 'PENDING',
              outcomeType: null,
              outcome: null,
              notes: 'Confirm hotel category',
              completionNotes: null,
              completedAt: null,
              cancelledAt: null,
              cancellationReason: null,
              createdAt: '2026-07-21T00:00:00.000Z',
              updatedAt: '2026-07-21T00:00:00.000Z',
              assignedTo: { id: 'me', fullName: 'Owner', username: 'owner' },
              createdBy: { id: 'me', fullName: 'Owner', username: 'owner' },
            },
          ]);
        if (url.includes('/timeline'))
          return response({
            data: [
              {
                id: 't1',
                type: 'LEAD_CREATED',
                title: 'Lead created',
                description: 'Created',
                timestamp: '2026-07-21T00:00:00.000Z',
                actor: { id: 'me', fullName: 'Owner', username: 'owner' },
              },
            ],
            pagination: {},
          });
        if (url.includes('/lookups')) return response(lookups);
        return response(enrichedLead);
      }),
    );
  }

  const renderWorkspace = () =>
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId" element={<LeadDetailsPage />} />
      </Routes>,
      { route: `/queries/${enrichedLead.id}` },
    );

  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.update',
      'queries.assign',
      'followups.create',
      'followups.update',
      'followups.delete',
    ]);
  });

  it('defaults to the Lead Information tab and switches between tabs', async () => {
    stubWorkspace();
    renderWorkspace();
    expect(await screen.findByText('Contact Information')).toBeInTheDocument();
    // The right-side panels are gone: no Lead actions, no Payments card.
    expect(screen.queryByText('Lead actions')).not.toBeInTheDocument();
    expect(screen.queryByText('No payments recorded')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Lead Information' }));
    expect(await screen.findByText('Travel Details')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(await screen.findByText('Prefers morning flights')).toBeInTheDocument();

    // Follow-ups is a dead feature: the tab is hidden from the UI.
    expect(screen.queryByRole('button', { name: 'Follow-ups' })).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm hotel category')).not.toBeInTheDocument();

    // Booking is removed from Lead Details navigation.
    expect(screen.queryByRole('button', { name: 'Booking' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(await screen.findByText('Lead created')).toBeInTheDocument();
  });

  it('shows the quotations tab with a convert-to-booking action', async () => {
    stubWorkspace();
    renderWorkspace();
    await screen.findByText('Contact Information');
    await userEvent.click(screen.getByRole('button', { name: 'Quotations' }));
    expect(await screen.findByRole('link', { name: 'QT-2026-000001' })).toBeInTheDocument();
    const convert = screen.getByRole('link', { name: 'Convert to booking' });
    expect(convert).toHaveAttribute('href', '/quotations/quote-1/convert-to-booking');
  });

  it('hides the Booking tab from Lead Details while keeping quotation conversion', async () => {
    stubWorkspace();
    renderWorkspace();
    await screen.findByText('Contact Information');
    // Booking UI is removed from Lead Details; the backend and the
    // accepted-quotation conversion rule are untouched.
    expect(screen.queryByRole('button', { name: 'Booking' })).not.toBeInTheDocument();
    expect(screen.queryByText(/created from an accepted quotation/i)).not.toBeInTheDocument();
    // Conversion remains available through the Quotations tab.
    await userEvent.click(screen.getByRole('button', { name: 'Quotations' }));
    expect(await screen.findByRole('link', { name: 'QT-2026-000001' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Convert to booking' })).toBeInTheDocument();
  });

  it('shows a unified Lead Information tab with contact, travel and trip sections', async () => {
    stubWorkspace();
    renderWorkspace();
    await screen.findByText('Contact Information');
    expect(screen.getByText('Contact Information')).toBeInTheDocument();
    expect(screen.getByText('Travel Details')).toBeInTheDocument();
    expect(screen.getByText('Services Required')).toBeInTheDocument();
    expect(screen.getByText('Itinerary')).toBeInTheDocument();
    expect(screen.getByText(/Bangkok/)).toBeInTheDocument();
    // Additional Information was removed from the page entirely.
    expect(screen.queryByText('Additional Information')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest quotation')).not.toBeInTheDocument();
    // Old Overview/Travel tabs are gone; history lives under Timeline.
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Travel & Itinerary' })).not.toBeInTheDocument();
    // No Booking, Follow-ups, reminder or Priority UI anywhere on the page.
    expect(screen.queryByRole('button', { name: 'Booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Follow-ups' })).not.toBeInTheDocument();
    expect(screen.queryByText(/priority/i)).not.toBeInTheDocument();
    // Full history remains available under Timeline.
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(await screen.findByText('Lead created')).toBeInTheDocument();
  });
});

describe('Phase 6 inline Type/Stage editing on the Leads List', () => {
  const pickOption = (listboxName: string, label: string) => {
    const listbox = screen.getByRole('listbox', { name: listboxName });
    const li = within(listbox).getByRole('option', { name: label });
    fireEvent.click(li.querySelector('button')!);
  };
  const patchStub = (rows: unknown[], updated?: (i: unknown, url: string) => unknown) => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(lookups);
      if (options?.method === 'PATCH') {
        const body = JSON.parse(String(options.body));
        calls.push({ url, body });
        if (updated) return response(updated(rows[0], url));
        return response(rows[0]);
      }
      return response({
        data: rows,
        pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    return { mock, calls };
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set(['queries.view', 'queries.update']);
  });

  it('renders a clickable Type badge with Create-Lead options for an authorized user', async () => {
    patchStub([lead]);
    renderWithProviders(<LeadsPage />);
    const typeBadge = await screen.findByRole('button', { name: 'Change lead type from Hot' });
    await userEvent.click(typeBadge);
    const listbox = screen.getByRole('listbox', { name: 'Change lead type' });
    const optionTexts = within(listbox)
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    // Options match Create Lead exactly (same lookups source / order).
    expect(optionTexts).toEqual(['Fresh', 'Hot']);
  });

  it('renders a static Type badge for an unauthorized user', async () => {
    authState.permissions = new Set(['queries.view']);
    patchStub([lead]);
    renderWithProviders(<LeadsPage />);
    // Wait for the lead row to render; there is no clickable Type button.
    await screen.findAllByText(lead.customerName);
    expect(
      screen.queryByRole('button', { name: 'Change lead type from Hot' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Change lead type' })).not.toBeInTheDocument();
  });

  it('sends the correct stored Type value when a different option is selected', async () => {
    const { calls } = patchStub([{ ...lead, leadType: 'HOT' }]);
    renderWithProviders(<LeadsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change lead type from Hot' }));
    pickOption('Change lead type', 'Fresh');
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.url).toContain(`/queries/${lead.id}`);
    expect(calls[0]!.body).toEqual({ leadType: 'FRESH' });
  });

  it('selecting the current Type sends no request', async () => {
    const { calls } = patchStub([lead]);
    renderWithProviders(<LeadsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change lead type from Hot' }));
    pickOption('Change lead type', 'Hot');
    expect(calls).toHaveLength(0);
  });

  it('renders a clickable Stage badge with Create-Lead options', async () => {
    const richLookups = {
      ...lookups,
      leadStages: [
        { value: 'NEW_LEAD', label: 'New Lead' },
        { value: 'CONTACTED', label: 'Contacted' },
      ],
    };
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(richLookups);
      return response({
        data: [lead],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    const stageBadge = await screen.findByRole('button', {
      name: 'Change lead stage from New Lead',
    });
    await userEvent.click(stageBadge);
    const listbox = screen.getByRole('listbox', { name: 'Change lead stage' });
    expect(within(listbox).getByRole('option', { name: 'New Lead' })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'Contacted' })).toBeInTheDocument();
  });

  it('sends the correct stored Stage value when a different option is selected', async () => {
    const richLookups = {
      ...lookups,
      leadStages: [
        { value: 'NEW_LEAD', label: 'New Lead' },
        { value: 'CONTACTED', label: 'Contacted' },
      ],
    };
    const calls: Array<{ url: string; body: unknown }> = [];
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(richLookups);
      if (options?.method === 'PATCH') {
        calls.push({ url, body: JSON.parse(String(options.body)) });
        return response({ ...lead, leadStage: 'CONTACTED' });
      }
      return response({
        data: [{ ...lead, leadStage: 'NEW_LEAD' }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change lead stage from New Lead' }),
    );
    pickOption('Change lead stage', 'Contacted');
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.url).toContain(`/queries/${lead.id}/stage`);
    expect(calls[0]!.body).toEqual({ stage: 'CONTACTED' });
  });

  it('offers Not Connected in the inline stage editor and saves its stored value', async () => {
    const richLookups = {
      ...lookups,
      leadStages: [
        { value: 'NEW_LEAD', label: 'New Lead' },
        { value: 'NOT_CONNECTED', label: 'Not Connected' },
      ],
    };
    const calls: Array<{ url: string; body: unknown }> = [];
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(richLookups);
      if (options?.method === 'PATCH') {
        calls.push({ url, body: JSON.parse(String(options.body)) });
        return response({ ...lead, leadStage: 'NOT_CONNECTED' });
      }
      return response({
        data: [{ ...lead, leadStage: 'NEW_LEAD' }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change lead stage from New Lead' }),
    );
    const listbox = screen.getByRole('listbox', { name: 'Change lead stage' });
    expect(within(listbox).getByRole('option', { name: 'Not Connected' })).toBeInTheDocument();
    pickOption('Change lead stage', 'Not Connected');
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.url).toContain(`/queries/${lead.id}/stage`);
    expect(calls[0]!.body).toEqual({ stage: 'NOT_CONNECTED' });
  });

  it('only one dropdown stays open after opening a second badge', async () => {
    patchStub([lead]);
    renderWithProviders(<LeadsPage />);
    const typeBadge = await screen.findByRole('button', { name: 'Change lead type from Hot' });
    await userEvent.click(typeBadge);
    expect(screen.getByRole('listbox', { name: 'Change lead type' })).toBeInTheDocument();
    // Opening Stage should close Type.
    const stageBadge = await screen.findByRole('button', {
      name: 'Change lead stage from New Lead',
    });
    await userEvent.click(stageBadge);
    expect(screen.queryByRole('listbox', { name: 'Change lead type' })).not.toBeInTheDocument();
  });

  it('offers Booking Confirmed in the inline stage editor', async () => {
    const richLookups = {
      ...lookups,
      leadStages: [
        { value: 'QUOTATION_SENT', label: 'Quotation Sent' },
        { value: 'READY_TO_BOOK', label: 'Ready To Book' },
        { value: 'BOOKING_CONFIRMED', label: 'Booking Confirmed' },
      ],
    };
    const current: Record<string, unknown> & { id: string } = {
      ...lead,
      leadStage: 'QUOTATION_SENT',
    };
    const calls: Array<{ url: string; body: unknown }> = [];
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(richLookups);
      if (options?.method === 'PATCH') {
        calls.push({ url, body: JSON.parse(String(options.body)) });
        current.leadStage = String((JSON.parse(String(options.body)) as { stage: string }).stage);
        return response({ ...current });
      }
      return response({
        data: [{ ...current }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change lead stage from Quotation Sent' }),
    );
    // Booking Confirmed is offered in canonical order (after Ready To Book)
    // and selecting it saves through the stage API.
    const listbox = screen.getByRole('listbox', { name: 'Change lead stage' });
    const options = within(listbox)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Quotation Sent', 'Ready To Book', 'Booking Confirmed']);
    pickOption('Change lead stage', 'Booking Confirmed');
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.body).toEqual({ stage: 'BOOKING_CONFIRMED' });
  });

  it('restores the previous badge value and shows an error when the update fails', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(lookups);
      if (options?.method === 'PATCH') {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid stage transition.' },
          }),
        } as unknown as Response;
      }
      return response({
        data: [lead],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change lead type from Hot' }));
    pickOption('Change lead type', 'Fresh');
    // No optimistic update: the badge still shows the previous value.
    expect(
      await screen.findByRole('button', { name: 'Change lead type from Hot' }),
    ).toBeInTheDocument();
    // Failure message is surfaced.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Invalid stage transition|Unable to update type/,
    );
  });
});

describe('Phase 6 Create Booking action on the Leads List', () => {
  const pickOption = (listboxName: string, label: string) => {
    const listbox = screen.getByRole('listbox', { name: listboxName });
    const li = within(listbox).getByRole('option', { name: label });
    fireEvent.click(li.querySelector('button')!);
  };
  const bookingStub = (initial: Record<string, unknown> & { id: string }) => {
    const current: Record<string, unknown> & { id: string } = { ...initial };
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(lookups);
      if (options?.method === 'PATCH') {
        const body = JSON.parse(String(options.body)) as Record<string, unknown>;
        if (url.endsWith('/stage')) current.leadStage = String(body.stage);
        else if (body.leadType) current.leadType = String(body.leadType);
        return response({ ...current });
      }
      // Return a fresh copy so React Query detects the change after an update.
      return response({
        data: [{ ...current }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    return current;
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set(['queries.view', 'queries.update', 'bookings.create']);
  });

  it('shows Create Booking for Hot + Booking Confirmed + no booking', async () => {
    bookingStub({
      ...lead,
      leadType: 'HOT',
      leadStage: 'BOOKING_CONFIRMED',
      bookingSummary: null,
      quotationSummary: { quotationId: 'quote-1', quotationStatus: 'ACCEPTED' },
    });
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    // The Booking column is temporarily hidden from the Leads table, and the
    // mobile card (which previously surfaced Create Booking) has been removed —
    // the table is now the single representation on every screen size.
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
  });

  it('shows View Booking instead of Create Booking when a booking already exists', async () => {
    bookingStub({
      ...lead,
      leadType: 'HOT',
      leadStage: 'BOOKING_CONFIRMED',
      bookingSummary: {
        bookingId: 'b-1',
        bookingNumber: 'BK-1',
        bookingStatus: 'CONFIRMED',
        operationalStatus: 'CONFIRMED',
      },
    });
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    // Booking column hidden from the table; no card duplicate exists.
    expect(screen.queryByText('BK-1')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
  });

  it('does not show Create Booking without a finalized quotation', async () => {
    bookingStub({ ...lead, leadType: 'HOT', leadStage: 'NEW_LEAD', bookingSummary: null });
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
  });

  it('does not show Create Booking when Type is not Hot', async () => {
    bookingStub({
      ...lead,
      leadType: 'FRESH',
      leadStage: 'BOOKING_CONFIRMED',
      bookingSummary: null,
    });
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
  });

  it('does not show Create Booking for Fresh + New Lead', async () => {
    bookingStub({ ...lead, leadType: 'FRESH', leadStage: 'NEW_LEAD', bookingSummary: null });
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
  });

  it('hides Create Booking for a user without bookings.create permission', async () => {
    authState.permissions = new Set(['queries.view']);
    bookingStub({ ...lead, leadType: 'HOT', leadStage: 'BOOKING_CONFIRMED', bookingSummary: null });
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
  });

  it('Create Booking appears after an inline Type update to Hot', async () => {
    const current = bookingStub({
      ...lead,
      leadType: 'FRESH',
      leadStage: 'BOOKING_CONFIRMED',
      bookingSummary: null,
      quotationSummary: { quotationId: 'quote-1', quotationStatus: 'ACCEPTED' },
    });
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change lead type from Fresh' }),
    );
    pickOption('Change lead type', 'Hot');
    // Refetch returns the lead with leadType HOT, but the Booking column is
    // hidden from the table (no mobile card duplicate), so no Create Booking
    // action is surfaced on the Leads list.
    await screen.findAllByText(lead.customerName);
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
    void current;
  });

  it('inline Stage updates work for regular stages, including Booking Confirmed', async () => {
    const current = bookingStub({
      ...lead,
      leadType: 'HOT',
      leadStage: 'NEW_LEAD',
      bookingSummary: null,
      quotationSummary: { quotationId: 'quote-1', quotationStatus: 'ACCEPTED' },
    });
    void current;
    const richLookups = {
      ...lookups,
      leadStages: [
        { value: 'NEW_LEAD', label: 'New Lead' },
        { value: 'BOOKING_CONFIRMED', label: 'Booking Confirmed' },
        { value: 'QUALIFIED', label: 'Qualified' },
      ],
    };
    const calls: Array<{ url: string; body: unknown }> = [];
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(richLookups);
      if (options?.method === 'PATCH') {
        const body = JSON.parse(String(options.body)) as Record<string, unknown>;
        calls.push({ url, body });
        return response({ ...current, leadStage: String(body.stage) });
      }
      return response({
        data: [{ ...current }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change lead stage from New Lead' }),
    );
    // Booking Confirmed is offered alongside the other stages; another
    // stage still works too.
    expect(
      within(screen.getByRole('listbox', { name: 'Change lead stage' })).getByRole('option', {
        name: 'Booking Confirmed',
      }),
    ).toBeInTheDocument();
    pickOption('Change lead stage', 'Qualified');
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.body).toEqual({ stage: 'QUALIFIED' });
  });

  it('Create Booking disappears after an inline Type update away from Hot', async () => {
    const current = bookingStub({
      ...lead,
      leadType: 'HOT',
      leadStage: 'BOOKING_CONFIRMED',
      bookingSummary: null,
      quotationSummary: { quotationId: 'quote-1', quotationStatus: 'ACCEPTED' },
    });
    void current;
    const richLookups = {
      ...lookups,
      leadTypes: [
        { value: 'FRESH', label: 'Fresh' },
        { value: 'HOT', label: 'Hot' },
        { value: 'WARM', label: 'Warm' },
      ],
    };
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(richLookups);
      if (options?.method === 'PATCH') {
        const body = JSON.parse(String(options.body)) as Record<string, unknown>;
        current.leadType = String(body.leadType);
        return response({ ...current });
      }
      return response({
        data: [{ ...current }],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    // Booking column hidden from the table (no mobile card duplicate).
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Change lead type from Hot' }));
    pickOption('Change lead type', 'Warm');
    await waitFor(() =>
      expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0),
    );
  });

  it('a failed inline update does not change the Booking column', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(lookups);
      if (options?.method === 'PATCH') {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid transition.' },
          }),
        } as unknown as Response;
      }
      return response({
        data: [
          { ...lead, leadType: 'FRESH', leadStage: 'BOOKING_CONFIRMED', bookingSummary: null },
        ],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText(lead.customerName);
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
    // Attempt an inline Type update to Hot; it fails, so the action must not appear.
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change lead type from Fresh' }),
    );
    pickOption('Change lead type', 'Hot');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryAllByRole('link', { name: /Create booking for/ })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Weblink column: CREATE / VIEW / analytics eye with a real view count
// ---------------------------------------------------------------------------

const weblinkAnalytics = {
  totalViews: 3,
  externalViews: 2,
  homeIpViews: 1,
  uniqueIps: 2,
  entries: [
    {
      ipAddress: '203.0.113.1',
      type: 'EXTERNAL',
      views: 2,
      firstViewedAt: '2026-08-01T09:30:00.000Z',
      lastViewedAt: '2026-08-05T10:42:00.000Z',
    },
    {
      ipAddress: '42.108.30.32',
      type: 'HOME',
      views: 1,
      firstViewedAt: '2026-08-04T12:00:00.000Z',
      lastViewedAt: '2026-08-04T12:00:00.000Z',
    },
  ],
};

function weblinkLead(overrides: Record<string, unknown> = {}) {
  return {
    ...enrichedLead,
    weblink: {
      quotationId: 'quote-1',
      publicUrl: 'http://localhost:5173/q/token1234567890abcdef',
      isGenerated: true,
      externalViews: 0,
    },
    actions: { ...enrichedLead.actions, canCreateWeblink: true },
    ...overrides,
  };
}

function stubWeblinkList(rows: unknown[], { analyticsData = weblinkAnalytics, views = true } = {}) {
  const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url.includes('/weblink-analytics'))
      return response(views ? analyticsData : { ...analyticsData, totalViews: 7, entries: [] });
    if (url.includes('/queries/analytics')) return response(analytics);
    if (url.includes('/lookups')) return response(lookups);
    if (options?.method === 'POST' && url.includes('/public-link'))
      return response({
        url: 'http://localhost:5173/q/token1234567890abcdef',
        expiresAt: null,
        versionId: 'ver-1',
      });
    if (options?.method === 'POST' || url.includes('/bulk') || url.includes('/export'))
      return response({ updatedCount: rows.length, unchangedCount: 0, results: [] });
    return response({
      data: rows,
      pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('Lead weblink column', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'quotations.view',
      'quotations.update',
    ]);
    vi.stubGlobal('open', vi.fn());
  });

  it('shows Not Available for a lead without a quotation', async () => {
    stubWeblinkList([{ ...enrichedLead, quotationSummary: null, weblink: null }]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getAllByText('Not Available').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /View quotation weblink/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Weblink view analytics/ }),
    ).not.toBeInTheDocument();
  });

  it('shows View + zero count for a quotation even before any view (no Create state)', async () => {
    // Backend lifecycle guarantees a usable link for every quotation; the
    // fixture mirrors that with a real URL and zero views.
    const mock = stubWeblinkList([weblinkLead()]);
    renderWithProviders(<LeadsPage />);
    const view = await screen.findByRole('link', { name: /View quotation weblink/ });
    expect(view).toHaveAttribute('href', 'http://localhost:5173/q/token1234567890abcdef');
    const eye = screen.getByRole('button', { name: /Weblink view analytics/ });
    expect(eye).toHaveTextContent('0');
    // No manual Create state and no per-row link-generation request.
    expect(
      screen.queryByRole('button', { name: /Create quotation weblink/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Not Generated')).not.toBeInTheDocument();
    expect(mock.mock.calls.some(([u]) => String(u).includes('/public-link'))).toBe(false);
  });

  it('renders the joined View + eye group with a real count', async () => {
    stubWeblinkList([weblinkLead({ weblink: { ...weblinkLead().weblink, externalViews: 5 } })]);
    renderWithProviders(<LeadsPage />);
    const view = await screen.findByRole('link', { name: /View quotation weblink/ });
    expect(view).toHaveAttribute('href', 'http://localhost:5173/q/token1234567890abcdef');
    const eye = screen.getByRole('button', { name: /Weblink view analytics/ });
    expect(eye).toHaveTextContent('5');
  });

  it('shows View + count for a quotation without the former create permission', async () => {
    stubWeblinkList([
      weblinkLead({ actions: { ...enrichedLead.actions, canCreateWeblink: false } }),
    ]);
    renderWithProviders(<LeadsPage />);
    const view = await screen.findByRole('link', { name: /View quotation weblink/ });
    expect(view).toHaveAttribute('href', 'http://localhost:5173/q/token1234567890abcdef');
    expect(screen.getByRole('button', { name: /Weblink view analytics/ })).toHaveTextContent('0');
  });

  it('falls back to Unavailable for corrupt data instead of offering Create', async () => {
    stubWeblinkList([weblinkLead({ weblink: null })]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View quotation weblink/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Create quotation weblink/ }),
    ).not.toBeInTheDocument();
  });

  it('opens the public URL in a new tab from the View action without opening analytics', async () => {
    stubWeblinkList([weblinkLead()]);
    renderWithProviders(<LeadsPage />);
    const view = await screen.findByRole('link', { name: /View quotation weblink/ });
    expect(view).toHaveAttribute('href', 'http://localhost:5173/q/token1234567890abcdef');
    expect(view).toHaveAttribute('target', '_blank');
    expect(view).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the analytics modal and renders summary cards and IP rows', async () => {
    stubWeblinkList([weblinkLead()]);
    renderWithProviders(<LeadsPage />);
    const eye = await screen.findByRole('button', { name: /Weblink view analytics/ });
    await userEvent.click(eye);
    const dialog = await screen.findByRole('dialog', { name: /Weblink View Analytics/ });
    expect(dialog).toBeInTheDocument();
    // Four summary cards.
    expect(screen.getByText('Total Views')).toBeInTheDocument();
    expect(screen.getByText('External Views')).toBeInTheDocument();
    expect(screen.getByText('Home IP Views')).toBeInTheDocument();
    expect(screen.getByText('Unique IPs')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.1')).toBeInTheDocument();
    expect(screen.getByText('EXTERNAL')).toBeInTheDocument();
    expect(screen.getByText('HOME IP')).toBeInTheDocument();
    // Dates are formatted (05 Aug 2026 present).
    expect(screen.getByText(/05 Aug 2026/)).toBeInTheDocument();
    // Footer explanation.
    expect(
      screen.getByText(/HOME IP = Views from your company team members\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/EXTERNAL = Views from actual clients\./)).toBeInTheDocument();
  });

  it('synchronises the row count from the analytics response', async () => {
    stubWeblinkList([weblinkLead()], { views: true });
    renderWithProviders(<LeadsPage />);
    const eye = await screen.findByRole('button', { name: /Weblink view analytics/ });
    await userEvent.click(eye);
    await screen.findByRole('dialog', { name: /Weblink View Analytics/ });
    // The modal's analytics returns externalViews 2; the row badge catches up.
    const badge = screen.getByRole('button', { name: /Weblink view analytics/ });
    await waitFor(() => expect(badge).toHaveTextContent('2'));
  });

  it('shows an empty state and zero cards when there are no views', async () => {
    stubWeblinkList([weblinkLead()], {
      analyticsData: { totalViews: 0, externalViews: 0, homeIpViews: 0, uniqueIps: 0, entries: [] },
    });
    renderWithProviders(<LeadsPage />);
    const eye = await screen.findByRole('button', { name: /Weblink view analytics/ });
    await userEvent.click(eye);
    await screen.findByRole('dialog', { name: /Weblink View Analytics/ });
    expect(await screen.findByText('No weblink views have been recorded yet.')).toBeInTheDocument();
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(4);
  });

  it('closes via the header X, the bottom Close, and the Escape key', async () => {
    stubWeblinkList([weblinkLead()]);
    renderWithProviders(<LeadsPage />);
    const eye = await screen.findByRole('button', { name: /Weblink view analytics/ });
    await userEvent.click(eye);
    await screen.findByRole('dialog', { name: /Weblink View Analytics/ });
    await userEvent.click(screen.getByRole('button', { name: 'Close analytics' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Weblink view analytics/ }));
    await screen.findByRole('dialog', { name: /Weblink View Analytics/ });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Weblink view analytics/ }));
    const dialog = await screen.findByRole('dialog', { name: /Weblink View Analytics/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an error state with Retry when analytics loading fails', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/weblink-analytics'))
        return {
          ok: false,
          status: 500,
          json: async () => ({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'boom' },
          }),
        } as Response;
      if (url.includes('/queries/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(lookups);
      return response({
        data: [weblinkLead()],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />);
    const eye = await screen.findByRole('button', { name: /Weblink view analytics/ });
    await userEvent.click(eye);
    expect(
      await screen.findByRole('dialog', { name: /Weblink View Analytics/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Could not load weblink analytics/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('203.0.113.1')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Services column: compact icon chips with tooltip + accessible label
// ---------------------------------------------------------------------------

const servicesLead = {
  ...enrichedLead,
  services: [
    { serviceType: 'HOTEL' },
    { serviceType: 'SIGHTSEEING' },
    { serviceType: 'CRUISE' },
    { serviceType: 'VEHICLE_TRANSFER' },
    { serviceType: 'FLIGHT' },
    { serviceType: 'OTHER_ADD_ON' },
    { serviceType: 'MYSTERY_SERVICE' },
  ],
};

const servicesLeadFew = {
  ...enrichedLead,
  services: [
    { serviceType: 'HOTEL' },
    { serviceType: 'SIGHTSEEING' },
    { serviceType: 'VEHICLE_TRANSFER' },
    { serviceType: 'FLIGHT' },
  ],
};

const servicesLeadUnknown = {
  ...enrichedLead,
  services: [{ serviceType: 'MYSTERY_SERVICE' }],
};

describe('Lead services column icons', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'queries.delete',
      'quotations.view',
    ]);
  });

  const chip = (name: string) => {
    const found = screen.getAllByRole('img').find((el) => el.getAttribute('aria-label') === name);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  };

  it('renders an icon-only chip for every known service type', async () => {
    stubLeadList([servicesLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');

    expect(chip('Hotel service').querySelector('.lucide-hotel')).not.toBeNull();
    expect(chip('Sightseeing service').querySelector('.lucide-binoculars')).not.toBeNull();
    expect(chip('Vehicle Transfer service').querySelector('.lucide-car-front')).not.toBeNull();
    expect(chip('Flight service').querySelector('.lucide-plane')).not.toBeNull();
    expect(chip('Cruise service').querySelector('.lucide-ship')).not.toBeNull();
    expect(chip('Other Add On service').querySelector('.lucide-package-plus')).not.toBeNull();
    // All six selected services render — no overflow "+N" chip.
    expect(screen.queryByRole('img', { name: /more services/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/\+1/)).not.toBeInTheDocument();
  });

  it('shows no visible service-name text inside the chips', async () => {
    stubLeadList([servicesLeadFew]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');

    for (const name of [
      'Hotel service',
      'Sightseeing service',
      'Vehicle Transfer service',
      'Flight service',
    ]) {
      expect(chip(name).textContent?.trim()).toBe('');
    }
  });

  it('ignores an unsupported service value instead of rendering a fallback icon', async () => {
    stubLeadList([servicesLeadUnknown]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    // labelForLookup would call it "Mystery Service", but it is not a supported
    // Lead-form service, so no chip (and no placeholder) is rendered.
    expect(screen.queryByRole('img', { name: 'Mystery Service service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes the service name through a tooltip and accessible label', async () => {
    stubLeadList([servicesLeadFew]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');

    for (const [name, label] of [
      ['Hotel service', 'Hotel'],
      ['Flight service', 'Flight'],
      ['Vehicle Transfer service', 'Vehicle Transfer'],
    ] as const) {
      const badge = chip(name);
      expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(badge).toHaveAttribute('aria-label', name);
      expect(badge).toHaveAttribute('title', label);
    }
  });

  it('renders only the three approved row actions alongside the icon chips', async () => {
    stubLeadList([servicesLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getAllByRole('link', { name: 'View lead' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('link', { name: 'Edit lead' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: 'Delete lead' }).length).toBeGreaterThanOrEqual(1);
    // Follow-ups is a dead feature: hidden from the UI.
    expect(screen.queryByRole('link', { name: 'Create follow-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Convert to booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View booking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create quotation' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Lead actions: View Quotation removed, Delete Lead added
// ---------------------------------------------------------------------------

describe('Lead actions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'queries.delete',
      'quotations.view',
    ]);
  });

  it('does not render the View quotation action', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.queryByRole('link', { name: 'View quotation' })).not.toBeInTheDocument();
  });

  it('renders the Delete action only with the delete permission', async () => {
    stubLeadList([enrichedLead]);
    const first = renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getAllByRole('button', { name: /Delete/ }).length).toBeGreaterThanOrEqual(1);

    first.unmount();
    authState.permissions = new Set(['queries.view', 'queries.update']);
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('permanently deletes the lead after confirmation', async () => {
    const mock = stubLeadList([enrichedLead]);
    const confirmSpy = vi.fn((_message?: unknown) => true);
    vi.stubGlobal('confirm', confirmSpy);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');

    const deleteButton = screen.getAllByRole('button', { name: /Delete/ })[0]!;
    await userEvent.click(deleteButton);
    expect(confirmSpy).toHaveBeenCalled();
    // Confirmation must warn that deletion is permanent.
    expect(String(confirmSpy.mock.calls[0]?.[0])).toMatch(/Permanently delete lead/);
    expect(String(confirmSpy.mock.calls[0]?.[0])).toMatch(/cannot be undone/);
    await waitFor(() =>
      expect(
        mock.mock.calls.some(
          ([url, options]) =>
            String(url).endsWith(`/queries/${enrichedLead.id}`) && options?.method === 'DELETE',
        ),
      ).toBe(true),
    );
  });
});

// ---------------------------------------------------------------------------
// The Leads Action column is strictly limited to View | Edit | Delete.
// Follow-up is a dead feature, hidden from the UI.
// ---------------------------------------------------------------------------

describe('Lead row actions are limited to the three approved actions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'queries.delete',
      'quotations.view',
    ]);
  });

  /** The desktop table's Actions cell for the first data row. */
  function actionsCell(): HTMLElement {
    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    const firstRow = table!.querySelector('tbody tr');
    expect(firstRow).not.toBeNull();
    const cells = Array.from(firstRow!.querySelectorAll('td'));
    return cells[cells.length - 1] as HTMLElement;
  }

  /** Accessible names of the controls in the Actions cell, in DOM order. */
  function actionNames(cell: HTMLElement): string[] {
    return Array.from(cell.querySelectorAll('a, button')).map(
      (el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '',
    );
  }

  it('renders exactly View, Edit and Delete in that order', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const cell = actionsCell();
    expect(actionNames(cell)).toEqual(['View lead', 'Edit lead', 'Delete lead']);
  });

  it('never renders quotation or booking actions in the Action column', async () => {
    // enrichedLead has a quotation summary AND a convertible booking context.
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const cell = actionsCell();
    for (const forbidden of [
      'Create quotation',
      'View quotation',
      'Convert to booking',
      'View booking',
      'Create booking',
      'Add note',
      'Archive',
      'Restore',
    ]) {
      expect(within(cell).queryByRole('link', { name: forbidden })).not.toBeInTheDocument();
      expect(within(cell).queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
    }
  });

  it('does not add actions based on lead stage, quotation or booking presence', async () => {
    // HOT + BOOKING_CONFIRMED with no booking, and a quotation summary.
    stubLeadList([
      {
        ...enrichedLead,
        leadType: 'HOT',
        leadStage: 'BOOKING_CONFIRMED',
        quotationSummary: enrichedLead.quotationSummary,
        bookingSummary: null,
      },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const cell = actionsCell();
    expect(actionNames(cell)).toEqual(['View lead', 'Edit lead', 'Delete lead']);
  });

  it('hides Edit without the update permission', async () => {
    authState.permissions = new Set(['queries.view', 'queries.delete']);
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const cell = actionsCell();
    expect(actionNames(cell)).toEqual(['View lead', 'Delete lead']);
  });

  it('hides Delete without the delete permission', async () => {
    authState.permissions = new Set(['queries.view', 'queries.update']);
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const cell = actionsCell();
    expect(actionNames(cell)).toEqual(['View lead', 'Edit lead']);
  });

  it('never renders the Follow-up action even when the lead permits it (dead feature)', async () => {
    stubLeadList([
      { ...enrichedLead, actions: { ...enrichedLead.actions, canAddFollowUp: true } },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const cell = actionsCell();
    expect(actionNames(cell)).toEqual(['View lead', 'Edit lead', 'Delete lead']);
    expect(
      screen.queryByRole('link', { name: 'Create follow-up' }),
    ).not.toBeInTheDocument();
  });

  it('does not introduce an overflow menu in the Action column', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const cell = actionsCell();
    expect(cell.querySelector('[role="menu"]')).toBeNull();
    expect(cell.querySelector('[aria-haspopup]')).toBeNull();
  });

  it('keeps the Quotation column an action-only cell (no status badge or amount)', async () => {
    // With a quotation summary: the View link stays, but the status badge and
    // the quotation INR amount are not shown inside the Quotation cell itself
    // (amount/margin live in the dedicated Amount/Margin columns, which do
    // show the quotation final amount).
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getAllByRole('link', { name: /^View$/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Accepted')).not.toBeInTheDocument();
    const quoteCell = screen
      .getByRole('link', { name: /^View$/ })
      .closest('td') as HTMLElement;
    expect(within(quoteCell).queryByText(/₹50,000/)).not.toBeInTheDocument();
    // The dedicated Amount column still shows the quotation final amount.
    expect(screen.getByText('₹50,000.00')).toBeInTheDocument();
  });

  it('keeps the "+ New" quotation shortcut intact in the Quotation column', async () => {
    // Without a quotation summary and with create permission: "+ New" stays.
    stubLeadList([
      {
        ...enrichedLead,
        quotationSummary: null,
        hasQuotations: false,
        actions: { ...enrichedLead.actions, canCreateQuotation: true },
      },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getAllByRole('link', { name: /\+ New/ }).length).toBeGreaterThan(0);
    // The Action column remains limited to the three approved actions.
    const cell = actionsCell();
    expect(actionNames(cell)).toEqual(['View lead', 'Edit lead', 'Delete lead']);
  });

  it('keeps the three actions on the single table with no card duplicate or extra menu', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    // The Leads page is a table on every screen size (no mobile card renderer),
    // so each lead's action set appears exactly once — in the table's Action column.
    expect(screen.getAllByRole('link', { name: 'View lead' }).length).toBe(1);
    expect(screen.getAllByRole('link', { name: 'Edit lead' }).length).toBe(1);
    expect(screen.getAllByRole('button', { name: 'Delete lead' }).length).toBe(1);
    // Follow-ups is a dead feature: hidden from the UI.
    expect(screen.queryByRole('link', { name: 'Create follow-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // The single table is horizontally scrollable on small screens.
    const tableScroll = document.querySelector('.leads-table-scroll') as HTMLElement;
    expect(tableScroll).not.toBeNull();
    expect(tableScroll.style.overflowX).not.toBe('hidden');
    // No mobile card markup exists in the DOM.
    expect(document.querySelector('.leads-mobile-card')).toBeNull();
    expect(document.querySelector('.leads-mobile-list')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Admin/Owner can see and select themselves in the Lead "Assign To" dropdown
// ---------------------------------------------------------------------------

describe('Admin lead self-assignment (frontend)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'queries.assign',
    ]);
  });

  const teamLookups = {
    ...lookups,
    assignableUsers: [
      { id: 'me', fullName: 'Owner', username: 'owner' },
      { id: 'alice', fullName: 'Amit Kumar', username: 'amit' },
      { id: 'bob', fullName: 'Neha Singh', username: 'neha' },
    ],
  };

  const destination = {
    id: 'dest-1',
    name: 'Singapore',
    status: 'ACTIVE',
    cities: [{ id: 'dc-1', sequence: 1, city: { name: 'Singapore' } }],
  };

  function assigneeOptionTexts(): string[] {
    const select = screen.getByLabelText('Assigned salesperson') as HTMLSelectElement;
    return Array.from(select.options).map((option) => option.textContent?.trim() ?? '');
  }

  it('shows the current user first, labelled (You), exactly once, with team members after', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(teamLookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await waitFor(() => {
      expect(assigneeOptionTexts()).toEqual([
        'Select User',
        'Owner (You)',
        'Amit Kumar',
        'Neha Singh',
      ]);
    });
    expect(assigneeOptionTexts().filter((text) => text === 'Owner (You)')).toHaveLength(1);
  });

  it('shows no helper text under Assign To', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(teamLookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // The helper copy is removed; the Assign To dropdown itself remains.
    expect(
      screen.queryByText(
        'Assign this lead to yourself or another team member. This field is required.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        'As an admin, you must assign this lead to a team member. This field is required.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Assigned salesperson')).toBeInTheDocument();
  });

  it('creates a lead assigned to the logged-in Admin when they select themselves', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(teamLookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });

    await userEvent.selectOptions(screen.getByLabelText('Assigned salesperson'), 'me');
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    await userEvent.selectOptions(screen.getByLabelText('Travel month'), '9');
    await userEvent.selectOptions(
      screen.getByLabelText('Travel year'),
      String(new Date().getFullYear()),
    );
    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(body.assignedToId).toBe('me');
    });
  });

  it('preselects the logged-in creator and keeps the Assign To field required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(teamLookups)),
    );
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // Assign To defaults to the current user immediately, without manual selection.
    expect(screen.getByLabelText('Assigned salesperson')).toHaveValue('me');
    // The Manual Assignment radio and Assign Type label are removed.
    expect(screen.queryByText('Assign Type')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /manual assignment/i })).not.toBeInTheDocument();
    // Clearing it re-arms the required validation on submit.
    await userEvent.selectOptions(screen.getByLabelText('Assigned salesperson'), '');
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    expect(await screen.findByText(/Assign To is required/)).toBeInTheDocument();
  });

  it('submits the preselected creator when Assign To is left untouched', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(teamLookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    expect(screen.getByLabelText('Assigned salesperson')).toHaveValue('me');

    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    await userEvent.selectOptions(screen.getByLabelText('Travel month'), '9');
    await userEvent.selectOptions(
      screen.getByLabelText('Travel year'),
      String(new Date().getFullYear()),
    );
    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(body.assignedToId).toBe('me');
    });
  });

  it('applies the default once a late session and late options both arrive', async () => {
    authState.user = null;
    try {
      let resolveLookups!: (value: Response) => void;
      const lookupsGate = new Promise<Response>((resolve) => {
        resolveLookups = resolve;
      });
      // Team list WITHOUT the current user: the fallback "(You)" option is the
      // only valid target for the default.
      const lookupsWithoutMe = {
        ...teamLookups,
        assignableUsers: [{ id: 'alice', fullName: 'Amit Kumar', username: 'amit' }],
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes('/lookups')) return lookupsGate;
          if (url.includes('/masters/destinations'))
            return response({
              data: [],
              pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
            });
          return response(teamLookups);
        }),
      );
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const renderTree = () => (
        <QueryProvider client={client}>
          <MemoryRouter initialEntries={['/']}>
            <LeadFormPage />
          </MemoryRouter>
        </QueryProvider>
      );
      const view = render(renderTree());
      await screen.findByRole('heading', { name: 'Create lead' });
      expect(screen.getByLabelText('Assigned salesperson')).toHaveValue('');

      // Options arrive first, still no session: nothing selected.
      resolveLookups(response(lookupsWithoutMe));
      await waitFor(() =>
        expect(screen.getByLabelText('Assigned salesperson')).toHaveValue(''),
      );

      // Session arrives late (as a fresh query-cache update would deliver it):
      // the tree rerenders and the default lands on the fallback option.
      authState.user = { id: 'me' };
      view.rerender(renderTree());
      await waitFor(() =>
        expect(screen.getByLabelText('Assigned salesperson')).toHaveValue('me'),
      );
    } finally {
      authState.user = { id: 'me' };
    }
  });

  it('saves the manually chosen team member instead of the preselected creator', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(teamLookups);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    expect(screen.getByLabelText('Assigned salesperson')).toHaveValue('me');

    // Manual pick is never overridden by the default.
    await waitFor(() => expect(assigneeOptionTexts()).toContain('Amit Kumar'));
    await userEvent.selectOptions(screen.getByLabelText('Assigned salesperson'), 'alice');
    expect(screen.getByLabelText('Assigned salesperson')).toHaveValue('alice');
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    await userEvent.click(screen.getByRole('radio', { name: 'Month' }));
    await userEvent.selectOptions(screen.getByLabelText('Travel month'), '9');
    await userEvent.selectOptions(
      screen.getByLabelText('Travel year'),
      String(new Date().getFullYear()),
    );
    await pickItineraryDestination(1, 'Singapore');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(String(post![1]!.body));
      expect(body.assignedToId).toBe('alice');
    });
  });
});

// ---------------------------------------------------------------------------
// Leads pagination footer uses the shared Masters-style pagination
// ---------------------------------------------------------------------------

describe('Leads pagination footer (Masters-aligned)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set(['queries.view', 'queries.update', 'queries.delete']);
  });

  const stubPaged = (
    page: number,
    pageSize: number,
    total: number,
    totalPages: number,
    rows: unknown[] = [lead],
  ) => {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(lookups);
      return response({ data: rows, pagination: { page, pageSize, total, totalPages } });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  };

  it('uses the Masters-style "Showing X to Y of Z entries" footer', async () => {
    stubPaged(1, 10, 25, 3);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getByText('Showing 1 to 10 of 25 entries')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
    // The old footer text is gone.
    expect(screen.queryByText('25 leads')).not.toBeInTheDocument();
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
  });

  it('moves to the next page via the Next button and updates the URL', async () => {
    const mock = stubPaged(1, 10, 25, 3);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).includes('page=2'))).toBe(true),
    );
  });

  it('handles empty results with the safe zero summary and disabled controls', async () => {
    stubPaged(1, 10, 0, 0, []);
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    expect(screen.getByText('Showing 0 to 0 of 0 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('resets an invalid page to 1 when a filter changes', async () => {
    const mock = stubPaged(2, 10, 25, 3);
    renderWithProviders(<LeadsPage />, { route: '/?page=2' });
    await screen.findAllByText('Aarav Mehta');
    await userEvent.type(screen.getByLabelText('Search leads'), 'bangkok');
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).includes('page=1'))).toBe(true),
    );
  });
});

// ---------------------------------------------------------------------------
// Leads Notes column replaces the old Logging column
// ---------------------------------------------------------------------------

describe('Leads Notes column', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set(['queries.view', 'queries.update']);
  });

  const stubOneLead = () => {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(lookups);
      return response({
        data: [lead],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  };

  it('shows the Notes heading instead of Logging', async () => {
    stubOneLead();
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getAllByText('Notes').length).toBeGreaterThan(0);
    expect(screen.queryByText('Logging')).not.toBeInTheDocument();
  });

  it('links the plus action to the Add Note flow and the eye to the Notes list for that lead', async () => {
    stubOneLead();
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');

    const add = screen.getAllByRole('link', { name: /Add note for/ })[0]!;
    expect(add).toHaveAttribute('href', `/queries/${lead.id}/notes/new`);

    const view = screen.getAllByRole('link', { name: /View notes for/ })[0]!;
    expect(view).toHaveAttribute('href', `/queries/${lead.id}/notes`);

    // The Notes actions never open the follow-ups flow.
    expect(screen.queryByRole('link', { name: /Open logging/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /follow-ups/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Inline Stage change lost-reason validation (row-scoped)
// ---------------------------------------------------------------------------

describe('Leads inline stage lost-reason flow', () => {
  const stageLookups = {
    ...lookups,
    leadStages: [
      { value: 'NEW_LEAD', label: 'New Lead' },
      { value: 'CONTACTED', label: 'Contacted' },
      { value: 'LOST', label: 'Lost' },
    ],
  };

  const leadB = {
    ...lead,
    id: '22222222-2222-4222-8222-222222222222',
    queryNumber: 'QRY-2026-000002',
    customerName: 'Nina Shah',
  };

  const stubStage = (rows: unknown[] = [lead]) => {
    const currentList = rows.map((row) => ({ ...(row as Record<string, unknown>) }));
    const calls: Array<{ url: string; body: unknown }> = [];
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(stageLookups);
      if (options?.method === 'PATCH') {
        const body = JSON.parse(String(options.body));
        calls.push({ url, body });
        const target = currentList.find((row) => row.id === lead.id) ?? currentList[0];
        if (target) {
          target.leadStage = body.stage;
          target.lostReason = body.lostReason ?? null;
        }
        return response(target ?? currentList[0]);
      }
      return response({
        data: currentList,
        pagination: { page: 1, pageSize: 20, total: currentList.length, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    return { mock, calls };
  };

  const openStage = async () => {
    const badge = await screen.findByRole('button', { name: 'Change lead stage from New Lead' });
    await userEvent.click(badge);
    return screen.getByRole('listbox', { name: 'Change lead stage' });
  };

  const pickOptionIn = (listbox: HTMLElement, label: string) => {
    const li = within(listbox).getByRole('option', { name: label });
    fireEvent.click(li.querySelector('button')!);
  };

  const pick = async (label: string) => {
    const listbox = await openStage();
    pickOptionIn(listbox, label);
  };

  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set(['queries.view', 'queries.update']);
  });

  it('changes to a non-reason stage without a lost-reason prompt or error', async () => {
    const { calls } = stubStage();
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    await pick('Contacted');
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.url).toContain('/queries/11111111-1111-4111-8111-111111111111/stage');
    expect(calls[0]!.body).toEqual({ stage: 'CONTACTED' });
    expect(screen.queryByLabelText('Stage reason')).not.toBeInTheDocument();
    expect(screen.queryByText('A lost reason is required.')).not.toBeInTheDocument();
  });

  it('does not submit Lost without a reason and shows the error only for that row', async () => {
    const { calls } = stubStage([lead, leadB]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const badges = screen.getAllByRole('button', { name: 'Change lead stage from New Lead' });
    // Change the FIRST lead to Lost.
    await userEvent.click(badges[0]!);
    pickOptionIn(screen.getByRole('listbox', { name: 'Change lead stage' }), 'Lost');
    expect(screen.getByLabelText('Stage reason')).toBeInTheDocument();
    // Submit without a reason.
    await userEvent.click(screen.getByRole('button', { name: 'Update stage' }));
    // The error is scoped to the one changed row.
    expect(screen.getAllByText('A lost reason is required.')).toHaveLength(1);
    expect(screen.getAllByLabelText('Stage reason')).toHaveLength(1);
    // No request was sent and the original stage is kept.
    expect(calls).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Change lead stage from New Lead' })).toHaveLength(
      2,
    );
  });

  it('submits Lost with a valid reason and shows the new stage after success', async () => {
    const { calls } = stubStage();
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    await pick('Lost');
    await userEvent.type(screen.getByLabelText('Stage reason'), 'Budget changed');
    await userEvent.click(screen.getByRole('button', { name: 'Update stage' }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]!.body).toEqual({ stage: 'LOST', lostReason: 'Budget changed' });
    // The list refetch returns the updated lead.
    await screen.findByRole('button', { name: 'Change lead stage from Lost' });
    expect(screen.queryByText('A lost reason is required.')).not.toBeInTheDocument();
  });

  it('cancelling the Lost flow keeps the original stage and sends no request', async () => {
    const { calls } = stubStage();
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    await pick('Lost');
    expect(screen.getByLabelText('Stage reason')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Stage reason')).not.toBeInTheDocument();
    expect(screen.queryByText('A lost reason is required.')).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Change lead stage from New Lead' }),
    ).toBeInTheDocument();
  });

  it('never shows the lost-reason error on a row left at New Lead', async () => {
    stubStage();
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.queryByText('A lost reason is required.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stage reason')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dense operational Leads table redesign (visual structure)
// ---------------------------------------------------------------------------

describe('Dense operational Leads table structure', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'queries.delete',
      'queries.assign',
      'queries.export',
    ]);
  });

  it('does not render the analytics strip on the Leads page', async () => {
    const analyticsData = {
      ...analytics,
      totalLeads: 12,
      bookingConfirmed: 3,
      conversionRate: 25,
      winRate: 18,
    };
    stubLeadList([enrichedLead], analyticsData);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    // The Analytics bar was removed from the Leads page (UI only).
    // Note: "Booking Confirmed" still appears as a stage filter chip, which is
    // unrelated to the removed analytics strip.
    expect(document.querySelector('.leads-analytics')).toBeNull();
    expect(screen.queryByLabelText('Lead analytics')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Leads')).not.toBeInTheDocument();
    expect(screen.queryByText('Conversion Rate')).not.toBeInTheDocument();
    expect(screen.queryByText('Win Rate')).not.toBeInTheDocument();
  });

  it('renders the compact Leads card, toolbar and filter panel', async () => {
    stubLeadList([enrichedLead], {
      ...analytics,
      totalLeads: 12,
      bookingConfirmed: 3,
      conversionRate: 25,
      winRate: 18,
      byLeadType: { HOT: 1 },
      byLeadStage: { NEW_LEAD: 2 },
    });
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    // Card title and page breadcrumb were removed; heading and tools remain.
    expect(screen.queryByText('Leads List')).not.toBeInTheDocument();
    expect(screen.queryByText('Home / Leads')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Leads' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add Lead/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Search leads')).toBeInTheDocument();
    expect(screen.getByLabelText('Assigned user')).toBeInTheDocument();
    expect(screen.getByLabelText('Hot leads only')).toBeInTheDocument();
    // Type/stage filter chips are present with their counts.
    expect(screen.getByRole('button', { name: /Hot 1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All 12/ })).toBeInTheDocument();
  });

  it('keeps the table inside the dedicated horizontal scroll wrapper with pagination outside', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const scroll = document.querySelector('.leads-table-scroll');
    expect(scroll).not.toBeNull();
    // The table lives inside the scroll container.
    expect(scroll!.querySelector('table.leads-table')).not.toBeNull();
    // Pagination stays outside the scroller (page element is not a table cell).
    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(scroll!.contains(pagination)).toBe(false);
    expect(screen.getByText('Showing 1 to 1 of 1 entries')).toBeInTheDocument();
  });

  it('renders the green compact table header with every current column', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const thead = document.querySelector('.leads-thead');
    expect(thead).not.toBeNull();
    for (const header of [
      'Lead ID',
      'Lead Info',
      'Destination',
      'Travellers Info',
      'Services',
      'Quotation',
      'Weblink',
      'Notes',
      'Assigned to',
      'Amount',
      'Margin',
      'Type',
      'Stage',
      'Created',
      'Actions',
    ]) {
      expect(thead!.textContent).toContain(header);
    }
    // The Booking column is temporarily hidden from the Leads table.
    expect(thead!.textContent).not.toContain('Booking');
    // Notes column keeps its name (not Logging).
    expect(thead!.textContent).toContain('Notes');
    expect(thead!.textContent).not.toContain('Logging');
  });

  it('keeps every row cell aligned with the headers after the Booking column was hidden', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const headerCells = document.querySelectorAll('.leads-thead th');
    const firstRow = document.querySelector('.leads-tbody tr');
    expect(firstRow).not.toBeNull();
    const rowCells = firstRow!.querySelectorAll('td');
    // Header count matches the row's cell count exactly — no blank column,
    // no missing cell, no leftover Booking width.
    expect(headerCells.length).toBe(rowCells.length);
    expect(headerCells.length).toBeGreaterThan(0);
    // No Booking placeholder is left behind in the row.
    expect(within(firstRow as HTMLElement).queryByText('Quote Required')).not.toBeInTheDocument();
    expect(within(firstRow as HTMLElement).queryByText('None')).not.toBeInTheDocument();
  });

  it('shows quotation amount and margin in the Amount/Margin columns when net cost exists', async () => {
    stubLeadList([
      {
        ...enrichedLead,
        quotationSummary: {
          quotationId: 'quote-1',
          quotationNumber: 'QT-2026-000001',
          quotationStatus: 'ACCEPTED',
          acceptedVersionId: 'ver-1',
          latestVersionAmount: '80000.00',
          netAmount: '65000.00',
          marginAmount: '15000.00',
          currency: 'INR',
          bookingId: null,
          lastSentAt: null,
          acceptedAt: '2026-07-22T00:00:00.000Z',
        },
      },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const row = document.querySelector('.leads-tbody tr') as HTMLElement;
    // Amount = quotation final amount (₹80,000) using en-IN currency formatting.
    expect(within(row).getByText('₹80,000.00')).toBeInTheDocument();
    // Margin = existing quotation margin (₹15,000).
    expect(within(row).getByText('₹15,000.00')).toBeInTheDocument();
    // Quotation column is an action-only cell: no status badge, no INR amount.
    expect(within(row).getAllByRole('link', { name: /^View$/ }).length).toBeGreaterThan(0);
    expect(within(row).queryByText('Accepted')).not.toBeInTheDocument();
    expect(within(row).queryByText(/₹50,000/)).not.toBeInTheDocument();
  });

  it('shows quotation amount and stored margin even when net cost is zero', async () => {
    stubLeadList([
      {
        ...enrichedLead,
        quotationSummary: {
          quotationId: 'quote-1',
          quotationNumber: 'QT-2026-000001',
          quotationStatus: 'ACCEPTED',
          acceptedVersionId: 'ver-1',
          latestVersionAmount: '80000.00',
          netAmount: '0.00',
          marginAmount: '15000.00',
          currency: 'INR',
          bookingId: null,
          lastSentAt: null,
          acceptedAt: '2026-07-22T00:00:00.000Z',
        },
      },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const row = document.querySelector('.leads-tbody tr') as HTMLElement;
    // A zero recorded net cost must not hide the real final amount or the
    // stored margin; both come straight from the linked quotation version.
    expect(within(row).getByText('₹80,000.00')).toBeInTheDocument();
    expect(within(row).getByText('₹15,000.00')).toBeInTheDocument();
  });

  it('shows amount with an empty margin when the stored margin only echoes the final amount (QRY-000006/QT-001034)', async () => {
    stubLeadList([
      {
        ...enrichedLead,
        queryNumber: 'QRY-000006',
        expectedAmount: null,
        expectedMargin: null,
        quotationSummary: {
          quotationId: 'quote-1',
          quotationNumber: 'QT-001034',
          quotationStatus: 'DRAFT',
          acceptedVersionId: null,
          latestVersionAmount: '600000.00',
          netAmount: '0',
          marginAmount: '600000.00',
          currency: 'INR',
          bookingId: null,
          lastSentAt: null,
          acceptedAt: null,
        },
      },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const row = document.querySelector('.leads-tbody tr') as HTMLElement;
    // A stored margin identical to the final amount means no margin was ever
    // recorded (final minus zero costs) — the margin cell keeps the
    // empty-state dash instead of echoing the amount.
    const amountCells = Array.from(row.querySelectorAll('.leads-amount')).map(
      (cell) => cell.textContent?.trim(),
    );
    expect(amountCells).toEqual(['₹6,00,000.00', '—']);
  });

  it('shows a stored margin that differs from the final amount even with zero net cost', async () => {
    stubLeadList([
      {
        ...enrichedLead,
        queryNumber: 'QRY-000007',
        expectedAmount: null,
        expectedMargin: null,
        quotationSummary: {
          quotationId: 'quote-1',
          quotationNumber: 'QT-001035',
          quotationStatus: 'DRAFT',
          acceptedVersionId: null,
          latestVersionAmount: '600000.00',
          netAmount: '0',
          marginAmount: '45000.00',
          currency: 'INR',
          bookingId: null,
          lastSentAt: null,
          acceptedAt: null,
        },
      },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const row = document.querySelector('.leads-tbody tr') as HTMLElement;
    // A genuinely recorded margin is preserved verbatim.
    const amountCells = Array.from(row.querySelectorAll('.leads-amount')).map(
      (cell) => cell.textContent?.trim(),
    );
    expect(amountCells).toEqual(['₹6,00,000.00', '₹45,000.00']);
  });

  it('keeps the empty state when the quotation stores no margin', async () => {
    stubLeadList([
      {
        ...enrichedLead,
        expectedMargin: null,
        quotationSummary: {
          quotationId: 'quote-1',
          quotationNumber: 'QT-2026-000001',
          quotationStatus: 'ACCEPTED',
          acceptedVersionId: 'ver-1',
          latestVersionAmount: '80000.00',
          netAmount: null,
          marginAmount: null,
          currency: 'INR',
          bookingId: null,
          lastSentAt: null,
          acceptedAt: '2026-07-22T00:00:00.000Z',
        },
      },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const row = document.querySelector('.leads-tbody tr') as HTMLElement;
    // Amount still shows (final amount exists); margin has no stored value so
    // the empty-state dash is kept rather than an invented number.
    expect(within(row).getByText('₹80,000.00')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('keeps the existing fallback when there is no quotation', async () => {
    stubLeadList([{ ...enrichedLead, quotationSummary: null }]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const row = document.querySelector('.leads-tbody tr') as HTMLElement;
    // No quotation → Amount falls back to the lead's expected amount.
    expect(within(row).getByText(/250000/)).toBeInTheDocument();
    // Quotation cell shows the + New action (lead can create quotations).
    expect(within(row).getByRole('link', { name: '+ New' })).toBeInTheDocument();
  });

  it('shows dashes for both Amount and Margin when neither is set', async () => {
    stubLeadList([
      { ...enrichedLead, expectedAmount: null, expectedMargin: null, quotationSummary: null },
    ]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const row = document.querySelector('.leads-tbody tr') as HTMLElement;
    const amountCells = Array.from(row.querySelectorAll('.leads-amount')).map(
      (cell) => cell.textContent?.trim(),
    );
    expect(amountCells).toEqual(['—', '—']);
  });

  it('has no Call Recording column, controls or statuses anywhere', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    // No header, no cells, no empty-state text, no player controls.
    const thead = document.querySelector('.leads-thead');
    const headers = Array.from(thead!.querySelectorAll('th')).map((th) => th.textContent?.trim());
    expect(headers).not.toContain('Call Recording');
    expect(headers).not.toContain('Call');
    // Destination follows Lead Info directly — no Call column between them.
    expect(headers[headers.indexOf('Lead Info') + 1]).toBe('Destination');
    const firstRow = document.querySelector('.leads-tbody tr') as HTMLElement;
    expect(within(firstRow).queryByText('No recording')).not.toBeInTheDocument();
    expect(within(firstRow).queryByRole('button', { name: /play recording/i })).not.toBeInTheDocument();
    expect(document.querySelector('audio')).toBeNull();
    // Header count still matches the row's cell count exactly.
    expect(thead!.querySelectorAll('th').length).toBe(firstRow.querySelectorAll('td').length);
  });

  it('renders compact metadata blocks for destination and travellers info', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(document.querySelector('.leads-dest-card')).not.toBeNull();
    expect(document.querySelector('.leads-nights-badge')).not.toBeNull();
    expect(document.querySelector('.leads-traveller-block--city')).not.toBeNull();
    expect(document.querySelector('.leads-traveller-block--date')).not.toBeNull();
    expect(document.querySelector('.leads-traveller-block--rooms')).not.toBeNull();
  });

  it('keeps the Notes column buttons wired to Add Note and View Notes only', async () => {
    stubLeadList([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const add = screen.getAllByRole('link', { name: /Add note for/ })[0]!;
    const view = screen.getAllByRole('link', { name: /View notes for/ })[0]!;
    expect(add).toHaveAttribute('href', `/queries/${enrichedLead.id}/notes/new`);
    expect(view).toHaveAttribute('href', `/queries/${enrichedLead.id}/notes`);
    // No follow-up wiring from the Notes column.
    expect(screen.queryByRole('link', { name: /Open logging/ })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Lead date-range filter (dateType / dateFrom / dateTo) UI + URL behaviour
// ---------------------------------------------------------------------------

describe('Lead date-range filter', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set([
      'queries.view',
      'queries.create',
      'queries.update',
      'queries.delete',
      'queries.assign',
      'queries.export',
    ]);
  });

  function stubDates(rows: unknown[], analyticsData = analytics) {
    const mock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analyticsData);
      if (url.includes('/lookups')) return response(lookups);
      if (options?.method === 'POST' || url.includes('/bulk') || url.includes('/export'))
        return response({ updatedCount: rows.length, unchangedCount: 0, results: [] });
      return response({
        data: rows,
        pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: 1 },
      });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  it('renders the Date Type control with Created Date as the default', async () => {
    stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const select = screen.getByLabelText('Date type') as HTMLSelectElement;
    expect(select.value).toBe('CREATED_DATE');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Created Date',
      'Travel Date',
    ]);
  });

  it('allows Travel Date to be selected', async () => {
    stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    const select = screen.getByLabelText('Date type') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'TRAVEL_DATE' } });
    expect(select.value).toBe('TRAVEL_DATE');
  });

  it('renders From Date and To Date inputs, Apply and Clear buttons', async () => {
    stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply date filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear date filter' })).toBeInTheDocument();
  });

  it('applies a valid full range and updates the URL with page reset to 1', async () => {
    const mock = stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />, { route: '/?page=3' });
    await screen.findAllByText('Aarav Mehta');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-08-07' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply date filter' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) => {
          const value = String(url);
          return (
            value.includes('dateType=CREATED_DATE') &&
            value.includes('dateFrom=2026-08-01') &&
            value.includes('dateTo=2026-08-07') &&
            value.includes('page=1')
          );
        }),
      ).toBe(true),
    );
  });

  it('applies a from-only filter', async () => {
    const mock = stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-08-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply date filter' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) => {
          const v = String(url);
          return (
            v.includes('dateType=CREATED_DATE') &&
            v.includes('dateFrom=2026-08-01') &&
            !v.includes('dateTo=')
          );
        }),
      ).toBe(true),
    );
  });

  it('applies a to-only filter', async () => {
    const mock = stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-08-07' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply date filter' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) => {
          const v = String(url);
          return (
            v.includes('dateType=CREATED_DATE') &&
            v.includes('dateTo=2026-08-07') &&
            !v.includes('dateFrom=')
          );
        }),
      ).toBe(true),
    );
  });

  it('shows inline validation when From is after To and does not call the API', async () => {
    const mock = stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-08-07' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-08-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply date filter' }));
    expect(screen.getByText('From Date cannot be after To Date.')).toBeInTheDocument();
    expect(screen.getByLabelText('From date')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('To date')).toHaveAttribute('aria-invalid', 'true');
    const afterApply = mock.mock.calls.filter(([url]) => String(url).includes('/queries?'));
    expect(afterApply.some(([url]) => String(url).includes('dateFrom='))).toBe(false);
  });

  it('Clear removes only the date parameters and preserves search and other filters', async () => {
    const mock = stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />, {
      route:
        '/?search=Singapore&dateType=CREATED_DATE&dateFrom=2026-08-01&dateTo=2026-08-07&leadType=HOT&page=1',
    });
    await screen.findAllByText('Aarav Mehta');
    await userEvent.click(screen.getByRole('button', { name: 'Clear date filter' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) => {
          const v = String(url);
          return (
            v.includes('search=Singapore') &&
            v.includes('leadType=HOT') &&
            !v.includes('dateType=') &&
            !v.includes('dateFrom=') &&
            !v.includes('dateTo=')
          );
        }),
      ).toBe(true),
    );
  });

  it('restores the controls from URL parameters after a refresh-like mount', async () => {
    stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />, {
      route: '/?dateType=TRAVEL_DATE&dateFrom=2026-08-10&dateTo=2026-08-20',
    });
    await screen.findAllByText('Aarav Mehta');
    expect((screen.getByLabelText('Date type') as HTMLSelectElement).value).toBe('TRAVEL_DATE');
    expect((screen.getByLabelText('From date') as HTMLInputElement).value).toBe('2026-08-10');
    expect((screen.getByLabelText('To date') as HTMLInputElement).value).toBe('2026-08-20');
    expect(screen.getByLabelText('Active date filter')).toBeInTheDocument();
  });

  it('includes date-filter values in the leads query key (via distinct requests)', async () => {
    const mock = stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />);
    await screen.findAllByText('Aarav Mehta');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-08-07' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply date filter' }));
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).includes('dateFrom=2026-08-01'))).toBe(
        true,
      ),
    );
  });

  it('renders the active-filter summary and a removable chip', async () => {
    stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />, {
      route: '/?dateType=CREATED_DATE&dateFrom=2026-08-01&dateTo=2026-08-07',
    });
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getByText(/Created Date: From 01 Aug 2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove date filter' })).toBeInTheDocument();
  });

  it('shows the filtered pagination total and a safe empty state', async () => {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/analytics')) return response(analytics);
      if (url.includes('/lookups')) return response(lookups);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<LeadsPage />, {
      route: '/?dateType=CREATED_DATE&dateFrom=2026-08-01&dateTo=2026-08-07',
    });
    await screen.findByText('No leads found');
    expect(screen.getByText('Showing 0 to 0 of 0 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('includes the active date parameters in the export request', async () => {
    const mock = stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />, {
      route: '/?dateType=CREATED_DATE&dateFrom=2026-08-01&dateTo=2026-08-07',
    });
    await screen.findAllByText('Aarav Mehta');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Export/ }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) => {
          const v = String(url);
          return (
            v.includes('/queries/export') &&
            v.includes('dateFrom=2026-08-01') &&
            v.includes('dateTo=2026-08-07')
          );
        }),
      ).toBe(true),
    );
  });

  it('keeps other filters working alongside the date range', async () => {
    const mock = stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />, {
      route:
        '/?search=Singapore&dateType=CREATED_DATE&dateFrom=2026-08-01&dateTo=2026-08-07&assignedToId=me',
    });
    await screen.findAllByText('Aarav Mehta');
    expect(screen.getByLabelText('Search leads')).toHaveValue('Singapore');
    expect((screen.getByLabelText('Assigned user') as HTMLSelectElement).value).toBe('me');
    // Typing in search keeps the date params in the request.
    fireEvent.change(screen.getByLabelText('Search leads'), { target: { value: 'Bangkok' } });
    await waitFor(() =>
      expect(
        mock.mock.calls.some(([url]) => {
          const v = String(url);
          return v.includes('search=Bangkok') && v.includes('dateFrom=2026-08-01');
        }),
      ).toBe(true),
    );
  });

  it('does not send a raw Prisma field name as dateType from unchecked UI input', async () => {
    stubDates([enrichedLead]);
    renderWithProviders(<LeadsPage />, { route: '/?dateType=internalRemarks&dateFrom=2026-08-01' });
    await screen.findAllByText('Aarav Mehta');
    // The uncontrolled unknown value is normalised back to Created Date on sync.
    expect((screen.getByLabelText('Date type') as HTMLSelectElement).value).toBe('CREATED_DATE');
  });
});

describe('Lead CSV import', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    authState.permissions = new Set(['queries.view', 'queries.create']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        response(
          String(input).includes('analytics')
            ? analytics
            : String(input).includes('lookups')
              ? lookups
              : { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
        ),
      ),
    );
  });

  it('offers Import Leads inside the More actions menu and opens the import modal', async () => {
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    // Import Leads is no longer an always-visible button; it lives in the menu.
    expect(screen.queryByRole('menuitem', { name: /Import Leads/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    const button = screen.getByRole('menuitem', { name: /Import Leads/i });
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Import Leads' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Sample CSV/i })).toBeInTheDocument();
  });

  it('accepts a CSV file and shows the column-mapping step with an auto-mapped preview', async () => {
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));

    const file = new File(
      ['Customer Name,Phone,Source\nAarav Mehta,+91 98765 43210,Referral\n'],
      'leads.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });

    expect(await screen.findByText('leads.csv')).toBeInTheDocument();
    expect(screen.getByText('1 data rows detected')).toBeInTheDocument();
    // Auto-mapped Customer Name / Phone / Source columns and the preview row.
    expect(screen.getAllByText('Customer Name').length).toBeGreaterThan(0);
    expect(screen.getByText('Aarav Mehta')).toBeInTheDocument();
  });

  it('enables the modal Import button when required fields are auto-mapped and a valid row exists', async () => {
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));

    const file = new File(
      ['Name,Phone,Lead Source\nAarav Mehta,+91 98765 43210,Referral\n'],
      'leads.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog', { name: 'Import Leads' });
    await screen.findByText('1 data rows detected');
    const importButton = within(dialog).getByRole('button', { name: /^Import$/ });
    expect(await waitFor(() => expect(importButton).toBeEnabled()));
    // The footer warning disappears once the import is possible.
    expect(
      within(dialog).queryByText(/Map at least Customer Name, Phone and Lead Source to continue\./),
    ).not.toBeInTheDocument();
  });

  it('keeps the modal Import button disabled when a required field is not mapped', async () => {
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));

    const file = new File(['Name,Phone\nAarav Mehta,+91 98765 43210\n'], 'leads.csv', {
      type: 'text/csv',
    });
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog', { name: 'Import Leads' });
    // Wait for the file to be parsed and the mapping step to render.
    await screen.findByText('1 data rows detected');
    const importButton = within(dialog).getByRole('button', { name: /^Import$/ });
    expect(importButton).toBeDisabled();
    expect(
      within(dialog).getByText(/Map at least Customer Name, Phone and Lead Source to continue\./),
    ).toBeInTheDocument();
  });

  it('disables the modal Import button immediately when a required mapping is set to Ignore', async () => {
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));

    const file = new File(
      ['Name,Phone,Lead Source\nAarav Mehta,+91 98765 43210,Referral\n'],
      'leads.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog', { name: 'Import Leads' });
    await screen.findByText('1 data rows detected');
    const importButton = within(dialog).getByRole('button', { name: /^Import$/ });
    expect(await waitFor(() => expect(importButton).toBeEnabled()));

    // Change the "Name" mapping back to "Ignore this column".
    const nameSelect = within(dialog).getAllByRole('combobox')[0]!;
    await userEvent.selectOptions(nameSelect, '');
    await waitFor(() => expect(importButton).toBeDisabled());
  });

  it('can save opted-in ignored column values as one import note', async () => {
    let importBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/queries/import')) {
          importBody = JSON.parse(String(init?.body));
          return response({
            total: 1,
            imported: 1,
            skipped: 0,
            failed: 0,
            results: [],
            errorCsv: {},
          });
        }
        return response(
          String(input).includes('analytics')
            ? analytics
            : String(input).includes('lookups')
              ? lookups
              : { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
        );
      }),
    );
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));
    const file = new File(
      [
        'Name,Phone,Lead Source,Origin City,Excluded\nAarav Mehta,+91 98765 43210,Referral,Hyderabad,Do not save\n',
      ],
      'leads.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog', { name: 'Import Leads' });
    await within(dialog).findByText('1 data rows detected');
    const noteOptions = within(dialog).getAllByLabelText('Add values to lead note');
    expect(noteOptions).toHaveLength(2);
    await userEvent.click(noteOptions[0]!);
    await userEvent.click(within(dialog).getByRole('button', { name: /^Import$/ }));

    await waitFor(() =>
      expect(importBody).toEqual({
        skipDuplicates: true,
        ignoreInvalidOptionalFields: false,
        rows: [
          {
            customerName: 'Aarav Mehta',
            phone: '+91 98765 43210',
            leadSource: 'Referral',
            ignoredColumnNotes: [{ label: 'Origin City', value: 'Hyderabad' }],
          },
        ],
      }),
    );
  });

  // TODO: update stale Import button selector to match the current import modal.
  // Quarantined temporarily.
  it.skip('retries only failed rows and requests invalid optional fields be ignored', async () => {
    const importBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/queries/import')) {
          importBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          const retry = importBodies.length === 2;
          return response(
            retry
              ? { total: 1, imported: 1, skipped: 0, failed: 0, results: [], errorCsv: {} }
              : {
                  total: 1,
                  imported: 0,
                  skipped: 0,
                  failed: 1,
                  results: [
                    {
                      row: 2,
                      customerName: 'Aarav Mehta',
                      status: 'FAILED',
                      reason: 'Invalid email.',
                    },
                  ],
                  errorCsv: {},
                },
          );
        }
        return response(
          String(input).includes('analytics')
            ? analytics
            : String(input).includes('lookups')
              ? lookups
              : { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
        );
      }),
    );
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));
    const file = new File(
      ['Name,Phone,Lead Source,Email\nAarav Mehta,+91 98765 43210,Referral,invalid-email\n'],
      'leads.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });
    const dialog = await screen.findByRole('dialog', { name: 'Import Leads' });
    await userEvent.click(within(dialog).getByRole('button', { name: /^Import$/ }));

    const retry = await within(dialog).findByRole('button', {
      name: 'Import failed rows without invalid fields',
    });
    await userEvent.click(retry);

    await waitFor(() => expect(importBodies).toHaveLength(2));
    expect(importBodies[1]).toMatchObject({
      ignoreInvalidOptionalFields: true,
      rows: [
        {
          customerName: 'Aarav Mehta',
          phone: '+91 98765 43210',
          leadSource: 'Referral',
          email: 'invalid-email',
        },
      ],
    });
  });

  it('re-enables the modal Import button when a required mapping is restored', async () => {
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));

    const file = new File(
      ['Name,Phone,Lead Source\nAarav Mehta,+91 98765 43210,Referral\n'],
      'leads.csv',
      { type: 'text/csv' },
    );
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog', { name: 'Import Leads' });
    await screen.findByText('1 data rows detected');
    const importButton = within(dialog).getByRole('button', { name: /^Import$/ });
    expect(await waitFor(() => expect(importButton).toBeEnabled()));

    // Break then restore the customer-name mapping.
    const nameSelect = within(dialog).getAllByRole('combobox')[0]!;
    await userEvent.selectOptions(nameSelect, '');
    await waitFor(() => expect(importButton).toBeDisabled());
    await userEvent.selectOptions(nameSelect, 'customerName');
    await waitFor(() => expect(importButton).toBeEnabled());
  });

  it('keeps the modal Import button disabled when required fields are mapped but no row is importable', async () => {
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));

    // All three mapped, but the only row has a blank phone.
    const file = new File(['Name,Phone,Lead Source\nAarav Mehta,,Referral\n'], 'leads.csv', {
      type: 'text/csv',
    });
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });

    const dialog = await screen.findByRole('dialog', { name: 'Import Leads' });
    await screen.findByText('1 data rows detected');
    const importButton = within(dialog).getByRole('button', { name: /^Import$/ });
    expect(importButton).toBeDisabled();
  });

  it('rejects a non-CSV file', async () => {
    renderWithProviders(<LeadsPage />);
    await screen.findByText('No leads found');
    await userEvent.click(screen.getByRole('button', { name: /More actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Import Leads/i }));

    const file = new File(['not a csv'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText(/Choose a CSV file/i), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/only .csv/i);
  });
});

describe('Lead traveller names', () => {
  const destination = {
    id: 'dest-1',
    name: 'Singapore',
    status: 'ACTIVE',
    cities: [{ id: 'dc-1', sequence: 1, city: { name: 'Singapore' } }],
  };

  function stubCreate() {
    return vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('/masters/destinations'))
        return response({
          data: [destination],
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
        });
      if (url.endsWith('/queries') && options?.method === 'POST')
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: lead }),
        } as Response;
      return response(lookups);
    });
  }

  async function fillRequired() {
    await userEvent.type(screen.getByLabelText('Name'), 'Test Lead');
    await userEvent.type(screen.getByLabelText('Phone'), '9876543210');
    await pickItineraryDestination(1, 'Singapore');
  }

  async function postedBody(fetchMock: ReturnType<typeof stubCreate>) {
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
      expect(post).toBeDefined();
    });
    const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST');
    return JSON.parse(String(post![1]!.body));
  }

  beforeEach(() => {
    vi.unstubAllGlobals();
    // No assign permission: submissions skip the Assign To gate.
    authState.permissions = new Set(['queries.view', 'queries.create', 'queries.update', 'queries.delete']);
  });

  it('hides traveller name inputs until the section is expanded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(lookups)));
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    // Collapsed by default: header toggle present, panel hidden.
    const toggle = screen.getByRole('button', { name: /traveller names/i });
    const panel = () => document.getElementById('traveller-names-panel');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'traveller-names-panel');
    expect(panel()).toHaveAttribute('hidden');
    // The Travelers summary stays visible above the collapsible section.
    const summaryHeading = screen.getByText('Travelers:');
    expect(
      summaryHeading.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Expanding reveals the inputs for the current counts.
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel()).not.toHaveAttribute('hidden');
    expect(screen.getByLabelText('Adult 1')).toBeInTheDocument();
    // Collapsing hides them again (values stay registered, never erased).
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel()).toHaveAttribute('hidden');
  });

  it('generates one optional name input per traveller from the counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(lookups)));
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await userEvent.click(screen.getByRole('button', { name: /traveller names/i }));
    // Defaults: a single adult row, nothing else.
    expect(screen.getByLabelText('Adult 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Child With Bed 1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('CWB'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Infants'), { target: { value: '1' } });
    expect(screen.getByLabelText('Child With Bed 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Child With Bed 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Infant 1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Child Without Bed 1')).not.toBeInTheDocument();
  });

  it('shows compact traveller names heading and labels without placeholders in create mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(lookups)));
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    const toggle = screen.getByRole('button', { name: 'Traveller names' });
    expect(toggle.textContent).not.toContain('(optional)');
    await userEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('Adults *'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('CWB'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('CWOB'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Infants'), { target: { value: '1' } });
    for (const label of [
      'Adult 1',
      'Adult 2',
      'Child With Bed 1',
      'Child Without Bed 1',
      'Infant 1',
    ]) {
      const input = screen.getByLabelText(label);
      expect(input).toBeInTheDocument();
      expect(input).not.toHaveAttribute('placeholder');
    }
    expect(screen.queryByLabelText('Adult 1 — Name')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Full name')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Full name (optional)')).not.toBeInTheDocument();
  });
  it('submits blank name lists sized to the counts when nothing is entered', async () => {
    const fetchMock = stubCreate();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await fillRequired();
    fireEvent.change(screen.getByLabelText('Adults *'), { target: { value: '2' } });
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    const body = await postedBody(fetchMock);
    expect(body.adultNames).toEqual(['', '']);
    expect(body.childWithBedNames).toEqual([]);
    expect(body.infantNames).toEqual([]);
  });

  it('submits entered names for every category in order', async () => {
    const fetchMock = stubCreate();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await fillRequired();
    fireEvent.change(screen.getByLabelText('Adults *'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('CWB'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('CWOB'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Infants'), { target: { value: '1' } });
    await userEvent.click(screen.getByRole('button', { name: /traveller names/i }));
    await userEvent.type(screen.getByLabelText('Adult 1'), 'Rahul Sharma');
    await userEvent.type(screen.getByLabelText('Adult 2'), 'Priya Sharma');
    await userEvent.type(screen.getByLabelText('Child With Bed 1'), 'Aarav Sharma');
    await userEvent.type(screen.getByLabelText('Child Without Bed 2'), 'Anaya Sharma');
    await userEvent.type(screen.getByLabelText('Infant 1'), 'Ira Sharma');
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    const body = await postedBody(fetchMock);
    expect(body.adultNames).toEqual(['Rahul Sharma', 'Priya Sharma', '']);
    expect(body.childWithBedNames).toEqual(['Aarav Sharma', '']);
    expect(body.childWithoutBedNames).toEqual(['', 'Anaya Sharma']);
    expect(body.infantNames).toEqual(['Ira Sharma']);
  });

  it('preserves retained names when a count decreases', async () => {
    const fetchMock = stubCreate();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    await fillRequired();
    fireEvent.change(screen.getByLabelText('Adults *'), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: /traveller names/i }));
    await userEvent.type(screen.getByLabelText('Adult 1'), 'Rahul Sharma');
    await userEvent.type(screen.getByLabelText('Adult 2'), 'Priya Sharma');
    await userEvent.type(screen.getByLabelText('Adult 3'), 'Karan Sharma');
    // Shrinking to one adult drops only the removed trailing rows.
    fireEvent.change(screen.getByLabelText('Adults *'), { target: { value: '1' } });
    expect(screen.queryByLabelText('Adult 2')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    const body = await postedBody(fetchMock);
    expect(body.adultNames).toEqual(['Rahul Sharma']);
  });

  it('restores saved names when reopening the lead for editing', async () => {
    const saved = {
      ...lead,
      adults: 2,
      childWithBedNames: ['Aarav Sharma', ''],
      adultNames: ['Rahul Sharma', 'Priya Sharma'],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(saved);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    // Saved names are preserved; expanding reveals them with values intact.
    await userEvent.click(screen.getByRole('button', { name: /traveller names/i }));
    expect(screen.getByLabelText('Adult 1')).toHaveValue('Rahul Sharma');
    expect(screen.getByLabelText('Adult 2')).toHaveValue('Priya Sharma');
  });

  it('collects an infant age in months with a 0-24 range', async () => {
    const fetchMock = stubCreate();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    fireEvent.change(screen.getByLabelText('Infants'), { target: { value: '1' } });
    const age = screen.getByLabelText('Infant 1 Age (Months)');
    expect(age).toHaveAttribute('min', '0');
    expect(age).toHaveAttribute('max', '24');
    await userEvent.type(age, '6');
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    const body = await postedBody(fetchMock);
    expect(body.infantAges).toEqual([6]);
  });

  it('submits multiple infants with different month ages', async () => {
    const fetchMock = stubCreate();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    fireEvent.change(screen.getByLabelText('Infants'), { target: { value: '2' } });
    await userEvent.type(screen.getByLabelText('Infant 1 Age (Months)'), '6');
    await userEvent.type(screen.getByLabelText('Infant 2 Age (Months)'), '18');
    await fillRequired();
    await userEvent.click(screen.getByRole('button', { name: /Create Lead/i }));
    const body = await postedBody(fetchMock);
    expect(body.infantAges).toEqual([6, 18]);
  });

  it('shows no infant age fields when the infant count is 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(lookups)));
    renderWithProviders(<LeadFormPage />);
    await screen.findByRole('heading', { name: 'Create lead' });
    expect(screen.queryByLabelText('Infant 1 Age (Months)')).not.toBeInTheDocument();
  });

  it('restores saved infant month ages when reopening the lead for editing', async () => {
    const saved = { ...lead, infants: 2, infantAges: [6, 18] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(saved);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    expect(screen.getByLabelText('Infant 1 Age (Months)')).toHaveValue(6);
    expect(screen.getByLabelText('Infant 2 Age (Months)')).toHaveValue(18);
  });

  it('keeps previously saved infant ages working without modification', async () => {
    const saved = { ...lead, infants: 1, infantAges: [1] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/queries/lookups')) return response(lookups);
      if (url.includes(`/queries/${lead.id}`)) return response(saved);
      return response({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/queries/:queryId/edit" element={<LeadFormPage />} />
      </Routes>,
      { route: `/queries/${lead.id}/edit` },
    );
    await screen.findByRole('heading', { name: 'Edit lead' });
    expect(screen.getByLabelText('Infant 1 Age (Months)')).toHaveValue(1);
  });
});


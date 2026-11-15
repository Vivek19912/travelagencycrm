import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { SightseeingPage } from './SightseeingPage';
import { SightseeingFormPage } from './SightseeingFormPage';
import { SightseeingDetailsPage } from './SightseeingDetailsPage';
import { AddOnServicesPage } from './AddOnServicesPage';
import { AddOnServiceFormPage } from './AddOnServiceFormPage';
import { AddOnServiceDetailsPage } from './AddOnServiceDetailsPage';
import { NAV_ITEMS } from '@/components/layout/navigation';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const cityId = '11111111-1111-4111-8111-111111111111';
const otherCityId = '11111111-1111-4111-8111-111111111112';
const destinationId = '22222222-2222-4222-8222-222222222222';
const sightseeingId = '77777777-7777-4777-8777-777777777777';
const serviceId = '88888888-8888-4888-8888-888888888888';

const destination = {
  id: destinationId,
  name: 'Azerbaijan',
  countryCode: 'AZ',
  countryName: 'Azerbaijan',
  destinationType: 'INTERNATIONAL',
  status: 'ACTIVE',
  cities: [
    { id: 'link-1', cityId, sequence: 0, city: { id: cityId, name: 'Baku', airportCode: 'GYD' } },
  ],
  _count: { cities: 1 },
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  createdBy: { id: 'u1', fullName: 'Aditi Rao' },
};

const sightseeing = {
  id: sightseeingId,
  title: 'Gobustan Rock Art Tour',
  sequence: 2,
  estimatedHours: 5,
  suggestedStartTime: '10:00',
  description: '<p>Begin your exploration of Qobustan.</p>',
  remarks: '<p>Carry water.</p>',
  status: 'ACTIVE',
  hasImage: false,
  imageFileName: null,
  imageMimeType: null,
  imageConfirmedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  destination: { id: destinationId, name: 'Azerbaijan' },
  city: { id: cityId, name: 'Baku' },
  createdBy: { id: 'u1', fullName: 'Aditi Rao' },
  updatedBy: null,
};

const service = {
  id: serviceId,
  name: 'Singapore Visa',
  description: '<p>Docs Required: Passport</p>',
  price: 3800,
  currency: 'INR',
  status: 'ACTIVE',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: { id: 'u1', fullName: 'Aditi Rao' },
  updatedBy: null,
};

const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});

const summary = { totalAttractions: 1, destinations: 1, citiesCovered: 1, withImages: 0 };

/** Route the many list/lookup calls these pages make. */
function stubApi(overrides: { sightseeing?: unknown; services?: unknown } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/masters/sightseeing/summary')) return response(summary);
      if (url.includes(`/masters/destinations/${destinationId}`)) return response(destination);
      if (url.includes('/masters/destinations')) return response(page([destination]));
      if (url.includes('/masters/cities'))
        return response(page([{ id: cityId, name: 'Baku', status: 'ACTIVE' }]));
      if (url.includes(`/masters/sightseeing/${sightseeingId}`)) return response(sightseeing);
      if (url.includes('/masters/sightseeing'))
        return response(overrides.sightseeing ?? page([sightseeing]));
      if (url.includes(`/masters/add-on-services/${serviceId}`)) return response(service);
      if (url.includes('/masters/add-on-services'))
        return response(overrides.services ?? page([service]));
      return response(page([]));
    }),
  );
}

const ALL = [
  'masters.sightseeing.view',
  'masters.sightseeing.create',
  'masters.sightseeing.update',
  'masters.sightseeing.delete',
  'masters.sightseeing.manage_media',
  'masters.add_on_services.view',
  'masters.add_on_services.create',
  'masters.add_on_services.update',
  'masters.add_on_services.delete',
];

describe('Phase 13D master pages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  it('exposes Sightseeing and Add-On Services inside the existing Masters group', () => {
    const masters = NAV_ITEMS.find((item) => item.label === 'Masters');
    expect(masters?.children?.map((item) => item.label)).toEqual([
      'Cities',
      'Destinations',
      'Hotels',
      'Airlines',
      'Cruises',
      'Vehicles',
      'Sightseeing',
      'Add-On Services',
    ]);
    expect(masters?.children?.find((item) => item.label === 'Sightseeing')?.to).toBe(
      '/masters/sightseeing',
    );
    expect(masters?.children?.find((item) => item.label === 'Add-On Services')?.to).toBe(
      '/masters/add-on-services',
    );
  });

  // -------------------------------------------------------------------------
  // Sightseeing
  // -------------------------------------------------------------------------

  it('renders the sightseeing list grouped by destination and city', async () => {
    stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });

    // Destination groups are collapsed by default; expand to reveal the rows.
    await userEvent.click(await screen.findByRole('button', { name: /Azerbaijan/ }));
    expect((await screen.findAllByText('Gobustan Rock Art Tour')).length).toBeGreaterThan(0);
    // Destination and city group headers.
    expect(screen.getAllByText('Azerbaijan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Baku').length).toBeGreaterThan(0);
    // Sequence, duration and start-time cells.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5.0h')).toBeInTheDocument();
    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    // Description rendered as plain text, not raw HTML.
    expect(screen.getByText(/Begin your exploration of Qobustan\./)).toBeInTheDocument();
  });

  it('renders sightseeing rows in ascending sequence order within a city', async () => {
    const base = (id: string, title: string, sequence: number) => ({
      ...sightseeing,
      id,
      title,
      sequence,
    });
    stubApi({
      sightseeing: page([base('a', 'Garden', 1), base('b', 'Zoo', 2), base('c', 'Museum', 3)]),
    });
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });

    await userEvent.click(await screen.findByRole('button', { name: /Azerbaijan/ }));
    await waitFor(() =>
      expect(document.querySelector('table tbody tr')?.textContent ?? '').toContain('Garden'),
    );
    // Desktop table rows follow ascending sequence (1, 2, 3), top to bottom.
    const table = document.querySelector('table');
    const titles = [...(table?.querySelectorAll('tbody tr td:nth-child(2) a') ?? [])].map(
      (link) => link.textContent,
    );
    expect(titles).toEqual(['Garden', 'Zoo', 'Museum']);
    const sequences = [...(table?.querySelectorAll('tbody tr td:nth-child(4) span') ?? [])].map(
      (badge) => badge.textContent,
    );
    expect(sequences).toEqual(['1', '2', '3']);
  });

  it('renders the sightseeing summary statistics', async () => {
    stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });

    await waitFor(() => expect(screen.getByText('Summary Statistics')).toBeInTheDocument());
    expect(screen.getByText('Total Attractions')).toBeInTheDocument();
    expect(screen.getByText('Cities Covered')).toBeInTheDocument();
  });

  it('shows the sightseeing loading state', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { container } = renderWithProviders(<SightseeingPage />, {
      route: '/masters/sightseeing',
    });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows the sightseeing empty state', async () => {
    stubApi({ sightseeing: page([]) });
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    expect(await screen.findByText('No sightseeing found')).toBeInTheDocument();
  });

  it('shows the sightseeing error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
      })) as unknown as typeof fetch,
    );
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent(
      'Sightseeing could not be loaded.',
    );
  });

  it('hides sightseeing create, edit, reorder and delete actions without permission', async () => {
    auth.permissions = new Set(['masters.sightseeing.view']);
    stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });

    await screen.findAllByText('Gobustan Rock Art Tour');
    expect(screen.queryByRole('link', { name: /add new sightseeing/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /edit gobustan rock art tour/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /move gobustan rock art tour up/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete gobustan rock art tour/i }),
    ).not.toBeInTheDocument();
  });

  it('validates the sightseeing create form before calling the API', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWithProviders(<SightseeingFormPage />, { route: '/masters/sightseeing/new' });

    await user.click(screen.getByRole('button', { name: /create sightseeing/i }));
    expect(await screen.findByText('Select a destination.')).toBeInTheDocument();
    expect(screen.getByText('Select a city.')).toBeInTheDocument();
    expect(screen.getByText('Title is required.')).toBeInTheDocument();
  });

  it('loads cities only after a destination is chosen', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWithProviders(<SightseeingFormPage />, { route: '/masters/sightseeing/new' });

    const citySelect = await screen.findByLabelText(/city/i);
    // Disabled until a destination is picked.
    expect(citySelect).toBeDisabled();

    const destinationSelect = screen.getByLabelText(/destination/i);
    await waitFor(() => expect(destinationSelect).toHaveTextContent('Azerbaijan'));
    await user.selectOptions(destinationSelect, destinationId);

    await waitFor(() => expect(citySelect).not.toBeDisabled());
    await waitFor(() => expect(citySelect).toHaveTextContent('Baku'));
  });

  it('loads an existing sightseeing into the edit form', async () => {
    stubApi();
    renderWithProviders(
      <Routes>
        <Route path="/masters/sightseeing/:sightseeingId/edit" element={<SightseeingFormPage />} />
      </Routes>,
      { route: `/masters/sightseeing/${sightseeingId}/edit` },
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue('Gobustan Rock Art Tour')).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update sightseeing/i })).toBeInTheDocument();
  });

  it('renders the sightseeing detail page', async () => {
    stubApi();
    renderWithProviders(
      <Routes>
        <Route path="/masters/sightseeing/:sightseeingId" element={<SightseeingDetailsPage />} />
      </Routes>,
      { route: `/masters/sightseeing/${sightseeingId}` },
    );

    expect(
      await screen.findByRole('heading', { name: 'Gobustan Rock Art Tour' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(screen.getByText('Suggested Start Time')).toBeInTheDocument();
    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('Remarks')).toBeInTheDocument();
    expect(screen.getByText(/Begin your exploration/)).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Add-On Services
  // -------------------------------------------------------------------------

  it('renders the add-on services list with price and status', async () => {
    stubApi();
    renderWithProviders(<AddOnServicesPage />, { route: '/masters/add-on-services' });

    expect((await screen.findAllByText('Singapore Visa')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3,800/).length).toBeGreaterThan(0);
    // "ACTIVE" also appears as a status-filter option, so scope to the badge.
    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThan(0);
    // Description rendered as plain text.
    expect(screen.getByText(/Docs Required: Passport/)).toBeInTheDocument();
  });

  it('shows the add-on services loading, empty and error states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const loading = renderWithProviders(<AddOnServicesPage />, {
      route: '/masters/add-on-services',
    });
    expect(loading.container.querySelector('.animate-pulse')).toBeTruthy();
    loading.unmount();

    stubApi({ services: page([]) });
    const empty = renderWithProviders(<AddOnServicesPage />, {
      route: '/masters/add-on-services',
    });
    expect(await screen.findByText('No add-on services found')).toBeInTheDocument();
    empty.unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
      })) as unknown as typeof fetch,
    );
    renderWithProviders(<AddOnServicesPage />, { route: '/masters/add-on-services' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add-on services could not be loaded.',
    );
  });

  it('hides add-on service create, edit and delete actions without permission', async () => {
    auth.permissions = new Set(['masters.add_on_services.view']);
    stubApi();
    renderWithProviders(<AddOnServicesPage />, { route: '/masters/add-on-services' });

    await screen.findAllByText('Singapore Visa');
    expect(screen.queryByRole('link', { name: /add new service/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /edit singapore visa/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete singapore visa/i }),
    ).not.toBeInTheDocument();
  });

  it('validates the add-on service name and rejects a negative price', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWithProviders(<AddOnServiceFormPage />, { route: '/masters/add-on-services/new' });

    const price = screen.getByLabelText('Pricing option 1 price');
    await user.clear(price);
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    // Price is optional, so only the required name is validated.
    expect(await screen.findByText('Service name is required.')).toBeInTheDocument();
    expect(screen.queryByText('Price is required.')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/service name/i), 'Test Service');
    await user.type(price, '-5');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByText('Price cannot be negative.')).toBeInTheDocument();
  });

  it('loads an existing add-on service into the edit form', async () => {
    stubApi();
    renderWithProviders(
      <Routes>
        <Route
          path="/masters/add-on-services/:addOnServiceId/edit"
          element={<AddOnServiceFormPage />}
        />
      </Routes>,
      { route: `/masters/add-on-services/${serviceId}/edit` },
    );

    await waitFor(() => expect(screen.getByDisplayValue('Singapore Visa')).toBeInTheDocument());
    expect(screen.getByDisplayValue('3800')).toBeInTheDocument();
    expect(screen.getByLabelText(/status/i)).toHaveValue('ACTIVE');
    expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
  });

  it('renders the add-on service detail page', async () => {
    stubApi();
    renderWithProviders(
      <Routes>
        <Route
          path="/masters/add-on-services/:addOnServiceId"
          element={<AddOnServiceDetailsPage />}
        />
      </Routes>,
      { route: `/masters/add-on-services/${serviceId}` },
    );

    expect(await screen.findByRole('heading', { name: 'Singapore Visa' })).toBeInTheDocument();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getAllByText(/3,800/).length).toBeGreaterThan(0);
    expect(screen.getByText('Created By')).toBeInTheDocument();
    expect(screen.getByText('Aditi Rao')).toBeInTheDocument();
    // No images on the fixture → no gallery section, same as before.
    expect(screen.queryByText('Images')).not.toBeInTheDocument();
  });

  it('shows the Service Images gallery on create when media is permitted', async () => {
    auth.permissions = new Set([...ALL, 'masters.add_on_services.manage_media']);
    stubApi();
    renderWithProviders(<AddOnServiceFormPage />, { route: '/masters/add-on-services/new' });

    expect(await screen.findByText('Service Images')).toBeInTheDocument();
    expect(screen.getByLabelText('Add service images')).toBeInTheDocument();
    expect(
      screen.getByText(/The first image is the primary image. Maximum 5 MB per image./),
    ).toBeInTheDocument();
  });

  it('hides the Service Images gallery without the media permission', async () => {
    auth.permissions = new Set(
      ALL.filter((permission) => permission !== 'masters.add_on_services.manage_media'),
    );
    stubApi();
    renderWithProviders(<AddOnServiceFormPage />, { route: '/masters/add-on-services/new' });

    await screen.findByRole('heading', { name: 'Create Add-On Service' });
    expect(screen.queryByText('Service Images')).not.toBeInTheDocument();
  });

  it('loads existing images into the edit form and the details view', async () => {
    auth.permissions = new Set([...ALL, 'masters.add_on_services.manage_media']);
    const withImages = {
      ...service,
      hasImage: true,
      images: [
        {
          id: 'img-1',
          fileName: 'visa.png',
          mimeType: 'image/png',
          fileSize: 1234,
          isPrimary: true,
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes(`/masters/add-on-services/${serviceId}`)) return response(withImages);
        if (url.includes('/masters/add-on-services')) return response(page([withImages]));
        return response(page([]));
      }),
    );
    renderWithProviders(
      <Routes>
        <Route
          path="/masters/add-on-services/:addOnServiceId/edit"
          element={<AddOnServiceFormPage />}
        />
      </Routes>,
      { route: `/masters/add-on-services/${serviceId}/edit` },
    );

    // Existing gallery tile renders with primary badge and file name.
    expect(await screen.findByText('visa.png')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('shows saved images in the details view', async () => {
    const withImages = {
      ...service,
      hasImage: true,
      images: [
        {
          id: 'img-1',
          fileName: 'visa.png',
          mimeType: 'image/png',
          fileSize: 1234,
          isPrimary: true,
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes(`/masters/add-on-services/${serviceId}`)) return response(withImages);
        if (url.includes('/masters/add-on-services')) return response(page([withImages]));
        return response(page([]));
      }),
    );
    renderWithProviders(
      <Routes>
        <Route
          path="/masters/add-on-services/:addOnServiceId"
          element={<AddOnServiceDetailsPage />}
        />
      </Routes>,
      { route: `/masters/add-on-services/${serviceId}` },
    );
    expect(await screen.findByText('Images')).toBeInTheDocument();
  });
});

describe('Add-on service destination associations', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  const sg = { id: 'dest-sg-0000-4000-8000-000000000001', name: 'Singapore' };
  const my = { id: 'dest-my-0000-4000-8000-000000000002', name: 'Malaysia' };
  const pagination = (total: number) => ({ page: 1, pageSize: 20, total, totalPages: 1 });

  function stubForm(record: unknown, counts: Record<string, number> = {}) {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/masters/destinations')) return response({ data: [sg, my], pagination: pagination(2) });
      if (url.includes('isDefault=true')) {
        const destinationId = new URL(url, 'http://localhost').searchParams.get('destinationId') ?? '';
        return response({ data: [], pagination: pagination(counts[destinationId] ?? 0) });
      }
      if (init?.method === 'POST' && url.endsWith('/masters/add-on-services'))
        return response({ ...(record as object), id: 'new-service-id' });
      if (init?.method === 'PATCH' && url.includes('/masters/add-on-services/'))
        return response({ ...(record as object), ...JSON.parse(String(init?.body)) });
      if (url.includes(`/masters/add-on-services/${serviceId}`)) return response(record);
      if (url.includes('/masters/add-on-services')) return response(page([service]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const renderNewForm = () =>
    renderWithProviders(<AddOnServiceFormPage />, { route: '/masters/add-on-services/new' });

  const renderEditForm = () =>
    renderWithProviders(
      <Routes>
        <Route
          path="/masters/add-on-services/:addOnServiceId/edit"
          element={<AddOnServiceFormPage />}
        />
        <Route path="/masters/add-on-services/:addOnServiceId" element={<div>Saved</div>} />
      </Routes>,
      { route: `/masters/add-on-services/${serviceId}/edit` },
    );

  it('A/B/C: creates with two destinations and an independent default flag', async () => {
    const fetchMock = stubForm(service);
    renderNewForm();
    await userEvent.type(screen.getByPlaceholderText('Enter service name'), 'Visa Service');
    await userEvent.selectOptions(screen.getByLabelText('Select destination'), 'dest-sg-0000-4000-8000-000000000001');
    await userEvent.selectOptions(screen.getByLabelText('Select destination'), 'dest-my-0000-4000-8000-000000000002');
    await userEvent.click(screen.getByLabelText('Default add-on for Singapore'));
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith('/masters/add-on-services') && init?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]!.body)).destinations).toEqual([
        { destinationId: 'dest-sg-0000-4000-8000-000000000001', isDefault: true },
        { destinationId: 'dest-my-0000-4000-8000-000000000002', isDefault: false },
      ]);
    });
  });

  it('D/E/F: edit loads mappings with per-destination flags', async () => {
    const stored = {
      ...service,
      destinations: [
        { id: sg.id, name: 'Singapore', isDefault: true },
        { id: my.id, name: 'Malaysia', isDefault: false },
      ],
    };
    stubForm(stored);
    renderEditForm();
    await waitFor(() => expect(screen.getByLabelText('Default add-on for Singapore')).toBeChecked());
    expect(screen.getByLabelText('Default add-on for Malaysia')).not.toBeChecked();
  });

  it('G/H: blocks the 21st default with a clear message and keeps it unchecked', async () => {
    stubForm(service, { [sg.id]: 20 });
    renderNewForm();
    await userEvent.type(screen.getByPlaceholderText('Enter service name'), 'Visa Service');
    await userEvent.selectOptions(screen.getByLabelText('Select destination'), sg.id);
    await userEvent.click(screen.getByLabelText('Default add-on for Singapore'));
    await screen.findByText(/maximum of 20 default add-on services/);
    expect(screen.getByLabelText('Default add-on for Singapore')).not.toBeChecked();
  });

  it('allows the 20th default when one slot remains', async () => {
    const fetchMock = stubForm(service, { [sg.id]: 19 });
    renderNewForm();
    await userEvent.type(screen.getByPlaceholderText('Enter service name'), 'Visa Service');
    await userEvent.selectOptions(screen.getByLabelText('Select destination'), sg.id);
    await userEvent.click(screen.getByLabelText('Default add-on for Singapore'));
    await waitFor(() =>
      expect(screen.getByLabelText('Default add-on for Singapore')).toBeChecked(),
    );
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith('/masters/add-on-services') && init?.method === 'POST',
      );
      expect(JSON.parse(String(post![1]!.body)).destinations).toEqual([
        { destinationId: sg.id, isDefault: true },
      ]);
    });
  });

  it('J: services without destinations stay valid and save an empty list', async () => {
    const fetchMock = stubForm(service);
    renderNewForm();
    await userEvent.type(screen.getByPlaceholderText('Enter service name'), 'Visa Service');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith('/masters/add-on-services') && init?.method === 'POST',
      );
      expect(JSON.parse(String(post![1]!.body)).destinations).toEqual([]);
    });
  });

  it('T: the form uses the full content width like the other master forms', async () => {
    stubForm(service);
    renderNewForm();
    await screen.findByRole('heading', { name: 'Create Add-On Service' });
    expect(document.querySelector('form.max-w-3xl')).toBeNull();
    expect(screen.getByText('Service Information')).toBeInTheDocument();
    expect(screen.getByText('Destinations')).toBeInTheDocument();
  });
});

describe('Add-on service repeatable pricing', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  const sg = { id: 'dest-sg-0000-4000-8000-000000000001', name: 'Singapore' };
  const pagination = (total: number) => ({ page: 1, pageSize: 20, total, totalPages: 1 });

  function stubPricing(record: unknown) {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/masters/destinations')) return response({ data: [sg], pagination: pagination(1) });
      if (url.includes('isDefault=true')) return response({ data: [], pagination: pagination(0) });
      if (init?.method === 'POST' && url.endsWith('/masters/add-on-services'))
        return response({ ...(record as object), id: 'new-service-id' });
      if (init?.method === 'PATCH' && url.includes('/masters/add-on-services/'))
        return response({ ...(record as object), ...JSON.parse(String(init?.body)) });
      if (url.includes(`/masters/add-on-services/${serviceId}`)) return response(record);
      if (url.includes('/masters/add-on-services')) return response(page([service]));
      return response(page([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const priced = {
    ...service,
    pricing: [
      { id: 'opt-adult-1', label: 'Adult', price: 6000, currency: 'INR' },
      { id: 'opt-child-2', label: 'Child', price: 4000, currency: 'INR' },
      { id: 'opt-senior-3', label: 'Senior', price: 5000, currency: 'USD' },
    ],
    destinations: [],
  };

  const renderNewForm = () =>
    renderWithProviders(<AddOnServiceFormPage />, { route: '/masters/add-on-services/new' });

  const renderEditForm = () =>
    renderWithProviders(
      <Routes>
        <Route
          path="/masters/add-on-services/:addOnServiceId/edit"
          element={<AddOnServiceFormPage />}
        />
        <Route path="/masters/add-on-services/:addOnServiceId" element={<div>Saved</div>} />
      </Routes>,
      { route: `/masters/add-on-services/${serviceId}/edit` },
    );

  const savedBody = async (fetchMock: ReturnType<typeof stubPricing>, method: 'POST' | 'PATCH') => {
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/masters/add-on-services') && init?.method === method,
        ),
      ).toBe(true);
    });
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/masters/add-on-services') && init?.method === method,
    )!;
    return JSON.parse(String(call[1]!.body)) as {
      pricing: Array<{ id: string; label: string; price: number | null; currency: string }>;
      price: number | null;
      currency: string;
      pricingBasis: string | null;
    };
  };

  it('creates with a single pricing entry and mirrors the legacy fields', async () => {
    const fetchMock = stubPricing(service);
    renderNewForm();
    await userEvent.type(screen.getByPlaceholderText('Enter service name'), 'Visa Service');
    await userEvent.type(screen.getByLabelText('Pricing option 1 label'), 'Adult');
    await userEvent.type(screen.getByLabelText('Pricing option 1 price'), '6000');
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    const body = await savedBody(fetchMock, 'POST');
    expect(body.pricing).toHaveLength(1);
    expect(body.pricing[0]).toMatchObject({ label: 'Adult', price: 6000, currency: 'INR' });
    expect(typeof body.pricing[0]!.id).toBe('string');
    expect(body.price).toBe(6000);
    expect(body.currency).toBe('INR');
    expect(body.pricingBasis).toBe('Adult');
  });

  it('creates with 10 entries and allows an 11th', async () => {
    const fetchMock = stubPricing(service);
    renderNewForm();
    await userEvent.type(screen.getByPlaceholderText('Enter service name'), 'Visa Service');
    for (let n = 2; n <= 11; n += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Add Pricing' }));
    }
    for (let n = 1; n <= 11; n += 1) {
      await userEvent.type(screen.getByLabelText(`Pricing option ${n} label`), `P${n}`);
      await userEvent.type(screen.getByLabelText(`Pricing option ${n} price`), `${n}000`);
    }
    await userEvent.click(screen.getByRole('button', { name: /^create$/i }));
    const body = await savedBody(fetchMock, 'POST');
    expect(body.pricing).toHaveLength(11);
    expect(body.pricing.map((entry) => entry.label)).toEqual(
      Array.from({ length: 11 }, (_, i) => `P${i + 1}`),
    );
    expect(body.pricing.map((entry) => entry.price)).toEqual(
      Array.from({ length: 11 }, (_, i) => (i + 1) * 1000),
    );
  });

  it('loads saved entries in order and edits one without disturbing the rest', async () => {
    const fetchMock = stubPricing(priced);
    renderEditForm();
    await waitFor(() =>
      expect(screen.getByLabelText('Pricing option 1 label')).toHaveValue('Adult'),
    );
    expect(screen.getByLabelText('Pricing option 2 label')).toHaveValue('Child');
    expect(screen.getByLabelText('Pricing option 3 price')).toHaveValue(5000);
    await userEvent.clear(screen.getByLabelText('Pricing option 2 label'));
    await userEvent.type(screen.getByLabelText('Pricing option 2 label'), 'Kid');
    await userEvent.clear(screen.getByLabelText('Pricing option 2 price'));
    await userEvent.type(screen.getByLabelText('Pricing option 2 price'), '4500');
    await userEvent.click(screen.getByRole('button', { name: /^update$/i }));
    const body = await savedBody(fetchMock, 'PATCH');
    expect(body.pricing).toEqual([
      { id: 'opt-adult-1', label: 'Adult', price: 6000, currency: 'INR' },
      { id: 'opt-child-2', label: 'Kid', price: 4500, currency: 'INR' },
      { id: 'opt-senior-3', label: 'Senior', price: 5000, currency: 'USD' },
    ]);
  });

  it('removes a single row and keeps the remaining order', async () => {
    const fetchMock = stubPricing(priced);
    renderEditForm();
    await waitFor(() =>
      expect(screen.getByLabelText('Pricing option 3 label')).toHaveValue('Senior'),
    );
    await userEvent.click(screen.getByLabelText('Remove pricing option 1'));
    await userEvent.click(screen.getByRole('button', { name: /^update$/i }));
    const body = await savedBody(fetchMock, 'PATCH');
    expect(body.pricing.map((entry) => entry.id)).toEqual(['opt-child-2', 'opt-senior-3']);
  });

  it('reorders rows with the move buttons', async () => {
    const fetchMock = stubPricing(priced);
    renderEditForm();
    await waitFor(() =>
      expect(screen.getByLabelText('Pricing option 1 label')).toHaveValue('Adult'),
    );
    await userEvent.click(screen.getByLabelText('Move pricing option 1 down'));
    // The moved row is now second; its stable id travels with it.
    expect(screen.getByLabelText('Pricing option 2 label')).toHaveValue('Adult');
    await userEvent.click(screen.getByRole('button', { name: /^update$/i }));
    const body = await savedBody(fetchMock, 'PATCH');
    expect(body.pricing.map((entry) => entry.id)).toEqual([
      'opt-child-2',
      'opt-adult-1',
      'opt-senior-3',
    ]);
  });

  it('loads a legacy single price as exactly one row', async () => {
    stubPricing(service);
    renderEditForm();
    await waitFor(() =>
      expect(screen.getByLabelText('Pricing option 1 price')).toHaveValue(3800),
    );
    expect(screen.getByLabelText('Pricing option 1 label')).toHaveValue('');
    expect(screen.queryByLabelText('Pricing option 2 label')).not.toBeInTheDocument();
  });

  it('rejects a negative price inside a pricing row', async () => {
    const user = userEvent.setup();
    stubPricing(service);
    renderNewForm();
    await user.type(screen.getByPlaceholderText('Enter service name'), 'Visa Service');
    await user.type(screen.getByLabelText('Pricing option 1 price'), '-5');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(await screen.findByText('Price cannot be negative.')).toBeInTheDocument();
  });
});

describe('Sightseeing master status filter and delete', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  it('renders the status dropdown with exactly Current statuses, ACTIVE and INACTIVE', async () => {
    stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    const select = screen.getByLabelText('Sightseeing status');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Current statuses', 'ACTIVE', 'INACTIVE']);
  });

  it('changing status sends the status query parameter', async () => {
    const mock = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.includes('/masters/sightseeing/summary')) return response(summary);
      if (url.includes('/masters/destinations')) return response(page([destination]));
      if (url.includes('/masters/cities'))
        return response(page([{ id: cityId, name: 'Baku', status: 'ACTIVE' }]));
      return response(page([sightseeing]));
    });
    vi.stubGlobal('fetch', mock);
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    await userEvent.selectOptions(screen.getByLabelText('Sightseeing status'), 'INACTIVE');
    await waitFor(() =>
      expect(mock.mock.calls.some(([url]) => String(url).includes('status=INACTIVE'))).toBe(true),
    );
  });

  it('shows a Delete action with a permanent-delete confirmation for rows', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/masters/sightseeing/summary')) return response(summary);
      if (url.includes('/masters/destinations')) return response(page([destination]));
      if (url.includes('/masters/cities'))
        return response(page([{ id: cityId, name: 'Baku', status: 'ACTIVE' }]));
      if (init?.method === 'DELETE') return response({ deleted: true });
      return response(page([sightseeing]));
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    await userEvent.click(await screen.findByRole('button', { name: /Azerbaijan/ }));
    const table = document.querySelector('table') as HTMLTableElement;
    const deleteButton = within(table).getByRole('button', {
      name: `Delete ${sightseeing.title}`,
    });
    expect(deleteButton).toHaveAttribute('title', 'Permanently delete');
    await userEvent.click(deleteButton);
    expect(confirmSpy).toHaveBeenCalledWith(
      `Permanently delete sightseeing ${sightseeing.title}? This action cannot be undone.`,
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes(`/masters/sightseeing/${sightseeingId}`) &&
            init?.method === 'DELETE',
        ),
      ).toBe(true),
    );
    confirmSpy.mockRestore();
  });

  it('does not render the status filter or Delete for an unauthorized user', async () => {
    auth.permissions = new Set(['masters.sightseeing.view']);
    stubApi();
    renderWithProviders(<SightseeingPage />, { route: '/masters/sightseeing' });
    await userEvent.click(await screen.findByRole('button', { name: /Azerbaijan/ }));
    expect(screen.queryByLabelText('Sightseeing status')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `Delete ${sightseeing.title}` }),
    ).not.toBeInTheDocument();
  });
});

// Referenced so the unused-city constant does not drift out of the fixture set.
void otherCityId;

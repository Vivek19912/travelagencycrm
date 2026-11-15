import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { CitiesPage } from './CitiesPage';
import { CityFormPage } from './CityFormPage';
import { DestinationsPage } from './DestinationsPage';
import { DestinationDetailsPage } from './DestinationDetailsPage';
import { DestinationFormPage } from './DestinationFormPage';
import { NAV_ITEMS } from '@/components/layout/navigation';
import {
  type MasterImageQueryScope,
  useRefreshMasterImageQueries,
} from '@/features/masters/masters.api';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;
const cityId = '11111111-1111-4111-8111-111111111111';
const destinationId = '22222222-2222-4222-8222-222222222222';
const city = {
  id: cityId,
  countryCode: 'IN',
  countryName: 'India',
  name: 'Jaipur',
  airportCode: 'JAI',
  status: 'ACTIVE',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: { id: 'user-1', fullName: 'Aditi Rao' },
  _count: { destinationLinks: 1 },
};
const destination = {
  id: destinationId,
  countryCode: 'IN',
  countryName: 'India',
  name: 'Rajasthan Highlights',
  privateName: null,
  destinationType: 'DOMESTIC',
  status: 'ACTIVE',
  inclusions: '<p>Breakfast and <strong>transfers</strong></p>',
  exclusions: '<p>Flights</p>',
  paymentPolicies: null,
  cancellationPolicies: null,
  bookingTerms: '<p>Passport required</p>',
  imageStorageProvider: null,
  imageFileName: null,
  imageMimeType: null,
  imageFileSize: null,
  imageConfirmedAt: null,
  hasImage: false,
  cities: [{ id: 'link-1', cityId, sequence: 0, city }],
  _count: { cities: 1 },
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: { id: 'user-1', fullName: 'Aditi Rao' },
};
const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});
const lookups = {
  countries: [
    { code: 'IN', name: 'India' },
    { code: 'AE', name: 'United Arab Emirates' },
  ],
  cities: [{ id: cityId, name: 'Jaipur', airportCode: 'JAI', countryCode: 'IN' }],
};

function ImageMutationControl({
  scope,
  onMutation,
  destination,
}: {
  scope: MasterImageQueryScope;
  onMutation: () => void;
  destination: string;
}) {
  const refresh = useRefreshMasterImageQueries(scope);
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={async () => {
        onMutation();
        await refresh();
        navigate(destination);
      }}
    >
      Complete image mutation
    </button>
  );
}

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>
        History back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        History forward
      </button>
    </>
  );
}

describe('Phase 13A master pages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set([
      'masters.cities.view',
      'masters.cities.create',
      'masters.cities.update',
      'masters.cities.delete',
      'masters.destinations.view',
      'masters.destinations.create',
      'masters.destinations.update',
      'masters.destinations.delete',
      'masters.destinations.manage_images',
    ]);
  });

  it('activates every built master beneath the Masters sidebar item', () => {
    const masters = NAV_ITEMS.find((item) => item.label === 'Masters');
    expect(masters).toMatchObject({ available: true, permission: 'masters.view' });
    expect(masters?.children?.map((item) => [item.label, item.available])).toEqual([
      ['Cities', true],
      ['Destinations', true],
      ['Hotels', true],
      ['Airlines', true],
      ['Cruises', true],
      ['Vehicles', true],
      ['Sightseeing', true],
      ['Add-On Services', true],
    ]);
  });

  it('shows city loading, empty, and error states', async () => {
    const never = new Promise<Response>(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => never),
    );
    const loading = renderWithProviders(<CitiesPage />);
    expect(loading.container.querySelector('.animate-pulse')).toBeInTheDocument();
    loading.unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).includes('/lookups') ? response(lookups) : response(page([])),
      ),
    );
    const empty = renderWithProviders(<CitiesPage />);
    expect(await screen.findByText('No cities found')).toBeInTheDocument();
    empty.unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).includes('/lookups')
          ? response(lookups)
          : ({
              ok: false,
              status: 500,
              json: async () => ({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'failed' },
              }),
            } as Response),
      ),
    );
    renderWithProviders(<CitiesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cities could not be loaded');
  });

  it('renders city actions and sends URL-backed search and country filters', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) =>
      String(request).includes('/lookups') ? response(lookups) : response(page([city])),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<CitiesPage />);
    expect((await screen.findAllByText('Jaipur')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Add New City' })).toBeInTheDocument();
    expect(screen.getByLabelText('Delete Jaipur')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search cities'), 'jai');
    await userEvent.selectOptions(screen.getByLabelText('City country'), 'IN');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url).includes('search=jai') && String(url).includes('country=IN'),
        ),
      ).toBe(true),
    );
  });

  it('validates and normalizes the create City form before posting', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/lookups')) return response(lookups);
      if (init?.method === 'POST') return response(city);
      return response(city);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <Routes>
        <Route path="/masters/cities/new" element={<CityFormPage />} />
        <Route path="/masters/cities/:cityId" element={<div>Saved city</div>} />
      </Routes>,
      { route: '/masters/cities/new' },
    );
    await screen.findByRole('heading', { name: 'Create City' });
    await screen.findByRole('option', { name: 'India' });
    expect(screen.getByRole('combobox', { name: /country/i })).toHaveValue('IN');
    expect(screen.queryByPlaceholderText('e.g. DEL')).not.toBeInTheDocument();
    expect(screen.queryByText(/airport code/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create City' }));
    expect(await screen.findByText('Enter a city name.')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Enter city name'), 'Jaipur');
    await userEvent.click(screen.getByRole('button', { name: 'Create City' }));
    await screen.findByText('Saved city');
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/masters/cities') && init?.method === 'POST',
    );
    const createBody = JSON.parse(String(createCall?.[1]?.body));
    expect(createBody).toMatchObject({
      countryCode: 'IN',
      name: 'Jaipur',
    });
    expect(createBody).not.toHaveProperty('airportCode');
  });

  it('hides create, edit, delete, and status controls from a read-only role', async () => {
    auth.permissions = new Set(['masters.cities.view']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).includes('/lookups') ? response(lookups) : response(page([city])),
      ),
    );
    renderWithProviders(<CitiesPage />);
    await screen.findAllByText('Jaipur');
    expect(screen.queryByRole('link', { name: 'Add New City' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit Jaipur')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete Jaipur')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('City status')).not.toBeInTheDocument();
  });

  it('shows a Global badge and Hide action for a global City, without Edit or Delete', async () => {
    auth.permissions = new Set([
      'masters.cities.view',
      'masters.cities.create',
      'masters.cities.update',
      'masters.cities.delete',
    ]);
    const globalCity = {
      ...city,
      name: 'Dubai',
      airportCode: 'DXB',
      isGlobal: true,
      isOwnedByCurrentTenant: false,
      canEdit: false,
      canHide: true,
      canRestore: false,
      source: 'GLOBAL',
    };
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).includes('/lookups') ? response(lookups) : response(page([globalCity])),
      ),
    );
    renderWithProviders(<CitiesPage />);
    await screen.findAllByText('Dubai');

    // A Global badge marks the shared record (desktop + mobile render one each).
    expect(screen.getAllByText('Global').length).toBeGreaterThan(0);
    // No Edit or Delete for a global record.
    expect(screen.queryByLabelText('Edit Dubai')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete Dubai')).not.toBeInTheDocument();
    // A Hide action is offered instead.
    const hide = screen.getByLabelText('Hide Dubai for this company');
    await userEvent.click(hide);
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('hidden only for your company'),
    );
    confirmSpy.mockRestore();
  });

  it('renders destination badges and applies type filters', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) =>
      String(request).includes('/lookups') ? response(lookups) : response(page([destination])),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<DestinationsPage />);
    expect((await screen.findAllByText('Rajasthan Highlights')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('DOMESTIC').length).toBeGreaterThan(0);
    await userEvent.selectOptions(screen.getByLabelText('Destination type'), 'INTERNATIONAL');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('destinationType=INTERNATIONAL')),
      ).toBe(true),
    );
  });

  it('defaults Destination Master to 30 rows per page while other masters keep 10', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL) =>
      String(request).includes('/lookups') ? response(lookups) : response(page([destination])),
    );
    vi.stubGlobal('fetch', fetchMock);

    const destinations = renderWithProviders(<DestinationsPage />);
    await screen.findAllByText('Rajasthan Highlights');
    const destinationUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/masters/destinations'));
    expect(destinationUrls.some((url) => url.includes('pageSize=30'))).toBe(true);
    expect(destinationUrls.some((url) => /[?&]pageSize=10\b/.test(url))).toBe(false);
    destinations.unmount();

    fetchMock.mockClear();
    const citiesFetch = vi.fn(async (request: RequestInfo | URL) =>
      String(request).includes('/lookups') ? response(lookups) : response(page([city])),
    );
    vi.stubGlobal('fetch', citiesFetch);
    const cities = renderWithProviders(<CitiesPage />);
    await screen.findAllByText('Jaipur');
    const cityUrls = citiesFetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/masters/cities'));
    expect(cityUrls.some((url) => url.includes('pageSize=10'))).toBe(true);
    cities.unmount();
  });

  it('renders ordered cities and switches sanitized policy tabs in destination details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(destination)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/masters/destinations/:destinationId" element={<DestinationDetailsPage />} />
      </Routes>,
      { route: `/masters/destinations/${destinationId}` },
    );
    expect((await screen.findAllByText('Rajasthan Highlights')).length).toBeGreaterThan(0);
    expect(screen.getByText('transfers')).toBeInTheDocument();
    expect(screen.getByText('JAI')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Exclusions' }));
    expect(screen.getByText('Flights')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Terms & Conditions' }));
    expect(screen.getByText('Passport required')).toBeInTheDocument();
  });

  it('hydrates destination images immediately when navigating from View to Edit', async () => {
    const images = ['a', 'b', 'c'].map((id, index) => ({
      id,
      fileName: `${id}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: 100,
      isPrimary: index === 0,
    }));
    const record = { ...destination, hasImage: true, images };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/image/download-url')) {
          const imageId = new URL(url, 'http://localhost').searchParams.get('imageId');
          return response({ url: `https://images.example/${imageId}`, expiresInSeconds: 300 });
        }
        if (url.includes('/lookups')) return response(lookups);
        if (url.includes(`/masters/destinations/${destinationId}`)) return response(record);
        return response(page([record]));
      }),
    );
    renderWithProviders(
      <Routes>
        <Route path="/masters/destinations/:destinationId" element={<DestinationDetailsPage />} />
        <Route path="/masters/destinations/:destinationId/edit" element={<DestinationFormPage />} />
      </Routes>,
      { route: `/masters/destinations/${destinationId}` },
    );
    await screen.findByRole('img', { name: 'Rajasthan Highlights 1' });

    await userEvent.click(screen.getByRole('link', { name: /Edit/ }));

    expect(screen.getByRole('heading', { name: 'Edit Destination' })).toBeInTheDocument();
    expect(screen.getByText('a.jpg')).toBeInTheDocument();
    expect(screen.getByText('b.jpg')).toBeInTheDocument();
    expect(screen.getByText('c.jpg')).toBeInTheDocument();
  });

  it('shows a same-filename primary replacement after View, Back, and browser history navigation', async () => {
    const image = (id: string) => ({
      id,
      fileName: 'image.png',
      mimeType: 'image/png',
      fileSize: 100,
      isPrimary: true,
    });
    let current = {
      ...destination,
      hasImage: true,
      images: [image('image-a')],
      imageConfirmedAt: '2026-08-21T10:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/image/download-url')) {
          const requestedId = new URL(url, 'http://localhost').searchParams.get('imageId');
          const id = requestedId ?? current.images[0]!.id;
          return response({ url: `https://images.example/${id}`, expiresInSeconds: 300 });
        }
        if (url.includes('/lookups')) return response(lookups);
        if (url.includes(`/masters/destinations/${destinationId}`)) return response(current);
        return response(page([current]));
      }),
    );

    const rendered = renderWithProviders(
      <>
        <ImageMutationControl
          scope="destinations"
          destination={`/masters/destinations/${destinationId}`}
          onMutation={() => {
            current = {
              ...current,
              images: [image('image-b')],
              imageConfirmedAt: '2026-08-21T10:01:00.000Z',
            };
          }}
        />
        <HistoryControls />
        <Routes>
          <Route path="/masters/destinations" element={<DestinationsPage />} />
          <Route path="/masters/destinations/:destinationId" element={<DestinationDetailsPage />} />
        </Routes>
      </>,
      { route: '/masters/destinations' },
    );

    await waitFor(() =>
      expect(
        rendered.container.querySelector('img[src="https://images.example/image-a"]'),
      ).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('link', { name: 'View Rajasthan Highlights' }));
    expect(await screen.findByRole('img', { name: 'Rajasthan Highlights' })).toHaveAttribute(
      'src',
      'https://images.example/image-a',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Complete image mutation' }));
    expect(await screen.findByRole('img', { name: 'Rajasthan Highlights' })).toHaveAttribute(
      'src',
      'https://images.example/image-b',
    );
    await userEvent.click(screen.getByRole('link', { name: /Back/ }));
    await waitFor(() =>
      expect(
        rendered.container.querySelector('img[src="https://images.example/image-b"]'),
      ).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'History back' }));
    expect(await screen.findByRole('img', { name: 'Rajasthan Highlights' })).toHaveAttribute(
      'src',
      'https://images.example/image-b',
    );
    await userEvent.click(screen.getByRole('button', { name: 'History forward' }));
    await waitFor(() =>
      expect(
        rendered.container.querySelector('img[src="https://images.example/image-b"]'),
      ).toBeInTheDocument(),
    );
  });

  it('selects, removes, reorders content, toggles international, and completes image upload', async () => {
    const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.includes('/lookups')) return response(lookups);
      if (url.endsWith('/image/upload'))
        return response({ uploadUrl: 'https://uploads.example/image', expiresInSeconds: 300 });
      if (url === 'https://uploads.example/image')
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      if (url.endsWith('/image/confirm')) return response({ ...destination, hasImage: true });
      if (url.endsWith('/api/masters/destinations') && init?.method === 'POST')
        return response(destination);
      return response(destination);
    });
    vi.stubGlobal('fetch', fetchMock);
    const rendered = renderWithProviders(
      <Routes>
        <Route path="/masters/destinations/new" element={<DestinationFormPage />} />
        <Route path="/masters/destinations/:destinationId" element={<div>Saved destination</div>} />
      </Routes>,
      { route: '/masters/destinations/new' },
    );
    await screen.findByRole('heading', { name: 'Create Destination' });
    expect(screen.getByText('Select a country to view cities.')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'India' });
    await userEvent.selectOptions(screen.getByText('Country *').querySelector('select')!, 'IN');
    await userEvent.type(
      screen.getByPlaceholderText('e.g. Rajasthan Highlights'),
      'Rajasthan Highlights',
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Jaipur JAI' }));
    expect(screen.getByLabelText('Remove Jaipur')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jaipur JAI' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Remove Jaipur'));
    expect(screen.queryByLabelText('Remove Jaipur')).not.toBeInTheDocument();
    expect(screen.getByText('Country *').querySelector('select')).toHaveValue('IN');
    await userEvent.click(await screen.findByRole('button', { name: 'Jaipur JAI' }));
    await userEvent.click(screen.getByLabelText('International'));
    const inclusions = screen.getByRole('textbox', { name: 'Inclusions' });
    inclusions.innerHTML = 'Breakfast';
    fireEvent.input(inclusions);
    const upload = rendered.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(upload, new File(['image'], 'palace.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create Destination' }));
    await screen.findByText('Saved destination');
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/masters/destinations') && init?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      destinationType: 'INTERNATIONAL',
      cityIds: [cityId],
      inclusions: 'Breakfast',
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/image/upload'))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/image/confirm'))).toBe(true);
  });

  describe('destination Private Name (internal-only field)', () => {
    it('shows the Private Name column with values and placeholders in the table', async () => {
      const withPrivate = { ...destination, privateName: 'VN Supplier Package 2026' };
      const withoutPrivate = {
        ...destination,
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Goa Beaches',
        privateName: null,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (request: RequestInfo | URL) =>
          String(request).includes('/lookups')
            ? response(lookups)
            : response(page([withPrivate, withoutPrivate])),
        ),
      );
      renderWithProviders(<DestinationsPage />);
      expect(await screen.findByText('Private Name')).toBeInTheDocument();
      // Desktop table cell + mobile card both render the value.
      expect(screen.getAllByText('VN Supplier Package 2026')).toHaveLength(2);
      expect(screen.getAllByText('Goa Beaches').length).toBeGreaterThan(0);
      // Null renders a clean placeholder, never "null"/"undefined".
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
      expect(screen.queryByText(/null|undefined/i)).not.toBeInTheDocument();
    });

    it('sends the trimmed Private Name when creating a destination', async () => {
      auth.permissions.delete('masters.destinations.manage_images');
      const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        if (url.includes('/lookups')) return response(lookups);
        if (url.endsWith('/api/masters/destinations') && init?.method === 'POST')
          return response({ ...destination, id: 'new-dest-id' });
        return response(destination);
      });
      vi.stubGlobal('fetch', fetchMock);
      renderWithProviders(
        <Routes>
          <Route path="/masters/destinations/new" element={<DestinationFormPage />} />
          <Route path="/masters/destinations/:destinationId" element={<div>Saved destination</div>} />
        </Routes>,
        { route: '/masters/destinations/new' },
      );
      await screen.findByRole('heading', { name: 'Create Destination' });
      // Field sits right after Destination Name with internal-only helper text.
      expect(screen.getByLabelText(/Private Name/)).toBeInTheDocument();
      await screen.findByRole('option', { name: 'India' });
      expect(
        screen.getByText('Internal name only. This will not appear in quotations or public weblinks.'),
      ).toBeInTheDocument();
      await userEvent.selectOptions(screen.getByText('Country *').querySelector('select')!, 'IN');
      await userEvent.type(
        screen.getByPlaceholderText('e.g. Rajasthan Highlights'),
        'Vietnam Holiday',
      );
      await userEvent.type(
        screen.getByPlaceholderText('e.g. Internal supplier label'),
        '  VN Supplier Package 2026  ',
      );
      await userEvent.click(await screen.findByRole('button', { name: 'Jaipur JAI' }));
      await userEvent.click(screen.getByRole('button', { name: 'Create Destination' }));
      await screen.findByText('Saved destination');
      const createCall = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith('/api/masters/destinations') && init?.method === 'POST',
      );
      const body = JSON.parse(String(createCall?.[1]?.body));
      expect(body.privateName).toBe('VN Supplier Package 2026');
      expect(body.name).toBe('Vietnam Holiday');
    });

    it('prefills, edits and clears the Private Name on the edit form', async () => {
      auth.permissions.delete('masters.destinations.manage_images');
      const stored = { ...destination, privateName: 'Old Internal Label' };
      const fetchMock = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
        const url = String(request);
        if (url.includes('/lookups')) return response(lookups);
        if (url.endsWith(`/api/masters/destinations/${destinationId}`) && init?.method === 'PATCH')
          return response({ ...stored, ...(JSON.parse(String(init?.body)) as object) });
        return response(stored);
      });
      vi.stubGlobal('fetch', fetchMock);
      renderWithProviders(
        <Routes>
          <Route
            path="/masters/destinations/:destinationId/edit"
            element={<DestinationFormPage />}
          />
          <Route path="/masters/destinations/:destinationId" element={<div>Saved destination</div>} />
        </Routes>,
        { route: `/masters/destinations/${destinationId}/edit` },
      );
      await screen.findByRole('heading', { name: 'Edit Destination' });
      // Existing value is prefilled once the detail loads.
      await waitFor(() =>
        expect(screen.getByLabelText(/Private Name/)).toHaveValue('Old Internal Label'),
      );
      // Clearing saves back as null.
      await userEvent.clear(screen.getByLabelText(/Private Name/));
      await userEvent.click(screen.getByRole('button', { name: 'Update Destination' }));
      await screen.findByText('Saved destination');
      const patchCall = fetchMock.mock.calls.find(
        ([url, init]) => String(url).endsWith(`/api/masters/destinations/${destinationId}`) && init?.method === 'PATCH',
      );
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({ privateName: null });
    });
  });
});

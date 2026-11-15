import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/utils';
import { CruisesPage } from './CruisesPage';
import { CruiseFormPage } from './CruiseFormPage';
import { CruiseDetailsPage } from './CruiseDetailsPage';
import { VehiclesPage } from './VehiclesPage';
import { VehicleFormPage } from './VehicleFormPage';
import { VehicleDetailsPage } from './VehicleDetailsPage';
import { NAV_ITEMS } from '@/components/layout/navigation';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const cruiseId = '55555555-5555-4555-8555-555555555555';
const vehicleId = '66666666-6666-4666-8666-666666666666';

const cruiseSummary = {
  id: cruiseId,
  name: 'La Regina Legend Cruise',
  description: '<p>Clean rooms, a restaurant and a bar.</p>',
  status: 'ACTIVE',
  hasImage: false,
  imageFileName: null,
  imageMimeType: null,
  imageConfirmedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: { id: 'u1', fullName: 'Aditi Rao' },
  roomTypeCount: 1,
  priceRange: { min: 45000, max: 45000 },
};
const cruise = {
  ...cruiseSummary,
  updatedBy: null,
  activeRoomTypeCount: 1,
  roomTypes: [
    {
      id: 'crt-1',
      name: 'Premium Suite Ocean View',
      description: 'Balcony suite',
      price: 45000,
      currency: 'INR',
      status: 'ACTIVE',
      sortOrder: 0,
    },
  ],
};

const vehicleRecord = {
  id: vehicleId,
  name: 'Toyota Innova Crysta',
  vehicleType: 'Standard MPV (Family Vehicle)',
  capacity: 8,
  description: 'Ideal for airport transfers.',
  status: 'ACTIVE',
  hasImage: false,
  imageFileName: null,
  imageMimeType: null,
  imageConfirmedAt: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
  createdBy: { id: 'u1', fullName: 'Aditi Rao' },
  updatedBy: null,
};

const page = (data: unknown[]) => ({
  data,
  pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 },
});

const ALL = [
  'masters.cruises.view',
  'masters.cruises.create',
  'masters.cruises.update',
  'masters.cruises.delete',
  'masters.cruises.manage_media',
  'masters.cruises.view_costing',
  'masters.cruises.manage_costing',
  'masters.vehicles.view',
  'masters.vehicles.create',
  'masters.vehicles.update',
  'masters.vehicles.delete',
  'masters.vehicles.manage_media',
];

describe('Phase 13C master pages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    auth.permissions = new Set(ALL);
  });

  it('exposes Cruises and Vehicles inside the existing Masters group', () => {
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
    expect(masters?.children?.find((item) => item.label === 'Cruises')?.to).toBe(
      '/masters/cruises',
    );
    expect(masters?.children?.find((item) => item.label === 'Vehicles')?.to).toBe(
      '/masters/vehicles',
    );
  });

  // -------------------------------------------------------------------------
  // Cruises
  // -------------------------------------------------------------------------

  it('renders the cruise list with room types and price range', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(page([cruiseSummary]))),
    );
    renderWithProviders(<CruisesPage />, { route: '/masters/cruises' });

    // The list renders a desktop table and mobile cards, so names appear twice.
    expect((await screen.findAllByText('La Regina Legend Cruise')).length).toBeGreaterThan(0);
    expect(screen.getByText('1 type')).toBeInTheDocument();
    expect(screen.getByText('45,000')).toBeInTheDocument();
    // Description is rendered as plain text, not raw HTML.
    expect(screen.getByText(/Clean rooms, a restaurant and a bar\./)).toBeInTheDocument();
  });

  it('shows the cruise loading state', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { container } = renderWithProviders(<CruisesPage />, { route: '/masters/cruises' });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows the cruise empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(page([]))),
    );
    renderWithProviders(<CruisesPage />, { route: '/masters/cruises' });
    expect(await screen.findByText('No cruises found')).toBeInTheDocument();
  });

  it('shows the cruise error state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
      })) as unknown as typeof fetch,
    );
    renderWithProviders(<CruisesPage />, { route: '/masters/cruises' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Cruises could not be loaded.');
  });

  it('hides cruise create, edit and delete actions without permission', async () => {
    auth.permissions = new Set(['masters.cruises.view']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(page([cruiseSummary]))),
    );
    renderWithProviders(<CruisesPage />, { route: '/masters/cruises' });

    await screen.findAllByText('La Regina Legend Cruise');
    expect(screen.queryByRole('link', { name: /add new cruise/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /edit la regina legend cruise/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete la regina legend cruise/i }),
    ).not.toBeInTheDocument();
    // Without costing rights the price column is not rendered at all.
    expect(screen.queryByText('Price Range')).not.toBeInTheDocument();
  });

  it('validates the cruise create form before calling the API', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) =>
      response(page([])),
    );
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<CruiseFormPage />, { route: '/masters/cruises/new' });

    await user.click(screen.getByRole('button', { name: /create cruise/i }));
    expect(await screen.findByText('Cruise name is required.')).toBeInTheDocument();
    // Nothing was posted.
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('adds and removes cruise room type rows', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(page([]))),
    );
    renderWithProviders(<CruiseFormPage />, { route: '/masters/cruises/new' });

    expect(screen.getByText(/No room types added yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /add room type/i }));
    expect(screen.getByLabelText('Room type 1 name')).toBeInTheDocument();
    expect(screen.getByLabelText('Room type 1 price')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove room type 1/i }));
    expect(screen.getByText(/No room types added yet/i)).toBeInTheDocument();
  });

  it('loads an existing cruise into the edit form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(cruise)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/masters/cruises/:cruiseId/edit" element={<CruiseFormPage />} />
      </Routes>,
      { route: `/masters/cruises/${cruiseId}/edit` },
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue('La Regina Legend Cruise')).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('Premium Suite Ocean View')).toBeInTheDocument();
    expect(screen.getByDisplayValue('45000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update cruise/i })).toBeInTheDocument();
  });

  it('renders the cruise detail page with quick stats', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(cruise)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/masters/cruises/:cruiseId" element={<CruiseDetailsPage />} />
      </Routes>,
      { route: `/masters/cruises/${cruiseId}` },
    );

    expect(
      await screen.findByRole('heading', { name: 'La Regina Legend Cruise' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Premium Suite Ocean View')).toBeInTheDocument();
    expect(screen.getByText('Quick Stats')).toBeInTheDocument();
    // "Room Types" labels both the card heading and the quick-stat tile.
    expect(screen.getAllByText('Room Types').length).toBeGreaterThan(0);
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Aditi Rao')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Vehicles
  // -------------------------------------------------------------------------

  it('renders the vehicle list with type and capacity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/types'))
          return response({ vehicleTypes: ['Standard MPV (Family Vehicle)'] });
        return response(page([vehicleRecord]));
      }),
    );
    renderWithProviders(<VehiclesPage />, { route: '/masters/vehicles' });

    expect((await screen.findAllByText('Toyota Innova Crysta')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Standard MPV (Family Vehicle)').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/8 persons/).length).toBeGreaterThan(0);
  });

  it('populates the vehicle type filter from the types endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.includes('/types')) return response({ vehicleTypes: ['AC Coach', 'Luxury SUV'] });
        return response(page([vehicleRecord]));
      }),
    );
    renderWithProviders(<VehiclesPage />, { route: '/masters/vehicles' });

    const select = await screen.findByLabelText('Vehicle type');
    await waitFor(() => expect(select).toHaveTextContent('AC Coach'));
    expect(select).toHaveTextContent('Luxury SUV');
    expect(select).toHaveTextContent('All Vehicle Types');
  });

  it('shows the vehicle loading, empty and error states', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { container, unmount } = renderWithProviders(<VehiclesPage />, {
      route: '/masters/vehicles',
    });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).includes('/types') ? response({ vehicleTypes: [] }) : response(page([])),
      ),
    );
    const empty = renderWithProviders(<VehiclesPage />, { route: '/masters/vehicles' });
    expect(await screen.findByText('No vehicles found')).toBeInTheDocument();
    empty.unmount();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'boom' } }),
      })) as unknown as typeof fetch,
    );
    renderWithProviders(<VehiclesPage />, { route: '/masters/vehicles' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Vehicles could not be loaded.');
  });

  it('hides vehicle create, edit and delete actions without permission', async () => {
    auth.permissions = new Set(['masters.vehicles.view']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).includes('/types')
          ? response({ vehicleTypes: [] })
          : response(page([vehicleRecord])),
      ),
    );
    renderWithProviders(<VehiclesPage />, { route: '/masters/vehicles' });

    await screen.findAllByText('Toyota Innova Crysta');
    expect(screen.queryByRole('link', { name: /add new vehicle/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /edit toyota innova crysta/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete toyota innova crysta/i }),
    ).not.toBeInTheDocument();
  });

  it('validates required vehicle fields before calling the API', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) =>
      response({ vehicleTypes: [] }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    renderWithProviders(<VehicleFormPage />, { route: '/masters/vehicles/new' });

    await user.click(screen.getByRole('button', { name: /create vehicle/i }));
    expect(await screen.findByText('Vehicle name is required.')).toBeInTheDocument();
    expect(screen.getByText('Vehicle type is required.')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });

  it('rejects non-numeric and out-of-range vehicle capacity', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ vehicleTypes: [] })),
    );
    renderWithProviders(<VehicleFormPage />, { route: '/masters/vehicles/new' });

    await user.type(screen.getByLabelText(/vehicle name/i), 'Test Van');
    await user.type(screen.getByLabelText(/vehicle type/i), 'Van');

    const capacity = screen.getByLabelText(/capacity/i);
    await user.type(capacity, '4.5');
    await user.click(screen.getByRole('button', { name: /create vehicle/i }));
    expect(await screen.findByText('Capacity must be a whole number.')).toBeInTheDocument();

    await user.clear(capacity);
    await user.type(capacity, '5000');
    await user.click(screen.getByRole('button', { name: /create vehicle/i }));
    expect(await screen.findByText('Capacity looks too large.')).toBeInTheDocument();
  });

  it('loads an existing vehicle into the edit form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).includes('/types')
          ? response({ vehicleTypes: ['Standard MPV (Family Vehicle)'] })
          : response(vehicleRecord),
      ),
    );
    renderWithProviders(
      <Routes>
        <Route path="/masters/vehicles/:vehicleId/edit" element={<VehicleFormPage />} />
      </Routes>,
      { route: `/masters/vehicles/${vehicleId}/edit` },
    );

    await waitFor(() =>
      expect(screen.getByDisplayValue('Toyota Innova Crysta')).toBeInTheDocument(),
    );
    expect(screen.getByDisplayValue('Standard MPV (Family Vehicle)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update vehicle/i })).toBeInTheDocument();
  });

  it('renders the vehicle detail page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(vehicleRecord)),
    );
    renderWithProviders(
      <Routes>
        <Route path="/masters/vehicles/:vehicleId" element={<VehicleDetailsPage />} />
      </Routes>,
      { route: `/masters/vehicles/${vehicleId}` },
    );

    expect(
      await screen.findByRole('heading', { name: 'Toyota Innova Crysta' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Vehicle Type')).toBeInTheDocument();
    expect(screen.getByText('8 persons')).toBeInTheDocument();
    expect(screen.getByText('Ideal for airport transfers.')).toBeInTheDocument();
    expect(screen.getByText('Aditi Rao')).toBeInTheDocument();
  });
});

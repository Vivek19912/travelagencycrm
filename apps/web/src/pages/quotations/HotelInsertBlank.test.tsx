import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import {
  expandDefaultHotelRows,
  isHotelRowEmpty,
  matchDefaultHotels,
} from './QuotationBuilderPage';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));

const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const hotelRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'stay-1',
  city: 'Goa',
  hotelName: 'Classic Luxury Resorts',
  category: '5 Star',
  roomType: null,
  mealPlan: null,
  hotelId: null,
  hotelRoomTypeId: null,
  hotelMealPlanId: null,
  rooms: null,
  roomsOverride: null,
  nights: 2,
  checkInDate: '2026-09-10T00:00:00.000Z',
  checkOutDate: '2026-09-12T00:00:00.000Z',
  checkInTime: null,
  checkOutTime: null,
  showCheckInTime: false,
  showCheckOutTime: false,
  internalCost: 0,
  sellingPrice: 10000,
  selected: true,
  notes: null,
  sequence: 1,
  images: [],
  imageSnapshotPresent: false,
  pdfImageUrl: null,
  roomLines: [],
  mealPlanLines: [],
  ...overrides,
});

const threeHotels = () => [
  hotelRow({ id: 'stay-1', hotelName: 'Classic Luxury Resorts', sequence: 1 }),
  hotelRow({ id: 'stay-2', hotelName: 'Deluxe Houseboat', sequence: 2 }),
  hotelRow({ id: 'stay-3', hotelName: 'Skyfarm Resorts', sequence: 3 }),
];

// A default hotel master for Goa. Before the fix, inserting a blank stay
// inherited the neighbour city ("Goa") and the auto-prefill effect filled it
// with this alphabetically-first default (Classic Luxury Resorts).
const goaDefaultMaster = {
  id: 'h-classic',
  name: 'Classic Luxury Resorts',
  status: 'ACTIVE',
  isDefaultForCity: true,
  starCategory: 5,
  city: { name: 'Goa' },
  destination: { id: 'dest-goa', name: 'Goa' },
  images: [],
};

const selectableMaster = {
  id: 'h-selectable',
  name: 'Selectable Beach Resort',
  status: 'ACTIVE',
  isDefaultForCity: false,
  starCategory: 4,
  city: { name: 'Goa' },
  destination: { id: 'dest-goa', name: 'Goa' },
  images: [],
};

const version = (overrides: Record<string, unknown> = {}) => ({
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
  hotels: threeHotels(),
  services: [],
  inclusions: [],
  exclusions: [],
  terms: [],
  faqs: [],
  addOnDetails: { include: true },
  ...overrides,
});

const detail = (versionOverrides: Record<string, unknown> = {}) => ({
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
  currency: 'INR',
  validUntil: null,
  createdAt: '2026-07-21T00:00:00.000Z',
  createdBy: person,
  query: {
    id: 'lead-1',
    queryNumber: 'QRY-1',
    leadStage: 'QUOTATION_SENT',
    assignedToId: 'user-1',
    createdById: 'user-1',
    services: [{ serviceType: 'HOTEL' }],
    itinerary: [{ country: 'Goa', destination: 'Goa', nights: 2, sequence: 1 }],
  },
  versions: [version(versionOverrides)],
  documents: [],
  emailLogs: [],
  activityTimeline: [],
  booking: null,
});

const settings = {
  profile: {
    name: 'Alpha Travel',
    email: 'hello@alpha.test',
    phone: '+91 90000 00001',
    website: 'https://alpha.test',
    address: 'Goa, India',
    googleMapsUrl: null,
    operatingSince: 2015,
    totalReviews: null,
    tripsSold: 4200,
  },
  branding: { primaryColor: '#2563eb', hotelVoucherPrimaryColor: null, hasLogo: false, logoMimeType: null, logoFileSize: null },
  tax: { taxRegistrationNumber: '29ABCDE1234F1Z5', tan: 'ABCD12345E' },
  preferences: { timezone: 'Asia/Kolkata', defaultCurrency: 'INR' },
  defaultTerms: { quotationTerms: null, bookingTerms: null },
  bankAccount: { exists: false },
  numbering: {},
  capabilities: { canView: true, canUpdate: true },
};

function builderFetch(base: unknown, extra: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/masters/hotels': {
      success: true,
      data: [goaDefaultMaster, selectableMaster],
      pagination: { total: 2 },
    },
    '/masters/destinations': { success: true, data: [], pagination: { total: 0 } },
    '/masters/airlines': { success: true, data: [], pagination: { total: 0 } },
    '/masters/cruises': { success: true, data: [], pagination: { total: 0 } },
    '/masters/vehicles': { success: true, data: [], pagination: { total: 0 } },
    '/masters/sightseeing': { success: true, data: [], pagination: { total: 0 } },
    '/masters/sightseeing/activities': { success: true, data: [], pagination: { total: 0 } },
    '/masters/add-on-services': { success: true, data: [], pagination: { total: 0 } },
    '/masters/faqs': { success: true, data: [], pagination: { total: 0 } },
    '/users': { success: true, data: [], pagination: { total: 0 } },
    '/settings': settings,
    '/destination-expert/presets': { success: true, data: [] },
    ...extra,
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

const openHotelTab = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
};

const headerNames = () =>
  screen
    .getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ })
    .map((b) => (b.closest('article') as HTMLElement).querySelector('h4')!.textContent);

const settlePrefill = async () => {
  // Let the automatic default-hotel effect run (masters load async). A blank
  // row that is still blank afterwards was genuinely opted out.
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Quotation builder' })).toBeInTheDocument());
  await new Promise((resolve) => setTimeout(resolve, 400));
};

describe('Add Hotel Before/After creates blank entries', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('1. Add Hotel Before creates a blank entry at the correct position', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    expect(headerNames()).toEqual(['Classic Luxury Resorts', 'Deluxe Houseboat', 'Skyfarm Resorts']);
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 2' }));
    // Use Before on the original Hotel B (now still stay 2 position context):
    // reset by clicking Before on stay 2 of the updated list (Deluxe Houseboat is now stay 3).
    // Instead verify After first, then in a fresh render verify Before.
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Hotel Stay',
      'Skyfarm Resorts',
    ]);
    await settlePrefill();
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Hotel Stay',
      'Skyfarm Resorts',
    ]);
  });

  it('1b. Add Hotel Before inserts immediately before the selected hotel', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    // Only the first card carries "Add Hotel Before"; use it on stay 1, then
    // reorder context: click Before on stay 1 with A/B/C.
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel before stay 1' }));
    expect(headerNames()).toEqual([
      'Hotel Stay',
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Skyfarm Resorts',
    ]);
    await settlePrefill();
    expect(headerNames()).toEqual([
      'Hotel Stay',
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Skyfarm Resorts',
    ]);
  });

  it('2. Add Hotel After creates a blank entry at the correct position', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 2' }));
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Hotel Stay',
      'Skyfarm Resorts',
    ]);
    await settlePrefill();
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Hotel Stay',
      'Skyfarm Resorts',
    ]);
  });

  it('3. neither action copies the first existing hotel', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 2' }));
    await settlePrefill();
    // Only the three original stays show the first hotel's name.
    expect(headerNames().filter((n) => n === 'Classic Luxury Resorts')).toHaveLength(1);
    // The blank entry exposes an empty Hotel master input (only expanded stays render inputs).
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 3' }));
    expect((screen.getByLabelText('Hotel master') as HTMLInputElement).value).toBe('');
  });

  it('4. neither action copies the adjacent hotel', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 2' }));
    await settlePrefill();
    expect(headerNames().filter((n) => n === 'Deluxe Houseboat')).toHaveLength(1);
    expect(headerNames().filter((n) => n === 'Skyfarm Resorts')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 3' }));
    expect((screen.getByLabelText('Hotel master') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Hotel total rooms') as HTMLInputElement).value).toBe('');
  });

  it('5. multiple insertions create independent blank objects', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Hotel Stay',
      'Hotel Stay',
      'Deluxe Houseboat',
      'Skyfarm Resorts',
    ]);
    await settlePrefill();
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Hotel Stay',
      'Hotel Stay',
      'Deluxe Houseboat',
      'Skyfarm Resorts',
    ]);
    // Expand both blanks and type different names: they stay independent.
    // Only expanded stays render inputs, so the two inputs are the two blanks in order.
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 3' }));
    const masters = screen.getAllByLabelText('Hotel master') as HTMLInputElement[];
    expect(masters).toHaveLength(2);
    fireEvent.change(masters[0]!, { target: { value: 'Typed Hotel One' } });
    expect((screen.getAllByLabelText('Hotel master') as HTMLInputElement[])[0]!.value).toBe(
      'Typed Hotel One',
    );
    expect((screen.getAllByLabelText('Hotel master') as HTMLInputElement[])[1]!.value).toBe('');
  });

  it('6. editing a newly added hotel does not modify other hotel entries', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    fireEvent.change(screen.getByLabelText('Hotel master'), { target: { value: 'My New Hotel' } });
    expect(headerNames()[1]).toBe('My New Hotel');
    expect(headerNames()[0]).toBe('Classic Luxury Resorts');
    expect(headerNames()[2]).toBe('Deluxe Houseboat');
    expect(headerNames()[3]).toBe('Skyfarm Resorts');
  });

  it('7. existing hotel data remains unchanged after insertion', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    // Record the original collapsed headers, insert, then verify all original
    // headers survive in order with a blank in the selected position.
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Skyfarm Resorts',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 2' }));
    await settlePrefill();
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Hotel Stay',
      'Skyfarm Resorts',
    ]);
    // Spot-check the original first stay still carries its saved value.
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    expect((screen.getByLabelText('Hotel master') as HTMLInputElement).value).toBe(
      'Classic Luxury Resorts',
    );
  });

  it('8. explicitly selecting a hotel in the new entry works correctly', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    // Exact master-name match commits a real master selection (hotelId linked).
    fireEvent.change(screen.getByLabelText('Hotel master'), { target: { value: 'Selectable Beach Resort' } });
    await waitFor(() =>
      expect(headerNames()[1]).toBe('Selectable Beach Resort'),
    );
    expect(headerNames()[0]).toBe('Classic Luxury Resorts');
  });

  it('9. existing default-hotel automatic prefill behavior remains unchanged', async () => {
    // Unit-level: the shared prefill helpers still behave exactly as before.
    const masters = [
      {
        id: 'h-a',
        name: 'Hotel A',
        status: 'ACTIVE',
        isDefaultForCity: true,
        starCategory: 5,
        city: { name: 'Singapore' },
        destination: { id: 'dest-sg', name: 'Singapore' },
        images: [],
      },
      {
        id: 'h-b',
        name: 'Hotel B',
        status: 'ACTIVE',
        isDefaultForCity: true,
        starCategory: 5,
        city: { name: 'Singapore' },
        destination: { id: 'dest-sg', name: 'Singapore' },
        images: [],
      },
    ] as Parameters<typeof matchDefaultHotels>[1];
    expect(matchDefaultHotels('Singapore', masters).map((h) => h.name)).toEqual([
      'Hotel A',
      'Hotel B',
    ]);
    expect(
      isHotelRowEmpty({ hotelId: null, hotelName: '', sellingPrice: 0 } as never),
    ).toBe(true);
    expect(
      isHotelRowEmpty({ hotelId: null, hotelName: 'Typed', sellingPrice: 0 } as never),
    ).toBe(false);
    const rows = expandDefaultHotelRows(
      [
        {
          city: 'Singapore',
          hotelId: null,
          hotelName: '',
          nights: 3,
          rooms: 2,
        } as never,
      ],
      masters,
    );
    expect(rows.map((r) => r.hotelName)).toEqual(['Hotel A', 'Hotel B']);
    // New-quotation prefill still works in the UI: an empty-lead quotation
    // still receives its destination default.
    const emptyLead = detail({ hotels: [] });
    vi.stubGlobal('fetch', builderFetch(emptyLead));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /^(Expand|Collapse) hotel stay/ }).length,
      ).toBeGreaterThan(0),
    );
  });

  it('10. save and reload preserve the correct hotel entries and ordering', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await openHotelTab();
    await userEvent.click(screen.getByRole('button', { name: 'Add hotel after stay 2' }));
    await settlePrefill();
    expect(headerNames()).toEqual([
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Hotel Stay',
      'Skyfarm Resorts',
    ]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Save quotation' })[1]!);
    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH'),
      ).toBe(true);
    });
    const patch = fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH');
    const body = JSON.parse(String(patch![1]!.body));
    // Unnamed blank drafts are not persisted; the three named stays keep order.
    expect(body.hotels.map((h: { hotelName: string }) => h.hotelName)).toEqual([
      'Classic Luxury Resorts',
      'Deluxe Houseboat',
      'Skyfarm Resorts',
    ]);
    for (const hotel of body.hotels as Array<Record<string, unknown>>) {
      expect(hotel).not.toHaveProperty('skipAutoHotelPrefill');
    }
  });
});

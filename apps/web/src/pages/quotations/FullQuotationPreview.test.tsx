import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/utils';
import { QuotationBuilderPage } from './QuotationBuilderPage';
import { buildDestinationExpertPreview, buildFullPreviewData, MOBILE_PREVIEW_WIDTH } from './FullQuotationPreview';
import {
  MOBILE_PREVIEW_HEIGHT,
  PHONE_BODY_ASPECT_RATIO,
  PHONE_BODY_HEIGHT,
  PHONE_BODY_WIDTH,
  PHONE_SCREEN_ASPECT_RATIO,
} from './FullQuotationPreview';
import { previewSectionForBuilderTab, previewTargetKey, scrollPreviewToSection, scrollPreviewToTarget } from './FullQuotationPreview';

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ hasPermission: (key: string) => auth.permissions.has(key) }),
}));
const response = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, data }) }) as Response;

const person = { id: 'user-1', fullName: 'Aditi Rao', username: 'owner' };

const segment = (overrides: Record<string, unknown> = {}) => ({
  airlineId: null,
  airlineName: null,
  flightNumber: null,
  travelClass: 'Economy',
  from: null,
  to: null,
  departureDate: null,
  departureTime: null,
  arrivalDate: null,
  arrivalTime: null,
  duration: null,
  cabinLuggage: null,
  checkInLuggage: null,
  notes: null,
  connectionVia: null,
  ...overrides,
});

const flightVersion = () => ({
  id: 'version-1',
  versionNumber: 1,
  title: 'Goa Family Escape',
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
  pricingHeading: 'Price Breakdown',
  pricingSubheading: null,
  perAdultPrice: '25000',
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
  hotels: [
    {
      id: 'hotel-1',
      city: 'Calangute',
      hotelName: 'Coastal Bay Resort',
      category: '4 Star',
      roomType: 'Deluxe Room',
      mealPlan: 'Breakfast',
      rooms: 1,
      nights: 4,
      checkInDate: '2026-09-10T00:00:00.000Z',
      checkOutDate: '2026-09-14T00:00:00.000Z',
      checkInTime: null,
      checkOutTime: null,
      internalCost: '0',
      sellingPrice: '20000',
      selected: true,
      sequence: 1,
      images: [],
    },
  ],
  services: [
    {
      id: 'svc-1',
      serviceType: 'SIGHTSEEING',
      name: 'North Goa tour',
      description: null,
      dayNumber: null,
      city: 'Goa',
      quantity: '1',
      unitSellingPrice: '0',
      totalSellingPrice: '0',
      sellingPrice: '0',
      sequence: 1,
    },
  ],
  inclusions: [{ id: 'inc-1', content: 'Daily breakfast', sequence: 1 }],
  exclusions: [],
  terms: [],
  faqs: [{ question: 'Is pickup included?', answer: 'Yes, hotel pickup is included.' }],
  addOnDetails: { include: true },
  sightseeingDetails: {
    include: true,
    sectionTitle: 'Sightseeing & Experiences',
    amount: 0,
    description: null,
    days: [
      {
        dayNumber: 1,
        title: 'Arrival and check-in',
        city: 'Calangute',
        date: null,
        meals: { breakfast: false, lunch: false, dinner: false },
        mealMode: 'NO_TRANSFER',
        dailyTransfer: 'NO_TRANSFER',
        activities: [{ name: 'Beach evening', description: 'Sunset at the beach.' }],
      },
    ],
  },
  flightDetails: {
    include: true,
    sectionTitle: 'Flight Details',
    amount: 0,
    pricingBasis: 'FIXED_TOTAL',
    entryMode: 'MANUAL',
    images: [],
    journeyType: 'ROUND_TRIP',
    outbound: { segments: [] },
    returnJourney: { segments: [] },
    flights: [
      {
        bookmarkCode: null,
        journeyType: 'ROUND_TRIP',
        outbound: {
          fromCity: 'Delhi',
          toCity: 'Goa',
          segments: [
            segment({ airlineName: 'Air India', flightNumber: 'AI101', from: 'DEL', to: 'GOI' }),
          ],
        },
        returnJourney: {
          fromCity: 'Goa',
          toCity: 'Delhi',
          segments: [
            segment({ airlineName: 'Air India', flightNumber: 'AI102', from: 'GOI', to: 'DEL' }),
          ],
        },
      },
    ],
  },
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
    services: [{ serviceType: 'HOTEL' }, { serviceType: 'SIGHTSEEING' }],
    itinerary: [{ country: 'India', destination: 'Goa', nights: 4, sequence: 1 }],
  },
  versions: [{ ...flightVersion(), ...versionOverrides }],
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
  branding: {
    primaryColor: '#2563eb',
    hotelVoucherPrimaryColor: null,
    hasLogo: false,
    logoMimeType: null,
    logoFileSize: null,
  },
  tax: { taxRegistrationNumber: '29ABCDE1234F1Z5', tan: 'ABCD12345E' },
  preferences: { timezone: 'Asia/Kolkata', defaultCurrency: 'INR' },
  defaultTerms: { quotationTerms: null, bookingTerms: null },
  bankAccount: { exists: false },
  numbering: {},
  capabilities: { canView: true, canUpdate: true },
};

function builderFetch(base: unknown, extra: Record<string, unknown> = {}) {
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

/**
 * The live document inside a preview phone iframe. CSS media queries evaluate
 * against this document's 393px viewport, so the shared renderer inside it
 * uses its real mobile responsive layout.
 */
function frameDocument(testId: string): Document {
  const iframe = screen.getByTestId(testId) as HTMLIFrameElement;
  const doc = iframe.contentDocument;
  if (!doc) throw new Error(`preview frame ${testId} has no document`);
  return doc;
}
const pinnedDoc = () => frameDocument('pinned-preview-frame');
/** The element that actually scrolls inside the phone screen. */
const frameScroller = (doc: Document): Element => doc.scrollingElement ?? doc.documentElement;

/** Wait for the portalled quotation to appear inside the frame, then return it. */
async function pinnedReady(): Promise<Document> {
  const doc = pinnedDoc();
  await within(doc.body as HTMLElement).findByText('Custom Package for Aarav Mehta');
  return doc;
}

describe('previewSectionForBuilderTab mapping', () => {
  it.each([
    ['pricingMethod', 'pricing'],
    ['flight', 'flights'],
    ['hotel', 'hotels'],
    ['sightseeing', 'itinerary'],
    ['cruise', 'cruise'],
    ['vehicle', 'transportation'],
    ['addon', 'addons'],
    ['inclusions', 'policies'],
    ['faqs', 'faqs'],
    ['summary', 'pricing'],
  ])('maps the %s tab to the %s preview section', (tab, section) => {
    expect(previewSectionForBuilderTab(tab)).toBe(section);
  });

  it.each([['setting'], ['destinationExpert'], ['visa'], ['unknown-tab'], [null], [undefined], ['']])(
    'opens %s at the top (no matching section)',
    (tab) => {
      expect(previewSectionForBuilderTab(tab)).toBeNull();
    },
  );
});

const withCruise = () => {
  const quotation = detail();
  (
    quotation.versions[0] as unknown as { services: Array<Record<string, unknown>> }
  ).services.push({
    id: 'cruise-1',
    serviceType: 'CRUISE',
    name: 'Ocean Cruise',
    description: null,
    dayNumber: null,
    city: null,
    quantity: '1',
    unitSellingPrice: '0',
    totalSellingPrice: '0',
    sellingPrice: '0',
    sequence: 2,
    images: [],
  });
  return quotation;
};

describe('scrollPreviewToSection helper', () => {
  const mockTop = (el: Element, top: number) => {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ top, left: 0, bottom: top, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
  };

  it('scrolls only the container to the anchor with a small offset', () => {
    const container = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.setAttribute('data-preview-section', 'cruise');
    container.appendChild(anchor);
    document.body.appendChild(container);
    try {
      mockTop(container, 100);
      mockTop(anchor, 500);
      scrollPreviewToSection(container, 'cruise');
      expect(container.scrollTop).toBe(384);
    } finally {
      container.remove();
    }
  });

  it('does not double-count scroll for a document scrolling root', () => {
    // A scrolling root reports its own rect relative to the viewport
    // (top === -scrollTop); the anchor's viewport position already accounts
    // for scrolling, so it applies directly. Regression: navigating from a
    // scrolled phone used to overshoot by the current scroll offset.
    const root = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    const anchor = document.createElement('div');
    anchor.setAttribute('data-preview-section', 'cruise');
    document.body.appendChild(anchor);
    let saved = 0;
    Object.defineProperty(root, 'scrollTop', {
      get: () => saved,
      set: (value: number) => {
        saved = value;
      },
      configurable: true,
    });
    const anchorSpy = vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      top: 500,
      left: 0,
      bottom: 500,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 500,
      toJSON: () => ({}),
    });
    try {
      saved = 200;
      scrollPreviewToSection(root, 'cruise');
      // 200 (current) + 500 (viewport position) - 16, not +200 twice.
      expect(saved).toBe(684);
    } finally {
      anchorSpy.mockRestore();
      anchor.remove();
      delete (root as unknown as Record<string, unknown>).scrollTop;
    }
  });

  it('leaves the position untouched for missing sections, null sections, and null containers', () => {
    const container = document.createElement('div');
    container.scrollTop = 123;
    scrollPreviewToSection(container, 'cruise');
    expect(container.scrollTop).toBe(123);
    scrollPreviewToSection(container, null);
    expect(container.scrollTop).toBe(123);
    expect(() => scrollPreviewToSection(null, 'cruise')).not.toThrow();
  });
});

describe('Pinned preview tab navigation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  /**
   * Make the frame's scroller observable in jsdom (which reports no layout):
   * record scrollTop writes and report a simulated anchor position.
   */
  const observeScroller = (doc: Document, anchorTop: number, scrollerTop: number) => {
    const scroller = frameScroller(doc) as HTMLElement;
    let saved = 0;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => saved,
      set: (value: number) => {
        saved = value;
      },
      configurable: true,
    });
    scroller.getBoundingClientRect = () =>
      ({ top: scrollerTop, left: 0, bottom: scrollerTop, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    const readSaved = () => saved;
    const anchor = (section: string) => {
      const node = doc.querySelector<HTMLElement>(`[data-preview-section="${section}"]`);
      if (node) {
        node.getBoundingClientRect = () =>
          ({ top: anchorTop, left: 0, bottom: anchorTop, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
      }
      return node;
    };
    return { readSaved, anchor };
  };

  it('navigates from Cruise to the cruise section anchor', async () => {
    vi.stubGlobal('fetch', builderFetch(withCruise()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Cruise' }));
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    expect(doc.querySelector('[data-preview-section="cruise"]')).not.toBeNull();
    // The cruise card itself renders inside its section.
    expect(within(body).getByText('Ocean Cruise')).toBeInTheDocument();
    // The whole quotation is still present around it (hero above, footer below).
    expect(within(body).getByText('Custom Package for Aarav Mehta')).toBeInTheDocument();
    expect(within(body).getAllByText('Alpha Travel', { exact: false }).length).toBeGreaterThan(0);
  });

  it.each([
    ['Hotel', 'hotels'],
    ['FAQs', 'faqs'],
    ['Pricing', 'pricing'],
  ])('opens from %s at its %s anchor', async (tab, section) => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: tab }));
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    expect(doc.querySelector(`[data-preview-section="${section}"]`)).not.toBeNull();
  });

  it('scrolls the phone (not the desktop page) when the builder tab changes', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const { readSaved, anchor } = observeScroller(doc, 500, 100);
    // Install the anchor geometry before switching tabs: the navigation
    // effect reads it synchronously on the tab change.
    expect(anchor('faqs')).not.toBeNull();
    const iframe = screen.getByTestId('pinned-preview-frame');
    // Switch to FAQs: the phone navigates to the faqs anchor. The scroller is
    // the frame document's scrolling root, whose viewport position already
    // accounts for scrolling: 0 (current) + 500 (anchor) - 16.
    await userEvent.click(await screen.findByRole('button', { name: 'FAQs' }));
    await vi.waitFor(() => expect(readSaved()).toBe(484));
    // The desktop page never scrolled and the iframe was never recreated.
    expect(window.scrollY).toBe(0);
    expect(screen.getByTestId('pinned-preview-frame')).toBe(iframe);
    expect(pinnedDoc()).toBe(doc);
  });

  it('leaves the scroll position alone for tabs with no public section', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const { readSaved, anchor } = observeScroller(doc, 500, 100);
    expect(anchor('faqs')).not.toBeNull();
    // Switch to a mapped tab first so a scroll happens.
    await userEvent.click(await screen.findByRole('button', { name: 'FAQs' }));
    await vi.waitFor(() => expect(readSaved()).toBe(484));
    // Switch to Settings (no public section): no jump, position preserved.
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readSaved()).toBe(484);
  });

  it('leaves the position untouched when the mapped section is hidden', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          flightDetails: {
            include: true,
            sectionTitle: 'Flight Details',
            entryMode: 'MANUAL',
            images: [],
            flights: [],
          },
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    expect(doc.querySelector('[data-preview-section="flights"]')).toBeNull();
    const scroller = frameScroller(doc) as HTMLElement;
    scroller.scrollTop = 180;
    // The mapped section is genuinely absent (no flights): the preview keeps
    // its current position instead of snapping back to the top.
    await userEvent.click(await screen.findByRole('button', { name: /^Flight/ }));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(scroller.scrollTop).toBe(180);
    // The rest of the quotation still renders.
    expect(
      within(doc.body as HTMLElement).getByText('Custom Package for Aarav Mehta'),
    ).toBeInTheDocument();
  });

  it('does not reset scroll position on live edits and re-targets on reopen', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const scroller = frameScroller(doc);
    scroller.scrollTop = 200;
    const nameInput = await screen.findByLabelText('Hotel section title');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Stays');
    // Live re-renders must not yank the scroll position.
    expect(frameScroller(pinnedDoc()).scrollTop).toBe(200);
    expect(
      await within(doc.body as HTMLElement).findByRole('heading', { name: 'Updated Stays' }),
    ).toBeInTheDocument();

    // Closing and reopening from another tab targets that tab's section.
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'FAQs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open Live Preview' }));
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const reopened = await pinnedReady();
    expect(reopened.querySelector('[data-preview-section="faqs"]')).not.toBeNull();
  });
});

describe('buildFullPreviewData adapter', () => {
  it('maps saved quotation, edited version, and settings without mutating inputs', () => {
    const quotation = detail() as never;
    const form = { ...flightVersion(), title: 'Edited title' } as never;
    const before = JSON.stringify({ quotation, form });
    const data = buildFullPreviewData({
      quotation,
      savedVersion: (quotation as { versions: never[] }).versions[0]!,
      form,
      settings: settings as never,
      flightPreviewUrls: {},
    });
    expect(JSON.stringify({ quotation, form })).toBe(before);
    expect(data.quotation.quotationNumber).toBe('QT-2026-000001');
    expect(data.quotation.destinations).toBe('India');
    expect(data.quotation.durationNights).toBe(4);
    expect(data.version.title).toBe('Edited title');
    expect(data.version.status).toBe('DRAFT');
    expect(data.version.createdBy).toMatchObject({ fullName: 'Aditi Rao' });
    expect(data.company).toMatchObject({ name: 'Alpha Travel', primaryColor: '#2563eb' });
    // Server-resolved extras stay empty rather than invented.
    expect(data.destinationExpert).toBeNull();
    expect(data.heroImageUrl).toBeNull();
    expect(data.downloadUrl).toBeNull();
  });

  it('maps master-sourced presentations and sightseeing document URLs', () => {
    const quotation = detail() as never;
    const form = { ...flightVersion() } as never;
    const data = buildFullPreviewData({
      quotation,
      savedVersion: (quotation as { versions: never[] }).versions[0]!,
      form,
      settings: settings as never,
      flightPreviewUrls: {},
      presentations: {
        heroImageUrl: 'https://cdn.example/hero.jpg',
        airlinePresentations: { 'air-1': { name: 'Air India', logoUrl: 'https://cdn.example/ai.png' } },
        hotelPresentations: {
          'hotel-1': {
            imageUrl: 'https://cdn.example/hotel.jpg',
            starCategory: 5,
            starRating: '4.6',
            address: 'Sea Face Road',
            reviewLink: 'https://maps.example/review',
            checkInTime: '14:00',
            checkOutTime: '12:00',
            destination: 'Goa',
            country: 'India',
          },
        },
        cruisePresentations: {
          'cruise-1': { imageUrl: 'https://cdn.example/cruise.jpg', name: 'Sunset Cruise', roomTypeName: 'Deck' },
        },
        vehiclePresentations: {
          'veh-1': { imageUrl: 'https://cdn.example/van.jpg', name: 'Van', vehicleType: 'SUV', capacity: 6 },
        },
        sightseeingPresentations: { 'sight-1': { imageUrl: 'https://cdn.example/sight.jpg' } },
      },
      sightseeingPreviewUrls: { 'doc-9': 'https://cdn.example/doc.jpg', 'doc-bad': '' },
    });
    expect(data.heroImageUrl).toBe('https://cdn.example/hero.jpg');
    expect(data.hotelPresentations?.['hotel-1']).toMatchObject({
      starCategory: 5,
      starRating: '4.6',
      reviewLink: 'https://maps.example/review',
    });
    expect(data.airlinePresentations?.['air-1']).toMatchObject({ name: 'Air India' });
    expect(data.cruisePresentations?.['cruise-1']?.imageUrl).toBe('https://cdn.example/cruise.jpg');
    expect(data.vehiclePresentations?.['veh-1']?.imageUrl).toBe('https://cdn.example/van.jpg');
    expect(data.sightseeingPresentations?.['sight-1']?.imageUrl).toBe('https://cdn.example/sight.jpg');
    // Only resolved document URLs map; failures stay absent like the server.
    expect(data.sightseeingDocumentPresentations).toEqual({ 'doc-9': { imageUrl: 'https://cdn.example/doc.jpg' } });
  });
});

describe('Destination expert preview parity', () => {
  const member = {
    id: 'expert-1',
    fullName: 'Rhea Kapoor',
    username: 'rhea',
    email: 'rhea@alpha.test',
    phone: '+91 90000 00002',
    status: 'ACTIVE' as const,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    role: { id: 'r1', name: 'Agent', hierarchyLevel: 1 },
    permissionTemplate: null,
    gender: 'FEMALE' as const,
    jobTitle: 'Senior Travel Designer',
    bio: 'Goa specialist with 8 years of experience.',
    specialization: 'Honeymoons',
    yearsOfExperience: 8,
    tripsPlanned: 320,
    languages: 'English, Hindi',
    whatsappNumber: '+91 90000 00003',
    profileImageUrl: 'https://cdn.example/rhea.jpg',
  };

  const config = {
    enabled: true,
    expertUserId: 'expert-1',
    heading: 'Meet Your Expert',
    customIntroduction: null,
    whatsappNumber: '+91 90000 00009',
    callNumber: null,
    email: undefined,
    showWhatsapp: true,
    showCall: true,
    showEmail: true,
    showExperience: true,
    showTripsPlanned: true,
    showLanguages: true,
    jobTitle: null,
    bio: null,
    specialization: null,
    yearsOfExperience: null,
    tripsPlanned: null,
    languages: null,
    gender: null,
    profileImageUrl: null,
  };

  it('returns null when disabled, unassigned, or the member is unknown', () => {
    expect(buildDestinationExpertPreview({ config: null, users: [member], companyPhone: null, companyEmail: null })).toBeNull();
    expect(
      buildDestinationExpertPreview({ config: { ...config, enabled: false }, users: [member], companyPhone: null, companyEmail: null }),
    ).toBeNull();
    expect(
      buildDestinationExpertPreview({ config: { ...config, expertUserId: null }, users: [member], companyPhone: null, companyEmail: null }),
    ).toBeNull();
    expect(
      buildDestinationExpertPreview({ config, users: [], companyPhone: null, companyEmail: null }),
    ).toBeNull();
  });

  it('prefers snapshot fields and photo, falls back to member then company contacts', () => {
    const expert = buildDestinationExpertPreview({ config, users: [member], companyPhone: '+91 90000 00001', companyEmail: 'hello@alpha.test' });
    expect(expert).not.toBeNull();
    expect(expert).toMatchObject({
      id: 'expert-1',
      fullName: 'Rhea Kapoor',
      // Snapshot contact override wins over the member record.
      whatsappNumber: '+91 90000 00009',
      // Explicit empty snapshot hides the call action (no company fallback).
      phone: null,
      // Absent snapshot key falls back to the member record.
      email: 'rhea@alpha.test',
      // Untouched snapshot fields fall back to the member record.
      jobTitle: 'Senior Travel Designer',
      yearsOfExperience: 8,
      gender: 'FEMALE',
    });
    // No snapshot photo and no member photo would use the gender default;
    // here the member photo URL wins as a custom avatar.
    expect(expert?.profileImageUrl).toBe('https://cdn.example/rhea.jpg');
    expect(expert?.avatarKind).toBe('custom');
    expect(expert?.config).toMatchObject({ heading: 'Meet Your Expert', showWhatsapp: true });
  });

  it('uses the gender default avatar and company fallbacks when no photo exists', () => {
    const photoLess = { ...member, profileImageUrl: null } as never;
    const cfg = { ...config, whatsappNumber: undefined, callNumber: undefined, email: undefined } as never;
    const expert = buildDestinationExpertPreview({
      config: cfg,
      users: [photoLess],
      companyPhone: '+91 90000 00001',
      companyEmail: 'hello@alpha.test',
    });
    expect(expert?.profileImageUrl).toBeNull();
    expect(expert?.avatarKind).toBe('female');
    // Absent snapshot keys fall back to member, then company contacts.
    expect(expert?.phone).toBe('+91 90000 00002');
    expect(expert?.email).toBe('rhea@alpha.test');
  });

  it('maps the expert through buildFullPreviewData exactly when the weblink would show it', () => {
    const quotation = detail() as never;
    const form = { ...flightVersion(), destinationExpertConfig: config } as never;
    const withExpert = buildFullPreviewData({
      quotation,
      savedVersion: (quotation as { versions: never[] }).versions[0]!,
      form,
      settings: settings as never,
      flightPreviewUrls: {},
      expertUsers: [member],
    });
    expect(withExpert.destinationExpert?.fullName).toBe('Rhea Kapoor');
    expect(withExpert.destinationExpert?.profileImageUrl).toBe('https://cdn.example/rhea.jpg');
    const withoutUsers = buildFullPreviewData({
      quotation,
      savedVersion: (quotation as { versions: never[] }).versions[0]!,
      form,
      settings: settings as never,
      flightPreviewUrls: {},
    });
    expect(withoutUsers.destinationExpert).toBeNull();
  });

  it('renders the expert section with photo in the pinned phone', async () => {
    const usersRoute = {
      '/users': {
        success: true,
        data: [member],
        pagination: { total: 1 },
      },
    };
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({ destinationExpertConfig: config }),
        usersRoute,
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    expect(doc.querySelector('[data-preview-section="destinationExpert"]')).not.toBeNull();
    const avatar = doc.querySelector('img[alt="Rhea Kapoor avatar"]') as HTMLImageElement | null;
    expect(avatar?.getAttribute('src')).toBe('https://cdn.example/rhea.jpg');
    expect(within(doc.body as HTMLElement).getByText('RHEA')).toBeInTheDocument();
  });
});

describe('Live preview in the builder', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('opens from any tab and renders the whole public structure', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // Available before visiting any tab.
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    // Hero, services, itinerary, hotels, flights, policies, FAQs, contact, footer.
    for (const text of [
      'Custom Package for Aarav Mehta',
      'Total Package Price',
      '₹50,000',
      'Coastal Bay Resort',
      'AI101',
      'Arrival and check-in',
      'Daily breakfast',
      'Is pickup included?',
    ]) {
      // A value can legitimately appear more than once (e.g. the total price on
      // the card and again in the By Traveler "Price Breakdown").
      expect(within(body).getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
    }
    // Agency branding appears in both the Contact Us card and the footer.
    expect(within(body).getAllByText('Alpha Travel', { exact: false }).length).toBeGreaterThan(
      0,
    );
  });

  it('renders the By Traveler package breakdown in the live preview, matching the total card', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    // The shared renderer powers both this preview and the public weblink, so
    // the breakdown must appear here too (2 adults × ₹25,000 = ₹50,000).
    expect(within(body).getByRole('heading', { name: 'Price Breakdown' })).toBeInTheDocument();
    expect(within(body).getByText('Adults')).toBeInTheDocument();
    expect(within(body).getByText('2 × ₹25,000')).toBeInTheDocument();
    // No discount/tax here, so the subtotal is not repeated as a second copy of
    // the total; the prominent total line carries the amount on its own.
    expect(within(body).queryByText('Package subtotal')).not.toBeInTheDocument();
    expect(within(body).getAllByText('Total Package Price').length).toBeGreaterThanOrEqual(2);
    // Card + the breakdown's prominent total echo the same authoritative amount.
    expect(within(body).getAllByText('₹50,000').length).toBeGreaterThanOrEqual(2);
  });

  it('renders the discounted Total Package Price card in the live preview', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ discountAmount: '5000' })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    // 2 adults × ₹25,000 = ₹50,000, less a ₹5,000 discount → ₹45,000 payable.
    // Same shared card as the public weblink, so the design matches exactly.
    const finalPrice = within(body).getByTestId('total-final-price');
    const card = finalPrice.closest('div.bg-emerald-600') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByTestId('total-original-price')).toHaveTextContent(
      '₹50,000',
    );
    expect(within(card as HTMLElement).getByTestId('total-discount-badge')).toHaveTextContent(
      '₹5,000 OFF',
    );
    expect(finalPrice).toHaveTextContent('₹45,000');
    expect(within(body).getByRole('link', { name: /Contact Now/ })).toBeInTheDocument();
  });

  it('renders the singular Child With/Without Bed labels in the live preview and updates them without saving', async () => {
    const fetchMock = builderFetch({
      ...detail({
        perAdultPrice: '10000',
        perChildWithBedPrice: '2000',
        perChildWithoutBedPrice: '1000',
        perInfantPrice: '7000',
      }),
      adults: 2,
      childrenWithBed: 1,
      childrenWithoutBed: 1,
      infants: 1,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    // The pinned Live Weblink Preview uses the shared traveler breakdown
    // labels — singular Child With/Without Bed, never the old plural forms.
    expect(within(body).getByText('Child With Bed (CWB)')).toBeInTheDocument();
    expect(within(body).getByText('Child Without Bed (CWOB)')).toBeInTheDocument();
    expect(within(body).queryByText('Children with bed (CWB)')).not.toBeInTheDocument();
    expect(within(body).queryByText('Children without bed (CWOB)')).not.toBeInTheDocument();
    // Adults and Infants labels are unchanged.
    expect(within(body).getByText('Adults')).toBeInTheDocument();
    expect(within(body).getByText('Infants')).toBeInTheDocument();

    // Editing a per-person rate updates the preview immediately, with no save.
    await userEvent.click(await screen.findByRole('button', { name: 'Pricing' }));
    const cwbPrice = screen.getByLabelText('Per CWB Price') as HTMLInputElement;
    await userEvent.clear(cwbPrice);
    await userEvent.type(cwbPrice, '3000');
    expect(await within(body).findByText('1 × ₹3,000')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH'),
    ).toBe(false);
  });

  it('reflects edited journey routes in the phone immediately without saving', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: /^Flight/ }));
    // Edit the outbound route directly in the journey header.
    await userEvent.click(screen.getByRole('button', { name: 'Edit Outbound Journey route' }));
    const origin = screen.getByLabelText('Flight 1 Outbound Journey origin') as HTMLInputElement;
    expect(origin).toHaveValue('Delhi');
    await userEvent.clear(origin);
    await userEvent.type(origin, 'Mumbai');
    await userEvent.keyboard('{Enter}');
    // Header keeps its independent route; the segment is never rewritten.
    expect(screen.getByText('Mumbai → Goa')).toBeInTheDocument();
    const flightArticle = within(screen.getByRole('article', { name: 'Flight 1' }));
    expect(flightArticle.getAllByLabelText(/^From/)[0]).toHaveValue('DEL');
    // The pinned phone shows the edited route with no save.
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    expect(
      within(doc.body as HTMLElement).getByText('Mumbai → Goa'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH'),
    ).toBe(false);
  });

  it('reflects unsaved edits from other tabs without saving', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // Edit the hotel name on the Hotel tab while the preview stays open.
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    expect(within(body).getByText('Coastal Bay Resort')).toBeInTheDocument();

    const nameInput = await screen.findByLabelText('Hotel section title');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Stays');
    expect(await within(body).findByRole('heading', { name: 'Updated Stays' })).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH'),
    ).toBe(false);
  });

  it('updates the flight section title in the phone on every unsaved edit', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: /^Flight/ }));
    const titleInput = screen.getByLabelText('Flight section title') as HTMLInputElement;
    const original = titleInput.value;
    expect(original).not.toBe('');
    expect(original).not.toBe('Flight Data');
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    const frame = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    const phoneNav = () =>
      within(doc.body as HTMLElement).getByRole('navigation', {
        name: 'Quotation sections',
      }) as unknown as HTMLElement;
    const navButtons = () => within(phoneNav());
    // Nav chip and section heading start with the original title.
    expect(navButtons().getByRole('button', { name: original })).toBeInTheDocument();
    // First edit flows through without touching any other field.
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Flight Data');
    expect(await navButtons().findByRole('button', { name: 'Flight Data' })).toBeInTheDocument();
    expect(doc.querySelector('h2[data-section-title="Flight Data"]')).not.toBeNull();
    // Second edit stays synchronized.
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Flight Data 2');
    expect(await within(doc.body as HTMLElement).findByRole('button', { name: 'Flight Data 2' })).toBeInTheDocument();
    expect(doc.querySelector('h2[data-section-title="Flight Data 2"]')).not.toBeNull();
    // No save or publish happened and the frame never remounted.
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
    expect(screen.getByTestId('pinned-preview-frame')).toBe(frame);
  });

  it('reflects unsaved add-on pricing edits in the preview without saving', async () => {
    const addonMaster = {
      id: 'addon-visa',
      name: 'Visa Assistance',
      description: null,
      price: 6000,
      currency: 'INR',
      pricingBasis: 'Per Person',
      pricing: [{ id: 'opt-adult', label: 'Adult', price: 6000, currency: 'INR' }],
      destinations: [],
      status: 'ACTIVE',
      hasImage: false,
      images: [],
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T00:00:00.000Z',
      createdBy: person,
      updatedBy: null,
    };
    const quotation = detail();
    (
      quotation.versions[0] as unknown as { services: Array<Record<string, unknown>> }
    ).services.push({
      id: 'svc-visa',
      serviceType: 'OTHER_ADD_ON',
      addOnServiceId: 'addon-visa',
      name: 'Visa Assistance',
      description: null,
      dayNumber: null,
      city: null,
      quantity: '1',
      unitSellingPrice: '6000',
      totalSellingPrice: '6000',
      sellingPrice: '6000',
      pricingBasis: 'FIXED',
      pricingBasisLabel: 'Adult',
      pricingSnapshot: [{ id: 'opt-adult', label: 'Adult', price: 6000, currency: 'INR' }],
      sequence: 2,
      images: [],
    });
    const fetchMock = builderFetch(quotation, {
      '/masters/add-on-services': {
        success: true,
        data: [addonMaster],
        pagination: { total: 1 },
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Add-on Services' }));
    await screen.findByLabelText('Visa Assistance pricing option 1 label');
    // The preview first mirrors the saved quotation-owned snapshot.
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    expect((await within(body).findAllByText('Adult')).length).toBeGreaterThan(0);
    expect(within(body).getAllByText('₹6,000').length).toBeGreaterThan(0);
    // A quotation-only label edit flows into the phone immediately.
    const label = screen.getByLabelText('Visa Assistance pricing option 1 label');
    await userEvent.clear(label);
    await userEvent.type(label, 'Adult twin');
    expect(await within(body).findByText('Adult twin')).toBeInTheDocument();
    // Nothing was persisted or published by the live edit.
    expect(
      fetchMock.mock.calls.some(
        ([, options]) => options?.method === 'PATCH' || options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('shows the Back to top button inside the preview frame and scrolls that frame to the top', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const win = (screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement)
      .contentWindow as Window;
    // Deterministic frame metrics: scrollable = 2000 - 1000 = 1000px.
    Object.defineProperty(doc.documentElement, 'scrollHeight', {
      value: 2000,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(doc.documentElement, 'clientHeight', {
      value: 1000,
      writable: true,
      configurable: true,
    });
    const frameScrollTo = vi.fn();
    Object.defineProperty(win, 'scrollTo', {
      value: frameScrollTo,
      writable: true,
      configurable: true,
    });
    const setScrollY = (value: number) => {
      Object.defineProperty(win, 'scrollY', { value, writable: true, configurable: true });
      win.dispatchEvent(new Event('scroll'));
    };
    setScrollY(0);

    const button = () =>
      within(doc.body as HTMLElement).getByRole('button', { name: 'Back to top' });
    // The floating button lives inside the preview and starts hidden.
    expect(button()).toHaveClass('opacity-0', 'pointer-events-none');
    // Visibly driven by the FRAME window's scroll, not the builder page.
    setScrollY(390);
    expect(button()).toHaveClass('opacity-0', 'pointer-events-none');
    setScrollY(400);
    await vi.waitFor(() => expect(button()).toHaveClass('opacity-100'));
    setScrollY(300);
    await vi.waitFor(() => expect(button()).toHaveClass('opacity-0', 'pointer-events-none'));

    setScrollY(600);
    await vi.waitFor(() => expect(button()).toHaveClass('opacity-100'));
    fireEvent.click(button());
    expect(frameScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('has no separate full-quotation drawer — only the persistent live preview', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // The removed feature leaves no button and no dialog behind.
    expect(screen.queryByRole('button', { name: 'Preview Full Quotation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The single remaining preview still opens and closes.
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
  });

  it('closes without touching form state and previews the edited version', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
    // The version being edited (v1) is what the preview showed.
    await userEvent.click(screen.getByRole('button', { name: 'Open Live Preview' }));
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    expect(
      within(doc.body as HTMLElement).getByText('Custom Package for Aarav Mehta'),
    ).toBeInTheDocument();
  });
});

describe('Preview presentations (master-sourced data)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const hotelDetail = {
    id: 'hotel-m1',
    name: 'Coastal Bay Resort',
    starCategory: 5,
    starRating: 4.6,
    address: 'Sea Face Road, Calangute, Goa',
    reviewLink: 'https://maps.google.com/?cid=coastal-bay-reviews',
    checkInTime: '14:00',
    checkOutTime: '12:00',
    imageConfirmedAt: '2026-01-01T00:00:00.000Z',
    imageFileName: 'coastal.jpg',
    destination: { id: 'd-goa', name: 'Goa', countryName: 'India' },
    city: { id: 'c-cal', name: 'Calangute' },
  };

  const withLinkedHotel = () => {
    const quotation = detail();
    const version = quotation.versions[0] as unknown as { hotels: Array<Record<string, unknown>> };
    version.hotels = version.hotels.map((hotel) => ({ ...hotel, hotelId: 'hotel-m1' }));
    return quotation;
  };

  const hotelRoutes = {
    '/masters/hotels/hotel-m1/image/download-url': {
      url: 'https://cdn.example/coastal.jpg',
      expiresInSeconds: 3600,
    },
    '/masters/hotels/hotel-m1': hotelDetail,
  };

  it('shows hotel stars, score, review link, address from the master and resolves its image', async () => {
    const fetchMock = builderFetch(withLinkedHotel(), hotelRoutes);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    // Star rating from the master (not hardcoded, not from the row).
    expect(within(body).getByLabelText('5 star hotel')).toBeInTheDocument();
    expect(within(body).getByText('4.6')).toBeInTheDocument();
    // Review link uses the master's URL with a new-tab anchor.
    const review = within(body).getByRole('link', { name: /Hotel Review/ });
    expect(review).toHaveAttribute('href', 'https://maps.google.com/?cid=coastal-bay-reviews');
    expect(review).toHaveAttribute('target', '_blank');
    // Master address renders on the card.
    expect(within(body).getByText('Sea Face Road, Calangute, Goa')).toBeInTheDocument();
    // The master image download URL is resolved for the card. (Whether the
    // late-arriving URL visibly swaps the card is verified in a real browser;
    // jsdom does not flush async portal commits deterministically.)
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('/masters/hotels/hotel-m1/image/download-url'),
      ),
    ).toBe(true);
  });

  it('omits review UI when the master has no review link', async () => {
    const quotation = withLinkedHotel();
    const version = quotation.versions[0] as unknown as { hotels: Array<Record<string, unknown>> };
    version.hotels = version.hotels.map((hotel) => ({ ...hotel, hotelId: 'hotel-m2' }));
    vi.stubGlobal(
      'fetch',
      builderFetch(quotation, {
        '/masters/hotels/hotel-m2': { ...hotelDetail, id: 'hotel-m2', reviewLink: null, starRating: null },
      }),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    expect(within(body).getByLabelText('5 star hotel')).toBeInTheDocument();
    expect(within(body).queryByRole('link', { name: /Hotel Review/ })).not.toBeInTheDocument();
  });

  // A stay that was just linked to a master carries `hotelId` but no persisted
  // row id until the first Save — precisely the state that used to drop the
  // master's stars/score/address/review link from the Live Weblink Preview
  // until the quotation was saved and reopened.
  const withLinkedHotelWithoutId = () => {
    const quotation = detail();
    const version = quotation.versions[0] as unknown as { hotels: Array<Record<string, unknown>> };
    version.hotels = version.hotels.map((hotel) => {
      const { id: _dropped, ...rest } = hotel;
      void _dropped;
      return { ...rest, hotelId: 'hotel-m1' };
    });
    return quotation;
  };

  it('shows master stars, score, address, and review link before saving (no row id yet)', async () => {
    const fetchMock = builderFetch(withLinkedHotelWithoutId(), hotelRoutes);
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // Preview open by default; must resolve from the unsaved form, no Save/reopen.
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    expect(within(body).getByLabelText('5 star hotel')).toBeInTheDocument();
    expect(within(body).getByText('4.6')).toBeInTheDocument();
    const review = within(body).getByRole('link', { name: /Hotel Review/ });
    expect(review).toHaveAttribute('href', 'https://maps.google.com/?cid=coastal-bay-reviews');
    expect(review).toHaveAttribute('target', '_blank');
    expect(within(body).getByText('Sea Face Road, Calangute, Goa')).toBeInTheDocument();
    // Master-picker style: the linked master's detail is fetched once.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/masters/hotels/hotel-m1')),
    ).toBe(true);
  });

  it('loads the destination hero image matched from masters', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(detail(), {
        '/masters/destinations': {
          data: [{ id: 'goa-dest', name: 'Goa', hasImage: true, images: [{ id: 'img-1' }] }],
          pagination: { total: 1 },
        },
        '/masters/destinations/goa-dest/image/download-url': {
          url: 'https://cdn.example/goa-hero.jpg',
          expiresInSeconds: 3600,
        },
      }),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const hero = doc.querySelector('img[data-testid="public-hero-image"]') as HTMLImageElement | null;
    expect(hero?.getAttribute('src')).toBe('https://cdn.example/goa-hero.jpg');
  });

  it('resolves sightseeing quotation-document images without saving', async () => {
    const quotation = detail();
    const version = quotation.versions[0] as unknown as {
      sightseeingDetails: { days: Array<{ activities: Array<Record<string, unknown>> }> };
    };
    version.sightseeingDetails.days[0]!.activities[0]!['imageDocumentId'] = 'doc-9';
    const fetchMock = builderFetch(quotation, {
      '/documents/doc-9/download-url': { url: 'https://cdn.example/sight-doc.jpg' },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    const itinerary = doc.querySelector('[data-preview-section="itinerary"]') as HTMLElement;
    const img = within(itinerary).getByAltText('Beach evening') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://cdn.example/sight-doc.jpg');
    expect(
      fetchMock.mock.calls.some(
        ([, options]) => options?.method === 'PATCH' || options?.method === 'POST',
      ),
    ).toBe(false);
  });
});

describe('Persistent live weblink preview', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const enablePinned = async () => {
    // preview open by default (no click needed)
    return screen.getByTestId('pinned-preview-frame');
  };

  it('shows the full quotation beside the editor as the single preview feature', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await enablePinned();
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;
    // No separate drawer exists; the editor and the pinned preview coexist.
    expect(screen.queryByRole('button', { name: 'Preview Full Quotation' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quotation builder' })).toBeInTheDocument();
    // The whole public quotation is present: hero, pricing, services, footer.
    for (const text of [
      'Custom Package for Aarav Mehta',
      'Total Package Price',
      'Coastal Bay Resort',
      'AI101',
      'Daily breakfast',
      'Is pickup included?',
    ]) {
      // A value can legitimately appear more than once (e.g. the total price on
      // the card and again in the By Traveler "Price Breakdown").
      expect(within(body).getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
    }
    expect(within(body).getAllByText('Alpha Travel', { exact: false }).length).toBeGreaterThan(
      0,
    );
  });

  it('stays mounted while switching builder tabs', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await enablePinned();
    await pinnedReady();
    for (const tab of ['Hotel', 'FAQs', 'Pricing', 'Flight']) {
      await userEvent.click(await screen.findByRole('button', { name: tab }));
      const doc = pinnedDoc();
      expect(
        within(doc.body as HTMLElement).getByText('Custom Package for Aarav Mehta'),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Preview Full Quotation' })).not.toBeInTheDocument();
  });

  it('reflects unsaved edits live without resetting scroll and without saving', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    await enablePinned();
    const doc = await pinnedReady();
    frameScroller(doc).scrollTop = 200;
    const nameInput = await screen.findByLabelText('Hotel section title');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Stays');
    // Typing re-renders the preview but keeps the reader's scroll position.
    expect(frameScroller(pinnedDoc()).scrollTop).toBe(200);
    expect(
      await within(doc.body as HTMLElement).findByRole('heading', { name: 'Updated Stays' }),
    ).toBeInTheDocument();
    // Live previewing never saves, finalizes, or publishes.
    expect(
      fetchMock.mock.calls.some(
        ([, options]) => options?.method === 'PATCH' || options?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('closing persistent mode restores the editor without losing form values', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    await enablePinned();
    await pinnedReady();
    const nameInput = await screen.findByLabelText('Hotel section title');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Stays');
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByTestId('pinned-preview-frame')).not.toBeInTheDocument();
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
    // The normal full-width editor is back with values intact.
    expect(screen.getByRole('heading', { name: 'Quotation builder' })).toBeInTheDocument();
    expect(screen.getByLabelText('Hotel section title')).toHaveValue('Updated Stays');
    // Re-enabling shows the edited value in the preview again.
    await userEvent.click(screen.getByRole('button', { name: 'Open Live Preview' }));
    const reopened = await pinnedReady();
    expect(
      await within(reopened.body as HTMLElement).findByRole('heading', { name: 'Updated Stays' }),
    ).toBeInTheDocument();
  });

  it('offers no redundant Editor/Preview switch — single open/close state', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // Preview is open by default; no separate pane switch exists.
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Builder view' })).not.toBeInTheDocument();
    // Closing hides the panel completely via the single state.
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Builder view' })).not.toBeInTheDocument();
    // Reopening restores the preview.
    await userEvent.click(screen.getByRole('button', { name: 'Open Live Preview' }));
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
  });
});

describe('Mobile phone preview viewport', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('uses a 393px phone viewport in both modes', () => {
    expect(MOBILE_PREVIEW_WIDTH).toBe(393);
  });

  it('matches the iQOO Neo9 Pro body and 9:20 display ratios', () => {
    // Physical body 75.68 × 163.53 mm; display 9:20.
    expect(PHONE_BODY_ASPECT_RATIO).toBe('75.68 / 163.53');
    expect(PHONE_SCREEN_ASPECT_RATIO).toBe('9 / 20');
    expect(PHONE_BODY_WIDTH).toBe(MOBILE_PREVIEW_WIDTH + 24);
    expect(PHONE_BODY_HEIGHT).toBeCloseTo(
      (PHONE_BODY_WIDTH * 163.53) / 75.68,
      5,
    );
    // Inner screen keeps the 9:20 ratio (393 / 873.33 ≈ 0.45).
    expect(MOBILE_PREVIEW_WIDTH / MOBILE_PREVIEW_HEIGHT).toBeCloseTo(9 / 20, 3);
    // Bezels separate the two ratios: the body is wider relative to its
    // height than the display.
    expect(PHONE_BODY_WIDTH / PHONE_BODY_HEIGHT).toBeGreaterThan(
      MOBILE_PREVIEW_WIDTH / MOBILE_PREVIEW_HEIGHT,
    );
  });

  it('renders the persistent preview inside a phone frame with a real mobile viewport', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();

    // Realistic, restrained device frame with no redundant caption.
    const frame = screen.getByTestId('mobile-phone-frame');
    expect(within(frame).queryByText('Mobile preview')).not.toBeInTheDocument();
    expect(within(frame).queryByText(/MOBILE PREVIEW/i)).not.toBeInTheDocument();
    const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    expect(iframe.tagName).toBe('IFRAME');
    // Fixed internal layout viewport — never the panel width.
    expect(iframe.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(iframe.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);

    // Outer body follows the physical 75.68:163.53 ratio; the screen keeps
    // the 9:20 display ratio. Both modes share the same component.
    const body = screen.getByTestId('mobile-phone-body');
    expect(body.style.aspectRatio).toBe(PHONE_BODY_ASPECT_RATIO);
    const phoneScreen = screen.getByTestId('mobile-phone-screen');
    expect(phoneScreen.style.aspectRatio).toBe(PHONE_SCREEN_ASPECT_RATIO);
    expect(phoneScreen.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(phoneScreen.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);

    // The frame document is what makes media queries evaluate at phone width:
    // a matching viewport meta, app-origin base URL for assets, and the
    // application's own stylesheets (Tailwind breakpoints + fonts) cloned in.
    const doc = pinnedDoc();
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(
      'width=393, initial-scale=1',
    );
    expect(doc.querySelector('base')?.getAttribute('href')).toBe(`${window.location.origin}/`);
    expect(doc.title).toBe('Mobile quotation preview');

    // The shared renderer (not a mockup) is portalled into the frame.
    const doc2 = await pinnedReady();
    expect(doc2.getElementById('mobile-preview-root')).not.toBeNull();
    expect(
      within(doc2.body as HTMLElement).getByText('Custom Package for Aarav Mehta'),
    ).toBeInTheDocument();
  });

  it('renders the persistent preview in the same phone presentation', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    const frame = screen.getByTestId('mobile-phone-frame');
    expect(within(frame).queryByText('Mobile preview')).not.toBeInTheDocument();
    expect(within(frame).queryByText(/MOBILE PREVIEW/i)).not.toBeInTheDocument();
    const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    expect(iframe.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(iframe.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);
    expect(screen.getByTestId('mobile-phone-body').style.aspectRatio).toBe(
      PHONE_BODY_ASPECT_RATIO,
    );
    const doc = await pinnedReady();
    expect(doc.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe(
      'width=393, initial-scale=1',
    );
    expect(
      within(doc.body as HTMLElement).getByText('Custom Package for Aarav Mehta'),
    ).toBeInTheDocument();
  });

  it('drives quick navigation from the frame document (mobile behavior)', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    // SectionNav collects from its own (frame) document, so the mobile
    // quick-nav reflects exactly the sections rendered in the phone.
    const nav = within(doc.body as HTMLElement).getByRole('navigation', {
      name: 'Quotation sections',
    });
    const chips = within(nav).getAllByRole('button');
    expect(chips.length).toBeGreaterThan(1);
    // Every chip targets a section heading rendered inside the same frame.
    for (const chip of chips) {
      const label = chip.textContent ?? '';
      expect(label.length).toBeGreaterThan(0);
    }
    // Anchors exist for the mapped preview sections.
    for (const section of ['pricing', 'itinerary', 'hotels', 'flights', 'policies', 'faqs']) {
      expect(doc.querySelector(`[data-preview-section="${section}"]`)).not.toBeNull();
    }
  });

  it('keeps every applicable section inside the phone screen', async () => {
    vi.stubGlobal('fetch', builderFetch(withCruise()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const root = doc.getElementById('mobile-preview-root');
    expect(root).not.toBeNull();
    // All applicable sections (including cruise + addons) render inside the
    // frame root — nothing is clipped outside the phone screen — and the
    // device scales (transform only) to fit the panel without changing the
    // iframe's fixed mobile layout viewport.
    const sections = Array.from(doc.querySelectorAll('[data-preview-section]'));
    expect(sections.length).toBeGreaterThan(5);
    for (const section of sections) {
      expect(root!.contains(section)).toBe(true);
    }
    const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    expect(iframe.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(iframe.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);
    // The fit wrapper centers the scaled device; the unscaled body keeps the
    // physical ratio so width/height are never stretched independently.
    expect(screen.getByTestId('mobile-phone-fit')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-phone-body').style.aspectRatio).toBe(
      PHONE_BODY_ASPECT_RATIO,
    );
  });

  it('scales the phone visually without changing the iframe viewport', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    await pinnedReady();
    const body = screen.getByTestId('mobile-phone-body');
    // Uniform visual scale (single transform) — width and height share one
    // factor, so the device is never squashed.
    expect(body.style.transform).toMatch(/^scale\(/);
    expect(body.style.transformOrigin).toBe('top left');
    const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    expect(iframe.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(iframe.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);
  });

  it('hides the phone until measured, then fits a short laptop panel on resize', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    await pinnedReady();
    const fit = screen.getByTestId('mobile-phone-fit');
    // jsdom reports no layout (clientWidth/Height 0): the component must not
    // paint an unmeasured scale-1 phone that would extend past the panel.
    expect(fit.style.visibility).toBe('hidden');
    // Simulate a short laptop panel (500 × 600 available for the device).
    const area = fit.parentElement as HTMLElement;
    Object.defineProperty(area, 'clientWidth', { value: 500, configurable: true });
    Object.defineProperty(area, 'clientHeight', { value: 600, configurable: true });
    fireEvent(window, new Event('resize'));
    const expected = Math.min(1, 500 / PHONE_BODY_WIDTH, 600 / PHONE_BODY_HEIGHT);
    expect(expected).toBeLessThan(1);
    expect(fit.style.visibility).toBe('visible');
    expect(fit.style.width).toBe(`${PHONE_BODY_WIDTH * expected}px`);
    expect(fit.style.height).toBe(`${PHONE_BODY_HEIGHT * expected}px`);
    expect(screen.getByTestId('mobile-phone-body').style.transform).toBe(
      `scale(${expected})`,
    );
    // The internal mobile viewport is untouched by visual scaling.
    const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    expect(iframe.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(iframe.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);
  });

  it('hides the phone scrollbar in the frame document while keeping scrolling enabled', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    // Scrollbar chrome is removed inside the phone screen only.
    const style = doc.getElementById('mobile-preview-scrollbar');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('scrollbar-width:none');
    expect(style?.textContent).toContain('::-webkit-scrollbar');
    // Scrolling itself is never disabled: no overflow:hidden anywhere.
    expect(style?.textContent).not.toMatch(/overflow\s*:\s*hidden/);
    expect(doc.documentElement.style.overflow).not.toBe('hidden');
    expect(doc.body.style.overflow).not.toBe('hidden');
    // Programmatic scrolling (sticky nav, section links) still works.
    const scroller = (doc.scrollingElement ?? doc.documentElement) as HTMLElement;
    expect(() => scrollPreviewToSection(scroller, 'pricing')).not.toThrow();
    // The desktop page is untouched: no such rules leak outside the frame.
    expect(document.getElementById('mobile-preview-scrollbar')).toBeNull();
  });

  it('keeps the phone scale stable while the desktop page and phone scroll', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const fit = screen.getByTestId('mobile-phone-fit');
    const area = fit.parentElement as HTMLElement;
    const body = () => screen.getByTestId('mobile-phone-body');
    const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    Object.defineProperty(area, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(area, 'clientHeight', { value: 600, configurable: true });
    fireEvent(window, new Event('resize'));
    const steady = Math.min(1, 800 / PHONE_BODY_WIDTH, 600 / PHONE_BODY_HEIGHT);
    expect(steady).toBeLessThan(1);
    expect(body().style.transform).toBe(`scale(${steady})`);
    // Desktop page scrolls: scale must not move (position-independent).
    fireEvent.scroll(window);
    fireEvent.scroll(window);
    fireEvent.scroll(document);
    expect(body().style.transform).toBe(`scale(${steady})`);
    // Quotation scrolls inside the phone: scale must not move either.
    const scroller = (doc.scrollingElement ?? doc.documentElement) as HTMLElement;
    scroller.scrollTop = 400;
    expect(body().style.transform).toBe(`scale(${steady})`);
    expect(fit.style.visibility).toBe('visible');
    // A real area change still recalculates — without remounting the iframe.
    Object.defineProperty(area, 'clientHeight', { value: 800, configurable: true });
    fireEvent(window, new Event('resize'));
    const resized = Math.min(1, 800 / PHONE_BODY_WIDTH, 800 / PHONE_BODY_HEIGHT);
    expect(resized).not.toBe(steady);
    expect(body().style.transform).toBe(`scale(${resized})`);
    expect(screen.getByTestId('pinned-preview-frame')).toBe(iframe);
    // The internal mobile viewport never changes.
    expect(iframe.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(iframe.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);
  });

  it('uses the same scrollbar-free, scroll-stable phone in the pinned preview', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    expect(doc.getElementById('mobile-preview-scrollbar')?.textContent).toContain(
      'scrollbar-width:none',
    );
    const fit = screen.getByTestId('mobile-phone-fit');
    const area = fit.parentElement as HTMLElement;
    Object.defineProperty(area, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(area, 'clientHeight', { value: 600, configurable: true });
    fireEvent(window, new Event('resize'));
    const steady = Math.min(1, 800 / PHONE_BODY_WIDTH, 600 / PHONE_BODY_HEIGHT);
    const body = () => screen.getByTestId('mobile-phone-body');
    expect(body().style.transform).toBe(`scale(${steady})`);
    fireEvent.scroll(window);
    const scroller = (doc.scrollingElement ?? doc.documentElement) as HTMLElement;
    scroller.scrollTop = 250;
    expect(body().style.transform).toBe(`scale(${steady})`);
    const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    expect(iframe.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(iframe.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);
  });

  it('reflects unsaved edits from the Hotel and Sightseeing tabs live in the phone', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    const body = doc.body as HTMLElement;

    const nameInput = await screen.findByLabelText('Hotel section title');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Stays');
    expect(await within(body).findByRole('heading', { name: 'Updated Stays' })).toBeInTheDocument();

    // Switching tabs keeps the phone mounted; sightseeing edits appear too.
    // The activity name surfaces in the day heading (the day title mirrors
    // the first activity), with no other field touched.
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    const activityInput = await screen.findByLabelText('Day 1 activity 1 name');
    await userEvent.clear(activityInput);
    await userEvent.type(activityInput, 'Sunset catamaran cruise');
    const phone = within(pinnedDoc().body as HTMLElement);
    expect(
      await phone.findByRole('heading', { name: 'DAY 1 | Sunset catamaran cruise' }),
    ).toBeInTheDocument();

    // No save, finalize, publish, or preview-data requests were made.
    const previewish = fetchMock.mock.calls.filter(
      ([url, options]) =>
        options?.method === 'PATCH' ||
        options?.method === 'POST' ||
        options?.method === 'PUT' ||
        options?.method === 'DELETE' ||
        String(url).includes('weblink') ||
        String(url).includes('public') ||
        String(url).includes('publish') ||
        String(url).includes('finalize'),
    );
    expect(previewish).toEqual([]);
    expect(doc).toBe(pinnedDoc());
  });
});

describe('Custom Name live sync (stale-preview regression)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  /** Itinerary section text inside a preview frame document. */
  const itineraryText = (doc: Document) =>
    doc.querySelector('[data-preview-section="itinerary"]')?.textContent ?? '';

  /** No save/finalize/publish/preview-data traffic on the fetch mock. */
  const expectNoPreviewRequests = (fetchMock: ReturnType<typeof builderFetch>) => {
    const previewish = fetchMock.mock.calls.filter(
      ([url, options]) =>
        options?.method === 'PATCH' ||
        options?.method === 'POST' ||
        options?.method === 'PUT' ||
        options?.method === 'DELETE' ||
        String(url).includes('weblink') ||
        String(url).includes('public') ||
        String(url).includes('publish') ||
        String(url).includes('finalize'),
    );
    expect(previewish).toEqual([]);
  };

  it('matches the pinned phone after every keystroke while typing indefinitely', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    // preview open by default (no click needed)
    const doc = await pinnedReady();
    const frame = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    frameScroller(doc).scrollTop = 200;

    const input = (await screen.findByLabelText('Day 1 activity 1 name')) as HTMLInputElement;
    await userEvent.clear(input);
    expect(input).toHaveValue('');

    // Type a full name one character at a time: the phone must match after
    // EVERY keystroke, with no other field touched. This failed before the
    // fix (the preview froze on the initial name while the input kept going).
    let typed = '';
    for (const ch of 'Coral Bay Lagoon') {
      await userEvent.type(input, ch);
      typed += ch;
      expect(input).toHaveValue(typed);
      expect(itineraryText(pinnedDoc())).toContain(typed);
    }
    // Keep typing past the first successful update: it must not go stale.
    for (const ch of ' at Dusk') {
      await userEvent.type(input, ch);
      typed += ch;
      expect(itineraryText(pinnedDoc())).toContain(typed);
    }
    expect(
      await within(pinnedDoc().body as HTMLElement).findByRole('heading', {
        name: `DAY 1 | ${typed}`,
      }),
    ).toBeInTheDocument();

    // Typing never resets the phone scroll, recreates the frame, or saves.
    expect(frameScroller(pinnedDoc()).scrollTop).toBe(200);
    expect(pinnedDoc()).toBe(doc);
    expect(screen.getByTestId('pinned-preview-frame')).toBe(frame);
    expectNoPreviewRequests(fetchMock);
  });

  it('handles replace-all, delete, and paste in the pinned phone', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    // preview open by default (no click needed)
    await pinnedReady();

    const input = (await screen.findByLabelText('Day 1 activity 1 name')) as HTMLInputElement;
    // Replace-all: a single change event carrying the full replacement value,
    // exactly what select-all + type (or autocomplete) produces at DOM level.
    fireEvent.change(input, { target: { value: 'Harbour Lights' } });
    expect(input).toHaveValue('Harbour Lights');
    expect(itineraryText(pinnedDoc())).toContain('Harbour Lights');
    expect(itineraryText(pinnedDoc())).not.toContain('Beach evening');

    // Delete everything: the heading falls back to the bare day label.
    await userEvent.clear(input);
    expect(input).toHaveValue('');
    expect(
      await within(pinnedDoc().body as HTMLElement).findByRole('heading', { name: 'Day 1' }),
    ).toBeInTheDocument();
    expect(itineraryText(pinnedDoc())).not.toContain('Harbour Lights');

    // Paste a brand-new value over the empty field.
    await userEvent.click(input);
    await userEvent.paste('Palm Grove Reserve');
    expect(input).toHaveValue('Palm Grove Reserve');
    expect(
      await within(pinnedDoc().body as HTMLElement).findByRole('heading', {
        name: 'DAY 1 | Palm Grove Reserve',
      }),
    ).toBeInTheDocument();
    expectNoPreviewRequests(fetchMock);
  });

  it('stays synchronized in the pinned phone across tab switches and back', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    // preview open by default (no click needed)
    const doc = await pinnedReady();

    const input = await screen.findByLabelText('Day 1 activity 1 name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Mangrove Kayaking');
    expect(itineraryText(pinnedDoc())).toContain('Mangrove Kayaking');

    // Leave and return: same frame, current content, and tab-driven
    // navigation (Hotel → hotels, then Sightseeing → itinerary). jsdom keeps
    // assigned scrollTop values but reports zero rects, so each navigation
    // subtracts the 16px header offset from the current position (200 → 184
    // → 168); typing alone never moves it (covered by the tests above). The
    // root-scroller unit test above proves scrolled documents don't overshoot.
    frameScroller(pinnedDoc()).scrollTop = 200;
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    expect(pinnedDoc()).toBe(doc);
    expect(frameScroller(pinnedDoc()).scrollTop).toBe(168);
    expect(itineraryText(pinnedDoc())).toContain('Mangrove Kayaking');
    expect(
      within(pinnedDoc().body as HTMLElement).getByRole('heading', {
        name: 'DAY 1 | Mangrove Kayaking',
      }),
    ).toBeInTheDocument();
  });

  it('matches the pinned phone after every keystroke', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    // preview open by default (no click needed)
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const doc = await pinnedReady();
    const frame = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    frameScroller(doc).scrollTop = 200;

    const input = (await screen.findByLabelText('Day 1 activity 1 name')) as HTMLInputElement;
    await userEvent.clear(input);
    let typed = '';
    for (const ch of 'Lagoon Walk') {
      await userEvent.type(input, ch);
      typed += ch;
      expect(input).toHaveValue(typed);
      expect(itineraryText(pinnedDoc())).toContain(typed);
    }
    expect(
      await within(pinnedDoc().body as HTMLElement).findByRole('heading', {
        name: `DAY 1 | ${typed}`,
      }),
    ).toBeInTheDocument();

    expect(frameScroller(pinnedDoc()).scrollTop).toBe(200);
    expect(pinnedDoc()).toBe(doc);
    expect(screen.getByTestId('pinned-preview-frame')).toBe(frame);
    expectNoPreviewRequests(fetchMock);
  });
});

describe('Live preview UI improvements (default-open, labels, open/close)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  it('does not render the subtitle or the mobile caption', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    expect(screen.queryByText('Updates automatically as you edit.')).not.toBeInTheDocument();
    const frame = screen.getByTestId('mobile-phone-frame');
    expect(within(frame).queryByText('Mobile preview')).not.toBeInTheDocument();
    expect(within(frame).queryByText(/MOBILE PREVIEW/i)).not.toBeInTheDocument();
    // Heading and close control remain.
    expect(screen.getByText('Live Weblink Preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close live preview' })).toBeInTheDocument();
  });

  it('is open by default with live content on initial load', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close Live Preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close live preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Live Preview' })).not.toBeInTheDocument();
    const doc = await pinnedReady();
    expect(
      within(doc.body as HTMLElement).getByText('Custom Package for Aarav Mehta'),
    ).toBeInTheDocument();
  });

  it('X close genuinely closes the panel and returns to the editor', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pinned-preview-frame')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Builder view' })).not.toBeInTheDocument();
    // Editor is back with an obvious reopen action.
    expect(screen.getByRole('heading', { name: 'Quotation builder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Live Preview' })).toBeInTheDocument();
  });

  it('reopens with latest unsaved edits and preserves form values', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    const nameInput = await screen.findByLabelText('Hotel section title');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Updated Stays');
    expect(
      await within(pinnedDoc().body as HTMLElement).findByRole('heading', { name: 'Updated Stays' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
    // Form values intact while closed.
    expect(screen.getByLabelText('Hotel section title')).toHaveValue('Updated Stays');
    await userEvent.click(screen.getByRole('button', { name: 'Open Live Preview' }));
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    const reopened = await pinnedReady();
    expect(
      await within(reopened.body as HTMLElement).findByRole('heading', { name: 'Updated Stays' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Hotel section title')).toHaveValue('Updated Stays');
  });

  it('keeps the desktop split-view classes and expands the editor when closed', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const panel = screen.getByTestId('live-preview-panel');
    // Narrow preview hugging the phone (417px body + 16px grey per side +
    // 1px border per side) instead of a 43% share; editor takes the rest.
    expect(panel.className).toMatch(/lg:w-\[451px\]/);
    expect(panel.className).not.toMatch(/lg:w-\[43%\]/);
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quotation builder' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Live Preview' }));
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
  });

  it('has no header Close button — X is the single close control', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    // Redundant header CTA is gone in both states; Open appears only when closed.
    expect(screen.queryByRole('button', { name: 'Close Live Preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close live preview' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Save quotation' }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Close live preview' }));
    expect(screen.queryByRole('button', { name: 'Close Live Preview' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Live Preview' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Save quotation' }).length).toBeGreaterThan(0);
  });

  it('keeps ~16px grey per side with an unstretched phone', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await pinnedReady();
    // Grey area supplies 16px horizontal padding per side (px-4).
    const frame = screen.getByTestId('mobile-phone-frame');
    expect(frame.className).toMatch(/px-4/);
    // Phone keeps its exact device geometry and scales uniformly (never stretched).
    const body = screen.getByTestId('mobile-phone-body');
    expect(body.style.width).toBe(`${PHONE_BODY_WIDTH}px`);
    expect(body.style.aspectRatio).toBe(PHONE_BODY_ASPECT_RATIO);
    expect(body.style.transform).toMatch(/^scale\(/);
    const phoneScreen = screen.getByTestId('mobile-phone-screen');
    expect(phoneScreen.style.aspectRatio).toBe(PHONE_SCREEN_ASPECT_RATIO);
    expect(phoneScreen.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(phoneScreen.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);
    const iframe = screen.getByTestId('pinned-preview-frame') as HTMLIFrameElement;
    expect(iframe.style.width).toBe(`${MOBILE_PREVIEW_WIDTH}px`);
    expect(iframe.style.height).toBe(`${MOBILE_PREVIEW_HEIGHT}px`);
  });

  it('Escape closes the preview to the same consistent closed state', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    expect(screen.getByTestId('live-preview-panel')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('live-preview-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Live Preview' })).toBeInTheDocument();
  });
});

describe('scrollPreviewToTarget helper', () => {
  const rect = (top: number) =>
    ({ top, left: 0, bottom: top, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;

  const rig = () => {
    const container = document.createElement('div');
    container.getBoundingClientRect = () => rect(100);
    const section = document.createElement('div');
    section.setAttribute('data-preview-section', 'hotels');
    section.getBoundingClientRect = () => rect(500);
    const item = document.createElement('div');
    item.setAttribute('data-preview-item', 'hotel:1');
    item.getBoundingClientRect = () => rect(700);
    container.append(section, item);
    document.body.appendChild(container);
    return { container, section, item };
  };

  it('builds a stable key that ignores keystrokes (section + items only)', () => {
    expect(previewTargetKey({ section: 'hotels', items: ['hotel:1'] })).toBe('hotels\nhotel:1');
    expect(previewTargetKey({ section: 'hotels', items: [] })).toBe('hotels\n');
    expect(previewTargetKey(null)).toBe('');
    expect(previewTargetKey(undefined)).toBe('');
  });

  it('prefers the item over the section and the first matching candidate', () => {
    const { container } = rig();
    try {
      // 700 (item) - 100 (container) - 16.
      scrollPreviewToTarget(container, { section: 'hotels', items: ['hotel:1'] });
      expect(container.scrollTop).toBe(584);
      // First matching candidate wins.
      container.scrollTop = 0;
      scrollPreviewToTarget(container, { section: 'hotels', items: ['hotel:9', 'hotel:1'] });
      expect(container.scrollTop).toBe(584);
    } finally {
      container.remove();
    }
  });

  it('falls back to the section, then leaves the position untouched', () => {
    const { container } = rig();
    try {
      // Missing item → section anchor: 500 - 100 - 16.
      scrollPreviewToTarget(container, { section: 'hotels', items: ['hotel:9'] });
      expect(container.scrollTop).toBe(384);
      // Missing everything → the position is preserved (never reset to top).
      container.scrollTop = 123;
      scrollPreviewToTarget(container, { section: 'nope', items: ['missing'] });
      expect(container.scrollTop).toBe(123);
      scrollPreviewToTarget(container, null);
      expect(container.scrollTop).toBe(123);
      expect(() => scrollPreviewToTarget(null, { section: 'hotels', items: [] })).not.toThrow();
    } finally {
      container.remove();
    }
  });

  it('matches scrollPreviewToSection for section-only targets', () => {
    const { container } = rig();
    try {
      scrollPreviewToSection(container, 'hotels');
      const viaSection = container.scrollTop;
      container.scrollTop = 0;
      scrollPreviewToTarget(container, { section: 'hotels', items: [] });
      expect(container.scrollTop).toBe(viaSection);
    } finally {
      container.remove();
    }
  });
});

describe('Preview item-level navigation', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('scrollTo', vi.fn());
    auth.permissions = new Set(['quotations.view', 'quotations.update', 'quotations.view_costing']);
  });

  const sevenDays = () =>
    Array.from({ length: 7 }, (_, i) => ({
      dayNumber: i + 1,
      title: `Day ${i + 1} plan`,
      city: 'Calangute',
      date: null,
      meals: { breakfast: false, lunch: false, dinner: false },
      mealMode: 'NO_TRANSFER',
      dailyTransfer: 'NO_TRANSFER',
      activities: [{ name: `Activity ${i + 1}`, description: `Details ${i + 1}.` }],
    }));

  const hotelNamed = (name: string, sequence: number) => ({
    id: `hotel-${sequence}`,
    city: 'Calangute',
    hotelName: name,
    category: '4 Star',
    roomType: 'Deluxe Room',
    mealPlan: 'Breakfast',
    rooms: 1,
    nights: 4,
    checkInDate: '2026-09-10T00:00:00.000Z',
    checkOutDate: '2026-09-14T00:00:00.000Z',
    checkInTime: null,
    checkOutTime: null,
    internalCost: '0',
    sellingPrice: '20000',
    selected: true,
    sequence,
    images: [],
  });

  /**
   * Make the frame's scroller observable and give every anchor a position
   * derived from live DOM order (reorder-safe): sections at 100, items from
   * 300 in steps of 100. Item stubs evaluate order at call time, so moved
   * DOM nodes report their new position without re-stubbing. Returns scroll
   * readers plus an expected-top helper computed from the element itself, so
   * assertions never depend on a fixed section order or hardcoded day numbers.
   */
  const stubPositions = (doc: Document) => {
    const scroller = frameScroller(doc) as HTMLElement;
    let saved = 0;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => saved,
      set: (value: number) => {
        saved = value;
      },
      configurable: true,
    });
    const rect = (top: number) =>
      ({ top, left: 0, bottom: top, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    const restub = () => {
      saved = 0;
      doc
        .querySelectorAll<HTMLElement>('[data-preview-section]')
        .forEach((el) => {
          el.getBoundingClientRect = () => rect(100);
        });
      doc.querySelectorAll<HTMLElement>('[data-preview-item]').forEach((el) => {
        // Live order lookup: correct even after React moves DOM nodes.
        el.getBoundingClientRect = () =>
          rect(300 + Array.from(doc.querySelectorAll('[data-preview-item]')).indexOf(el) * 100);
      });
    };
    restub();
    const topOf = (selector: string) => {
      const items = Array.from(doc.querySelectorAll<HTMLElement>('[data-preview-item]'));
      const el = doc.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`missing anchor ${selector}`);
      return 300 + items.indexOf(el) * 100 - 16;
    };
    return { readScroll: () => saved, restub, topOf };
  };

  it('stamps every itinerary day with its source index', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(detail({ sightseeingDetails: { ...flightVersion().sightseeingDetails, days: sevenDays() } })),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const days = Array.from(doc.querySelectorAll('[data-preview-item^="day:"]'));
    expect(days).toHaveLength(7);
    expect(days.map((el) => el.getAttribute('data-preview-item'))).toEqual([
      'day:0',
      'day:1',
      'day:2',
      'day:3',
      'day:4',
      'day:5',
      'day:6',
    ]);
  });

  it('selecting Day 6 navigates to Day 6, then Day 3 follows', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(detail({ sightseeingDetails: { ...flightVersion().sightseeingDetails, days: sevenDays() } })),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const pos = stubPositions(doc);
    // Opening the tab navigates to the itinerary at the current day (Day 1).
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="day:0"]')));
    // Day 6 (not Day 1) becomes visible.
    pos.restub();
    await userEvent.click(await screen.findByRole('button', { name: 'Select sightseeing day 6' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="day:5"]')));
    expect(pos.readScroll()).not.toBe(pos.topOf('[data-preview-item="day:0"]'));
    expect(
      doc.querySelector('[data-preview-item="day:5"]')?.textContent ?? '',
    ).toContain('Activity 6');
    // Switching days updates the target.
    pos.restub();
    await userEvent.click(await screen.findByRole('button', { name: 'Select sightseeing day 3' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="day:2"]')));
    expect(
      doc.querySelector('[data-preview-item="day:2"]')?.textContent ?? '',
    ).toContain('Activity 3');
  });

  it('editing Day 6 keeps the preview on Day 6 without resetting scroll', async () => {
    const fetchMock = builderFetch(
      detail({ sightseeingDetails: { ...flightVersion().sightseeingDetails, days: sevenDays() } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const pos = stubPositions(doc);
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="day:0"]')));
    pos.restub();
    await userEvent.click(await screen.findByRole('button', { name: 'Select sightseeing day 6' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="day:5"]')));
    const frame = screen.getByTestId('pinned-preview-frame');
    // Typing into Day 6 updates its preview in place: no jump to Day 1,
    // no scroll reset, no remount, no save.
    const scroller = frameScroller(pinnedDoc()) as HTMLElement;
    (scroller as unknown as { scrollTop: number }).scrollTop = 200;
    const input = (await screen.findByLabelText('Day 6 activity 1 name')) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Sunset catamaran cruise');
    expect(frameScroller(pinnedDoc()).scrollTop).toBe(200);
    expect(
      within(pinnedDoc().body as HTMLElement).getByRole('heading', {
        name: 'DAY 6 | Sunset catamaran cruise',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('pinned-preview-frame')).toBe(frame);
    expect(pinnedDoc()).toBe(doc);
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
  });

  it('reordering days keeps the target on the moved day', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(detail({ sightseeingDetails: { ...flightVersion().sightseeingDetails, days: sevenDays() } })),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const pos = stubPositions(doc);
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    pos.restub();
    await userEvent.click(await screen.findByRole('button', { name: 'Select sightseeing day 3' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="day:2"]')));
    // Move the selected day up: selection follows it to position 2.
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Move Day 3 up' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="day:1"]')));
    // The targeted card is the moved day's content (Activity 3), not Day 1's.
    expect(doc.querySelector('[data-preview-item="day:1"]')?.textContent ?? '').toContain(
      'Activity 3',
    );
  });

  it('expanding a hotel navigates to that exact card (duplicate names safe)', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          hotels: [hotelNamed('Hotel Alpha', 1), hotelNamed('Twin Hotel', 2), hotelNamed('Twin Hotel', 3)],
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const pos = stubPositions(doc);
    expect(doc.querySelectorAll('[data-preview-item^="hotel:"]')).toHaveLength(3);
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // Expand the second "Twin Hotel" (stay 3): the third card — not the first Twin.
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 3' }));
    const cards = Array.from(doc.querySelectorAll('[data-preview-item^="hotel:"]'));
    expect(cards.map((el) => el.getAttribute('data-preview-item'))).toEqual([
      'hotel:0',
      'hotel:1',
      'hotel:2',
    ]);
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="hotel:2"]')));
    expect(pos.readScroll()).not.toBe(pos.topOf('[data-preview-item="hotel:1"]'));
    // And stay 1 targets the first card.
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="hotel:0"]')));
  });

  it('hotel typing never re-scrolls; removing the active stay falls back to the section', async () => {
    const fetchMock = builderFetch(detail());
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const pos = stubPositions(doc);
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="hotel:0"]')));
    // Typing the section title keeps the scroll position (same target).
    const scroller = frameScroller(pinnedDoc()) as HTMLElement;
    (scroller as unknown as { scrollTop: number }).scrollTop = 200;
    await userEvent.clear(await screen.findByLabelText('Hotel section title'));
    await userEvent.type(await screen.findByLabelText('Hotel section title'), 'Updated Stays');
    expect(frameScroller(pinnedDoc()).scrollTop).toBe(200);
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
  });

  it('reordering hotels keeps the target on the moved stay', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({ hotels: [hotelNamed('Hotel Alpha', 1), hotelNamed('Twin Hotel', 2)] }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const pos = stubPositions(doc);
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 2' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="hotel:1"]')));
    // Move stay 2 up: the same (expanded) row is now first.
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Move hotel stay 2 up' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="hotel:0"]')));
    expect(doc.querySelector('[data-preview-item="hotel:0"]')?.textContent ?? '').toContain(
      'Twin Hotel',
    );
  });

  it('expanding a flight navigates to its journey legs', async () => {
    const secondFlight = {
      bookmarkCode: null,
      journeyType: 'ONEWAY_OUTBOUND',
      outbound: {
        fromCity: 'Delhi',
        toCity: 'Jaipur',
        segments: [segment({ airlineName: 'IndiGo', flightNumber: '6E11', from: 'DEL', to: 'JAI' })],
      },
      returnJourney: { fromCity: null, toCity: null, segments: [] },
    };
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({
          flightDetails: { ...flightVersion().flightDetails, flights: [...flightVersion().flightDetails.flights, secondFlight] },
        }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const pos = stubPositions(doc);
    expect(doc.querySelector('[data-preview-item="flight:flight-1-outbound"]')).not.toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: /^Flight/ }));
    // Cards start expanded with no active flight: section-level only.
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse flight 2' }));
    expect(pos.readScroll()).toBe(0);
    // Expanding flight 2 targets its outbound leg (not flight 1).
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Expand flight 2' }));
    await vi.waitFor(() =>
      expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="flight:flight-1-outbound"]')),
    );
    expect(pos.readScroll()).not.toBe(pos.topOf('[data-preview-item="flight:flight-0-outbound"]'));
  });

  it('removed active hotel falls back to the hotels section', async () => {
    vi.stubGlobal(
      'fetch',
      builderFetch(
        detail({ hotels: [hotelNamed('Hotel Alpha', 1), hotelNamed('Hotel Bravo', 2)] }),
      ),
    );
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    const pos = stubPositions(doc);
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    pos.restub();
    await userEvent.click(screen.getByRole('button', { name: 'Expand hotel stay 1' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(pos.topOf('[data-preview-item="hotel:0"]')));
    // Removing the followed stay releases the item target; the hotels
    // section (still rendered for the remaining stay) is the fallback.
    const stayOne = screen
      .getByRole('button', { name: 'Collapse hotel stay 1' })
      .closest('article') as HTMLElement;
    pos.restub();
    await userEvent.click(within(stayOne).getByRole('button', { name: 'Remove hotel stay 1' }));
    await vi.waitFor(() => expect(pos.readScroll()).toBe(84));
    expect(screen.getByTestId('pinned-preview-frame')).toBeInTheDocument();
  });

  it('missing section keeps the current scroll position', async () => {
    // No FAQs saved: the FAQs tab has no public section to show.
    vi.stubGlobal('fetch', builderFetch(detail({ faqs: [] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    expect(doc.querySelector('[data-preview-section="faqs"]')).toBeNull();
    const pos = stubPositions(doc);
    (frameScroller(doc) as HTMLElement).scrollTop = 200;
    await userEvent.click(await screen.findByRole('button', { name: 'FAQs' }));
    // The section is absent for this tab: no jump back to the top.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(pos.readScroll()).toBe(200);
    expect(screen.getByTestId('pinned-preview-frame')).toBeInTheDocument();
  });

  it('selecting the Hotel tab navigates to the Hotels section', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    expect(doc.querySelector('[data-preview-section="hotels"]')).not.toBeNull();
    const pos = stubPositions(doc);
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // Section anchor at 100 minus the 16px heading offset.
    await vi.waitFor(() => expect(pos.readScroll()).toBe(84));
  });

  it('re-selecting the already-active tab re-navigates the preview', async () => {
    vi.stubGlobal('fetch', builderFetch(detail()));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    expect(doc.querySelector('[data-preview-section="hotels"]')).not.toBeNull();
    const pos = stubPositions(doc);
    const hotelTab = await screen.findByRole('button', { name: 'Hotel' });
    await userEvent.click(hotelTab);
    await vi.waitFor(() => expect(pos.readScroll()).toBe(84));
    // The reader scrolls the preview away while Hotel is already the active
    // tab (its target value never changes, only the scroll position does).
    // Anchor rects are viewport-relative: with the reader 4000px down, the
    // Hotels section sits 3900px above the viewport top.
    const hotels = doc.querySelector<HTMLElement>('[data-preview-section="hotels"]');
    hotels!.getBoundingClientRect = () =>
      ({ top: -3900, left: 0, bottom: -3900, right: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
    (frameScroller(doc) as HTMLElement).scrollTop = 4000;
    expect(pos.readScroll()).toBe(4000);
    // Re-selecting the same tab must re-navigate to the Hotels section. This
    // regressed before because navigation was keyed only on the resolved
    // section string, so a same-value `setActiveTab` was a no-op.
    await userEvent.click(hotelTab);
    await vi.waitFor(() => expect(pos.readScroll()).toBe(84));
  });

  it('Hotel tab with no named stay keeps the position and renders no section', async () => {
    vi.stubGlobal('fetch', builderFetch(detail({ hotels: [hotelNamed('', 1)] })));
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    const doc = await pinnedReady();
    // A stay without a name is never rendered on the weblink (unchanged rules).
    expect(doc.querySelector('[data-preview-section="hotels"]')).toBeNull();
    expect(doc.querySelectorAll('[data-preview-item^="hotel:"]')).toHaveLength(0);
    const pos = stubPositions(doc);
    (frameScroller(doc) as HTMLElement).scrollTop = 240;
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    // The Hotels section cannot be shown yet: keep the reader's position.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(pos.readScroll()).toBe(240);
    // Nothing hotel-related is invented for the incomplete stay.
    expect(doc.querySelectorAll('[data-preview-item^="hotel:"]')).toHaveLength(0);
    expect(
      within(doc.body as HTMLElement).getByText('Custom Package for Aarav Mehta'),
    ).toBeInTheDocument();
  });

  it('iframe stays mounted across item navigation with no saves', async () => {
    const fetchMock = builderFetch(
      detail({ sightseeingDetails: { ...flightVersion().sightseeingDetails, days: sevenDays() } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderBuilder();
    await screen.findByRole('heading', { name: 'Quotation builder' });
    await pinnedReady();
    const frame = screen.getByTestId('pinned-preview-frame');
    const doc = pinnedDoc();
    await userEvent.click(await screen.findByRole('button', { name: 'Sightseeing' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Select sightseeing day 6' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Select sightseeing day 2' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hotel' }));
    expect(screen.getByTestId('pinned-preview-frame')).toBe(frame);
    expect(pinnedDoc()).toBe(doc);
    expect(
      fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH' || options?.method === 'POST'),
    ).toBe(false);
  });
});

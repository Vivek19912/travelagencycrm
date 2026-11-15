import { describe, expect, it } from 'vitest';
import { applyPreviewExclusions, buildFullPreviewData, nextAvailablePreviewSection, previewSectionForBuilderTab } from './FullQuotationPreview';

const baseVersion = (overrides: Record<string, unknown> = {}) => ({
  hotelDetails: { include: true, sectionTitle: 'Your Hotels' },
  sightseeingDetails: { include: true, days: [] },
  flightDetails: { include: true, entryMode: 'MANUAL', flights: [] },
  addOnDetails: { include: true },
  services: [
    { id: 'c1', serviceType: 'CRUISE', name: 'Ocean Cruise' },
    { id: 'v1', serviceType: 'VEHICLE_TRANSFER', name: 'Van' },
  ],
  hotels: [{ hotelName: 'Sea View' }],
  ...overrides,
});

describe('preview exclusion + tab mapping regressions', () => {
  it('maps pricingBreakdown to pricing (Bug 1 gap)', () => {
    expect(previewSectionForBuilderTab('pricingBreakdown')).toBe('pricing');
    expect(previewSectionForBuilderTab('summary')).toBe('pricing');
    expect(previewSectionForBuilderTab('setting')).toBeNull();
  });

  it('hides excluded cruise/vehicle/hotel preview-only without mutating form', () => {
    const form = {
      hotelDetails: { include: true },
      services: [
        { serviceType: 'CRUISE', name: 'C' },
        { serviceType: 'VEHICLE_TRANSFER', name: 'V' },
        { serviceType: 'OTHER_ADD_ON', name: 'X', addOnServiceId: 'a1' },
      ],
      hotels: [{ hotelName: 'H' }],
      sightseeingDetails: { include: true, days: [] },
      flightDetails: { include: true, entryMode: 'MANUAL', flights: [] },
      addOnDetails: { include: true },
    } as never;
    const before = JSON.stringify(form);
    const version = baseVersion() as never;
    const data = buildFullPreviewData({
      quotation: { destinationSummary: 'Goa' } as never,
      savedVersion: version,
      form,
      flightPreviewUrls: {},
      excluded: { cruise: true, vehicle: true, hotel: true },
    });
    const v = data.version as unknown as Record<string, unknown>;
    expect((v.services as unknown[]).length).toBe(1);
    expect((v.hotelDetails as { include: boolean }).include).toBe(false);
    expect(JSON.stringify(form)).toBe(before);
  });

  it('applyPreviewExclusions preserves data and only flips flags', () => {
    const version = baseVersion();
    const out = applyPreviewExclusions(version, { hotel: true }) as typeof version & {
      hotelDetails: { include: boolean };
    };
    expect(out.hotelDetails.include).toBe(false);
    expect(version.hotelDetails).toMatchObject({ include: true });
    expect(out.services).toHaveLength(2);
  });
});

describe('nextAvailablePreviewSection fallback', () => {
  // Default weblink order: services, itinerary, hotels, flights,
  // transportation, cruise, addons, visa, policies, destinationExpert, faqs
  // (pricing renders separately above them all).
  const order = [
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
  ];

  it('returns null when nothing needs a fallback', () => {
    const visible = ['pricing', 'services', 'itinerary', 'hotels', 'flights'];
    expect(nextAvailablePreviewSection('hotels', visible, order)).toBeNull();
    expect(nextAvailablePreviewSection(null, visible, order)).toBeNull();
    expect(nextAvailablePreviewSection('hotels', [], order)).toBeNull();
  });

  it('navigates to the next available visible section', () => {
    const visible = ['pricing', 'services', 'itinerary', 'flights', 'policies', 'faqs'];
    // transportation excluded → cruise/addons/visa absent → policies.
    expect(nextAvailablePreviewSection('transportation', visible, order)).toBe('policies');
    // hotels excluded → flights.
    expect(nextAvailablePreviewSection('hotels', visible, order)).toBe('flights');
  });

  it('navigates to the nearest previous section when nothing follows', () => {
    const visible = ['pricing', 'services', 'itinerary', 'hotels', 'flights'];
    // faqs excluded and nothing visible after it → policies absent →
    // destinationExpert absent → falls back through to flights.
    expect(nextAvailablePreviewSection('faqs', visible, order)).toBe('flights');
    // addons excluded with nothing after it visible → previous cruise absent,
    // transportation absent → flights.
    expect(nextAvailablePreviewSection('addons', visible, order)).toBe('flights');
  });

  it('never navigates to excluded, unknown, or nonexistent sections', () => {
    const visible = ['pricing', 'services'];
    expect(nextAvailablePreviewSection('transportation', visible, order)).toBe('services');
    expect(nextAvailablePreviewSection('nope', visible, order)).toBeNull();
    expect(nextAvailablePreviewSection('hotels', ['pricing'], order)).toBe('pricing');
  });
});

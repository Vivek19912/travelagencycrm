import { describe, expect, it } from 'vitest';
import {
  hotelRateForDate,
  buildHotelDestinationIndex,
  collectHotelDestinationIds,
  expandDefaultHotelRows,
  isHotelRowEmpty,
  matchDefaultHotels,
  resolveHotelRowCity,
  resolveItineraryStayCity,
  type HotelInputRow,
} from './QuotationBuilderPage';

type Master = Parameters<typeof matchDefaultHotels>[1][number];

function master(
  id: string,
  name: string,
  city: string,
  destination: string,
  isDefaultForCity = true,
  status = 'ACTIVE',
  destinationId = `dest-${destination.trim().toLowerCase().replace(/\s+/g, '-')}`,
): Master {
  return {
    id,
    name,
    status,
    isDefaultForCity,
    starCategory: 5,
    city: { name: city },
    destination: { id: destinationId, name: destination },
    images: [],
  };
}

function leadRow(city: string, overrides: Record<string, unknown> = {}): HotelInputRow {
  return {
    city,
    hotelId: null,
    hotelName: '',
    checkInDate: new Date('2026-10-01'),
    checkOutDate: new Date('2026-10-04'),
    nights: 3,
    rooms: 2,
    ...overrides,
  } as unknown as HotelInputRow;
}

const singaporeDefaults = [
  master('h-a', 'Hotel A', 'Singapore', 'Singapore'),
  master('h-b', 'Hotel B', 'Singapore', 'Singapore'),
  master('h-c', 'Hotel C', 'Singapore', 'Singapore'),
  master('h-d', 'Hotel D', 'Singapore', 'Singapore'),
];

describe('matchDefaultHotels', () => {
  it('returns [] when the destination has no defaults', () => {
    expect(matchDefaultHotels('Singapore', [master('h-x', 'Hotel X', 'Singapore', 'Singapore', false)])).toEqual([]);
    expect(matchDefaultHotels('', singaporeDefaults)).toEqual([]);
  });

  it('returns every default of the destination sorted by name', () => {
    const matched = matchDefaultHotels('Singapore', [...singaporeDefaults].reverse());
    expect(matched.map((h) => h.name)).toEqual(['Hotel A', 'Hotel B', 'Hotel C', 'Hotel D']);
  });

  it('never mixes in defaults from other destinations (exact match only)', () => {
    const masters: Master[] = [
      ...singaporeDefaults,
      master('h-dxb', 'Dubai Grand', 'Dubai', 'Dubai'),
      master('h-gapore', 'Singapore View Resort', 'Sentosa', 'Sentosa'),
    ];
    const matched = matchDefaultHotels('Singapore', masters);
    expect(matched.map((h) => h.id).sort()).toEqual(['h-a', 'h-b', 'h-c', 'h-d']);
  });

  it('prefers city-tier matches but still includes destination-tier matches once', () => {
    const masters: Master[] = [
      master('h-city', 'City Hotel', 'Udaipur', 'Rajasthan'),
      master('h-dest', 'Desert Camp', 'Jaisalmer', 'Rajasthan'),
    ];
    // Row city equals a hotel city: city-tier match comes first.
    expect(matchDefaultHotels('Udaipur', masters).map((h) => h.id)).toEqual(['h-city']);
    // Row city equals the destination name: destination-tier matches.
    expect(matchDefaultHotels('Rajasthan', masters).map((h) => h.id)).toEqual(['h-city', 'h-dest']);
  });

  it('excludes inactive and non-default hotels', () => {
    const masters: Master[] = [
      master('h-off', 'Closed Hotel', 'Singapore', 'Singapore', true, 'INACTIVE'),
      master('h-plain', 'Plain Hotel', 'Singapore', 'Singapore', false),
    ];
    expect(matchDefaultHotels('Singapore', masters)).toEqual([]);
  });
});

describe('isHotelRowEmpty — row-level prefill eligibility', () => {
  it('an untouched stay is eligible', () => {
    expect(isHotelRowEmpty(leadRow('Singapore'))).toBe(true);
  });

  it('selected, typed and priced rows are never eligible', () => {
    expect(isHotelRowEmpty(leadRow('Singapore', { hotelId: 'h-a' }))).toBe(false);
    expect(isHotelRowEmpty(leadRow('Singapore', { hotelName: 'Typed Hotel' }))).toBe(false);
    expect(isHotelRowEmpty(leadRow('Singapore', { hotelRoomTypeId: 'rt-1' }))).toBe(false);
    expect(isHotelRowEmpty(leadRow('Singapore', { roomType: 'Deluxe' }))).toBe(false);
    expect(isHotelRowEmpty(leadRow('Singapore', { sellingPrice: 5000 }))).toBe(false);
    expect(
      isHotelRowEmpty(
        leadRow('Singapore', {
          roomLines: [{ roomType: 'Deluxe', rooms: 1, sellingPrice: 100 }],
        }),
      ),
    ).toBe(false);
  });
});

describe('resolveItineraryStayCity / resolveHotelRowCity / collectHotelDestinationIds', () => {
  it('falls back to the destination when the lead city is blank', () => {
    expect(
      resolveItineraryStayCity({ destination: '', country: 'Singapore Heaven Delight' }),
    ).toBe('Singapore Heaven Delight');
    expect(resolveItineraryStayCity({ destination: 'Goa', country: 'Goa Region' })).toBe('Goa');
  });

  it('an empty stay inherits the current itinerary/destination context', () => {
    expect(resolveHotelRowCity({ city: '' }, 'Singapore')).toBe('Singapore');
    expect(resolveHotelRowCity({ city: 'Dubai' }, 'Singapore')).toBe('Dubai');
  });

  it('collects stable destination ids from itinerary, rows and summary', () => {
    const index = buildHotelDestinationIndex(singaporeDestinations);
    expect(
      collectHotelDestinationIds({
        index,
        itinerary: [{ destination: '', country: 'Singapore Heaven Delight', nights: 2 }],
        hotelCities: [],
        destinationSummary: '',
      }),
    ).toEqual([SG_DEST]);
    expect(
      collectHotelDestinationIds({
        index,
        itinerary: [],
        hotelCities: ['Dubai'],
        destinationSummary: '',
      }),
    ).toEqual([DUBAI_DEST]);
  });
});

// ---------------------------------------------------------------------------
// Destination-relationship matching (audit regression)
// ---------------------------------------------------------------------------

const SG_DEST = 'dest-sg-heaven-delight';
const DUBAI_DEST = 'dest-dubai';
const GOA_DEST = 'dest-goa';

/** Destination Master feed: each destination embeds its linked cities. */
const singaporeDestinations = [
  {
    id: SG_DEST,
    name: 'Singapore Heaven Delight',
    cities: [
      { city: { name: 'Singapore' } },
      { city: { name: 'Sentosa Island' } },
      { city: { name: 'Singapore Cruise' } },
      { city: { name: 'Marina Bay' } },
    ],
  },
  { id: DUBAI_DEST, name: 'Dubai', cities: [{ city: { name: 'Dubai' } }] },
  { id: GOA_DEST, name: 'GOA', cities: [{ city: { name: 'Baga' } }, { city: { name: 'Calanguate' } }] },
];

const singaporeIndex = buildHotelDestinationIndex(singaporeDestinations);

/** Mirrors the audited Hotel Master data: default scoped to the destination. */
const auditMasters: Master[] = [
  master('h-mercure', 'Mercure Singapore on Stevens', 'Singapore', 'Singapore Heaven Delight', true, 'ACTIVE', SG_DEST),
  master('h-boss', 'Hotel Boss Singapore', 'Singapore', 'Singapore Heaven Delight', false, 'ACTIVE', SG_DEST),
  master('h-disney', 'Disney Cruise', 'Singapore Cruise', 'Singapore Heaven Delight', false, 'ACTIVE', SG_DEST),
  master('h-burj', 'Burj View Hotel', 'Dubai', 'Dubai', true, 'ACTIVE', DUBAI_DEST),
];

describe('matchDefaultHotels — destination relationship', () => {
  it('1. matches a hotel whose city equals the itinerary city', () => {
    expect(matchDefaultHotels('Singapore', auditMasters, singaporeIndex).map((h) => h.id)).toEqual([
      'h-mercure',
    ]);
  });

  it('2/3. resolves a different itinerary city to the same destination default', () => {
    // "Singapore Cruise" is a city linked to the "Singapore Heaven Delight"
    // destination, so its default applies even though the names differ.
    expect(matchDefaultHotels('Singapore Cruise', auditMasters, singaporeIndex).map((h) => h.id)).toEqual([
      'h-mercure',
    ]);
    expect(matchDefaultHotels('Sentosa Island', auditMasters, singaporeIndex).map((h) => h.id)).toEqual([
      'h-mercure',
    ]);
  });

  it('4. never selects defaults from a different destination', () => {
    // A Dubai-scoped default must not leak into a Singapore destination city.
    expect(matchDefaultHotels('Sentosa Island', auditMasters, singaporeIndex).map((h) => h.id)).not.toContain(
      'h-burj',
    );
    expect(matchDefaultHotels('Baga', auditMasters, singaporeIndex)).toEqual([]);
  });

  it('does not resolve an unknown city to any destination', () => {
    expect(matchDefaultHotels('Somewhere Unknown', auditMasters, singaporeIndex)).toEqual([]);
  });
});

describe('expandDefaultHotelRows — audit regression', () => {
  it('REGRESSION: a cross-city stay within the same destination prefills the destination default', () => {
    // Before the fix this produced "Disney Cruise@Singapore Cruise" (an
    // unrelated alphabetical best-city guess) instead of the destination default.
    const rows = expandDefaultHotelRows([leadRow('Singapore Cruise')], auditMasters, singaporeIndex);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hotelId).toBe('h-mercure');
    expect(rows[0]?.hotelName).toBe('Mercure Singapore on Stevens');
    expect(rows[0]?.city).toBe('Singapore');
    expect(rows[0]?.nights).toBe(3);
    expect(rows[0]?.rooms).toBe(2);
  });

  it('5. an unresolved/ambiguous destination never inserts an unrelated alphabetical hotel', () => {
    // "Twin City" links to two destinations that have no defaults; an unrelated
    // alphabetical hotel in another destination must not be borrowed.
    const ambiguousIndex = buildHotelDestinationIndex([
      { id: 'dest-a', name: 'Alpha', cities: [{ city: { name: 'Twin City' } }] },
      { id: 'dest-b', name: 'Beta', cities: [{ city: { name: 'Twin City' } }] },
    ]);
    const masters: Master[] = [
      master('h-aaa', 'AAA Resort', 'Dubai', 'Dubai', true, 'ACTIVE', DUBAI_DEST),
    ];
    const rows = expandDefaultHotelRows([leadRow('Twin City')], masters, ambiguousIndex);
    expect(rows[0]?.hotelId).toBeNull();
    expect(rows[0]?.hotelName).toBe('');

    // A completely unknown free-text label also stays empty.
    const unknown = expandDefaultHotelRows([leadRow('Nowhere')], masters, ambiguousIndex);
    expect(unknown[0]?.hotelId).toBeNull();
  });

  it('6. a destination with no eligible default stays empty (no cross-city guess)', () => {
    const masters: Master[] = [
      master('h-boss', 'Hotel Boss Singapore', 'Singapore', 'Singapore Heaven Delight', false, 'ACTIVE', SG_DEST),
    ];
    // Sentosa Island resolves to the Singapore destination, which has no default
    // here; the row must not be filled with an unrelated hotel.
    const rows = expandDefaultHotelRows([leadRow('Sentosa Island')], masters, singaporeIndex);
    expect(rows[0]?.hotelId).toBeNull();
    expect(rows[0]?.hotelName).toBe('');
  });

  it('does not treat a cruise label as proof a hotel exists', () => {
    const masters: Master[] = [
      master('h-disney', 'Disney Cruise', 'Singapore Cruise', 'Singapore Heaven Delight', false, 'ACTIVE', SG_DEST),
    ];
    // No destination default and a cruise-style label → empty, never Disney Cruise.
    const rows = expandDefaultHotelRows([leadRow('Singapore Cruise')], masters, singaporeIndex);
    expect(rows[0]?.hotelId).toBeNull();
    expect(rows[0]?.hotelName).toBe('');
  });

  it('preserves the best-available-city fallback for a legitimate city with no default', () => {
    const masters: Master[] = [
      master('h-boss', 'Hotel Boss Singapore', 'Singapore', 'Singapore Heaven Delight', false, 'ACTIVE', SG_DEST),
    ];
    const rows = expandDefaultHotelRows([leadRow('Singapore')], masters, singaporeIndex);
    expect(rows[0]?.hotelId).toBe('h-boss');
    expect(rows[0]?.hotelName).toBe('Hotel Boss Singapore');
  });

  it('7. prefills ALL defaults of the destination, ordered by name', () => {
    const masters: Master[] = [
      master('h-b', 'Hotel B', 'Singapore', 'Singapore Heaven Delight', true, 'ACTIVE', SG_DEST),
      master('h-a', 'Hotel A', 'Singapore', 'Singapore Heaven Delight', true, 'ACTIVE', SG_DEST),
      master('h-c', 'Hotel C', 'Singapore', 'Singapore Heaven Delight', true, 'ACTIVE', SG_DEST),
    ];
    const rows = expandDefaultHotelRows([leadRow('Singapore Cruise')], masters, singaporeIndex);
    expect(rows.map((r) => r.hotelName)).toEqual(['Hotel A', 'Hotel B', 'Hotel C']);
    expect(rows.map((r) => r.city)).toEqual(['Singapore', 'Singapore', 'Singapore']);
  });

  it('8. saved rows are preserved by row-level eligibility (existing rows keep snapshots)', () => {
    // Row-level eligibility gates the caller: non-empty saved rows are never
    // rewritten, while genuinely empty rows stay eligible for a default.
    expect(isHotelRowEmpty(leadRow('Singapore'))).toBe(true);
    expect(isHotelRowEmpty(leadRow('Singapore', { hotelId: 'h-a', hotelName: 'Hotel A' }))).toBe(
      false,
    );
  });

  it('9. a default already present on a stay is not inserted again', () => {
    const masters: Master[] = [
      master('h-a', 'Hotel A', 'Singapore', 'Singapore Heaven Delight', true, 'ACTIVE', SG_DEST),
      master('h-b', 'Hotel B', 'Singapore', 'Singapore Heaven Delight', true, 'ACTIVE', SG_DEST),
    ];
    const rows = expandDefaultHotelRows(
      [leadRow('Singapore Cruise', { hotelId: 'h-a', hotelName: 'Hotel A' })],
      masters,
      singaporeIndex,
    );
    // h-a is already present → only the missing default h-b is added.
    expect(rows.map((r) => r.hotelId)).toEqual(['h-b']);
  });

  it('10. never duplicates a destination default across stays', () => {
    const masters: Master[] = [
      master('h-a', 'Hotel A', 'Singapore', 'Singapore Heaven Delight', true, 'ACTIVE', SG_DEST),
      master('h-b', 'Hotel B', 'Singapore', 'Singapore Heaven Delight', true, 'ACTIVE', SG_DEST),
    ];
    const rows = expandDefaultHotelRows(
      [leadRow('Singapore'), leadRow('Sentosa Island')],
      masters,
      singaporeIndex,
    );
    // The first stay expands both defaults; the second same-destination stay
    // maps to a single default and must NOT re-expand both again.
    expect(rows.map((r) => r.hotelId)).toEqual(['h-a', 'h-b', 'h-a']);
  });

  it('finds a default parked beyond the first 100 records (no 100-row window)', () => {
    // 150 unrelated non-default hotels ahead of the destination default: a
    // first-page-only fetch would never see it, but matching over the
    // destination-scoped pool resolves it.
    const filler: Master[] = Array.from({ length: 150 }, (_, i) =>
      master(`filler-${i}`, `Filler Hotel ${i}`, 'Nowhere City', 'Nowhere Land', false),
    );
    const target = master(
      'h-deep',
      'Deep Default Hotel',
      'Singapore',
      'Singapore Heaven Delight',
      true,
      'ACTIVE',
      SG_DEST,
    );
    expect(matchDefaultHotels('Singapore', [...filler, target], singaporeIndex)).toEqual([target]);
    expect(matchDefaultHotels('Sentosa Island', [...filler, target], singaporeIndex)).toEqual([
      target,
    ]);
  });

  it('keeps template/duplicated rows (master-linked with money) ineligible', () => {    expect(
      isHotelRowEmpty(
        leadRow('Singapore', { hotelId: 'tpl-1', hotelName: 'Template Hotel', sellingPrice: 8000 }),
      ),
    ).toBe(false);
    expect(
      isHotelRowEmpty(
        leadRow('Dubai', {
          hotelId: 'dup-1',
          hotelName: 'Duplicated Hotel',
          roomType: 'Deluxe',
          sellingPrice: 5000,
        }),
      ),
    ).toBe(false);
  });
});

describe('expandDefaultHotelRows — legacy behaviour', () => {
  it('8. prefills ALL defaults of the selected destination in a new quotation', () => {
    const rows = expandDefaultHotelRows([leadRow('Singapore')], singaporeDefaults);
    expect(rows.map((r) => r.hotelName)).toEqual(['Hotel A', 'Hotel B', 'Hotel C', 'Hotel D']);
    expect(rows.map((r) => r.hotelId)).toEqual(['h-a', 'h-b', 'h-c', 'h-d']);
    // Stay context inherited from the lead row.
    for (const row of rows) {
      expect(row.nights).toBe(3);
      expect(row.rooms).toBe(2);
      expect(row.city).toBe('Singapore');
    }
    // No copies of the same hotel.
    expect(new Set(rows.map((r) => r.hotelId)).size).toBe(4);
  });

  it('keeps the legacy single-row behavior when a destination has no defaults', () => {
    const rows = expandDefaultHotelRows(
      [leadRow('Nowhere')],
      [master('h-x', 'Hotel X', 'Singapore', 'Singapore', false)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hotelId).toBeNull();
    expect(rows[0]?.city).toBe('Nowhere');
  });

  it('9. multiple destinations prefill their own hotels without mixing', () => {
    const masters: Master[] = [
      ...singaporeDefaults.slice(0, 3),
      master('h-e', 'Hotel D', 'Dubai', 'Dubai'),
      master('h-f', 'Hotel E', 'Dubai', 'Dubai'),
      master('h-g', 'Hotel F', 'Kashmir', 'Kashmir'),
      master('h-h', 'Hotel G', 'Kashmir', 'Kashmir'),
      master('h-i', 'Hotel H', 'Kashmir', 'Kashmir'),
    ];
    const rows = expandDefaultHotelRows(
      [leadRow('Singapore'), leadRow('Dubai'), leadRow('Kashmir')],
      masters,
    );
    const byHotel = new Map(rows.map((r) => [r.hotelName, r.city]));
    expect(rows).toHaveLength(3 + 2 + 3);
    expect(byHotel.get('Hotel A')).toBe('Singapore');
    expect(byHotel.get('Hotel D')).toBe('Dubai');
    expect(byHotel.get('Hotel F')).toBe('Kashmir');
    // Every prefilled row belongs to a default of its own destination.
    for (const row of rows) {
      const hotel = masters.find((m) => m.id === row.hotelId)!;
      expect(hotel).toBeDefined();
      expect([hotel.city.name, hotel.destination.name]).toContain(row.city);
    }
  });

  it('10. a default hotel already present is not inserted again', () => {
    const rows = expandDefaultHotelRows(
      [leadRow('Singapore', { hotelId: 'h-b', hotelName: 'Hotel B' })],
      singaporeDefaults,
    );
    // h-b already present: the other three are added, h-b is not duplicated.
    expect(rows.map((r) => r.hotelId).sort()).toEqual(['h-a', 'h-c', 'h-d']);
  });

  it('keeps the stay when its destination is already fully covered', () => {
    const rows = expandDefaultHotelRows(
      [
        leadRow('Singapore', { hotelId: 'h-a', hotelName: 'Hotel A' }),
        leadRow('Singapore', { hotelId: 'h-b', hotelName: 'Hotel B' }),
        leadRow('Singapore', { hotelId: 'h-c', hotelName: 'Hotel C' }),
        leadRow('Singapore', { hotelId: 'h-d', hotelName: 'Hotel D' }),
        leadRow('Singapore'),
      ],
      singaporeDefaults,
    );
    // Four existing stays untouched; the extra stay maps once (legacy fallback).
    expect(rows).toHaveLength(5);
    expect(rows[4]?.hotelId).toBe('h-a');
  });

  it('11. prefill output is decoupled from masters (removing a row cannot unmark a master)', () => {
    const rows = expandDefaultHotelRows([leadRow('Singapore')], singaporeDefaults);
    rows.splice(0, 1);
    expect(singaporeDefaults).toHaveLength(4);
    expect(singaporeDefaults.every((m) => m.isDefaultForCity)).toBe(true);
  });

  it('returns [] for no rows and drops city-less rows like before', () => {
    expect(expandDefaultHotelRows([], singaporeDefaults)).toEqual([]);
    expect(expandDefaultHotelRows([leadRow('')], singaporeDefaults)).toEqual([]);
  });

  it('expands exactly 10 defaults for a full destination', () => {
    const masters: Master[] = Array.from({ length: 10 }, (_, i) =>
      master(`h-${i + 1}`, `Hotel ${i + 1}`, 'Singapore', 'Singapore'),
    );
    const rows = expandDefaultHotelRows([leadRow('Singapore')], masters);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.hotelId)).size).toBe(10);
  });
});

describe('hotelRateForDate — default price mapping (existing pricing rule)', () => {
  it('prefers the season rate covering the check-in date, else the base price', () => {
    const masterWithSeasons = {
      price: 6000,
      seasons: [
        { startDate: '2026-08-01', endDate: '2026-08-31', price: 7500 },
        { startDate: '2026-12-01', endDate: '2026-12-31', price: 9000 },
      ],
    };
    expect(hotelRateForDate(masterWithSeasons, '2026-08-10')).toBe(7500);
    expect(hotelRateForDate(masterWithSeasons, new Date('2026-12-15'))).toBe(9000);
    expect(hotelRateForDate(masterWithSeasons, '2026-10-01')).toBe(6000);
  });

  it('returns null when the master has no rate, never inventing a price', () => {
    expect(hotelRateForDate({}, '2026-08-10')).toBeNull();
    expect(hotelRateForDate({ price: 0 }, '2026-08-10')).toBeNull();
    expect(hotelRateForDate({ price: null }, '2026-08-10')).toBeNull();
  });
});

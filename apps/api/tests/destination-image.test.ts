import { describe, expect, it } from 'vitest';
import {
  dayDestinationFallbackKeys,
  destinationImageCandidates,
  fullImageNameCandidates,
  selectDestinationImageRecord,
} from '../src/modules/quotations/quotations.service.js';

/**
 * Destination-image resolution semantics.
 *
 * The lead itinerary's `country` field holds the Destination Master name
 * (e.g. "Malaysia") while `destination` holds the city (e.g. "Kuala Lumpur").
 * The image resolver must prefer the Master country so a Malaysia → Kuala Lumpur
 * quotation resolves the Malaysia Master image instead of searching for a
 * "Kuala Lumpur" Destination (which never exists).
 */
describe('destinationImageCandidates', () => {
  it('resolves Malaysia first for a Malaysia → Kuala Lumpur quotation', () => {
    const candidates = destinationImageCandidates('Kuala Lumpur', [
      { country: 'Malaysia', destination: 'Kuala Lumpur' },
    ]);
    // The Master country must be the primary lookup candidate, before the city.
    expect(candidates[0]).toBe('malaysia');
    expect(candidates).toContain('kuala lumpur');
  });

  it('resolves Singapore for a Singapore → Singapore quotation', () => {
    const candidates = destinationImageCandidates('Singapore', [
      { country: 'Singapore', destination: 'Singapore' },
    ]);
    expect(candidates[0]).toBe('singapore');
  });

  it('deduplicates repeated stays of the same Master country', () => {
    const candidates = destinationImageCandidates('Kuala Lumpur', [
      { country: 'Malaysia', destination: 'Kuala Lumpur' },
      { country: 'Malaysia', destination: 'Langkawi' },
    ]);
    expect(candidates.filter((c) => c === 'malaysia')).toHaveLength(1);
  });

  it('orders multiple Master countries in first-seen order (Malaysia → Singapore)', () => {
    const candidates = destinationImageCandidates('Kuala Lumpur', [
      { country: 'Malaysia', destination: 'Kuala Lumpur' },
      { country: 'Singapore', destination: 'Singapore' },
    ]);
    const idxMalaysia = candidates.indexOf('malaysia');
    const idxSingapore = candidates.indexOf('singapore');
    expect(idxMalaysia).toBeGreaterThanOrEqual(0);
    expect(idxSingapore).toBeGreaterThan(idxMalaysia);
  });

  it('falls back to the destination summary for legacy quotations with no country', () => {
    const candidates = destinationImageCandidates('Kuala Lumpur', [
      { country: null, destination: 'Kuala Lumpur' },
    ]);
    // Summary (Kuala Lumpur) comes before the city fallback.
    expect(candidates[0]).toBe('kuala lumpur');
  });

  it('returns an empty list when nothing is present', () => {
    expect(destinationImageCandidates('', [])).toEqual([]);
    expect(destinationImageCandidates(null, null)).toEqual([]);
  });
});

type ImageRow = Parameters<typeof selectDestinationImageRecord>[0][number];

function imageRow(
  id: string,
  name: string,
  imageObjectKey: string | null,
  imageFileName: string | null = 'destination.jpg',
): ImageRow {
  return { id, name, normalizedName: name.toLowerCase(), imageObjectKey, imageFileName };
}

const GOLD = 'companies/c1/destinations/old-vietnam/hero.jpg';
const GOLD_DANANG = 'companies/c1/destinations/da-nang/hero.jpg';
const SKY = 'companies/c1/destinations/vn-multi/hero.jpg';

function vietnamRows(): ImageRow[] {
  return [
    imageRow('dest-vietnam-old', 'Vietnam', GOLD),
    imageRow('dest-danang-old', 'Da Nang', GOLD_DANANG),
    imageRow(
      'dest-vn-multi',
      'Vietnam - Ho Chi Minh • Da Nang • Hanoi - 6 Nights',
      SKY,
    ),
  ];
}

describe('fullImageNameCandidates', () => {
  it('keeps whole strings so a long master name can match exactly', () => {
    expect(
      fullImageNameCandidates('Vietnam - Ho Chi Minh • Da Nang • Hanoi - 6 Nights', [
        { country: 'Vietnam', destination: 'Hanoi' },
      ]),
    ).toEqual([
      'vietnam - ho chi minh • da nang • hanoi - 6 nights',
      'vietnam',
      'hanoi',
    ]);
  });

  it('returns an empty list when nothing is present', () => {
    expect(fullImageNameCandidates('', [])).toEqual([]);
    expect(fullImageNameCandidates(null, null)).toEqual([]);
  });
});

describe('selectDestinationImageRecord', () => {
  it('prefers the full-name exact match over short fragments (reported bug)', () => {
    const selected = selectDestinationImageRecord(
      vietnamRows(),
      fullImageNameCandidates('Vietnam - Ho Chi Minh • Da Nang • Hanoi - 6 Nights', [
        { country: 'Vietnam', destination: 'Hanoi' },
      ]),
      ['vietnam', 'ho chi minh', 'da nang', 'hanoi - 6 nights', 'hanoi'],
    );
    // Before the fix only fragments were tried: "vietnam" exactly matched the
    // stale Vietnam record (Golden Bridge). The whole summary now matches the
    // current multi-city master (skyline) first.
    expect(selected?.imageObjectKey).toBe(SKY);
  });

  it('picks the most specific fuzzy match instead of heap order', () => {
    // No exact hit for "ho chi minh": both the tour row and the long record
    // contain it, so the longer (more specific) record wins — regardless of
    // the order rows come back from the database.
    const rows = [
      imageRow('dest-vietnam-old', 'Vietnam', GOLD),
      imageRow('dest-hcm-tour', 'Ho Chi Minh City Tour', 'companies/c1/tour.jpg'),
      imageRow(
        'dest-vn-multi',
        'Vietnam - Ho Chi Minh • Da Nang • Hanoi - 6 Nights',
        SKY,
      ),
    ];
    for (const order of [rows, [...rows].reverse()]) {
      const selected = selectDestinationImageRecord(order, [], ['ho chi minh']);
      expect(selected?.imageObjectKey).toBe(SKY);
    }
  });

  it('keeps candidate priority: an earlier exact hit beats a longer later hit', () => {
    // "vietnam" exactly matches the Vietnam record, so it wins even though a
    // longer fuzzy row exists — country-first semantics are preserved.
    const selected = selectDestinationImageRecord(
      vietnamRows(),
      [],
      ['vietnam', 'ho chi minh'],
    );
    expect(selected?.imageObjectKey).toBe(GOLD);
  });

  it('keeps Malaysia → Kuala Lumpur semantics (exact country wins)', () => {
    const rows = [
      imageRow('dest-my', 'Malaysia', 'companies/c1/destinations/my/hero.jpg'),
      imageRow('dest-my-kl', 'Malaysia - Kuala Lumpur City Tour', 'companies/c1/destinations/my-kl/hero.jpg'),
    ];
    const selected = selectDestinationImageRecord(
      rows,
      fullImageNameCandidates('Kuala Lumpur', [
        { country: 'Malaysia', destination: 'Kuala Lumpur' },
      ]),
      ['malaysia', 'kuala lumpur'],
    );
    expect(selected?.imageObjectKey).toBe('companies/c1/destinations/my/hero.jpg');
  });

  it('ignores rows without a confirmed image and returns null when nothing matches', () => {
    const rows = [imageRow('dest-empty', 'Vietnam', null)];
    expect(selectDestinationImageRecord(rows, ['vietnam'], ['vietnam'])).toBeNull();
    expect(selectDestinationImageRecord(vietnamRows(), ['atlantis'], ['atlantis'])).toBeNull();
    expect(selectDestinationImageRecord([], [], [])).toBeNull();
  });

  it('breaks fuzzy ties deterministically by name then id', () => {
    const rows = [
      imageRow('id-b', 'Da Nang Bay Tour', 'key-b'),
      imageRow('id-a', 'Da Nang Bay Tour', 'key-a'),
    ];
    const first = selectDestinationImageRecord(rows, [], ['da nang bay']);
    const second = selectDestinationImageRecord([...rows].reverse(), [], ['da nang bay']);
    expect(first?.imageObjectKey).toBe('key-a');
    expect(second?.imageObjectKey).toBe('key-a');
  });
});

describe('dayDestinationFallbackKeys', () => {
  it('normalises and de-duplicates day cities', () => {
    expect(dayDestinationFallbackKeys([' Singapore ', 'SINGAPORE', 'Malaysia', null, ''], null)).toEqual({
      cities: ['singapore', 'malaysia'],
      cityToCountry: {},
      soleCountry: null,
    });
  });

  it('maps a city to its lead-itinerary row-country (Baga inherits Goa)', () => {
    expect(
      dayDestinationFallbackKeys(['Baga', 'Singapore'], [
        { country: 'Goa', destination: 'Baga' },
        { country: 'Singapore', destination: 'Singapore' },
      ]),
    ).toEqual({
      cities: ['baga', 'singapore'],
      cityToCountry: { baga: 'goa', singapore: 'singapore' },
      soleCountry: null,
    });
  });

  it('ignores itinerary rows for cities with no day and empty input', () => {
    expect(
      dayDestinationFallbackKeys(['Singapore'], [
        { country: 'Malaysia', destination: 'Kuala Lumpur' },
      ]),
    ).toEqual({ cities: ['singapore'], cityToCountry: {}, soleCountry: 'malaysia' });
    expect(dayDestinationFallbackKeys([], [])).toEqual({ cities: [], cityToCountry: {}, soleCountry: null });
  });

  it('returns the lone lead-itinerary country for rows without a destination', () => {
    // QT-001082 shape: days in "Singapore", one country row with an empty
    // destination — the single country must still cover the day.
    expect(
      dayDestinationFallbackKeys(['Singapore'], [{ country: 'Singapore Heaven Delight', destination: '' }]),
    ).toEqual({ cities: ['singapore'], cityToCountry: {}, soleCountry: 'singapore heaven delight' });
  });

  it('returns no sole country when several countries are present', () => {
    expect(
      dayDestinationFallbackKeys(['Kuala Lumpur'], [
        { country: 'Malaysia', destination: 'Kuala Lumpur' },
        { country: 'Singapore', destination: 'Singapore' },
      ]),
    ).toEqual({
      cities: ['kuala lumpur'],
      cityToCountry: { 'kuala lumpur': 'malaysia' },
      soleCountry: null,
    });
  });
});

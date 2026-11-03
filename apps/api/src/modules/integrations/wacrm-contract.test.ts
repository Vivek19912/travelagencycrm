import { describe, expect, it } from 'vitest';

import { wacrmLeadPayloadSchema } from '@interscale/shared';

// ---------------------------------------------------------------------------
// DB-free contract tests for the WACRM integration payload (Phase 2):
// month/year timing keys, pair + conflict rules, and exact-date
// backward compatibility. HTTP-level persistence is covered by
// tests/wacrm-integration.test.ts against the test database.
// ---------------------------------------------------------------------------

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';

const base = (overrides: Record<string, unknown> = {}) => ({
  wacrmAccountId: ACCOUNT,
  flowRunId: RUN,
  customerName: 'Aarav Mehta',
  phone: '+91 98765 43210',
  leadSource: 'WHATSAPP',
  leadType: 'HOT',
  leadStage: 'NEW_LEAD',
  assignedToEmail: 'sales@alpha.test',
  travelStartDate: '2026-12-01',
  services: ['FLIGHT', 'HOTEL'],
  itinerary: [{ country: 'Thailand', destination: 'Bangkok', nights: 3, sequence: 1 }],
  ...overrides,
});

const issues = (result: ReturnType<typeof wacrmLeadPayloadSchema.safeParse>) =>
  !result.success ? result.error.issues : [];

describe('wacrm month/year travel timing (Phase 2A)', () => {
  it('accepts a complete month/year pair without an exact date', () => {
    const { travelStartDate: _dropped, ...noDate } = base();
    const result = wacrmLeadPayloadSchema.safeParse({
      ...noDate,
      travelMonth: 5,
      travelYear: 2027,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.travelMonth).toBe(5);
      expect(result.data.travelYear).toBe(2027);
      expect(result.data.travelStartDate).toBeUndefined();
    }
  });

  it('coerces numeric strings (JSON-safe WACRM Phase-1 shapes)', () => {
    const { travelStartDate: _dropped, ...noDate } = base();
    const result = wacrmLeadPayloadSchema.safeParse({
      ...noDate,
      travelMonth: '5',
      travelYear: '2027',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.travelMonth).toBe(5);
      expect(result.data.travelYear).toBe(2027);
    }
  });

  it('rejects an invalid month and an invalid year', () => {
    const { travelStartDate: _dropped, ...noDate } = base();
    for (const bad of [
      { travelMonth: 0, travelYear: 2027 },
      { travelMonth: 13, travelYear: 2027 },
      { travelMonth: 5, travelYear: 1899 },
      { travelMonth: 5, travelYear: 2101 },
    ]) {
      expect(wacrmLeadPayloadSchema.safeParse({ ...noDate, ...bad }).success).toBe(false);
    }
  });

  it('rejects a half pair (month without year, year without month)', () => {
    const { travelStartDate: _dropped, ...noDate } = base();
    for (const half of [{ travelMonth: 5 }, { travelYear: 2027 }]) {
      const result = wacrmLeadPayloadSchema.safeParse({ ...noDate, ...half });
      expect(result.success).toBe(false);
      expect(issues(result).map((i) => i.path.join('.'))).toContain('travelMonth');
    }
  });

  it('rejects a date combined with a complete month/year pair', () => {
    const result = wacrmLeadPayloadSchema.safeParse({
      ...base(),
      travelMonth: 5,
      travelYear: 2027,
    });
    expect(result.success).toBe(false);
    expect(issues(result).map((i) => i.path.join('.'))).toContain('travelStartDate');
  });

  it('keeps exact-date-only payloads backward-compatible', () => {
    const result = wacrmLeadPayloadSchema.safeParse(base());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.travelStartDate).toBeInstanceOf(Date);
      expect(result.data.travelMonth).toBeUndefined();
      expect(result.data.travelYear).toBeUndefined();
    }
  });

  it('keeps timing-free payloads valid (timing stays optional)', () => {
    const { travelStartDate: _dropped, ...noTiming } = base();
    expect(wacrmLeadPayloadSchema.safeParse(noTiming).success).toBe(true);
  });
});

describe('wacrm CRM User Mapping assignee id', () => {
  const SALES_ID = '33333333-3333-4333-8333-333333333333';

  it('accepts an absent assignedToUserId (owner-email assignment unchanged)', () => {
    const result = wacrmLeadPayloadSchema.safeParse(base());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assignedToUserId).toBeUndefined();
  });

  it('accepts a valid mapped salesperson uuid', () => {
    const result = wacrmLeadPayloadSchema.safeParse(
      base({ assignedToUserId: SALES_ID }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assignedToUserId).toBe(SALES_ID);
  });

  it('accepts explicit null (unmapped caller falls back to the owner)', () => {
    const result = wacrmLeadPayloadSchema.safeParse(
      base({ assignedToUserId: null }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assignedToUserId).toBeNull();
  });

  it('rejects a non-uuid assignedToUserId', () => {
    expect(
      wacrmLeadPayloadSchema.safeParse(base({ assignedToUserId: 'not-a-uuid' }))
        .success,
    ).toBe(false);
  });

  it('trims a padded uuid', () => {
    const result = wacrmLeadPayloadSchema.safeParse(
      base({ assignedToUserId: `  ${SALES_ID}  ` }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assignedToUserId).toBe(SALES_ID);
  });
});

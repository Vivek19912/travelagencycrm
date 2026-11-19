import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import zlib from 'node:zlib';
import { normalizeDestinationStylishCover } from '@interscale/shared';
import { createTestPrismaClient, truncateAll } from './helpers/test-database.js';
import { createAuthClient, registrationPayload } from './helpers/auth-client.js';
import { getMemoryEmailProvider } from '../src/services/email/email.service.js';
import {
  storageService,
  type MemoryStorageService,
} from '../src/services/storage/storage.service.js';
import { resolveStylishPage1DefaultCards } from '../src/modules/quotations/stylish-pdf.service.js';
import { resolveDestinationCoverCards } from '../src/modules/quotations/quotations.service.js';

let app: Express;
let db: PrismaClient;

beforeAll(async () => {
  db = createTestPrismaClient();
  app = (await import('../src/app.js')).createApp();
});
afterAll(async () => db.$disconnect());
beforeEach(async () => {
  await truncateAll(db);
  getMemoryEmailProvider()?.clear();
});

async function owner(email = 'owner@cover.test', companyName = 'Cover Travel') {
  const client = createAuthClient(app);
  await client.post('/api/auth/register', registrationPayload({ email, companyName }));
  await client.post('/api/auth/verify-email', { otp: getMemoryEmailProvider()?.lastOtp(email) });
  return client;
}

type Client = Awaited<ReturnType<typeof owner>>;

async function city(client: Client, name: string, countryCode = 'IN') {
  const res = await client.post('/api/masters/cities', { countryCode, name, status: 'ACTIVE' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

async function destination(client: Client, name: string, cityIds: string[]) {
  const res = await client.post('/api/masters/destinations', {
    countryCode: 'IN',
    name,
    destinationType: 'DOMESTIC',
    cityIds,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; name: string };
}

async function sightseeing(
  client: Client,
  destinationId: string,
  cityId: string,
  title: string,
  sequence = 1,
) {
  const res = await client.post('/api/masters/sightseeing', {
    destinationId,
    cityId,
    title,
    sequence,
    status: 'ACTIVE',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string };
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Upload + confirm one gallery image on a sightseeing master; returns its stable image id. */
async function addImage(client: Client, sightId: string, fileName: string): Promise<string> {
  const approval = await client.post(`/api/masters/sightseeing/${sightId}/image/upload`, {
    fileName,
    mimeType: 'image/png',
    fileSize: PNG_1PX.length,
  });
  expect(approval.status, JSON.stringify(approval.body)).toBe(201);
  const pending = await db.sightseeing.findUniqueOrThrow({ where: { id: sightId } });
  await (storageService as unknown as MemoryStorageService).putObject({
    key: pending.pendingImageObjectKey!,
    body: PNG_1PX,
    contentType: 'image/png',
  });
  const confirmed = await client.post(`/api/masters/sightseeing/${sightId}/image/confirm`);
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  const images = confirmed.body.data.images as Array<{ id: string; fileName: string }>;
  const match = images.find((image) => image.fileName === fileName);
  expect(match, JSON.stringify(images)).toBeDefined();
  return match!.id;
}

describe('normalizeDestinationStylishCover', () => {
  it('keeps exactly three distinct references in order', () => {
    const cards = [
      { sightseeingId: 's1', imageId: 'i1' },
      { sightseeingId: 's2', imageId: 'i2' },
      { sightseeingId: 's1', imageId: 'i3' },
    ];
    expect(normalizeDestinationStylishCover({ cards })).toEqual(cards);
  });

  it('rejects anything but three distinct references', () => {
    expect(normalizeDestinationStylishCover(null)).toBeNull();
    expect(normalizeDestinationStylishCover({ cards: [] })).toBeNull();
    expect(normalizeDestinationStylishCover({ cards: [{ sightseeingId: 's', imageId: 'i' }] })).toBeNull();
    expect(
      normalizeDestinationStylishCover({
        cards: [
          { sightseeingId: 's', imageId: 'i' },
          { sightseeingId: 's', imageId: 'i' },
          { sightseeingId: 's', imageId: 'j' },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeDestinationStylishCover({
        cards: [
          { sightseeingId: 's', imageId: '' },
          { sightseeingId: 's', imageId: 'i' },
          { sightseeingId: 't', imageId: 'j' },
        ],
      }),
    ).toBeNull();
  });
});

describe('Destination Stylish PDF cover configuration', () => {
  it('saves, reads back and reorders three images for one destination', async () => {
    const client = await owner();
    const kaza = await city(client, 'Kaza');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    const day2 = await sightseeing(client, spiti.id, kaza.id, 'DAY 2 | SANGLA', 2);
    const day4 = await sightseeing(client, spiti.id, kaza.id, 'DAY 4 | TABO', 4);
    const day6 = await sightseeing(client, spiti.id, kaza.id, 'DAY 6 | KAZA LOCAL', 6);
    const img2 = await addImage(client, day2.id, 'sangla.png');
    const img4 = await addImage(client, day4.id, 'tabo.png');
    const img6 = await addImage(client, day6.id, 'kaza.png');

    const empty = await client.get(`/api/masters/destinations/${spiti.id}/stylish-cover`);
    expect(empty.status).toBe(200);
    expect(empty.body.data.cards).toEqual([]);

    const payload = [
      { sightseeingId: day6.id, imageId: img6 },
      { sightseeingId: day2.id, imageId: img2 },
      { sightseeingId: day4.id, imageId: img4 },
    ];
    const saved = await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: payload,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.destination).toMatchObject({ id: spiti.id, name: 'Spiti Valley' });
    expect(saved.body.data.cards.map((card: { imageId: string }) => card.imageId)).toEqual([
      img6,
      img2,
      img4,
    ]);
    const first = saved.body.data.cards[0];
    expect(first).toMatchObject({
      sightseeingId: day6.id,
      title: 'DAY 6 | KAZA LOCAL',
      cityName: 'Kaza',
      valid: true,
    });
    expect(typeof first.url).toBe('string');

    // Reorder persists.
    const reordered = await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: [payload[1], payload[2], payload[0]],
    });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.cards.map((card: { imageId: string }) => card.imageId)).toEqual([
      img2,
      img4,
      img6,
    ]);
    const reread = await client.get(`/api/masters/destinations/${spiti.id}/stylish-cover`);
    expect(reread.body.data.cards.map((card: { imageId: string }) => card.imageId)).toEqual([
      img2,
      img4,
      img6,
    ]);
    // Stored references only — no image bytes duplicated into the config row.
    const stored = await db.destinationStylishCover.findFirstOrThrow({
      where: { destinationId: spiti.id },
    });
    expect(JSON.stringify(stored.cards)).not.toContain('companies/');
  });

  it('rejects fewer than three, duplicates and foreign images', async () => {
    const client = await owner();
    const kaza = await city(client, 'Kaza');
    const munnar = await city(client, 'Munnar');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    const kerala = await destination(client, 'Kerala', [munnar.id]);
    const sight = await sightseeing(client, spiti.id, kaza.id, 'DAY 2 | SANGLA', 2);
    const other = await sightseeing(client, kerala.id, munnar.id, 'MUNNAR TEA', 1);
    const img = await addImage(client, sight.id, 'sangla.png');
    const foreign = await addImage(client, other.id, 'tea.png');
    const good = { sightseeingId: sight.id, imageId: img };

    for (const cards of [
      [good],
      [good, good, good],
      [good, { sightseeingId: sight.id, imageId: 'missing' }, good],
      [good, { sightseeingId: other.id, imageId: foreign }, good],
    ]) {
      const res = await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, { cards });
      expect(res.status, JSON.stringify(cards)).toBe(400);
    }
    expect(
      await db.destinationStylishCover.count({ where: { destinationId: spiti.id } }),
    ).toBe(0);
  });

  it('keeps each destination configuration independent', async () => {
    const client = await owner();
    const kaza = await city(client, 'Kaza');
    const munnar = await city(client, 'Munnar');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    const kerala = await destination(client, 'Kerala', [munnar.id]);
    const sightA = await sightseeing(client, spiti.id, kaza.id, 'DAY 6 | KAZA', 6);
    const sightB = await sightseeing(client, kerala.id, munnar.id, 'MUNNAR TEA', 1);
    const imgA1 = await addImage(client, sightA.id, 'kaza-1.png');
    const imgA2 = await addImage(client, sightA.id, 'kaza-2.png');
    const imgA3 = await addImage(client, sightA.id, 'kaza-3.png');
    const imgB1 = await addImage(client, sightB.id, 'tea-1.png');
    const imgB2 = await addImage(client, sightB.id, 'tea-2.png');
    const imgB3 = await addImage(client, sightB.id, 'tea-3.png');

    // Multiple different images from the same sightseeing record are allowed.
    const spitiSave = await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: [
        { sightseeingId: sightA.id, imageId: imgA1 },
        { sightseeingId: sightA.id, imageId: imgA2 },
        { sightseeingId: sightA.id, imageId: imgA3 },
      ],
    });
    expect(spitiSave.status).toBe(200);

    const keralaSave = await client.put(`/api/masters/destinations/${kerala.id}/stylish-cover`, {
      cards: [
        { sightseeingId: sightB.id, imageId: imgB1 },
        { sightseeingId: sightB.id, imageId: imgB2 },
        { sightseeingId: sightB.id, imageId: imgB3 },
      ],
    });
    expect(keralaSave.status).toBe(200);

    // Saving Kerala never touches the Spiti configuration.
    const spitiCover = await client.get(`/api/masters/destinations/${spiti.id}/stylish-cover`);
    expect(spitiCover.body.data.cards.map((card: { imageId: string }) => card.imageId)).toEqual([
      imgA1,
      imgA2,
      imgA3,
    ]);
    const keralaCover = await client.get(`/api/masters/destinations/${kerala.id}/stylish-cover`);
    expect(keralaCover.body.data.cards.map((card: { imageId: string }) => card.imageId)).toEqual([
      imgB1,
      imgB2,
      imgB3,
    ]);
  });

  it('marks a stale saved reference without dropping the configuration', async () => {
    const client = await owner();
    const kaza = await city(client, 'Kaza');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    const sight = await sightseeing(client, spiti.id, kaza.id, 'DAY 2 | SANGLA', 2);
    const keep = await addImage(client, sight.id, 'keep.png');
    const gone = await addImage(client, sight.id, 'gone.png');
    const third = await addImage(client, sight.id, 'third.png');
    await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: [
        { sightseeingId: sight.id, imageId: keep },
        { sightseeingId: sight.id, imageId: gone },
        { sightseeingId: sight.id, imageId: third },
      ],
    });
    await client.delete(`/api/masters/sightseeing/${sight.id}/image?imageId=${gone}`);

    const cover = await client.get(`/api/masters/destinations/${spiti.id}/stylish-cover`);
    expect(cover.status).toBe(200);
    expect(cover.body.data.cards.map((card: { imageId: string }) => card.imageId)).toEqual([
      keep,
      gone,
      third,
    ]);
    expect(cover.body.data.cards.map((card: { valid: boolean }) => card.valid)).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe('resolveDestinationCoverCards', () => {
  it('returns the saved three images in order for the primary destination', async () => {
    const client = await owner();
    const kaza = await city(client, 'Kaza');
    const munnar = await city(client, 'Munnar');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    await destination(client, 'Kerala', [munnar.id]);
    const day2 = await sightseeing(client, spiti.id, kaza.id, 'DAY 2 | SANGLA', 2);
    const day4 = await sightseeing(client, spiti.id, kaza.id, 'DAY 4 | TABO', 4);
    const day6 = await sightseeing(client, spiti.id, kaza.id, 'DAY 6 | KAZA LOCAL', 6);
    const bytes = {
      b2: Buffer.from('spiti-day-2-bytes'),
      b4: Buffer.from('spiti-day-4-bytes'),
      b6: Buffer.from('spiti-day-6-bytes'),
    };
    const put = async (sightId: string, fileName: string, body: Buffer) => {
      const approval = await client.post(`/api/masters/sightseeing/${sightId}/image/upload`, {
        fileName,
        mimeType: 'image/png',
        fileSize: body.length,
      });
      expect(approval.status).toBe(201);
      const pending = await db.sightseeing.findUniqueOrThrow({ where: { id: sightId } });
      await (storageService as unknown as MemoryStorageService).putObject({
        key: pending.pendingImageObjectKey!,
        body,
        contentType: 'image/png',
      });
      const confirmed = await client.post(`/api/masters/sightseeing/${sightId}/image/confirm`);
      expect(confirmed.status).toBe(200);
      return (
        confirmed.body.data.images as Array<{ id: string; fileName: string }>
      ).find((image) => image.fileName === fileName)!.id;
    };
    const img2 = await put(day2.id, 'sangla.png', bytes.b2);
    const img4 = await put(day4.id, 'tabo.png', bytes.b4);
    const img6 = await put(day6.id, 'kaza.png', bytes.b6);
    await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: [
        { sightseeingId: day6.id, imageId: img6 },
        { sightseeingId: day2.id, imageId: img2 },
        { sightseeingId: day4.id, imageId: img4 },
      ],
    });
    const tenant = await db.company.findFirstOrThrow({ where: { name: 'Cover Travel' } });

    const resolved = await resolveDestinationCoverCards(
      tenant.id,
      {
        destinationSummary: 'Spiti Valley',
        query: { itinerary: [{ country: 'Spiti Valley', destination: 'Kaza' }] },
      },
      [tenant.id],
      (key) => storageService.getObject(key ?? ''),
    );
    // Saved order (6, 2, 4) wins over any itinerary-day order.
    expect(resolved?.map((buffer) => buffer.toString())).toEqual([
      'spiti-day-6-bytes',
      'spiti-day-2-bytes',
      'spiti-day-4-bytes',
    ]);
  });

  it('uses the primary destination and falls back when unresolvable', async () => {
    const client = await owner();
    const kaza = await city(client, 'Kaza');
    const munnar = await city(client, 'Munnar');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    await destination(client, 'Kerala', [munnar.id]);
    const sight = await sightseeing(client, spiti.id, kaza.id, 'DAY 6 | KAZA', 6);
    const img1 = await addImage(client, sight.id, 'kaza-1.png');
    const img2 = await addImage(client, sight.id, 'kaza-2.png');
    const img3 = await addImage(client, sight.id, 'kaza-3.png');
    await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: [
        { sightseeingId: sight.id, imageId: img1 },
        { sightseeingId: sight.id, imageId: img2 },
        { sightseeingId: sight.id, imageId: img3 },
      ],
    });
    const tenant = await db.company.findFirstOrThrow({ where: { name: 'Cover Travel' } });
    const fetch = (key: string | null | undefined) => storageService.getObject(key ?? '');
    const queryFor = (countries: string[]) => ({
      destinationSummary: countries.join(' → '),
      query: { itinerary: countries.map((country) => ({ country, destination: null })) },
    });

    // Multi-destination quotation: only the primary (first) destination applies.
    const multi = await resolveDestinationCoverCards(
      tenant.id,
      queryFor(['Spiti Valley', 'Kerala']),
      [tenant.id],
      fetch,
    );
    expect(multi).not.toBeNull();
    expect(multi).toHaveLength(3);

    // A quotation whose destination has no saved configuration falls back.
    const keralaOnly = await resolveDestinationCoverCards(
      tenant.id,
      queryFor(['Kerala']),
      [tenant.id],
      fetch,
    );
    expect(keralaOnly).toBeNull();

    const unknown = await resolveDestinationCoverCards(
      tenant.id,
      queryFor(['Atlantis']),
      [tenant.id],
      fetch,
    );
    expect(unknown).toBeNull();
  });

  it('returns null when a configured image no longer resolves', async () => {
    const client = await owner();
    const kaza = await city(client, 'Kaza');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    const sight = await sightseeing(client, spiti.id, kaza.id, 'DAY 2 | SANGLA', 2);
    const keep = await addImage(client, sight.id, 'keep.png');
    const gone = await addImage(client, sight.id, 'gone.png');
    const third = await addImage(client, sight.id, 'third.png');
    await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: [
        { sightseeingId: sight.id, imageId: keep },
        { sightseeingId: sight.id, imageId: gone },
        { sightseeingId: sight.id, imageId: third },
      ],
    });
    await client.delete(`/api/masters/sightseeing/${sight.id}/image?imageId=${gone}`);
    const tenant = await db.company.findFirstOrThrow({ where: { name: 'Cover Travel' } });
    const resolved = await resolveDestinationCoverCards(
      tenant.id,
      { destinationSummary: 'Spiti Valley', query: { itinerary: [] } },
      [tenant.id],
      (key) => storageService.getObject(key ?? ''),
    );
    expect(resolved).toBeNull();
  });
});

describe('resolveStylishPage1DefaultCards day selection', () => {  const buffers = (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, Buffer.from(`bytes-${id}`)]));
  const days = (count: number, missing: number[] = []) =>
    Array.from({ length: count }, (_, index) => {
      const dayNumber = index + 1;
      return {
        activities: missing.includes(dayNumber)
          ? []
          : [{ sightseeingId: `sight-${dayNumber}`, name: `Day ${dayNumber}` }],
      };
    });

  it('uses Days 2, 3 and 4 for itineraries longer than three days', () => {
    const cards = resolveStylishPage1DefaultCards(days(5), { sightseeing: buffers(['sight-1', 'sight-2', 'sight-3', 'sight-4', 'sight-5']) });
    expect(cards.map((buffer) => buffer.toString())).toEqual(['bytes-sight-2', 'bytes-sight-3', 'bytes-sight-4']);
  });

  it('uses Days 1, 2 and 3 for a three-day itinerary', () => {
    const cards = resolveStylishPage1DefaultCards(days(3), { sightseeing: buffers(['sight-1', 'sight-2', 'sight-3']) });
    expect(cards.map((buffer) => buffer.toString())).toEqual(['bytes-sight-1', 'bytes-sight-2', 'bytes-sight-3']);
  });

  it('skips a day without images and never falls back to Day 1 on longer trips', () => {
    const cards = resolveStylishPage1DefaultCards(days(5, [2]), {
      sightseeing: buffers(['sight-1', 'sight-3', 'sight-4', 'sight-5']),
    });
    expect(cards.map((buffer) => buffer.toString())).toEqual(['bytes-sight-3', 'bytes-sight-4', 'bytes-sight-5']);
  });

  it('never duplicates and yields placeholders for missing images', () => {
    const cards = resolveStylishPage1DefaultCards(days(2), { sightseeing: buffers(['sight-1']) });
    expect(cards.map((buffer) => buffer.toString())).toEqual(['bytes-sight-1']);
  });
});

describe('Stylish PDF generation with a destination cover', () => {
  const solidPng = async (r: number, g: number, b: number) => {
    const { default: sharp } = await import('sharp');
    return sharp({ create: { width: 60, height: 40, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer();
  };

  const firstOffset = (pdf: Buffer, rgb: [number, number, number]) => {
    const raw = pdf.toString('latin1');
    const parts: Buffer[] = [];
    const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw))) {
      try {
        parts.push(zlib.inflateSync(Buffer.from(match[1]!, 'latin1')));
      } catch {
        /* not a flate stream */
      }
    }
    const all = Buffer.concat(parts);
    const pattern = Buffer.from(rgb);
    let count = 0;
    let first = -1;
    for (let index = all.indexOf(pattern); index !== -1; index = all.indexOf(pattern, index + 1)) {
      if (first < 0) first = index;
      count += 1;
    }
    return { count, first };
  };

  it('renders the configured three images in saved order on Page 1', async () => {
    const client = await owner('owner-coverpdf@example.test', 'Cover PDF Travel');
    const kaza = await city(client, 'Kaza');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    const sight = await sightseeing(client, spiti.id, kaza.id, 'DAY 6 | KAZA LOCAL', 6);
    const red = await solidPng(220, 30, 30);
    const green = await solidPng(30, 160, 70);
    const blue = await solidPng(40, 90, 220);
    const putImage = async (fileName: string, body: Buffer) => {
      const approval = await client.post(`/api/masters/sightseeing/${sight.id}/image/upload`, {
        fileName,
        mimeType: 'image/png',
        fileSize: body.length,
      });
      expect(approval.status).toBe(201);
      const pending = await db.sightseeing.findUniqueOrThrow({ where: { id: sight.id } });
      await (storageService as unknown as MemoryStorageService).putObject({
        key: pending.pendingImageObjectKey!,
        body,
        contentType: 'image/png',
      });
      const confirmed = await client.post(`/api/masters/sightseeing/${sight.id}/image/confirm`);
      expect(confirmed.status).toBe(200);
      return (confirmed.body.data.images as Array<{ id: string; fileName: string }>).find(
        (image) => image.fileName === fileName,
      )!.id;
    };
    const imgR = await putImage('kaza-red.png', red);
    const imgG = await putImage('kaza-green.png', green);
    const imgB = await putImage('kaza-blue.png', blue);
    const saved = await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: [
        { sightseeingId: sight.id, imageId: imgR },
        { sightseeingId: sight.id, imageId: imgG },
        { sightseeingId: sight.id, imageId: imgB },
      ],
    });
    expect(saved.status).toBe(200);

    const lead = await client.post('/api/queries', {
      customerName: 'Cover Customer',
      phone: '+91 98888 88888',
      leadSource: 'REFERRAL',
      travelStartDate: '2026-10-05',
      travelEndDate: '2026-10-12',
      rooms: 1,
      adults: 2,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
      currency: 'INR',
      services: ['HOTEL', 'SIGHTSEEING'],
      itinerary: [{ country: 'Spiti Valley', destination: 'Kaza', nights: 7, sequence: 1 }],
    });
    expect(lead.status, JSON.stringify(lead.body)).toBe(201);
    const quotation = (await client.post('/api/quotations', { queryId: lead.body.data.id })).body
      .data;
    const version = quotation.versions[0];
    await client.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);

    const generated = await client.post(
      `/api/quotations/${quotation.id}/versions/${version.id}/generate-pdf`,
      { style: 'STYLISH', force: true },
    );
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    const document = await db.quotationDocument.findFirstOrThrow({
      where: { quotationId: quotation.id, status: 'AVAILABLE' },
    });
    const pdf = await storageService.getObject(document.objectKey);
    expect(pdf!.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Solid card colours appear verbatim in the embedded images, in saved order.
    const redAt = firstOffset(pdf!, [220, 30, 30]);
    const greenAt = firstOffset(pdf!, [30, 160, 70]);
    const blueAt = firstOffset(pdf!, [40, 90, 220]);
    expect(redAt.count).toBeGreaterThan(1000);
    expect(redAt.first).toBeGreaterThanOrEqual(0);
    expect(greenAt.first).toBeGreaterThan(redAt.first);
    expect(blueAt.first).toBeGreaterThan(greenAt.first);
  });

  it('still generates a valid PDF when the configured image is gone', async () => {
    const client = await owner('owner-coverfallback@example.test', 'Cover Fallback Travel');
    const kaza = await city(client, 'Kaza');
    const spiti = await destination(client, 'Spiti Valley', [kaza.id]);
    const sight = await sightseeing(client, spiti.id, kaza.id, 'DAY 2 | SANGLA', 2);
    const keep = await addImage(client, sight.id, 'keep.png');
    const gone = await addImage(client, sight.id, 'gone.png');
    const third = await addImage(client, sight.id, 'third.png');
    await client.put(`/api/masters/destinations/${spiti.id}/stylish-cover`, {
      cards: [
        { sightseeingId: sight.id, imageId: keep },
        { sightseeingId: sight.id, imageId: gone },
        { sightseeingId: sight.id, imageId: third },
      ],
    });
    await client.delete(`/api/masters/sightseeing/${sight.id}/image?imageId=${gone}`);

    const lead = await client.post('/api/queries', {
      customerName: 'Fallback Customer',
      phone: '+91 98888 88881',
      leadSource: 'REFERRAL',
      travelStartDate: '2026-10-05',
      travelEndDate: '2026-10-12',
      rooms: 1,
      adults: 2,
      childrenWithBed: 0,
      childrenWithoutBed: 0,
      infants: 0,
      currency: 'INR',
      services: ['HOTEL', 'SIGHTSEEING'],
      itinerary: [{ country: 'Spiti Valley', destination: 'Kaza', nights: 7, sequence: 1 }],
    });
    expect(lead.status).toBe(201);
    const quotation = (await client.post('/api/quotations', { queryId: lead.body.data.id })).body
      .data;
    const version = quotation.versions[0];
    await client.post(`/api/quotations/${quotation.id}/versions/${version.id}/finalize`);
    const generated = await client.post(
      `/api/quotations/${quotation.id}/versions/${version.id}/generate-pdf`,
      { style: 'STYLISH', force: true },
    );
    expect(generated.status, JSON.stringify(generated.body)).toBe(200);
    const document = await db.quotationDocument.findFirstOrThrow({
      where: { quotationId: quotation.id, status: 'AVAILABLE' },
    });
    const pdf = await storageService.getObject(document.objectKey);
    expect(pdf!.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

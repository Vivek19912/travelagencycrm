import { readFile } from 'node:fs/promises';
import { prisma } from './src/config/prisma.js';

const b = await readFile(
  '.local-storage/companies/5c398160-f21b-4fe2-816a-7dd744d5c4be/masters/destinations/54669101-59c0-4e8c-a1f9-084e79894531/images/2fe32c3d-fba9-4880-a011-9c19c482338a/image.png',
);
console.log('dest image len', b.length, 'magic', Buffer.from(b.subarray(0, 12)).toString('hex'));

// QT-001082 day cities + lead itinerary shape check.
const v = (await prisma.quotationVersion.findUniqueOrThrow({
  where: { id: 'e3fa2cd8-f8f1-4bb6-b55c-276e24659a5e' },
  include: { itinerary: { orderBy: { sequence: 'asc' } } },
})) as unknown as {
  sightseeingDetails: { days?: Array<{ city?: unknown; dayNumber?: unknown; title?: unknown }> };
  itinerary: Array<{ destination?: unknown; country?: unknown }>;
};
console.log('day cities:', JSON.stringify((v.sightseeingDetails.days ?? []).map((d) => d.city)));
console.log('legacy itinerary rows:', JSON.stringify(v.itinerary));
const q = (await prisma.quotation.findUniqueOrThrow({
  where: { id: '452e5ea4-7058-4f05-9f68-7b05cd3c733b' },
  include: { query: { select: { itinerary: true } } },
})) as unknown as { query: { itinerary: unknown } | null };
console.log('query.itinerary shape:', Array.isArray(q.query?.itinerary) ? 'ARRAY' : typeof q.query?.itinerary);
console.log('query.itinerary value:', JSON.stringify(q.query?.itinerary)?.slice(0, 600));
await prisma.$disconnect();

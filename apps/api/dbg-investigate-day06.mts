import { prisma } from './src/config/prisma.js';

// READ-ONLY investigation: Day 06 "Sentosa Island - Cable Car + Universal Studios".
const hits = (await prisma.$queryRawUnsafe<Array<{
  id: string; quotationId: string; versionNumber: number; quotationNumber: string;
  companyId: string; companyName: string; destinationSummary: string | null;
}>>(
  `SELECT v.id, v."quotationId", v."versionNumber", q."quotationNumber",
          q."companyId", c.name AS "companyName", q."destinationSummary"
   FROM "quotation_versions" v
   JOIN "quotations" q ON q.id = v."quotationId"
   JOIN "companies" c ON c.id = q."companyId"
   WHERE v."sightseeingDetails"::text LIKE '%Cable Car + Universal Studios%'
   LIMIT 20`,
)) as Array<{
  id: string; quotationId: string; versionNumber: number; quotationNumber: string;
  companyId: string; companyName: string; destinationSummary: string | null;
}>;
console.log('MATCHES:', JSON.stringify(hits, null, 2));

for (const h of hits.slice(0, 4)) {
  const version = await prisma.quotationVersion.findUnique({
    where: { id: h.id },
    select: { id: true, sightseeingDetails: true },
  });
  const quotation = await prisma.quotation.findUnique({
    where: { id: h.quotationId },
    select: {
      id: true, quotationNumber: true, destinationSummary: true,
      query: { select: { itinerary: true } },
    },
  });
  const days = (version?.sightseeingDetails as { days?: Array<Record<string, unknown>> } | null)?.days ?? [];
  console.log(`\n=== ${h.quotationNumber} v${h.versionNumber} (${h.companyName}) ===`);
  console.log('destinationSummary:', quotation?.destinationSummary);
  console.log('query.itinerary:', JSON.stringify(quotation?.query));
  const day6 = days.find((d) => Number(d.dayNumber) === 6) ?? days[5];
  console.log('DAY06 raw:', JSON.stringify(day6, null, 2)?.slice(0, 4000));
  console.log('ALL day cities/dates:', JSON.stringify(days.map((d) => ({ n: d.dayNumber, city: d.city, date: d.date, title: String(d.title).slice(0, 60) }))));

  // Destination masters with images for this company.
  const masters = await prisma.destination.findMany({
    where: { companyId: h.companyId, imageObjectKey: { not: null }, imageConfirmedAt: { not: null } },
    select: { name: true, normalizedName: true, imageObjectKey: true, imageConfirmedAt: true },
  });
  console.log('DEST MASTERS w/ image:', JSON.stringify(masters.map((m) => ({ name: m.name, norm: m.normalizedName, key: m.imageObjectKey })), null, 2));

  // Existing stored stylish PDFs for this version (cache assessment).
  const docs = await prisma.quotationDocument.findMany({
    where: { quotationId: h.quotationId, quotationVersionId: h.id, documentType: 'QUOTATION_PDF' },
    select: { fileName: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log('STORED PDF DOCS:', JSON.stringify(docs, null, 2));
}
await prisma.$disconnect();

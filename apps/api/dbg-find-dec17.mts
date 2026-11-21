import { prisma } from './src/config/prisma.js';
// Find the exact screenshot quotation: Day 06 date 2026-12-17.
const rows = (await prisma.$queryRawUnsafe(
  `SELECT v."versionNumber", q."quotationNumber", v.id AS "versionId", q.id AS "quotationId"
   FROM "quotation_versions" v JOIN "quotations" q ON q.id = v."quotationId"
   WHERE v."sightseeingDetails"::text LIKE '%2026-12-17%'
     AND v."sightseeingDetails"::text LIKE '%Universal Studios%'
   LIMIT 10`,
)) as Array<{ versionNumber: number; quotationNumber: string; versionId: string; quotationId: string }>;
console.log('DEC17 MATCHES:', JSON.stringify(rows, null, 2));
for (const r of rows) {
  const docs = await prisma.quotationDocument.findMany({
    where: { quotationId: r.quotationId, quotationVersionId: r.versionId, documentType: 'QUOTATION_PDF' },
    select: { fileName: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  console.log(r.quotationNumber, 'v' + r.versionNumber, 'DOCS:', JSON.stringify(docs));
}
await prisma.$disconnect();

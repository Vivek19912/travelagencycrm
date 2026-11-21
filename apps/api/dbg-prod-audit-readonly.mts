/**
 * READ-ONLY production audit: Hotels & Sightseeing added on 21 Nov 2026 (IST).
 *
 * SAFETY:
 * - SELECT queries only (findUnique/findMany/count/groupBy). No writes, no
 *   migrations, no schema changes, no application code changes.
 * - REFUSES to run unless AUDIT_CONFIRM_PRODUCTION=yes AND the DATABASE_URL
 *   host is not a loopback/dev host. Never prints passwords or connection
 *   strings (only host/db-name identity, which is required to confirm the
 *   target is production).
 * - Connection comes from the standard DATABASE_URL environment variable
 *   (see docs/production/DEPLOYMENT.md). Nothing is hardcoded.
 */
import { PrismaClient } from '@prisma/client';

const ACCOUNT_EMAIL = 'vacationtriangle1@gmail.com';
// 21 Nov 2026 00:00 IST (inclusive) .. 22 Nov 2026 00:00 IST (exclusive).
const WINDOW_START = new Date('2026-11-20T18:30:00.000Z');
const WINDOW_END = new Date('2026-11-21T18:30:00.000Z');

const redactHost = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '(default)'}${u.pathname}`;
  } catch {
    return '(unparseable)';
  }
};

async function main(): Promise<void> {
  const rawUrl = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const isLoopback = host === '' || host === 'localhost' || host === '127.0.0.1' || host === '::1';
  console.log('TARGET_DB=' + redactHost(rawUrl || 'missing'));
  if (process.env.AUDIT_CONFIRM_PRODUCTION !== 'yes' || isLoopback) {
    console.log(
      'REFUSING: target is not a confirmed production database ' +
        `(loopback=${isLoopback}, confirmed=${process.env.AUDIT_CONFIRM_PRODUCTION === 'yes'}). ` +
        'Set AUDIT_CONFIRM_PRODUCTION=yes with a non-local DATABASE_URL to run. No queries executed.',
    );
    process.exit(2);
  }

  const prisma = new PrismaClient();
  try {
    // 1. Account -> company.
    const user = await prisma.user.findUnique({
      where: { normalizedEmail: ACCOUNT_EMAIL.trim().toLowerCase() },
      select: { id: true, fullName: true, email: true, companyId: true },
    });
    if (!user) {
      console.log('ACCOUNT_NOT_FOUND email=' + ACCOUNT_EMAIL);
      return;
    }
    const company = await prisma.company.findUnique({
      where: { id: user.companyId },
      select: { id: true, name: true },
    });
    console.log('ACCOUNT_USER id=' + user.id + ' name=' + user.fullName);
    console.log('ACCOUNT_COMPANY id=' + company?.id + ' name=' + company?.name);

    const window = { gte: WINDOW_START, lt: WINDOW_END };
    // 2. Counts (company-scoped, createdAt window).
    const [hotelTotal, sightTotal] = await Promise.all([
      prisma.hotel.count({ where: { companyId: company!.id, createdAt: window } }),
      prisma.sightseeing.count({ where: { companyId: company!.id, createdAt: window } }),
    ]);
    console.log(`RESULT Hotels=${hotelTotal} Sightseeing=${sightTotal} Total=${hotelTotal + sightTotal}`);

    // 3. Active vs non-active (status-based soft state; no deletedAt column exists).
    const [hotelActive, sightActive] = await Promise.all([
      prisma.hotel.count({ where: { companyId: company!.id, createdAt: window, status: 'ACTIVE' } }),
      prisma.sightseeing.count({ where: { companyId: company!.id, createdAt: window, status: 'ACTIVE' } }),
    ]);
    console.log(`ACTIVE Hotels=${hotelActive} Sightseeing=${sightActive}`);
    console.log(`NON_ACTIVE Hotels=${hotelTotal - hotelActive} Sightseeing=${sightTotal - sightActive}`);

    // 4. Creator breakdown.
    const [hotelByCreator, sightByCreator] = await Promise.all([
      prisma.hotel.groupBy({ by: ['createdById'], where: { companyId: company!.id, createdAt: window }, _count: true }),
      prisma.sightseeing.groupBy({ by: ['createdById'], where: { companyId: company!.id, createdAt: window }, _count: true }),
    ]);
    const creatorIds = [...new Set([...hotelByCreator, ...sightByCreator].map((r) => r.createdById))];
    const creators = creatorIds.length
      ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true, email: true } })
      : [];
    const cname = (id: string) => creators.find((c) => c.id === id) ?? { fullName: '(unknown)', email: '(unknown)' };
    for (const r of hotelByCreator) console.log(`HOTEL_BY_CREATOR ${cname(r.createdById).fullName} <${cname(r.createdById).email}> count=${r._count}`);
    for (const r of sightByCreator) console.log(`SIGHT_BY_CREATOR ${cname(r.createdById).fullName} <${cname(r.createdById).email}> count=${r._count}`);

    // 5. Record details (each row once).
    const hotels = await prisma.hotel.findMany({
      where: { companyId: company!.id, createdAt: window },
      select: { id: true, name: true, status: true, createdAt: true, createdById: true, destination: { select: { name: true } }, city: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const sights = await prisma.sightseeing.findMany({
      where: { companyId: company!.id, createdAt: window },
      select: { id: true, title: true, status: true, createdAt: true, createdById: true, destination: { select: { name: true } }, city: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const ist = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    for (const h of hotels) console.log(`HOTEL_ROW name=${h.name} destination=${h.destination.name} city=${h.city.name} status=${h.status} createdIST=${ist(h.createdAt)} by=${cname(h.createdById).email}`);
    for (const s of sights) console.log(`SIGHT_ROW title=${s.title} destination=${s.destination.name} city=${s.city.name} status=${s.status} createdIST=${ist(s.createdAt)} by=${cname(s.createdById).email}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();

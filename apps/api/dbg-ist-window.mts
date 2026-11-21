// IST window verification (Asia/Kolkata = UTC+5:30, no DST):
// Start: 21 Nov 2026 00:00:00 IST = 20 Nov 2026 18:30:00 UTC
// End:   22 Nov 2026 00:00:00 IST = 21 Nov 2026 18:30:00 UTC (exclusive)
const fmt = (d: Date) => d.toISOString();
const startIST = new Date('2026-11-21T00:00:00+05:30');
const endIST = new Date('2026-11-22T00:00:00+05:30');
console.log('START_UTC=' + fmt(startIST));
console.log('END_UTC=' + fmt(endIST));
console.log('WINDOW_HOURS=' + ((endIST.getTime() - startIST.getTime()) / 3600000));

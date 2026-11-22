import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const dir = '../../tmp/footer-verify';
const pdf = `${dir}/itin-newdesign.pdf`;
let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const npages = Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)?.[1]);
const textOf = (p: number) => execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), pdf, '-']).toString();
const findPages = (needle: string) => {
  const hits: number[] = [];
  for (let p = 1; p <= npages; p += 1) if (textOf(p).includes(needle)) hits.push(p);
  return hits;
};
const all = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
const flatAll = all.replace(/\s+/g, ' ');

// 1+2. New design everywhere: Day badges on every day page.
for (const d of ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5']) {
  check(findPages(d).length > 0, `badge '${d}' present`);
}
// Old zero-padded badge form must be gone from itinerary pages.
const itinText = [3, 4, 5, 6, 7, 8].filter((p) => p <= npages).map((p) => textOf(p)).join('\n');
check(!/DAY\s*\n?\s*0[1-9]/.test(itinText), 'no old stacked DAY/01 badge block');
// 3. Long title wraps (no ellipsis truncation of the long day-3 title).
check(flatAll.includes('A Very Long Itinerary Title That Must Wrap Gracefully Onto Multiple Lines Without Clipping'), 'long title fully present (wrapped, not clipped)');
// 4+6. Optionals: day 3 has no date/city/meals/transfer.
check(!/As advised/.test(all), "no 'As advised' anywhere");
// 5. Meals labels + transfer pills per mockup vocabulary.
for (const t of ['Meals:', 'Dinner', 'Breakfast (Hotel)', 'Lunch', 'Private Transfer', 'Shared Transfer']) {
  check(all.includes(t), `meals/transfer text '${t}'`);
}
// 7. Description content + headings preserved on every day.
for (const t of ['Chandigarh Airport', 'Sangla Valley and Chitkul', 'Minimal day, nothing extra', 'Grand stop 12', 'Epic stop 30', 'Attractions Covered:', 'Inclusions:']) {
  check(all.includes(t), `description content '${t.slice(0, 28)}'`);
}
// 8. Images: day-specific images embedded (4 distinct + cover + sightseeing).
import { readFileSync as readPdfFile } from 'node:fs';
const pdfBytes = readPdfFile(`${dir}/itin-newdesign.pdf`);
const imgCount = (pdfBytes.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length;
check(imgCount >= 5, `embedded images present (${imgCount})`);
// 9. Packing: days 1+2 share page 3 (titles wrap, so match normalised text).
const p1 = findPages('Chandigarh to Shimla');
const p2 = findPages('Valley Extended Tour');
const p2b = findPages('Shimla to Sangla');
const p2all = [...new Set([...p2, ...p2b])];
check(p1.length > 0 && p2all.length > 0 && p1.some((p) => p2all.includes(p)), 'days 1+2 share one page', `p${p1}/p${p2all}`);
// Fresh page for the long day.
const p4 = findPages('Grand Long Tour');
check(p4.length > 0 && p4[0]! > p1[0]!, 'long day starts on a later fresh page', `p${p4}`);
// 10. Oversized day flows across A4 pages.
const p5 = findPages('Epic Mega Tour');
check(p5.length > 0, 'epic day present');
// 11. Itinerary pages exactly A4; no page taller than A4 (the shorter
// services card page is pre-existing intended design).
const sizes = [...execFileSync('pdfinfo', ['-f', '1', '-l', String(npages), pdf]).toString().matchAll(/Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
check(sizes.every(([, , h]) => h <= 841.89 + 1), 'no page taller than A4');
const itinPagesAll = [...new Set(['Chandigarh to Shimla', 'Shimla to Sangla', 'Valley Extended Tour', 'Gracefully', 'Grand Long Tour', 'Grand Activity', 'Epic Mega Tour', 'Epic Activity', 'Guided tour', 'Minimal day'].flatMap((t) => findPages(t)))].sort((a, b) => a - b);
check(itinPagesAll.every((p) => { const s = sizes.find((x) => x[0] === p)!; return Math.abs(s[1] - 595.28) < 1 && Math.abs(s[2] - 841.89) < 1; }), 'itinerary pages exactly A4', `pages ${itinPagesAll}`);
// Footers intact on itinerary pages.
const itinPages = [...new Set(['Chandigarh to Shimla', 'Epic Mega Tour', 'Grand Long Tour', 'Minimal day'].flatMap((t) => findPages(t)))].sort((a, b) => a - b);
check(itinPages.every((p) => textOf(p).includes('CONTACT US')), 'footers on itinerary pages', `pages ${itinPages}`);
// Header intact.
check(all.includes('DAY WISE ITINERARY'), 'section heading present');
// No legacy time rows in the new header (Time/duration moved out of the header).
check(!all.includes('7:00 AM') && !all.includes('08:00 AM'), 'no legacy time rows in day header');
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('ALL NEW-DESIGN CHECKS PASSED');
execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '3', '-l', String(Math.min(npages, 6)), `${dir}/itin-newdesign.pdf`, `${dir}/itinnd`]);
console.log('PNGs rendered 3..' + Math.min(npages, 6));

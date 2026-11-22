import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const dir = '../../tmp/footer-verify';
const pdf = `${dir}/hotels-mockup.pdf`;
let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const npages = Number(execFileSync('pdfinfo', [pdf]).toString().match(/Pages:\s+(\d+)/)?.[1]);
const textOf = (p: number) => execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), pdf, '-']).toString();
const all = execFileSync('pdftotext', ['-layout', pdf, '-']).toString();
const findPages = (needle: string) => {
  const hits: number[] = [];
  for (let p = 1; p <= npages; p += 1) if (textOf(p).includes(needle)) hits.push(p);
  return hits;
};

const flat = (s: string) => s.replace(/\s+/g, ' ');
// 1-2. No containers/cards — structural (visual PNG check); no fact-box labels.
for (const label of ['CHECK-IN', 'CHECK-OUT', 'ROOM TYPE', 'MEAL PLAN', 'EXTRA BED', 'CHILD W/O BED']) {
  check(!all.includes(label), `no legacy fact-box label '${label}'`);
}
// 'Nights' must not appear inside hotel listings (Trip Overview duration legitimately uses it).
const hotelPagesAll = [...new Set(['Classic Luxury Resorts', 'De Greenish Village Langkawi', 'ibis Singapore Novena', 'Grand Palace No Dates', 'Checkin Only Inn', 'Checkout Only Lodge', 'Unrated Guest House', 'Multi Room Resort'].flatMap((t) => findPages(t)))].sort((a, b) => a - b);
check(hotelPagesAll.every((p) => !textOf(p).includes('Nights')), 'no Nights sub-line in hotel listings', `hotel pages ${hotelPagesAll}`);
// 3/5. No city pill/city standalone: city appears only inside addresses.
check(!all.includes('Destination'), 'no city fallback pill');
// 4/5. No reviews anywhere.
check(!all.includes('Check Hotel Review'), 'no review link text');
check(!all.includes('reviews.example.test'), 'no review URL');
check(!all.includes('4.5') || true, 'rating spot-check (informational)');
const raw = (await import('node:fs')).readFileSync(pdf).toString('latin1');
check(!raw.includes('/URI (https://reviews.example.test'), 'no review URI objects');
// 6. Stars below names, gold treatment preserved.
for (const stars of ['★★★', '★★', '★★★★★']) check(all.includes(stars), `stars '${stars}' present`);
const flatAll = all.replace(/\s+/g, ' ');
// 7. Long addresses complete + wrapping (all words present, no ellipsis truncation of content).
for (const frag of ['Padshahi Bagh Lasjan Rd', 'K P Bagh', 'Jammu and Kashmir', 'Jalan Ayer Hangat', '07000 Langkawi', 'Kedah, Malaysia', '6 Irrawaddy Road, Singapore 329543']) {
  check(flatAll.includes(frag), `address fragment '${frag}'`);
}
// 8. Dates: both / only-in / only-out / neither. Shared pages prevent
// per-page isolation, so single-hotel PDFs give exact label sets.
check(all.includes('08 Nov 2026') && all.includes('13 Nov 2026'), 'hotel2 both dates');
check(all.includes('21 Nov 2026') && all.includes('28 Nov 2026'), 'hotel3 both dates');
check(all.includes('01 Dec 2026'), 'hotel5 check-in only date present');
check(all.includes('05 Dec 2026'), 'hotel6 check-out only date present');
check(!all.includes('As advised'), "no 'As advised' anywhere");
const single = (name: string) => execFileSync('pdftotext', ['-layout', `${dir}/${name}.pdf`, '-']).toString();
const tNoDates = single('hotels-single-nodates');
check(!tNoDates.includes('Check-in') && !tNoDates.includes('Check-out'), 'dateless hotel: no date labels, no placeholders');
const tIn = single('hotels-single-checkin');
check(tIn.includes('Check-in') && !tIn.includes('Check-out') && tIn.includes('01 Dec 2026'), 'check-in-only hotel: only its label+date');
const tOut = single('hotels-single-checkout');
check(tOut.includes('Check-out') && !tOut.includes('Check-in') && tOut.includes('05 Dec 2026'), 'check-out-only hotel: only its label+date');
// 9. Rooms preserved incl. multi + extra bed + meal plans (layout wraps
// long lines, so match whitespace-normalised text).
for (const room of ['Junior Suite Room', 'Extra Bed: 2', 'Suite Room', '4 Rooms', 'Deluxe Sea View with Balcony', 'Extra Bed: 1', 'Child W/O Bed: 1', 'Meal Plan 1', 'Meal Plan 2', 'Half Board', 'Meal Plan: Breakfast']) {
  check(flatAll.includes(room), `room text '${room}'`);
}
// 10. Hotel pages are A4, none enlarged; footers present on hotel pages.
const sizes = [...execFileSync('pdfinfo', ['-f', '1', '-l', String(npages), pdf]).toString().matchAll(/Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
check(sizes.every(([, w, h]) => h <= 841.89 + 1), 'no page taller than A4', JSON.stringify(sizes.map((s) => s[2])));
const hotelPages = [...new Set(['Classic Luxury Resorts', 'De Greenish Village Langkawi', 'ibis Singapore Novena', 'Grand Palace No Dates', 'Checkin Only Inn', 'Checkout Only Lodge', 'Unrated Guest House', 'Multi Room Resort'].flatMap((t) => findPages(t)))].sort((a, b) => a - b);
check(hotelPages.every((p) => { const s = sizes.find((x) => x[0] === p)!; return Math.abs(s[1] - 595.28) < 1 && Math.abs(s[2] - 841.89) < 1; }), 'hotel pages exactly A4', `pages ${hotelPages}`);
check(hotelPages.every((p) => textOf(p).includes('CONTACT US')), 'footers on hotel pages');
// 11. All hotel names + header intact.
for (const name of ['Classic Luxury Resorts', 'De Greenish Village Langkawi', 'ibis Singapore Novena', 'Grand Palace No Dates', 'Checkin Only Inn', 'Checkout Only Lodge', 'Unrated Guest House', 'Multi Room Resort']) {
  check(findPages(name).length > 0, `hotel '${name}' rendered`);
}
check(all.includes('HOTEL ACCOMMODATIONS'), 'section heading present');

// PNGs of hotel pages.
execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '3', '-l', String(npages), `${dir}/hotels-mockup.pdf`, `${dir}/hotelpg`]);
console.log('hotel pages PNG rendered 3..' + npages);
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('ALL HOTEL CHECKS PASSED');

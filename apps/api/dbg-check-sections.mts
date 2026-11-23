import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const dir = '../../tmp/footer-verify';
const pdf = `${dir}/sections-refine.pdf`;
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
const flatAll = all.replace(/\s+/g, ' ');

// 1. Flight content intact (container removal is structural; PNG-verified).
for (const t of ['OUTBOUND', 'RETURN', 'IndiGo', 'VietJet', '6E 1633', 'VJ 896', 'Indira Gandhi', 'Noi Bai International', '5h 45m', '12:20 PM', '6:05 PM', 'ECONOMY', 'Cabin: 10kg', 'Check-in: 30kg']) {
  check(flatAll.includes(t), `flight content '${t}'`);
}
// 2. Hotel content intact (image-size change is visual; PNG-verified).
for (const t of ['Hotel Boss', 'Skyfarm Resorts', 'Heritage Luxury', '500 Jln Sultan, Singapore 199020', 'Awoora, Dehwattu', 'Standard Room', 'Suite Room', 'Extra Bed: 1', 'Deluxe Room', '4 Rooms', 'Meal Plan 1: Breakfast', 'Meal Plan 2: Breakfast + Dinner (Veg)', '01 Nov 2026', '21 Nov 2026']) {
  check(flatAll.includes(t), `hotel content '${t.slice(0, 40)}'`);
}
check(!all.includes('Check Hotel Review'), 'no hotel review artifacts');
// 3+4. Vehicle/cruise content intact.
for (const t of ['Innova Crysta', 'Tempo Traveller', 'TRANSPORTATION', 'Sightseeing', 'This vehicle will be used for sightseeing', 'Amanda Halong Cruise', '3 Nights', '4 Days']) {
  check(flatAll.includes(t), `vehicle/cruise content '${t.slice(0, 40)}'`);
}
// 5. Add-on content + pricing intact; full names wrap, never truncate.
for (const t of ['Add-on Hanoi Zoo', 'Visa Assistance With Complete Documentation Support', 'Appointment Scheduling Services', '5,000 animals', 'giant pandas', 'Adult', 'Child', 'Per Person'] /* amounts checked loosely below */) {
  check(flatAll.includes(t), `add-on content '${t.slice(0, 40)}'`);
}
for (const amt of ['2,000', '1,000', '1,500']) check(all.includes(amt), `add-on price '${amt}'`);
check(all.includes('ADD-ON SERVICES'), 'add-on section heading');
check(!all.includes('...'), 'no truncated add-on ellipsis');
// 6. Policies: all sections + content present, no typed-x bullets.
for (const t of ['INCLUSIONS', 'EXCLUSIONS', 'CHILD POLICY', 'PAYMENT POLICIES', 'CANCELLATION POLICIES', '06 Nights accommodation', 'International and domestic flight tickets', 'Age 1-2: Free', '30% advance payment', 'Hotel: As per the hotel']) {
  check(flatAll.includes(t), `policy content '${t.slice(0, 40)}'`);
}
const exclPages = findPages('International and domestic flight tickets');
let typedX = 0;
for (const p of exclPages) {
  for (const line of textOf(p).split('\n')) {
    // Lowercase-x bullets only (the spaced page-header caps never match).
    if (/^\s*x\s+[a-z]/.test(line)) typedX += 1;
  }
}
check(typedX === 0, 'no typed-x exclusion bullets left', typedX ? `${typedX} rows` : '');
// Bold emphasis inside exclusions preserved (2% TCS was bold in source).
check(flatAll.includes('2% TCS'), 'exclusion bold content preserved');
// 7. Hotel pages + policy pages are A4-or-smaller, never enlarged; footers present.
const sizes = [...execFileSync('pdfinfo', ['-f', '1', '-l', String(npages), pdf]).toString().matchAll(/Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
check(sizes.every(([, , h]) => h <= 841.89 + 1), 'no page taller than A4');
const sectionPages = [...new Set(['OUTBOUND', 'Hotel Boss', 'Innova Crysta', 'Amanda Halong Cruise', 'Add-on Hanoi Zoo', 'INCLUSIONS'].flatMap((t) => findPages(t)))].sort((a, b) => a - b);
check(sectionPages.every((p) => textOf(p).includes('CONTACT US')), 'footers on section pages', `pages ${sectionPages}`);
// Image-size assertions (solid test colors): vehicle 219.8x154pt (+40%),
// add-on 210x154pt (+40%). Regions avoid the photographic page header.
async function colorBoxIn(file: string, rgb: [number, number, number], region: { left: number; top: number; width: number; height: number }, tol = 24) {
  const { data, info } = await sharp(file).extract(region).raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if (Math.abs(data[i]! - rgb[0]) <= tol && Math.abs(data[i + 1]! - rgb[1]) <= tol && Math.abs(data[i + 2]! - rgb[2]) <= tol) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}
const S = 150 / 72;
{
  // Vehicle (Innova, vh1 red) on the transport page.
  const tp = findPages('Innova Crysta')[0]!;
  execFileSync('pdftoppm', ['-png', '-r', '150', '-f', String(tp), '-l', String(tp), pdf, `${dir}/size-vehicle`]);
  const f = `${dir}/size-vehicle-${String(tp).padStart(2, '0')}.png`;
  const b = await colorBoxIn(f, [160, 60, 60], { left: 90, top: 300, width: 520, height: 500 });
  console.log(`vehicle box: ${b.w}x${b.h}px (${(b.w / S).toFixed(1)}x${(b.h / S).toFixed(1)}pt)`);
  check(Math.abs(b.w / S - 219.8) < 5 && Math.abs(b.h / S - 154) < 5, 'vehicle image 219.8x154pt (+40%)');
}
{
  // Cruise (Halong, ch1 purple) on the cruise page.
  const cp = findPages('Amanda Halong Cruise')[0]!;
  execFileSync('pdftoppm', ['-png', '-r', '150', '-f', String(cp), '-l', String(cp), pdf, `${dir}/size-cruise`]);
  const f = `${dir}/size-cruise-${String(cp).padStart(2, '0')}.png`;
  const b = await colorBoxIn(f, [140, 60, 140], { left: 90, top: 300, width: 520, height: 500 });
  console.log(`cruise box: ${b.w}x${b.h}px (${(b.w / S).toFixed(1)}x${(b.h / S).toFixed(1)}pt)`);
  check(Math.abs(b.w / S - 219.8) < 5 && Math.abs(b.h / S - 154) < 5, 'cruise image 219.8x154pt (+40%)');
}
{
  // Add-on (zoo, ad1 blue-grey) on the add-on page (below the header art).
  const ap = findPages('Add-on Hanoi Zoo')[0]!;
  execFileSync('pdftoppm', ['-png', '-r', '150', '-f', String(ap), '-l', String(ap), pdf, `${dir}/size-addon`]);
  const f = `${dir}/size-addon-${String(ap).padStart(2, '0')}.png`;
  const b = await colorBoxIn(f, [200, 50, 150], { left: 100, top: 300, width: 500, height: 650 });
  console.log(`addon box: ${b.w}x${b.h}px (${(b.w / S).toFixed(1)}x${(b.h / S).toFixed(1)}pt)`);
  check(Math.abs(b.w / S - 210) < 5 && Math.abs(b.h / S - 154) < 5, 'add-on image 210x154pt (+40%)');
}

check(all.includes('THANK YOU'), 'thank-you page present');

if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('ALL SECTION CHECKS PASSED');

// PNGs: flights, hotels, transport, cruise, addons, policies.
const grab = (name: string, titles: string[]) => {
  const pages = [...new Set(titles.flatMap((t) => findPages(t)))].sort((a, b) => a - b);
  for (const p of pages) execFileSync('pdftoppm', ['-png', '-r', '150', '-f', String(p), '-l', String(p), pdf, `${dir}/${name}-${p}`]);
  console.log(`${name}: pages ${pages}`);
};
grab('sec-flight', ['OUTBOUND']);
grab('sec-hotel', ['Hotel Boss']);
grab('sec-transport', ['Innova Crysta']);
grab('sec-cruise', ['Amanda Halong Cruise']);
grab('sec-addon', ['Add-on Hanoi Zoo']);
grab('sec-policy', ['INCLUSIONS', 'EXCLUSIONS', 'CHILD POLICY']);
void sharp;

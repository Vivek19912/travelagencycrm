import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const dir = '../../tmp/footer-verify';
let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const pagesOf = (pdf: string): number =>
  Number(execFileSync('pdfinfo', [`${dir}/${pdf}.pdf`]).toString().match(/Pages:\s+(\d+)/)?.[1]);

const pageSizes = (pdf: string, n: number): Array<[number, number]> => {
  const out = execFileSync('pdfinfo', ['-f', '1', '-l', String(n), `${dir}/${pdf}.pdf`]).toString();
  return [...out.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
};

const textOf = (pdf: string, p: number): string =>
  execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), `${dir}/${pdf}.pdf`, '-']).toString();

const findPages = (pdf: string, n: number, needle: string): number[] => {
  const hits: number[] = [];
  for (let p = 1; p <= n; p += 1) if (textOf(pdf, p).includes(needle)) hits.push(p);
  return hits;
};

// Itinerary pages stay exactly A4 (the 500pt services card page is
// pre-existing intended design, asserted by pdf-rendering.test.ts) and no
// page is ever enlarged beyond A4.
const itinPagesOf: Record<string, number[]> = {};
for (const [name, titles] of [
  ['pg-a-short2', ['Chandigarh to Shimla', 'Shimla to Sangla']],
  ['pg-b-short3', ['Arrival Day One', 'Valley Day Two', 'River Day Three']],
  ['pg-c-shortlong', ['Quick Arrival', 'Grand Long Tour', 'Grand Tour Activity']],
  ['pg-d-verylong', ['Epic Mega Tour', 'Epic Activity', 'Guided tour']],
  ['pg-e-mixed', ['Arrival One', 'Grand Two', 'Short Three', 'Short Four', 'Epic Five', 'Grand Activity', 'Epic Activity']],
  ['pg-f-multidest', ['Singapore Day', 'Malaysia Day', 'Own Image Day', 'Nowhere Day']],
] as Array<[string, string[]]>) {
  const n = pagesOf(name);
  const set = new Set<number>();
  for (const t of titles) for (const p of findPages(name, n, t)) set.add(p);
  // Include continuation pages: any page between first and last day page.
  const arr = [...set].sort((a, b) => a - b);
  const all = new Set(arr);
  for (let p = arr[0]!; p <= arr[arr.length - 1]!; p += 1) all.add(p);
  itinPagesOf[name] = [...all].sort((a, b) => a - b);
  const sizes = pageSizes(name, n);
  const itinA4 = itinPagesOf[name].every((p) => Math.abs(sizes[p - 1]![0] - 595.28) < 1 && Math.abs(sizes[p - 1]![1] - 841.89) < 1);
  const noneTall = sizes.every(([, h]) => h <= 841.89 + 1);
  check(itinA4, `${name}: itinerary pages exactly A4`, `pages ${itinPagesOf[name]}`);
  check(noneTall, `${name}: no page enlarged beyond A4`);
}

// A: two short days share one page.
{
  const n = pagesOf('pg-a-short2');
  const p1 = findPages('pg-a-short2', n, 'Chandigarh to Shimla');
  const p2 = findPages('pg-a-short2', n, 'Shimla to Sangla');
  check(p1.length > 0 && p2.length > 0 && p1[0] === p2[0], 'A: both short days on one page', `pages ${p1}/${p2} of ${n}`);
}

// B: three short days pack efficiently (>=2 share a page).
{
  const n = pagesOf('pg-b-short3');
  const p1 = findPages('pg-b-short3', n, 'Arrival Day One');
  const p2 = findPages('pg-b-short3', n, 'Valley Day Two');
  const p3 = findPages('pg-b-short3', n, 'River Day Three');
  check(p1[0] === p2[0], 'B: days 1+2 share a page', `pages ${p1}/${p2}/${p3} of ${n}`);
  check(p3.length > 0, 'B: day 3 rendered', `page ${p3}`);
}

// C: long day moves whole to a fresh page.
{
  const n = pagesOf('pg-c-shortlong');
  const p1 = findPages('pg-c-shortlong', n, 'Quick Arrival');
  const p2 = findPages('pg-c-shortlong', n, 'Grand Long Tour');
  check(p1.length > 0 && p2.length > 0 && p1[0] !== p2[0], 'C: long day starts on fresh page', `pages ${p1}/${p2} of ${n}`);
  check(findPages('pg-c-shortlong', n, 'Grand Tour Activity').length > 0, 'C: long description fully present');
}

// D: description tail continues onto a later A4 page.
{
  const n = pagesOf('pg-d-verylong');
  const pTitle = findPages('pg-d-verylong', n, 'Epic Mega Tour');
  const pTail = findPages('pg-d-verylong', n, 'All transfers');
  check(pTitle.length > 0 && pTail.length > 0 && pTail[0]! >= pTitle[0]!, 'D: description tail rendered', `title ${pTitle}, tail ${pTail} of ${n}`);
  check(pTail.some((p) => p > pTitle[0]!), 'D: tail continues onto a following page');
}

// E: mixed days all present with footers intact.
{
  const n = pagesOf('pg-e-mixed');
  const titles = ['Arrival One', 'Grand Two', 'Short Three', 'Short Four', 'Epic Five'];
  const found = titles.map((t) => findPages('pg-e-mixed', n, t));
  check(found.every((f) => f.length > 0), 'E: all mixed days present', found.map((f, i) => `${titles[i]}:p${f}`).join(' '));
  const itinPages = [...new Set(found.flat())];
  check(itinPages.every((p) => textOf('pg-e-mixed', p).includes('CONTACT US')), 'E: footers intact on itinerary pages');
}

// F: destination image selection per day (pixel check on image box).
{
  const n = pagesOf('pg-f-multidest');
  execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '3', '-l', String(n), `${dir}/pg-f-multidest.pdf`, `${dir}/pgcheck-f`]);
  const S = 150 / 72;
  // Day pages start at 3; find each day's page by title, then sample image box.
  // Sample the box's top-left corner (avoids the centred globe emoji when
  // checking the placeholder fill; identical to centre for solid images).
  const boxMean = async (file: string, top: number): Promise<[number, number, number]> => {
    const buf = await sharp(file).extract({ left: Math.round(54 * S) + 10, top: Math.round((top + 12) * S) + 10, width: 60, height: 60 }).raw().toBuffer();
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < buf.length; i += 3) { r += buf[i]!; g += buf[i + 1]!; b += buf[i + 2]!; }
    const k = buf.length / 3;
    return [Math.round(r / k), Math.round(g / k), Math.round(b / k)];
  };
  const close = (a: [number, number, number], c: [number, number, number]) => Math.abs(a[0] - c[0]) < 30 && Math.abs(a[1] - c[1]) < 30 && Math.abs(a[2] - c[2]) < 30;
  // Map day title -> page (validates packing); scan the page vertically to
  // locate the image box and verify its source colour (validates image
  // selection independent of exact block heights).
  const expectation: Array<{ title: string; pages: number[]; rgb: [number, number, number] | 'globe' }> = [
    { title: 'Singapore Day', pages: [3], rgb: [60, 100, 160] },
    { title: 'Malaysia Day', pages: [3], rgb: [160, 60, 60] },
    { title: 'Own Image Day', pages: [4], rgb: [60, 140, 100] },
    { title: 'Nowhere Day', pages: [4], rgb: 'globe' },
  ];
  for (const e of expectation) {
    const found = findPages('pg-f-multidest', n, e.title);
    const pageOk = found.length > 0 && found.every((p) => e.pages.includes(p));
    const target = e.rgb === 'globe' ? ([227, 235, 243] as [number, number, number]) : e.rgb;
    let bestDist = Infinity;
    let bestAt = '';
    for (const p of found.length ? found : e.pages) {
      const f = `${dir}/pgcheck-f-${p}.png`;
      for (let top = 85; top <= 600; top += 8) {
        const m = await boxMean(f, top);
        // Corners avoid the globe emoji when checking the placeholder fill.
        const d = Math.abs(m[0] - target[0]) + Math.abs(m[1] - target[1]) + Math.abs(m[2] - target[2]);
        if (d < bestDist) { bestDist = d; bestAt = `p${p}@${top}`; }
      }
    }
    const ok = pageOk && bestDist < 90;
    check(ok, `F: ${e.title} on p${e.pages} with correct image`, `best ${bestAt} dist=${Math.round(bestDist)}`);
  }
}

if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('ALL PAGINATION CHECKS PASSED');

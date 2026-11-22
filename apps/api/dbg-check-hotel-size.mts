import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const dir = '../../tmp/footer-verify';
let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Bounding box of pixels matching a solid test color, searched inside the
// image column below the page header (header photos share brownish tones).
async function colorBox(file: string, rgb: [number, number, number], tol = 24) {
  const region = await sharp(file).extract({ left: 80, top: 300, width: 460, height: 950 }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = region;
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1, n = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if (
        Math.abs(data[i]! - rgb[0]) <= tol &&
        Math.abs(data[i + 1]! - rgb[1]) <= tol &&
        Math.abs(data[i + 2]! - rgb[2]) <= tol
      ) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        n += 1;
      }
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1, n, box: [minX, minY, maxX, maxY] };
}

// New render: Classic Luxury Resorts (h1 = 150,90,60) on its page.
const npages = Number(execFileSync('pdfinfo', [`${dir}/hotels-mockup.pdf`]).toString().match(/Pages:\s+(\d+)/)?.[1]);
const textOf = (p: number) => execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), `${dir}/hotels-mockup.pdf`, '-']).toString();
let bossPage = 0;
for (let p = 1; p <= npages; p += 1) if (textOf(p).includes('Classic Luxury Resorts')) { bossPage = p; break; }
execFileSync('pdftoppm', ['-png', '-r', '150', '-f', String(bossPage), '-l', String(bossPage), `${dir}/hotels-mockup.pdf`, `${dir}/size-new`]);
const S = 150 / 72;
const fresh = await colorBox(`${dir}/size-new-${bossPage}.png`, [150, 90, 60]);
console.log(`new box: ${fresh.w}x${fresh.h}px (${(fresh.w / S).toFixed(1)}x${(fresh.h / S).toFixed(1)}pt), pixels=${fresh.n}`);
check(Math.abs(fresh.w / S - 172.5) < 4 && Math.abs(fresh.h / S - 198.75) < 4, 'new image is 172.5x198.75pt');

// Before size (previous 138x159 implementation): ratio must be exactly 1.25.
const ratioW = fresh.w / S / 138;
const ratioH = fresh.h / S / 159;
check(Math.abs(ratioW - 1.25) < 0.04 && Math.abs(ratioH - 1.25) < 0.04, 'exactly 25% larger than previous 138x159', `w x${ratioW.toFixed(3)} h x${ratioH.toFixed(3)}`);

// Layout intact: name/stars/dates/rooms present, footer present, A4 pages.
const all = execFileSync('pdftotext', ['-layout', `${dir}/hotels-mockup.pdf`, '-']).toString();
for (const t of ['Classic Luxury Resorts', '★★★', 'Padshahi Bagh Lasjan Rd', '08 Nov 2026', '13 Nov 2026', 'Deluxe Room', 'Meal Plan: Breakfast']) {
  check(all.includes(t), `content '${t}'`);
}
check(all.includes('CONTACT US') && all.includes('HOTEL ACCOMMODATIONS'), 'header/footer intact');

if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('HOTEL +25% SIZE CHECKS PASSED');

import { execFileSync } from 'node:child_process';
const dir = '../../tmp/footer-verify';
for (let p = 1; p <= 8; p += 1) {
  const t = execFileSync('pdftotext', ['-layout', '-f', String(p), '-l', String(p), `${dir}/hotels-mockup.pdf`, '-']).toString();
  const names = ['Hotel Boss', 'Skyfarm', 'Heritage Luxury', 'Grand Palace', 'Checkin Only', 'Checkout Only', 'Unrated Guest', 'Multi Room', 'HOTEL ACCOMMODATIONS'].filter((n) => t.includes(n));
  console.log(`p${p}: ${names.join(' | ') || '(none)'}`);
}

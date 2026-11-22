import { execFileSync } from 'node:child_process';
const dir = '../../tmp/footer-verify';
// Bounding boxes (points) for words on the policies page.
const xml = execFileSync('pdftotext', ['-bbox', '-f', '10', '-l', '10', `${dir}/sections-refine.pdf`, '-']).toString();
const words: Array<{ text: string; yMax: number; yMin: number }> = [];
const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"[^>]*>([^<]*)<\/word>/g;
let wm: RegExpExecArray | null;
while ((wm = wordRe.exec(xml))) words.push({ text: (wm[5] ?? '').trim(), yMax: Number(wm[4]), yMin: Number(wm[2]) });
const yOf = (needle: string) => words.filter((w) => w.text.includes(needle)).map((w) => w.yMax);
const max = (a: number[]) => Math.max(...a);
const min = (a: number[]) => Math.min(...a);
// End of INCLUSIONS content = lowest content word above the EXCLUSIONS header.
const exclTops = yOf('EXCLUSIONS').filter((y) => y < 400);
const exclTop = min(exclTops);
const inclWords = words.filter((w) => w.yMax < exclTop - 20 && !['INCLUSIONS', 'POLICIES', 'XYZ', 'TRAVEL', 'AGENCY'].includes(w.text));
const inclEnd = max(inclWords.map((w) => w.yMax));
console.log('INCLUSIONS content ends yMax=' + inclEnd.toFixed(1));
console.log('EXCLUSIONS header top yMax=' + exclTop.toFixed(1));
console.log('GAP=' + (exclTop - inclEnd).toFixed(1) + 'pt (was ~10pt before the 4x change)');

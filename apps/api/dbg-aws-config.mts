import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
const p = path.join(homedir(), '.aws', 'config');
if (!existsSync(p)) {
  console.log('NO_AWS_CONFIG');
  process.exit(0);
}
const raw = readFileSync(p, 'utf8');
for (const line of raw.split('\n')) {
  const t = line.trim();
  if (t.startsWith('[')) console.log('SECTION ' + t);
  else if (/^(region|output)\s*=/.test(t)) console.log('  ' + t);
}

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
// Print ONLY key names per profile, never values.
const raw = readFileSync(path.join(homedir(), '.aws', 'credentials'), 'utf8');
let current = '';
for (const line of raw.split('\n')) {
  const t = line.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    current = t;
    console.log('PROFILE ' + current);
  } else if (t && !t.startsWith('#') && t.includes('=')) {
    const k = t.split('=')[0]!.trim();
    // print key name + value length only
    console.log('  key=' + k + ' valueLen=' + t.split('=').slice(1).join('=').trim().length);
  }
}

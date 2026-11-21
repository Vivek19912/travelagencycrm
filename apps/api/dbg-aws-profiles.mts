import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
const raw = readFileSync(path.join(homedir(), '.aws', 'credentials'), 'utf8');
const profiles: string[] = [];
for (const line of raw.split('\n')) {
  const t = line.trim();
  if (t.startsWith('[') && t.endsWith(']')) profiles.push(t);
}
console.log('AWS_PROFILES=' + JSON.stringify(profiles));
console.log('HAS_SECRET_KEYS=' + (raw.includes('aws_secret_access_key') ? 'yes(redacted, not printed)' : 'no'));

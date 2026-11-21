import { readFileSync } from 'node:fs';
const env = readFileSync('../../.env', 'utf8');
const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
if (!line) {
  console.log('NO DATABASE_URL in root .env');
  process.exit(0);
}
const value = line.slice('DATABASE_URL='.length).trim();
try {
  const u = new URL(value);
  console.log('HOST=' + u.hostname);
  console.log('PORT=' + u.port);
  console.log('DB=' + u.pathname);
  console.log('HAS_CREDENTIALS=' + (u.username ? 'yes(redacted)' : 'no'));
} catch {
  console.log('UNPARSEABLE_URL_FORMAT');
}

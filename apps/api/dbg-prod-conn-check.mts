import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
const env = readFileSync('../../.env', 'utf8');
for (const key of ['API_URL', 'WEB_URL', 'VITE_API_URL', 'AWS_S3_ENDPOINT', 'AWS_REGION', 'STORAGE_PROVIDER', 'NODE_ENV']) {
  const line = env.split('\n').find((l) => l.startsWith(key + '='));
  console.log(key + '=' + (line ? line.slice(key.length + 1).trim() : '(absent)'));
}
console.log('AWS_CREDS_FILE=' + (existsSync(path.join(homedir(), '.aws', 'credentials')) ? 'present' : 'absent'));
console.log('SSH_CONFIG=' + (existsSync(path.join(homedir(), '.ssh', 'config')) ? 'present' : 'absent'));

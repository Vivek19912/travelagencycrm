import net from 'node:net';
const s = new net.Socket();
s.setTimeout(5000);
s.on('connect', () => { console.log('PG_UP'); process.exit(0); });
s.on('timeout', () => { console.log('PG_DOWN_TIMEOUT'); process.exit(1); });
s.on('error', (e: unknown) => { console.log('PG_DOWN ' + (e as { code?: string }).code); process.exit(1); });
s.connect(5433, 'localhost');

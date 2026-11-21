import net from 'node:net';
const HOST = 'interscaleapistack-postgres9dc8bb04-hpjnqeabvg99.c7s8eo28ipn4.ap-south-1.rds.amazonaws.com';
const PORT = 5432;
const socket = new net.Socket();
let done = false;
const finish = (msg: string) => {
  if (done) return;
  done = true;
  console.log(msg);
  socket.destroy();
  process.exit(0);
};
socket.setTimeout(15000);
socket.on('connect', () => finish('TCP_REACHABLE host=' + HOST + ' port=' + PORT));
socket.on('timeout', () => finish('TCP_TIMEOUT host=' + HOST + ' port=' + PORT));
socket.on('error', (e: unknown) => finish('TCP_ERROR host=' + HOST + ' port=' + PORT + ' code=' + (e as { code?: string }).code));
socket.connect(PORT, HOST);
setTimeout(() => finish('TCP_TIMEOUT host=' + HOST + ' port=' + PORT), 20000);

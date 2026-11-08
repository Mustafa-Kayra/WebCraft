import { fileURLToPath } from 'node:url';
import { createWebCraftServer } from './app.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';

const server = createWebCraftServer({
  staticDir: dev ? null : `${root}dist`,
  dataDir: process.env.DATA_DIR || `${root}data`,
});
const address = await server.listen(port, host);
console.log(`WebCraft ${dev ? 'multiplayer endpoint' : 'server'} on http://${host}:${address.port} (WebSocket at /ws)`);

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exit(0);
  });
}

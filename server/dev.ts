/** Local development: signaling only. Vite serves the client and proxies /api/ws here. */
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { attachSignaling } from './signaling.js';

const port = Number(process.env.SIGNAL_PORT ?? process.env.PORT ?? 8787);
const server = createServer((_req, res) => {
  res.writeHead(426, { 'content-type': 'text/plain' }).end('WebSocket upgrade required');
});
attachSignaling(server, loadConfig());
server.listen(port, () => {
  console.log(`DropLink signaling listening on ws://localhost:${port}/api/ws`);
});

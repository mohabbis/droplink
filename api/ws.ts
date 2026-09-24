/**
 * Vercel Function: DropLink signaling over WebSocket at /api/ws.
 *
 * Rooms live in this function instance's memory. Two devices must reach the
 * same instance to pair; see "Known limitations" in the README.
 */
import { createServer } from 'node:http';
import { loadConfig } from '../server/config.js';
import { attachSignaling } from '../server/signaling.js';

const server = createServer((_req, res) => {
  res.writeHead(426, { 'content-type': 'text/plain' }).end('WebSocket upgrade required');
});
attachSignaling(server, loadConfig());

export default server;

# DropLink

Send files directly between two devices. DropLink pairs two browser sessions with a short code and then moves files over an encrypted WebRTC data channel. The server only helps the two browsers find each other. It never receives file names, sizes, or contents.

- No accounts, no uploads, no database, no analytics.
- Both people confirm a matching verification code before any files can be sent.
- The receiver accepts each transfer before anything is sent.
- Files are chunked and sent with backpressure. Progress, speed and ETA come from the receiver's acknowledgements.
- Every file is checked with SHA-256 end to end.
- Each device shows whether the connection is **direct** or **relayed** through a TURN server.

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
npm run dev          # client on http://localhost:5173, signaling on :8787
```

Open the page in two browser windows (or on two devices on the same network, using your computer's LAN address). On one, click **Create a pairing code**. On the other, open the link or enter the code.

> Browsers only allow WebRTC and WebCrypto in a secure context. `localhost` counts as secure; for other devices on your LAN use HTTPS (for example a tunnel) or the deployed site.

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server plus the signaling server with reload (`/api/ws` is proxied) |
| `npm run build` | Builds the client into `dist/` and the server into `dist-server/` |
| `npm start` | Runs a self-hosted server that serves `dist/` and signaling from one process |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript for the server/functions and for the client/tests |
| `npm test` | Vitest: room handling, signaling, chunking, backpressure, verification, UI states |
| `npm run test:e2e` | Playwright: real transfers between two Chromium sessions against the production build |

To run the end-to-end tests against an existing Chromium binary, set `CHROMIUM_PATH=/path/to/chrome`.

## Environment variables

All optional. See `.env.example`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ICE_SERVERS` | `[{"urls":"stun:stun.l.google.com:19302"}]` | JSON array of `RTCIceServer` objects sent to browsers. Add a TURN server here. `[]` means host candidates only. |
| `ROOM_TTL_SECONDS` | `270` | How long an unpaired code stays valid. Keep it below the Vercel function's `maxDuration` (300 s). |
| `MAX_ROOMS` | `1000` | Room cap per server instance. |
| `PORT` | `8787` | Port for `npm start` / `npm run dev:server`. |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For`. Set automatically on Vercel. |
| `VITE_SIGNALING_URL` | same origin `/api/ws` | Build-time override if signaling runs on another host. |

Keep TURN credentials in your hosting provider's environment settings, never in the repository.

## Deploying

**Vercel.** The repo includes `vercel.json`. Vercel runs `npm run build`, serves `dist/`, and deploys `api/ws.ts` as a WebSocket function with `maxDuration: 300`. Pushing to `main` deploys to production.

**Self-hosted (any Node host).** Run `npm run build && npm start`. One process serves the site and signaling at `/api/ws`. It must run behind HTTPS in production.

## Architecture

```
Device A (browser)                    Signaling (Vercel fn / Node)                Device B (browser)
      │  create ───────────────────────────▶ room K7QM4P (memory, TTL)                  │
      │                                      ◀──────────────────────────── join K7QM4P  │
      │  offer / ICE ─────────────────────▶ relay ──────────────────────▶ answer / ICE  │
      │◀════════════════ WebRTC data channel (DTLS-encrypted, P2P or TURN) ════════════▶│
      │  hello ⇄ hello → both leave the room; the server forgets both devices           │
      │  compare verification code → pair-confirm ⇄ pair-confirm                        │
      │  manifest → accept → file-start, binary chunks, file-end{sha256} → file-result   │
```

```
shared/           Signaling protocol types + validation, room codes, limits (used by server and client)
server/           rooms.ts (RoomManager), signaling.ts (ws wiring), config.ts, rateLimit.ts,
                  dev.ts (local signaling), start.ts (self-hosted server)
api/ws.ts         Vercel Function entry: exports the signaling http.Server
src/lib/          signaling.ts (WS client), peer.ts (RTCPeerConnection, direct/relay detection),
                  sas.ts (verification code), support.ts, device.ts, errors.ts, format.ts
src/lib/transfer/ wire.ts (data-channel messages), chunker.ts, sender.ts (backpressure),
                  receiver.ts (reassembly + verification), hash.ts (streaming SHA-256),
                  progress.ts (speed/ETA), diskSink.ts (save straight to disk)
src/state/        session.ts (DropLinkSession: whole lifecycle), types.ts, actions.ts
src/components/   Screen, FilePanel, DropZone, pairing/*, transfers/*, ProgressBar, ConnectionBadge
tests/e2e/        Playwright two-browser tests
```

### Signaling server

- Relays only `offer`, `answer` and ICE candidates between the two members of a room. Every message is validated.
- **Room codes:** 6 characters from a 31-character alphabet with no 0/O/1/I/L. Generated with `crypto.randomInt` and retried on collision; if no free code turns up after 10 tries, it reports "busy".
- **Room lifetime:**
  - An unpaired room expires after `ROOM_TTL_SECONDS`.
  - Once both devices join, they have 2 minutes to connect.
  - A room closes as soon as either device leaves. Both devices leave on their own once their data channels are open.
- **Limits:**
  - 32 KB per message and 60 messages per 10 s per connection.
  - Per IP: 10 room creations and 20 join attempts per minute. The join limit slows down code guessing.
  - 2 members per room.
  - Connections that never create or join a room are closed after 30 s.

### Pairing verification

Each browser derives a 6-digit code from the DTLS certificate fingerprints of both ends of its connection. If anything in the middle intercepted the setup, including a compromised signaling server, the two devices would hold different certificates and see different codes. Transfers are blocked until both people confirm that the codes match.

### Transfers

- One ordered, reliable data channel carries everything.
- Control messages are JSON. File bytes are sent as 64 KiB binary frames, or smaller if the browser reports a lower SCTP maximum.
- **Backpressure:** the sender pauses when more than 4 MB is buffered and resumes on `bufferedamountlow` at 1 MB.
- **Hashing:** the sender computes SHA-256 while reading each file; the receiver computes it while writing. A mismatch or a wrong byte count marks that file as failed.
- **Progress:**
  - Shown from the receiver's acknowledgements, sent every 1 MB, so it reflects bytes that actually arrived.
  - Speed is measured over a sliding 3-second window.
  - Updates are rendered at most every 120 ms.
- **Where received files go:** into memory by default, then offered as downloads. In Chromium browsers the receiver can pick "Save to…" / "Save to a folder…" so the file streams straight to disk (File System Access API). Sender-supplied names are sanitised and existing files are never overwritten.
- **Cancelling:** either side can cancel at any time, and partial data is thrown away. Either side can send once paired; one transfer runs at a time.

## Privacy notes

- The signaling server sees each device's IP address, the room code, and WebRTC setup data (SDP, which includes network candidates). It stores nothing on disk.
- The pairing link puts the code in the URL fragment (`#join=…`). Browsers don't send the fragment to servers, and the app removes it from the address bar after reading it.
- The default STUN server (Google) sees each device's IP address when it discovers its public address. Set `ICE_SERVERS` to your own STUN/TURN servers to avoid this.
- A TURN relay, if you configure one, carries encrypted traffic it cannot read. The UI labels such connections "Relayed connection".
- The site loads no third-party scripts, fonts or analytics.

## Known limitations

- **Serverless signaling holds rooms in memory (Vercel).** Rooms live in the memory of one function instance. If the two devices' WebSockets land on different instances, the joiner sees "We couldn't find that code" and has to ask for a new one. This gets more likely as traffic grows. Two reliable fixes:
  - Run signaling on a single long-lived Node host (`npm start`) and point `VITE_SIGNALING_URL` at it.
  - Move room state to a shared store with pub/sub such as Redis. `RoomManager` works with abstract `Member`s, so this is contained to `server/`.
- **Maximum connection duration.** The Vercel function's `maxDuration` (300 s) caps how long a signaling connection can stay open, which is why codes expire after 4.5 minutes. The file transfer itself is peer-to-peer and isn't affected.
- **No TURN server by default.** Without one, pairing fails between some networks (symmetric NATs, strict corporate firewalls). The app says so and suggests using the same Wi-Fi or turning off VPNs.
- **Large files without disk streaming.** Firefox and Safari have no File System Access API, so received files are held in memory until downloaded. Transfers of several GB can fail on low-memory devices; the UI warns above 1.5 GB.
- **No resumable transfers.** If the connection drops, the transfer has to be sent again.
- **One transfer at a time** per pair of devices.
- **Folders** dropped onto the page are skipped. Select the files inside instead.

## What has been tested

- Unit and integration tests (`npm test`, 74 tests):
  - Room creation, collisions, expiry, capacity and rate limits.
  - WebSocket signaling end to end on a real port.
  - Chunk boundaries and backpressure, using a fake data channel.
  - Reassembly and SHA-256 mismatch detection.
  - Progress and ETA maths, and wire-message validation.
  - Verification-code symmetry.
  - Rendering of every major UI state.
- End-to-end (`npm run test:e2e`): two separate headless Chromium sessions against the production build.
  - Pairing via both link and typed code, with matching verification codes.
  - A 25 MB file plus a small file, with the downloads' SHA-256 compared to the originals.
  - Sending in the reverse direction, declining, and cancelling a 300 MB transfer mid-way.
  - Rejecting the verification code, detecting disconnects, and invalid or unknown codes.
- The Vercel build (`vercel build`) was run locally, and the compiled `api/ws.js` function was exercised as a WebSocket signaling server.

**Still needs a manual test:**
- Transfers between two physical devices on different networks.
- Safari and Firefox (the e2e suite runs Chromium only).
- The "Save to disk" flow, which needs a real file dialog.
- A TURN-relayed connection.
- Behaviour on the live Vercel deployment when many rooms are active at once.

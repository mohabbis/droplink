import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4317);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    launchOptions: {
      // Use a preinstalled Chromium when the bundled one isn't available (e.g. CI sandboxes).
      executablePath: process.env.CHROMIUM_PATH || undefined,
      // Expose real host candidates instead of mDNS names so two local browsers can connect.
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
  webServer: {
    command: 'npm run build && node dist-server/server/start.js',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    // No STUN: both browsers are on this machine, so host candidates are enough.
    env: { PORT: String(PORT), ICE_SERVERS: '[]' },
  },
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Tests share one dev server instance with global in-memory room state, so run
  // sequentially rather than fullyParallel to avoid cross-test room-count contamination.
  workers: 1,
  // WebRTC negotiation (ICE/DTLS/SCTP) has more inherent timing variance under load than
  // typical UI flows, especially for the 3-peer data-channel scenario (three concurrent
  // RTCPeerConnections negotiating in one run); retries locally too, not just in CI, absorb
  // an occasional slow connection setup without masking a real regression (which fails
  // consistently across retries, not once).
  retries: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera', 'microphone'],
        // chrome-headless-shell (Playwright's default headless binary) doesn't implement
        // the media-permission delegate at all, so getUserMedia always throws
        // NotSupportedError there regardless of --use-fake-device-for-media-stream. The
        // full "chrome" channel does support it in headless mode.
        channel: 'chromium',
        // getDisplayMedia() has no real screen to enumerate under Chromium's headless
        // renderer, so --auto-select-desktop-capture-source silently has nothing to select
        // and the screen-share tests hang until they time out. Headed mode needs a display
        // to draw into, which is why CI runs this suite under xvfb-run (see ci.yml).
        headless: false,
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-permissions',
            // Without this, getDisplayMedia() blocks forever on Chromium's native
            // screen/window picker, which no test flag can click through headlessly.
            '--auto-select-desktop-capture-source=Entire screen',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: '..',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

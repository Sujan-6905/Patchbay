import { expect, test, type Page } from '@playwright/test';

async function countLiveVideoElements(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll('video')).filter((video) => {
        const stream = video.srcObject as MediaStream | null;
        return stream?.getVideoTracks().some((track) => track.readyState === 'live') ?? false;
      }).length,
  );
}

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto('/');
  // The home page repeats its primary CTA (nav, hero, outro); any of them works.
  await page.getByRole('link', { name: 'Start a call' }).first().click();
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/room\/.+/);
  return page.url();
}

/** Joins a room via a direct link (no pre-call screen visit), as a shared-link recipient would. */
async function joinRoomDirectly(page: Page, roomUrl: string, name: string): Promise<void> {
  await page.goto(roomUrl);
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByRole('button', { name: 'Join' }).click();
}

test('two participants create/join a room and both see two live video tracks', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');

  await expect
    .poll(() => countLiveVideoElements(pageA), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => countLiveVideoElements(pageB), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  // Each side should also learn the other's display name (relayed via room:join/room:peer-joined).
  await expect(pageA.getByText('Bob')).toBeVisible();
  await expect(pageB.getByText('Alice')).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('closing a peer notifies the other side and the server drops the empty room', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');

  await expect
    .poll(() => countLiveVideoElements(pageA), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  // Exercises server-side disconnect handling so a closed tab doesn't leak the room.
  await contextB.close();

  await expect.poll(() => countLiveVideoElements(pageA), { timeout: 5_000 }).toBeLessThan(2);

  // A is still in the room, so it should survive with one member, not be deleted outright.
  await expect
    .poll(
      async () => {
        const res = await pageA.request.get('/api/health');
        const body = (await res.json()) as { rooms: number; members: number };
        return body;
      },
      { timeout: 5_000 },
    )
    .toEqual({ status: 'ok', uptimeSeconds: expect.any(Number), rooms: 1, members: 1 });

  await contextA.close();

  // Now the room is empty and should be deleted immediately on the last member's disconnect.
  const finalHealth = await fetch('http://localhost:5001/api/health').then((r) => r.json());
  expect(finalHealth.rooms).toBe(0);
});

test('three participants mesh: everyone sees the other two, and a leave updates the rest', async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ permissions: ['camera', 'microphone'] })),
  );
  const [pageA, pageB, pageC] = await Promise.all(contexts.map((c) => c.newPage()));

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');
  await joinRoomDirectly(pageC, roomUrl, 'Cara');

  // Each of the 3 pages should end up with itself + two live remote tracks = 3 tiles.
  for (const page of [pageA, pageB, pageC]) {
    await expect
      .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3);
  }
  await expect(pageA.getByText('Bob')).toBeVisible();
  await expect(pageA.getByText('Cara')).toBeVisible();
  await expect(pageB.getByText('Alice')).toBeVisible();
  await expect(pageB.getByText('Cara')).toBeVisible();
  await expect(pageC.getByText('Alice')).toBeVisible();
  await expect(pageC.getByText('Bob')).toBeVisible();

  // Cara leaves; Alice and Bob should each drop back to 2 live tiles within ~2s.
  await contexts[2].close();
  await expect.poll(() => countLiveVideoElements(pageA), { timeout: 5_000 }).toBe(2);
  await expect.poll(() => countLiveVideoElements(pageB), { timeout: 5_000 }).toBe(2);
  await expect(pageA.getByText('Cara')).not.toBeVisible();
  await expect(pageB.getByText('Cara')).not.toBeVisible();

  await contexts[0].close();
  await contexts[1].close();
});

test("a lone participant's video tile is not oversized", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();

  await createRoom(page, 'Solo');
  await expect
    .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  const box = await page.locator('video').first().boundingBox();
  expect(box?.width).toBeLessThanOrEqual(480);

  await context.close();
});

test('screen share shows the presenter’s camera and screen as separate tiles, and only one presenter at a time', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');

  await expect
    .poll(() => countLiveVideoElements(pageA), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  await pageA.getByRole('button', { name: 'Share screen' }).click();

  // Bob should now see 3 live tiles: his own camera, Alice's camera, and Alice's screen.
  await expect
    .poll(() => countLiveVideoElements(pageB), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(3);
  await expect(pageB.getByText(/Alice.s screen/)).toBeVisible();

  // Alice sees her own camera tile plus a separate self screen-preview tile.
  await expect
    .poll(() => countLiveVideoElements(pageA), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(3);
  await expect(pageA.getByText(/Your screen/)).toBeVisible();

  // Only one participant may present at a time.
  await expect(pageB.getByRole('button', { name: 'Share screen' })).toBeDisabled();

  await pageA.getByRole('button', { name: 'Stop sharing' }).click();
  await expect.poll(() => countLiveVideoElements(pageB), { timeout: 10_000 }).toBe(2);
  await expect(pageB.getByText(/Alice.s screen/)).not.toBeVisible();
  await expect(pageB.getByRole('button', { name: 'Share screen' })).toBeEnabled();

  await contextA.close();
  await contextB.close();
});

test('chat, reactions, and file transfer propagate over data channels across 3 peers', async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 3 }, () => browser.newContext({ permissions: ['camera', 'microphone'] })),
  );
  const [pageA, pageB, pageC] = await Promise.all(contexts.map((c) => c.newPage()));

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');
  await joinRoomDirectly(pageC, roomUrl, 'Cara');

  for (const page of [pageA, pageB, pageC]) {
    await expect
      .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(3);
  }

  for (const page of [pageA, pageB, pageC]) {
    await page.getByRole('button', { name: 'Chat' }).click();
  }

  // Chat: Alice's message reaches both Bob and Cara with no server relay involved. The data
  // channel's own SCTP handshake can lag behind media, especially with three connections
  // negotiating close together, so this allows more headroom than the video-liveness check above.
  await pageA.getByPlaceholder('Message').fill('hello everyone');
  await pageA.getByRole('button', { name: 'Send' }).click();
  await expect(pageB.getByText('hello everyone')).toBeVisible({ timeout: 20_000 });
  await expect(pageC.getByText('hello everyone')).toBeVisible({ timeout: 20_000 });

  // Reactions: Bob's burst is visible on Alice's and Cara's copies of his tile. It auto-hides
  // after a few seconds, so re-trigger on each retry rather than racing one click against
  // delivery latency.
  // The per-attempt window matches the reaction's own 3s on-screen lifetime: under CI load,
  // data-channel delivery can exceed 1s, which made a tighter window fail rounds where the
  // reaction demonstrably arrived (it was present in the failure snapshot). Checked on both
  // receivers concurrently so the first wait can't eat the second one's display window.
  await expect(async () => {
    await pageB.getByRole('button', { name: 'React' }).click();
    await pageB.getByRole('button', { name: '🎉' }).click();
    await Promise.all([
      expect(pageA.getByText('🎉')).toBeVisible({ timeout: 3_000 }),
      expect(pageC.getByText('🎉')).toBeVisible({ timeout: 3_000 }),
    ]);
  }).toPass({ timeout: 20_000 });

  // File transfer: chunked + reassembled, byte-identical on both receivers.
  const fileContent = 'x'.repeat(500_000);
  await pageA.setInputFiles('input[type="file"]', {
    name: 'test.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(fileContent),
  });

  for (const page of [pageB, pageC]) {
    const downloadLink = page.getByRole('link', { name: 'Download' });
    await expect(downloadLink).toBeVisible({ timeout: 20_000 });
    const href = await downloadLink.getAttribute('href');
    if (!href) throw new Error('expected a blob: download href');
    const downloaded = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return res.text();
    }, href);
    expect(downloaded).toBe(fileContent);
  }

  await Promise.all(contexts.map((c) => c.close()));
});

test('captions: speech is transcribed in the background, and the CC toggle controls display on each side', async ({
  browser,
}) => {
  // Two full WebRTC contexts plus several UI round-trips (chat open/close, a CC click per
  // side), comfortably over the default budget on a loaded machine.
  test.slow();
  const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });

  // Headless Chromium's real SpeechRecognition has no mic input or speech-service network
  // access to produce a deterministic result, so it's stubbed before any page script runs;
  // useCaptions() feature-detects window.SpeechRecognition/webkitSpeechRecognition once at
  // mount, so this must land before that check, which addInitScript guarantees. The fake
  // emits a final result repeatedly (recognition now runs for the whole call, so a
  // fire-once fake would have spoken before the CC toggle was ever clicked).
  await contextA.addInitScript(() => {
    interface FakeResult extends Array<{ transcript: string }> {
      isFinal: boolean;
    }
    class FakeSpeechRecognition extends EventTarget {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((event: { resultIndex: number; results: FakeResult[] }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      private intervalId: ReturnType<typeof setInterval> | undefined;
      start() {
        this.intervalId = setInterval(() => {
          const result = Object.assign([{ transcript: 'hello from a fake microphone' }], {
            isFinal: true,
          }) as FakeResult;
          this.onresult?.({ resultIndex: 0, results: [result] });
        }, 500);
      }
      stop() {
        clearInterval(this.intervalId);
      }
    }
    const globalWindow = window as unknown as Record<string, unknown>;
    globalWindow.SpeechRecognition = FakeSpeechRecognition;
    globalWindow.webkitSpeechRecognition = FakeSpeechRecognition;
  });

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');

  await expect
    .poll(() => countLiveVideoElements(pageA), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  // With the CC overlay still OFF, transcription runs silently: nothing is displayed, but
  // the transcript accumulates, proven by the Summarize section appearing in Alice's chat
  // panel (it only renders once the transcript is non-empty).
  await expect(pageA.getByText('hello from a fake microphone')).not.toBeVisible();
  await pageA.getByRole('button', { name: 'Chat' }).click();
  await expect(pageA.getByRole('button', { name: 'Summarize meeting' })).toBeVisible({
    timeout: 10_000,
  });
  await pageA.getByRole('button', { name: 'Close chat' }).click();

  // Turning CC on shows Alice her own captions.
  const ccButton = pageA.getByRole('button', { name: 'CC' });
  await expect(ccButton).toBeEnabled();
  await ccButton.click();
  await expect(pageA.getByText('hello from a fake microphone')).toBeVisible({ timeout: 5_000 });

  // Bob receives the caption DataChannel messages regardless, but only sees the overlay
  // once he turns his own CC toggle on; display is a per-viewer choice.
  await pageB.getByRole('button', { name: 'CC' }).click();
  await expect(pageB.getByText('hello from a fake microphone')).toBeVisible({ timeout: 20_000 });

  await contextA.close();
  await contextB.close();
});

test('recording composites the call and downloads a non-empty webm file', async ({ browser }) => {
  const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');

  await expect
    .poll(() => countLiveVideoElements(pageA), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  await pageA.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(pageA.getByText(/Recording \d+:\d+/)).toBeVisible({ timeout: 5_000 });

  // Let the MediaRecorder collect at least one timeslice of real composited frames/audio.
  await pageA.waitForTimeout(2_000);

  const downloadPromise = pageA.waitForEvent('download');
  await pageA.getByRole('button', { name: 'Stop recording' }).click();
  const download = await downloadPromise;

  // .mp4 where the browser has an AAC encoder (real Chrome), .webm elsewhere (this Chromium).
  expect(download.suggestedFilename()).toMatch(/^patchbay-recording-.+\.(webm|mp4)$/);
  const downloadStream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of downloadStream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(0);

  await contextA.close();
  await contextB.close();
});

test('starting a screen share mid-recording keeps the recording running instead of freezing it', async ({
  browser,
}) => {
  // Recording stop now includes deliberate finalization work (duration patch + decode
  // probe) on top of two WebRTC contexts, needs more than the default budget under load.
  test.slow();
  const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');

  await expect
    .poll(() => countLiveVideoElements(pageA), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  await pageA.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(pageA.getByText(/Recording \d+:\d+/)).toBeVisible({ timeout: 5_000 });
  await pageA.waitForTimeout(1_000);

  // Start screen sharing partway through the recording; this is the scenario that used to
  // freeze the composite (the recorder's source list was captured once at Record-click time
  // and never updated as new tiles appeared).
  await pageA.getByRole('button', { name: 'Share screen' }).click();
  await expect(pageA.getByText(/Your screen/)).toBeVisible({ timeout: 10_000 });

  // The recording timer must keep advancing (not frozen) with the screen tile now present.
  const secondsAtShareStart = await pageA
    .getByText(/Recording \d+:\d+/)
    .textContent()
    .then((text) => text ?? '');
  await pageA.waitForTimeout(2_000);
  await expect(pageA.getByText(/Recording \d+:\d+/)).not.toHaveText(secondsAtShareStart);

  const downloadPromise = pageA.waitForEvent('download');
  await pageA.getByRole('button', { name: 'Stop recording' }).click();
  const download = await downloadPromise;

  const downloadStream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of downloadStream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(0);

  // The page must still be alive and functional afterward, not crashed.
  await expect(pageA.getByRole('button', { name: 'Record', exact: true })).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test('starting and stopping screen share repeatedly during a recording does not freeze it', async ({
  browser,
}) => {
  const contextA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const contextB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const pageErrors: string[] = [];
  pageA.on('pageerror', (err) => pageErrors.push(err.message));

  const roomUrl = await createRoom(pageA, 'Alice');
  await joinRoomDirectly(pageB, roomUrl, 'Bob');

  await expect
    .poll(() => countLiveVideoElements(pageA), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  await pageA.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(pageA.getByText(/Recording \d+:\d+/)).toBeVisible({ timeout: 5_000 });

  for (let i = 0; i < 3; i++) {
    await pageA.getByRole('button', { name: 'Share screen' }).click();
    await expect(pageA.getByText(/Your screen/)).toBeVisible({ timeout: 10_000 });
    await pageA.waitForTimeout(600);
    await pageA.getByRole('button', { name: 'Stop sharing' }).click();
    await expect(pageA.getByText(/Your screen/)).not.toBeVisible({ timeout: 10_000 });
    await pageA.waitForTimeout(600);
  }

  // The recording must have survived every add/remove cycle: still advancing, no crash.
  const secondsAfterCycling = await pageA
    .getByText(/Recording \d+:\d+/)
    .textContent()
    .then((text) => text ?? '');
  await pageA.waitForTimeout(2_000);
  await expect(pageA.getByText(/Recording \d+:\d+/)).not.toHaveText(secondsAfterCycling);
  // XNNPACK's own init log ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU") is
  // benign; Chromium surfaces it as a console.error-typed message despite being an INFO log,
  // and it's the expected one-time startup line for the CPU delegate (see backgroundBlur.ts;
  // GPU delegate is deliberately not used because of a documented Safari mask-corruption bug).
  expect(pageErrors.filter((e) => !e.includes('favicon') && !e.includes('XNNPACK'))).toEqual([]);

  const downloadPromise = pageA.waitForEvent('download');
  await pageA.getByRole('button', { name: 'Stop recording' }).click();
  const download = await downloadPromise;
  const downloadStream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of downloadStream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).byteLength).toBeGreaterThan(0);

  await contextA.close();
  await contextB.close();
});

test('a recording spanning a blur toggle downloads full-length, seekable, and gap-free', async ({
  browser,
}) => {
  // Reported failure: with blur enabled from (say) second 3 to 8 of a 10s recording, that
  // span was missing/corrupt in the downloaded file, and files opened with unknown duration.
  // This drives the exact sequence and then probes the actual downloaded bytes: duration must
  // be finite (the EBML duration patch) and close to wall-clock, and playing the file back
  // must show no large jump between consecutive video frames (the missing-span symptom).
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();

  await createRoom(page, 'Alice');
  await expect
    .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/Recording \d+:\d+/)).toBeVisible({ timeout: 5_000 });
  const recordStartMs = Date.now();
  await page.waitForTimeout(2_000);

  const blurButton = page.getByRole('button', { name: 'Blur: off' });
  await expect(blurButton).toBeEnabled();
  await blurButton.click();
  await expect(page.getByRole('button', { name: 'Blur: on' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3_000);
  // Turn blur back off, unless the sandbox's slow GPU already auto-degraded it off.
  if (await page.getByRole('button', { name: 'Blur: on' }).isVisible()) {
    await page.getByRole('button', { name: 'Blur: on' }).click();
  }
  await page.waitForTimeout(2_000);

  const recordedSeconds = (Date.now() - recordStartMs) / 1000;
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Stop recording' }).click();
  const download = await downloadPromise;
  const downloadStream = await download.createReadStream();
  const buffers: Buffer[] = [];
  for await (const chunk of downloadStream) buffers.push(chunk as Buffer);
  const base64 = Buffer.concat(buffers).toString('base64');

  const probe = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('downloaded recording failed to decode'));
    });
    const duration = video.duration;
    let lastMediaTime: number | null = null;
    let maxFrameGap = 0;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.playbackRate = 4;
      const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (lastMediaTime !== null) {
          maxFrameGap = Math.max(maxFrameGap, meta.mediaTime - lastMediaTime);
        }
        lastMediaTime = meta.mediaTime;
        video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);
      await video.play();
      await new Promise<void>((resolve) => {
        video.onended = () => resolve();
        setTimeout(() => resolve(), 20_000);
      });
    } else {
      maxFrameGap = -1;
    }
    URL.revokeObjectURL(url);
    return { duration, maxFrameGap };
  }, base64);

  // Finite and roughly wall-clock length: the raw MediaRecorder blob reports Infinity.
  expect(Number.isFinite(probe.duration)).toBe(true);
  expect(probe.duration).toBeGreaterThan(recordedSeconds - 2);
  expect(probe.duration).toBeLessThan(recordedSeconds + 2);
  // No stretch of the timeline may be missing its frames (-1 = probe API unavailable).
  if (probe.maxFrameGap !== -1) expect(probe.maxFrameGap).toBeLessThan(2);

  await context.close();
});

test('background blur runs for several seconds without crashing or throwing', async ({
  browser,
}) => {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  await createRoom(page, 'Alice');
  await expect
    .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  const blurButton = page.getByRole('button', { name: 'Blur: off' });
  await expect(blurButton).toBeEnabled({ timeout: 5_000 });
  await blurButton.click();
  await expect(page.getByRole('button', { name: 'Blur: on' })).toBeVisible({ timeout: 15_000 });

  // The original bug (overlapping, non-monotonically-timestamped segmentForVideo calls from
  // scheduling the next rAF tick before the previous segmentation's callback had fired) needed
  // real sustained running time to surface; give it several seconds of real frames. This
  // sandbox's software-only GPU delegate is slow enough that the *legitimate* fps-based
  // auto-degrade (unrelated to the bug being tested here) may also kick in and turn blur back
  // off on its own; that's a designed, acceptable outcome, not a crash. What must NOT happen
  // is an uncaught error, or the app becoming unresponsive.
  await page.waitForTimeout(8_000);

  // XNNPACK's own init log ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU") is
  // benign; Chromium surfaces it as a console.error-typed message despite being an INFO log,
  // and it's the expected one-time startup line for the CPU delegate (see backgroundBlur.ts;
  // GPU delegate is deliberately not used because of a documented Safari mask-corruption bug).
  expect(pageErrors.filter((e) => !e.includes('favicon') && !e.includes('XNNPACK'))).toEqual([]);

  // Must still be fully interactive either way, not frozen/crashed.
  await page.getByRole('button', { name: 'Stats' }).click();
  await expect(page.getByText('Connection stats')).toBeVisible({ timeout: 5_000 });

  await context.close();
});

test('background blur output keeps producing frames and does not freeze', async ({ browser }) => {
  // The reported production bug was a FREEZE: blur renders correctly for ~1-2s, then the output
  // canvas stops updating (loop silently wedged) while blur is still enabled: a frozen frame,
  // no error, the rest of the UI still responsive. The other blur tests only check "no crash /
  // still interactive", which a frozen-but-alive loop passes. This asserts the actual thing that
  // broke: that the blurred output stream keeps presenting NEW frames over time.
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();

  await createRoom(page, 'Alice');
  await expect
    .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  const blurButton = page.getByRole('button', { name: 'Blur: off' });
  await expect(blurButton).toBeEnabled({ timeout: 5_000 });
  await blurButton.click();
  await expect(page.getByRole('button', { name: 'Blur: on' })).toBeVisible({ timeout: 15_000 });

  // Let blur get well past the ~1-2s mark where the freeze used to hit, then count how many
  // frames the local (blurred) video element actually presents over a ~2.5s window via
  // requestVideoFrameCallback. A wedged loop presents ~0; a live one presents dozens. The fake
  // media device drives real, changing frames, so this is a faithful liveness probe. Skip the
  // assertion only if blur legitimately auto-degraded back off (sandbox GPU is slow); that's a
  // designed fallback, not the freeze, and leaves the "Blur: off" button visible again.
  await page.waitForTimeout(3_000);
  const stillOn = await page.getByRole('button', { name: 'Blur: on' }).isVisible();
  if (stillOn) {
    const framesPresented = await page.evaluate(async () => {
      const video = document.querySelector('video');
      if (!video || typeof video.requestVideoFrameCallback !== 'function') return -1;
      return await new Promise<number>((resolve) => {
        let count = 0;
        const tick = () => {
          count += 1;
          video.requestVideoFrameCallback(tick);
        };
        video.requestVideoFrameCallback(tick);
        setTimeout(() => resolve(count), 2_500);
      });
    });
    // -1 means the API is unavailable in this browser build; only assert when we could measure.
    // Threshold is deliberately loose (a couple of fps): software-GL CI runs composite slowly
    // under load, and the *content* check below is the real freeze detector; this only guards
    // against the loop being fully wedged (0 frames).
    if (framesPresented !== -1) expect(framesPresented).toBeGreaterThan(3);

    // Frames being *presented* is necessary but not sufficient: the feedback-loop regression
    // (the blur canvas segmenting its own captureStream output after the outgoing-track swap
    // spliced the canvas track into localStream) kept repainting the canvas every tick with
    // IDENTICAL content: rVFC still fired at full rate while the image sat visually frozen.
    // So also assert the pixels themselves change: the fake camera's test pattern is in
    // constant motion, so any healthy pipeline shows a large frame-to-frame difference.
    const pixelDelta = await page.evaluate(async () => {
      const video = document.querySelector('video');
      if (!video) return -1;
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return -1;
      const sample = () => {
        ctx.drawImage(video, 0, 0, size, size);
        return ctx.getImageData(0, 0, size, size).data;
      };
      const before = sample();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const after = sample();
      let delta = 0;
      for (let i = 0; i < before.length; i += 1) delta += Math.abs(before[i]! - after[i]!);
      return delta;
    });
    if (pixelDelta !== -1) expect(pixelDelta).toBeGreaterThan(1_000);
  }

  // Turning blur off must restore the live camera feed. Under the feedback-loop regression the
  // raw camera track had been spliced OUT of localStream (replaced by the canvas track), so
  // disabling blur "restored" the frozen canvas track and the tile stayed dead forever.
  // (If blur already auto-degraded off, slow sandbox GPU, skip the click and just verify
  // the camera is live, which is the same recovery guarantee.)
  if (await page.getByRole('button', { name: 'Blur: on' }).isVisible()) {
    await page.getByRole('button', { name: 'Blur: on' }).click();
  }
  await expect(page.getByRole('button', { name: 'Blur: off' })).toBeVisible({ timeout: 10_000 });
  const cameraDelta = await page.evaluate(async () => {
    const video = document.querySelector('video');
    if (!video) return -1;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return -1;
    const sample = () => {
      ctx.drawImage(video, 0, 0, size, size);
      return ctx.getImageData(0, 0, size, size).data;
    };
    const before = sample();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const after = sample();
    let delta = 0;
    for (let i = 0; i < before.length; i += 1) delta += Math.abs(before[i]! - after[i]!);
    return delta;
  });
  if (cameraDelta !== -1) expect(cameraDelta).toBeGreaterThan(1_000);

  await context.close();
});

test('rapidly toggling background blur does not corrupt the shared segmenter', async ({
  browser,
}) => {
  // The segmenter (an ImageSegmenter instance) is a module-level singleton shared across every
  // BackgroundBlurProcessor instance for load-time reasons. Toggling blur off/on recreates the
  // processor each time; if an old instance's in-flight segmentForVideo call is still pending
  // on the shared segmenter when a new instance starts calling it too, the two can interleave.
  // This drives exactly that handoff repeatedly and checks nothing throws or wedges.
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  await createRoom(page, 'Alice');
  await expect
    .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: /^Blur:/ }).click();
    await page.waitForTimeout(250);
  }

  // Give any in-flight segmentation calls time to settle either way.
  await page.waitForTimeout(3_000);
  // XNNPACK's own init log ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU") is
  // benign; Chromium surfaces it as a console.error-typed message despite being an INFO log,
  // and it's the expected one-time startup line for the CPU delegate (see backgroundBlur.ts;
  // GPU delegate is deliberately not used because MediaPipe's mask post-processing always uses
  // WebGL regardless of delegate, and that context can be lost on some hardware).
  expect(pageErrors.filter((e) => !e.includes('favicon') && !e.includes('XNNPACK'))).toEqual([]);

  // Must still be interactive: the room itself is unaffected regardless of blur's end state.
  await page.getByRole('button', { name: 'Chat' }).click();
  await expect(page.getByPlaceholder('Message')).toBeVisible({ timeout: 5_000 });

  await context.close();
});

test('an unexpectedly ended camera track is auto-recovered without leaving the room', async ({
  browser,
}) => {
  // Simulates the failure mode reported on real hardware: the camera's own track can end
  // outside this app's control (driver reset, OS-level resource contention). Previously that
  // left the tile permanently frozen with no recovery but a full page refresh, which also
  // dropped the user out of the room. `useLocalMedia` now listens for the track's own `ended`
  // event and re-acquires automatically; this drives that path directly via the track itself,
  // the same signal a real hardware failure would produce, rather than guessing at symptoms.
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();

  await createRoom(page, 'Alice');
  await expect
    .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  // `track.stop()` deliberately does NOT fire `ended` per spec (that event is reserved for
  // unexpected termination); `stop()` is a deliberate call the caller already knows about; this
  // also means the app's own device-switching code, which does call `.stop()` on purpose, can
  // never spuriously trigger this recovery path). Dispatch the event directly to simulate what
  // an actual external failure looks like from this app's point of view.
  await page.evaluate(() => {
    const video = document.querySelector('video');
    const stream = video?.srcObject as MediaStream | null;
    stream?.getVideoTracks()[0]?.dispatchEvent(new Event('ended'));
  });

  // Must recover to a live video track again without ever navigating away from the room.
  await expect
    .poll(() => countLiveVideoElements(page), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1);
  expect(page.url()).toMatch(/\/room\/.+/);

  // Must still be fully interactive post-recovery.
  await page.getByRole('button', { name: 'Chat' }).click();
  await expect(page.getByPlaceholder('Message')).toBeVisible({ timeout: 5_000 });

  await context.close();
});

test('a 5th participant is rejected once the room is full (4/4)', async ({ browser }) => {
  const contexts = await Promise.all(
    Array.from({ length: 5 }, () => browser.newContext({ permissions: ['camera', 'microphone'] })),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));

  const roomUrl = await createRoom(pages[0]!, 'P1');
  for (let i = 1; i < 4; i++) {
    await joinRoomDirectly(pages[i]!, roomUrl, `P${i + 1}`);
  }
  for (const page of pages.slice(0, 4)) {
    await expect
      .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(4);
  }

  // Joining via a direct link when full: Room's own join ack surfaces the error.
  await pages[4]!.goto(roomUrl);
  await pages[4]!.getByPlaceholder('Your name').fill('P5');
  await pages[4]!.getByRole('button', { name: 'Join' }).click();
  await expect(pages[4]!.getByText(/room is full \(4\/4\)/i)).toBeVisible({ timeout: 10_000 });

  // Joining via the "Join a meeting" / "Enter room code" flow: the pre-check surfaces the
  // error inline, without ever navigating to /room/:id.
  const joinPage = pages[4]!;
  await joinPage.goto('/');
  // The home page repeats this CTA (hero and outro); either one works.
  await joinPage.getByRole('link', { name: 'Join with a code' }).first().click();
  await joinPage.getByPlaceholder('Your name').fill('P5');
  await joinPage.getByPlaceholder('Enter room code').fill(roomUrl.split('/').pop()!);
  await joinPage.getByRole('button', { name: 'Join' }).click();
  await expect(joinPage.getByText(/room is full \(4\/4\)/i)).toBeVisible({ timeout: 10_000 });
  expect(joinPage.url()).not.toMatch(/\/room\//);

  await Promise.all(contexts.map((c) => c.close()));
});

test('a video tile can be made full screen and minimized back', async ({ browser }) => {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();

  await createRoom(page, 'Alice');
  await expect
    .poll(() => countLiveVideoElements(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);

  const fullscreenButton = page.getByRole('button', { name: 'Full screen' });
  await fullscreenButton.click();

  await expect(page.getByRole('button', { name: 'Exit full screen' })).toBeVisible({
    timeout: 5_000,
  });
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null))
    .toBe(true);

  await page.getByRole('button', { name: 'Exit full screen' }).click();

  await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible({ timeout: 5_000 });
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null))
    .toBe(false);

  await context.close();
});

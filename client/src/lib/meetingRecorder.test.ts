import { describe, expect, it, vi } from 'vitest';
import { computeFit, gridCell, pickSupportedMimeType } from './meetingRecorder';

describe('gridCell', () => {
  it('places a single tile across the full 1280x720 canvas', () => {
    expect(gridCell(0, 1)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it('splits two tiles into a 2x1 row', () => {
    expect(gridCell(0, 2)).toEqual({ x: 0, y: 0, w: 640, h: 720 });
    expect(gridCell(1, 2)).toEqual({ x: 640, y: 0, w: 640, h: 720 });
  });

  it('arranges four tiles into a 2x2 grid', () => {
    expect(gridCell(0, 4)).toEqual({ x: 0, y: 0, w: 640, h: 360 });
    expect(gridCell(1, 4)).toEqual({ x: 640, y: 0, w: 640, h: 360 });
    expect(gridCell(2, 4)).toEqual({ x: 0, y: 360, w: 640, h: 360 });
    expect(gridCell(3, 4)).toEqual({ x: 640, y: 360, w: 640, h: 360 });
  });

  it('gives three tiles a 2x2 grid with one empty cell (2 cols, ceil(3/2)=2 rows)', () => {
    expect(gridCell(0, 3)).toEqual({ x: 0, y: 0, w: 640, h: 360 });
    expect(gridCell(2, 3)).toEqual({ x: 0, y: 360, w: 640, h: 360 });
  });
});

describe('computeFit', () => {
  it('cover crops a wider-than-cell video to fill the cell, centered horizontally', () => {
    // 1920x1080 (16:9) into a 640x640 (1:1) cell: scale to cover height, overflow width.
    const fit = computeFit('cover', 1920, 1080, 640, 640);
    expect(fit.height).toBeCloseTo(640);
    expect(fit.width).toBeCloseTo((1920 / 1080) * 640);
    expect(fit.width).toBeGreaterThan(640);
    expect(fit.offsetY).toBeCloseTo(0);
    expect(fit.offsetX).toBeCloseTo((640 - fit.width) / 2);
  });

  it('contain letterboxes a wider-than-cell video to fit entirely inside, no crop', () => {
    // Same 16:9-into-1:1 case, but 'contain' must never exceed the cell in either dimension;
    // this is the fix for screen-share content getting cropped in the recording.
    const fit = computeFit('contain', 1920, 1080, 640, 640);
    expect(fit.width).toBeCloseTo(640);
    expect(fit.height).toBeCloseTo((1080 / 1920) * 640);
    expect(fit.height).toBeLessThan(640);
    expect(fit.offsetX).toBeCloseTo(0);
    expect(fit.offsetY).toBeCloseTo((640 - fit.height) / 2);
  });

  it('cover and contain agree when content and cell share an aspect ratio', () => {
    const cover = computeFit('cover', 1280, 720, 640, 360);
    const contain = computeFit('contain', 1280, 720, 640, 360);
    expect(cover).toEqual(contain);
    expect(cover).toEqual({ width: 640, height: 360, offsetX: 0, offsetY: 0 });
  });
});

describe('pickSupportedMimeType', () => {
  it('prefers MP4 (H.264 + AAC) when the platform supports it: the Windows Media Player-compatible container', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
    expect(pickSupportedMimeType()).toBe('video/mp4;codecs=avc1.640028,mp4a.40.2');
    vi.unstubAllGlobals();
  });

  it('falls back to VP8 webm when MP4 recording is unsupported', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (type: string) => type === 'video/webm;codecs=vp8,opus',
    });
    expect(pickSupportedMimeType()).toBe('video/webm;codecs=vp8,opus');
    vi.unstubAllGlobals();
  });

  it('falls back to an empty string when nothing is supported', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false });
    expect(pickSupportedMimeType()).toBe('');
    vi.unstubAllGlobals();
  });
});

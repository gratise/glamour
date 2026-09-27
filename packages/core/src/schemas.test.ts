import { describe, expect, it } from 'vitest';
import {
  browserSettingsSchema,
  referenceBundleSchema,
  referenceScreenshotSchema,
  viewportSchema,
} from './schemas.js';

describe('public schema contracts', () => {
  it('defaults new reference bundles to schema version 1 and empty structured sections', () => {
    const bundle = referenceBundleSchema.parse({
      screenshots: [
        {
          referenceId: 'desktop',
          path: 'screenshots/desktop.png',
          viewport: { width: 1440, height: 900 },
        },
      ],
    });

    expect(bundle.schemaVersion).toBe('1');
    expect(bundle.screenshots[0]?.viewport.deviceScaleFactor).toBe(1);
    expect(bundle.assets).toEqual([]);
    expect(bundle.scene).toEqual([]);
    expect(bundle.interactions).toEqual([]);
    expect(bundle.uncertainties).toEqual([]);
    expect(bundle.gradients).toEqual([]);
    expect(bundle.effects).toEqual([]);
  });

  it('rejects invalid viewport, screenshot hash, and provenance confidence', () => {
    expect(() => viewportSchema.parse({ width: 0, height: 900 })).toThrow();
    expect(() =>
      referenceScreenshotSchema.parse({
        referenceId: 'desktop',
        path: 'desktop.png',
        sha256: 'not-a-hash',
        viewport: { width: 1440, height: 900 },
      }),
    ).toThrow();
    expect(() =>
      referenceBundleSchema.parse({
        screenshots: [
          {
            referenceId: 'desktop',
            path: 'desktop.png',
            viewport: { width: 1440, height: 900 },
          },
        ],
        textBlocks: [{ id: 'title', bbox: [0, 0, 100, 20], text: 'Title', confidence: 2 }],
      }),
    ).toThrow();
  });

  it('pins deterministic browser defaults and validates readiness budgets', () => {
    const settings = browserSettingsSchema.parse({});
    expect(settings.locale).toBe('en-US');
    expect(settings.timezoneId).toBe('UTC');
    expect(settings.disableAnimations).toBe(true);
    expect(settings.randomSeed).toBe(1);
    expect(() => browserSettingsSchema.parse({ timeoutMs: 0 })).toThrow();
  });

  it('keeps machine measurements separate from semantic interpretation', () => {
    const node = referenceBundleSchema.parse({
      screenshots: [
        {
          referenceId: 'desktop',
          path: 'desktop.png',
          viewport: { width: 1440, height: 900 },
        },
      ],
      scene: [
        {
          id: 'node-1',
          bbox: [10, 20, 300, 48],
          measurement: { bbox: [10, 20, 300, 48], provenance: 'measured', confidence: 1 },
          interpretation: {
            role: 'hero-title',
            provenance: 'estimated',
            confidence: 0.6,
          },
        },
      ],
    }).scene[0]!;

    expect(node.measurement?.provenance).toBe('measured');
    expect(node.interpretation?.provenance).toBe('estimated');
  });
});

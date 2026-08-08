import { describe, expect, it } from 'vitest';
import { apiUrl } from './apiBase';

describe('apiUrl', () => {
  it('prefixes a path with the configured base (empty in this test env)', () => {
    expect(apiUrl('/api/health')).toBe('/api/health');
  });
});

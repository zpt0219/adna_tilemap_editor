import { describe, expect, it } from 'vitest';
import { languageOrDefault } from './i18n';

describe('languageOrDefault', () => {
  it('keeps supported persisted languages', () => {
    expect(languageOrDefault('zh')).toBe('zh');
    expect(languageOrDefault('en')).toBe('en');
  });

  it('falls back for missing or stale persisted values', () => {
    expect(languageOrDefault(null)).toBe('zh');
    expect(languageOrDefault(undefined)).toBe('zh');
    expect(languageOrDefault('fr')).toBe('zh');
  });
});

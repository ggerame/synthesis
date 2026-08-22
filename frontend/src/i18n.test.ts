import { describe, expect, it } from 'vitest';
import { detectBrowserLanguage, messages, parseRoute, translate } from './i18n';

describe('i18n', () => {
  it('has a non-empty translation for every language and message', () => {
    for (const values of Object.values(messages)) {
      expect(values).toHaveLength(7);
      for (const value of values) expect(value.trim()).not.toBe('');
    }
  });

  it('detects supported browser languages and falls back to English', () => {
    expect(detectBrowserLanguage(['it-IT'])).toBe('Italian');
    expect(detectBrowserLanguage(['zh-CN', 'pt-BR'])).toBe('Portuguese');
    expect(detectBrowserLanguage(['zh-CN'])).toBe('English');
  });

  it('interpolates messages', () => {
    expect(translate('Italian', 'attempt', { current: 2, max: 3 })).toContain('2');
  });
});

describe('hash routing', () => {
  it('keeps the existing routes', () => {
    expect(parseRoute('#/')).toEqual({ page: 'feed' });
    expect(parseRoute('#/settings')).toEqual({ page: 'settings' });
    expect(parseRoute('#/video/abc')).toEqual({ page: 'detail', id: 'abc' });
  });
});

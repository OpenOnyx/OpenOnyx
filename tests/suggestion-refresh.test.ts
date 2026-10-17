import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSuggestionRefresh, SuggestionContentCache } from '../src/utils/suggestion-refresh';

afterEach(() => vi.useRealTimers());
describe('visible suggestion refresh', () => {
  it('coalesces rapid changes and keeps progressing under continuous indexing', () => {
    vi.useFakeTimers(); const run = vi.fn(); const refresh = createSuggestionRefresh(run);
    for (let i = 0; i < 10; i++) refresh.schedule();
    vi.advanceTimersByTime(300); expect(run).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) { refresh.schedule(); vi.advanceTimersByTime(100); }
    expect(run).toHaveBeenCalledTimes(2);
    refresh.cancel(); vi.runAllTimers(); expect(run).toHaveBeenCalledTimes(2);
  });
  it('bounds and expires note content and supports explicit invalidation', () => {
    vi.useFakeTimers(); const cache = new SuggestionContentCache();
    for (let i = 0; i < 50; i++) cache.set(`${i}`, 'content');
    expect(cache.get('0')).toBeUndefined(); expect(cache.get('49')).toBe('content');
    cache.delete('49'); expect(cache.get('49')).toBeUndefined();
    vi.advanceTimersByTime(5001); expect(cache.get('48')).toBeUndefined();
    cache.clear();
  });
});

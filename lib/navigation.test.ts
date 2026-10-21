import { describe, expect, it, vi } from 'vitest';
import { goBack } from './navigation';

function fakeRouter(canGoBack: boolean) {
  return { canGoBack: vi.fn(() => canGoBack), back: vi.fn(), replace: vi.fn() };
}

describe('goBack', () => {
  it('pops when there is history to unwind', () => {
    const router = fakeRouter(true);
    goBack(router, '/clubs/c1/games');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  // A deep link, a web reload or a cold launch has nothing to pop. The
  // fallback replaces rather than pushes, so the screen being left is not
  // one browser-back away.
  it('replaces with the fallback when there is nothing to pop', () => {
    const router = fakeRouter(false);
    goBack(router, '/clubs/c1/games');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/clubs/c1/games');
  });
});

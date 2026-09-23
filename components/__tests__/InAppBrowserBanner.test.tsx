/**
 * Platform.OS is 'web' by default in this suite (see vitest.config.mts), so
 * these tests only need to stub `navigator.userAgent` -- jsdom's own is a
 * getter-only property, hence the `defineProperty` rather than a plain
 * assignment, and it's restored after every test so one spec's UA can't
 * leak into the next.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InAppBrowserBanner from '../InAppBrowserBanner';

const originalUserAgent = navigator.userAgent;

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value,
    configurable: true,
  });
}

afterEach(() => {
  setUserAgent(originalUserAgent);
});

describe('InAppBrowserBanner', () => {
  it('renders nothing in a real browser', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15');
    const { container } = render(<InAppBrowserBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('warns by name when opened inside a known in-app browser', () => {
    setUserAgent('Mozilla/5.0 (iPhone) YahooMobileMail/6.30.2');
    render(<InAppBrowserBanner />);
    expect(screen.getByRole('alert').textContent).toContain('the Yahoo Mail app');
  });

  it('copies the current URL when "Copy link" is pressed', async () => {
    setUserAgent('Mozilla/5.0 (iPhone) YahooMobileMail/6.30.2');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<InAppBrowserBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await screen.findByRole('button', { name: 'Copied!' });
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it('dismisses and stays dismissed', () => {
    setUserAgent('Mozilla/5.0 (iPhone) YahooMobileMail/6.30.2');
    const { container } = render(<InAppBrowserBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.firstChild).toBeNull();
  });
});

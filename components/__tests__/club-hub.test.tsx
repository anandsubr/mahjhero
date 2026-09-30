import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Club } from '../../lib/clubs';

const shareClubCode = vi.fn();
vi.mock('../../lib/club-hub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/club-hub')>();
  return {
    ...actual,
    shareClubCode: (...args: unknown[]) => shareClubCode(...args),
  };
});

import ClubHubHeader from '../hub/ClubHubHeader';
import SectionButtons from '../hub/SectionButtons';

const CLUB: Club = {
  id: 'c1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private',
  timezone: 'America/New_York',
  default_game_mode: 'open_play',
  code: 'RIVER24',
  cover_path: null,
  cover_color: 'accent_700',
};

function renderHeader(overrides: Partial<Parameters<typeof ClubHubHeader>[0]> = {}) {
  const props = {
    club: CLUB,
    coverUrl: null,
    canManage: false,
    active: 'games' as const,
    onBack: vi.fn(),
    onSettings: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  render(<ClubHubHeader {...props} />);
  return props;
}

beforeEach(() => {
  shareClubCode.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClubHubHeader', () => {
  it('uses the club cover colour when there is no cover photo', () => {
    renderHeader();
    const header = screen.getByTestId('club-hub-header');
    // accent[700] (#8c491a) -- the club's own cover_color, not the default green.
    expect(getComputedStyle(header).backgroundColor).toBe('rgb(140, 73, 26)');
    expect(screen.queryByTestId('club-hub-cover-photo')).toBeNull();
  });

  it('shows the cover photo with a scrim when there is a cover URL', () => {
    renderHeader({ coverUrl: 'https://example.com/cover.jpg' });
    expect(screen.getByTestId('club-hub-cover-photo')).toBeTruthy();
    const scrim = screen.getByTestId('club-hub-scrim');
    // neutral[900] (#2e2b25) at 55%.
    expect(getComputedStyle(scrim).backgroundColor).toBe('rgba(46, 43, 37, 0.55)');
  });

  it('shows the club name and code', () => {
    renderHeader();
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Club code: RIVER24')).toBeTruthy();
  });

  it('shows the settings gear only to organizers', () => {
    renderHeader({ canManage: false });
    expect(screen.queryByLabelText('Club settings')).toBeNull();
  });

  it('gear and back call their handlers', () => {
    const props = renderHeader({ canManage: true });
    fireEvent.click(screen.getByLabelText('Club settings'));
    expect(props.onSettings).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Back to home'));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('Share calls shareClubCode and shows "Copied" for 2 seconds when copied', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    shareClubCode.mockResolvedValue('copied');
    renderHeader();
    fireEvent.click(screen.getByLabelText('Share club code'));
    expect(shareClubCode).toHaveBeenCalledWith('Riverside Mah Jongg', 'RIVER24');
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Copied')).toBeNull();
    expect(screen.getByText('Share')).toBeTruthy();
  });

  it('keeps "Share" when the native sheet was used', async () => {
    shareClubCode.mockResolvedValue('shared');
    renderHeader();
    fireEvent.click(screen.getByLabelText('Share club code'));
    await waitFor(() => expect(shareClubCode).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText('Copied')).toBeNull();
  });
});

describe('SectionButtons', () => {
  it('renders the five sections in order and marks the active one selected', () => {
    render(<SectionButtons active="games" onSelect={vi.fn()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Board', 'Games', 'Photos', 'Members', 'Ranks',
    ]);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual([
      'false', 'true', 'false', 'false', 'false',
    ]);
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('calls onSelect with the tapped section', () => {
    const onSelect = vi.fn();
    render(<SectionButtons active="games" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Members' }));
    expect(onSelect).toHaveBeenCalledWith('members');
  });
});

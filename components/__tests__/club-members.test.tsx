import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ClubMembers, { type ClubMembersHandle } from '../ClubMembers';
import type { Club } from '../../lib/clubs';

const fetchRoster = vi.fn();
const fetchPendingInvites = vi.fn();
const createInvite = vi.fn();
const sendClubInviteEmail = vi.fn();
const deleteInvite = vi.fn();

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
    fetchPendingInvites: (...args: unknown[]) => fetchPendingInvites(...args),
    createInvite: (...args: unknown[]) => createInvite(...args),
    sendClubInviteEmail: (...args: unknown[]) => sendClubInviteEmail(...args),
    deleteInvite: (...args: unknown[]) => deleteInvite(...args),
  };
});

const isVisible = vi.fn((_key: string) => true);
const dismiss = vi.fn();
vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible, dismiss, reset: vi.fn() }),
}));

const CLUB: Club = {
  id: 'c1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private',
  timezone: 'America/New_York',
  default_game_mode: 'open_play',
  code: 'TEST1',
  cover_path: null,
  cover_color: 'accent2_800',
};

const MEMBER_ROLE = [
  { profile_id: 'test-user', role: 'member' as const, display_name: 'Ada', skill_level: null },
];
const HOST_ROLE = [
  { profile_id: 'test-user', role: 'host' as const, display_name: 'Ada', skill_level: null },
];

const PENDING_INVITE = {
  id: 'invite-1',
  email: 'ben@example.com',
  display_name: 'Ben',
  skill_level: null,
  declined_at: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  isVisible.mockImplementation(() => true);
  fetchRoster.mockResolvedValue(MEMBER_ROLE);
  fetchPendingInvites.mockResolvedValue([]);
  createInvite.mockResolvedValue({ id: 'new-invite', error: null });
  sendClubInviteEmail.mockResolvedValue({ error: null });
  deleteInvite.mockResolvedValue({ error: null });
});

/**
 * Moved from app/__tests__/guides-tips.test.tsx's "club page tip" describe
 * and app/__tests__/club-code.test.tsx / clubs.test.tsx's roster/invite
 * assertions against app/clubs/[id]/legacy.tsx (club-hub phase 2, Task 10):
 * ClubMembers owns the roster, pending invites and invite form now, so
 * those assertions moved here, unchanged in substance. The club code row,
 * Leaderboard and thread buttons stayed on legacy.tsx (Settings, Task 11) --
 * this file never exercises them.
 */
describe('ClubMembers', () => {
  it('renders the member list', async () => {
    fetchRoster.mockResolvedValue(MEMBER_ROLE);
    render(<ClubMembers club={CLUB} role="member" />);
    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(screen.getByText('1 member')).toBeTruthy();
  });

  it('shows the invite form and pending invites to an organizer', async () => {
    fetchRoster.mockResolvedValue(HOST_ROLE);
    fetchPendingInvites.mockResolvedValue([PENDING_INVITE]);
    render(<ClubMembers club={CLUB} role="host" />);
    await screen.findByText('Ada');
    expect(screen.getByText('1 invited')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getByLabelText('Email address to invite')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeTruthy();
  });

  it('hides the invite form and pending invites from a plain member', async () => {
    fetchRoster.mockResolvedValue(MEMBER_ROLE);
    fetchPendingInvites.mockResolvedValue([]);
    render(<ClubMembers club={CLUB} role="member" />);
    await screen.findByText('Ada');
    expect(screen.queryByLabelText('Email address to invite')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send invite' })).toBeNull();
  });

  it('calls resendInvite and deleteInvite from the pending invite row', async () => {
    fetchRoster.mockResolvedValue(HOST_ROLE);
    fetchPendingInvites.mockResolvedValue([PENDING_INVITE]);
    render(<ClubMembers club={CLUB} role="host" />);
    await screen.findByText('Ben');

    fireEvent.click(screen.getByLabelText('Resend the invite email to Ben'));
    expect(sendClubInviteEmail).toHaveBeenCalledWith('invite-1');

    fireEvent.click(screen.getByLabelText('Delete the invite for Ben'));
    expect(deleteInvite).toHaveBeenCalledWith('invite-1');
  });

  it('shows the "Bringing people in" tip to an organizer, and dismisses it with its key', async () => {
    fetchRoster.mockResolvedValue(HOST_ROLE);
    render(<ClubMembers club={CLUB} role="host" />);
    expect(await screen.findByText('Bringing people in')).toBeTruthy();
    // Not the brief's own bare /Invite by email/ and /Import a roster/: the
    // "Invite by email" TextField label renders as its own visible text
    // too -- anchored to the fuller phrases, unique to the tip's own copy.
    expect(screen.getByText(/Use Invite by email for one person/)).toBeTruthy();
    expect(screen.getByText(/Import a roster for a whole list/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Got it: Bringing people in' }));
    expect(dismiss).toHaveBeenCalledWith('tip:club');
  });

  it('does not show the tip to a plain member', async () => {
    fetchRoster.mockResolvedValue(MEMBER_ROLE);
    render(<ClubMembers club={CLUB} role="member" />);
    await screen.findByText('Ada');
    expect(screen.queryByText('Bringing people in')).toBeNull();
  });

  it('shows the imported-roster confirmation card when importedCount is set', async () => {
    fetchRoster.mockResolvedValue(HOST_ROLE);
    render(<ClubMembers club={CLUB} role="host" importedCount={3} />);
    expect(await screen.findByText(/3 invitations sent\./)).toBeTruthy();
  });

  it('exposes reload() for HubSection pull-to-refresh', async () => {
    fetchRoster.mockResolvedValue(MEMBER_ROLE);
    const ref = createRef<ClubMembersHandle>();
    render(<ClubMembers ref={ref} club={CLUB} role="member" />);
    await screen.findByText('Ada');
    expect(fetchRoster).toHaveBeenCalledTimes(1);

    fetchRoster.mockResolvedValue(HOST_ROLE);
    await ref.current?.reload();
    expect(fetchRoster).toHaveBeenCalledTimes(2);
  });
});

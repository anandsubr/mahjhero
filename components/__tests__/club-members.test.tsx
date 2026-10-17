import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClubMembers, { type ClubMembersHandle } from '../ClubMembers';
import type { Club } from '../../lib/clubs';
import { GENERIC_ERROR } from '../../lib/constants';

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

const fetchFriends = vi.fn();
const addFriend = vi.fn();
vi.mock('../../lib/friends', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/friends')>();
  return {
    ...actual,
    fetchFriends: (...args: unknown[]) => fetchFriends(...args),
    addFriend: (...args: unknown[]) => addFriend(...args),
  };
});

const createGroupThread = vi.fn();
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    createGroupThread: (...args: unknown[]) => createGroupThread(...args),
  };
});

const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'test-user' } }, loading: false }),
}));

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

// Three members, deliberately out of order: Task 1's orderMembers puts the
// host first, then the rest by name.
const THREE = [
  { profile_id: 'p-zed', role: 'member' as const, display_name: 'Zed Quinn', skill_level: null },
  { profile_id: 'test-user', role: 'member' as const, display_name: 'Ada', skill_level: 'beginner' as const },
  { profile_id: 'p-priya', role: 'host' as const, display_name: 'Priya Shah', skill_level: 'advanced' as const },
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
  fetchFriends.mockResolvedValue([]);
  addFriend.mockResolvedValue({ error: null });
  createGroupThread.mockResolvedValue({ id: 'thread-9', error: null });
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
    expect(await screen.findByText('Ada (you)')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search 1 member')).toBeTruthy();
  });

  it('shows the invite form and pending invites to an organizer', async () => {
    fetchRoster.mockResolvedValue(HOST_ROLE);
    fetchPendingInvites.mockResolvedValue([PENDING_INVITE]);
    render(<ClubMembers club={CLUB} role="host" />);
    await screen.findByText('Ada (you)');
    expect(screen.getByText('1 invited')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
    // The form opens from the 48pt invite button in the top row.
    expect(screen.queryByLabelText('Email address to invite')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone by email' }));
    expect(screen.getByLabelText('Email address to invite')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeTruthy();
  });

  it('hides the invite form and pending invites from a plain member', async () => {
    fetchRoster.mockResolvedValue(MEMBER_ROLE);
    fetchPendingInvites.mockResolvedValue([]);
    render(<ClubMembers club={CLUB} role="member" />);
    await screen.findByText('Ada (you)');
    expect(screen.queryByLabelText('Email address to invite')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send invite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite someone by email' })).toBeNull();
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
    expect(screen.getByText(/Import a roster in Club settings for a whole list/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Got it: Bringing people in' }));
    expect(dismiss).toHaveBeenCalledWith('tip:club');
  });

  it('does not show the tip to a plain member', async () => {
    fetchRoster.mockResolvedValue(MEMBER_ROLE);
    render(<ClubMembers club={CLUB} role="member" />);
    await screen.findByText('Ada (you)');
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
    await screen.findByText('Ada (you)');
    expect(fetchRoster).toHaveBeenCalledTimes(1);

    fetchRoster.mockResolvedValue(HOST_ROLE);
    await ref.current?.reload();
    expect(fetchRoster).toHaveBeenCalledTimes(2);
  });

  it('loads friends alongside the roster and reload() refreshes them', async () => {
    fetchRoster.mockResolvedValue(THREE);
    const ref = createRef<ClubMembersHandle>();
    render(<ClubMembers ref={ref} club={CLUB} role="member" />);
    await screen.findByText('Ada (you)');
    expect(fetchFriends).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Add Zed Quinn as a friend' })).toBeTruthy();

    fetchFriends.mockResolvedValue([{ profile_id: 'p-zed', display_name: 'Zed Quinn', club_names: [] }]);
    await act(async () => {
      await ref.current?.reload();
    });
    expect(fetchFriends).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Add Zed Quinn as a friend' })).toBeNull();
  });
});

describe('ClubMembers redesign', () => {
  async function renderThree(role: 'member' | 'host' = 'member') {
    fetchRoster.mockResolvedValue(THREE);
    render(<ClubMembers club={CLUB} role={role} />);
    await screen.findByText('Ada (you)');
  }

  it('orders hosts first, then by name', async () => {
    await renderThree();
    const names = ['Priya Shah', 'Ada (you)', 'Zed Quinn'].map((n) => screen.getByText(n));
    expect(names[0].compareDocumentPosition(names[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(names[1].compareDocumentPosition(names[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('searches by name as you type', async () => {
    await renderThree();
    fireEvent.change(screen.getByPlaceholderText('Search 3 members'), { target: { value: 'pri' } });
    expect(screen.getByText('Priya Shah')).toBeTruthy();
    expect(screen.queryByText('Zed Quinn')).toBeNull();
    expect(screen.queryByText('Ada (you)')).toBeNull();
  });

  it('shows the no-match line for a query with surrounding spaces and no match', async () => {
    await renderThree();
    fireEvent.change(screen.getByPlaceholderText('Search 3 members'), { target: { value: '  xyz ' } });
    expect(screen.getByText('No members match “xyz”.')).toBeTruthy();
  });

  it('toggles Show: Everyone / Show: Hosts', async () => {
    await renderThree();
    fireEvent.click(screen.getByRole('button', { name: 'Show: Everyone' }));
    expect(screen.getByRole('button', { name: 'Show: Hosts' })).toBeTruthy();
    expect(screen.getByText('Priya Shah')).toBeTruthy();
    expect(screen.queryByText('Zed Quinn')).toBeNull();
    expect(screen.queryByText('Ada (you)')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Search 3 members'), { target: { value: 'zed' } });
    expect(screen.getByText('No members match “zed”.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show: Hosts' }));
    expect(screen.getByText('Zed Quinn')).toBeTruthy();
  });

  it('says there are no hosts when the Hosts filter matches nobody and there is no query', async () => {
    fetchRoster.mockResolvedValue(THREE.filter((m) => m.role !== 'host'));
    render(<ClubMembers club={CLUB} role="member" />);
    await screen.findByText('Ada (you)');
    fireEvent.click(screen.getByRole('button', { name: 'Show: Everyone' }));
    expect(screen.getByText('No hosts in this club yet.')).toBeTruthy();
  });

  it('toggles the invite form from the invite button for an organizer', async () => {
    await renderThree('host');
    const inviteButton = screen.getByRole('button', { name: 'Invite someone by email' });
    fireEvent.click(inviteButton);
    expect(screen.getByLabelText('Email address to invite')).toBeTruthy();
    fireEvent.click(inviteButton);
    expect(screen.queryByLabelText('Email address to invite')).toBeNull();
  });

  it('opens the one-to-one chat from Message, once on a double tap', async () => {
    let resolve: (v: { id: string; error: null }) => void = () => {};
    createGroupThread.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await renderThree();
    const button = screen.getByRole('button', { name: 'Message Zed Quinn' });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {
      resolve({ id: 'thread-9', error: null });
    });
    expect(createGroupThread).toHaveBeenCalledTimes(1);
    expect(createGroupThread).toHaveBeenCalledWith('', ['p-zed']);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/messages/thread-9');
  });

  it('shows the generic error when Message fails, and allows another try', async () => {
    createGroupThread.mockResolvedValue({ id: null, error: 'boom' });
    await renderThree();
    fireEvent.click(screen.getByRole('button', { name: 'Message Zed Quinn' }));
    expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: 'Message Zed Quinn' });
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('shows "Friend" after a successful Add friend, without a reload', async () => {
    await renderThree();
    fireEvent.click(screen.getByRole('button', { name: 'Add Zed Quinn as a friend' }));
    expect(addFriend).toHaveBeenCalledWith('p-zed');
    expect(await screen.findByText('Friend')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Zed Quinn as a friend' })).toBeNull();
    expect(fetchRoster).toHaveBeenCalledTimes(1);
    expect(fetchFriends).toHaveBeenCalledTimes(1);
  });

  it('shows the refusal and returns the button to idle when Add friend fails', async () => {
    addFriend.mockResolvedValue({ error: 'you can only add someone from one of your clubs' });
    await renderThree();
    fireEvent.click(screen.getByRole('button', { name: 'Add Zed Quinn as a friend' }));
    expect(await screen.findByText('you can only add someone from one of your clubs')).toBeTruthy();
    expect(screen.queryByText('Friend')).toBeNull();
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Add Zed Quinn as a friend' });
      expect(button.getAttribute('aria-disabled')).not.toBe('true');
    });
  });

  it('still shows the roster when friends fail to load', async () => {
    fetchFriends.mockResolvedValue(null);
    await renderThree();
    expect(screen.getByText('Zed Quinn')).toBeTruthy();
  });
});

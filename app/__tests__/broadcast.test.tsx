import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Broadcast from '../clubs/[id]/broadcast';

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: { id: 'c1' } as Record<string, string> }));

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, replace, back: vi.fn() }),
  useLocalSearchParams: () => params.current,
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

// Return type annotated explicitly, same reason as sendBroadcast below:
// without it TS narrows to this first value's literal type, and the later
// `mockResolvedValue(null)` (needed for the roster-read-failure test) fails
// to type-check against that literal.
const fetchRoster = vi.hoisted(() =>
  vi.fn(async (): Promise<
    { profile_id: string; role: string; display_name: string; skill_level: null }[] | null
  > => [{ profile_id: 'me', role: 'host', display_name: 'Me', skill_level: null }]),
);

// `canInvite` stays real -- it is pure, and it is the exact host-or-
// co-organizer test this screen is supposed to reuse rather than
// reimplementing its own notion of "organizer".
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return { ...actual, fetchRoster };
});

// Return type annotated explicitly, same reason as sendBroadcast below:
// without it TS narrows to the literal `14` of this first value, and the
// later `mockResolvedValue(null)` (needed for the failed-count tests) fails
// to type-check against that literal.
const countBroadcastRecipients = vi.hoisted(() =>
  vi.fn(async (): Promise<number | null> => 14),
);
// Return type annotated explicitly: without it, TS narrows the mock's return
// type to the literal `{ id: string; error: null }` of this first value, and
// the later `mockResolvedValue({ id: null, error: 'not an organizer' })`
// (needed for the refusal test) fails to type-check against that literal.
const sendBroadcast = vi.hoisted(() =>
  vi.fn(async (): Promise<{ id: string | null; error: string | null }> => ({
    id: 'b1',
    error: null,
  })),
);

vi.mock('../../lib/broadcasts', async () => {
  const actual = await vi.importActual<typeof import('../../lib/broadcasts')>(
    '../../lib/broadcasts',
  );
  return { ...actual, countBroadcastRecipients, sendBroadcast };
});

async function compose(subject: string, body: string) {
  render(<Broadcast />);
  await screen.findByLabelText('Subject');
  fireEvent.change(screen.getByLabelText('Subject'), { target: { value: subject } });
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: body } });
}

describe('broadcast compose screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    params.current = { id: 'c1' };
    countBroadcastRecipients.mockResolvedValue(14);
    sendBroadcast.mockResolvedValue({ id: 'b1', error: null });
    fetchRoster.mockResolvedValue([
      { profile_id: 'me', role: 'host', display_name: 'Me', skill_level: null },
    ]);
  });

  // The count is the thing that makes the confirmation meaningful. "Send
  // this?" is a different question from "send this to 14 people?".
  it('says how many people this reaches before anything is sent', async () => {
    render(<Broadcast />);
    expect(await screen.findByText(/14 members/)).toBeTruthy();
  });

  it('reaches only the booked when it is scoped to a game', async () => {
    params.current = { id: 'c1', eventId: 'e1' };
    render(<Broadcast />);
    await waitFor(() =>
      expect(countBroadcastRecipients).toHaveBeenCalledWith('c1', 'e1'),
    );
  });

  // A broadcast is irreversible and outward-facing. One tap must not send.
  it('does not send on the first tap', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByLabelText('Yes, send it')).toBeTruthy());
    expect(sendBroadcast).not.toHaveBeenCalled();
  });

  it('sends once confirmed', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Yes, send it'));
    await waitFor(() =>
      expect(sendBroadcast).toHaveBeenCalledWith(
        'c1', null, 'Doors at seven', 'The side entrance is locked.',
      ),
    );
  });

  it('goes to the sent history afterwards, replacing rather than pushing', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Yes, send it'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs/c1/broadcasts'));
    // `push` would leave this screen on the back stack underneath the
    // history screen -- `replace` is what stops back navigation from
    // returning to it at all. See the "back to a primed second send" test
    // below for what happens when that guarantee doesn't hold.
    expect(push).not.toHaveBeenCalledWith('/clubs/c1/broadcasts');
  });

  // The regression test for the double-send bug: `push` used to leave this
  // screen mounted with `confirming` still true and the typed message still
  // in state, so returning to it via back navigation (which this component
  // staying mounted simulates) showed a primed "Yes, send it" ready to fire
  // again. Clearing the form and closing the confirmation on success is
  // what makes a second tap here impossible rather than merely unlikely.
  it('clears the confirmation and the typed message after a successful send', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Yes, send it'));
    await waitFor(() => expect(replace).toHaveBeenCalled());

    expect(screen.queryByLabelText('Yes, send it')).toBeNull();
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('');
    // Disabled because the (now-empty) message is no longer valid to send --
    // the same guard that stops the very first empty-message send.
    expect(screen.getByLabelText('Send').getAttribute('aria-disabled')).toBe('true');
  });

  // An empty message must not be sendable at all — the check constraint
  // would reject it with an error nobody can act on.
  it('will not send an empty message', async () => {
    await compose('', '');
    expect(screen.getByLabelText('Send').getAttribute('aria-disabled')).toBe('true');
  });

  // A refusal must reach the member as words. The defect this guards
  // against is a send button that silently does nothing.
  it('shows a refusal rather than swallowing it', async () => {
    sendBroadcast.mockResolvedValue({ id: null, error: 'not an organizer' });
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Yes, send it'));
    expect(await screen.findByText('not an organizer')).toBeTruthy();
    // The implementation closes the confirmation before setting the error
    // (setConfirming(false) then setError(...)) -- a stale "Yes, send it"
    // left standing next to the error would read as the send still being
    // pending. Pin that it actually closes, not just that the words appear.
    expect(screen.queryByLabelText('Yes, send it')).toBeNull();
  });

  // countBroadcastRecipients resolves null on failure the same way it does
  // while still loading -- recipients alone can't tell them apart. The
  // screen must not read a permanent failure as "still working it out"
  // forever: it must say so, offer a retry, and still let the host send.
  it('says so and offers a retry when the recipient count fails', async () => {
    countBroadcastRecipients.mockResolvedValue(null);
    render(<Broadcast />);
    expect(
      await screen.findByText(/Could not work out who this reaches/),
    ).toBeTruthy();
    expect(screen.queryByText(/Working out who this reaches/)).toBeNull();

    countBroadcastRecipients.mockResolvedValue(7);
    fireEvent.click(screen.getByLabelText('Try counting recipients again'));
    expect(await screen.findByText(/7 members/)).toBeTruthy();
  });

  // A failed count must not block sending -- send_broadcast counts its own
  // recipients server-side and never reads this number. It must also not
  // paper over the failure with the old `${recipients ?? 'the'}` phrasing.
  it('still lets the host send when the recipient count failed', async () => {
    countBroadcastRecipients.mockResolvedValue(null);
    await compose('Doors at seven', 'The side entrance is locked.');
    await screen.findByText(/Could not work out who this reaches/);
    fireEvent.click(screen.getByLabelText('Send'));
    expect(
      await screen.findByText('Send this without a confirmed recipient count?'),
    ).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Yes, send it'));
    await waitFor(() =>
      expect(sendBroadcast).toHaveBeenCalledWith(
        'c1', null, 'Doors at seven', 'The side entrance is locked.',
      ),
    );
  });

  it('lets the member back out of the confirmation', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Keep editing'));
    await waitFor(() => expect(screen.queryByLabelText('Yes, send it')).toBeNull());
    expect(sendBroadcast).not.toHaveBeenCalled();
  });

  // The route is reachable by URL even though the entry-point button that
  // links here is already hidden from a plain member. Without this gate,
  // that member saw "Sending still works" (copy meant for an organizer
  // whose count RPC failed) and, after typing and confirming, the
  // database's raw `not an organizer of this club` refusal.
  describe('when the viewer is not an organizer', () => {
    beforeEach(() => {
      fetchRoster.mockResolvedValue([
        { profile_id: 'me', role: 'member', display_name: 'Me', skill_level: null },
      ]);
    });

    it('refuses honestly instead of opening the compose form', async () => {
      render(<Broadcast />);
      expect(
        await screen.findByText(/Only a club's host or co-organizers can message/),
      ).toBeTruthy();
      expect(screen.queryByLabelText('Subject')).toBeNull();
      expect(screen.queryByLabelText('Send')).toBeNull();
    });
  });

  // A roster-fetch failure is not the same statement as "you are not an
  // organizer" -- `fetchRoster` resolves null for ANY failure, including a
  // network blip against a genuine host. Reading that as "not an
  // organizer" told a real host, on a bad connection, the affirmatively
  // false "Only a club's host or co-organizers can message the whole
  // club." This used to be pinned as the intended behaviour by a test
  // asserting exactly that text; it is wrong, and this block replaces it.
  describe('when the roster read fails', () => {
    beforeEach(() => {
      fetchRoster.mockResolvedValue(null);
    });

    it('says it could not check, rather than claiming the viewer is not an organizer', async () => {
      render(<Broadcast />);
      expect(
        await screen.findByText(/Couldn't check whether you can message/),
      ).toBeTruthy();
      expect(
        screen.queryByText(/Only a club's host or co-organizers can message/),
      ).toBeNull();
      expect(screen.queryByLabelText('Subject')).toBeNull();
    });

    it('lets the host retry the role check', async () => {
      render(<Broadcast />);
      await screen.findByText(/Couldn't check whether you can message/);

      fetchRoster.mockResolvedValue([
        { profile_id: 'me', role: 'host', display_name: 'Me', skill_level: null },
      ]);
      fireEvent.click(screen.getByLabelText('Try checking your role again'));

      expect(await screen.findByLabelText('Subject')).toBeTruthy();
    });
  });

  // The empty-clubId case (only reachable via a malformed route) must not
  // hang the screen on a spinner forever -- the organizer-check effect
  // used to return before ever setting `organizerReady`, which is exactly
  // what a missing id made it do.
  it('does not hang on a spinner when the route is missing its club id', async () => {
    params.current = { id: '' };
    render(<Broadcast />);
    expect(
      await screen.findByText(/Only a club's host or co-organizers can message/),
    ).toBeTruthy();
  });
});

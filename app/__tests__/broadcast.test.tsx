import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Broadcast from '../clubs/[id]/broadcast';

const push = vi.hoisted(() => vi.fn());
const params = vi.hoisted(() => ({ current: { id: 'c1' } as Record<string, string> }));

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn() }),
  useLocalSearchParams: () => params.current,
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const countBroadcastRecipients = vi.hoisted(() => vi.fn(async () => 14));
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

  it('goes to the sent history afterwards', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Yes, send it'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/clubs/c1/broadcasts'));
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
  });

  it('lets the member back out of the confirmation', async () => {
    await compose('Doors at seven', 'The side entrance is locked.');
    fireEvent.click(screen.getByLabelText('Send'));
    fireEvent.click(await screen.findByLabelText('Keep editing'));
    await waitFor(() => expect(screen.queryByLabelText('Yes, send it')).toBeNull());
    expect(sendBroadcast).not.toHaveBeenCalled();
  });
});

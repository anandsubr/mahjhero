import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchGreetings = vi.fn();
const addGreeting = vi.fn();
const updateGreeting = vi.fn();
const deleteGreeting = vi.fn();

vi.mock('../../lib/greetings', () => ({
  fetchGreetings: (...args: unknown[]) => fetchGreetings(...args),
  addGreeting: (...args: unknown[]) => addGreeting(...args),
  updateGreeting: (...args: unknown[]) => updateGreeting(...args),
  deleteGreeting: (...args: unknown[]) => deleteGreeting(...args),
}));

const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/greetings',
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
  Redirect: ({ href }: { href: string }) => <div data-testid={`redirect-${href}`} />,
}));

const session = { user: { id: 'you' } };
let sessionState: { session: typeof session | null; loading: boolean } = {
  session,
  loading: false,
};
vi.mock('../../lib/session', () => ({
  useSession: () => sessionState,
}));

// TabBar (carried by this screen) now calls `useUnreadCounts`, which reaches
// `fetchUnreadCounts`.
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

// TabBar also now calls useNotificationsUnread for its Alerts badge
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

import AdminGreetingsScreen from '../admin/greetings';

beforeEach(() => {
  sessionState = { session, loading: false };
  fetchGreetings.mockReset();
  fetchGreetings.mockResolvedValue([
    { id: 'g1', text: 'Ready to shuffle, {name}?', created_at: '2026-09-01T00:00:00Z' },
  ]);
  addGreeting.mockReset();
  addGreeting.mockResolvedValue({ error: null });
  updateGreeting.mockReset();
  updateGreeting.mockResolvedValue({ error: null });
  deleteGreeting.mockReset();
  deleteGreeting.mockResolvedValue({ error: null });
  push.mockReset();
});

describe('AdminGreetingsScreen', () => {
  it('lists the existing greetings', async () => {
    render(<AdminGreetingsScreen />);
    expect(await screen.findByText('Ready to shuffle, {name}?')).toBeTruthy();
  });

  it('adds a new greeting', async () => {
    render(<AdminGreetingsScreen />);
    await screen.findByText('Ready to shuffle, {name}?');
    fireEvent.change(screen.getByLabelText('New greeting'), {
      target: { value: 'Welcome back, {name}!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(addGreeting).toHaveBeenCalledWith('Welcome back, {name}!'));
  });

  it('deletes a greeting', async () => {
    render(<AdminGreetingsScreen />);
    await screen.findByText('Ready to shuffle, {name}?');
    fireEvent.click(screen.getByLabelText('Delete Ready to shuffle, {name}?'));
    await waitFor(() => expect(deleteGreeting).toHaveBeenCalledWith('g1'));
  });

  it('edits an existing greeting in place', async () => {
    render(<AdminGreetingsScreen />);
    await screen.findByText('Ready to shuffle, {name}?');
    fireEvent.click(screen.getByLabelText('Edit Ready to shuffle, {name}?'));
    const field = screen.getByLabelText('Edit greeting text');
    fireEvent.change(field, { target: { value: 'Updated greeting, {name}!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateGreeting).toHaveBeenCalledWith('g1', 'Updated greeting, {name}!'),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { replace, back, push, canGoBack } = vi.hoisted(() => ({
  replace: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
  canGoBack: vi.fn(() => true),
}));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useRouter: () => ({ replace, back, push, canGoBack }),
}));
vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'u' } }, loading: false }),
}));
const deleteAccount = vi.fn();
vi.mock('../../lib/account', () => ({ deleteAccount: () => deleteAccount() }));

import DeleteAccountScreen from '../delete-account';

beforeEach(() => vi.clearAllMocks());

describe('delete account screen', () => {
  it('lists what is deleted and warns it is permanent', () => {
    render(<DeleteAccountScreen />);
    expect(screen.getByText(/Your profile and sign-in/)).toBeTruthy();
    expect(screen.getByText(/released to the waitlist/)).toBeTruthy();
    expect(screen.getByText("This can't be undone.")).toBeTruthy();
  });

  it('does nothing until the confirmation is accepted', () => {
    render(<DeleteAccountScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.getByText('Delete your account?')).toBeTruthy();
  });

  it('deletes and goes to welcome on confirm', async () => {
    deleteAccount.mockResolvedValue({ error: null });
    render(<DeleteAccountScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    const buttons = screen.getAllByRole('button', { name: 'Delete my account' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/welcome?deleted=1'));
  });

  it('shows the error and stays on failure', async () => {
    deleteAccount.mockResolvedValue({ error: 'Nope, try again.' });
    render(<DeleteAccountScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    const buttons = screen.getAllByRole('button', { name: 'Delete my account' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText('Nope, try again.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});

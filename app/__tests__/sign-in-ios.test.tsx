import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Platform: { ...actual.Platform, OS: 'ios' } };
});
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
}));
vi.mock('../../lib/session', () => ({ useSession: () => ({ session: null, loading: false }) }));
vi.mock('../../lib/auth', () => ({
  availableProviders: () => ['google', 'apple'],
  isValidEmail: () => true,
  sendSignInCode: vi.fn(),
  verifySignInCode: vi.fn(),
  signInWithApple: vi.fn(async () => ({ error: null })),
  signInWithProvider: vi.fn(async () => ({ error: null })),
}));

import { signInWithApple, signInWithProvider } from '../../lib/auth';
import SignIn from '../sign-in';

beforeEach(() => vi.clearAllMocks());

describe('sign-in on iOS', () => {
  it('uses native Apple sign-in, not the web flow', async () => {
    render(<SignIn />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));
    });
    expect(signInWithApple).toHaveBeenCalled();
    expect(signInWithProvider).not.toHaveBeenCalledWith('apple');
  });
});

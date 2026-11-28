import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewMahjNightScreen from '../nights/new';

const push = vi.fn();
const replace = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useRouter: () => ({ push, replace }),
}));

const SESSION: { session: { user: { id: string } } | null; loading: boolean } = {
  session: { user: { id: 'me' } },
  loading: false,
};
vi.mock('../../lib/session', () => ({ useSession: () => SESSION }));

const createMahjNight = vi.fn();
vi.mock('../../lib/mahj-nights', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mahj-nights')>()),
  createMahjNight: (...a: unknown[]) => createMahjNight(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  SESSION.session = { user: { id: 'me' } };
  createMahjNight.mockResolvedValue({
    data: { clubId: 'c1', eventId: 'e1', linkToken: 'tok_abcdefghijklmnopqrstuvwx' },
    error: null,
  });
});

describe('Host a Mahj Night', () => {
  it('needs an address before it can be created', () => {
    render(<NewMahjNightScreen />);
    expect(screen.getByText('Host a Mahj Night')).toBeTruthy();
    const create = screen.getByRole('button', { name: 'Create the night' });
    expect(create.getAttribute('aria-disabled')).toBe('true');
  });

  it('creates the night and goes straight to its event page', async () => {
    render(<NewMahjNightScreen />);
    fireEvent.change(screen.getByLabelText('Name the night'), { target: { value: "Ellie's night" } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '12 Oak Lane' } });
    fireEvent.change(screen.getByLabelText('Area to show on the invite'), { target: { value: 'Suwanee' } });
    fireEvent.click(screen.getByRole('button', { name: '3 tables' }));
    fireEvent.click(screen.getByRole('button', { name: 'Peony theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create the night' }));
    await waitFor(() => expect(createMahjNight).toHaveBeenCalled());
    expect(createMahjNight.mock.calls[0][0]).toMatchObject({
      name: "Ellie's night",
      address: '12 Oak Lane',
      area: 'Suwanee',
      tables: 3,
      themeId: 'peony',
      beginnersWelcome: true,
      startTime: '19:00',
      durationMinutes: 180,
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/e/tok_abcdefghijklmnopqrstuvwx?created=1'));
  });

  it('shows the error when creating fails', async () => {
    createMahjNight.mockResolvedValueOnce({ data: null, error: 'That start time has already passed.' });
    render(<NewMahjNightScreen />);
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '12 Oak Lane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create the night' }));
    expect(await screen.findByText('That start time has already passed.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to sign in', () => {
    SESSION.session = null;
    render(<NewMahjNightScreen />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/sign-in');
  });
});

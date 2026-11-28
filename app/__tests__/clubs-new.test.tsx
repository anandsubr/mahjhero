import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewClubScreen from '../clubs/new';

const push = vi.fn();
const replace = vi.fn();
const params: { for?: string } = {};

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push, replace }),
  useLocalSearchParams: () => params,
  usePathname: () => '/clubs/new',
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const SESSION: { session: { user: { id: string } } | null; loading: boolean } = {
  session: { user: { id: 'me' } },
  loading: false,
};
const useSessionMock = vi.fn(() => SESSION);
vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const createClub = vi.fn();
vi.mock('../../lib/clubs', async (importOriginal) => {
  // Partial mock, not a bare replacement: ClubCodeField (rendered by this
  // screen since Task 11) imports normalizeClubCode from this same module,
  // so a full replacement would leave it undefined the moment the field's
  // TextInput fires onChangeText.
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    createClub: (...a: unknown[]) => createClub(...a),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  delete params.for;
  useSessionMock.mockReturnValue(SESSION);
  createClub.mockResolvedValue({ clubId: 'club-9', error: null });
});

describe('Start a group', () => {
  it('creates a group and navigates to it', async () => {
    render(<NewClubScreen />);
    fireEvent.change(screen.getByLabelText('Group name'), {
      target: { value: 'Oakfield Tiles' },
    });
    fireEvent.click(screen.getByLabelText('Create the group'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs/club-9/games'));
  });

  it('keeps Create the group disabled until the name has more than spaces', async () => {
    render(<NewClubScreen />);
    const create = screen.getByRole('button', { name: 'Create the group' });
    expect(create.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(create);
    expect(createClub).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: '   ' } });
    expect(create.getAttribute('aria-disabled')).toBe('true');

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Oak' } });
    expect(create.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('sends the usual day as the club rhythm', async () => {
    render(<NewClubScreen />);
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Oakfield Tiles' } });
    fireEvent.change(screen.getByLabelText('When do you usually play?'), {
      target: { value: 'Thursday evenings at the library' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create the group' }));
    await waitFor(() =>
      expect(createClub).toHaveBeenCalledWith(
        'Oakfield Tiles',
        'Thursday evenings at the library',
        '',
      ),
    );
  });

  it('previews the group as it is typed', () => {
    render(<NewClubScreen />);
    const preview = screen.getByTestId('club-preview');
    expect(preview.textContent).toContain('?');
    expect(preview.textContent).toContain('Your group');
    expect(preview.textContent).toContain('When you usually play');

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'oakfield' } });
    fireEvent.change(screen.getByLabelText('When do you usually play?'), { target: { value: 'Tuesdays' } });
    expect(preview.textContent).toContain('O');
    expect(preview.textContent).toContain('oakfield');
    expect(preview.textContent).toContain('Tuesdays');
  });

  it('shows the error when creating fails', async () => {
    createClub.mockResolvedValueOnce({ clubId: null, error: 'That name is taken.' });
    render(<NewClubScreen />);
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Oak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create the group' }));
    expect(await screen.findByText('That name is taken.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('closes to Home', async () => {
    render(<NewClubScreen />);
    await screen.findByText('Start a group');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
    expect(push).toHaveBeenCalledWith('/home');
  });

  it('passes the optional group code to createClub', async () => {
    createClub.mockResolvedValueOnce({ clubId: 'c1', error: null });
    render(<NewClubScreen />);
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'North Side' } });
    fireEvent.change(screen.getByLabelText('Group code (optional)'), {
      target: { value: 'north side' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create the group' }));
    await waitFor(() =>
      expect(createClub).toHaveBeenCalledWith('North Side', '', 'NORTHSIDE'),
    );
  });

  it('shows a taken code error', async () => {
    createClub.mockResolvedValueOnce({ clubId: null, error: 'That code is taken.' });
    render(<NewClubScreen />);
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'North Side' } });
    fireEvent.change(screen.getByLabelText('Group code (optional)'), {
      target: { value: 'OAK2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create the group' }));
    expect(await screen.findByText('That code is taken.')).toBeTruthy();
  });
});

describe('Host a Mahj Night (?for=night)', () => {
  beforeEach(() => {
    params.for = 'night';
  });

  it('names the night, then goes straight to its New game form', async () => {
    render(<NewClubScreen />);
    expect(screen.getByText('Host a Mahj Night')).toBeTruthy();
    expect(screen.queryByLabelText('When do you usually play?')).toBeNull();
    expect(screen.queryByLabelText('Group code (optional)')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name the night'), {
      target: { value: "Ellie's birthday" },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next: the night' }));
    await waitFor(() => expect(createClub).toHaveBeenCalledWith("Ellie's birthday", '', ''));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs/club-9/events/new'));
  });
});

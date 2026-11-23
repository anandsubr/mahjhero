import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchReports = vi.fn();
const resolveReport = vi.fn();
vi.mock('../../lib/moderation', async (orig) => ({
  ...(await orig<typeof import('../../lib/moderation')>()),
  fetchReports: (...a: unknown[]) => fetchReports(...a),
  resolveReport: (...a: unknown[]) => resolveReport(...a),
}));

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back, canGoBack: () => true }),
  usePathname: () => '/admin/reports',
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
  Redirect: ({ href }: { href: string }) => <div data-testid={`redirect-${href}`} />,
}));

const session = { user: { id: 'you' } };
let sessionState: { session: typeof session | null; loading: boolean } = { session, loading: false };
vi.mock('../../lib/session', () => ({ useSession: () => sessionState }));

import AdminReportsScreen from '../admin/reports';

const base = {
  details: null,
  createdAt: '2026-11-20T10:00:00Z',
  reporterName: 'Rita',
  reportedName: 'Sam',
  mediaKind: null,
  clubName: 'Tuesday Club',
};
const msg = { ...base, id: 'r1', kind: 'message', reason: 'harassment', excerpt: 'You are awful' };
const gone = { ...base, id: 'r2', kind: 'message', reason: 'spam', excerpt: null };
const profile = { ...base, id: 'r3', kind: 'profile', reason: 'other', excerpt: null, clubName: null };
const file = { ...base, id: 'r4', kind: 'club_media', reason: 'inappropriate', excerpt: 'rules.pdf', mediaKind: 'file' };

beforeEach(() => {
  sessionState = { session, loading: false };
  fetchReports.mockReset();
  fetchReports.mockResolvedValue({ data: [msg, gone, profile, file], error: null });
  resolveReport.mockReset();
  resolveReport.mockResolvedValue({ error: null });
});

describe('AdminReportsScreen', () => {
  it('lists open reports with their details', async () => {
    render(<AdminReportsScreen />);
    expect(await screen.findByText('Harassment or bullying')).toBeTruthy();
    expect(screen.getByText('You are awful')).toBeTruthy();
    expect(screen.getAllByText(/Reported by Rita/).length).toBe(4);
    expect(screen.getAllByText(/About Sam/).length).toBe(4);
    expect(screen.getByText('rules.pdf')).toBeTruthy();
    expect(screen.getAllByText(/Tuesday Club/).length).toBeGreaterThan(0);
  });

  it('offers only Dismiss for gone content and profile reports', async () => {
    render(<AdminReportsScreen />);
    await screen.findByText('Spam');
    expect(screen.getByText('Content already removed.')).toBeTruthy();
    // message + file reports get Remove content; gone + profile do not
    expect(screen.getAllByRole('button', { name: 'Remove content' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Dismiss' }).length).toBe(4);
  });

  it('removes content after confirming, and the row leaves', async () => {
    render(<AdminReportsScreen />);
    await screen.findByText('You are awful');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove content' })[0]);
    expect(resolveReport).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(resolveReport).toHaveBeenCalledWith('r1', 'remove'));
    await waitFor(() => expect(screen.queryByText('You are awful')).toBeNull());
  });

  it('dismisses a report without confirming', async () => {
    render(<AdminReportsScreen />);
    await screen.findByText('Spam');
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1]);
    await waitFor(() => expect(resolveReport).toHaveBeenCalledWith('r2', 'dismiss'));
    await waitFor(() => expect(screen.queryByText('Content already removed.')).toBeNull());
  });

  it('keeps the row and shows the error when resolving fails', async () => {
    resolveReport.mockResolvedValue({ error: 'Something went wrong.' });
    render(<AdminReportsScreen />);
    await screen.findByText('Spam');
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1]);
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
    expect(screen.getByText('Content already removed.')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    fetchReports.mockResolvedValue({ data: [], error: null });
    render(<AdminReportsScreen />);
    expect(await screen.findByText('No open reports.')).toBeTruthy();
  });

  it('tells a non-admin they cannot see reports', async () => {
    fetchReports.mockResolvedValue({ error: 'Only admins can see reports.' });
    render(<AdminReportsScreen />);
    expect(await screen.findByText('Only admins can see reports.')).toBeTruthy();
    expect(screen.queryByText('No open reports.')).toBeNull();
  });

  it('redirects when signed out', () => {
    sessionState = { session: null, loading: false };
    render(<AdminReportsScreen />);
    expect(screen.getByTestId('redirect-/sign-in')).toBeTruthy();
  });
});

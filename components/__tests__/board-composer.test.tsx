import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BoardComposer from '../board/BoardComposer';

const insets = vi.hoisted(() => ({ bottom: 0 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: insets.bottom }),
}));

const pickImages = vi.fn();
const compressImage = vi.fn();
const uploadAttachment = vi.fn();
vi.mock('../../lib/attachments', () => ({
  pickImages: (...a: unknown[]) => pickImages(...a),
  compressImage: (...a: unknown[]) => compressImage(...a),
  uploadAttachment: (...a: unknown[]) => uploadAttachment(...a),
  MAX_ATTACHMENTS: 4,
}));

const postMessage = vi.fn();
vi.mock('../../lib/messages', async (orig) => ({
  ...(await orig<typeof import('../../lib/messages')>()),
  postMessage: (...a: unknown[]) => postMessage(...a),
}));

const countBroadcastRecipients = vi.fn();
vi.mock('../../lib/broadcasts', () => ({
  countBroadcastRecipients: (...a: unknown[]) => countBroadcastRecipients(...a),
}));

beforeEach(() => {
  insets.bottom = 0;
  countBroadcastRecipients.mockReset();
  countBroadcastRecipients.mockResolvedValue(23);
  pickImages.mockReset();
  compressImage.mockReset();
  uploadAttachment.mockReset();
  postMessage.mockReset();
});

const postBtn = () => screen.getByRole('button', { name: 'Post' });
const field = () => screen.getByPlaceholderText('Write to the club');
const type = (v: string) => fireEvent.change(field(), { target: { value: v } });

async function addPhoto() {
  const i = uploadAttachment.mock.calls.length;
  pickImages.mockResolvedValueOnce([{ uri: `file://${i}.jpg`, width: 40, height: 30 }]);
  compressImage.mockResolvedValueOnce({ uri: `file://s${i}.jpg`, width: 40, height: 30 });
  uploadAttachment.mockResolvedValueOnce({ storagePath: `t1/${i}.jpg`, error: null });
  fireEvent.click(screen.getByLabelText('Attach an image'));
  fireEvent.click(screen.getByText('Choose from library'));
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(i + 1));
}

describe('BoardComposer', () => {
  it('disables Post when empty or whitespace-only, enables with text', () => {
    render(<BoardComposer threadId="t1" onPosted={() => {}} />);
    expect((postBtn() as HTMLButtonElement).disabled).toBe(true);
    type('   \n ');
    expect((postBtn() as HTMLButtonElement).disabled).toBe(true);
    type('hi');
    expect((postBtn() as HTMLButtonElement).disabled).toBe(false);
  });

  it('enables Post for a photo with no text and sends it', async () => {
    postMessage.mockResolvedValue({ id: 'p1', error: null });
    const onPosted = vi.fn();
    render(<BoardComposer threadId="t1" onPosted={onPosted} />);
    await addPhoto();
    await waitFor(() => expect((postBtn() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(postBtn());
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith('p1'));
    expect(postMessage).toHaveBeenCalledWith('t1', '', false, null, null, [
      { storage_path: 't1/0.jpg', width: 40, height: 30 },
    ]);
  });

  it('posts once on double tap, trims, clears and calls onPosted', async () => {
    let resolve!: (v: unknown) => void;
    postMessage.mockImplementation(() => new Promise((r) => (resolve = r)));
    const onPosted = vi.fn();
    render(<BoardComposer threadId="t1" onPosted={onPosted} />);
    type('  hello  ');
    fireEvent.click(postBtn());
    fireEvent.click(postBtn());
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith('t1', 'hello', false, null, null, []);
    await act(async () => resolve({ id: 'p9', error: null }));
    expect(onPosted).toHaveBeenCalledWith('p9');
    expect((field() as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps the draft and shows the error on failure, and can retry', async () => {
    postMessage.mockResolvedValueOnce({ id: null, error: 'Nope.' });
    const onPosted = vi.fn();
    render(<BoardComposer threadId="t1" onPosted={onPosted} />);
    type('hello');
    fireEvent.click(postBtn());
    await waitFor(() => expect(screen.getByText('Nope.')).toBeTruthy());
    expect((field() as HTMLTextAreaElement).value).toBe('hello');
    expect(onPosted).not.toHaveBeenCalled();
    postMessage.mockResolvedValueOnce({ id: 'p2', error: null });
    fireEvent.click(postBtn());
    await waitFor(() => expect(onPosted).toHaveBeenCalledWith('p2'));
  });

  it('on web Enter posts and Shift+Enter does not', async () => {
    postMessage.mockResolvedValue({ id: 'p3', error: null });
    render(<BoardComposer threadId="t1" onPosted={() => {}} />);
    type('hello');
    fireEvent.keyDown(field(), { key: 'Enter', shiftKey: true });
    expect(postMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
  });

  it('Enter on empty text does not post', () => {
    render(<BoardComposer threadId="t1" onPosted={() => {}} />);
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('thumbnails can be removed, and the photo button stops at 4', async () => {
    render(<BoardComposer threadId="t1" onPosted={() => {}} />);
    for (let k = 0; k < 4; k++) {
      await addPhoto();
      await waitFor(() => expect(screen.getAllByLabelText('Remove image')).toHaveLength(k + 1));
    }
    expect((screen.getByLabelText('Attach an image') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByLabelText('Remove image')[0]);
    expect(screen.getAllByLabelText('Remove image')).toHaveLength(3);
    expect((screen.getByLabelText('Attach an image') as HTMLButtonElement).disabled).toBe(false);
  });

  it('pads the bottom by the safe-area inset, at least 8', () => {
    insets.bottom = 34;
    const { container, unmount } = render(<BoardComposer threadId="t1" onPosted={() => {}} />);
    expect((container.firstChild as HTMLElement).style.paddingBottom).toBe('34px');
    unmount();
    insets.bottom = 0;
    const second = render(<BoardComposer threadId="t1" onPosted={() => {}} />);
    expect((second.container.firstChild as HTMLElement).style.paddingBottom).toBe('8px');
  });

  describe('email everyone (announce)', () => {
    const megaphone = () => screen.getByRole('switch', { name: 'Email everyone in the club' });

    it('never shows members the toggle', () => {
      render(<BoardComposer threadId="t1" clubId="c1" onPosted={() => {}} />);
      expect(screen.queryByRole('switch', { name: 'Email everyone in the club' })).toBeNull();
      expect(screen.queryByText(/Will also email/)).toBeNull();
      expect(countBroadcastRecipients).not.toHaveBeenCalled();
    });

    it('shows organizers the toggle, off, with a plain Post button', () => {
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={() => {}} />);
      expect(megaphone().getAttribute('aria-checked')).toBe('false');
      expect(screen.queryByText(/Will also email/)).toBeNull();
      expect(postBtn()).toBeTruthy();
      expect(countBroadcastRecipients).not.toHaveBeenCalled();
    });

    it('when on, shows the recipient count; the button still reads Post but is labelled for email', async () => {
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={() => {}} />);
      fireEvent.click(megaphone());
      expect(megaphone().getAttribute('aria-checked')).toBe('true');
      expect(await screen.findByText('Will also email 23 people in the club')).toBeTruthy();
      expect(countBroadcastRecipients).toHaveBeenCalledWith('c1', null);
      const btn = screen.getByRole('button', { name: 'Post and email everyone' });
      expect(btn.textContent).toBe('Post');
      expect(screen.queryByRole('button', { name: 'Post' })).toBeNull();
      expect(screen.queryByText(/Post & email/)).toBeNull();
      fireEvent.click(megaphone());
      expect(screen.queryByText(/Will also email/)).toBeNull();
      expect(postBtn()).toBeTruthy();
    });

    it('says "1 person" for a single recipient', async () => {
      countBroadcastRecipients.mockResolvedValue(1);
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={() => {}} />);
      fireEvent.click(megaphone());
      expect(await screen.findByText('Will also email 1 person in the club')).toBeTruthy();
    });

    it('falls back to "everyone in the club" when the count fails', async () => {
      countBroadcastRecipients.mockResolvedValue(null);
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={() => {}} />);
      fireEvent.click(megaphone());
      await waitFor(() => expect(countBroadcastRecipients).toHaveBeenCalled());
      expect(screen.getByText('Will also email everyone in the club')).toBeTruthy();
    });

    it('posts as an announcement once on double tap, then turns the toggle off', async () => {
      let resolve!: (v: unknown) => void;
      postMessage.mockImplementation(() => new Promise((r) => (resolve = r)));
      const onPosted = vi.fn();
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={onPosted} />);
      fireEvent.click(megaphone());
      type('Doors at seven');
      const btn = screen.getByRole('button', { name: 'Post and email everyone' });
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(postMessage).toHaveBeenCalledWith('t1', 'Doors at seven', true, null, null, []);
      await act(async () => resolve({ id: 'p5', error: null }));
      expect(onPosted).toHaveBeenCalledWith('p5');
      expect(megaphone().getAttribute('aria-checked')).toBe('false');
      expect(screen.queryByText(/Will also email/)).toBeNull();
      expect(postBtn()).toBeTruthy();
    });

    it('shows a server refusal inline and keeps the draft and the toggle on', async () => {
      postMessage.mockResolvedValueOnce({ id: null, error: 'only an organizer can announce' });
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={() => {}} />);
      fireEvent.click(megaphone());
      type('Doors at seven');
      fireEvent.click(screen.getByRole('button', { name: 'Post and email everyone' }));
      expect(await screen.findByText('only an organizer can announce')).toBeTruthy();
      expect((field() as HTMLTextAreaElement).value).toBe('Doors at seven');
      expect(megaphone().getAttribute('aria-checked')).toBe('true');
    });

    it('with no text, disables Post and asks for a line; a photo alone cannot announce', async () => {
      postMessage.mockResolvedValue({ id: 'p7', error: null });
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={() => {}} />);
      await addPhoto();
      await waitFor(() => expect((postBtn() as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(megaphone());
      const hint = 'Add a line of text — it becomes the email subject.';
      expect(screen.getByText(hint)).toBeTruthy();
      const btn = screen.getByRole('button', { name: 'Post and email everyone' }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      fireEvent.click(btn);
      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(postMessage).not.toHaveBeenCalled();
      type('   ');
      expect(screen.getByText(hint)).toBeTruthy();
      type('Doors at seven');
      expect(screen.queryByText(hint)).toBeNull();
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      await waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith('t1', 'Doors at seven', true, null, null, [
          { storage_path: 't1/0.jpg', width: 40, height: 30 },
        ]),
      );
    });

    it('does not show the text hint while the toggle is off', () => {
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={() => {}} />);
      expect(screen.queryByText(/it becomes the email subject/)).toBeNull();
    });

    it('a plain post from an organizer still sends announce=false', async () => {
      postMessage.mockResolvedValue({ id: 'p6', error: null });
      render(<BoardComposer threadId="t1" clubId="c1" canAnnounce onPosted={() => {}} />);
      type('hi');
      fireEvent.click(postBtn());
      await waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith('t1', 'hi', false, null, null, []),
      );
    });
  });
});

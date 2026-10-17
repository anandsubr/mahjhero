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

beforeEach(() => {
  insets.bottom = 0;
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
});

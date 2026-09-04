import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AttachmentGrid from '../AttachmentGrid';
import type { MessageAttachment } from '../../../lib/messages';

// Mocked wholesale, the same pattern AttachmentPicker.test.tsx uses for this
// same module: lib/attachments.ts pulls in expo-crypto, expo-image-manipulator
// and expo-image-picker, none of which this component (which only ever calls
// getSignedUrls) needs to actually load.
const getSignedUrls = vi.fn();

vi.mock('../../../lib/attachments', () => ({
  getSignedUrls: (...a: unknown[]) => getSignedUrls(...a),
}));

beforeEach(() => {
  getSignedUrls.mockReset();
});

const attachments: MessageAttachment[] = [
  { id: 'a1', storage_path: 't1/a.jpg', width: 100, height: 100 },
  { id: 'a2', storage_path: 't1/b.jpg', width: 200, height: 150 },
  { id: 'a3', storage_path: 't1/c.jpg', width: 300, height: 300 },
];

const signedUrls = {
  't1/a.jpg': 'https://signed.example/a.jpg',
  't1/b.jpg': 'https://signed.example/b.jpg',
  't1/c.jpg': 'https://signed.example/c.jpg',
};

describe('AttachmentGrid', () => {
  it('renders nothing for zero attachments, and never asks for signed URLs', () => {
    const { container } = render(<AttachmentGrid attachments={[]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('attachment-grid')).toBeNull();
    expect(getSignedUrls).not.toHaveBeenCalled();
  });

  it('requests every attachment in one batched call, and renders the resolved image once it settles', async () => {
    // Left unresolved on purpose so the pre-resolution state (placeholders,
    // no <img> yet) is actually observed rather than assumed -- the same
    // "capture the resolver, assert both sides" shape AttachmentPicker.test.tsx
    // uses for uploadAttachment.
    let resolve!: (v: Record<string, string>) => void;
    getSignedUrls.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    render(<AttachmentGrid attachments={attachments} />);

    // One call, carrying every attachment's storage_path -- not one call per
    // image (lib/attachments.ts's own getSignedUrls docstring is explicit
    // that batching is the whole point).
    await waitFor(() =>
      expect(getSignedUrls).toHaveBeenCalledWith(['t1/a.jpg', 't1/b.jpg', 't1/c.jpg']),
    );
    expect(getSignedUrls).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll('img')).toHaveLength(0);

    await act(async () => {
      resolve(signedUrls);
      await Promise.resolve();
    });

    await waitFor(() => expect(document.body.querySelectorAll('img')).toHaveLength(3));
    const imgs = document.body.querySelectorAll('img');
    expect(imgs[0].getAttribute('src')).toBe(signedUrls['t1/a.jpg']);
    expect(imgs[1].getAttribute('src')).toBe(signedUrls['t1/b.jpg']);
    expect(imgs[2].getAttribute('src')).toBe(signedUrls['t1/c.jpg']);
  });

  it('opens the viewer at the tapped image\'s index, not always the first', async () => {
    getSignedUrls.mockResolvedValue(signedUrls);
    render(<AttachmentGrid attachments={attachments} />);
    await waitFor(() => expect(document.body.querySelectorAll('img')).toHaveLength(3));

    fireEvent.click(screen.getByLabelText('View image 3 of 3'));

    await waitFor(() => expect(screen.getByLabelText('Close image viewer')).toBeTruthy());

    // The viewer's own <img> (a 4th one, on top of the grid's 3 -- it portals
    // to document.body rather than nesting inside the render container, per
    // react-native-web's Modal) shows the THIRD attachment, confirming
    // startIndex actually followed the tap rather than defaulting to 0.
    await waitFor(() => expect(document.body.querySelectorAll('img')).toHaveLength(4));
    const viewerImg = document.body.querySelectorAll('img')[3];
    expect(viewerImg.getAttribute('src')).toBe(signedUrls['t1/c.jpg']);

    // Opened on the last image: Next is at the boundary, Previous is not.
    expect(screen.getByLabelText('Next image').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByLabelText('Previous image').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('navigates prev/next and stops dead at each boundary', async () => {
    getSignedUrls.mockResolvedValue(signedUrls);
    render(<AttachmentGrid attachments={attachments} />);
    await waitFor(() => expect(document.body.querySelectorAll('img')).toHaveLength(3));

    // Open on the first image.
    fireEvent.click(screen.getByLabelText('View image 1 of 3'));
    await waitFor(() => expect(document.body.querySelectorAll('img')).toHaveLength(4));
    expect(document.body.querySelectorAll('img')[3].getAttribute('src')).toBe(
      signedUrls['t1/a.jpg'],
    );
    expect(screen.getByLabelText('Previous image').getAttribute('aria-disabled')).toBe('true');

    // Previous is disabled at index 0: clicking it must not move anything.
    fireEvent.click(screen.getByLabelText('Previous image'));
    expect(document.body.querySelectorAll('img')[3].getAttribute('src')).toBe(
      signedUrls['t1/a.jpg'],
    );

    // Next twice walks to the last image.
    fireEvent.click(screen.getByLabelText('Next image'));
    await waitFor(() =>
      expect(document.body.querySelectorAll('img')[3].getAttribute('src')).toBe(
        signedUrls['t1/b.jpg'],
      ),
    );
    expect(screen.getByLabelText('Previous image').getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByLabelText('Next image').getAttribute('aria-disabled')).not.toBe('true');

    fireEvent.click(screen.getByLabelText('Next image'));
    await waitFor(() =>
      expect(document.body.querySelectorAll('img')[3].getAttribute('src')).toBe(
        signedUrls['t1/c.jpg'],
      ),
    );
    expect(screen.getByLabelText('Next image').getAttribute('aria-disabled')).toBe('true');

    // Next is now disabled at the last index: clicking it must not move anything.
    fireEvent.click(screen.getByLabelText('Next image'));
    expect(document.body.querySelectorAll('img')[3].getAttribute('src')).toBe(
      signedUrls['t1/c.jpg'],
    );
  });

  it('closes the viewer on a backdrop tap', async () => {
    getSignedUrls.mockResolvedValue(signedUrls);
    render(<AttachmentGrid attachments={attachments} />);
    await waitFor(() => expect(document.body.querySelectorAll('img')).toHaveLength(3));

    fireEvent.click(screen.getByLabelText('View image 2 of 3'));
    await waitFor(() => expect(screen.getByLabelText('Close image viewer')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Close image viewer'));

    await waitFor(() => expect(screen.queryByLabelText('Close image viewer')).toBeNull());
    // Back to only the grid's own 3 images -- the viewer's is gone, not just hidden.
    expect(document.body.querySelectorAll('img')).toHaveLength(3);
  });
});

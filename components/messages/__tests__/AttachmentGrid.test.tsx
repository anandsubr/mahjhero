import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AttachmentGrid from '../AttachmentGrid';
import type { MessageAttachment } from '../../../lib/messages';

// AttachmentGrid no longer calls `getSignedUrls` itself -- it used to, in a
// `useEffect` keyed on `attachments`, but it is mounted once PER MESSAGE
// (inside MessageBubble), so that fired one batched call PER MESSAGE rather
// than one per screen load, defeating the batching `getSignedUrls` itself is
// built to provide. The screens that render a message list now gather every
// visible attachment's path across the whole list and call `getSignedUrls`
// once, passing the resolved map down as the `urls` prop these tests supply
// directly -- see AttachmentGrid's own `urls` prop docstring.

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
  it('renders nothing for zero attachments', () => {
    const { container } = render(<AttachmentGrid attachments={[]} urls={{}} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('attachment-grid')).toBeNull();
  });

  it('renders a placeholder, not an image, for a path not yet in `urls`', () => {
    render(<AttachmentGrid attachments={attachments} urls={{}} />);
    expect(screen.getByTestId('attachment-grid')).toBeTruthy();
    expect(document.body.querySelectorAll('img')).toHaveLength(0);
  });

  it('renders every attachment whose path is already resolved in `urls`', () => {
    render(<AttachmentGrid attachments={attachments} urls={signedUrls} />);
    const imgs = document.body.querySelectorAll('img');
    expect(imgs).toHaveLength(3);
    expect(imgs[0].getAttribute('src')).toBe(signedUrls['t1/a.jpg']);
    expect(imgs[1].getAttribute('src')).toBe(signedUrls['t1/b.jpg']);
    expect(imgs[2].getAttribute('src')).toBe(signedUrls['t1/c.jpg']);
  });

  // The caller resolves `urls` asynchronously and re-renders once it
  // settles -- this proves the grid actually swaps a placeholder for the
  // real image on a later render with the same attachments, rather than
  // only ever reading `urls` once.
  it('swaps the placeholder for the image once a rerender supplies the resolved url', () => {
    const { rerender } = render(<AttachmentGrid attachments={attachments} urls={{}} />);
    expect(document.body.querySelectorAll('img')).toHaveLength(0);

    rerender(<AttachmentGrid attachments={attachments} urls={signedUrls} />);
    expect(document.body.querySelectorAll('img')).toHaveLength(3);
  });

  it('opens the viewer at the tapped image\'s index, not always the first', async () => {
    render(<AttachmentGrid attachments={attachments} urls={signedUrls} />);
    expect(document.body.querySelectorAll('img')).toHaveLength(3);

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
    render(<AttachmentGrid attachments={attachments} urls={signedUrls} />);
    expect(document.body.querySelectorAll('img')).toHaveLength(3);

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
    render(<AttachmentGrid attachments={attachments} urls={signedUrls} />);
    expect(document.body.querySelectorAll('img')).toHaveLength(3);

    fireEvent.click(screen.getByLabelText('View image 2 of 3'));
    await waitFor(() => expect(screen.getByLabelText('Close image viewer')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Close image viewer'));

    await waitFor(() => expect(screen.queryByLabelText('Close image viewer')).toBeNull());
    // Back to only the grid's own 3 images -- the viewer's is gone, not just hidden.
    expect(document.body.querySelectorAll('img')).toHaveLength(3);
  });
});

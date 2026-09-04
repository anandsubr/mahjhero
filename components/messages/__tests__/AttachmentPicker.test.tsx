import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AttachmentPicker from '../AttachmentPicker';

// Mocked wholesale rather than through `vi.importActual` (the pattern
// MembersPanel.test.tsx uses for lib/messages): lib/attachments.ts pulls in
// expo-crypto, expo-image-manipulator and expo-image-picker, none of which
// this component's tests want to actually load. Every export the component
// uses is replaced -- pickImages/compressImage/uploadAttachment as
// controllable spies, MAX_ATTACHMENTS as the same literal the real module
// exports (lib/messages.ts's own MAX_ATTACHMENTS docstring records that the
// two are meant to mirror each other).
const pickImages = vi.fn();
const compressImage = vi.fn();
const uploadAttachment = vi.fn();

vi.mock('../../../lib/attachments', () => ({
  pickImages: (...a: unknown[]) => pickImages(...a),
  compressImage: (...a: unknown[]) => compressImage(...a),
  uploadAttachment: (...a: unknown[]) => uploadAttachment(...a),
  MAX_ATTACHMENTS: 4,
}));

// vitest.config.mts's `react-native` -> `react-native-web` alias hardcodes
// Platform.OS to 'web' (see its own CAVEAT comment, and DateField.test.tsx's
// docstring for the precedent this follows). DateField.test.tsx forces a
// single fixed OS for its whole file; this file needs BOTH the default web
// behaviour (most tests) and one non-web assertion, so `OS` is a getter over
// a mutable `platformState` that each test can flip, reset to 'web' in
// `beforeEach` so leaving it set is not a trap for the next test.
const platformState = { OS: 'web' };
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return platformState.OS;
      },
    },
  };
});

beforeEach(() => {
  pickImages.mockReset();
  compressImage.mockReset();
  uploadAttachment.mockReset();
  platformState.OS = 'web';
});

function openLibrary() {
  fireEvent.click(screen.getByLabelText('Attach an image'));
  fireEvent.click(screen.getByText('Choose from library'));
}

describe('AttachmentPicker', () => {
  it('reports pending while uploading, then the finished attachment once it lands', async () => {
    pickImages.mockResolvedValueOnce([{ uri: 'file://a.jpg', width: 400, height: 300 }]);
    compressImage.mockResolvedValueOnce({ uri: 'file://a-small.jpg', width: 400, height: 300 });
    let resolveUpload!: (v: { storagePath: string | null; error: string | null }) => void;
    uploadAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );

    const onAttachmentsChange = vi.fn();
    render(<AttachmentPicker threadId="t1" onAttachmentsChange={onAttachmentsChange} />);

    openLibrary();

    // The picked image is in the strip and reported as pending before the
    // upload settles -- this is what the caller uses to keep Send disabled
    // while an image is still in flight.
    await waitFor(() => expect(onAttachmentsChange).toHaveBeenCalledWith([], true));
    expect(screen.getByTestId('attachment-strip')).toBeTruthy();

    await act(async () => {
      resolveUpload({ storagePath: 't1/a.jpg', error: null });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(onAttachmentsChange).toHaveBeenLastCalledWith(
        [{ storage_path: 't1/a.jpg', width: 400, height: 300 }],
        false,
      ),
    );
  });

  it('removes an item and re-reports only the remaining ready attachments', async () => {
    pickImages.mockResolvedValueOnce([
      { uri: 'file://a.jpg', width: 10, height: 20 },
      { uri: 'file://b.jpg', width: 30, height: 40 },
    ]);
    compressImage.mockImplementation(async (img: { uri: string; width: number; height: number }) => img);
    uploadAttachment.mockImplementation(async (_threadId: string, img: { uri: string }) => ({
      storagePath: img.uri.replace('file://', 't1/'),
      error: null,
    }));

    const onAttachmentsChange = vi.fn();
    render(<AttachmentPicker threadId="t1" onAttachmentsChange={onAttachmentsChange} />);

    openLibrary();

    await waitFor(() =>
      expect(onAttachmentsChange).toHaveBeenLastCalledWith(
        [
          { storage_path: 't1/a.jpg', width: 10, height: 20 },
          { storage_path: 't1/b.jpg', width: 30, height: 40 },
        ],
        false,
      ),
    );

    // Both uploads are done, sequentially, in pick order -- addPicked awaits
    // each image's compress+upload before starting the next, so the first
    // "Remove image" button in document order is unambiguously image a.jpg's.
    fireEvent.click(screen.getAllByLabelText('Remove image')[0]);

    await waitFor(() =>
      expect(onAttachmentsChange).toHaveBeenLastCalledWith(
        [{ storage_path: 't1/b.jpg', width: 30, height: 40 }],
        false,
      ),
    );
    expect(screen.getAllByLabelText('Remove image')).toHaveLength(1);
  });

  it('disables the attach control once MAX_ATTACHMENTS is reached', async () => {
    pickImages.mockResolvedValueOnce([
      { uri: 'file://a.jpg', width: 1, height: 1 },
      { uri: 'file://b.jpg', width: 1, height: 1 },
      { uri: 'file://c.jpg', width: 1, height: 1 },
      { uri: 'file://d.jpg', width: 1, height: 1 },
    ]);
    // Left uploading indefinitely -- the limit is about how many items are
    // PICKED, not how many have finished, so this must disable the button
    // even before any of the four resolves.
    compressImage.mockImplementation(() => new Promise(() => {}));

    render(<AttachmentPicker threadId="t1" onAttachmentsChange={() => {}} />);
    openLibrary();

    // The same `getAttribute('aria-disabled')` assertion Button.test.tsx and
    // DateField.test.tsx use, not `not.toBe('true')` -- which a missing
    // attribute would also satisfy (both files' own docstrings record this
    // as the actual defect they exist to catch). react-native-web's own
    // Pressable reads this same `disabled` value inside its onClick handler
    // (usePressEvents/PressResponder.js) and no-ops `onPress` when it is
    // set, so the rendered attribute is not merely cosmetic.
    await waitFor(() =>
      expect(screen.getByLabelText('Attach an image').getAttribute('aria-disabled')).toBe(
        'true',
      ),
    );
  });

  it('surfaces an upload failure as the error overlay rather than dropping it', async () => {
    pickImages.mockResolvedValueOnce([{ uri: 'file://a.jpg', width: 5, height: 5 }]);
    compressImage.mockResolvedValueOnce({ uri: 'file://a.jpg', width: 5, height: 5 });
    uploadAttachment.mockResolvedValueOnce({ storagePath: null, error: 'upload failed' });

    const onAttachmentsChange = vi.fn();
    render(<AttachmentPicker threadId="t1" onAttachmentsChange={onAttachmentsChange} />);
    openLibrary();

    await waitFor(() => expect(screen.getByText('!')).toBeTruthy());
    // Not counted as ready, and not left pending forever either -- the
    // caller's Send button must re-enable so the member can retry or send
    // without the failed image.
    await waitFor(() => expect(onAttachmentsChange).toHaveBeenLastCalledWith([], false));
  });

  // pickImages itself resolving null (permission denied, or cancel) must not
  // be treated as a failed upload -- there is nothing to show an error for.
  it('does nothing when the picker returns no images', async () => {
    pickImages.mockResolvedValueOnce(null);
    const onAttachmentsChange = vi.fn();
    render(<AttachmentPicker threadId="t1" onAttachmentsChange={onAttachmentsChange} />);
    openLibrary();

    await waitFor(() => expect(pickImages).toHaveBeenCalled());
    expect(screen.queryByTestId('attachment-strip')).toBeNull();
    expect(compressImage).not.toHaveBeenCalled();
  });

  it('hides the camera option on web, offering the library only', () => {
    render(<AttachmentPicker threadId="t1" onAttachmentsChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Attach an image'));
    expect(screen.getByText('Choose from library')).toBeTruthy();
    expect(screen.queryByText('Take a photo')).toBeNull();
  });

  it('offers the camera on a non-web platform', () => {
    platformState.OS = 'ios';
    render(<AttachmentPicker threadId="t1" onAttachmentsChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Attach an image'));
    expect(screen.getByText('Take a photo')).toBeTruthy();
    expect(screen.getByText('Choose from library')).toBeTruthy();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('../../lib/attachments', () => ({ compressImage: vi.fn() }));

import FileRow from '../media/FileRow';
import MediaViewer, { mediaCaption } from '../media/MediaViewer';
import PhotoGrid from '../media/PhotoGrid';
import type { ClubMedia } from '../../lib/club-media';

const media = (i: number, over: Partial<ClubMedia> = {}): ClubMedia => ({
  id: `m${i}`,
  clubId: 'c1',
  kind: 'photo',
  storagePath: `c1/photos/${i}.jpg`,
  fileName: `${i}.jpg`,
  mimeType: 'image/jpeg',
  sizeBytes: 1000,
  width: 100,
  height: 100,
  uploadedBy: 'u1',
  uploaderName: 'Priya Shah',
  createdAt: '2026-09-29T12:00:00Z',
  ...over,
});

describe('PhotoGrid', () => {
  it('renders a cell per photo and opens by index', () => {
    const onOpen = vi.fn();
    const photos = [media(1), media(2), media(3)];
    render(<PhotoGrid photos={photos} urls={{ [photos[0].storagePath]: 'http://x/1.jpg' }} onOpen={onOpen} />);
    const cells = screen.getAllByRole('button');
    expect(cells).toHaveLength(3);
    fireEvent.click(cells[2]);
    expect(onOpen).toHaveBeenCalledWith(2);
  });
});

describe('MediaViewer', () => {
  const items = [
    { url: 'http://x/1.jpg', caption: 'Added by Priya Shah · Tue 29 Sept' },
    { url: 'http://x/2.jpg', caption: 'Added by Ann Lee · Wed 30 Sept' },
  ];

  it('builds the caption', () => {
    expect(mediaCaption(media(1))).toBe('Added by Priya Shah · Tue 29 Sept');
  });

  it('shows the caption and respects bounds', () => {
    render(<MediaViewer items={items} startIndex={0} onClose={() => {}} canRemove={() => true} onRemove={() => {}} />);
    expect(screen.getByText('Added by Priya Shah · Tue 29 Sept')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Previous image'));
    expect(screen.getByText('Added by Priya Shah · Tue 29 Sept')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next image'));
    expect(screen.getByText('Added by Ann Lee · Wed 30 Sept')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next image'));
    expect(screen.getByText('Added by Ann Lee · Wed 30 Sept')).toBeTruthy();
  });

  it('hides Remove when not allowed', () => {
    render(<MediaViewer items={items} startIndex={0} onClose={() => {}} canRemove={() => false} onRemove={() => {}} />);
    expect(screen.queryByLabelText('Remove')).toBeNull();
  });

  it('confirms before removing', () => {
    const onRemove = vi.fn();
    render(<MediaViewer items={items} startIndex={1} onClose={() => {}} canRemove={() => true} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Remove'));
    expect(screen.getByText('Remove this photo?')).toBeTruthy();
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Remove'));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('closes', () => {
    const onClose = vi.fn();
    render(<MediaViewer items={items} startIndex={0} onClose={onClose} canRemove={() => false} onRemove={() => {}} />);
    fireEvent.click(screen.getByLabelText('Close image viewer'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('FileRow', () => {
  const file = media(9, {
    kind: 'file', fileName: 'Rules.pdf', mimeType: 'application/pdf', sizeBytes: 2 * 1024 * 1024,
  });

  it('shows the meta line and downloads', () => {
    const onOpen = vi.fn();
    render(<FileRow file={file} onOpen={onOpen} canRemove={false} onRemove={() => {}} />);
    expect(screen.getByText('Rules.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 2 MB · Priya Shah')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Download Rules.pdf'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('hides the menu for non-owners', () => {
    render(<FileRow file={file} onOpen={() => {}} canRemove={false} onRemove={() => {}} />);
    expect(screen.queryByLabelText('More options')).toBeNull();
  });

  it('removes after confirming', () => {
    const onRemove = vi.fn();
    render(<FileRow file={file} onOpen={() => {}} canRemove onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('More options'));
    fireEvent.click(screen.getByLabelText('Remove'));
    expect(screen.getByText('Remove this file?')).toBeTruthy();
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

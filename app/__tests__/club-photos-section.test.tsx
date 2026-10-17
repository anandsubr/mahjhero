import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PhotosSection from '../clubs/[id]/(hub)/photos';

describe('club hub Photos section', () => {
  it('shows the coming-soon note with an image icon', () => {
    render(<PhotosSection />);
    expect(screen.getByText('Photos and files are coming soon.')).toBeTruthy();
  });
});

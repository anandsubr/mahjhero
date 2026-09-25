import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CompactHeader from '../CompactHeader';

describe('CompactHeader', () => {
  it('always offers back, even before the thread has loaded', () => {
    const onBack = vi.fn();
    render(<CompactHeader onBack={onBack} backLabel="Back to Messages" kind={null} title="" />);
    fireEvent.click(screen.getByLabelText('Back to Messages'));
    expect(onBack).toHaveBeenCalled();
    expect(screen.queryByLabelText('Conversation options')).toBeNull();
  });

  it('shows the title and subtitle, and opens details from the name or the overflow button', () => {
    const onOpenDetails = vi.fn();
    render(
      <CompactHeader
        onBack={() => {}}
        backLabel="Back to Messages"
        kind="group"
        title="Tuesday crew"
        subtitle="4 members"
        onOpenDetails={onOpenDetails}
        detailsLabel="Tuesday crew, 4 members, view members"
        overflowLabel="Conversation options"
      />,
    );
    expect(screen.getByText('Tuesday crew')).toBeTruthy();
    expect(screen.getByText('4 members')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Tuesday crew, 4 members, view members'));
    fireEvent.click(screen.getByLabelText('Conversation options'));
    expect(onOpenDetails).toHaveBeenCalledTimes(2);
  });

  it('draws a plain name and no overflow button when there are no details to open', () => {
    render(<CompactHeader onBack={() => {}} backLabel="Back" kind="game" title="Thu game" />);
    expect(screen.getByText('Thu game')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thu game/ })).toBeNull();
    expect(screen.queryByLabelText('Conversation options')).toBeNull();
  });

  it('puts a primary action in the right slot instead of the overflow button, even before loading', () => {
    const onPress = vi.fn();
    render(
      <CompactHeader
        kind={null}
        title=""
        action={{ icon: 'plus', label: 'New post', onPress }}
        variant="inset"
      />,
    );
    fireEvent.click(screen.getByLabelText('New post'));
    expect(onPress).toHaveBeenCalled();
    expect(screen.queryByLabelText('Conversation options')).toBeNull();
  });

  it('collapses the back slot when there is nowhere to go back to', () => {
    render(<CompactHeader kind="group" title="Tuesday crew" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('makes a manageable club title one control, with its subtitle', () => {
    const onOpenDetails = vi.fn();
    render(
      <CompactHeader
        kind="club"
        clubId="c1"
        title="Test Club"
        subtitle="testing only"
        onOpenDetails={onOpenDetails}
        detailsLabel="Manage Test Club, testing only"
        detailsHint="pencil"
      />,
    );
    expect(screen.getByText('testing only')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Manage Test Club, testing only'));
    expect(onOpenDetails).toHaveBeenCalled();
  });
});

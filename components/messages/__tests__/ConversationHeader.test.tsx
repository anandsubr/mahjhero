import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ConversationHeader from '../ConversationHeader';

describe('ConversationHeader', () => {
  it('always offers back, even before the thread has loaded', () => {
    const onBack = vi.fn();
    render(<ConversationHeader onBack={onBack} backLabel="Back to Messages" kind={null} title="" />);
    fireEvent.click(screen.getByLabelText('Back to Messages'));
    expect(onBack).toHaveBeenCalled();
    expect(screen.queryByLabelText('Conversation options')).toBeNull();
  });

  it('shows the title and subtitle, and opens details from the name or the overflow button', () => {
    const onOpenDetails = vi.fn();
    render(
      <ConversationHeader
        onBack={() => {}}
        backLabel="Back to Messages"
        kind="group"
        title="Tuesday crew"
        subtitle="4 members"
        onOpenDetails={onOpenDetails}
        detailsLabel="Tuesday crew, 4 members, view members"
      />,
    );
    expect(screen.getByText('Tuesday crew')).toBeTruthy();
    expect(screen.getByText('4 members')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Tuesday crew, 4 members, view members'));
    fireEvent.click(screen.getByLabelText('Conversation options'));
    expect(onOpenDetails).toHaveBeenCalledTimes(2);
  });

  it('draws a plain name and no overflow button when there are no details to open', () => {
    render(<ConversationHeader onBack={() => {}} backLabel="Back" kind="game" title="Thu game" />);
    expect(screen.getByText('Thu game')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Thu game/ })).toBeNull();
    expect(screen.queryByLabelText('Conversation options')).toBeNull();
  });
});

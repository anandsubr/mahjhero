import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MemberRow from '../hub/MemberRow';
import type { ClubMember } from '../../lib/clubs';

const skillPips = vi.fn((_props: unknown) => null);
vi.mock('../SkillLevelPips', () => ({
  default: (props: unknown) => skillPips(props),
}));

const PRIYA: ClubMember = {
  profile_id: 'p-priya',
  role: 'host',
  display_name: 'Priya Shah',
  skill_level: 'advanced',
};

const KIRAN: ClubMember = {
  profile_id: 'p-kiran',
  role: 'co_organizer',
  display_name: 'Kiran Patel',
  skill_level: null,
};

function renderRow(overrides: Partial<Parameters<typeof MemberRow>[0]> = {}) {
  const onMessage = vi.fn();
  const onAddFriend = vi.fn();
  render(
    <MemberRow
      member={PRIYA}
      isSelf={false}
      isFriend={false}
      onMessage={onMessage}
      onAddFriend={onAddFriend}
      messaging={false}
      adding={false}
      {...overrides}
    />,
  );
  return { onMessage, onAddFriend };
}

describe('MemberRow', () => {
  it('renders initials, name, role tag and skill text, without skill pips', () => {
    renderRow();
    expect(screen.getByText('PS')).toBeTruthy();
    expect(screen.getByText('Priya Shah')).toBeTruthy();
    expect(screen.getByText('Host')).toBeTruthy();
    expect(screen.getByText('Advanced')).toBeTruthy();
    expect(skillPips).not.toHaveBeenCalled();
  });

  it('tags a co-organizer and omits skill when none is set', () => {
    renderRow({ member: KIRAN });
    expect(screen.getByText('Co-organizer')).toBeTruthy();
    expect(screen.queryByText('Beginner')).toBeNull();
    expect(screen.queryByText('Intermediate')).toBeNull();
    expect(screen.queryByText('Advanced')).toBeNull();
  });

  it('shows "{name} (you)" and no buttons on your own row', () => {
    renderRow({ isSelf: true });
    expect(screen.getByText('Priya Shah (you)')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows an Add friend button for a non-friend', () => {
    const { onAddFriend } = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Add Priya Shah as a friend' }));
    expect(onAddFriend).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Friend')).toBeNull();
  });

  it('shows "Friend" and no add button for a friend', () => {
    renderRow({ isFriend: true });
    expect(screen.getByText('Friend')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Priya Shah as a friend' })).toBeNull();
  });

  it('calls onMessage from the Message button', () => {
    const { onMessage } = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Message Priya Shah' }));
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('disables the Message button while messaging', () => {
    renderRow({ messaging: true });
    const button = screen.getByRole('button', { name: 'Message Priya Shah' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('disables the Add friend button while adding', () => {
    renderRow({ adding: true });
    const button = screen.getByRole('button', { name: 'Add Priya Shah as a friend' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('labels a blank-named member "Member"', () => {
    renderRow({ member: { ...PRIYA, display_name: '  ' } });
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Message Member' })).toBeTruthy();
  });
});

import { describe, expect, it } from 'vitest';
import type { ClubMember } from './clubs';
import {
  filterMembers,
  isHostRole,
  memberInitials,
  memberName,
  orderMembers,
  skillLabel,
} from './members';

function m(
  profile_id: string,
  display_name: string,
  role: ClubMember['role'] = 'member',
): ClubMember {
  return { profile_id, role, display_name, skill_level: null };
}

describe('orderMembers', () => {
  it('puts hosts and co-organizers before members, each group A to Z', () => {
    const input = [
      m('1', 'Wei', 'member'),
      m('2', 'anand', 'member'),
      m('3', 'Zoe', 'host'),
      m('4', 'bea', 'co_organizer'),
    ];
    expect(orderMembers(input).map((x) => x.display_name)).toEqual([
      'bea',
      'Zoe',
      'anand',
      'Wei',
    ]);
  });

  it('sorts blank names last within their group, shown as Member', () => {
    const blank = m('1', '');
    expect(memberName(blank)).toBe('Member');
    const ordered = orderMembers([blank, m('2', 'Ann')]);
    expect(ordered.map((x) => x.display_name)).toEqual(['Ann', '']);
  });

  it('sorts a blank name after Zed, where "Member" alone would sort first', () => {
    const ordered = orderMembers([m('1', ''), m('2', 'Zed')]);
    expect(ordered.map((x) => x.display_name)).toEqual(['Zed', '']);
  });

  it('treats a whitespace-only name as blank', () => {
    const ordered = orderMembers([m('1', '   '), m('2', 'Zed')]);
    expect(ordered.map((x) => x.display_name)).toEqual(['Zed', '   ']);
    expect(memberName(m('3', '   '))).toBe('Member');
  });

  it('sorts a blank host after a named host, within the host group', () => {
    const ordered = orderMembers([
      m('1', '', 'host'),
      m('2', 'Zed', 'host'),
      m('3', 'Ann', 'member'),
    ]);
    expect(ordered.map((x) => x.display_name)).toEqual(['Zed', '', 'Ann']);
  });

  it('orders case and accents with base sensitivity', () => {
    const input = [m('1', 'émile'), m('2', 'Eli'), m('3', 'eve')];
    expect(orderMembers(input).map((x) => x.display_name)).toEqual([
      'Eli',
      'émile',
      'eve',
    ]);
  });

  it('breaks name ties by profile_id for stability', () => {
    const input = [m('b', 'Sam'), m('a', 'Sam')];
    expect(orderMembers(input).map((x) => x.profile_id)).toEqual(['a', 'b']);
  });

  it('breaks a case-only name tie by profile_id', () => {
    const input = [m('b', 'eli'), m('a', 'Eli')];
    expect(orderMembers(input).map((x) => x.profile_id)).toEqual(['a', 'b']);
  });
});

describe('filterMembers', () => {
  const all = [
    m('1', 'Priya Shah', 'host'),
    m('2', 'Wei Chen'),
    m('3', 'Priyanka Rao', 'co_organizer'),
  ];

  it('matches a trimmed, case-insensitive substring of the display name', () => {
    expect(filterMembers(all, '  pri ', false).map((x) => x.profile_id)).toEqual(
      ['1', '3'],
    );
  });

  it('keeps only hosts and co-organizers when hostsOnly is true', () => {
    expect(filterMembers(all, '', true).map((x) => x.profile_id)).toEqual([
      '1',
      '3',
    ]);
  });

  it('returns nothing when hostsOnly is true and no host exists', () => {
    const onlyMembers = [m('1', 'Wei'), m('2', 'Ann')];
    expect(filterMembers(onlyMembers, '', true)).toEqual([]);
  });

  it('matches accent-insensitively in both directions', () => {
    const accented = [m('1', 'Émile'), m('2', 'Wei')];
    expect(filterMembers(accented, 'emile', false).map((x) => x.profile_id)).toEqual(['1']);
    expect(filterMembers([m('3', 'emile')], 'ÉMILE', false).map((x) => x.profile_id)).toEqual(['3']);
  });
});

describe('memberInitials', () => {
  it('uses first and last words, uppercased', () => {
    expect(memberInitials('Priya Shah')).toBe('PS');
    expect(memberInitials('mary ann lee')).toBe('ML');
  });

  it('uses one initial for a single word', () => {
    expect(memberInitials('Admin')).toBe('A');
  });

  it('falls back to ? for blank input', () => {
    expect(memberInitials('')).toBe('?');
    expect(memberInitials('  ')).toBe('?');
  });
});

describe('isHostRole', () => {
  it('is true for host and co_organizer only', () => {
    expect(isHostRole('host')).toBe(true);
    expect(isHostRole('co_organizer')).toBe(true);
    expect(isHostRole('member')).toBe(false);
  });
});

describe('skillLabel', () => {
  it('maps each skill level to a label', () => {
    expect(skillLabel('beginner')).toBe('Beginner');
    expect(skillLabel('intermediate')).toBe('Intermediate');
    expect(skillLabel('advanced')).toBe('Advanced');
  });

  it('returns null when there is no skill level', () => {
    expect(skillLabel(null)).toBeNull();
  });
});

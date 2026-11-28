import { describe, expect, it } from 'vitest';
import { planSeating, type SeatingGuest } from '../seating';

const g = (id: string, level: SeatingGuest['level'], pinned: number | null = null): SeatingGuest => ({
  id, level, pinned,
});
const tableOf = (plan: ReturnType<typeof planSeating>, id: string) => plan.tables[id]?.table;

describe('planSeating', () => {
  it('fills tables in order, host at table 1', () => {
    const plan = planSeating({
      capacities: [4, 4, 4],
      guests: ['a', 'b', 'c', 'd', 'e'].map((id) => g(id, 'played')),
    });
    expect(plan.counts).toEqual([4, 2, 0]);
  });

  it('puts someone experienced at every table that has people', () => {
    const plan = planSeating({
      capacities: [4, 4],
      guests: [g('n1', 'new'), g('n2', 'new'), g('n3', 'new'), g('n4', 'new'), g('t1', 'teach')],
    });
    // Table 1 has the host; the teacher anchors table 2.
    expect(tableOf(plan, 't1')).toBe(2);
    expect(plan.counts).toEqual([4, 2]);
  });

  it('prefers a teacher, then someone who has played', () => {
    const plan = planSeating({
      capacities: [4, 4],
      guests: [g('p1', 'played'), g('a', 'played'), g('b', 'played'), g('c', 'played'), g('t1', 'teach'), g('n1', 'new')],
    });
    expect(tableOf(plan, 't1')).toBe(2);
  });

  it('spreads new players across tables', () => {
    const plan = planSeating({
      capacities: [4, 4],
      guests: [g('t1', 'teach'), g('n1', 'new'), g('n2', 'new'), g('n3', 'new'), g('n4', 'new'), g('p1', 'played'), g('p2', 'played')],
    });
    const newAt = (t: number) => ['n1', 'n2', 'n3', 'n4'].filter((id) => tableOf(plan, id) === t).length;
    expect(newAt(1)).toBe(2);
    expect(newAt(2)).toBe(2);
    expect(plan.counts).toEqual([4, 4]);
  });

  it("keeps a host's move, and fills around it", () => {
    const plan = planSeating({
      capacities: [4, 4],
      guests: [g('a', 'played', 2), g('b', 'played'), g('c', 'new')],
    });
    expect(plan.tables.a).toEqual({ table: 2, pinned: true });
    expect(plan.tables.b.pinned).toBe(false);
    expect(plan.counts).toEqual([3, 1]);
  });

  it('ignores a move to a table that is full or gone', () => {
    const plan = planSeating({
      capacities: [4],
      guests: [g('a', 'played', 3)],
    });
    expect(plan.tables.a).toEqual({ table: 1, pinned: false });
  });

  it('places everyone when every seat is taken', () => {
    const guests = Array.from({ length: 7 }, (_, i) => g(`x${i}`, i % 3 === 0 ? 'new' : 'played'));
    const plan = planSeating({ capacities: [4, 4], guests });
    expect(Object.keys(plan.tables)).toHaveLength(7);
    expect(plan.counts).toEqual([4, 4]);
  });
});

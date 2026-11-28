/**
 * A Mahj Night's suggested seating (pivot batch 2b). Pure, no imports: the
 * mahj-night edge function runs it on every read of the event page, so the
 * plan always reflects the current RSVPs and is never stored -- only a
 * host's own moves are (event_rsvps.table_number).
 *
 * Rules, in order:
 *   1. The host sits at table 1 and counts as experienced.
 *   2. Guests the host moved stay where the host put them (if there's room).
 *   3. Tables fill in order: table 1 before table 2, so three tables with
 *      six people read "Table 1 full · Table 2: 2 of 4 · Table 3: open".
 *   4. Within that, every table with anyone at it gets someone experienced
 *      ("I can teach" first, then "I've played") when there are enough.
 *   5. New players are spread across the tables, fewest new first.
 */

export type Level = 'new' | 'played' | 'teach';

export type SeatingGuest = { id: string; level: Level; pinned: number | null };

export type SeatingInput = {
  /** Seats per table, table 1 first. */
  capacities: number[];
  /** Guests who said yes, in RSVP order. */
  guests: SeatingGuest[];
};

export type SeatingPlan = {
  /** Guest id -> table (1-based) and whether the host put them there. */
  tables: Record<string, { table: number; pinned: boolean }>;
  /** People at each table, host included. */
  counts: number[];
};

export function planSeating({ capacities, guests }: SeatingInput): SeatingPlan {
  const n = capacities.length;
  const tables: SeatingPlan['tables'] = {};
  if (n === 0) return { tables, counts: [] };

  const occupied = capacities.map(() => 0);
  const experienced = capacities.map(() => 0);
  const newcomers = capacities.map(() => 0);

  // 1. The host.
  occupied[0] = 1;
  experienced[0] = 1;

  const place = (g: SeatingGuest, t: number, pinned: boolean) => {
    tables[g.id] = { table: t + 1, pinned };
    occupied[t] += 1;
    if (g.level === 'new') newcomers[t] += 1;
    else experienced[t] += 1;
  };

  // 2. The host's own moves.
  const free: SeatingGuest[] = [];
  for (const g of guests) {
    const t = g.pinned === null ? -1 : g.pinned - 1;
    if (t >= 0 && t < n && occupied[t] < capacities[t]) place(g, t, true);
    else free.push(g);
  }

  // 3. How many more each table takes, filling in order.
  const slots = capacities.map((cap, t) => Math.max(0, cap - occupied[t]));
  let left = free.length;
  const target = slots.map((s) => {
    const take = Math.min(s, left);
    left -= take;
    return take;
  });
  const room = (t: number) => target[t] > 0;
  const take = (g: SeatingGuest, t: number) => {
    target[t] -= 1;
    place(g, t, false);
  };

  const teachers = free.filter((g) => g.level === 'teach');
  const played = free.filter((g) => g.level === 'played');
  const fresh = free.filter((g) => g.level === 'new');

  // 4. Someone experienced at every table that will have people.
  for (let t = 0; t < n; t++) {
    const willHavePeople = occupied[t] + target[t] > 0;
    if (!willHavePeople || experienced[t] > 0 || !room(t)) continue;
    const g = teachers.shift() ?? played.shift();
    if (!g) break;
    take(g, t);
  }

  // 5. New players, spread: the open table with the fewest new so far.
  for (const g of fresh) {
    let best = -1;
    for (let t = 0; t < n; t++) {
      if (!room(t)) continue;
      if (best === -1 || newcomers[t] < newcomers[best]) best = t;
    }
    if (best === -1) break;
    take(g, best);
  }

  // Everyone else, in order.
  for (const g of [...teachers, ...played]) {
    const t = target.findIndex((x) => x > 0);
    if (t === -1) break;
    take(g, t);
  }

  return { tables, counts: occupied };
}

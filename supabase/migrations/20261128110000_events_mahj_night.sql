/*
 * Mahj Nights (pivot batch 2): what a game needs to be one.
 *
 * - event_type: 'mahj_night' marks the single game inside an event group.
 *   Named event_type rather than the brief's `type`, which is awkward as a
 *   bare column name in SQL and TypeScript alike.
 * - public_area: a short label the public event page may show ("Suwanee").
 *   The venue's full address stays private to guests who said yes.
 * - beginners_welcome: the "Beginners welcome" badge.
 *
 * The host note is the existing events.notes. Written by create_mahj_night
 * and set_mahj_night_details (20261128130000).
 */

create type public.event_type as enum ('regular', 'mahj_night');

alter table public.events
  add column event_type public.event_type not null default 'regular',
  add column public_area text not null default ''
    constraint events_public_area_length check (length(public_area) <= 40),
  add column beginners_welcome boolean not null default false;

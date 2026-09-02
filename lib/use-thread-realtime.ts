import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/*
 * Monotonic, not `Date.now()`/`Math.random()`: incremented once per
 * subscription below so a topic can never be handed back to a still-live
 * channel, no matter how the clock or a PRNG behave. See the effect's own
 * comment for why a unique topic (not just the dependency-array fix beside
 * it) is required.
 */
let subscriptionSeq = 0;

/**
 * Realtime, lifted out of `app/messages/[threadId].tsx` so the board and post
 * screens could subscribe the same way -- three subscribers now (the flat
 * thread screen, the board, and a post), not one.
 *
 * `postgres_changes` applies RLS per subscriber, so a channel filtered to
 * one thread_id delivers exactly what `can_read_thread` allows -- there is no
 * second authorization surface. `onInsert` fires for every message inserted
 * into the thread; it carries no payload on purpose (see a call site for why
 * a refetch, not the payload row, is what a caller should do with it).
 */
export function useThreadRealtime(
  threadId: string | undefined,
  viewerId: string | undefined,
  onInsert: () => void,
): void {
  // `onInsert` is deliberately NOT a dependency of the effect below -- a
  // caller passing an inline closure would otherwise resubscribe on every
  // render. It is read through this ref instead, kept current by its own
  // effect, so the subscription always calls the LATEST callback rather than
  // whichever one closed over the effect that set up the channel.
  const onInsertRef = useRef(onInsert);
  useEffect(() => {
    onInsertRef.current = onInsert;
  }, [onInsert]);

  useEffect(() => {
    if (!viewerId || !threadId) return;

    // `supabase.channel(topic)` REUSES an existing channel by topic
    // (RealtimeClient.channel), and `removeChannel` is async -- it awaits
    // `channel.unsubscribe()` before deregistering the topic. A React
    // cleanup cannot await, so if this effect re-runs with the same topic,
    // `channel()` can hand back the OLD, still-subscribed channel, and
    // `.on()` throws on it. `subscriptionSeq` makes every subscription's
    // topic unique so that can never happen, regardless of how slow the
    // teardown is: it is a monotonic counter incremented once per
    // subscription, not `Date.now()`/`Math.random()`, so within one JS
    // process it can never repeat and hand back a live channel -- not even
    // under React's dev double-mount or a `threadId` change racing the old
    // channel's teardown. `threadId` stays in the topic so a live channel is
    // still identifiable when debugging.
    const topic = `thread:${threadId}:${++subscriptionSeq}`;

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          onInsertRef.current();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // Keyed on `viewerId`, NOT a `session` object: lib/session.tsx hands out
    // a fresh Session object on every onAuthStateChange, TOKEN_REFRESHED
    // included, which fires within the hour and on web tab focus. Depending
    // on the object would re-subscribe on every refresh for a value that
    // only changes on a real account switch -- the same reasoning
    // lib/use-unread.ts's own docstring and app/profile.tsx already record
    // for their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, threadId]);
}

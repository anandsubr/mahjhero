import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useThreadRealtime } from './use-thread-realtime';

// The Realtime boundary, modeled after the real behavior traced in
// node_modules/@supabase/realtime-js, not just its call shape -- the same
// double app/__tests__/thread.test.tsx builds for the pre-extraction
// screen, kept here so this file catches the regression on its own once the
// subscription no longer lives in that screen at all:
//
//  - `supabase.channel(topic)` REUSES: RealtimeClient.channel finds an
//    existing channel by topic and returns it rather than creating a
//    second one. A stub that hands back a fresh object per call cannot see
//    a bug that depends on the second call getting the SAME, already-
//    subscribed channel back.
//  - `.on()` on the real RealtimeChannel THROWS once the channel is
//    subscribed (RealtimeChannel.js:418) -- that's the exact crash this
//    file exists to catch, so the double has to be able to throw it too.
//  - `removeChannel` is ASYNC on the real client (it awaits
//    `channel.unsubscribe()` before deregistering the topic); a
//    synchronous double would let a test pass by accident on timing the
//    real client never provides, since a React cleanup can't await it.
// Typed as plain call signatures, not `ReturnType<typeof vi.fn>`: `vi.fn`
// is itself generic, so extracting its return type without pinning the
// type parameter resolves against the generic's constraint
// (`Procedure | Constructable`) rather than a real function, and a `Mock`
// of that union loses its call signature entirely -- `mock.on(...)` would
// no longer type-check as callable. `vi.fn(impl)` still returns a `Mock<T>`
// that is assignable to these plain signatures, so nothing about the
// mocking itself changes.
type MockChannel = {
  topic: string;
  subscribed: boolean;
  on: (...args: unknown[]) => MockChannel;
  subscribe: () => MockChannel;
  unsubscribe: () => Promise<string>;
};

let channelsByTopic: Map<string, MockChannel>;

function makeMockChannel(topic: string): MockChannel {
  const ch = {} as MockChannel;
  ch.topic = topic;
  ch.subscribed = false;
  ch.on = vi.fn((..._args: unknown[]) => {
    if (ch.subscribed) {
      throw new Error(
        `cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`,
      );
    }
    return ch;
  });
  ch.subscribe = vi.fn(() => {
    ch.subscribed = true;
    return ch;
  });
  // Real unsubscribe() also returns a Promise; nothing here reads the
  // result, but shape parity with the client matters more than
  // convenience.
  ch.unsubscribe = vi.fn(async () => {
    // The real unsubscribe() waits on a server round trip before the
    // channel is actually torn down -- it does not flip synchronously.
    // React's cleanup for the old effect and the setup for the new one run
    // synchronously back to back in the same commit, with no microtask
    // flush in between; this await is what lets that new setup still find
    // the channel subscribed, exactly as the real async client does. A
    // synchronous flip here would make `subscribed` already false by the
    // time the new effect body runs, and the mock would fail to reproduce
    // the crash it exists to catch.
    await Promise.resolve();
    ch.subscribed = false;
    return 'ok';
  });
  return ch;
}

const channelFn = vi.fn<(topic: string) => MockChannel>((topic) => {
  const existing = channelsByTopic.get(topic);
  if (existing) return existing;
  const created = makeMockChannel(topic);
  channelsByTopic.set(topic, created);
  return created;
});

// Async, like the real RealtimeClient.removeChannel: it awaits the
// channel's own unsubscribe before the topic is free to be reused.
const removeChannel = vi.fn(async (ch: MockChannel): Promise<string> => {
  await ch.unsubscribe();
  channelsByTopic.delete(ch.topic);
  return 'ok';
});

vi.mock('./supabase', () => ({
  supabase: {
    channel: (...a: [string]) => channelFn(...a),
    removeChannel: (...a: [MockChannel]) => removeChannel(...a),
  },
}));

describe('useThreadRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelsByTopic = new Map();
  });

  it('subscribes once for a thread', () => {
    renderHook(() => useThreadRealtime('t1', 'u1', () => {}));
    expect(channelFn).toHaveBeenCalledTimes(1);
    const ch = [...channelsByTopic.values()][0];
    expect(ch.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: 'thread_id=eq.t1',
      }),
      expect.any(Function),
    );
    expect(ch.subscribe).toHaveBeenCalled();
  });

  it('does not subscribe without a signed-in viewer', () => {
    renderHook(() => useThreadRealtime('t1', undefined, () => {}));
    expect(channelFn).not.toHaveBeenCalled();
  });

  it('does not subscribe without a thread id', () => {
    renderHook(() => useThreadRealtime(undefined, 'u1', () => {}));
    expect(channelFn).not.toHaveBeenCalled();
  });

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useThreadRealtime('t1', 'u1', () => {}));
    const ch = [...channelsByTopic.values()][0];
    unmount();
    expect(removeChannel).toHaveBeenCalledWith(ch);
  });

  // The whole point of `subscriptionSeq`: a topic must never be handed back
  // to `channel()` while a channel by that same topic could still be alive.
  it('never reuses a topic across subscriptions', () => {
    const first = renderHook(() => useThreadRealtime('t1', 'u1', () => {}));
    first.unmount();
    renderHook(() => useThreadRealtime('t1', 'u1', () => {}));
    const topics = channelFn.mock.calls.map((c) => c[0]);
    expect(topics.length).toBe(2);
    expect(new Set(topics).size).toBe(topics.length);
  });

  // The regression this hook exists to guard against. `removeChannel` is
  // async, so when `threadId` changes, the OLD channel is still subscribed
  // at the instant the new effect body runs (React's cleanup for the old
  // effect and the setup for the new one run synchronously back to back,
  // with no microtask flush in between). If the new subscription's topic
  // ever collided with the old one, `supabase.channel(topic)` would hand
  // back that still-subscribed channel and `.on()` would throw. A
  // monotonic, ever-increasing `subscriptionSeq` is what keeps the topics
  // apart even though both carry the same `threadId`.
  it('survives a threadId change racing the old channel teardown, without throwing', async () => {
    const { rerender } = renderHook(
      ({ threadId }: { threadId: string }) => useThreadRealtime(threadId, 'u1', () => {}),
      { initialProps: { threadId: 't1' } },
    );
    expect(() => rerender({ threadId: 't2' })).not.toThrow();

    // The old channel's `unsubscribe()` resolves on a microtask (modeling
    // the real client's server round trip), not synchronously with
    // `rerender` -- give it one before counting who's still live.
    await Promise.resolve();
    await Promise.resolve();

    const live = [...channelsByTopic.values()].filter((c) => c.subscribed);
    expect(live.length).toBe(1);
    expect(live[0]?.topic.startsWith('thread:t2')).toBe(true);
  });

  // `onInsert` is deliberately not an effect dependency -- an inline closure
  // passed by the caller would otherwise resubscribe on every render. It
  // must still be read through a ref so the LATEST callback fires, not a
  // stale one captured when the channel was first set up.
  it('fires the latest onInsert callback, not the one captured at subscribe time', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onInsert }: { onInsert: () => void }) => useThreadRealtime('t1', 'u1', onInsert),
      { initialProps: { onInsert: first } },
    );
    rerender({ onInsert: second });

    // Only one subscription was ever made -- rerendering with a new
    // callback identity must not resubscribe.
    expect(channelFn).toHaveBeenCalledTimes(1);

    const ch = [...channelsByTopic.values()][0];
    const onCall = (ch.on as ReturnType<typeof vi.fn>).mock.calls[0];
    const handler = onCall[2] as () => void;
    handler();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

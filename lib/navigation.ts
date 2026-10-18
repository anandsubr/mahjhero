import type { Href, useRouter } from 'expo-router';

/** expo-router exports the hook, not its return type, by this name. */
type Router = ReturnType<typeof useRouter>;

/**
 * The one back rule for every screen: pop when there is history to unwind,
 * otherwise replace with the screen's fixed fallback. A deep link, a web
 * reload or a cold launch straight into a route has nothing to pop, and a
 * fallback that pushed would leave the screen being left one browser-back
 * away -- so it replaces. Never `push` to go back.
 */
export function goBack(router: Pick<Router, 'canGoBack' | 'back' | 'replace'>, fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

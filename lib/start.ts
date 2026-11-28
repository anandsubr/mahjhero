import { Platform, Share } from 'react-native';

/**
 * First run (pivot batch 1): the "What brings you here?" choices on Home for
 * someone with no groups yet.
 */

/**
 * Where a pasted invite link should open inside the app, or null when the
 * text is not a link to one of our screens.
 *
 * Only the path (plus its query) is kept, never the host: whatever was
 * pasted, the result is always a route in this app, so a link can't send
 * anyone off-site. Bare paths ("/clubs/…") work too, and a link without a
 * scheme ("app.mahjhero.com/clubs/…") is read as https.
 */
export function inAppPathFromLink(text: string): string | null {
  const raw = text.trim();
  if (raw.length === 0) return null;

  let path: string;
  let search = '';
  if (raw.startsWith('/')) {
    const q = raw.indexOf('?');
    path = q === -1 ? raw : raw.slice(0, q);
    search = q === -1 ? '' : raw.slice(q);
  } else {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) && url.protocol !== 'mahjhero:') return null;
    // mahjhero://clubs/x parses "clubs" as the host.
    path = url.protocol === 'mahjhero:' ? `/${url.host}${url.pathname}` : url.pathname;
    search = url.search;
  }

  // Screens an invite can point at. Anything else is not an invite link.
  if (!/^\/(clubs|messages|e)\/[^/]/.test(path)) return null;
  return `${path}${search}`;
}

/** What "Ask a friend to host" shares. */
export function askAFriendToHostMessage(appUrl: string): string {
  return `Want to host a mahj night? MahjHero does the invitations and seats everyone at tables of four, and there are tips for first-timers. ${appUrl}`;
}

export const ASK_A_FRIEND_URL = 'https://mahjhero.com/?src=ask_a_friend';

/**
 * Shares "Ask a friend to host". Same shape as shareClubCode: the clipboard
 * on web, the system Share sheet on native, and never throws.
 */
export async function shareAskAFriendToHost(): Promise<'shared' | 'copied' | 'failed'> {
  const message = askAFriendToHostMessage(ASK_A_FRIEND_URL);
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(message);
      return 'copied';
    }
    await Share.share({ message });
    return 'shared';
  } catch (cause) {
    console.error('shareAskAFriendToHost failed', cause);
    return 'failed';
  }
}

/**
 * Where sign-in may send someone back to (`/sign-in?next=…`): only this
 * app's own Mahj Night, group and message screens, never another site.
 */
export function safeReturnPath(next: unknown): string | null {
  if (typeof next !== 'string' || next.length > 300) return null;
  if (!/^\/(e|clubs|messages)\/[A-Za-z0-9_\-]/.test(next)) return null;
  if (/[\\\s]|\/\//.test(next)) return null;
  return next;
}

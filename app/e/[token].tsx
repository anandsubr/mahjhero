import Head from 'expo-router/head';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import Button from '../../components/Button';
import Screen from '../../components/Screen';
import ThemeArt from '../../components/night/ThemeArt';
import RsvpForm from '../../components/night/RsvpForm';
import HostPanel from '../../components/night/HostPanel';
import {
  claimMyRsvps,
  eventUrl,
  fetchEventPage,
  formatNightWhen,
  googleCalendarUrl,
  icsDataUrl,
  loadRsvpSecret,
  saveRsvpSecret,
  type EventPage,
} from '../../lib/mahj-nights';
import { nightTheme } from '../../lib/themes';
import { useSession } from '../../lib/session';
import { colors, type } from '../../lib/theme';

/**
 * A Mahj Night's event page (pivot batch 2): public by link, works in a
 * browser with no account. What it shows depends on who's looking (see
 * event_page in 20261128130000): anyone with the link, a guest who said yes,
 * or the host.
 *
 * `?r=` carries a guest's RSVP secret from their confirmation email; it is
 * kept in this browser so the guest view survives a reload. `?created=1`
 * is the host arriving straight from Host a Mahj Night.
 */
export default function EventPageScreen() {
  const params = useLocalSearchParams<{ token: string; r?: string; created?: string }>();
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const [token, setToken] = useState(String(params.token ?? ''));
  const [secret, setSecret] = useState<string | null>(null);
  const [page, setPage] = useState<EventPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'not_found' | 'failed'>('loading');

  const load = useCallback(
    async (useSecret: string | null) => {
      const { page: next, error } = await fetchEventPage(token, useSecret);
      if (error) {
        setState(error);
        return;
      }
      setPage(next);
      setState('ready');
    },
    [token],
  );

  useEffect(() => {
    if (sessionLoading || !token) return;
    let cancelled = false;
    (async () => {
      let s = typeof params.r === 'string' && params.r.length >= 20 ? params.r : null;
      if (s) await saveRsvpSecret(token, s);
      else s = await loadRsvpSecret(token);
      if (session) await claimMyRsvps();
      if (cancelled) return;
      setSecret(s);
      await load(s);
    })();
    return () => {
      cancelled = true;
    };
    // session?.user.id: re-run on sign-in/out, not on every token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sessionLoading, session?.user.id]);

  if (state === 'loading') {
    return (
      <Screen center>
        <NoIndex title="Mahj Night" />
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (state !== 'ready' || !page) {
    return (
      <Screen center contentStyle={styles.missing}>
        <NoIndex title="Mahj Night" />
        <Text style={styles.title}>
          {state === 'not_found' ? "This invite isn't open" : 'Could not load the invite'}
        </Text>
        <Text style={styles.body}>
          {state === 'not_found'
            ? 'The link may have been turned off or replaced. Ask your host for a new one.'
            : 'Check your connection and try again.'}
        </Text>
        {state === 'failed' ? (
          <Button big={false} onPress={() => { setState('loading'); load(secret); }} accessibilityLabel="Try again">
            Try again
          </Button>
        ) : null}
      </Screen>
    );
  }

  const theme = nightTheme(page.theme_id);
  const cancelled = page.status === 'cancelled';
  const isHost = page.tier === 'host';
  const isGuest = page.tier === 'guest';
  const signedIn = !!session;
  const openGame = () =>
    page.club_id && page.event_id && router.push(`/clubs/${page.club_id}/events/${page.event_id}`);

  return (
    <Screen scroll contentStyle={styles.body_}>
      <NoIndex title={page.title} />
      <ThemeArt theme={theme} height={180} />

      <View style={styles.headline}>
        <Text style={styles.title} accessibilityRole="header">
          {page.title}
        </Text>
        {page.host_first_name ? (
          <Text style={styles.host}>{`Hosted by ${page.host_first_name}`}</Text>
        ) : null}
      </View>

      {cancelled ? (
        <View style={styles.cancelled}>
          <Text style={styles.cancelledText}>This night was cancelled.</Text>
        </View>
      ) : null}

      <View style={styles.facts} testID="night-facts">
        <Fact label="When" value={formatNightWhen(page.starts_at, page.timezone)} />
        {page.address ? (
          <Fact label="Where" value={page.address} />
        ) : page.area ? (
          <Fact label="Where" value={page.area} />
        ) : null}
        <Fact
          label="Tables"
          value={`${page.tables} ${page.tables === 1 ? 'table' : 'tables'} of four · ${page.going_count} going`}
        />
        {page.beginners_welcome ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Beginners welcome</Text>
          </View>
        ) : null}
      </View>

      {isHost ? (
        <HostPanel
          page={page}
          token={page.link_token ?? token}
          created={params.created === '1'}
          onEdit={() =>
            page.club_id && page.event_id &&
            router.push(`/clubs/${page.club_id}/events/${page.event_id}/edit`)
          }
          onOpenGame={openGame}
          onLinkChanged={(fresh) => {
            if (fresh) {
              setToken(fresh);
              router.setParams({ token: fresh, created: undefined });
            } else {
              load(secret);
            }
          }}
        />
      ) : null}

      {(isGuest || isHost) && page.note ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>{`From ${page.host_first_name || 'the host'}`}</Text>
          <Text style={styles.note}>{page.note}</Text>
        </View>
      ) : null}

      {(isGuest || isHost) && page.going_names && page.going_names.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Who's going</Text>
          <Text style={styles.note}>
            {[page.host_first_name, ...page.going_names].filter(Boolean).join(', ')}
          </Text>
        </View>
      ) : null}

      {!isHost && !cancelled ? (
        <RsvpForm
          key={page.my_rsvp ? `${page.my_rsvp.status}` : 'new'}
          token={token}
          page={page}
          secret={secret}
          onSaved={async (fresh) => {
            if (fresh) {
              await saveRsvpSecret(token, fresh);
              setSecret(fresh);
            }
            await load(fresh ?? secret);
          }}
        />
      ) : null}

      {(isGuest || isHost) && !cancelled ? (
        <CalendarButtons page={page} token={token} />
      ) : null}

      {isGuest && !cancelled ? (
        <View style={styles.card} testID="guest-sign-in">
          {signedIn && page.club_id ? (
            <>
              <Text style={styles.body}>Message the group or pick your seat in the game.</Text>
              <Button variant="secondary" big={false} onPress={openGame} accessibilityLabel="Open the game">
                Open the game
              </Button>
            </>
          ) : (
            <>
              <Text style={styles.body}>
                Want to message the group or pick a seat? Sign in with the email you used to
                RSVP. We'll send you a 6-digit code.
              </Text>
              <Button
                variant="secondary"
                big={false}
                onPress={() => router.push(`/sign-in?next=${encodeURIComponent(`/e/${token}`)}`)}
                accessibilityLabel="Sign in with a code"
              >
                Sign in with a code
              </Button>
            </>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function CalendarButtons({ page, token }: { page: EventPage; token: string }) {
  const facts = {
    title: page.title,
    startsAt: page.starts_at,
    endsAt: page.ends_at,
    address: page.address ?? page.area,
    details: page.note ?? '',
    url: eventUrl(token),
  };
  return (
    <View style={styles.card} testID="add-to-calendar">
      <Text style={styles.cardLabel}>Add to calendar</Text>
      <View style={styles.row}>
        <Button
          variant="secondary"
          big={false}
          onPress={() => Linking.openURL(googleCalendarUrl(facts))}
          accessibilityLabel="Google Calendar"
        >
          Google Calendar
        </Button>
        <Button
          variant="secondary"
          big={false}
          onPress={() => {
            const href = icsDataUrl(facts, page.event_id ?? token);
            if (Platform.OS === 'web') {
              const a = document.createElement('a');
              a.href = href;
              a.download = 'mahj-night.ics';
              a.click();
            } else {
              Linking.openURL(href);
            }
          }}
          accessibilityLabel="Apple or Outlook (.ics)"
        >
          Apple or Outlook
        </Button>
      </View>
    </View>
  );
}

/** Keeps the page out of search results (the Vercel function also sends X-Robots-Tag). */
function NoIndex({ title }: { title: string }) {
  return (
    <Head>
      <title>{title}</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
  );
}

const styles = StyleSheet.create({
  body_: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 16 },
  missing: { alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  headline: { gap: 4, paddingHorizontal: 4 },
  title: { fontFamily: type.heading, fontSize: 32, lineHeight: 36, color: colors.text, textAlign: 'left' },
  host: { fontFamily: type.bodySemiBold, fontSize: 16, color: colors.neutral[700] },
  body: { fontFamily: type.bodyRegular, fontSize: 15, lineHeight: 22, color: colors.neutral[700] },
  facts: { gap: 10, paddingHorizontal: 4 },
  fact: { gap: 1 },
  factLabel: { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.neutral[700] },
  factValue: { fontFamily: type.bodySemiBold, fontSize: 17, color: colors.text },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accent2[100],
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { fontFamily: type.bodyBold, fontSize: 13, color: colors.accent2[800] },
  cancelled: { backgroundColor: colors.accent[100], borderRadius: 16, padding: 14 },
  cancelledText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.accent[800] },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 10 },
  cardLabel: { fontFamily: type.bodyBold, fontSize: 14, color: colors.text },
  note: { fontFamily: type.bodyRegular, fontSize: 15, lineHeight: 22, color: colors.text },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

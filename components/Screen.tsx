import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout } from '../lib/theme';

type ScreenProps = {
  children: ReactNode;
  /** Renders content inside a ScrollView, for screens taller than the viewport. */
  scroll?: boolean;
  /** Vertically centers the content column — for sign-in and the loading/error states. */
  center?: boolean;
  /** Fills the full viewport regardless of content — the part a maxWidth must NOT touch. */
  background?: string;
  /**
   * Extra style for the constrained content column itself (padding, gap,
   * alignItems, etc.) — anything a screen previously put on its outermost
   * container, short of `flex`/`backgroundColor`, which now belong to the
   * full-bleed wrapper this component provides.
   */
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * The app's bottom tab bar, for the four screens that are tabs. Rendered
   * outside the scroller: inside, it would scroll off the bottom of a long
   * dashboard, which is exactly where it is most needed.
   */
  tabBar?: ReactNode;
  /**
   * Forwarded verbatim to the underlying `ScrollView`'s own
   * `stickyHeaderIndices` (only meaningful together with `scroll`). Optional
   * and `undefined` by default, so every existing caller keeps rendering
   * through the single wrapped `content` View exactly as before — this prop
   * changes nothing unless a caller opts in.
   *
   * React Native pins ScrollView's DIRECT children by index, but this
   * component normally bundles all of `children` into one `content` View
   * (see below) so there is only ever one such child — index 0 would just
   * pin the whole screen. So when this prop is given, `children` is instead
   * passed straight through to the ScrollView UNWRAPPED, and it becomes the
   * caller's job to supply the top-level elements the indices should refer
   * to (each with its own width/centering styling, since `contentStyle` is
   * not applied to them here). See the door list
   * (app/clubs/[id]/events/[eventId]/check-in.tsx) for a worked example: a
   * scrolling header block, the sticky search field, then the scrolling
   * list.
   */
  stickyHeaderIndices?: number[];
};

/**
 * The one shared width constraint for all four screens. Without it, content
 * stretches edge-to-edge on a desktop browser — a real case here, not an
 * edge case: club invite links must open a working app in a browser, so a
 * member on a laptop is a first-class user.
 *
 * Two layers, deliberately: an outer full-bleed View/ScrollView that always
 * fills the viewport with the page background, and an inner content column
 * capped at `layout.contentMaxWidth` and centered horizontally
 * (`alignSelf: 'center'`) with `width: '100%'` so it still fills a narrow
 * (phone) screen instead of ever exceeding the viewport. Only the inner
 * layer is width-constrained — the background must keep filling the full
 * viewport, or a cream column on a white void looks broken.
 */
export default function Screen({
  children,
  scroll = false,
  center = false,
  background = colors.bg,
  contentStyle,
  tabBar,
  stickyHeaderIndices,
}: ScreenProps) {
  // The status bar/notch/Dynamic Island inset. Applied here, on the layer
  // above `contentStyle`, rather than folded into `styles.content`: nearly
  // every screen's own `contentStyle` sets `padding` as a shorthand for its
  // side margins (see e.g. app/clubs/index.tsx's `container`), and a later
  // shorthand `padding` in the same style array would silently win over an
  // earlier `paddingTop`, discarding the inset on every one of those
  // screens. Landing it on the scroll/view wrapper instead means no
  // screen's own styling can ever cancel it out.
  const insets = useSafeAreaInsets();
  const content = <View style={[styles.content, contentStyle]}>{children}</View>;

  const body = scroll ? (
    <ScrollView
      // Test-only handle, no behaviour attached. On web this renders as
      // `data-testid`, which e2e/visual.spec.ts uses to measure how tall
      // this scroller's content actually is: react-native-web scrolls an
      // inner `overflow: auto` div rather than the document, so the page
      // itself never grows and a screenshot would otherwise stop at the
      // fold. See "Why the visual suite resizes the viewport" in
      // docs/testing.md.
      testID="screen-scroll"
      style={[styles.fill, { backgroundColor: background }]}
      contentContainerStyle={[
        { paddingTop: insets.top },
        center ? styles.scrollCenter : null,
      ]}
      stickyHeaderIndices={stickyHeaderIndices}
    >
      {stickyHeaderIndices ? children : content}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.fill,
        { backgroundColor: background, paddingTop: insets.top },
        center ? styles.center : null,
      ]}
    >
      {content}
    </View>
  );

  if (!tabBar) return body;

  return (
    <View style={[styles.fill, { backgroundColor: background }]}>
      <View style={styles.tabShellBody}>{body}</View>
      {/*
        The bar is capped and centred like the content column rather than
        running full-bleed. On a desktop browser — a first-class case here,
        since club invite links open the web build — a 1400px-wide tab bar
        under a 440px column reads as a different app's chrome.
      */}
      <View style={styles.tabBarColumn}>{tabBar}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
  },
  center: {
    justifyContent: 'center',
  },
  scrollCenter: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  tabShellBody: {
    flex: 1,
    minHeight: 0,
  },
  tabBarColumn: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
});

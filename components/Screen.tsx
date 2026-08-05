import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
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
}: ScreenProps) {
  const content = <View style={[styles.content, contentStyle]}>{children}</View>;

  if (scroll) {
    return (
      <ScrollView
        style={[styles.fill, { backgroundColor: background }]}
        contentContainerStyle={center ? styles.scrollCenter : null}
      >
        {content}
      </ScrollView>
    );
  }

  return (
    <View
      style={[
        styles.fill,
        { backgroundColor: background },
        center ? styles.center : null,
      ]}
    >
      {content}
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
});

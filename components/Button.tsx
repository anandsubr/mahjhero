import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityState,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text } from './Text';
import { colors, radius, shadow, space, type } from '../lib/theme';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'dark'
  // Not in the design system, which draws its one destructive action
  // (sign out) as a ghost link. A bare link is the wrong weight for the
  // control that ends the session, and it read as a stray link rather than
  // a button. Lives here rather than as inline style at the call site so
  // the next destructive action inherits one treatment.
  | 'destructive';

type ButtonProps = {
  children: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Stretches the button to fill its container's width. */
  block?: boolean;
  /**
   * The design system's ".big" modifier — 19px text, 58px minimum height.
   * This is the standard size for this app's controls (older player base
   * needs a larger target), so it defaults to true.
   */
  big?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  /**
   * Extra accessibility state to merge in on top of `{ disabled, busy }` --
   * e.g. `{ selected: true }` for a Button used as a chip-style selector
   * (see app/clubs/[id]/events/new.tsx's duration/table-count/repeat rows).
   * `disabled`/`busy` here are always the ones this component computes
   * itself; a caller cannot use this to lie about either.
   *
   * `disabled`/`busy` are NOT read out of this prop, even if a caller sets
   * them -- see the flat `aria-disabled`/`aria-busy` props on `Pressable`
   * below, and Toggle.tsx's docstring for why. Any other key (e.g.
   * `selected`) still reaches the DOM/native tree through this prop
   * unchanged.
   */
  accessibilityState?: AccessibilityState;
  /** Rendered to the left of the label, e.g. a back-chevron icon. */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * The loading spinner's tint per variant. A lookup rather than the ternary
 * this replaced (`variant === 'primary' || variant === 'dark' ? bg : accent`),
 * which silently gave every new variant the accent tint whether or not it
 * read on that variant's ground.
 */
const spinnerColor: Record<ButtonVariant, string> = {
  primary: colors.bg,
  dark: colors.bg,
  secondary: colors.accent[700],
  ghost: colors.accent[700],
  destructive: colors.accent[800],
};

export default function Button({
  children,
  onPress,
  variant = 'primary',
  block = false,
  big = true,
  disabled = false,
  loading = false,
  accessibilityLabel,
  accessibilityState,
  icon,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const busy = loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      // Flat `aria-*` props, not folded into `accessibilityState` above --
      // react-native-web's createDOMProps has no handling for
      // `accessibilityState` at all (see Toggle.tsx's docstring for the full
      // account), so `disabled`/`busy` computed here would never reach the
      // DOM if passed that way, and every Button-based control in the app
      // would render with no `aria-disabled`/`aria-busy`. React Native's own
      // Pressable resolves `disabled: ariaDisabled ?? accessibilityState
      // ?.disabled` (and the equivalent for `busy`), so this one prop still
      // reaches the native accessibility tree too.
      aria-disabled={isDisabled}
      aria-busy={busy}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        big ? styles.big : styles.regular,
        block ? styles.block : null,
        variant === 'ghost' ? styles.ghostPadding : null,
        isDisabled ? styles.disabled : null,
        pressed && !isDisabled ? styles.pressed : null,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={spinnerColor[variant]}
          accessibilityLabel={accessibilityLabel}
        />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text
            style={[
              styles.label,
              variantTextStyles[variant],
              big ? styles.labelBig : null,
            ]}
          >
            {children}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[5],
    borderWidth: 1,
    borderColor: 'transparent',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  regular: {
    minHeight: 46,
  },
  big: {
    // .big overrides padding to `0 22px !important` in the design system;
    // 22 is exactly space-5, so this only needs to cancel the vertical
    // padding base doesn't set and keep horizontal at space[5].
    minHeight: 58,
    paddingHorizontal: space[5],
  },
  block: {
    alignSelf: 'stretch',
    width: '100%',
  },
  ghostPadding: {
    // .btn-ghost: padding-inline: var(--space-1).
    paddingHorizontal: space[1],
    minHeight: undefined,
  },
  label: {
    // Figtree bold. The original Organic design set `.btn` in the heading
    // face, and this component followed it; Linen & Jade drops that --
    // "everything else, buttons included, uses Figtree", no display font
    // inside a button (docs/design/linen-jade/README.md §2). The heading
    // face is for titles only, so there is no longer a per-button opt-in
    // to the body face: every Button already has it.
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
  },
  labelBig: {
    fontSize: type.size.bodyLarge,
  },
  disabled: {
    // .btn:disabled { opacity: 0.45 }
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.85,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    // .btn-primary { background: var(--color-accent); color: var(--color-bg) }
    // -- but Linen & Jade's brighter accent (#df7a55) carries cream text at
    // only 2.75:1, so the fill is accent[700] (5.77:1), the step the
    // Linen & Jade README names for primary buttons. Pinned in
    // lib/theme.test.ts ("button text/fill pairs clear AA").
    backgroundColor: colors.accent[700],
    ...shadow.sm,
  },
  secondary: {
    // .btn-secondary { border-color: var(--color-divider) } — background
    // isn't set by the base class; every design instance supplies
    // `background: var(--color-surface)` inline, so that's the default here.
    backgroundColor: colors.surface,
    borderColor: colors.divider,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  dark: {
    backgroundColor: colors.neutral[900],
  },
  destructive: {
    // The same pairing Tag's `accent` variant uses, at 7.77:1.
    backgroundColor: colors.accent[200],
  },
});

const variantTextStyles = StyleSheet.create({
  // .btn-primary's text colour is --color-bg (warm cream), not white —
  // keeps the palette warm. Already correct here.
  primary: { color: colors.bg },
  secondary: { color: colors.text },
  // .btn-ghost { color: var(--color-accent) } -- accent[700] instead
  // (5.77:1 on bg, 5.16:1 on surface): accentColor is 2.75:1 on bg.
  ghost: { color: colors.accent[700] },
  dark: { color: colors.bg },
  destructive: { color: colors.accent[800] },
});

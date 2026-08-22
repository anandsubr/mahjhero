import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radius, shadow, space, type } from '../lib/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark';

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
  /**
   * `.btn`'s base rule sets `font-family: var(--font-heading)` (Caprasimo,
   * weight 400) with no override — that's the system's signature move, and
   * it applies to every plain button in the design (primary CTAs, secondary
   * CTAs, and even the ghost back/sign-out links) with no exceptions found
   * in 1C-variant.html. The design overrides back to the body font only on
   * bespoke option-style controls (the skill-level tiles, the
   * notification-channel rows) that are NOT built from this component —
   * see components/SkillLevelPicker.tsx and app/notifications.tsx's inline
   * channel rows, which set Figtree 700 / 600 directly. This prop exists so
   * a future Button-based option control can opt into that body face
   * instead of duplicating Button's layout by hand; no current call site
   * needs it.
   */
  bodyFace?: boolean;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  /** Rendered to the left of the label, e.g. a back-chevron icon. */
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export default function Button({
  children,
  onPress,
  variant = 'primary',
  block = false,
  big = true,
  bodyFace = false,
  disabled = false,
  loading = false,
  accessibilityLabel,
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
      accessibilityState={{ disabled: isDisabled, busy }}
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
          color={variant === 'primary' || variant === 'dark' ? colors.bg : colors.accentColor}
          accessibilityLabel={accessibilityLabel}
        />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text
            style={[
              styles.label,
              bodyFace ? styles.labelBodyFace : null,
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
    // .btn's base font-family is the HEADING face (Caprasimo, weight 400)
    // with no override — the system's signature move, not a mistake.
    fontFamily: type.heading,
    fontSize: type.size.body,
  },
  labelBodyFace: {
    fontFamily: type.bodySemiBold,
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
    backgroundColor: colors.accentColor,
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
});

const variantTextStyles = StyleSheet.create({
  // .btn-primary's text colour is --color-bg (warm cream), not white —
  // keeps the palette warm. Already correct here.
  primary: { color: colors.bg },
  secondary: { color: colors.text },
  // .btn-ghost { color: var(--color-accent) }
  ghost: { color: colors.accentColor },
  dark: { color: colors.bg },
});

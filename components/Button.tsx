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
   * needs a larger target), so it defaults to true. Only the small inline
   * text-links styled as `variant="ghost"` (back links, "Manage", "Edit")
   * should opt out.
   */
  big?: boolean;
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
          <Text style={[styles.label, variantTextStyles[variant], big ? styles.labelBig : null]}>
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
    minHeight: 58,
    paddingHorizontal: space[6],
  },
  block: {
    alignSelf: 'stretch',
    width: '100%',
  },
  ghostPadding: {
    paddingHorizontal: space[2],
    minHeight: undefined,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
  },
  labelBig: {
    fontSize: type.size.bodyLarge,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.accentColor,
    ...shadow.sm,
  },
  secondary: {
    backgroundColor: colors.surface,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  dark: {
    backgroundColor: colors.neutral[900],
  },
});

const variantTextStyles = StyleSheet.create({
  primary: { color: colors.bg },
  secondary: { color: colors.text },
  ghost: { color: colors.accentColor },
  dark: { color: colors.bg },
});

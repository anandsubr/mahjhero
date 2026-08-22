import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow, space } from '../lib/theme';

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Card background — defaults to the design system's surface tone. */
  background?: string;
  /** Row layout instead of the default column, for icon/label + action cards. */
  row?: boolean;
  elevated?: boolean;
};

export default function Card({
  children,
  style,
  background = colors.surface,
  row = false,
  elevated = false,
}: CardProps) {
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: background },
        row ? styles.row : styles.column,
        elevated ? shadow.sm : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    // .card { padding: var(--space-3); gap: var(--space-2);
    //   border-radius: calc(var(--radius-lg) * 1.15) } — this is the base
    // default; most design instances override padding inline (usually to
    // space-4), which callers do via the `style` prop.
    borderRadius: radius.card,
    padding: space[3],
    gap: space[2],
  },
  column: {
    flexDirection: 'column',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

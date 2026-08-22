import { StyleSheet, Text } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

type TagProps = {
  children: string;
  variant?: 'accent' | 'accent2';
};

export default function Tag({ children, variant = 'accent' }: TagProps) {
  return (
    <Text style={[styles.base, variant === 'accent' ? styles.accent : styles.accent2]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    overflow: 'hidden',
  },
  accent: {
    backgroundColor: colors.accent[200],
    color: colors.accent[800],
  },
  accent2: {
    backgroundColor: colors.accent2[200],
    color: colors.accent2[800],
  },
});

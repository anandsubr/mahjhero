import { StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, radius, space, type } from '../lib/theme';

type TagProps = {
  children: string;
  variant?: 'accent' | 'accent2';
  /** `small`: the game screen's 12pt table tags (game-screen 2a handoff). */
  size?: 'regular' | 'small';
};

export default function Tag({ children, variant = 'accent', size = 'regular' }: TagProps) {
  return (
    <Text
      style={[
        styles.base,
        variant === 'accent' ? styles.accent : styles.accent2,
        size === 'small' ? styles.small : null,
      ]}
    >
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
  small: {
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
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

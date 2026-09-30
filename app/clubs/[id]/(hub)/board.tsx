import { StyleSheet } from 'react-native';
import { Text } from '../../../../components/Text';
import HubSection from '../../../../components/hub/HubSection';
import { colors, type } from '../../../../lib/theme';

/** Placeholder until the Board section is built (club-hub phase 2). */
export default function BoardSection() {
  return (
    <HubSection>
      <Text style={styles.placeholder}>Board is coming soon.</Text>
    </HubSection>
  );
}

const styles = StyleSheet.create({
  placeholder: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.textMuted },
});

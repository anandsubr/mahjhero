import { StyleSheet } from 'react-native';
import { Text } from '../../../../components/Text';
import HubSection from '../../../../components/hub/HubSection';
import { colors, type } from '../../../../lib/theme';

/** Placeholder until the Photos section is built (club-hub phase 2). */
export default function PhotosSection() {
  return (
    <HubSection>
      <Text style={styles.placeholder}>Photos and files are coming soon.</Text>
    </HubSection>
  );
}

const styles = StyleSheet.create({
  placeholder: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.textMuted },
});

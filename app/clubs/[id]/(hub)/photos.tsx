import { StyleSheet, View } from 'react-native';
import { Text } from '../../../../components/Text';
import HubSection from '../../../../components/hub/HubSection';
import { ImageIcon } from '../../../../components/icons';
import { colors, type } from '../../../../lib/theme';

/** The club hub's Photos section: nothing here yet but the "coming soon" note. */
export default function PhotosSection() {
  return (
    <HubSection>
      <View style={styles.container}>
        <ImageIcon size={40} color={colors.neutral[600]} />
        <Text style={styles.placeholder}>Photos and files are coming soon.</Text>
      </View>
    </HubSection>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  placeholder: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.neutral[700] },
});

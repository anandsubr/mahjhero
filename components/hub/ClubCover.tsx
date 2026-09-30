import { useEffect, useState, type ReactNode } from 'react';
import { ImageBackground, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { coverColorValue } from '../../lib/club-hub';
import { colors } from '../../lib/theme';

/** `#rrggbb` → `rgba(r, g, b, alpha)`, so the scrim derives from the token. */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const SCRIM = withAlpha(colors.neutral[900], 0.55);

/**
 * A club's cover as a background: the photo under a 55% `neutral[900]`
 * scrim, or the club's cover colour. The colour also shows while the photo
 * loads and if it fails to. Shared by the hub header and the settings
 * preview so both draw a cover the same way.
 *
 * `testIDPrefix` names the photo (`{prefix}-cover-photo`) and scrim
 * (`{prefix}-scrim`); `testID` names the colour-only view.
 */
export default function ClubCover({
  coverUrl,
  coverColor,
  style,
  testID,
  testIDPrefix,
  children,
}: {
  coverUrl: string | null;
  coverColor: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  testIDPrefix: string;
  children?: ReactNode;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);

  // A new cover URL (replaced photo, re-signed URL) gets a fresh attempt.
  useEffect(() => {
    setPhotoFailed(false);
  }, [coverUrl]);

  const background = coverColorValue(coverColor);

  if (coverUrl && !photoFailed) {
    return (
      <ImageBackground
        testID={`${testIDPrefix}-cover-photo`}
        source={{ uri: coverUrl }}
        resizeMode="cover"
        onError={() => setPhotoFailed(true)}
        style={[style, { backgroundColor: background }]}
      >
        <View
          testID={`${testIDPrefix}-scrim`}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]}
        />
        {children}
      </ImageBackground>
    );
  }

  return (
    <View testID={testID} style={[style, { backgroundColor: background }]}>
      {children}
    </View>
  );
}

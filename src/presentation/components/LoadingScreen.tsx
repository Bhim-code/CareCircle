import React from 'react';
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LOGO_ASPECT, LOGO_TO_DOTS_GAP, LOADING_LABEL, logoWidth } from '../../application/loadingDots';
import { colors } from '../theme/theme';
import { LoadingDots } from './LoadingDots';

/** Shown while the app checks whether someone is signed in: the logo, with three pulsing dots below it. */
export function LoadingScreen() {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.container} accessible accessibilityRole="progressbar" accessibilityLabel={LOADING_LABEL}>
      <Image
        source={require('../../../assets/images/carecircle-logo.png')}
        style={{ width: logoWidth(width), aspectRatio: LOGO_ASPECT }}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.dots}>
        <LoadingDots announce={false} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  dots: { marginTop: LOGO_TO_DOTS_GAP },
});

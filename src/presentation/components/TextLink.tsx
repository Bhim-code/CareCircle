import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/theme';
import { AppText } from './AppText';

interface TextLinkProps {
  label: string;
  onPress: () => void;
}

export function TextLink({ label, onPress }: TextLinkProps) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.link}
    >
      <AppText variant="label" color={colors.harbor} style={styles.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  text: { textDecorationLine: 'underline' },
});

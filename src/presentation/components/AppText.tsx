import React from 'react';
import { Text, type TextProps } from 'react-native';
import { colors, typography, type TextVariant } from '../theme/theme';

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
}

export function AppText({ variant = 'body', color = colors.ink, style, ...rest }: AppTextProps) {
  return <Text {...rest} style={[typography[variant], { color }, style]} />;
}

import React from 'react';
import { Text, type TextProps } from 'react-native';
import { colors, typography, type TextVariant } from '../theme/theme';
import { useTextScale } from '../providers/PreferencesProvider';

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
}

export function AppText({ variant = 'body', color = colors.ink, style, ...rest }: AppTextProps) {
  const scale = useTextScale();
  const base = typography[variant];
  const sized =
    scale === 1
      ? base
      : {
          ...base,
          fontSize: (base.fontSize ?? 16) * scale,
          lineHeight: base.lineHeight ? base.lineHeight * scale : undefined,
        };
  return <Text {...rest} style={[sized, { color }, style]} />;
}

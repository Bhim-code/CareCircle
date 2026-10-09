import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, spacing, touchTarget, typography } from '../theme/theme';
import { AppText } from './AppText';

interface TextFieldProps
  extends Omit<TextInputProps, 'style' | 'onChangeText' | 'value' | 'secureTextEntry'> {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  /** Adds a Show/Hide button and hides the text by default. */
  secret?: boolean;
}

/** A labelled input. The label stays visible above the field; it is never only a placeholder. */
export function TextField({
  label,
  value,
  onChangeText,
  error,
  secret = false,
  ...rest
}: TextFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.harbor : colors.line;

  return (
    <View style={styles.wrapper}>
      <AppText variant="label" style={styles.label}>
        {label}
      </AppText>
      <View style={[styles.field, { borderColor, borderWidth: focused || error ? 2 : 1 }]}>
        <TextInput
          {...rest}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secret && !revealed}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => setRevealed((current) => !current)}
            hitSlop={8}
            style={styles.reveal}
          >
            <AppText variant="label" color={colors.harbor}>
              {revealed ? 'Hide' : 'Show'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText
          variant="caption"
          color={colors.danger}
          accessibilityLiveRegion="polite"
          style={styles.error}
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing.md },
  label: { marginBottom: spacing.xs },
  field: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper,
    borderRadius: radius.field,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, color: colors.ink, ...typography.body, paddingVertical: spacing.sm },
  reveal: { minHeight: 44, justifyContent: 'center', paddingLeft: spacing.md },
  error: { marginTop: spacing.xs },
});

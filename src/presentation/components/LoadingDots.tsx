import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import {
  CYCLE_MS,
  DOT_COLOR,
  DOT_COUNT,
  DOT_MAX_OPACITY,
  DOT_MAX_SCALE,
  DOT_MIN_OPACITY,
  DOT_MIN_SCALE,
  LOADING_LABEL,
  STAGGER_MS,
  runDots,
  stillLook,
  type MotionPreference,
} from '../../application/loadingDots';

/** The phone's "reduce motion" setting. */
const motionPreference: MotionPreference = {
  isReduceMotionEnabled: () => AccessibilityInfo.isReduceMotionEnabled(),
  onChange: (listener) => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', listener);
    return () => subscription.remove();
  },
};

interface LoadingDotsProps {
  /** Width and height of each dot, in points. The gap between dots is the same. */
  size?: number;
  color?: string;
  /**
   * True when the dots are all that says "loading" (screen readers hear the label). False when
   * something around them already says it, such as a button or a line of text.
   */
  announce?: boolean;
  label?: string;
}

/**
 * Three round dots that pulse one after another, calmly. Nothing spins or flashes. With
 * "reduce motion" switched on in the phone they stay still.
 */
export function LoadingDots({ size = 12, color = DOT_COLOR, announce = true, label = LOADING_LABEL }: LoadingDotsProps) {
  const progress = useRef(Array.from({ length: DOT_COUNT }, () => new Animated.Value(0))).current;
  // Still until the phone says reduce motion is off, so the dots never move for someone who asked them not to.
  const [still, setStill] = useState(true);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    const runner = {
      start() {
        const pulse = (value: Animated.Value) =>
          Animated.loop(
            Animated.sequence([
              Animated.timing(value, { toValue: 1, duration: CYCLE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
              Animated.timing(value, { toValue: 0, duration: CYCLE_MS / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ]),
          );
        animation = Animated.stagger(STAGGER_MS, progress.map(pulse));
        animation.start();
      },
      stop() {
        animation?.stop();
        animation = null;
        progress.forEach((value) => value.setValue(0));
      },
    };
    return runDots(motionPreference, runner, setStill);
  }, [progress]);

  const rest = stillLook();
  return (
    <View
      style={[styles.row, { gap: size }]}
      {...(announce
        ? { accessible: true, accessibilityRole: 'progressbar' as const, accessibilityLabel: label }
        : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
    >
      {progress.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
            still
              ? { opacity: rest.opacity, transform: [{ scale: rest.scale }] }
              : {
                  opacity: value.interpolate({ inputRange: [0, 1], outputRange: [DOT_MIN_OPACITY, DOT_MAX_OPACITY] }),
                  transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [DOT_MIN_SCALE, DOT_MAX_SCALE] }) }],
                },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});

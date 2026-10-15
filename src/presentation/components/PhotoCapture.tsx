import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/theme';
import { AppText } from './AppText';
import { Banner } from './Banner';
import { Button } from './Button';

interface PhotoCaptureProps {
  /** Called with the photo's location once the person chooses "Use this photo". */
  onDone: (uri: string) => void;
  onCancel: () => void;
}

/** Phone photos are 4:3. The preview box uses the same shape, so what you see is what is saved. */
const PREVIEW_ASPECT = 3 / 4;

interface Shot {
  uri: string;
  width: number;
  height: number;
}

/**
 * Full-screen camera for photographing a medicine bottle or label.
 *
 * - Asks for camera permission with a plain explanation, and says what to do if it is refused.
 * - The preview is the same 4:3 shape as the saved photo, with a frame to line the label up in.
 * - The button stays off until the camera says it is ready, so it never takes a blank picture.
 * - After the photo, the person reviews it, and can retake it before using it.
 */
export function PhotoCapture({ onDone, onCancel }: PhotoCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);

  // Size the box by its shape, never by squeezing its height, so the shape always stays 3:4.
  // Leaves room above and below for the Cancel link, the hint and the buttons.
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const boxWidth = Math.max(160, Math.min(screenWidth - spacing.lg * 2, 432, (screenHeight - 420) * PREVIEW_ASPECT));

  async function takePhoto() {
    if (!camera.current || !ready) return;
    setTaking(true);
    setFailed(false);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.7 });
      setShot({ uri: picture.uri, width: picture.width, height: picture.height });
    } catch {
      setFailed(true);
    } finally {
      setTaking(false);
    }
  }

  let body: React.ReactNode;

  if (!permission) {
    body = <AppText color={colors.white}>Checking camera…</AppText>;
  } else if (!permission.granted) {
    body = (
      <>
        <AppText variant="heading" color={colors.white} style={styles.gap}>
          Camera access
        </AppText>
        <AppText color={colors.white} style={styles.gap}>
          CareCircle uses the camera only to photograph a medicine, such as its bottle or label.
          Photos are not shared with anyone else.
        </AppText>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <>
            <Banner tone="info">
              The camera is turned off for CareCircle. Open Settings, choose CareCircle, and turn on
              Camera.
            </Banner>
            <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
          </>
        )}
      </>
    );
  } else if (shot) {
    body = (
      <>
        <Image
          accessibilityLabel="The photo you just took"
          source={{ uri: shot.uri }}
          // Keep the photo's own shape so nothing is cropped when reviewing it.
          style={[styles.preview, { width: boxWidth, aspectRatio: shot.width / shot.height }]}
          resizeMode="contain"
        />
        <AppText color={colors.white} style={styles.hint}>
          Can you read the label clearly?
        </AppText>
        <Button label="Use this photo" onPress={() => onDone(shot.uri)} />
        <View style={styles.spacer} />
        <Button
          label="Retake"
          variant="secondary"
          onPress={() => {
            setShot(null);
            setReady(false);
          }}
        />
      </>
    );
  } else {
    body = (
      <>
        <View style={[styles.preview, { width: boxWidth, aspectRatio: PREVIEW_ASPECT }]}>
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="back"
            ratio="4:3"
            onCameraReady={() => setReady(true)}
            accessibilityLabel="Camera view"
          />
          {/* The frame is only a guide to line the label up in. */}
          <View pointerEvents="none" style={styles.frame} />
        </View>
        <AppText color={colors.white} style={styles.hint} accessibilityLiveRegion="polite">
          {ready ? 'Fit the label inside the frame, then press the button.' : 'Getting the camera ready…'}
        </AppText>
        {failed ? <Banner tone="error">The photo could not be taken. Please try again.</Banner> : null}
        <Button label="Take photo" onPress={() => void takePhoto()} disabled={!ready} loading={taking} />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.column}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          hitSlop={8}
          style={styles.cancel}
        >
          <AppText variant="label" color={colors.white}>
            ‹ Cancel
          </AppText>
        </Pressable>
        {body}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink },
  column: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', padding: spacing.lg },
  cancel: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginBottom: spacing.sm },
  preview: {
    alignSelf: 'center',
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  frame: {
    position: 'absolute',
    top: '12%',
    bottom: '12%',
    left: '8%',
    right: '8%',
    borderWidth: 3,
    borderColor: colors.white,
    borderRadius: radius.field,
    borderStyle: 'dashed',
  },
  hint: { textAlign: 'center', marginVertical: spacing.md },
  gap: { marginBottom: spacing.md },
  spacer: { height: spacing.sm },
});

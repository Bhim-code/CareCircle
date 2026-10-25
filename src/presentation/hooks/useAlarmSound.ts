import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

const ALARM_SOUND = require('../../../assets/sounds/dose_alarm.wav');
const KEEP_AWAKE_TAG = 'carecircle-alarm';

/**
 * Plays the alarm sound in a loop, and keeps the screen on, while `ringSeconds`
 * is above zero. It stops when the time runs out, when `ringSeconds` becomes
 * zero (the dose was answered), or when the screen closes. The sound belongs to
 * this screen, not to the notification, so opening the notification panel
 * cannot silence it.
 */
export function useAlarmSound(ringSeconds: number, restartKey: string): void {
  const player = useAudioPlayer(ALARM_SOUND);

  useEffect(() => {
    if (ringSeconds <= 0) return;
    let stopped = false;

    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false })
      .catch(() => undefined)
      .then(() => {
        if (stopped) return;
        player.loop = true;
        player.volume = 1;
        player.seekTo(0).catch(() => undefined);
        player.play();
      });
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);

    const timer = setTimeout(() => {
      stopped = true;
      player.pause();
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }, ringSeconds * 1000);

    return () => {
      stopped = true;
      clearTimeout(timer);
      player.pause();
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
    // Restart only for a new alarm, or when the dose is answered (ringSeconds drops to 0),
    // never because the number of seconds left ticks down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartKey, ringSeconds > 0]);
}

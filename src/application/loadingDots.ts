/** The three pulsing dots shown while something loads. The numbers are in one place so the look is easy to change. */
export const DOT_COUNT = 3;
/** One dot goes up and back down in this many milliseconds. */
export const CYCLE_MS = 1200;
/** Each dot starts this long after the one before it. */
export const STAGGER_MS = 200;
export const DOT_MIN_OPACITY = 0.3;
export const DOT_MAX_OPACITY = 1;
export const DOT_MIN_SCALE = 0.8;
export const DOT_MAX_SCALE = 1.1;
/** With "reduce motion" on, the dots do not move and look like this. */
export const STILL_OPACITY = 0.7;
export const STILL_SCALE = 1;
/** The CareCircle logo's dark green. */
export const DOT_COLOR = '#2E6A5C';
/** What a screen reader says while loading. */
export const LOADING_LABEL = 'Loading';

/** The logo image is 900 wide and 121 tall. */
export const LOGO_ASPECT = 900 / 121;
/** The logo takes this share of the screen width, and never more than the maximum (in points). */
export const LOGO_WIDTH_SHARE = 0.65;
export const LOGO_MAX_WIDTH = 280;
/** The space between the logo and the dots, in points. */
export const LOGO_TO_DOTS_GAP = 26;

/** How wide the logo is on a screen of this width. */
export function logoWidth(screenWidth: number): number {
  return Math.min(screenWidth * LOGO_WIDTH_SHARE, LOGO_MAX_WIDTH);
}

/** How the dots look when they do not animate (reduce motion is on). */
export function stillLook(): { opacity: number; scale: number } {
  return { opacity: STILL_OPACITY, scale: STILL_SCALE };
}

/** How the phone says "reduce motion" is switched on or off. */
export interface MotionPreference {
  isReduceMotionEnabled(): Promise<boolean>;
  /** Calls the listener whenever the setting changes. Returns a function that stops listening. */
  onChange(listener: (reduceMotion: boolean) => void): () => void;
}

/** Starts and stops the animation of the dots. */
export interface DotsRunner {
  start(): void;
  stop(): void;
}

/**
 * Decides whether the dots move. They stay still until the phone has said "reduce motion" is
 * off, move when it is off, and go still again if it is switched on while they are showing.
 * `onStill` is told whether the dots should be still. Returns a function that stops everything
 * (call it when the screen goes away); nothing starts after that.
 */
export function runDots(
  motion: MotionPreference,
  runner: DotsRunner,
  onStill: (still: boolean) => void,
): () => void {
  let disposed = false;
  let running = false;

  const apply = (reduceMotion: boolean) => {
    if (disposed) return;
    onStill(reduceMotion);
    if (reduceMotion && running) {
      running = false;
      runner.stop();
    } else if (!reduceMotion && !running) {
      running = true;
      runner.start();
    }
  };

  // If the phone cannot say, stay still: that is the safe choice for anyone who asked for less motion.
  motion.isReduceMotionEnabled().then(apply, () => apply(true));
  const stopListening = motion.onChange(apply);

  return () => {
    disposed = true;
    stopListening();
    if (running) {
      running = false;
      runner.stop();
    }
  };
}

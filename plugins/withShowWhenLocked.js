// Lets the alarm screen appear over the lock screen and switch the screen on,
// so a ringing alarm is seen without unlocking the phone. Android only.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withShowWhenLocked(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];
    const main = activities.find((item) => item.$['android:name'] === '.MainActivity') ?? activities[0];
    if (!main) throw new Error('[withShowWhenLocked] MainActivity not found in AndroidManifest.xml');
    main.$['android:showWhenLocked'] = 'true';
    main.$['android:turnScreenOn'] = 'true';
    return mod;
  });
};

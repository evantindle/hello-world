import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native iOS and Android apps (Capacitor): the same web build in `dist/`, inside a native
 * shell. `npm run cap:sync` copies a fresh build into `ios/` and `android/`. See docs/mobile.md.
 *
 * The app id is permanent once the app is in a store: change it here (and run `npx cap sync`)
 * before the first upload if you want a different one.
 */
const config: CapacitorConfig = {
  appId: 'com.evantindle.bendybilliards',
  appName: 'Bendy Billiards',
  webDir: 'dist',
  backgroundColor: '#2b1850',
  ios: {
    // The game draws under the notch and home bar itself (it reads the safe-area insets).
    contentInset: 'never',
    backgroundColor: '#2b1850',
  },
  android: {
    backgroundColor: '#2b1850',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#2b1850',
      showSpinner: false,
    },
  },
};

export default config;

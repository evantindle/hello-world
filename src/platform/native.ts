import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar } from '@capacitor/status-bar';
import { platform, type NativeApp } from './platform';

/**
 * The native apps' extras (loaded only inside them, see platform.ts): real haptics, the system
 * share sheet, a full-screen table, the Android back button, and a backup of the save that the
 * operating system cannot clear.
 */

/** Everything the game keeps in localStorage starts with this. */
const PREFIX = 'bendy-billiards.';

/**
 * The web view's localStorage is the save, but iOS may clear it when the phone runs out of space.
 * So the app copies it to native storage whenever it goes to the background, and copies it back
 * on launch if it has gone missing.
 */
async function restoreSave(): Promise<void> {
  try {
    const { keys } = await Preferences.keys();
    for (const key of keys) {
      if (!key.startsWith(PREFIX) || localStorage.getItem(key) !== null) continue;
      const { value } = await Preferences.get({ key });
      if (value !== null) localStorage.setItem(key, value);
    }
  } catch {
    // No backup to restore.
  }
}

async function backupSave(): Promise<void> {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) await Preferences.set({ key, value });
    }
  } catch {
    // Try again next time.
  }
}

/** Runs before the game reads its save. */
export async function startNative(app: NativeApp): Promise<void> {
  await restoreSave();

  platform.tick = () => void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  platform.share = async (d) => {
    try {
      await Share.share({ title: d.title, text: d.text, url: d.url, dialogTitle: 'Share this shot' });
    } catch {
      // Closing the sheet counts as done; it rejects with "Share canceled".
    }
    return true;
  };

  // The table fills the screen; the HUD already keeps clear of notches and home bars.
  void StatusBar.hide().catch(() => {});

  void App.addListener('pause', () => void backupSave());
  if (Capacitor.getPlatform() === 'android') {
    void App.addListener('backButton', () => {
      if (!app.back()) void App.exitApp();
    });
  }
  // The splash hides on its own; this is a backstop in case a slow first load outlasts it.
  requestAnimationFrame(() => void SplashScreen.hide().catch(() => {}));
}

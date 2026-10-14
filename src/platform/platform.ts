/**
 * What differs between the web page and the native apps (Capacitor, see docs/mobile.md). The web
 * build never loads the native plugins: `native.ts` is a separate chunk, fetched only inside the
 * apps, and it swaps in the native versions of the hooks below.
 */

/** Running inside the iOS or Android app (Capacitor injects this before the page loads). */
export function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/**
 * Where share links point. On the web, this page. In the apps the page lives at
 * capacitor://localhost or https://localhost, which nobody else can open, so links go to the
 * hosted copy instead (set VITE_PUBLIC_URL when building the apps to change it).
 */
export function linkBase(): { origin: string; pathname: string } {
  if (!isNative()) return location;
  const url = new URL(import.meta.env.VITE_PUBLIC_URL || 'https://evantindle.github.io/hello-world/');
  return { origin: url.origin, pathname: url.pathname };
}

/** Swappable platform hooks; `native.ts` replaces them in the apps. */
export const platform = {
  /** A tiny tick under the finger (the power dial's notches). The web only has it on Android. */
  tick(): void {
    try {
      navigator.vibrate?.(8);
    } catch {
      // Not allowed here.
    }
  },
  /** The system share sheet: true if it was shown (or the player closed it), false if there is none. */
  share: null as null | ((d: { title: string; text: string; url: string }) => Promise<boolean>),
};

/** In the apps: plug in the native hooks. Resolves at once on the web. */
export async function startPlatform(app: NativeApp): Promise<void> {
  if (!isNative()) return;
  const { startNative } = await import('./native');
  await startNative(app);
}

/** What the native side needs from the game. */
export interface NativeApp {
  /** The Android back button: undo one level of the UI; false when there is nothing left to leave. */
  back(): boolean;
}

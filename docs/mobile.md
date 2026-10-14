# The iOS and Android apps

Bendy Billiards ships to phones as a native app built with [Capacitor](https://capacitorjs.com).
The exact same web build (`dist/`) runs inside a native shell, so the game, its physics and its
saves are identical on the web, iPhone and Android. This page covers what is already set up, then
every step from here to both stores.

## What is already done

| Piece                       | Where                                                    |
| --------------------------- | -------------------------------------------------------- |
| Capacitor config            | `capacitor.config.ts` (app id, name, colours, splash)    |
| Xcode project (iOS 15+)     | `ios/App/App.xcodeproj` (Swift Package Manager, no pods) |
| Android Studio project      | `android/` (Android 7+, targets API 36)                  |
| App icon and splash screens | `assets/*.svg`, generated into both projects             |
| Native extras               | `src/platform/` (see below)                              |
| CI build of both apps       | `.github/workflows/mobile.yml`                           |
| Privacy policy page         | `public/privacy.html` (served by GitHub Pages)           |
| Store text and images       | `store/` (listing copy, screenshots, feature graphic)    |

The native extras only load inside the apps, so the web build is unchanged:

- **Haptics:** a light tick for every 5% notch on the power dial (iPhones included).
- **Sharing:** **SHARE** opens the system share sheet. Inside the app, links point at the hosted
  game (`https://evantindle.github.io/hello-world/`), since the app's own pages can't be opened by
  anyone else. Build with `VITE_PUBLIC_URL=https://...` to point them somewhere else.
- **Full screen:** the status bar is hidden; the HUD already keeps clear of notches.
- **Android back button:** one step at a time. It closes a box, stops a replay, cancels a windup,
  leaves the game, then the level card and the level select. On the home screen, it closes the app.
- **Save backup:** iOS can clear a web view's storage when the phone runs out of space. The app
  copies the save into native storage whenever it goes to the background, and restores it on
  launch if it has gone missing.
- **Quiet in the background:** sound pauses while the app (or the browser tab) is hidden.

## Commands

```bash
npm run cap:sync      # build the web game and copy it into ios/ and android/
npm run cap:ios       # ...then open Xcode
npm run cap:android   # ...then open Android Studio
npm run assets        # redraw the icon, splash and store graphics from assets/*.svg
npm run store-shots   # retake the store screenshots (after npm run build)
```

Run `npm run cap:sync` after every change to the game before building an app. Xcode and Android
Studio only see what was last synced.

## Step 0: accounts and machines

| You need                                                                       | Cost       | For                                                                                              |
| ------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| A Mac with [Xcode](https://apps.apple.com/app/xcode/id497799835) (latest)      | -          | Building and uploading the iOS app (there is no way around a Mac, except CI with signing, below) |
| [Apple Developer Program](https://developer.apple.com/programs/enroll/)        | $99 / year | TestFlight and the App Store. Enrolment can take a day or two                                    |
| [Android Studio](https://developer.android.com/studio) (Mac, Windows or Linux) | -          | Building and signing the Android app                                                             |
| [Google Play Console](https://play.google.com/console/signup)                  | $25 once   | Google Play. Identity verification can take a few days                                           |

Start both enrolments early: they are the slowest part.

## Step 1: decide the permanent things

- **App id:** `com.evantindle.bendybilliards`. It can never change once the app is in a store.
  To use a different one, change `appId` in `capacitor.config.ts`, the bundle identifier in Xcode
  (target **App → General**) and `applicationId` / `namespace` in `android/app/build.gradle` (and
  move `MainActivity.java` to the matching package folder) before the first upload.
- **Name on the home screen:** "Bendy Billiards" (`appName`, iOS `CFBundleDisplayName`,
  Android `res/values/strings.xml`).
- **iPad:** the iOS app runs on iPad too, so the App Store will want iPad screenshots. To make it
  iPhone-only, set **Supported Destinations** to iPhone only in Xcode.

## Step 2: try it today

**Android, no tools needed.** Every push runs the **Mobile** workflow. Open the run on GitHub
(**Actions → Mobile**), download the `bendy-billiards-debug-apk` artifact, unzip it, copy the
`.apk` to an Android phone and open it (allow "install unknown apps" when asked).

**iPhone simulator, on a Mac:**

```bash
npm ci
npm run cap:ios
```

In Xcode, pick an iPhone simulator at the top and press ▶︎.

## Step 3: run it on your own phones

**iPhone:**

1. Plug the phone in. On the phone, turn on **Settings → Privacy & Security → Developer Mode**.
2. In Xcode: **Settings → Accounts → +**, and sign in with your Apple ID (a free account works for
   your own phone; apps signed that way expire after 7 days).
3. Target **App → Signing & Capabilities**: tick **Automatically manage signing** and pick your
   team.
4. Choose your phone at the top and press ▶︎. The first time, trust the developer on the phone
   under **Settings → General → VPN & Device Management**.

**Android:**

1. On the phone: **Settings → About phone**, tap **Build number** seven times, then turn on
   **Developer options → USB debugging**.
2. `npm run cap:android`, wait for Gradle to sync, pick the phone at the top and press ▶︎.

Play a few full games on each. Check the dial notches buzz, SHARE opens the share sheet, the back
button behaves (Android), and stars survive closing and reopening the app.

## Step 4: turn on GitHub Pages (for share links and the privacy page)

Shared links from the app open `https://evantindle.github.io/hello-world/#s=...`, and both stores
ask for a privacy policy URL. Both need the hosted copy:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Merge to `master` (the Pages workflow deploys it).
3. Check `https://evantindle.github.io/hello-world/` and
   `https://evantindle.github.io/hello-world/privacy.html` load.

## Step 5: version numbers

Each upload to a store needs a higher build number.

| Platform | Shown to players                            | Must go up every upload               |
| -------- | ------------------------------------------- | ------------------------------------- |
| iOS      | **Version** (Xcode, target **General**)     | **Build** (same screen)               |
| Android  | `versionName` in `android/app/build.gradle` | `versionCode` (same file, an integer) |

Start at 1.0 / 1 on both.

## Step 6: iOS release (TestFlight, then the App Store)

1. **Create the app record.** In [App Store Connect](https://appstoreconnect.apple.com): **Apps →
   - → New App**. Platform iOS, name "Bendy Billiards", bundle id `com.evantindle.bendybilliards`
     (register it first under **Certificates, Identifiers & Profiles → Identifiers** if it isn't in
     the list), SKU anything (e.g. `bendy-billiards`).
2. **Archive.** `npm run cap:ios`. In Xcode, choose **Any iOS Device (arm64)** at the top, then
   **Product → Archive**. When the Organizer opens: **Distribute App → App Store Connect →
   Upload**. Automatic signing creates the certificates for you.
3. **TestFlight.** After processing (10 to 30 minutes), the build appears under **TestFlight**.
   Add yourself and friends as internal testers and install it with the TestFlight app. The
   "export compliance" question is already answered in `Info.plist` (no custom encryption).
4. **The listing** (App Store tab):
   - subtitle, promotional text, description, keywords, support URL: all drafted in
     [store/listing.md](../store/listing.md)
   - category: **Games → Puzzle** (secondary: **Casual**)
   - screenshots: `store/screenshots/ios-iphone-6.9/` (6.9" iPhone) and
     `store/screenshots/ios-ipad-13/` (13" iPad, if iPad stays on). Shots of the real app from
     the simulator (**File → Save Screen**, ⌘S) work too.
   - **App Privacy:** privacy policy URL `https://evantindle.github.io/hello-world/privacy.html`,
     then **Data Not Collected**
   - **Age rating:** answer "none" throughout; it should come out as 4+
   - price: Free (or set one under **Pricing and Availability**)
5. **Submit for review.** Pick the build, then **Add for Review → Submit**. Review usually takes a
   day or two.
   Apple rejects apps that are "just a website", but this one runs fully offline, with native
   haptics and sharing. If a reviewer pushes back, say so in the reply.

## Step 7: Android release (Google Play)

1. **Create the app.** In the [Play Console](https://play.google.com/console): **Create app**.
   Name "Bendy Billiards", Game, Free.
2. **Make an upload key.** In Android Studio: **Build → Generate Signed App Bundle or APK →
   Android App Bundle → Create new...** to make a keystore. **Back it up, with its passwords,
   somewhere safe outside the repo** (never commit it). Google signs the real app with its own key
   (Play App Signing); yours only proves uploads come from you, and can be reset through support if
   lost.
3. **Build the bundle.** `npm run cap:android`, then **Build → Generate Signed App Bundle**,
   choose **release**. The `.aab` lands in `android/app/release/`.
4. **Fill in App content** (Policy → App content): privacy policy URL, **Ads: no**, **Data safety:
   no data collected or shared**, content rating questionnaire (expect Everyone / PEGI 3), target
   audience (pick 13+ unless you want the stricter Families rules), not a news app.
5. **The store listing:** the short and full descriptions from
   [store/listing.md](../store/listing.md), `store/icon-512.png`, `store/feature-graphic.png`, and
   the phone screenshots in `store/screenshots/android-phone/`.
6. **Testing first.** Upload the `.aab` to **Testing → Internal testing** and install it from the
   Play Store on your phone. New personal developer accounts must also run a **closed test with at
   least 12 testers for 14 days** before they can publish to production (check the current rule in
   the Console's dashboard; it lists exactly what is left).
7. **Production.** **Production → Create new release**, upload the `.aab` (or promote the tested
   one), roll out. The first review can take a few days.

## Later (optional)

- **Open shared links in the app.** Today a shared link opens the web game, even on a phone with
  the app installed. Universal Links (iOS) and App Links (Android) can send them to the app:
  - host `.well-known/apple-app-site-association` and `.well-known/assetlinks.json` at the root
    of the links' domain: a custom domain, or a `evantindle.github.io` user-site repository
    (a project page like `/hello-world/` can't serve the root)
  - add the Associated Domains capability (iOS) and an intent filter (Android)
  - handle `App.addListener('appUrlOpen', ...)` by passing the `#s=` code to the viewer
- **Build and upload from CI.** Store the Android keystore and an App Store Connect API key as
  GitHub secrets. Then a workflow (or [fastlane](https://fastlane.tools)) can build signed
  releases and upload to TestFlight and the Play internal track on every tag, with no Mac needed
  for day-to-day releases.
- **Game Center / Play Games** leaderboards for best Free Play scores, or achievements for stars.
- **Pass-and-play multiplayer** (see [multiplayer.md](multiplayer.md)) fits phones especially well.

## Troubleshooting

- **The app shows an old version of the game:** run `npm run cap:sync` again, then rebuild.
- **Xcode can't resolve packages:** **File → Packages → Reset Package Caches**. The iOS project
  pulls the plugins from `node_modules`, so run `npm ci` first.
- **Gradle complains about Java:** Android Studio's bundled JDK (21) works. On the command line,
  point `JAVA_HOME` at a JDK 21.
- **The icon or splash didn't change:** delete the app from the phone and install it again;
  launchers cache icons.

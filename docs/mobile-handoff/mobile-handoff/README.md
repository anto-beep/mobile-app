# Wayly Mobile Capacitor App — Brand & Asset Handoff

This folder contains every asset you need to refresh the mobile Capacitor app (iOS + Android) so it matches the new web brand: teal-ink + clay + sage on warm off-white, with Fraunces serif headings and Inter body.

## What's in this folder

```
mobile-handoff/
├── branding/          # SVG logo variants (use these in marketing tiles, splash, etc.)
├── icons/
│   ├── ios/           # 15 PNG sizes — drag into Assets.xcassets → AppIcon
│   └── android/       # 11 PNG sizes — copy into android/app/src/main/res/mipmap-*
└── fonts/             # 3 TTF files (Fraunces + Inter variable + IBM Plex Mono Regular)
```

Total bundle weight: ~800 KB (fonts) + ~250 KB (icons) = under 1.1 MB. Negligible for a mobile app.

---

## 1. App icons

### iOS — drag-and-drop in Xcode

1. Open the iOS project: `ios/App/App.xcworkspace`
2. In the Project Navigator, click **Assets.xcassets → AppIcon**.
3. Delete the existing slots' images.
4. Drag the matching PNG from `icons/ios/` into each slot:
   - `Icon-20.png` → 20pt 1x
   - `Icon-20@2x.png` → 20pt 2x
   - `Icon-20@3x.png` → 20pt 3x
   - `Icon-29.png`, `Icon-29@2x.png`, `Icon-29@3x.png` → 29pt slots
   - `Icon-40.png`, `Icon-40@2x.png`, `Icon-40@3x.png` → 40pt slots
   - `Icon-60@2x.png`, `Icon-60@3x.png` → 60pt slots
   - `Icon-76.png`, `Icon-76@2x.png` → 76pt slots (iPad)
   - `Icon-83.5@2x.png` → 83.5pt slot (iPad Pro)
   - `Icon-1024.png` → 1024×1024 slot (App Store)
5. Clean build folder (`⌘+Shift+K`) and run.

### Android — copy into resource buckets

```bash
cd android/app/src/main/res

# Replace ic_launcher and ic_launcher_round in each density bucket
cp /path/to/mobile-handoff/icons/android/ic_launcher_mdpi.png    mipmap-mdpi/ic_launcher.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_round_mdpi.png mipmap-mdpi/ic_launcher_round.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_hdpi.png    mipmap-hdpi/ic_launcher.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_round_hdpi.png mipmap-hdpi/ic_launcher_round.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_xhdpi.png   mipmap-xhdpi/ic_launcher.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_round_xhdpi.png mipmap-xhdpi/ic_launcher_round.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_xxhdpi.png  mipmap-xxhdpi/ic_launcher.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_round_xxhdpi.png mipmap-xxhdpi/ic_launcher_round.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_xxxhdpi.png mipmap-xxxhdpi/ic_launcher.png
cp /path/to/mobile-handoff/icons/android/ic_launcher_round_xxxhdpi.png mipmap-xxxhdpi/ic_launcher_round.png
```

For the **Play Store listing**, upload `icons/android/play_store_512.png` to the Console → Store presence → Main store listing → App icon.

### Optional — `@capacitor/assets` automated regeneration

If you'd rather automate, install `@capacitor/assets` and drop a high-res master:

```bash
# In the mobile repo root
yarn add -D @capacitor/assets
# Create the master at ./assets/icon.png (1024x1024) — copy /icons/ios/Icon-1024.png there
mkdir -p assets && cp /path/to/mobile-handoff/icons/ios/Icon-1024.png assets/icon.png
# Add a splash too — use icons/android/play_store_512.png scaled up, OR commission
# Then generate
npx capacitor-assets generate
```

---

## 2. Fonts — bundling vs CDN

The web app currently CDN-fetches fonts on every visit. For the mobile app you have two options:

### Option A — Bundle fonts (recommended; works offline, no FOIT on first launch)

Total weight: ~800 KB. Same as one screenshot. Worth it.

#### iOS

1. Drag all three TTF files from `fonts/` into the Xcode project (e.g., a `Resources/Fonts/` group). Tick **Copy items if needed** + add to the **App** target.
2. Open `Info.plist` and add (or merge into) this key:

```xml
<key>UIAppFonts</key>
<array>
    <string>Fraunces-Variable.ttf</string>
    <string>Inter-VariableFont.ttf</string>
    <string>IBMPlexMono-Regular.ttf</string>
</array>
```

3. The fonts are now available under the same family names CSS uses (`Fraunces`, `Inter`, `IBM Plex Mono`). The webview will resolve them locally before falling back to the system stack.

#### Android

1. Create the folder if needed: `android/app/src/main/assets/fonts/`
2. Copy:

```bash
cp /path/to/mobile-handoff/fonts/Fraunces-Variable.ttf       android/app/src/main/assets/fonts/
cp /path/to/mobile-handoff/fonts/Inter-VariableFont.ttf      android/app/src/main/assets/fonts/
cp /path/to/mobile-handoff/fonts/IBMPlexMono-Regular.ttf     android/app/src/main/assets/fonts/
```

3. In the React app's `index.css` (or a mobile-only override CSS), add an `@font-face` block that points at the bundled paths instead of the Google CDN:

```css
@font-face {
    font-family: 'Fraunces';
    src: url('/android_asset/fonts/Fraunces-Variable.ttf') format('truetype-variations'),
         local('Fraunces');
    font-weight: 100 900;
    font-display: block;
}
@font-face {
    font-family: 'Inter';
    src: url('/android_asset/fonts/Inter-VariableFont.ttf') format('truetype-variations'),
         local('Inter');
    font-weight: 100 900;
    font-display: block;
}
@font-face {
    font-family: 'IBM Plex Mono';
    src: url('/android_asset/fonts/IBMPlexMono-Regular.ttf') format('truetype'),
         local('IBM Plex Mono');
    font-weight: 400;
    font-display: block;
}
```

The Capacitor Android webview maps `/android_asset/` to the `assets/` folder. For iOS the system font lookup picks up the registered UIAppFonts automatically by family name, so the existing CSS `font-family: Fraunces` resolves without needing a path.

### Option B — Keep CDN-only

Already working today via the `@import url('https://fonts.googleapis.com/...')` in `frontend/src/index.css`. Pros: no bundle weight. Cons:
- First launch on a slow / no connection → fonts FOIT to system serif/sans for a few seconds
- App Store reviewer running in airplane mode may flag the look as inconsistent

Recommend bundling — the 800 KB is trivial vs the UX benefit.

---

## 3. Splash screen

The Capacitor default splash is the icon. To get a Wayly-branded splash:

1. Use `branding/wayly-lockup-navy.svg` (teal-ink tile + Fraunces "Wayly" wordmark + clay accent dot) — render it onto a 2732×2732 PNG centred on warm off-white `#FBF8F3`.

```bash
# Generate a 2732x2732 splash from the lockup SVG
python3 -c "
import cairosvg
cairosvg.svg2png(
    url='/path/to/mobile-handoff/branding/wayly-lockup-navy.svg',
    write_to='/tmp/wayly-splash-2732.png',
    output_width=2732, output_height=2732,
    background_color='#FBF8F3',
)"
```

2. Drop the result at `assets/splash.png` in the mobile repo root and run `npx capacitor-assets generate` — this produces every required splash variant for iOS + Android.

---

## 4. Status bar / theme colour

Capacitor reads the bar colour from `capacitor.config.ts`:

```ts
const config: CapacitorConfig = {
    // ...
    plugins: {
        SplashScreen: {
            backgroundColor: "#FBF8F3",      // warm off-white
            launchAutoHide: false,
            launchShowDuration: 1200,
        },
        StatusBar: {
            backgroundColor: "#0E4D52",      // teal-ink primary (was #0E2A47 navy)
            style: "LIGHT",                  // white text on dark bar
        },
    },
};
```

Run `npx cap sync` after editing.

---

## 5. The new web `<meta name="theme-color">` is already `#0E4D52`

Verified in `/app/frontend/public/index.html` — the value the Android Chrome address bar reads will pick up the teal-ink colour automatically once the next build is bundled.

---

## 6. Post-deploy verification checklist

- [ ] Cold launch the iOS app on a real device → first-render is the Wayly splash, not the white default
- [ ] Cold launch in airplane mode → headings render in Fraunces (not system serif fallback)
- [ ] Home screen icon is the new continuous-stroke W with clay accent dot
- [ ] Status bar is teal-ink (light text)
- [ ] All numbers (budgets / dollar amounts) render in IBM Plex Mono with tabular figures
- [ ] App Store / Play Store screenshots refreshed with the new palette

---

## File inventory

- `branding/wayly-mark.svg` — primary mark on warm tile
- `branding/wayly-mark-light.svg` — primary mark on teal tile
- `branding/wayly-mark-mono-navy.svg` — single-colour teal mark on white
- `branding/wayly-mark-mono-white.svg` — single-colour white mark on transparent (for use on dark photography)
- `branding/wayly-lockup-navy.svg` — teal tile + mark + Fraunces "Wayly" wordmark (for splash, headers)
- `branding/wayly-lockup-white.svg` — warm tile variant
- `icons/ios/Icon-*.png` (15 sizes) — drag into Xcode AppIcon
- `icons/android/ic_launcher_*.png` (10 sizes) + `play_store_512.png`
- `fonts/Fraunces-Variable.ttf` (352 KB)
- `fonts/Inter-VariableFont.ttf` (300 KB)
- `fonts/IBMPlexMono-Regular.ttf` (130 KB)

License notes:
- Fraunces — SIL Open Font License 1.1 (free for commercial use, may bundle)
- Inter — SIL Open Font License 1.1
- IBM Plex Mono — SIL Open Font License 1.1
- Icons + logos — original artwork commissioned for Wayly, all rights reserved

---

## Anything I missed?

If the mobile repo has its own brand tokens (e.g. a `theme.ts` with Tailwind colours, a `colors.ts`, native splash JSON) drop me their content and I'll diff them against the web tokens to give you a final swap script.

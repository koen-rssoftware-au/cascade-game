# Cascade — Store Release Runbook

Status na de geautomatiseerde voorbereiding (2026-06-10): de app is technisch store-klaar.
Wat overblijft zijn de stappen die accounts, betalingen of een fysiek apparaat vereisen —
die staan hieronder per platform, in volgorde.

## Wat al klaar is ✅

- **Capacitor 8-wrap** (`au.com.rssoftware.cascade`, versie 1.1.0 / versionCode 2):
  `android/` (Gradle-project) en `ios/` (Xcode-project, Swift Package Manager — geen CocoaPods nodig)
- **Native integratie:** durable storage (Preferences, gehydrateerd vóór boot — kill-proof
  op device), echte haptics op iPhone (Taptic) én Android, statusbalk in thema, splash
  screen, Android-terugknop (in-game → pauze, home → minimize), portrait-lock op beide
  platforms, geen service worker in de native shell
- **Alle iconen en splash screens** gegenereerd (74 Android-assets, 7 iOS-assets) uit
  `assets/` bronbestanden
- **Debug-APK**: `android/app/build/outputs/apk/debug/app-debug.apk` (5,0 MB) — direct te
  sideloaden om op je Android te testen
- **iOS-project** compileert voor de simulator (validatie); device-build vereist signing (zie onder)
- **Store-assets** in `store/`: screenshots (App Store 6,7"/6,5" exact formaat + Play),
  feature graphic 1024×500, listing-teksten EN+NL met geverifieerde tekenlimieten,
  Data Safety/privacylabel-antwoorden, privacy policy
- **Privacy policy live:** https://koen-rssoftware-au.github.io/cascade-game/privacy-policy.html
- De webversie (PWA) blijft identiek werken — zelfde codebase, zelfde build

## Lokaal testen op je telefoon

- **Android:** zet "onbekende bronnen" aan en installeer `app-debug.apk` (stuur hem naar
  jezelf of `adb install`). Of open `android/` in Android Studio → Run op je toestel.
- **iPhone:** open `ios/App/App.xcodeproj` in Xcode → kies je iPhone als target → Run.
  Met een gratis Apple ID kan dat al (app verloopt dan na 7 dagen); voor TestFlight/App
  Store heb je het betaalde programma nodig.

## Google Play (Android) — stappen voor jou

1. **Account:** [Play Console](https://play.google.com/console), $25 eenmalig. Let op: een
   nieuw persoonlijk account moet eerst een gesloten test draaien (12 testers, 14 dagen)
   vóór productie-release — plan dat in.
2. **Signing key:** genereer een upload-keystore (eenmalig, BEWAAR HEM GOED — kwijt = nooit
   meer updaten onder dezelfde listing zonder Play App Signing reset):
   ```bash
   keytool -genkey -v -keystore ~/cascade-upload.keystore -alias cascade \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   (gebruik de JDK van Android Studio: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`)
3. **Release-AAB bouwen:** maak `android/keystore.properties` (niet committen!) en koppel
   hem in `android/app/build.gradle` (signingConfigs), of simpeler: open het project in
   Android Studio → Build → Generate Signed App Bundle. Output: `app-release.aab`.
4. **Console invullen:** nieuwe app → listing uit `store/listing-en.md`/`listing-nl.md` →
   screenshots uit `store/screenshots/play-*` + `store/feature-graphic-1024x500.png` →
   Data Safety exact volgens `store/play-data-safety.md` → content rating (IARC)
   vragenlijst → privacy policy URL (hierboven). Geen ads-declaratie: v1 bevat géén ad-SDK.
5. Upload AAB → gesloten test → productie.

## Apple App Store (iOS) — stappen voor jou

1. **Account:** [Apple Developer Program](https://developer.apple.com/programs/), $99/jaar.
2. **Xcode:** open `ios/App/App.xcodeproj` → target App → Signing & Capabilities → vink
   "Automatically manage signing" aan en kies je team. Bundle-id `au.com.rssoftware.cascade`
   wordt dan automatisch geregistreerd.
3. **Archive:** Product → Archive → Distribute → App Store Connect. Eerst naar TestFlight
   (test op je eigen iPhone), dan submitten.
4. **App Store Connect:** listing uit `store/listing-en.md` (naam/subtitle/keywords/promo
   zijn al binnen de limieten) → screenshots uit `store/screenshots/apple-67-*` en
   `apple-65-*` → privacylabel: "Data Not Collected" (zie `store/play-data-safety.md`) →
   leeftijd 4+ → privacy policy URL.
5. **Reviewrisico (eerlijk):** Apple-richtlijn 4.2 (minimum functionality) is streng voor
   web-wrappers. Verdediging: volledig offline, native haptics, geen "website in een
   app"-gedrag. Noem de webversie nergens in de listing. Afwijzing is desondanks mogelijk;
   het sterkste tegenargument is gameplay-diepte (daily challenge, cascades, undo/rotatie).

## v1.1 monetization (wanneer je er klaar voor bent)

De architectuur staat er al (§9 van de spec): vervang `MockAdProvider` door een
AdMob-implementatie (bijv. `@capacitor-community/admob`) en `MockPurchases` door
StoreKit/Play Billing (bijv. RevenueCat) — beide achter de bestaande interfaces in
`src/monetization/`, zonder game-code aan te raken. Daarna: ads-declaratie in beide
consoles bijwerken én de privacy policy (er staat al een voorbereidende zin in).

## Onthoud

- `npx cap sync` na elke `npm run build` (kopieert web-assets naar beide native projecten)
- Versie bumpen op 3 plekken: `package.json`, `android/app/build.gradle`
  (versionCode +1 verplicht per Play-upload), Xcode target (Marketing Version/Build)

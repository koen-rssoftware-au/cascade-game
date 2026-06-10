# Cascade — Release checklist DRAFT (account/console side only)

Scope: developer accounts, store listings, declarations and review preparation.
No build/code steps here. Applies to v1: offline, no real ads, no IAP.

---

## 0. Shared prerequisites

- [ ] Privacy policy live at
      https://koen-rssoftware-au.github.io/cascade-game/privacy-policy.html
      (both stores require a working privacy policy URL at submission)
- [ ] Decide publisher identity: individual vs organization "R&S Software".
      Organization enrollment requires a **D-U-N-S number** on BOTH stores
      (free via Dun & Bradstreet, but can take 1–2 weeks) — start early
- [ ] Support contact: koen@rssoftware.com.au · support URL (rssoftware.com.au)
- [ ] Icon masters: 1024×1024 PNG (Apple), 512×512 32-bit PNG (Play)
- [ ] Listing copy ready: store/listing-en.md + store/listing-nl.md
- [ ] Declarations ready: store/play-data-safety.md

## 1. Google Play Console

Account
- [ ] Create developer account — **US$25 one-time** registration fee
- [ ] Identity verification (ID document + payment profile) — allow several days
- [ ] NEW personal accounts: production access currently requires a **closed
      test with ≥12 testers opted in for 14 continuous days** before you may
      publish to production — plan this lead time (organization accounts are
      exempt; verify the current rule in the Console)

Store listing
- [ ] App name (≤30), short description (≤80), full description (≤4000) —
      English default + add an nl-NL localized listing
- [ ] **Screenshots: minimum 2 phone screenshots**, aspect ratio between
      **16:9 and 9:16**, each side **320–3840 px** (PNG/JPEG)
- [ ] **Feature graphic 1024×500** (required)
- [ ] App icon 512×512

Declarations
- [ ] Privacy policy URL
- [ ] Data safety form → "collects nothing / shares nothing"
      (exact answers: store/play-data-safety.md §1)
- [ ] Content rating (IARC) questionnaire → expected Everyone / PEGI 3
- [ ] Ads declaration: **No**
- [ ] Target audience: 13+ (general audience; avoids Families-policy track)
- [ ] App access: all functionality available without login

Technical/console
- [ ] Upload **AAB** (Android App Bundle — APKs not accepted for new apps);
      enroll in Play App Signing (default)
- [ ] **Target API level requirement:** Google rejects new apps/updates that
      target an old Android API level (as of 2025: API 35 / Android 15 for new
      submissions — **verify the current requirement in the Console** before
      building the Capacitor project)
- [ ] Countries/regions + price **Free** (note: Free → Paid can never be
      changed later for the same app)

## 2. App Store Connect (Apple)

Account
- [ ] Apple Developer Program — **US$99 per year** (recurring)
- [ ] Organization enrollment needs D-U-N-S + entity verification; enrolling as
      an individual is faster but publishes under a personal name

Store listing
- [ ] App name (≤30), subtitle (≤30), promotional text (≤170),
      description (≤4000), keywords (≤100) — see store/listing-en.md,
      plus nl-NL localization from store/listing-nl.md
- [ ] **Screenshots:** 6.7" display **1290×2796** (required) and 6.5" display
      **1284×2778 or 1242×2688**; **max 10 per device size** (the 6.7" set can
      be reused for smaller sizes if no dedicated sets are uploaded)
- [ ] App Privacy: **Data Not Collected** (store/play-data-safety.md §2)
- [ ] Age rating questionnaire → expected **4+**
- [ ] Privacy policy URL + support URL
- [ ] Export compliance: only standard HTTPS/platform encryption → exempt; set
      `ITSAppUsesNonExemptEncryption = false` in the build to skip the
      per-upload question

## 3. Review-guideline gotchas (HTML5-wrapper / Capacitor game)

Apple — Guideline 4.2 "Minimum Functionality" (the big one)
- Apple rejects apps that feel like "a website in a wrapper". Pre-empt this in
  the App Review notes:
  - packaged natively with Capacitor — all assets ship inside the binary, the
    app loads no remote URL
  - **works 100% offline** — invite the reviewer to test in airplane mode
  - **native haptics** integration
  - full-screen, app-like game experience: no browser chrome, no external links,
    no account wall
- Do not mention the free web version in the App Store listing or review notes;
  "same thing available on the web" invites a 4.2 discussion
- No cross-platform references ("Android", "Google Play") in listing text or
  screenshots (Guideline 2.3.10)

Google
- The main technical blocker is the **target API level** check above
- Ship the Capacitor build (not a thin TWA/WebView pointing at the website) so
  the offline claim holds on both stores
- Ensure the dormant mock-ad placeholders can never render in the packaged app
  (they only appear with `?test=1`/`?debug=1` — those query flags must be
  unreachable in production), otherwise the "contains no ads" declaration looks
  false to a reviewer

## 4. Ads / IAP note for v1

- v1 ships **NO real ads and NO in-app purchases** (mock architecture dormant).
  Submit WITHOUT any AdMob/billing declarations:
  - no AdMob app ID in the manifest/Info.plist
  - no `com.google.android.gms.permission.AD_ID` permission, no billing
    permission/StoreKit capability
  - Play "Contains ads" = No · Data safety = nothing collected/shared
  - Apple privacy label = Data Not Collected · no ATT prompt
- Before v1.1 (real AdMob/StoreKit): update the privacy policy FIRST, then the
  Play Data safety form, the ads declaration, the Apple privacy label (+ ATT if
  applicable), and re-run the IARC questionnaire

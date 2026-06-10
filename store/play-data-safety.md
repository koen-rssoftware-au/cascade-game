# Cascade — Data Safety, Privacy Label & Content Rating answers

Applies to v1: fully offline, no analytics, no ads SDK (mock ad architecture is
dormant and renders nothing in production), no IAP, no accounts, no network
calls after first load. All progress/scores/settings live in local storage on
the device only.

Privacy policy URL (required by both stores):
https://koen-rssoftware-au.github.io/cascade-game/privacy-policy.html

---

## 1. Google Play — Data safety form (exact answers)

**"Does your app collect or share any of the required user data types?"** → **No**

Answering No short-circuits the rest of the form; the listing will show
"No data collected" and "No data shared". For reference, should any sub-question
appear:

| Question | Answer |
|---|---|
| Data types collected | None — select no data types |
| Data types shared | None |
| Is all of the user data collected by your app encrypted in transit? | Not applicable — the app transmits no user data (no network calls after first load) |
| Do you provide a way for users to request that their data is deleted? | Not applicable — no data is collected. Local game data can be erased on-device via the in-game Reset option, or by uninstalling the app |
| Independent security review (optional badge) | No |

Related App content declarations:

| Declaration | Answer |
|---|---|
| Does your app contain ads? | **No** (no ad SDK in v1 — revisit when v1.1 adds real ads) |
| App access | All functionality is available without special access (no login required) |
| Target audience | Select age groups 13+ — the game is general-audience, not "designed for children"; including under-13 groups would pull the app into the Families policy track with extra obligations |
| News app / COVID-19 app / Government app | No |

## 2. App Store — Privacy "nutrition label"

App Store Connect → App Privacy:

- **"Do you or your third-party partners collect data from this app?"** → **No**
- Resulting label: **Data Not Collected**
- Tracking / AppTrackingTransparency: not applicable — no tracking, no ad identifiers
- Privacy policy URL: as above

## 3. Content rating questionnaire (IARC, Google Play) — essentials

- App category: **Game**
- Violence (any, incl. cartoon/fantasy): **No**
- Frightening or horror content: **No**
- Sexual content or nudity: **No**
- Profanity or crude humour: **No**
- References to drugs, alcohol or tobacco: **No**
- Gambling — real-money: **No**; simulated gambling: **No**
- Users can interact or exchange content (chat, UGC): **No**
- Shares the user's location with others: **No**
- Contains digital purchases: **No** (v1 has no IAP)
- Contains ads: **No**

**Expected ratings:** ESRB **Everyone** · PEGI **3** · USK **0** · Google Play **Everyone / 3+**

## 4. Apple age rating questionnaire — essentials

All content-frequency questions (cartoon violence, realistic violence, horror,
profanity, mature/suggestive themes, sexual content, drugs/alcohol/tobacco):
**None**. Simulated gambling: **No**. Contests: **No**. Unrestricted web access:
**No** (the app loads no external web content).

**Expected rating: 4+**

---

When v1.1 introduces real ads/IAP, every section above must be re-answered
BEFORE release (ads → data safety "shares device identifiers", "contains ads" =
Yes, Apple label updated, IARC ads question = Yes), and the privacy policy
updated first.

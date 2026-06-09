// Bridges the AdProvider abstraction to the visible fake-ad placeholder (§9.1:
// "a debug flag visibly fakes ad display (2 s placeholder screen) so flows are
// testable end to end"). The provider decides availability/fill; the placeholder
// decides the USER outcome (watched vs dismissed) for rewarded ads.
import type { AdProvider, MockAdProvider } from '../monetization/adProvider';
import type { Screens } from './screens';

const FAKE_AD_MS = 2000;

export class UiAdProvider implements AdProvider {
  constructor(
    private readonly inner: MockAdProvider,
    private readonly screens: Screens,
  ) {}

  isReady(kind: 'interstitial' | 'rewarded' | 'banner'): boolean {
    return this.inner.isReady(kind);
  }

  async showInterstitial(): Promise<'shown' | 'skipped' | 'unavailable'> {
    if (!this.inner.isReady('interstitial')) return 'unavailable';
    const result = await this.inner.showInterstitial(); // may throw → SafeAdProvider catches
    if (result !== 'shown') return result;
    await this.screens.showFakeAd('interstitial', FAKE_AD_MS);
    return 'shown';
  }

  async showRewarded(): Promise<'rewarded' | 'dismissed' | 'unavailable'> {
    if (!this.inner.isReady('rewarded')) return 'unavailable';
    const result = await this.inner.showRewarded(); // may throw → SafeAdProvider catches
    if (result !== 'rewarded') return result; // configured no-fill / dismiss / unavailable
    const ui = await this.screens.showFakeAd('rewarded', FAKE_AD_MS);
    // Reward grant happens ONLY on the 'rewarded' resolution (§9.3).
    return ui === 'completed' ? 'rewarded' : 'dismissed';
  }

  setBannerVisible(visible: boolean): void {
    this.inner.setBannerVisible(visible);
  }
}

// Native shell integration (Capacitor): status bar, splash screen, Android back
// button. Every call is individually guarded — a missing plugin must never take
// the game down, and none of this runs on the web.
export interface BackButtonHandler {
  /** Return 'minimize' to background the app (Android home screen behavior). */
  onBackButton(): 'minimize' | 'handled';
}

export async function initNativeChrome(handlers: BackButtonHandler): Promise<void> {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark }); // light text on our navy bg
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0b1026' });
    }
  } catch {
    /* status bar styling is cosmetic */
  }
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('backButton', () => {
      if (handlers.onBackButton() === 'minimize') void App.minimizeApp();
    });
  } catch {
    /* back button falls back to default behavior */
  }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    /* launchAutoHide covers this */
  }
}

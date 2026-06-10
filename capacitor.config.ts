import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'au.com.rssoftware.cascade',
  appName: 'Cascade',
  webDir: 'dist',
  android: {
    backgroundColor: '#0b1026',
  },
  ios: {
    backgroundColor: '#0b1026',
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#0b1026',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0b1026',
      overlaysWebView: false,
    },
  },
};

export default config;

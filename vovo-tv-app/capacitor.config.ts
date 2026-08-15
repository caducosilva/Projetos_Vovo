import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vovotv.app',
  appName: 'Vovo TV',
  webDir: 'dist',
  server: {
    // http em vez de https: a maioria dos streams de IPTV e http puro.
    // Com androidScheme https o WebView bloqueia tudo como Mixed Content.
    androidScheme: 'http',
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;

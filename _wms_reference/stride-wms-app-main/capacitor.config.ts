import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.2db8a4a9ca38466e84b280e3eeb232e2',
  appName: 'Stride Warehouse',
  webDir: 'dist',
  server: {
    url: 'https://2db8a4a9-ca38-466e-84b2-80e3eeb232e2.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
    StatusBar: {
      style: 'default',
      backgroundColor: '#ffffff',
    },
    DocumentScanner: {
      galleryImportAllowed: true,
      pageLimit: 20,
      resultFormats: 'PDF,JPEG',
    },
  },
};

export default config;

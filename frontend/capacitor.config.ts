import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.workouttracker.app',
  appName: 'WorkoutTracker',
  webDir: 'out',
  server: {
    url: 'http://192.168.0.50:3000',
    cleartext: true,
  },
  ios: {
    allowsLinkPreview: true,
  },
};

export default config;

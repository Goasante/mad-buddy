import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.madbuddy.app",
  appName: "Mad Buddy",
  webDir: "capacitor-www",
  server: {
    url: "https://mad-buddy.vercel.app",
    cleartext: false
  }
};

export default config;
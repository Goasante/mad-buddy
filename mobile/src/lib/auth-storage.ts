import { Capacitor } from "@capacitor/core";
import {
  KeychainAccess,
  SecureStorage
} from "@aparajita/capacitor-secure-storage";
import type { SupportedStorage } from "@supabase/supabase-js";

const STORAGE_PREFIX = "mad-buddy_";
const LEGACY_STORAGE_KEY = "mad-buddy-auth";

let secureStorageReady: Promise<void> | null = null;

function prepareSecureStorage(): Promise<void> {
  if (!secureStorageReady) {
    secureStorageReady = (async () => {
      await SecureStorage.setKeyPrefix(STORAGE_PREFIX);
      await SecureStorage.setSynchronize(false);
      await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);

      // Remove the previous plaintext WebView copy without reading or migrating
      // it. Existing native users sign in once after this security upgrade.
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    })();
  }
  return secureStorageReady;
}

const nativeSecureStorage: SupportedStorage = {
  async getItem(key) {
    await prepareSecureStorage();
    return SecureStorage.getItem(key);
  },
  async setItem(key, value) {
    await prepareSecureStorage();
    await SecureStorage.setItem(key, value);
  },
  async removeItem(key) {
    await prepareSecureStorage();
    await SecureStorage.removeItem(key);
  }
};

const browserStorage: SupportedStorage = {
  getItem(key) {
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    window.localStorage.setItem(key, value);
  },
  removeItem(key) {
    window.localStorage.removeItem(key);
  }
};

export function mobileAuthStorage(): SupportedStorage {
  return Capacitor.isNativePlatform() ? nativeSecureStorage : browserStorage;
}

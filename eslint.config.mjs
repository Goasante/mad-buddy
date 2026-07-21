import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Generated build output — not application source. The Android build bundles
  // a native-bridge.js that otherwise produced 32 spurious lint warnings.
  {
    ignores: [".next/**", "android/**", "ios/**", "dist/**", "build/**", "coverage/**", "mobile/**"]
  },
  ...nextVitals,
  ...nextTypescript
];

export default eslintConfig;

import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Generated build output — not application source. The Android build bundles
  // a native-bridge.js that otherwise produced 32 spurious lint warnings.
  {
    ignores: [".next/**", "android/**", "ios/**", "dist/**", "build/**", "coverage/**", "mobile/**"]
  },
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["components/messages/messages-page-v3.tsx"],
    rules: {
      // The initial selected conversation is seeded from the URL during render.
      // This effect only re-synchronizes a later client-side ?conversation=
      // deep-link change with the same state and kicks off its authorized read.
      // It is route synchronization, not derived-state computation.
      "react-hooks/set-state-in-effect": "off"
    }
  }
];

export default eslintConfig;

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
    files: [
      "components/messages/messages-page-v3.tsx",
      "components/messaging/message-composer-v3.tsx"
    ],
    rules: {
      // These effects synchronize React presentation with EXTERNAL state:
      // route/deep-link changes in MessagesPageV3 and the MediaRecorder +
      // window pointer lifecycle in MessageComposerV3. They are not deriving
      // state that belongs in render; the external systems may change after a
      // render and must be reflected back into the interaction state.
      "react-hooks/set-state-in-effect": "off"
    }
  }
];

export default eslintConfig;

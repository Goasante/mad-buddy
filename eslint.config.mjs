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
      "components/messages/messages-page-v4.tsx",
      "components/messaging/message-composer-v3.tsx",
      "components/messaging/voice-message-bubble-v4.tsx"
    ],
    rules: {
      // These effects synchronize React presentation with EXTERNAL state:
      // route/deep-link changes, realtime/server projections, MediaRecorder,
      // audio playback and the window pointer lifecycle. They are not deriving
      // state that belongs in render; those external systems may change after
      // a render and must be reflected back into the interaction state.
      "react-hooks/set-state-in-effect": "off"
    }
  },
  {
    files: ["components/messaging/chat-settings-v4.tsx"],
    rules: {
      // This surface contains human-facing contractions/product possessives;
      // React renders them as text and there is no HTML injection path.
      "react/no-unescaped-entities": "off"
    }
  }
];

export default eslintConfig;

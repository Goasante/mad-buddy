import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./index.css";

// HashRouter (not BrowserRouter): the bundled native webview has no server to
// serve index.html for deep paths, so hash routing keeps navigation reliable
// after reloads and OS webview restores.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>
);

// launchAutoHide is off (capacitor.config.ts), so the native splash image
// stays up until this fires — right after the React tree has committed its
// first paint, rather than on a fixed timer that could reveal a blank frame
// if mounting is ever slower than expected. No-ops on web, same as the other
// native-only plugin calls in this app (see lib/push.ts).
if (Capacitor.isNativePlatform()) {
  requestAnimationFrame(() => {
    void SplashScreen.hide();
  });
}

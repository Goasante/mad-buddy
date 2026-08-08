import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { FullScreenLoader } from "./components/Spinner";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./screens/LoginScreen";
import { SignupScreen } from "./screens/SignupScreen";
import { PrivacyScreen, TermsScreen } from "./screens/LegalScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { MuddiesScreen } from "./screens/MuddiesScreen";
import { PlansScreen } from "./screens/PlansScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { MessagesScreen } from "./screens/MessagesScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { MomentsScreen } from "./screens/MomentsScreen";
import { SocializeScreen } from "./screens/SocializeScreen";
import { MeetingPingsScreen } from "./screens/MeetingPingsScreen";
import { HelpScreen } from "./screens/HelpScreen";
import { NotificationPreferencesScreen } from "./screens/NotificationPreferencesScreen";
import { EventsScreen } from "./screens/EventsScreen";
import { GroupsScreen } from "./screens/GroupsScreen";
import { UserProfileScreen } from "./screens/UserProfileScreen";
import { SafetyScreen } from "./screens/SafetyScreen";
import { SubscriptionScreen } from "./screens/SubscriptionScreen";
import { BuddyScoreScreen } from "./screens/BuddyScoreScreen";
import { useAndroidBack } from "./hooks/useAndroidBack";
import type { ReactNode } from "react";

/**
 * A signed-in user who has finished onboarding.
 *
 * Session presence alone is not enough: it proves someone signed in, not that
 * they finished setting up. Guarding on session only meant an unfinished user
 * reached Home simply by reopening the app, and stayed there.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session, isOnboarded } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace />;
  // Fails closed: unresolved or missing profile state routes to onboarding,
  // which is recoverable, rather than into an app built on a profile that may
  // not exist.
  if (!isOnboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/**
 * Signed in, onboarding not yet complete.
 *
 * Separate from RequireAuth so the onboarding screen itself is reachable --
 * guarding it with RequireAuth would redirect it to itself forever.
 */
function RequireAuthPreOnboarding({ children }: { children: ReactNode }) {
  const { loading, session, isOnboarded } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace />;
  // Already finished: send them on, so onboarding cannot be revisited by
  // typing the route or restoring a stale deep link.
  if (isOnboarded) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { loading, session, isOnboarded } = useAuth();
  if (loading) return <FullScreenLoader />;
  // Sends an authenticated visitor to where they actually belong, rather than
  // to Home unconditionally -- which is how an unfinished user bypassed
  // onboarding by opening /login.
  if (session) return <Navigate to={isOnboarded ? "/home" : "/onboarding"} replace />;
  return <>{children}</>;
}

export default function App() {
  useAndroidBack();
  return (
    <Routes>
      <Route path="/login" element={<RedirectIfAuthed><LoginScreen /></RedirectIfAuthed>} />
      <Route path="/signup" element={<RedirectIfAuthed><SignupScreen /></RedirectIfAuthed>} />
      <Route path="/onboarding" element={<RequireAuthPreOnboarding><OnboardingScreen /></RequireAuthPreOnboarding>} />

      {/* Unguarded, deliberately. Consent is given AT signup, so both
          documents have to be readable before an account exists -- and they
          stay reachable afterwards from Settings. */}
      <Route path="/privacy" element={<PrivacyScreen />} />
      <Route path="/terms" element={<TermsScreen />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/home" element={<HomeScreen />} />
        <Route path="/muddies" element={<MuddiesScreen />} />
        <Route path="/plans" element={<PlansScreen />} />
        <Route path="/notifications" element={<NotificationsScreen />} />
        <Route path="/more" element={<MoreScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/messages" element={<MessagesScreen />} />
        <Route path="/moments" element={<MomentsScreen />} />
        <Route path="/socialize" element={<SocializeScreen />} />
        <Route path="/pings" element={<MeetingPingsScreen />} />
        <Route path="/events" element={<EventsScreen />} />
        <Route path="/groups" element={<GroupsScreen />} />
        <Route path="/safety" element={<SafetyScreen />} />
        <Route path="/subscription" element={<SubscriptionScreen />} />
        <Route path="/buddy-score" element={<BuddyScoreScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/help" element={<HelpScreen />} />
        <Route path="/settings/notifications" element={<NotificationPreferencesScreen />} />
      </Route>

      {/* Full-screen chat + profile (own header, no bottom tabs). */}
      <Route path="/messages/:id" element={<RequireAuth><ChatScreen /></RequireAuth>} />
      <Route path="/u/:id" element={<RequireAuth><UserProfileScreen /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

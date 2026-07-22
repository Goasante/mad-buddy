import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { FullScreenLoader } from "./components/Spinner";
import { AppShell } from "./components/AppShell";
import { LoginScreen } from "./screens/LoginScreen";
import { SignupScreen } from "./screens/SignupScreen";
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
import { EventsScreen } from "./screens/EventsScreen";
import { GroupsScreen } from "./screens/GroupsScreen";
import { UserProfileScreen } from "./screens/UserProfileScreen";
import { SafetyScreen } from "./screens/SafetyScreen";
import { SubscriptionScreen } from "./screens/SubscriptionScreen";
import { useAndroidBack } from "./hooks/useAndroidBack";
import type { ReactNode } from "react";

function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { loading, session } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (session) return <Navigate to="/home" replace />;
  return <>{children}</>;
}

export default function App() {
  useAndroidBack();
  return (
    <Routes>
      <Route path="/login" element={<RedirectIfAuthed><LoginScreen /></RedirectIfAuthed>} />
      <Route path="/signup" element={<RedirectIfAuthed><SignupScreen /></RedirectIfAuthed>} />
      <Route path="/onboarding" element={<RequireAuth><OnboardingScreen /></RequireAuth>} />

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
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/help" element={<HelpScreen />} />
      </Route>

      {/* Full-screen chat + profile (own header, no bottom tabs). */}
      <Route path="/messages/:id" element={<RequireAuth><ChatScreen /></RequireAuth>} />
      <Route path="/u/:id" element={<RequireAuth><UserProfileScreen /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

import { LoginForm } from "@/components/auth/login-form";
import { SignInCard } from "@/components/ui/sign-in-card-2";
import { oauthErrorMessage, safeAuthNext } from "@/lib/auth/oauth-redirect";

type LoginPageProps = {
  searchParams: Promise<{ oauth_error?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { oauth_error: oauthError, next } = await searchParams;

  return (
    <SignInCard
      title="Welcome Muddy"
      description=""
    >
      <LoginForm initialError={oauthErrorMessage(oauthError)} nextDestination={safeAuthNext(next ?? null)} />
    </SignInCard>
  );
}

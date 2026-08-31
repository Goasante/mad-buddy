import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { AuthShell } from "@/components/front-door/auth-shell";
import { oauthErrorMessage, safeAuthNext } from "@/lib/auth/oauth-redirect";

type LoginPageProps = {
  searchParams: Promise<{ oauth_error?: string; next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { oauth_error: oauthError, next } = await searchParams;

  return (
    <AuthShell
      title="Welcome back"
      description="Log in to return to your Muddies, plans, messages, and privacy settings."
      footer={
        <>
          New to Mad Buddy?{" "}
          <Link href="/signup" className="focus-ring -mx-2 inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-[#4E0401] hover:text-[#E88C2B] dark:text-[#FFF8F1]">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm initialError={oauthErrorMessage(oauthError)} nextDestination={safeAuthNext(next ?? null)} />
    </AuthShell>
  );
}

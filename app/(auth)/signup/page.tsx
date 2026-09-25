import { AuthLayout } from "@/components/auth/auth-layout";
import { SignupForm } from "@/components/auth/signup-form";
import { oauthErrorMessage, safeAuthNext } from "@/lib/auth/oauth-redirect";

type SignupPageProps = {
  searchParams: Promise<{ oauth_error?: string; next?: string; accountDeleted?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { oauth_error: oauthError, next, accountDeleted } = await searchParams;
  const nextDestination = safeAuthNext(next ?? null);

  return (
    <AuthLayout
      title="Create your account"
      description="Start with email, then choose how friends find you."
      footer={null}
      compact
    >
      {accountDeleted === "1" ? (
        <p role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          Your account has been deleted.
        </p>
      ) : null}
      <SignupForm initialError={oauthErrorMessage(oauthError)} nextDestination={nextDestination} />
    </AuthLayout>
  );
}

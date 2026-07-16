import { LoginForm } from "@/components/auth/login-form";
import { SignInCard } from "@/components/ui/sign-in-card-2";

export default function LoginPage() {
  return (
    <SignInCard
      title="Welcome Muddy"
      description=""
    >
      <LoginForm />
    </SignInCard>
  );
}

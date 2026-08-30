import { PublicHeader } from "@/components/front-door/public-shell";
import { LandingMobileMenu } from "@/components/landing/landing-mobile-menu";

export function LandingNav() {
  return <PublicHeader mobileMenu={<LandingMobileMenu />} />;
}

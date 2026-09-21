import Link from "next/link";

import { PublicHeader } from "@/components/front-door/public-shell";
import { LandingMobileMenu } from "@/components/landing/landing-mobile-menu";

export function LandingNav() {
  return (
    <>
      <PublicHeader mobileMenu={<LandingMobileMenu />} />
      <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top,0px)+4.25rem)] z-40 border-b border-[#E88C2B]/15 bg-[#FFF5E8]/95 backdrop-blur-xl dark:border-white/[0.07] dark:bg-[#1A0D0A]/95">
        <div className="mx-auto flex min-h-10 w-full max-w-7xl items-center justify-center gap-2 px-4 text-center text-[11px] font-semibold leading-4 text-[#6B2D18] sm:px-6 sm:text-xs lg:px-10 dark:text-[#F6D7BB]">
          <span>Mad Buddy is free to use.</span>
          <span aria-hidden="true" className="text-[#E88C2B]">•</span>
          <span>Light ads support the free app.</span>
          <Link
            href="/pricing"
            className="focus-ring rounded-full font-bold text-[#9A4F13] underline decoration-[#E88C2B]/40 underline-offset-2 hover:text-[#6F320E] dark:text-[#F2B16F] dark:hover:text-[#FFD2A4]"
          >
            Access removes ads
          </Link>
        </div>
      </div>
    </>
  );
}
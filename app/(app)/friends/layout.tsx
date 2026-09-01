import type { ReactNode } from "react";

/**
 * Keep Contact Discovery fully wired while temporarily removing its dedicated
 * Muddies-page promo card from the rendered UI. Deep links, Settings entry
 * points, reminder flows and the lazy sheet remain intact for a later revisit.
 */
export default function FriendsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        .muddies-page > button:has(.lucide-book-user) {
          display: none;
        }
      `}</style>
      {children}
    </>
  );
}

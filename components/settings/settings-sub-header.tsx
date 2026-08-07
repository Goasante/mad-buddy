import { PageHeader } from "@/components/app-shell/page-header";

/**
 * The heading for a Settings sub-page.
 *
 * NOT a second header implementation: on mobile it renders the canonical
 * `PageHeader` (which is `MobilePageHeader` pre-wired to the shell), so these
 * pages get the same fixed bar, safe-area handling, hit targets, icon sizing
 * and scroll divider as every other screen. Previously they had no fixed
 * header at all — just an in-content title with a small text link back — which
 * is why Settings felt like a different app once you went one level in.
 *
 * The desktop treatment stays an in-content heading with a Back link, matching
 * the rest of the app: the persistent sidebar already carries navigation
 * there, so a second fixed bar would be redundant chrome.
 *
 * `md:` is the same breakpoint MobilePageHeader hides itself at, so exactly
 * one of the two is ever on screen and the page can never show two headings.
 */
export function SettingsSubHeader({ title, description }: { title: string; description?: string }) {
  return (
    <>
      {/* Mobile: the canonical fixed header, with Back to Settings. Nested
          screens deliberately carry no notification or Add Muddy actions —
          the way back and the title are the point. */}
      <PageHeader title={title} backHref="/settings" />

      {/* Desktop: unchanged in-content heading. */}
      <header className="hidden border-b border-border/70 pb-4 md:block">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
      </header>

      {/* The description still belongs on mobile, where the fixed header has
          room for the title only. */}
      {description ? <p className="text-sm text-muted-foreground md:hidden">{description}</p> : null}
    </>
  );
}

/* Through the platform adapter, NOT next/image directly: this renders inside
   the shared bottom navigation, so a direct import puts Next's image runtime
   in the Capacitor bundle. Web is unaffected -- the adapter re-exports the
   real next/image verbatim. */
import { Image } from "@/lib/platform";
import { brandNavigationIcons, type BrandNavigationIconName } from "@/lib/brand/assets";
import { cn } from "@/lib/utils";

type BrandNavigationIconProps = {
  name: BrandNavigationIconName;
  active: boolean;
  size: number;
  className?: string;
};

/** State-specific approved Linkr/UpFor artwork with no runtime recolouring. */
export function BrandNavigationIcon({ name, active, size, className }: BrandNavigationIconProps) {
  const asset = brandNavigationIcons[name][active ? "active" : "inactive"];

  return (
    <Image
      src={asset.src}
      alt=""
      width={asset.width}
      height={asset.height}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

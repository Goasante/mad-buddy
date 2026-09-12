import { forwardRef, type ImgHTMLAttributes } from "react";

/**
 * Platform Image — Capacitor/Vite implementation.
 *
 * A plain <img>. next/image's whole value is the server-side optimizer and the
 * srcset it generates; a bundled webview has no such endpoint, so calling one
 * would be a broken request rather than a faster image.
 *
 * Next-only props are accepted and ignored so shared call sites stay
 * identical. `fill` is the one with real layout meaning — it makes the image
 * absolutely fill its positioned parent — so it is translated to the
 * equivalent CSS rather than dropped, which would silently collapse the
 * layout.
 */

type PlatformImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  alt: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
  sizes?: string;
  unoptimized?: boolean;
};

export const Image = forwardRef<HTMLImageElement, PlatformImageProps>(function Image(
  {
    src,
    alt,
    width,
    height,
    fill,
    priority,
    quality: _quality,
    placeholder: _placeholder,
    blurDataURL: _blurDataURL,
    sizes,
    unoptimized: _unoptimized,
    style,
    ...rest
  },
  ref
) {
  /* Mirrors what next/image's `fill` actually does: absolutely fill the
     positioned parent. It notably does NOT set object-fit -- that is left to
     the caller, normally via a className like "object-contain".
     An earlier draft added objectFit:"cover" here. Because an inline style
     beats a class, that silently overrode every shared component asking for
     object-contain (badges, brand marks, buddy-score rows) and squashed or
     cropped their artwork on mobile only -- precisely the kind of quiet visual
     drift this adapter exists to prevent. */
  const fillStyle = fill
    ? ({
        position: "absolute" as const,
        inset: 0,
        width: "100%",
        height: "100%"
      })
    : undefined;

  /* The no-img-element rule is right on web -- and this file is the reason it
     cannot be followed here. A bundled webview has no optimizer endpoint for
     next/image to call, so a plain <img> is the correct element. Web keeps the
     real next/image via lib/platform/image.tsx. */
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes}
      // next/image's `priority` maps onto the platform hints a plain img has.
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  );
});

export type ImageProps = PlatformImageProps;

import Image from "next/image";
import { articleImageUrl, type ArticleImage } from "@/lib/blog/image-model";

export function ArticleFigure({ image, cover = false }: { image: ArticleImage; cover?: boolean }) {
  return <figure className={cover ? "mb-12 max-w-4xl" : "my-9"}>
    <Image src={articleImageUrl(image.id)} alt={image.alt} width={image.width} height={image.height}
      unoptimized loading={cover ? "eager" : "lazy"} fetchPriority={cover ? "high" : "low"}
      className="h-auto max-h-[650px] w-full rounded-2xl object-contain" />
    {image.caption && <figcaption className="mt-3 text-sm leading-6 opacity-65">{image.caption}</figcaption>}
  </figure>;
}

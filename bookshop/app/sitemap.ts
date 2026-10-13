import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';
import { configuration } from '@/lib/shop/store';
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{const {config}=await configuration();return ['','/author','/work-with-me',...config.books.filter(b=>b.published).map(b=>'/books/'+b.slug)].map(p=>({url:absoluteUrl(p),changeFrequency:'monthly',priority:p?0.7:1}));}

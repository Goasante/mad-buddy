import { notFound } from "next/navigation";
import { configuration } from "@/lib/shop/store";
import { BookPage } from "@/components/public";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { config } = await configuration();
  const book = config.books.find((b) => b.slug === slug && b.published);
  return { title: book?.title, description: book?.subtitle };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { config } = await configuration();
  const book = config.books.find((b) => b.slug === slug && b.published);
  if (!book) notFound();
  return <BookPage book={book} config={config} />;
}

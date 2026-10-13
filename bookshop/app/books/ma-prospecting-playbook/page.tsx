import { notFound } from "next/navigation";
import { configuration } from "@/lib/shop/store";
import { BookPage } from "@/components/public";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { config } = await configuration();
  const book = config.books.find((b) => b.slug === "ma-prospecting-playbook" && b.published);
  return { title: book?.title, description: book?.subtitle };
}
export default async function Page() {
  const { config } = await configuration();
  const book = config.books.find(
    (b) => b.slug === "ma-prospecting-playbook" && b.published
  );
  if (!book) notFound();
  return <BookPage book={book} config={config} />;
}

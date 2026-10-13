import { notFound } from "next/navigation";
import { configuration } from "@/lib/shop/store";
import { BookPage } from "@/components/public";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Buy Businesses on Your Terms",
  description:
    "The LinkedIn Sales Navigator field guide for acquisition prospecting and owner conversations.",
};
export default async function Page() {
  const { config } = await configuration();
  const book = config.books.find(
    (b) => b.slug === "ma-prospecting-playbook" && b.published
  );
  if (!book) notFound();
  return <BookPage book={book} config={config} />;
}

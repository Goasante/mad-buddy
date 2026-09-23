import { redirect } from "next/navigation";

/**
 * Legacy Group deep link.
 *
 * A Group id is the conversation id, so the canonical destination is the
 * Messages thread itself. Messages re-authorises the conversation before
 * rendering; the URL never grants access.
 */
export default async function GroupDetailRoute({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/messages?conversation=${encodeURIComponent(id)}`);
}

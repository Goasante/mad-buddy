import { redirect } from "next/navigation";

/**
 * A Group is a canonical Messages conversation.
 *
 * Old /groups/:id links remain safe and useful, but they no longer render a
 * competing chat/detail page with separate scroll ownership. They land in the
 * same thread people reach from Messages.
 */
export default async function GroupDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/messages?conversation=${encodeURIComponent(id)}`);
}

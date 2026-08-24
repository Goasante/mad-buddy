import { splitTextWithMentions } from "@/lib/messaging/mentions";

/**
 * Message text, with any mentions gently emphasised.
 *
 * STILL ONE SENTENCE. A mention is a weight change inside the bubble, not a
 * chip, a pill or a card -- "Are you coming @Ama?" has to read as something a
 * person said, and a row of buttons in the middle of a sentence does not.
 *
 * Only ids the SERVER stored are highlighted. Text that merely looks like
 * "@someone" renders plainly, so what is emphasised can never claim more than
 * what was persisted and notified.
 */
export function MessageText({
  text,
  mentions
}: {
  text: string;
  mentions: ReadonlyArray<{ userId: string; displayName: string; username?: string | null }>;
}) {
  if (mentions.length === 0) return <>{text}</>;

  return (
    <>
      {splitTextWithMentions(text, mentions).map((run, index) =>
        run.mentionedUserId ? (
          <span
            key={`${run.mentionedUserId}-${index}`}
            className="font-semibold text-primary"
            // The name is decoration around an identity the reader cannot see;
            // announcing it keeps that legible to a screen reader.
            aria-label={`mentioned ${run.text.slice(1)}`}
          >
            {run.text}
          </span>
        ) : (
          <span key={`text-${index}`}>{run.text}</span>
        )
      )}
    </>
  );
}

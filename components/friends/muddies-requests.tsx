"use client";

import { UserAvatar } from "@/components/ui/user-avatar";

export type MuddyRequestPerson = {
  id: string;
  requestId?: string;
  displayName: string;
  avatarUrl: string | null;
  mutualFriends: number;
  /** Avatars of shared Muddies, for the stack. Empty is fine. */
  mutualAvatarUrls?: readonly string[];
};

/**
 * Incoming Muddy requests.
 *
 * Two actions, weighted: Accept is the affirmative one and carries the fill;
 * Ignore is quiet but never hidden. Mutual Muddies sit under the name because
 * "who else knows this person" is the question being answered before deciding.
 */
export function MuddiesRequests({
  requests,
  onAccept,
  onIgnore,
  pendingId
}: {
  requests: readonly MuddyRequestPerson[];
  onAccept: (person: MuddyRequestPerson) => void;
  onIgnore: (person: MuddyRequestPerson) => void;
  /** The request mid-flight, if any. */
  pendingId?: string | null;
}) {
  if (requests.length === 0) return null;

  return (
    <ul className="muddies-requests">
      {requests.map((person) => {
        const busy = pendingId === person.id;

        return (
          <li key={person.id} className="muddies-request">
            <UserAvatar src={person.avatarUrl} name={person.displayName} decorative size="md" />

            <div className="muddies-request-body">
              <p className="muddies-request-name">{person.displayName}</p>
              <p className="muddies-request-copy">Wants to be your Muddy</p>

              {person.mutualFriends > 0 ? (
                <p className="muddies-request-mutuals">
                  {person.mutualAvatarUrls && person.mutualAvatarUrls.length > 0 ? (
                    <span className="muddies-mutual-stack" aria-hidden="true">
                      {person.mutualAvatarUrls.slice(0, 3).map((url, position) => (
                        <UserAvatar
                          key={`${person.id}-mutual-${position}`}
                          src={url}
                          name=""
                          decorative
                          size="sm"
                          className="muddies-mutual-avatar"
                        />
                      ))}
                    </span>
                  ) : null}
                  {person.mutualFriends} mutual {person.mutualFriends === 1 ? "Muddy" : "Muddies"}
                </p>
              ) : null}
            </div>

            <div className="muddies-request-actions">
              <button
                type="button"
                onClick={() => onIgnore(person)}
                disabled={busy}
                className="muddies-request-ignore focus-ring"
              >
                Ignore
              </button>
              <button
                type="button"
                onClick={() => onAccept(person)}
                disabled={busy}
                className="muddies-request-accept focus-ring"
              >
                Accept
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

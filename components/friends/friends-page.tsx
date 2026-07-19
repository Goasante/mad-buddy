"use client";

import {
  Ban,
  Check,
  Clock,
  Flag,
  Hand,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  Search,
  UserMinus,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  acceptFriendRequestAction,
  blockUserAction,
  removeFriendAction,
  reportUserAction,
  searchUsersAction,
  sendFriendRequestAction,
  unblockUserAction,
  updateFriendRequestStatusAction
} from "@/app/(app)/actions";
import { sendWaveV2Action } from "@/app/(app)/social-actions";
import {
  addCircleMembersAction,
  addCloseFriendAction,
  createCircleAction,
  removeCloseFriendAction
} from "@/app/(app)/circles-actions";
import { createMeetupRequestAction } from "@/app/(app)/premium-actions";
import { Badge } from "@/components/ui/badge";
import { AppMenu } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { GlowAvatar } from "@/components/glow/glow-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MuddyProfileModal } from "@/components/glow/muddy-profile-modal";
import { Textarea } from "@/components/ui/textarea";
import { proximityLabels, type ConfidenceLevel, type ProximityLevel } from "@/lib/proximity";
import { cn } from "@/lib/utils";

type FriendTab = "all" | "circles" | "close" | "requests" | "blocked";

export type UserSummary = {
  id: string;
  requestId?: string;
  displayName: string;
  username: string;
  mutualFriends: number;
  status: "friend" | "available" | "received" | "sent" | "blocked";
  note: string;
};

type ProximityInfo = {
  proximityLevel: ProximityLevel;
  glowStrength: number;
  confidence: ConfidenceLevel;
};

type Circle = {
  id: string;
  name: string;
  memberIds: string[];
  protected?: boolean;
};

export type InitialCircle = {
  id: string;
  name: string;
  icon: string | null;
  memberIds: string[];
};

const CLOSE_FRIENDS_CIRCLE_ID = "close-friends";

type NearbyFriendApiItem = {
  friend_id: string;
  proximity_level: ProximityLevel;
  glow_strength: number;
  confidence: ConfidenceLevel;
};

const tabs: Array<{ id: FriendTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "circles", label: "Circles" },
  { id: "close", label: "Close Friends" },
  { id: "requests", label: "Requests" },
  { id: "blocked", label: "Blocked" }
];

export function FriendsPageContent({
  initialUsers = [],
  initialCircles = [],
  initialCloseFriendIds = []
}: {
  initialUsers?: UserSummary[];
  initialCircles?: InitialCircle[];
  initialCloseFriendIds?: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<FriendTab>(() => {
    const requestedTab = searchParams.get("tab");
    const validTabs: FriendTab[] = ["all", "circles", "close", "requests", "blocked"];
    return validTabs.includes(requestedTab as FriendTab) ? (requestedTab as FriendTab) : "all";
  });
  const [requestSubTab, setRequestSubTab] = useState<"received" | "sent">("received");
  const [users, setUsers] = useState<UserSummary[]>(initialUsers);
  const [proximityByFriendId, setProximityByFriendId] = useState<Record<string, ProximityInfo>>({});
  const [circles, setCircles] = useState<Circle[]>(() => [
    { id: CLOSE_FRIENDS_CIRCLE_ID, name: "Close Friends", memberIds: initialCloseFriendIds, protected: true },
    ...initialCircles.map((circle) => ({ id: circle.id, name: circle.name, memberIds: circle.memberIds }))
  ]);
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const [addOpen, setAddOpen] = useState(() => searchParams.get("tab") === "add");
  const [addQuery, setAddQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [reportUser, setReportUser] = useState<UserSummary | null>(null);
  const [reportDescription, setReportDescription] = useState("");
  const [profileUser, setProfileUser] = useState<UserSummary | null>(null);
  const [createCircleOpen, setCreateCircleOpen] = useState(false);
  const [newCircleName, setNewCircleName] = useState("");
  const [circleTargetUser, setCircleTargetUser] = useState<UserSummary | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setUsers(initialUsers));
    return () => window.cancelAnimationFrame(frame);
  }, [initialUsers]);

  useEffect(() => {
    const refreshFriends = () => router.refresh();

    window.addEventListener("focus", refreshFriends);
    return () => window.removeEventListener("focus", refreshFriends);
  }, [router]);

  useEffect(() => {
    let isMounted = true;

    async function loadProximity() {
      try {
        const response = await fetch("/api/friends/nearby", { credentials: "include", cache: "no-store" });
        if (!response.ok || !isMounted) return;
        const data = (await response.json()) as { friends: NearbyFriendApiItem[] };
        const next: Record<string, ProximityInfo> = {};
        data.friends.forEach((friend) => {
          next[friend.friend_id] = {
            proximityLevel: friend.proximity_level,
            glowStrength: friend.glow_strength,
            confidence: friend.confidence
          };
        });
        setProximityByFriendId(next);
      } catch {
        // Keep Muddies list working even if the proximity signal can't be fetched.
      }
    }

    void loadProximity();
    return () => {
      isMounted = false;
    };
  }, []);

  const friendUsers = useMemo(() => users.filter((user) => user.status === "friend"), [users]);
  const closeFriendIds = useMemo(
    () => circles.find((circle) => circle.id === "close-friends")?.memberIds ?? [],
    [circles]
  );

  const visibleFriendUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    let base = friendUsers;

    if (activeTab === "close") {
      base = base.filter((user) => closeFriendIds.includes(user.id));
    } else if (activeTab === "circles" && activeCircleId) {
      const circleMembers = circles.find((circle) => circle.id === activeCircleId)?.memberIds ?? [];
      base = base.filter((user) => circleMembers.includes(user.id));
    }

    if (!normalizedQuery) return base;
    return base.filter(
      (user) =>
        user.displayName.toLowerCase().includes(normalizedQuery) ||
        user.username.toLowerCase().includes(normalizedQuery)
    );
  }, [activeTab, activeCircleId, circles, closeFriendIds, friendUsers, query]);

  const requestUsers = useMemo(
    () => users.filter((user) => user.status === (requestSubTab === "received" ? "received" : "sent")),
    [users, requestSubTab]
  );
  const blockedUsers = useMemo(() => users.filter((user) => user.status === "blocked"), [users]);

  // Active-first grouping for the Muddies list. "Active" reuses the same
  // privacy-filtered proximity signal already fetched above (no second query):
  // a Muddy counts as active only when their live proximity is very close,
  // nearby or around. Active Muddies are ordered by proximity priority then
  // name; inactive Muddies fall back to alphabetical since no live sort exists.
  const { activeFriends, inactiveFriends } = useMemo(() => {
    const active: UserSummary[] = [];
    const inactive: UserSummary[] = [];
    for (const user of visibleFriendUsers) {
      const level = proximityByFriendId[user.id]?.proximityLevel;
      if (level === "very_close" || level === "nearby" || level === "around") {
        active.push(user);
      } else {
        inactive.push(user);
      }
    }
    const proximityRank = (user: UserSummary) => {
      const level = proximityByFriendId[user.id]?.proximityLevel;
      return level === "very_close" ? 0 : level === "nearby" ? 1 : 2;
    };
    active.sort(
      (a, b) => proximityRank(a) - proximityRank(b) || a.displayName.localeCompare(b.displayName)
    );
    inactive.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { activeFriends: active, inactiveFriends: inactive };
  }, [visibleFriendUsers, proximityByFriendId]);

  function updateUserStatus(userId: string, status: UserSummary["status"], message: string) {
    setUsers((currentUsers) =>
      currentUsers.map((user) => (user.id === userId ? { ...user, status } : user))
    );
    setFeedback(message);
  }

  function promoteUserToFriend(userId: string, message: string) {
    setUsers((currentUsers) => {
      const selected = currentUsers.find((user) => user.id === userId);
      if (!selected) return currentUsers;
      return [
        ...currentUsers.filter((user) => user.id !== userId),
        { ...selected, requestId: undefined, status: "friend" as const, note: "Approved Muddy" }
      ];
    });
    setFeedback(message);
  }

  function removeUser(userId: string, message: string) {
    setUsers((currentUsers) => currentUsers.filter((user) => user.id !== userId));
    setFeedback(message);
  }

  function runFriendAction(action: () => Promise<{ ok: boolean; message: string }>, onLocalSuccess: () => void) {
    startTransition(async () => {
      const result = await action();
      setFeedback(result.message);

      if (result.ok) {
        onLocalSuccess();
        router.refresh();
      }
    });
  }

  function searchUsers() {
    startTransition(async () => {
      const result = await searchUsersAction(addQuery);
      setFeedback(result.message);
      setHasSearched(true);

      if (result.ok) {
        setUsers((currentUsers) => [
          ...currentUsers.filter((user) => user.status !== "available"),
          ...result.users
        ]);
      }
    });
  }

  function setCloseFriendMembership(userId: string, isMember: boolean) {
    setCircles((current) =>
      current.map((circle) => {
        if (circle.id !== CLOSE_FRIENDS_CIRCLE_ID) return circle;
        return {
          ...circle,
          memberIds: isMember
            ? [...new Set([...circle.memberIds, userId])]
            : circle.memberIds.filter((id) => id !== userId)
        };
      })
    );
  }

  function toggleCloseFriend(user: UserSummary) {
    const wasMember = closeFriendIds.includes(user.id);
    // Optimistic; revert if the server rejects (e.g. tier limit reached).
    setCloseFriendMembership(user.id, !wasMember);
    startTransition(async () => {
      const result = wasMember
        ? await removeCloseFriendAction(user.id)
        : await addCloseFriendAction(user.id);
      setFeedback(result.message);
      if (!result.ok) setCloseFriendMembership(user.id, wasMember);
    });
  }

  function createCircle() {
    const name = newCircleName.trim();
    if (!name) return;
    const targetId = circleTargetUser?.id ?? null;
    setNewCircleName("");
    setCreateCircleOpen(false);
    setCircleTargetUser(null);
    startTransition(async () => {
      const result = await createCircleAction({
        name,
        memberIds: targetId ? [targetId] : []
      });
      setFeedback(result.message);
      if (result.ok && result.circleId) {
        setCircles((current) => [
          ...current,
          { id: result.circleId!, name, memberIds: targetId ? [targetId] : [] }
        ]);
      }
    });
  }

  function addToCircle(user: UserSummary, circleId: string) {
    const alreadyIn = circles.find((circle) => circle.id === circleId)?.memberIds.includes(user.id);
    if (alreadyIn) return;
    setCircles((current) =>
      current.map((circle) =>
        circle.id === circleId
          ? { ...circle, memberIds: [...circle.memberIds, user.id] }
          : circle
      )
    );
    const circleName = circles.find((circle) => circle.id === circleId)?.name;
    startTransition(async () => {
      const result = await addCircleMembersAction(circleId, [user.id]);
      setFeedback(result.ok ? `${user.displayName} added to ${circleName}.` : result.message);
      if (!result.ok) {
        setCircles((current) =>
          current.map((circle) =>
            circle.id === circleId
              ? { ...circle, memberIds: circle.memberIds.filter((id) => id !== user.id) }
              : circle
          )
        );
      }
    });
  }

  // Shared row renderer so the "Active now" and "All Muddies" sections render
  // identical cards without duplicating the (many) action closures.
  const renderUserRow = (user: UserSummary) => (
    <UserRow
      key={user.id}
      user={user}
      proximity={proximityByFriendId[user.id]}
      isCloseFriend={closeFriendIds.includes(user.id)}
      circles={circles}
      onViewProfile={() => setProfileUser(user)}
      onWave={() => {
        startTransition(async () => {
          const result = await sendWaveV2Action(user.id, "proximity_card");
          setFeedback(result.message);
        });
      }}
      onMessage={() => router.push("/messages")}
      onRemove={() =>
        runFriendAction(
          () => removeFriendAction(user.id),
          () => removeUser(user.id, `${user.displayName} was removed.`)
        )
      }
      onBlock={() =>
        runFriendAction(
          () => blockUserAction(user.id),
          () => updateUserStatus(user.id, "blocked", `${user.displayName} is blocked.`)
        )
      }
      onReport={() => setReportUser(user)}
      onToggleCloseFriend={() => toggleCloseFriend(user)}
      onAddToCircle={(circleId) => addToCircle(user, circleId)}
      onCreateCircle={() => {
        setCircleTargetUser(user);
        setCreateCircleOpen(true);
      }}
    />
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1200px] space-y-6 overflow-x-clip pt-6">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-sm leading-6 text-muted-foreground">Your people, your circles, and quick ways to connect.</p>
        <Button type="button" className="shrink-0 whitespace-nowrap" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Muddy
        </Button>
      </header>

      <nav className="max-w-full overflow-x-auto border-b border-border/70" aria-label="Muddies tabs">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                "focus-ring safe-motion border-b-2 px-4 py-3 text-sm font-medium",
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              onClick={() => {
                setActiveTab(tab.id);
                setActiveCircleId(null);
                setQuery("");
                setFeedback("");
                if (tab.id === "requests") router.refresh();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">{feedback}</p>
      ) : null}


      {activeTab === "all" || activeTab === "close" || (activeTab === "circles" && activeCircleId) ? (
        <div className="space-y-4">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Muddies"
              className="pl-9"
              aria-label="Search Muddies"
            />
          </div>

          {activeTab === "circles" && activeCircleId ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveCircleId(null)}>
              ← All circles
            </Button>
          ) : null}

          {visibleFriendUsers.length > 0 ? (
            activeFriends.length > 0 ? (
              // Active-first layout: nearby/visible Muddies surface under
              // "Active now"; everyone else stays reachable under "All Muddies".
              <div className="space-y-6">
                <section>
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="text-base font-semibold tracking-tight">Active now</h2>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {activeFriends.length} active
                    </span>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">{activeFriends.map(renderUserRow)}</div>
                </section>

                {inactiveFriends.length > 0 ? (
                  <section>
                    <h2 className="mb-3 text-base font-semibold tracking-tight">All Muddies</h2>
                    <div className="grid gap-3 lg:grid-cols-2">{inactiveFriends.map(renderUserRow)}</div>
                  </section>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">{visibleFriendUsers.map(renderUserRow)}</div>
            )
          ) : (
            <FriendsEmptyState
              activeTab={activeTab}
              hasQuery={Boolean(query.trim())}
              onAddFriends={() => setAddOpen(true)}
            />
          )}
        </div>
      ) : null}

      {activeTab === "circles" && !activeCircleId ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {circles.map((circle) => (
            <button
              key={circle.id}
              type="button"
              onClick={() => setActiveCircleId(circle.id)}
              className="focus-ring safe-motion rounded-2xl border border-border/80 bg-card/60 p-5 text-left hover:bg-secondary/40"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <Users className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-base font-semibold">{circle.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {circle.memberIds.length} {circle.memberIds.length === 1 ? "member" : "members"}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCreateCircleOpen(true)}
            className="focus-ring safe-motion flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 p-5 text-center text-sm text-muted-foreground hover:bg-secondary/40"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            New Circle
          </button>
        </div>
      ) : null}

      {activeTab === "requests" ? (
        <div className="space-y-4">
          <div className="flex gap-1">
            <Button type="button" size="sm" variant={requestSubTab === "received" ? "secondary" : "ghost"} onClick={() => setRequestSubTab("received")}>
              Received
            </Button>
            <Button type="button" size="sm" variant={requestSubTab === "sent" ? "secondary" : "ghost"} onClick={() => setRequestSubTab("sent")}>
              Sent
            </Button>
          </div>

          {requestUsers.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {requestUsers.map((user) => (
                <RequestCard
                  key={user.id}
                  user={user}
                  kind={requestSubTab}
                  onAccept={() =>
                    runFriendAction(
                      () => acceptFriendRequestAction(user.requestId ?? user.id),
                      () => promoteUserToFriend(user.id, `${user.displayName} is now your friend.`)
                    )
                  }
                  onDecline={() =>
                    runFriendAction(
                      () => updateFriendRequestStatusAction(user.requestId ?? user.id, "declined"),
                      () => removeUser(user.id, `${user.displayName}'s request was declined.`)
                    )
                  }
                  onCancel={() =>
                    runFriendAction(
                      () => updateFriendRequestStatusAction(user.requestId ?? user.id, "cancelled"),
                      () => removeUser(user.id, `Request to ${user.displayName} was cancelled.`)
                    )
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Search}
              className="!min-h-0 !shadow-none p-5"
              title={requestSubTab === "received" ? "No new requests" : "No pending requests"}
              description={requestSubTab === "received" ? "New friend requests will appear here." : "Requests you send will appear here."}
            />
          )}
        </div>
      ) : null}

      {activeTab === "blocked" ? (
        blockedUsers.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {blockedUsers.map((user) => (
              <Card key={user.id} className="p-5">
                <div className="flex items-center gap-4">
                  <InitialsAvatar name={user.displayName} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{user.displayName}</h3>
                    <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      runFriendAction(
                        () => unblockUserAction(user.id),
                        () => updateUserStatus(user.id, "available", `${user.displayName} is unblocked.`)
                      )
                    }
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Unblock
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Ban}
            className="!min-h-0 !shadow-none p-5"
            title="No blocked users"
            description="People you block will appear here."
          />
        )
      ) : null}

      <AddMuddyModal
        open={addOpen}
        onOpenChange={setAddOpen}
        query={addQuery}
        onQueryChange={(value) => {
          setAddQuery(value);
          setFeedback("");
          setHasSearched(false);
        }}
        onSearch={searchUsers}
        results={users.filter((user) => user.status === "available")}
        hasSearched={hasSearched}
        isPending={isPending}
        feedback={feedback}
        onRequest={(user) =>
          runFriendAction(
            () => sendFriendRequestAction(user.id),
            () => updateUserStatus(user.id, "sent", `Muddy request sent to ${user.displayName}.`)
          )
        }
      />

      <ReportModal
        user={reportUser}
        onOpenChange={(open) => {
          if (!open) {
            setReportUser(null);
            setReportDescription("");
          }
        }}
        description={reportDescription}
        onDescriptionChange={setReportDescription}
        onSubmit={() => {
          if (reportUser) {
            runFriendAction(
              () =>
                reportUserAction({
                  targetUserId: reportUser.id,
                  reason: "user_report",
                  description: reportDescription
                }),
              () => setFeedback(`Report submitted for ${reportUser.displayName}.`)
            );
          }
          setReportUser(null);
          setReportDescription("");
        }}
      />

      <Modal
        open={createCircleOpen}
        onOpenChange={(open) => {
          setCreateCircleOpen(open);
          if (!open) {
            setNewCircleName("");
            setCircleTargetUser(null);
          }
        }}
        title="New Circle"
        description="Group Muddies together to filter your list and control who sees your Glow."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreateCircleOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={createCircle} disabled={!newCircleName.trim()}>
              Create Circle
            </Button>
          </>
        }
      >
        <Input
          value={newCircleName}
          onChange={(event) => setNewCircleName(event.target.value)}
          placeholder="e.g. Weekend Crew"
          aria-label="Circle name"
        />
      </Modal>

      <MuddyProfileModal
        muddy={
          profileUser
            ? {
                friendId: profileUser.id,
                displayName: profileUser.displayName,
                username: profileUser.username,
                about: profileUser.note,
                mutualMuddies: profileUser.mutualFriends,
                proximityLevel: proximityByFriendId[profileUser.id]?.proximityLevel,
                glowStrength: proximityByFriendId[profileUser.id]?.glowStrength,
                confidence: proximityByFriendId[profileUser.id]?.confidence
              }
            : null
        }
        onOpenChange={(open) => {
          if (!open) setProfileUser(null);
        }}
        onSendPing={(message) => {
          if (!profileUser) return;
          startTransition(async () => {
            const result = await createMeetupRequestAction({ receiverId: profileUser.id, message });
            setFeedback(result.message);
          });
        }}
      />
    </div>
  );
}

function FriendsEmptyState({
  activeTab,
  hasQuery,
  onAddFriends
}: {
  activeTab: FriendTab;
  hasQuery: boolean;
  onAddFriends: () => void;
}) {
  if (hasQuery) {
    return (
      <EmptyState
        icon={Search}
        className="!min-h-0 !shadow-none p-5"
        title="No matches"
        description="Try another name or username."
      />
    );
  }

  const copy: Record<string, { title: string; description: string }> = {
    all: { title: "No Muddies yet", description: "Add approved Muddies to see when they’re nearby." },
    close: { title: "No Close Friends yet", description: "Mark a Muddy as a Close Friend from their card menu." },
    circles: { title: "No one in this circle yet", description: "Add Muddies to this circle from their card menu." }
  };
  const item = copy[activeTab] ?? copy.all;

  return (
    <EmptyState
      icon={UserPlus}
      className="!min-h-0 !shadow-none p-5"
      title={item.title}
      description={item.description}
      action={
        activeTab === "all" ? (
          <Button type="button" onClick={onAddFriends}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add Muddies
          </Button>
        ) : undefined
      }
    />
  );
}

type UserRowProps = {
  user: UserSummary;
  proximity?: ProximityInfo;
  isCloseFriend: boolean;
  circles: Circle[];
  onViewProfile: () => void;
  onWave: () => void;
  onMessage: () => void;
  onRemove: () => void;
  onBlock: () => void;
  onReport: () => void;
  onToggleCloseFriend: () => void;
  onAddToCircle: (circleId: string) => void;
  onCreateCircle: () => void;
};

function UserRow({
  user,
  proximity,
  isCloseFriend,
  circles,
  onViewProfile,
  onWave,
  onMessage,
  onRemove,
  onBlock,
  onReport,
  onToggleCloseFriend,
  onAddToCircle,
  onCreateCircle
}: UserRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const level = proximity?.proximityLevel ?? "far";
  const otherCircles = circles.filter((circle) => circle.id !== "close-friends");

  return (
    <Card className="min-w-0 overflow-hidden p-4">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 sm:flex sm:gap-4">
        <button type="button" onClick={onViewProfile} className="focus-ring safe-motion shrink-0 rounded-full">
          <GlowAvatar
            name={user.displayName}
            proximityLevel={level}
            glowStrength={proximity?.glowStrength ?? 0}
            confidence={proximity?.confidence ?? "low"}
            size="md"
          />
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onViewProfile} className="focus-ring block max-w-full truncate rounded text-left font-semibold hover:underline">
            {user.displayName}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{proximityLabels[level]}</span>
            {isCloseFriend ? <Badge variant="orange">Close Friend</Badge> : null}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{user.note}</p>
        </div>
        <div className="col-span-2 -mx-4 -mb-4 mt-1 grid min-w-0 grid-cols-3 border-t border-border/70 sm:col-auto sm:m-0 sm:flex sm:shrink-0 sm:items-center sm:gap-1.5 sm:border-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Wave"
            title="Wave"
            onClick={onWave}
            className="h-12 w-full gap-2 rounded-none border-0 shadow-none hover:translate-y-0 sm:h-10 sm:w-10 sm:rounded-full sm:border sm:border-border sm:bg-card/60"
          >
            <Hand className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs sm:sr-only">Wave</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Message"
            title="Message"
            onClick={onMessage}
            className="h-12 w-full gap-2 rounded-none border-x border-y-0 border-border/70 shadow-none hover:translate-y-0 sm:h-10 sm:w-10 sm:rounded-full sm:border sm:border-border sm:bg-card/60"
          >
            <MessagesSquare className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs sm:sr-only">Message</span>
          </Button>
          <AppMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            label={`Actions for ${user.displayName}`}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="More"
                title="More"
                className="h-12 w-full gap-2 rounded-none border-0 shadow-none hover:translate-y-0 sm:h-10 sm:w-10 sm:rounded-full sm:border sm:border-border sm:bg-card/60"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs sm:sr-only">More</span>
              </Button>
            }
            items={[
              { id: "close-friend", label: isCloseFriend ? "Remove from Close Friends" : "Add to Close Friends", onSelect: onToggleCloseFriend },
              ...otherCircles.map((circle) => ({ id: `circle-${circle.id}`, label: `Add to ${circle.name}`, onSelect: () => onAddToCircle(circle.id) })),
              { id: "new-circle", label: "Add to new circle", onSelect: onCreateCircle },
              { id: "remove", label: "Remove Muddy", icon: <UserMinus className="h-4 w-4" />, destructive: true, separatorBefore: true, onSelect: onRemove },
              { id: "block", label: "Block", icon: <Ban className="h-4 w-4" />, destructive: true, onSelect: onBlock },
              { id: "report", label: "Report", icon: <Flag className="h-4 w-4" />, onSelect: onReport }
            ]}
          />
        </div>
      </div>
    </Card>
  );
}

function RequestCard({
  user,
  kind,
  onAccept,
  onDecline,
  onCancel
}: {
  user: UserSummary;
  kind: "received" | "sent";
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <InitialsAvatar name={user.displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{user.displayName}</h3>
            <Badge variant={kind === "received" ? "violet" : "warning"}>{kind === "received" ? "Incoming" : "Pending"}</Badge>
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">@{user.username}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{user.note}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {kind === "received" ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onAccept}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Accept
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDecline}>
              <X className="h-4 w-4" aria-hidden="true" />
              Decline
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" disabled>
              <Clock className="h-4 w-4" aria-hidden="true" />
              Pending
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function AddMuddyModal({
  open,
  onOpenChange,
  query,
  onQueryChange,
  onSearch,
  results,
  hasSearched,
  isPending,
  feedback,
  onRequest
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  results: UserSummary[];
  hasSearched: boolean;
  isPending: boolean;
  feedback: string;
  onRequest: (user: UserSummary) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add a Muddy" description="Search by username to send a request.">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search by username"
            className="pl-9"
            aria-label="Search by username"
            disabled={isPending}
          />
        </div>
        <Button type="submit" disabled={isPending || query.trim().length < 2}>
          Search
        </Button>
      </form>

      {feedback ? <p className="mt-3 text-sm text-muted-foreground">{feedback}</p> : null}

      <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
        {results.length > 0
          ? results.map((user) => (
              <div key={user.id} className="flex items-center gap-3 rounded-lg border border-border/70 p-3">
                <InitialsAvatar name={user.displayName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{user.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                </div>
                <Button type="button" size="sm" onClick={() => onRequest(user)}>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Send request
                </Button>
              </div>
            ))
          : hasSearched && !isPending
            ? <p className="py-4 text-center text-sm text-muted-foreground">No matches found.</p>
            : null}
      </div>
    </Modal>
  );
}

function ReportModal({
  user,
  onOpenChange,
  description,
  onDescriptionChange,
  onSubmit
}: {
  user: UserSummary | null;
  onOpenChange: (open: boolean) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      open={Boolean(user)}
      onOpenChange={onOpenChange}
      title="Report user"
      description={user ? `Tell us what happened with ${user.displayName}.` : undefined}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={onSubmit}>
            Submit report
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          placeholder="Describe the issue."
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </div>
    </Modal>
  );
}

function InitialsAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-300 to-amber-500 text-sm font-bold text-slate-950",
        size === "sm" ? "h-10 w-10" : "h-12 w-12"
      )}
    >
      {name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)}
    </div>
  );
}

"use client";

import {
  Ban,
  Check,
  Clock,
  EyeOff,
  Flag,
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
import { AppMenu } from "@/components/ui/app-dropdown";
import { Button } from "@/components/ui/button";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { MuddyProfileModal } from "@/components/glow/muddy-profile-modal";
import { Textarea } from "@/components/ui/textarea";
import { proximityLabels, type ConfidenceLevel, type ProximityLevel } from "@/lib/proximity";
import { cn } from "@/lib/utils";
import { fetchWithTimeout } from "@/lib/network/resilience";
import { TOUR_TARGET_IDS } from "@/lib/tours/registry";
import { PremiumPlanBadge } from "@/components/premium/premium-plan-badge";
import { publicMembershipTier } from "@/lib/billing/premium-identity";
import type { SubscriptionPlan } from "@/lib/supabase/database.types";

type FriendTab = "all" | "circles" | "close" | "requests" | "blocked";

export type UserSummary = {
  id: string;
  requestId?: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  mutualFriends: number;
  status: "friend" | "available" | "received" | "sent" | "blocked";
  note: string;
  plan: SubscriptionPlan;
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
  initialCloseFriendIds = [],
  glowColorByFriendId = {}
}: {
  initialUsers?: UserSummary[];
  initialCircles?: InitialCircle[];
  initialCloseFriendIds?: string[];
  /** friendId → custom glow palette id (custom_glow_styles entitlement). */
  glowColorByFriendId?: Record<string, string>;
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
        const response = await fetchWithTimeout(
          "/api/friends/nearby",
          { credentials: "include", cache: "no-store" },
          12_000,
          "load Muddy proximity"
        );
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
  // a Muddy counts as active only when their live proximity is close, near or
  // far (within the 15km nearby range). Active Muddies are ordered by
  // proximity priority then name; inactive Muddies fall back to alphabetical
  // since no live sort exists.
  const { activeFriends, inactiveFriends } = useMemo(() => {
    const active: UserSummary[] = [];
    const inactive: UserSummary[] = [];
    for (const user of visibleFriendUsers) {
      const level = proximityByFriendId[user.id]?.proximityLevel;
      if (level === "close" || level === "near" || level === "far") {
        active.push(user);
      } else {
        inactive.push(user);
      }
    }
    const proximityRank = (user: UserSummary) => {
      const level = proximityByFriendId[user.id]?.proximityLevel;
      return level === "close" ? 0 : level === "near" ? 1 : 2;
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
    <MuddyRow
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

  const receivedRequestCount = useMemo(
    () => users.filter((user) => user.status === "received").length,
    [users]
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1200px] space-y-4 overflow-x-clip pt-5">
      <header className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-muted-foreground">Your Muddies, all in one place.</p>
        <Button data-tour-id={TOUR_TARGET_IDS.MUDDIES_ADD} type="button" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Muddy
        </Button>
      </header>

      {/* Scrollable tab bar. The extra end padding + no-scrollbar utility stop
          the last tab (Blocked) from clipping on narrow screens. */}
      <nav data-tour-id={TOUR_TARGET_IDS.MUDDIES_TABS} className="no-scrollbar -mx-4 max-w-[calc(100%+2rem)] overflow-x-auto border-b border-border/70 px-4 sm:mx-0 sm:max-w-full sm:px-0" aria-label="Muddies tabs">
        <div className="flex w-max gap-1 pr-4 sm:pr-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-current={activeTab === tab.id ? "page" : undefined}
              className={cn(
                "focus-ring safe-motion inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium",
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
              {tab.id === "requests" && receivedRequestCount > 0 ? (
                <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold leading-none text-primary-foreground">
                  {receivedRequestCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {feedback ? (
        <p className="text-sm text-muted-foreground" role="status">{feedback}</p>
      ) : null}


      {activeTab === "all" || activeTab === "close" || (activeTab === "circles" && activeCircleId) ? (
        <div data-tour-id={TOUR_TARGET_IDS.MUDDIES_LIST} className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
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
              <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => setActiveCircleId(null)}>
                ← All circles
              </Button>
            ) : null}
          </div>

          {visibleFriendUsers.length > 0 ? (
            (() => {
              const showActive = activeFriends.length > 0 && activeTab !== "close";
              const listUsers = showActive ? inactiveFriends : visibleFriendUsers;
              return (
                <div className="space-y-5">
                  {/* Active-first: a compact, lively people strip for anyone
                      glowing right now. */}
                  {showActive ? (
                    <ActiveNowStrip
                      friends={activeFriends}
                      proximityByFriendId={proximityByFriendId}
                      onSelect={setProfileUser}
                    />
                  ) : null}

                  {listUsers.length > 0 ? (
                    <section>
                      {showActive ? (
                        <h2 className="mb-1 text-sm font-semibold text-muted-foreground">All Muddies</h2>
                      ) : null}
                      <ul className="divide-y divide-border/60">{listUsers.map(renderUserRow)}</ul>
                    </section>
                  ) : null}
                </div>
              );
            })()
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
            <ul className="divide-y divide-border/60">
              {requestUsers.map((user) => (
                <RequestRow
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
            </ul>
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
          <ul className="divide-y divide-border/60">
            {blockedUsers.map((user) => (
              <li key={user.id} className="flex items-center gap-3 py-3">
                <InitialsAvatar name={user.displayName} src={user.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{user.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{user.username}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
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
              </li>
            ))}
          </ul>
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
        onOpenChange={(next) => {
          setAddOpen(next);
          if (!next) {
            // Closing (X, backdrop, Escape, or after a successful send) always
            // clears the search, so reopening later never shows a stale query
            // or result list from a previous visit.
            setAddQuery("");
            setHasSearched(false);
          }
        }}
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
            () => {
              updateUserStatus(user.id, "sent", `Muddy request sent to ${user.displayName}.`);
              setAddOpen(false);
              setAddQuery("");
              setHasSearched(false);
            }
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
                avatarUrl: profileUser.avatarUrl,
                statusText: profileUser.note,
                mutualMuddies: profileUser.mutualFriends,
                proximityLevel: proximityByFriendId[profileUser.id]?.proximityLevel,
                glowStrength: proximityByFriendId[profileUser.id]?.glowStrength,
                confidence: proximityByFriendId[profileUser.id]?.confidence,
                glowColorId: glowColorByFriendId[profileUser.id] ?? null,
                plan: profileUser.plan
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

/** Colour for the secondary proximity line — active states read as "alive",
 *  inactive/hidden stay muted. Never conveys distance, only the bucket. */
const PROXIMITY_TEXT_CLASS: Partial<Record<ProximityLevel, string>> = {
  close: "text-primary",
  near: "text-violet-600 dark:text-violet-300",
  far: "text-blue-600 dark:text-blue-300"
};

/** Same palette, as a ring colour. On this page's compact rows the animated
 *  glow halo reads as noise against the row's own borders/dividers at this
 *  size, so avatars here use a plain solid outline in the proximity colour
 *  instead — same information, easier to read at a glance. */
const PROXIMITY_RING_CLASS: Partial<Record<ProximityLevel, string>> = {
  close: "ring-primary",
  near: "ring-violet-500",
  far: "ring-blue-500"
};

function isActiveLevel(level: ProximityLevel): boolean {
  return level === "close" || level === "near" || level === "far";
}

/** ring-2 + offset in the proximity colour when glowing; no ring otherwise. */
function proximityRingClassName(level: ProximityLevel): string | undefined {
  if (!isActiveLevel(level)) return undefined;
  return cn("ring-2 ring-offset-2 ring-offset-background", PROXIMITY_RING_CLASS[level] ?? "ring-primary");
}

/** A small presence marker on the avatar: eye-off when hidden, a live dot when
 *  glowing, nothing when simply not glowing. Not colour-only — the icon/shape
 *  and the text label both carry the state. */
function PresenceDot({ level }: { level: ProximityLevel }) {
  if (level === "hidden") {
    return (
      <span
        className="absolute -bottom-0.5 -right-0.5 z-[2] grid h-4 w-4 place-items-center rounded-full border-2 border-background bg-secondary text-muted-foreground"
        aria-hidden="true"
      >
        <EyeOff className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (isActiveLevel(level)) {
    return (
      <span
        className="absolute bottom-0 right-0 z-[2] h-3 w-3 rounded-full border-2 border-background bg-emerald-500"
        aria-hidden="true"
      />
    );
  }
  return null;
}

function MuddyRow({
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
  // Missing proximity is not the Far bucket. Far now means a real, in-range
  // 10–15km signal; absent data must remain inactive/hidden.
  const level = proximity?.proximityLevel ?? "hidden";
  const otherCircles = circles.filter((circle) => circle.id !== "close-friends");
  const statusClass = PROXIMITY_TEXT_CLASS[level] ?? "text-muted-foreground";

  return (
    <li className="flex items-center gap-3 py-2.5">
      <button
        type="button"
        data-tour-id={TOUR_TARGET_IDS.MUDDIES_PROFILE}
        onClick={onViewProfile}
        className="focus-ring safe-motion relative shrink-0 rounded-full"
        aria-label={`${user.displayName}, ${proximityLabels[level]}`}
      >
        <UserAvatar
          name={user.displayName}
          src={user.avatarUrl}
          size="sm"
          decorative
          membershipTier={publicMembershipTier(user.plan)}
          className={proximityRingClassName(level)}
        />
        <PresenceDot level={level} />
      </button>

      <button type="button" onClick={onViewProfile} className="focus-ring min-w-0 flex-1 rounded text-left">
        <span className="flex items-center gap-1.5">
          <span className="block truncate font-medium leading-tight">{user.displayName}</span>
          <PremiumPlanBadge plan={user.plan} compact />
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs leading-tight">
          <span className={cn("truncate", statusClass)}>{proximityLabels[level]}</span>
          {isCloseFriend ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-orange-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-200">
              Close Friend
            </span>
          ) : null}
        </span>
      </button>

      <div className="flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Wave at ${user.displayName}`}
          title="Wave"
          onClick={onWave}
          className="h-11 w-11 rounded-full text-muted-foreground hover:text-foreground"
        >
          <FeatureIcon feature="wave" size={18} decorative />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Message ${user.displayName}`}
          title="Message"
          onClick={onMessage}
          className="h-11 w-11 rounded-full text-muted-foreground hover:text-foreground"
        >
          <MessagesSquare className="h-[18px] w-[18px]" aria-hidden="true" />
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
              aria-label={`More actions for ${user.displayName}`}
              title="More"
              className="h-11 w-11 rounded-full text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
            </Button>
          }
          items={[
            { id: "profile", label: "View profile", onSelect: onViewProfile },
            { id: "close-friend", label: isCloseFriend ? "Remove from Close Friends" : "Add to Close Friends", onSelect: onToggleCloseFriend },
            ...otherCircles.map((circle) => ({ id: `circle-${circle.id}`, label: `Add to ${circle.name}`, onSelect: () => onAddToCircle(circle.id) })),
            { id: "new-circle", label: "Add to new circle", onSelect: onCreateCircle },
            { id: "remove", label: "Remove Muddy", icon: <UserMinus className="h-4 w-4" />, destructive: true, separatorBefore: true, onSelect: onRemove },
            { id: "block", label: "Block", icon: <Ban className="h-4 w-4" />, destructive: true, onSelect: onBlock },
            { id: "report", label: "Report", icon: <Flag className="h-4 w-4" />, onSelect: onReport }
          ]}
        />
      </div>
    </li>
  );
}

/**
 * Compact, lively "Active now" strip: a horizontally scrollable row of glowing
 * avatars for Muddies whose live proximity signal places them nearby. Purely a
 * different presentation of the same friend + proximity data already loaded —
 * no extra fetch. Tapping opens the existing Muddy profile. Never shows exact
 * distance, only the proximity bucket.
 */
function ActiveNowStrip({
  friends,
  proximityByFriendId,
  onSelect
}: {
  friends: UserSummary[];
  proximityByFriendId: Record<string, ProximityInfo>;
  onSelect: (user: UserSummary) => void;
}) {
  return (
    <section aria-labelledby="active-now-heading">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="active-now-heading" className="text-sm font-semibold">
          Active now
        </h2>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
          {friends.length} active
        </span>
      </div>
      <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1 pt-1.5">
        {friends.map((friend) => {
          const proximity = proximityByFriendId[friend.id];
          const level = proximity?.proximityLevel ?? "hidden";
          return (
            <li key={friend.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(friend)}
                className="focus-ring safe-motion flex w-[76px] flex-col items-center gap-1.5 rounded-xl text-center"
                aria-label={`${friend.displayName}, ${proximityLabels[level]}`}
              >
                <span className="relative">
                  <UserAvatar
                    name={friend.displayName}
                    src={friend.avatarUrl}
                    size="md"
                    decorative
                    membershipTier={publicMembershipTier(friend.plan)}
                    className={proximityRingClassName(level)}
                  />
                  <span className="absolute bottom-0.5 right-0.5 z-[2] h-3 w-3 rounded-full border-2 border-background bg-emerald-500" aria-hidden="true" />
                </span>
                <span className="w-full truncate text-xs font-medium">{friend.displayName}</span>
                <span className={cn("w-full truncate text-[11px] font-semibold", PROXIMITY_TEXT_CLASS[level] ?? "text-primary")}>
                  {proximityLabels[level]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RequestRow({
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
    <li className="flex items-center gap-3 py-3">
      <InitialsAvatar name={user.displayName} src={user.avatarUrl} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-medium leading-tight">
          <span className="truncate">{user.displayName}</span>
          <PremiumPlanBadge plan={user.plan} compact />
        </p>
        <p className="truncate text-xs text-muted-foreground">
          @{user.username}
          {user.mutualFriends > 0 ? ` · ${user.mutualFriends} mutual` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {kind === "received" ? (
          <>
            <Button type="button" size="sm" onClick={onAccept}>
              <Check className="h-4 w-4" aria-hidden="true" />
              <span className="hidden min-[380px]:inline">Accept</span>
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label={`Decline ${user.displayName}`} title="Decline" onClick={onDecline}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Pending
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          </>
        )}
      </div>
    </li>
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
                <InitialsAvatar name={user.displayName} src={user.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="truncate">{user.displayName}</span>
                    <PremiumPlanBadge plan={user.plan} compact />
                  </p>
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

function InitialsAvatar({ name, src, size = "md" }: { name: string; src?: string | null; size?: "sm" | "md" }) {
  return (
    <UserAvatar
      name={name}
      src={src}
      size={size === "sm" ? "sm" : "md"}
      className={cn("bg-gradient-to-br from-orange-300 to-amber-500 text-slate-950", size === "md" && "h-12 w-12")}
    />
  );
}

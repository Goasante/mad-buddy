from pathlib import Path

def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected snippet missing in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))

# Pair-wide 30-day breathing room in the canonical candidate authority.
path = "lib/linkr/candidate-service.ts"
replace_once(
    path,
    '''    { data: actions },
    { data: inboundConnects },
    { data: connections },''',
    '''    { data: actions },
    { data: inboundConnects },
    { data: inboundPasses },
    { data: connections },'''
)
replace_once(
    path,
    '''    admin
      .from("linkr_actions")
      .select("actor_id, updated_at")
      .eq("target_id", viewerId)
      .eq("action", "connect")
      .in("actor_id", candidateIds),
    admin
      .from("linkr_connections")''',
    '''    admin
      .from("linkr_actions")
      .select("actor_id, updated_at")
      .eq("target_id", viewerId)
      .eq("action", "connect")
      .in("actor_id", candidateIds),
    // A temporary Pass gives the PAIR breathing room. The person who was
    // passed does not learn why the other profile disappeared; they simply
    // cannot encounter that profile again until the same 30-day window ends.
    admin
      .from("linkr_actions")
      .select("actor_id")
      .eq("target_id", viewerId)
      .eq("action", "pass")
      .not("expires_at", "is", null)
      .gt("expires_at", new Date(nowMs).toISOString())
      .in("actor_id", candidateIds),
    admin
      .from("linkr_connections")'''
)
replace_once(
    path,
    '''  const inboundConnectAt = new Map(
    (inboundConnects ?? []).map((row) => [row.actor_id, row.updated_at])
  );

  const profileByUserId''',
    '''  const inboundConnectAt = new Map(
    (inboundConnects ?? []).map((row) => [row.actor_id, row.updated_at])
  );
  const inboundPassedIds = new Set((inboundPasses ?? []).map((row) => row.actor_id));

  const profileByUserId'''
)
replace_once(
    path,
    '''    const verdict = isCandidateEligible({
      isSelf: id === viewerId,''',
    '''    // Reciprocal 30-day cooldown. This is an eligibility rule, not a
    // ranking penalty: a profile cannot be boosted around somebody's Pass.
    if (inboundPassedIds.has(id)) continue;

    const verdict = isCandidateEligible({
      isSelf: id === viewerId,'''
)

# Pass also retires any older one-sided Connect from the passed person so the
# connection has to be chosen fresh after the cooldown. Connect re-checks the
# reciprocal pass server-side so a stale card cannot bypass the breathing room.
path = "lib/linkr/connection-service.ts"
replace_once(
    path,
    '''  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  return { ok: true, message: "" };
}

/**
 * Connect: private interest,''',
    '''  if (error) return { ok: false, message: "Couldn't do that. Try again." };

  // Passing is a consent boundary, not just a feed preference. Quietly retire
  // an older one-sided Connect from the person who was passed. After the
  // cooldown they may encounter this user again, but must choose them again.
  // There is deliberately no notification or observable rejection state.
  await admin
    .from("linkr_actions")
    .delete()
    .eq("actor_id", targetId)
    .eq("target_id", viewerId)
    .eq("action", "connect");

  return { ok: true, message: "" };
}

/**
 * Connect: private interest,'''
)
replace_once(
    path,
    '''  // Blocks win, and they win before anything is written.
  if (await isBlockedEitherDirection(admin, viewerId, targetId)) {
    // Deliberately indistinguishable from an ordinary success. Telling the
    // caller "you are blocked" would turn Connect into a block detector.
    return { ok: true, matched: false, message: "" };
  }

  // The card is a snapshot. Re-check non-negotiable eligibility immediately''',
    '''  // Blocks win, and they win before anything is written.
  if (await isBlockedEitherDirection(admin, viewerId, targetId)) {
    // Deliberately indistinguishable from an ordinary success. Telling the
    // caller "you are blocked" would turn Connect into a block detector.
    return { ok: true, matched: false, message: "" };
  }

  // A pass made after this card was loaded must also win. The neutral success
  // response preserves the same privacy property as blocks: Connect cannot be
  // used to discover that the other person passed.
  const { data: reciprocalPass } = await admin
    .from("linkr_actions")
    .select("id")
    .eq("actor_id", targetId)
    .eq("target_id", viewerId)
    .eq("action", "pass")
    .not("expires_at", "is", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (reciprocalPass) return { ok: true, matched: false, message: "" };

  // The card is a snapshot. Re-check non-negotiable eligibility immediately'''
)

# Admin review should immediately become visibly reviewed without a manual refresh.
path = "components/admin/support/linkr-reversal-review.tsx"
replace_once(
    path,
    '''  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");''',
    '''  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [isReviewed, setIsReviewed] = useState(reviewed);'''
)
replace_once(
    path,
    '''      const result = await reviewLinkrPassReversalAction({ ticketId, decision });
      setFeedback(result.message);''',
    '''      const result = await reviewLinkrPassReversalAction({ ticketId, decision });
      setFeedback(result.message);
      if (result.ok) setIsReviewed(true);'''
)
replace_once(path, "          {!reviewed ? (", "          {!isReviewed ? (")

# Keep the historical architecture note honest about the reviewed extension.
path = "docs/linkr-tranche-2-architecture.md"
replace_once(
    path,
    '''Written **before** any lifecycle change, per the tranche brief. Records what
already exists so this work extends single authorities instead of creating
second ones.
''',
    '''Written **before** any lifecycle change, per the tranche brief. Records what
already exists so this work extends single authorities instead of creating
second ones.

> **22 September 2026 final-review update.** The authorities below remain the
> authorities. Two privacy-preserving behaviours were subsequently added inside
> them: `candidate-service.ts` may read incoming one-sided Connects only as a
> server-side, decaying ranking nudge (never as client-visible state), and an
> active temporary Pass suppresses the pair in both discovery directions for
> the same 30-day window. `connectWithCandidate` re-checks that reciprocal Pass
> against stale cards, and making a Pass quietly retires any older one-sided
> Connect from the passed person so a future connection requires a fresh choice.
> Ordinary Pass undo is limited to three per server day; further immediate undo
> attempts create a deduplicated support-review ticket. None of these behaviours
> turn a Linkr connection into a Muddy friendship.
'''
)

# Extend the permanent final-review regression suite.
path = "lib/linkr/final-architecture-review.test.ts"
replace_once(
    path,
    '''  it("keeps Linkr matches separate from Muddy friendships", () => {''',
    '''  it("makes a temporary pass a private pair-wide 30-day breathing room", () => {
    const candidates = read("lib/linkr/candidate-service.ts");
    const service = read("lib/linkr/connection-service.ts");
    expect(candidates).toContain("inboundPassedIds");
    expect(candidates).toContain("if (inboundPassedIds.has(id)) continue");
    expect(service).toContain("reciprocalPass");
    expect(service).toContain('.eq("actor_id", targetId)');
    expect(service).toContain('.eq("target_id", viewerId)');
    expect(service).toContain('.eq("action", "connect")');
  });

  it("keeps Linkr matches separate from Muddy friendships", () => {'''
)
replace_once(
    path,
    '''  it("does not route old Socialize through a second Linkr authority", () => {''',
    '''  it("marks an admin rewind review complete in the client after success", () => {
    const review = read("components/admin/support/linkr-reversal-review.tsx");
    expect(review).toContain("const [isReviewed, setIsReviewed] = useState(reviewed)");
    expect(review).toContain("if (result.ok) setIsReviewed(true)");
    expect(review).toContain("{!isReviewed ? (");
  });

  it("does not route old Socialize through a second Linkr authority", () => {'''
)

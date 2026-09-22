from pathlib import Path

def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected snippet missing in {path}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))

# ---------------------------------------------------------------------------
# Rewind support review must be an explicit user choice, not a side effect of
# pressing Undo after the quota is exhausted.
# ---------------------------------------------------------------------------
path = "lib/linkr/connection-service.ts"
p = Path(path)
text = p.read_text()
if 'import { z } from "zod";' not in text:
    text = text.replace('import "server-only";\n\n', 'import "server-only";\n\nimport { z } from "zod";\n')

# Update the privacy comment now that the final reviewed architecture has two
# narrow server-only reads of the other side: ranking and reciprocal Pass.
text = text.replace(
''' * Reciprocity is resolved by `linkr_record_connect`, a SECURITY DEFINER
 * function which is the only thing permitted to read both sides of
 * linkr_actions. This module never queries the other person's actions itself,
 * so there is no code path here that could leak the answer even by timing.
 */''',
''' * Reciprocity itself is resolved by `linkr_record_connect`, a SECURITY
 * DEFINER function. Application code never exposes the other person's action.
 * The only reviewed server-side exceptions are (1) candidate ranking's
 * decaying, non-rendered reciprocity nudge and (2) the reciprocal temporary
 * Pass check that enforces the pair-wide cooldown. Neither fact crosses the
 * wire or changes the neutral response shown to the other person.
 */''')

start = text.index("async function requestPassReversalReview(")
end = text.index("/**\n * Undo the most recent decision", start)
new_review = '''export async function requestLinkrPassReversalReview(
  viewerId: string,
  targetId: string
): Promise<{ ok: boolean; message: string }> {
  if (!serverReady()) return { ok: false, message: "This action needs the server database configuration." };
  if (!z.string().uuid().safeParse(targetId).success || viewerId === targetId) {
    return { ok: false, message: "That pass is no longer available for review." };
  }

  const admin = createSupabaseAdminClient();
  const guard = await guardAction(admin, { userId: viewerId, surface: "linkr" });
  if (!guard.allowed) return { ok: false, message: guard.message };

  // The user may escalate only an ACTIVE ordinary Pass of their own. Permanent
  // hides are intentionally not turned into a staff-managed recovery queue.
  const { data: pass, error: passError } = await admin
    .from("linkr_actions")
    .select("id, expires_at")
    .eq("actor_id", viewerId)
    .eq("target_id", targetId)
    .eq("action", "pass")
    .not("expires_at", "is", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (passError || !pass?.expires_at) {
    return { ok: false, message: "That pass is no longer available for review." };
  }

  // Server-authoritative quota check. A crafted call cannot skip the three
  // self-service rewinds and jump straight into the support queue.
  const { data: rewindWindow } = await admin
    .from("rate_limits")
    .select("count, window_end")
    .eq("user_id", viewerId)
    .eq("action", "linkr.undo")
    .gt("window_end", new Date().toISOString())
    .order("window_end", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rewindWindow || rewindWindow.count < DAILY_SELF_SERVICE_PASS_REWINDS) {
    return { ok: false, message: "Use your available Linkr rewinds first." };
  }

  // Dedupe before consuming the support limiter. Repeated taps cannot fill the
  // queue with identical tickets for the same pass.
  const { data: openTickets } = await admin
    .from("support_tickets")
    .select("id, diagnostics, status")
    .eq("user_id", viewerId)
    .eq("category", "muddies")
    .not("status", "in", "(resolved,closed)")
    .order("created_at", { ascending: false })
    .limit(20);

  const alreadyOpen = (openTickets ?? []).some((ticket) => {
    const diagnostics = ticket.diagnostics;
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return false;
    const record = diagnostics as Record<string, unknown>;
    return record.workflow === "linkr_pass_reversal" && record.target_user_id === targetId;
  });
  if (alreadyOpen) {
    return { ok: true, message: "This pass is already waiting for Mad Buddy support review." };
  }

  const supportLimit = await consumeRateLimit({ action: "support.request", userId: viewerId });
  if (!supportLimit.allowed) return { ok: false, message: rateLimitMessage(supportLimit.resetAt) };

  const { error } = await admin.from("support_tickets").insert({
    user_id: viewerId,
    category: "muddies",
    subject: "Linkr rewind request",
    description: "I used my three self-service Linkr rewinds and want to restore the most recent profile I passed.",
    priority: "normal",
    status: "new",
    diagnostics: {
      affected_feature: "linkr",
      workflow: "linkr_pass_reversal",
      target_user_id: targetId,
      pass_expires_at: pass.expires_at,
      source: "linkr_v2"
    } as never
  });

  return error
    ? { ok: false, message: "Support review could not be requested just now — try again." }
    : { ok: true, message: "Sent to Mad Buddy support for review." };
}

'''
text = text[:start] + new_review + text[end:]
text = text.replace(
'''export async function undoLastLinkrAction(
  viewerId: string
): Promise<{ ok: boolean; message: string; restoredUserId?: string }> {''',
'''export async function undoLastLinkrAction(
  viewerId: string
): Promise<{
  ok: boolean;
  message: string;
  restoredUserId?: string;
  remaining?: number;
  code?: "review_available";
  reviewTargetId?: string;
}> {''')
text = text.replace(
'''    if (!rewind.allowed) {
      return {
        ok: false,
        message: await requestPassReversalReview(
          admin,
          viewerId,
          last.target_id,
          last.expires_at as string
        )
      };
    }''',
'''    if (!rewind.allowed) {
      return {
        ok: false,
        message: "You've used today's 3 Linkr rewinds. You can ask Mad Buddy support to review this pass.",
        code: "review_available",
        reviewTargetId: last.target_id
      };
    }''')
text = text.replace(
'''    restoredUserId: last.target_id
  };
}''',
'''    restoredUserId: last.target_id,
    remaining: rewindRemaining
  };
}''',
1)
p.write_text(text)

# ---------------------------------------------------------------------------
# Authenticated server action for the explicit support request.
# ---------------------------------------------------------------------------
path = "app/(app)/linkr-actions.ts"
replace_once(
    path,
    '''  passCandidate,
  undoLastLinkrAction,
  type ConnectResult''',
    '''  passCandidate,
  requestLinkrPassReversalReview,
  undoLastLinkrAction,
  type ConnectResult'''
)
replace_once(
    path,
    '''export async function undoLinkrActionAction(): Promise<{
  ok: boolean;
  message: string;
  restoredUserId?: string;
}> {''',
    '''export async function undoLinkrActionAction(): Promise<{
  ok: boolean;
  message: string;
  restoredUserId?: string;
  remaining?: number;
  code?: "review_available";
  reviewTargetId?: string;
}> {'''
)
replace_once(
    path,
    '''  return undoLastLinkrAction(userId);
}

export async function endLinkrConnectionAction''',
    '''  return undoLastLinkrAction(userId);
}

export async function requestLinkrPassReversalReviewAction(targetId: string): Promise<LinkrActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return NOT_LOGGED_IN;
  return requestLinkrPassReversalReview(userId, targetId);
}

export async function endLinkrConnectionAction'''
)

# ---------------------------------------------------------------------------
# CandidateCard: explicit Ask support affordance, separate from Undo.
# ---------------------------------------------------------------------------
path = "components/linkr/candidate-card.tsx"
replace_once(
    path,
    '''  onUndo?: () => void;
  canUndo?: boolean;
  busy?: boolean;''',
    '''  onUndo?: () => void;
  canUndo?: boolean;
  onRequestReview?: () => void;
  canRequestReview?: boolean;
  busy?: boolean;'''
)
replace_once(
    path,
    '''  onUndo,
  canUndo = false,
  busy = false''',
    '''  onUndo,
  canUndo = false,
  onRequestReview,
  canRequestReview = false,
  busy = false'''
)
replace_once(
    path,
    '''        {canUndo ? (
          <button
            type="button"
            className="linkr-action linkr-action--undo"
            onClick={onUndo}
            disabled={busy || Boolean(leaving)}
          >
            <RotateCcw aria-hidden />
            <span>Undo pass</span>
          </button>
        ) : null}''',
    '''        {canUndo ? (
          <button
            type="button"
            className="linkr-action linkr-action--undo"
            onClick={onUndo}
            disabled={busy || Boolean(leaving)}
          >
            <RotateCcw aria-hidden />
            <span>Undo pass</span>
          </button>
        ) : canRequestReview ? (
          <button
            type="button"
            className="linkr-action linkr-action--undo"
            onClick={onRequestReview}
            disabled={busy || Boolean(leaving)}
          >
            <RotateCcw aria-hidden />
            <span>Ask support</span>
          </button>
        ) : null}'''
)

# ---------------------------------------------------------------------------
# LinkrPage: Undo belongs to Pass, surface remaining count, and require the
# separate Ask support click before a ticket is created.
# ---------------------------------------------------------------------------
path = "components/linkr/linkr-page.tsx"
replace_once(
    path,
    '''  resolveMutualDestinationAction,
  undoLinkrActionAction,
  updateLinkrProfileAction,''',
    '''  resolveMutualDestinationAction,
  requestLinkrPassReversalReviewAction,
  undoLinkrActionAction,
  updateLinkrProfileAction,'''
)
replace_once(
    path,
    '''  const [canUndo, setCanUndo] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);''',
    '''  const [canUndo, setCanUndo] = useState(false);
  const [reviewTargetId, setReviewTargetId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);'''
)
replace_once(
    path,
    '''  const advance = useCallback(() => {
    setIndex((current) => current + 1);
    setCanUndo(true);
  }, []);''',
    '''  const advance = useCallback((undoable: boolean) => {
    setIndex((current) => current + 1);
    setCanUndo(undoable);
    setReviewTargetId(null);
  }, []);'''
)
replace_once(path, "    advance();\n    void passCandidateAction", "    advance(true);\n    void passCandidateAction")
replace_once(path, "    advance();\n    void connectWithCandidateAction", "    advance(false);\n    void connectWithCandidateAction")
# Permanent hide is the remaining bare advance call in the safety action.
text = Path(path).read_text()
text = text.replace("                  advance();\n                  const result = await passCandidateAction({ targetId, permanent: true, eventId });", "                  advance(true);\n                  const result = await passCandidateAction({ targetId, permanent: true, eventId });")
Path(path).write_text(text)

replace_once(
    path,
    '''        if (result.ok) {
          setIndex((current) => Math.max(0, current - 1));
          setCanUndo(false);
        } else {
          setNotice(result.message);
        }''',
    '''        if (result.ok) {
          setIndex((current) => Math.max(0, current - 1));
          setCanUndo(false);
          setReviewTargetId(null);
          if (result.message) setNotice(result.message);
        } else {
          setNotice(result.message);
          if (result.code === "review_available" && result.reviewTargetId) {
            setCanUndo(false);
            setReviewTargetId(result.reviewTargetId);
          }
        }'''
)
# Add explicit request handler immediately after handleUndo.
marker = '''  }, []);
  /**
   * Identity handlers are GONE.'''
insert = '''  }, []);

  const handleRequestReview = useCallback(() => {
    const targetId = reviewTargetId;
    if (!targetId) return;
    void (async () => {
      setWriting(true);
      try {
        const result = await requestLinkrPassReversalReviewAction(targetId);
        setNotice(result.message);
        if (result.ok) setReviewTargetId(null);
      } finally {
        setWriting(false);
      }
    })();
  }, [reviewTargetId]);
  /**
   * Identity handlers are GONE.'''
replace_once(path, marker, insert)
replace_once(
    path,
    '''            onUndo={handleUndo}
            canUndo={canUndo}
            busy={pending || writing}''',
    '''            onUndo={handleUndo}
            canUndo={canUndo}
            onRequestReview={handleRequestReview}
            canRequestReview={Boolean(reviewTargetId)}
            busy={pending || writing}'''
)
# Decision errors should not disappear silently. Pass failure also disables an
# Undo that could otherwise undo an older server-side action.
replace_once(
    path,
    '''    advance(true);
    void passCandidateAction({ targetId, eventId });''',
    '''    advance(true);
    void passCandidateAction({ targetId, eventId }).then((result) => {
      if (!result.ok) {
        setCanUndo(false);
        setNotice(result.message || "That pass didn't save. They may appear again.");
      }
    });'''
)
replace_once(
    path,
    '''    void connectWithCandidateAction({ targetId, eventId }).then((result) => {
      // `matched` is the ONLY thing the server tells us.''',
    '''    void connectWithCandidateAction({ targetId, eventId }).then((result) => {
      if (!result.ok) setNotice(result.message || "Couldn't save that choice. Try again.");
      // `matched` is the ONLY thing the server tells us.'''
)

# Document the explicit support choice.
path = "docs/linkr-tranche-2-architecture.md"
replace_once(
    path,
    '''> Ordinary Pass undo is limited to three per server day; further immediate undo
> attempts create a deduplicated support-review ticket. None of these behaviours''',
    '''> Ordinary Pass undo is limited to three per server day; after the allowance
> is exhausted, Undo offers a separate **Ask support** action. A support-review
> ticket is created only after that explicit second choice and is deduplicated
> for the same pass. None of these behaviours'''
)

# Regression assertions for the reviewed UX contract.
path = "lib/linkr/final-architecture-review.test.ts"
replace_once(
    path,
    '''  it("marks an admin rewind review complete in the client after success", () => {''',
    '''  it("requires an explicit Ask support action after the three self-service rewinds", () => {
    const service = read("lib/linkr/connection-service.ts");
    const page = read("components/linkr/linkr-page.tsx");
    const card = read("components/linkr/candidate-card.tsx");
    expect(service).toContain('code: "review_available"');
    expect(service).toContain("requestLinkrPassReversalReview");
    expect(page).toContain("requestLinkrPassReversalReviewAction");
    expect(page).toContain("setReviewTargetId(result.reviewTargetId)");
    expect(card).toContain("Ask support");
  });

  it("only exposes Undo pass after a Pass, not after a one-sided Connect", () => {
    const page = read("components/linkr/linkr-page.tsx");
    expect(page).toContain("advance(true);\\n    void passCandidateAction");
    expect(page).toContain("advance(false);\\n    void connectWithCandidateAction");
  });

  it("marks an admin rewind review complete in the client after success", () => {'''
)

from pathlib import Path

def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected snippet missing in {path}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))

# Do NOT delete the other person's private Connect when they are passed.
# Their own `Your clicks` list is observable to them; silently removing their
# row would let them infer that the target just passed them. Pair-wide cooldown
# is enforced by candidate suppression + the stale-card Connect guard instead.
path = "lib/linkr/connection-service.ts"
replace_once(
    path,
    '''
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

  return { ok: true, message: "" };''',
    '''
  // Do not mutate the target's own private Connect row here. They are allowed
  // to see their own choices in `Your clicks`; deleting one in response to a
  // Pass would make the Pass inferable. The reciprocal cooldown is enforced
  // without touching their observable history.
  return { ok: true, message: "" };'''
)

# Keep the architecture note aligned with the privacy boundary.
path = "docs/linkr-tranche-2-architecture.md"
replace_once(
    path,
    '''> against stale cards, and making a Pass quietly retires any older one-sided
> Connect from the passed person so a future connection requires a fresh choice.
> Ordinary Pass undo is limited to three per server day;''',
    '''> against stale cards. A Pass never deletes the other person's private
> Connect row, because their own `Your clicks` history is observable to them and
> must not become a side channel for discovering that they were passed.
> Ordinary Pass undo is limited to three per server day;'''
)
replace_once(
    path,
    '''- **How is reciprocity detected?** Only inside `linkr_record_connect`. No
  application code may read both sides of `linkr_actions`.''',
    '''- **How was reciprocity detected at Phase 0?** Only inside
  `linkr_record_connect`. The final-reviewed architecture keeps actual matching
  there. Its two narrow server-only exceptions are documented above: a
  non-rendered ranking nudge and reciprocal temporary-Pass enforcement. Neither
  exposes the other person's decision to the client.'''
)

# Regression guard: the Pass may hide the pair, but may not mutate the passed
# person's own Connect history.
path = "lib/linkr/final-architecture-review.test.ts"
replace_once(
    path,
    '''    expect(service).toContain('.eq("actor_id", targetId)');
    expect(service).toContain('.eq("target_id", viewerId)');
    expect(service).toContain('.eq("action", "connect")');''',
    '''    expect(service).toContain('.eq("actor_id", targetId)');
    expect(service).toContain('.eq("target_id", viewerId)');
    expect(service).toContain("Do not mutate the target's own private Connect row here");
    expect(service).not.toContain('delete()\\n    .eq("actor_id", targetId)\\n    .eq("target_id", viewerId)\\n    .eq("action", "connect")');'''
)

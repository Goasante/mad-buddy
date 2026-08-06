/**
 * Socialize radar geometry.
 *
 * Pure: no React, no DOM, no data access. It is handed an ALREADY-AUTHORISED
 * list of nearby people and returns where to draw each one, so the placement
 * rules are testable directly and nothing here can widen who is visible.
 *
 * The core property is ANGULAR STABILITY. A person's angle comes from a hash
 * of their user id and nothing else — not their index, not the list order, not
 * how many people are nearer than them. So the radar does not reshuffle when
 * somebody joins, leaves, or moves between proximity bands: joining adds one
 * node, and moving changes one node's radius while its angle holds.
 */

/** Proximity bands the server actually provides. */
export type RadarTier = "close" | "near" | "far";

/**
 * Fraction of the field radius each band sits at.
 *
 * Band → radius is the ONLY thing proximity controls. Changing band moves a
 * person along their own spoke; it never rotates them.
 */
export const TIER_RADIUS: Record<RadarTier, number> = {
  close: 0.46,
  near: 0.72,
  far: 0.95
};

export type RadarPerson = {
  userId: string;
  proximityTier: RadarTier;
};

export type RadarNode<T extends RadarPerson> = {
  person: T;
  /** Centre offsets in px, relative to the field's centre. */
  x: number;
  y: number;
  /** Final angle in radians, after any collision nudge. */
  angle: number;
  tier: RadarTier;
};

export type RadarField<T extends RadarPerson> = {
  nodes: RadarNode<T>[];
  /** People who could not be placed legibly. Shown as a "+N" affordance. */
  overflow: number;
};

/**
 * FNV-1a, 32-bit. A small, fast, well-distributed string hash.
 *
 * Deterministic by construction: the same id always produces the same number,
 * on every device and across every reload. That is the whole point — it is
 * what makes a person's position theirs rather than a side effect of when they
 * happened to appear in the list.
 */
export function hashIdentity(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    // The FNV prime, applied with shifts to stay inside 32 bits.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }

  // Avalanche finalizer (MurmurHash3's fmix32). FNV alone leaves ids that
  // share a suffix very close together — "kofi" and "nana" landed on the same
  // angle to one decimal place without this — which would stack two avatars
  // on one spoke and force a collision nudge on every render.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** A person's base angle in radians: their identity, and nothing else. */
export function identityAngle(userId: string): number {
  return (hashIdentity(userId) / 0x100000000) * Math.PI * 2;
}

/** Smallest absolute difference between two angles, accounting for wrap-around. */
function angularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % (Math.PI * 2);
  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

export type RadarFieldOptions = {
  /** Half-width of the field in px. */
  rx: number;
  /** Half-height of the field in px. */
  ry: number;
  /** Node diameter in px, including its ring. */
  nodeSize: number;
  /** Minimum clear gap between two node edges, in px. */
  minGap: number;
  /** Most nodes to draw. Beyond this, the rest roll into overflow. */
  maxNodes: number;
  /**
   * Minimum distance in px from the field centre to a node's CENTRE.
   *
   * Guarantees that even the innermost band clears the centre composition —
   * avatar, its ring and its glow — on a short field, where a purely
   * fractional radius could otherwise place a node on top of it.
   */
  minRadius?: number;
};

/**
 * Place people around the centre.
 *
 * Deterministic throughout: identical input always yields identical output,
 * and there is no randomness anywhere in this module.
 *
 * Collision handling nudges only the node that collides, by the smallest
 * offset that clears it, alternating either side of its true angle so it stays
 * as close to its identity position as possible. Nodes already placed are
 * never moved, so one arrival cannot redistribute the field.
 */
export function buildRadarField<T extends RadarPerson>(
  people: readonly T[],
  { rx, ry, nodeSize, minGap, maxNodes, minRadius = 0 }: RadarFieldOptions
): RadarField<T> {
  if (rx <= 0 || ry <= 0 || people.length === 0) {
    return { nodes: [], overflow: people.length };
  }

  // Placement order is by identity alone — not by tier, and not by the order
  // the list arrived in. Order decides who wins a contested angle, so it is a
  // fixed property of WHO someone is: an arrival can only take a slot nobody
  // already holds, never displace an incumbent.
  //
  // Sorted on the id string rather than the hash so the comparison is total
  // and stable even if two ids ever hashed alike.
  const ordered = [...people].sort((a, b) => a.userId.localeCompare(b.userId));

  const nodes: RadarNode<T>[] = [];
  let overflow = 0;
  const minCentreDistance = nodeSize + minGap;

  for (const person of ordered) {
    if (nodes.length >= maxNodes) {
      // Deterministic capping: readability wins over showing everyone, and
      // WHO is capped is stable because the order above is stable.
      overflow += 1;
      continue;
    }

    const baseAngle = identityAngle(person.userId);
    const radius = TIER_RADIUS[person.proximityTier];
    let placed = false;

    // Push the band outward if the fractional radius would fall inside the
    // centre's clearance. Scaled per axis so the ellipse keeps its shape.
    const minFracX = rx > 0 ? minRadius / rx : 0;
    const minFracY = ry > 0 ? minRadius / ry : 0;
    const clearedRadius = Math.min(1, Math.max(radius, minFracX, minFracY));

    // Try the true angle first, then alternate outward in small steps. The
    // first clear position wins, so the nudge is always the minimum needed.
    for (let attempt = 0; attempt < 48 && !placed; attempt += 1) {
      const step = Math.ceil(attempt / 2);
      const direction = attempt % 2 === 0 ? 1 : -1;
      // ~7° per step: enough to clear a neighbour, small enough that a nudged
      // node still reads as being where it belongs.
      const angle = baseAngle + direction * step * ((7 * Math.PI) / 180);

      const x = clearedRadius * rx * Math.cos(angle);
      const y = clearedRadius * ry * Math.sin(angle);

      const collides = nodes.some((node) => Math.hypot(node.x - x, node.y - y) < minCentreDistance);
      if (collides) continue;

      nodes.push({ person, x, y, angle, tier: person.proximityTier });
      placed = true;
    }

    // A full band with no clear slot: better an honest "+N" than two avatars
    // drawn on top of each other.
    if (!placed) overflow += 1;
  }

  return { nodes, overflow };
}

/**
 * How far a node was nudged from its identity angle, in radians.
 *
 * Exposed for tests and diagnostics: it should be zero for an uncontested
 * node, and small for a nudged one.
 */
export function angularOffset(node: RadarNode<RadarPerson>): number {
  return angularDistance(node.angle, identityAngle(node.person.userId));
}

export type ControlMutationResult = { ok: boolean; message: string };

/**
 * Moves one control immediately, then keeps or rolls back only that field when
 * the authoritative mutation settles. The caller owns per-control locking;
 * this helper owns the local-first/rollback contract.
 */
export async function runOptimisticControlMutation({
  optimistic,
  rollback,
  mutation,
  failureMessage = "That setting could not be saved."
}: {
  optimistic?: () => void;
  rollback?: () => void;
  mutation: () => Promise<ControlMutationResult>;
  failureMessage?: string;
}): Promise<ControlMutationResult> {
  optimistic?.();
  try {
    const result = await mutation();
    if (!result.ok) rollback?.();
    return result;
  } catch {
    rollback?.();
    return { ok: false, message: failureMessage };
  }
}

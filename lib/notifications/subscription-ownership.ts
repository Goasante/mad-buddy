export function subscriptionDeleteScope(userId: string, endpoint: string) {
  return { userId, endpoint };
}

export function sameSubscriptionOwner(
  row: { user_id: string; endpoint: string },
  expected: { userId: string; endpoint: string }
) {
  return row.user_id === expected.userId && row.endpoint === expected.endpoint;
}

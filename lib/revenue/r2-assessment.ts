export const R2_PRICING_VERIFIED_AT = "2026-07-26";
export const R2_PRICING_SOURCE = "https://developers.cloudflare.com/r2/pricing/";
export const R2_LIMITS_SOURCE = "https://developers.cloudflare.com/r2/platform/limits/";
export const R2_PRESIGNED_URLS_SOURCE = "https://developers.cloudflare.com/r2/api/s3/presigned-urls/";

export const R2_STANDARD_PRICING = {
  freeStorageGbMonth: 10,
  freeClassAOperations: 1_000_000,
  freeClassBOperations: 10_000_000,
  storageUsdPerGbMonth: 0.015,
  classAUsdPerMillion: 4.5,
  classBUsdPerMillion: 0.36,
  internetEgressUsdPerGb: 0
} as const;

export const R2_SCENARIO_ASSUMPTIONS = {
  profileMbPerUser: 0.2,
  activeMomentImageMbPerUser: 1,
  activeMomentVideoMbPerUser: 5,
  classAWritesPerUserMonth: 5,
  classBReadsPerUserMonth: 200
} as const;

export type R2Scenario = {
  users: number;
  storageGb: number;
  classAOperations: number;
  classBOperations: number;
  estimatedMonthlyUsd: number;
};

/** Directional R2-only cost. It excludes Workers, transforms and transcoding. */
export function estimateR2Scenario(users: number): R2Scenario {
  const storageGb = users * (
    R2_SCENARIO_ASSUMPTIONS.profileMbPerUser +
    R2_SCENARIO_ASSUMPTIONS.activeMomentImageMbPerUser +
    R2_SCENARIO_ASSUMPTIONS.activeMomentVideoMbPerUser
  ) / 1000;
  const classAOperations = users * R2_SCENARIO_ASSUMPTIONS.classAWritesPerUserMonth;
  const classBOperations = users * R2_SCENARIO_ASSUMPTIONS.classBReadsPerUserMonth;
  const storageCost = Math.max(0, Math.ceil(storageGb) - R2_STANDARD_PRICING.freeStorageGbMonth) * R2_STANDARD_PRICING.storageUsdPerGbMonth;
  const classACost = Math.ceil(Math.max(0, classAOperations - R2_STANDARD_PRICING.freeClassAOperations) / 1_000_000) * R2_STANDARD_PRICING.classAUsdPerMillion;
  const classBCost = Math.ceil(Math.max(0, classBOperations - R2_STANDARD_PRICING.freeClassBOperations) / 1_000_000) * R2_STANDARD_PRICING.classBUsdPerMillion;
  return {
    users,
    storageGb: Math.round(storageGb * 10) / 10,
    classAOperations,
    classBOperations,
    estimatedMonthlyUsd: Math.round((storageCost + classACost + classBCost) * 100) / 100
  };
}

export const R2_SCENARIOS = [10_000, 100_000, 1_000_000].map(estimateR2Scenario);


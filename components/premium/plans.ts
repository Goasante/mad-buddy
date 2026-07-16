export type PlanId = "free" | "plus" | "pro";

export type PricingPlan = {
  id: PlanId;
  name: string;
  price: string;
  description: string;
  badge?: string;
  features: string[];
  limits: string[];
};

export const pricingPlans: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    price: "GHS 0",
    description: "Start with a small circle of approved friends.",
    features: [
      "Nearby glow",
      "Up to 25 friends",
      "Refresh nearby status manually",
      "Ghost Mode"
    ],
    limits: ["Up to 10 friend requests daily", "Block and report users"]
  },
  {
    id: "plus",
    name: "Buddy Plus",
    price: "GHS 50",
    description: "More flexibility for active friend groups.",
    badge: "Most popular",
    features: [
      "Unlimited friends",
      "Best Buddies priority",
      "Custom glow colours for each friend",
      "Nearby alerts",
      "Meet-up invitations"
    ],
    limits: ["Up to 50 friend requests daily", "Enhanced profile options"]
  },
  {
    id: "pro",
    name: "Buddy Pro",
    price: "GHS 100",
    description: "Advanced visibility controls for larger friend circles.",
    badge: "Most flexible",
    features: [
      "Everything in Buddy Plus",
      "Friend Circles with selective visibility",
      "Scheduled Ghost Mode",
      "Privacy Zones",
      "Temporary group mode",
      "Priority safety tools"
    ],
    limits: ["Up to 100 friend requests daily", "Priority support"]
  }
];

export const comparisonRows = [
  { feature: "Nearby glow", free: true, plus: true, pro: true },
  { feature: "Approved friends", free: "25", plus: "Unlimited", pro: "Unlimited" },
  { feature: "Daily friend requests", free: "10", plus: "50", pro: "100" },
  { feature: "Custom glow colours", free: false, plus: true, pro: true },
  { feature: "Best Buddies priority", free: false, plus: true, pro: true },
  { feature: "Smart nearby alerts", free: false, plus: true, pro: true },
  { feature: "Meet-up requests", free: false, plus: true, pro: true },
  { feature: "Friend Circles", free: false, plus: false, pro: true },
  { feature: "Ghost Mode schedules", free: false, plus: false, pro: true },
  { feature: "Privacy Zones", free: false, plus: false, pro: true },
  { feature: "Event Mode", free: false, plus: false, pro: true },
  { feature: "Priority support", free: false, plus: false, pro: true }
];

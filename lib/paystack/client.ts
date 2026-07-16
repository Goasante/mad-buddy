import "server-only";

import { getPaystackSecretKey } from "@/lib/paystack/config";

const paystackBaseUrl = "https://api.paystack.co";

type PaystackResponse<T> = {
  status: boolean;
  message: string;
  data: T;
};

type PaystackRequestInit = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown>;
};

export async function paystackRequest<T>(path: string, init: PaystackRequestInit = {}) {
  const secretKey = getPaystackSecretKey();

  if (!secretKey) {
    throw new Error("Missing PAYSTACK_SECRET_KEY.");
  }

  const response = await fetch(`${paystackBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...init.headers
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const payload = (await response.json().catch(() => null)) as PaystackResponse<T> | null;

  if (!response.ok || !payload?.status) {
    throw new Error(payload?.message ?? "Paystack request failed.");
  }

  return payload.data;
}

export type PaystackCustomer = {
  customer_code: string;
  email: string;
};

export type PaystackInitializeTransaction = {
  authorization_url: string;
  access_code: string;
  reference: string;
};

export type PaystackVerifiedTransaction = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  paid_at?: string | null;
  customer?: {
    customer_code?: string;
    email?: string;
  };
  authorization?: {
    authorization_code?: string;
  };
  plan?: string | { plan_code?: string };
  metadata?: {
    user_id?: string;
    plan?: "plus" | "pro";
  };
};

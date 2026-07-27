"use client";

import { useEffect, useState, type ReactNode } from "react";

type Assignment = {
  variantKey: string;
  variantName: string;
  isControl: boolean;
};

export function ExperimentBoundary({
  experimentKey,
  variants,
  fallback
}: {
  experimentKey: string;
  variants: Record<string, ReactNode>;
  fallback: ReactNode;
}) {
  const [assignment, setAssignment] = useState<Assignment | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/experiments/${encodeURIComponent(experimentKey)}`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json() as { experiment?: Assignment | null }).experiment ?? null;
      })
      .then((result) => setAssignment(result))
      .catch(() => {
        if (!controller.signal.aborted) setAssignment(null);
      });
    return () => controller.abort();
  }, [experimentKey]);

  const hasAssignedVariant = Boolean(assignment && variants[assignment.variantKey]);
  const content = assignment && hasAssignedVariant ? variants[assignment.variantKey] : fallback;

  useEffect(() => {
    if (!assignment || !hasAssignedVariant) return;
    const controller = new AbortController();
    void fetch(`/api/experiments/${encodeURIComponent(experimentKey)}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { experiment?: Assignment | null };
        if (!result.experiment) setAssignment(null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [assignment, experimentKey, hasAssignedVariant]);

  return content;
}

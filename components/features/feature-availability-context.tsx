"use client";
import { createContext, useContext } from "react";
import type { FeatureAvailability } from "@/lib/features/availability";
export const FeatureAvailabilityContext = createContext<FeatureAvailability | null>(null);
export function useFeatureAvailability() { return useContext(FeatureAvailabilityContext); }

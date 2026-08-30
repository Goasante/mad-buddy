export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// "expired" added by the batch-14 jobs migration, so the 30-day request expiry
// from batch 8 has a terminal state to sweep into.
export type FriendRequestStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "blocked"
  | "expired";
export type VisibilityStatus = "visible" | "ghost" | "app_open_only";

/**
 * Mad Buddy Access sources (20260824110000_access_entitlement_model).
 *
 * Independent reasons a person may currently use Linkr and UpFor. Deliberately
 * NOT a ranked tier: a user may hold several at once and access is the union,
 * so revoking one never destroys another. `apple_subscription` and
 * `google_subscription` exist so native stores need no schema change later;
 * nothing implements them yet.
 */
export type AccessSourceName =
  | "welcome_access"
  | "web_subscription"
  | "apple_subscription"
  | "google_subscription"
  | "admin_grant"
  | "staff"
  | "global_promo";
export type LocationConfidence = "high" | "medium" | "low";
export type ProximityLevel = "close" | "near" | "far" | "hidden";
/**
 * The RETIRED three-tier ladder.
 *
 * Deliberately NOT widened to include `mad_buddy_access`. Around twenty
 * subsystems are keyed on this ladder -- wallpaper tiers, tour entitlement
 * gating, buddy-score earned rewards, the per-tier entitlement registry, the
 * legacy comparison UI -- and Mad Buddy Access is not a rung on it. Widening
 * this union broke all of them at once, and the only ways to satisfy the
 * compiler would have been to invent an arbitrary position for Access in each
 * ladder (a wallpaper tier, a reward threshold) or to loosen those types. Both
 * would be fabricating product decisions to serve a type.
 *
 * What a subscription ROW may hold is `SubscriptionProduct` below.
 */
export type SubscriptionPlan = "free" | "buddy_plus" | "buddy_pro";

/**
 * What `subscriptions.plan` can actually contain.
 *
 * The legacy ladder, plus the current product. Access rows are written as
 * `mad_buddy_access` and never as a tier: the resolver only asks whether a
 * subscription is live, so a tier label would have worked while quietly
 * attributing this product's revenue to one nobody can buy, and would break
 * reconciliation against the Paystack plan code PLN_pbpn6h7vprirvlu.
 *
 * Mirrors the `subscription_plan` enum after
 * 20260824130000_access_subscription_plan.
 */
export type SubscriptionProduct = SubscriptionPlan | "mad_buddy_access";

/**
 * A subscription row's product, seen from the LEGACY TIER LADDER.
 *
 * Mad Buddy Access maps to `"free"`, and that is the correct answer rather than
 * a fudge: Access grants nothing THROUGH the ladder. It does not raise a
 * wallpaper tier, unlock a tour, or change an entitlement row -- what it
 * unlocks (Linkr and UpFor) is decided entirely by `lib/access/resolver`.
 *
 * So to every ladder-shaped consumer, an Access subscriber genuinely has no
 * tier. Reporting `buddy_plus` instead would hand them capabilities nobody
 * bought.
 *
 * Revenue and admin surfaces that need to know WHICH PRODUCT sold should read
 * `subscriptions.plan` directly (a `SubscriptionProduct`) rather than going
 * through this.
 */
export function legacyTierOf(plan: SubscriptionProduct): SubscriptionPlan {
  return plan === "mad_buddy_access" ? "free" : plan;
}
export type SubscriptionStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "non_renewing"
  | "attention"
  | "cancelled"
  | "expired";
export type PremiumTrialStatus = "active" | "expired" | "converted" | "cancelled" | "revoked";
export type PremiumTrialEventType =
  | "eligible"
  | "started"
  | "active"
  | "ending_soon"
  | "expired"
  | "converted"
  | "cancelled"
  | "revoked"
  | "premium_feature_used";
export type ExperimentStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "cancelled";
export type ExperimentPlatform = "web" | "android" | "ios";
export type ExperimentAudience = "all_eligible" | "selected_testers";
export type BillingEventType =
  | "pricing_viewed"
  | "checkout_started"
  | "payment_attempted"
  | "payment_succeeded"
  | "payment_failed"
  | "payment_recovered"
  | "subscription_activated"
  | "subscription_renewed"
  | "subscription_cancelled"
  | "subscription_expired"
  | "plan_upgraded"
  | "plan_downgraded";
export type BillingEventSource = "app_server" | "paystack_webhook" | "paystack_verify" | "admin";
export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";
export type MeetupStatus = "pending" | "accepted" | "declined" | "expired";

type RowWithTimestamps = {
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          full_name: string;
          username: string;
          bio: string | null;
          avatar_url: string | null;
          mood_status: string | null;
          visibility_status: VisibilityStatus;
          is_onboarded: boolean;
          deleted_at: string | null;
          trusted_member_since: string | null;
          // Added by the batch-9 profiles migration.
          username_normalized: string | null;
          profile_media_id: string | null;
          institution: string | null;
          programme: string | null;
          graduation_year: number | null;
          general_area: string | null;
          pronouns: string | null;
          username_changed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          full_name: string;
          username: string;
          bio?: string | null;
          avatar_url?: string | null;
          mood_status?: string | null;
          visibility_status?: VisibilityStatus;
          is_onboarded?: boolean;
          deleted_at?: string | null;
          trusted_member_since?: string | null;
          username_normalized?: string | null;
          profile_media_id?: string | null;
          institution?: string | null;
          programme?: string | null;
          graduation_year?: number | null;
          general_area?: string | null;
          pronouns?: string | null;
          username_changed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      wallpapers: {
        Row: RowWithTimestamps & {
          id: string;
          slug: string;
          name: string;
          render_mode: "ambient" | "plain" | "image";
          tier: SubscriptionPlan;
          thumb_url: string | null;
          light_url: string | null;
          dark_url: string | null;
          is_enabled: boolean;
          sort_order: number;
          source: "bundled" | "managed" | "custom";
          created_by: string | null;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          render_mode: "ambient" | "plain" | "image";
          tier?: SubscriptionPlan;
          thumb_url?: string | null;
          light_url?: string | null;
          dark_url?: string | null;
          is_enabled?: boolean;
          sort_order?: number;
          source?: "bundled" | "managed" | "custom";
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["wallpapers"]["Insert"]>;
        Relationships: [];
      };
      user_wallpaper_preferences: {
        Row: {
          user_id: string;
          selected_slug: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          selected_slug?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_wallpaper_preferences"]["Insert"]>;
        Relationships: [];
      };
      custom_wallpapers: {
        Row: RowWithTimestamps & {
          id: string;
          owner_id: string;
          storage_key: string;
          mime_type: "image/webp" | "image/jpeg" | "image/png";
          size_bytes: number;
          width: number | null;
          height: number | null;
          state: "active" | "removed";
        };
        Insert: {
          id?: string;
          owner_id: string;
          storage_key: string;
          mime_type: "image/webp" | "image/jpeg" | "image/png";
          size_bytes: number;
          width?: number | null;
          height?: number | null;
          state?: "active" | "removed";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["custom_wallpapers"]["Insert"]>;
        Relationships: [];
      };
      admin_users: {
        Row: RowWithTimestamps & {
          id: string;
          email: string;
          auth_user_id: string | null;
          role: "owner" | "admin" | "support";
          invited_by_user_id: string | null;
          disabled_at: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          auth_user_id?: string | null;
          role?: "owner" | "admin" | "support";
          invited_by_user_id?: string | null;
          disabled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["admin_users"]["Insert"]>;
        Relationships: [];
      };
      friend_requests: {
        Row: RowWithTimestamps & {
          id: string;
          sender_id: string;
          receiver_id: string;
          status: FriendRequestStatus;
          // Added by the batch-8 discovery migration.
          context_type: RequestContextType | null;
          context_id: string | null;
          message: string | null;
          responded_at: string | null;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          sender_id: string;
          receiver_id: string;
          status?: FriendRequestStatus;
          context_type?: RequestContextType | null;
          context_id?: string | null;
          message?: string | null;
          responded_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["friend_requests"]["Insert"]>;
        Relationships: [];
      };
      friendships: {
        Row: {
          id: string;
          user_one_id: string;
          user_two_id: string;
          created_at: string;
          // Added by the batch-8 discovery migration.
          accepted_request_id: string | null;
          ended_at: string | null;
        };
        Insert: {
          id?: string;
          user_one_id: string;
          user_two_id: string;
          created_at?: string;
          accepted_request_id?: string | null;
          ended_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["friendships"]["Insert"]>;
        Relationships: [];
      };
      user_locations: {
        Row: {
          id: string;
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy: number;
          confidence: LocationConfidence;
          last_updated: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          latitude: number;
          longitude: number;
          accuracy: number;
          confidence: LocationConfidence;
          last_updated?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_locations"]["Insert"]>;
        Relationships: [];
      };
      proximity_events: {
        Row: {
          id: string;
          user_id: string;
          friend_id: string;
          proximity_level: ProximityLevel;
          glow_strength: number;
          confidence: LocationConfidence;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          friend_id: string;
          proximity_level: ProximityLevel;
          glow_strength: number;
          confidence: LocationConfidence;
          created_at?: string;
          expires_at: string;
        };
        Update: Partial<Database["public"]["Tables"]["proximity_events"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          title: string;
          message: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          title: string;
          message: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      blocked_users: {
        Row: { id: string; blocker_id: string; blocked_id: string; created_at: string };
        Insert: { id?: string; blocker_id: string; blocked_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["blocked_users"]["Insert"]>;
        Relationships: [];
      };
      trusted_member_applications: {
        Row: {
          id: string;
          user_id: string;
          status: string;
          note: string | null;
          premium_days_at_apply: number | null;
          journeys_complete_at_apply: number | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: string;
          note?: string | null;
          premium_days_at_apply?: number | null;
          journeys_complete_at_apply?: number | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["trusted_member_applications"]["Insert"]>;
        Relationships: [];
      };
      profile_photos: {
        Row: {
          id: string;
          user_id: string;
          media_asset_id: string;
          position: number;
          visibility: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          media_asset_id: string;
          position: number;
          visibility?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profile_photos"]["Insert"]>;
        Relationships: [];
      };
      discovery_passes: {
        Row: {
          id: string;
          user_id: string;
          passed_user_id: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          passed_user_id: string;
          created_at?: string;
          expires_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["discovery_passes"]["Insert"]>;
        Relationships: [];
      };
      reports: {
        Row: RowWithTimestamps & {
          id: string;
          reporter_id: string | null;
          reported_user_id: string | null;
          reported_user_label: string;
          reason: string;
          description: string | null;
          status: ReportStatus;
        };
        Insert: {
          id?: string;
          reporter_id?: string | null;
          reported_user_id?: string | null;
          reported_user_label?: string;
          reason: string;
          description?: string | null;
          status?: ReportStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Insert"]>;
        Relationships: [];
      };
      subscriptions: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          provider: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          paystack_customer_code: string | null;
          paystack_subscription_code: string | null;
          paystack_email_token: string | null;
          paystack_authorization_code: string | null;
          plan: SubscriptionProduct;
          status: SubscriptionStatus;
          current_period_start: string | null;
          current_period_end: string | null;
          // Added by the batch-10 entitlements migration.
          subject_type: "user" | "workspace" | "community";
          cancel_at_period_end: boolean;
          trial_ends_at: string | null;
          grace_ends_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider?: string;
          subject_type?: "user" | "workspace" | "community";
          cancel_at_period_end?: boolean;
          trial_ends_at?: string | null;
          grace_ends_at?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          paystack_customer_code?: string | null;
          paystack_subscription_code?: string | null;
          paystack_email_token?: string | null;
          paystack_authorization_code?: string | null;
          plan?: SubscriptionProduct;
          status?: SubscriptionStatus;
          current_period_start?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Insert"]>;
        Relationships: [];
      };
      premium_trial_config: {
        Row: RowWithTimestamps & {
          key: "default";
          enabled: boolean;
          eligible_plan: Exclude<SubscriptionPlan, "free">;
          duration_days: number;
          eligibility_rules: Json;
          campaign_source: string | null;
          available_from: string | null;
          available_until: string | null;
          updated_by: string | null;
        };
        Insert: {
          key?: "default";
          enabled?: boolean;
          eligible_plan?: Exclude<SubscriptionPlan, "free">;
          duration_days?: number;
          eligibility_rules?: Json;
          campaign_source?: string | null;
          available_from?: string | null;
          available_until?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["premium_trial_config"]["Insert"]>;
        Relationships: [];
      };
      premium_trials: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          plan: Exclude<SubscriptionPlan, "free">;
          status: PremiumTrialStatus;
          trial_started_at: string;
          trial_ends_at: string;
          source: "self_service" | "owner_grant" | "campaign";
          campaign_source: string | null;
          owner_override: boolean;
          override_reason: string | null;
          granted_by: string | null;
          converted_at: string | null;
          cancelled_at: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          revocation_reason: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          plan: Exclude<SubscriptionPlan, "free">;
          status?: PremiumTrialStatus;
          trial_started_at: string;
          trial_ends_at: string;
          source?: "self_service" | "owner_grant" | "campaign";
          campaign_source?: string | null;
          owner_override?: boolean;
          override_reason?: string | null;
          granted_by?: string | null;
          converted_at?: string | null;
          cancelled_at?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revocation_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["premium_trials"]["Insert"]>;
        Relationships: [];
      };
      premium_trial_events: {
        Row: {
          id: string;
          trial_id: string | null;
          user_id: string;
          event_type: PremiumTrialEventType;
          event_key: string;
          feature_key: string | null;
          metadata: Json;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          trial_id?: string | null;
          user_id: string;
          event_type: PremiumTrialEventType;
          event_key: string;
          feature_key?: string | null;
          metadata?: Json;
          occurred_at?: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      premium_trial_notifications: {
        Row: RowWithTimestamps & {
          id: string;
          trial_id: string;
          user_id: string;
          notification_type: "started" | "ending_soon" | "expired" | "converted" | "revoked";
          delivery_status: "pending" | "processing" | "delivered" | "failed";
          attempts: number;
          last_attempt_at: string | null;
          delivered_at: string | null;
        };
        Insert: {
          id?: string;
          trial_id: string;
          user_id: string;
          notification_type: "started" | "ending_soon" | "expired" | "converted" | "revoked";
          delivery_status?: "pending" | "processing" | "delivered" | "failed";
          attempts?: number;
          last_attempt_at?: string | null;
          delivered_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["premium_trial_notifications"]["Insert"]>;
        Relationships: [];
      };
      paystack_webhook_events: {
        Row: {
          id: string;
          type: string;
          created_at: string;
        };
        Insert: {
          id: string;
          type: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["paystack_webhook_events"]["Insert"]>;
        Relationships: [];
      };
      billing_events: {
        Row: {
          id: string;
          event_type: BillingEventType;
          source: BillingEventSource;
          provider: string;
          user_id: string | null;
          subscription_id: string | null;
          subscription_plan: SubscriptionProduct;
          previous_plan: SubscriptionPlan | null;
          amount_minor: number | null;
          provider_fee_minor: number | null;
          net_amount_minor: number | null;
          fee_status: "verified" | "unavailable";
          currency: string | null;
          transaction_reference: string | null;
          provider_event_id: string | null;
          dedupe_key: string;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_type: BillingEventType;
          source: BillingEventSource;
          provider?: string;
          user_id?: string | null;
          subscription_id?: string | null;
          subscription_plan?: SubscriptionProduct;
          previous_plan?: SubscriptionPlan | null;
          amount_minor?: number | null;
          provider_fee_minor?: number | null;
          net_amount_minor?: number | null;
          fee_status?: "verified" | "unavailable";
          currency?: string | null;
          transaction_reference?: string | null;
          provider_event_id?: string | null;
          dedupe_key: string;
          occurred_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["billing_events"]["Insert"]>;
        Relationships: [];
      };
      financial_snapshots: {
        Row: {
          id: string;
          snapshot_date: string;
          currency: string;
          active_free_users: number;
          buddy_plus_users: number;
          buddy_pro_users: number;
          active_paid_subscriptions: number;
          opening_mrr_minor: number | null;
          new_mrr_minor: number | null;
          expansion_mrr_minor: number | null;
          reactivation_mrr_minor: number | null;
          contraction_mrr_minor: number | null;
          churned_mrr_minor: number | null;
          ending_mrr_minor: number;
          reconciliation_status: "baseline" | "reconciled" | "reconciliation_required";
          reconciliation_reason:
            | "opening_snapshot_unavailable"
            | "lifecycle_movements_do_not_match_trusted_mrr"
            | null;
          reconciliation_difference_minor: number | null;
          captured_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          snapshot_date: string;
          currency: string;
          active_free_users: number;
          buddy_plus_users: number;
          buddy_pro_users: number;
          active_paid_subscriptions: number;
          opening_mrr_minor?: number | null;
          new_mrr_minor?: number | null;
          expansion_mrr_minor?: number | null;
          reactivation_mrr_minor?: number | null;
          contraction_mrr_minor?: number | null;
          churned_mrr_minor?: number | null;
          ending_mrr_minor: number;
          reconciliation_status?: "baseline" | "reconciled" | "reconciliation_required";
          reconciliation_reason?:
            | "opening_snapshot_unavailable"
            | "lifecycle_movements_do_not_match_trusted_mrr"
            | null;
          reconciliation_difference_minor?: number | null;
          captured_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["financial_snapshots"]["Insert"]>;
        Relationships: [];
      };
      provider_cost_records: {
        Row: {
          id: string;
          provider: string;
          billing_period: string;
          currency: string;
          amount_minor: number;
          category: "database" | "hosting" | "email" | "sms" | "media_storage" | "push" | "api" | "other";
          source: "manual" | "invoice" | "api";
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          provider: string;
          billing_period: string;
          currency: string;
          amount_minor: number;
          category: Database["public"]["Tables"]["provider_cost_records"]["Row"]["category"];
          source: Database["public"]["Tables"]["provider_cost_records"]["Row"]["source"];
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["provider_cost_records"]["Insert"]>;
        Relationships: [];
      };
      business_alert_rules: {
        Row: {
          rule_key: "mrr_drop" | "cancellation_spike" | "payment_failure_spike" | "recovery_rate_drop" | "infrastructure_cost_spike";
          enabled: boolean;
          threshold_percent: number;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          rule_key: Database["public"]["Tables"]["business_alert_rules"]["Row"]["rule_key"];
          enabled?: boolean;
          threshold_percent: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["business_alert_rules"]["Insert"]>;
        Relationships: [];
      };
      friend_circles: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          visibility_rule: string;
          icon: string | null;
          theme: string | null;
          is_system_circle: boolean;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          visibility_rule?: string;
          icon?: string | null;
          theme?: string | null;
          is_system_circle?: boolean;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["friend_circles"]["Insert"]>;
        Relationships: [];
      };
      circle_members: {
        Row: { id: string; circle_id: string; friend_id: string; added_by: string | null; created_at: string };
        Insert: { id?: string; circle_id: string; friend_id: string; added_by?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["circle_members"]["Insert"]>;
        Relationships: [];
      };
      close_friend_relationships: {
        Row: {
          id: string;
          owner_id: string;
          friend_id: string;
          priority_level: "standard" | "priority";
          notification_preference: CloseFriendNotificationPreference;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          friend_id: string;
          priority_level?: "standard" | "priority";
          notification_preference?: CloseFriendNotificationPreference;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["close_friend_relationships"]["Insert"]>;
        Relationships: [];
      };
      visibility_sessions: {
        Row: {
          id: string;
          user_id: string;
          feature_type: VisibilityFeatureType;
          visibility_mode: VisibilityMode;
          starts_at: string;
          ends_at: string | null;
          source: "manual" | "schedule" | "hangout_mode" | "event_mode";
          status: "active" | "ended" | "expired";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          feature_type?: VisibilityFeatureType;
          visibility_mode: VisibilityMode;
          starts_at?: string;
          ends_at?: string | null;
          source?: "manual" | "schedule" | "hangout_mode" | "event_mode";
          status?: "active" | "ended" | "expired";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["visibility_sessions"]["Insert"]>;
        Relationships: [];
      };
      visibility_targets: {
        Row: {
          id: string;
          session_id: string;
          target_type: "circle" | "user" | "group";
          target_id: string;
          access_type: "include" | "exclude";
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          target_type: "circle" | "user" | "group";
          target_id: string;
          access_type?: "include" | "exclude";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["visibility_targets"]["Insert"]>;
        Relationships: [];
      };
      privacy_zones: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          name: string;
          latitude: number;
          longitude: number;
          radius: number;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          latitude: number;
          longitude: number;
          radius: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["privacy_zones"]["Insert"]>;
        Relationships: [];
      };
      meetup_requests: {
        Row: {
          id: string;
          sender_id: string;
          receiver_id: string;
          message: string | null;
          status: MeetupStatus;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          receiver_id: string;
          message?: string | null;
          status?: MeetupStatus;
          expires_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["meetup_requests"]["Insert"]>;
        Relationships: [];
      };
      user_statuses: {
        Row: {
          id: string;
          user_id: string;
          availability_type: AvailabilityType;
          activity_type: ActivityType | null;
          custom_text: string | null;
          visibility_type: StatusVisibilityType;
          starts_at: string;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          availability_type: AvailabilityType;
          activity_type?: ActivityType | null;
          custom_text?: string | null;
          visibility_type?: StatusVisibilityType;
          starts_at?: string;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_statuses"]["Insert"]>;
        Relationships: [];
      };
      status_visibility_targets: {
        Row: {
          id: string;
          status_id: string;
          target_type: "circle" | "user" | "group";
          target_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          status_id: string;
          target_type: "circle" | "user" | "group";
          target_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["status_visibility_targets"]["Insert"]>;
        Relationships: [];
      };
      waves: {
        Row: {
          id: string;
          sender_id: string;
          recipient_id: string;
          source: WaveSource;
          reply_to_wave_id: string | null;
          sent_at: string;
          seen_at: string | null;
          responded_at: string | null;
          response_type: WaveResponseType | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          recipient_id: string;
          source?: WaveSource;
          reply_to_wave_id?: string | null;
          sent_at?: string;
          seen_at?: string | null;
          responded_at?: string | null;
          response_type?: WaveResponseType | null;
          expires_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["waves"]["Insert"]>;
        Relationships: [];
      };
      wave_mutes: {
        Row: {
          id: string;
          user_id: string;
          muted_user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          muted_user_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["wave_mutes"]["Insert"]>;
        Relationships: [];
      };
      meeting_pings: {
        Row: {
          id: string;
          sender_id: string;
          recipient_id: string;
          ping_type: PingType;
          custom_message: string | null;
          proposed_time: string;
          expires_at: string;
          place_type: "custom" | "chat";
          custom_place_text: string | null;
          status: PingStatus;
          seen_at: string | null;
          responded_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          sender_id: string;
          recipient_id: string;
          ping_type: PingType;
          custom_message?: string | null;
          proposed_time: string;
          expires_at: string;
          place_type?: "custom" | "chat";
          custom_place_text?: string | null;
          status?: PingStatus;
          seen_at?: string | null;
          responded_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["meeting_pings"]["Insert"]>;
        Relationships: [];
      };
      meeting_ping_responses: {
        Row: {
          id: string;
          ping_id: string;
          responder_id: string;
          response_type: PingResponseType;
          suggested_time: string | null;
          message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ping_id: string;
          responder_id: string;
          response_type: PingResponseType;
          suggested_time?: string | null;
          message?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["meeting_ping_responses"]["Insert"]>;
        Relationships: [];
      };
      temporary_plans: {
        Row: {
          id: string;
          source_ping_id: string;
          creator_id: string;
          participant_id: string;
          title: string;
          meeting_time: string;
          place_text: string | null;
          status: "active" | "cancelled" | "completed";
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          source_ping_id: string;
          creator_id: string;
          participant_id: string;
          title: string;
          meeting_time: string;
          place_text?: string | null;
          status?: "active" | "cancelled" | "completed";
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["temporary_plans"]["Insert"]>;
        Relationships: [];
      };
      user_preferences: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          glow_theme: string;
          mood_status: string | null;
          ghost_mode_type: string;
          scheduled_visibility: Json;
          notification_preferences: Json;
          // Added by the batch-7 messaging migration.
          communication_preferences: Json;
          app_preferences: Json;
        };
        Insert: {
          id?: string;
          user_id: string;
          glow_theme?: string;
          mood_status?: string | null;
          ghost_mode_type?: string;
          scheduled_visibility?: Json;
          notification_preferences?: Json;
          communication_preferences?: Json;
          app_preferences?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_preferences"]["Insert"]>;
        Relationships: [];
      };
      tours: {
        Row: RowWithTimestamps & {
          id: string;
          slug: string;
          title: string;
          description: string;
          kind: "main" | "feature";
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          description?: string;
          kind?: "main" | "feature";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tours"]["Insert"]>;
        Relationships: [];
      };
      tour_versions: {
        Row: RowWithTimestamps & {
          id: string;
          tour_id: string;
          version: number;
          status: "draft" | "published" | "paused" | "retired";
          audience: Json;
          starts_at: string | null;
          ends_at: string | null;
          published_at: string | null;
          updated_by: string | null;
          publish_reason: string | null;
        };
        Insert: {
          id?: string;
          tour_id: string;
          version: number;
          status?: "draft" | "published" | "paused" | "retired";
          audience?: Json;
          starts_at?: string | null;
          ends_at?: string | null;
          published_at?: string | null;
          updated_by?: string | null;
          publish_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tour_versions"]["Insert"]>;
        Relationships: [];
      };
      tour_steps: {
        Row: {
          id: string;
          tour_version_id: string;
          position: number;
          step_key: string;
          title: string;
          body: string;
          target_id: string | null;
          route: string | null;
          media_path: string | null;
          cta_label: string | null;
          cta_href: string | null;
          requires_feature_flag: string | null;
          entitlement_keys: string[];
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_version_id: string;
          position: number;
          step_key: string;
          title: string;
          body: string;
          target_id?: string | null;
          route?: string | null;
          media_path?: string | null;
          cta_label?: string | null;
          cta_href?: string | null;
          requires_feature_flag?: string | null;
          entitlement_keys?: string[];
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tour_steps"]["Insert"]>;
        Relationships: [];
      };
      user_tour_progress: {
        Row: {
          id: string;
          user_id: string;
          tour_version_id: string;
          status: "started" | "completed" | "skipped" | "dismissed";
          current_step_key: string | null;
          started_at: string;
          completed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          tour_version_id: string;
          status: "started" | "completed" | "skipped" | "dismissed";
          current_step_key?: string | null;
          started_at?: string;
          completed_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_tour_progress"]["Insert"]>;
        Relationships: [];
      };
      app_feedback: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          category: "feedback" | "suggestion";
          rating: number | null;
          message: string;
          status: "new" | "reviewing" | "resolved" | "closed";
        };
        Insert: {
          id?: string;
          user_id: string;
          category: "feedback" | "suggestion";
          rating?: number | null;
          message?: string;
          status?: "new" | "reviewing" | "resolved" | "closed";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_feedback"]["Insert"]>;
        Relationships: [];
      };
      support_requests: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          full_name: string;
          email: string;
          message: string;
          status: "open" | "in_progress" | "resolved" | "closed";
        };
        Insert: {
          id?: string;
          user_id: string;
          full_name: string;
          email: string;
          message: string;
          status?: "open" | "in_progress" | "resolved" | "closed";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_requests"]["Insert"]>;
        Relationships: [];
      };
      best_buddies: {
        Row: {
          id: string;
          user_id: string;
          friend_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          friend_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["best_buddies"]["Insert"]>;
        Relationships: [];
      };
      event_modes: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string;
          name: string;
          starts_at: string;
          ends_at: string;
          visibility_rule: string;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          starts_at: string;
          ends_at: string;
          visibility_rule?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_modes"]["Insert"]>;
        Relationships: [];
      };
      rate_limits: {
        Row: RowWithTimestamps & {
          id: string;
          user_id: string | null;
          ip_hash: string | null;
          action: string;
          count: number;
          window_start: string;
          window_end: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          ip_hash?: string | null;
          action: string;
          count?: number;
          window_start: string;
          window_end: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["rate_limits"]["Insert"]>;
        Relationships: [];
      };
      consent_logs: {
        Row: {
          id: string;
          user_id: string;
          consent_type: string;
          consent_text: string;
          granted: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          consent_type: string;
          consent_text: string;
          granted: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["consent_logs"]["Insert"]>;
        Relationships: [];
      };
      deletion_audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          deleted_user_label: string;
          deletion_reason: string | null;
          deleted_at: string;
          retained_billing_reference: string | null;
          retained_report_reference: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          deleted_user_label?: string;
          deletion_reason?: string | null;
          deleted_at?: string;
          retained_billing_reference?: string | null;
          retained_report_reference?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["deletion_audit_logs"]["Insert"]>;
        Relationships: [];
      };
      stripe_webhook_events: {
        Row: {
          id: string;
          type: string;
          processed_at: string;
          created_at: string;
        };
        Insert: {
          id: string;
          type: string;
          processed_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["stripe_webhook_events"]["Insert"]>;
        Relationships: [];
      };
      plans: {
        Row: {
          id: string;
          creator_id: string;
          title: string;
          description: string | null;
          plan_type: PlanType;
          visibility_type: PlanVisibilityType;
          status: PlanStatus;
          start_at: string | null;
          end_at: string | null;
          timezone: string;
          rsvp_deadline: string | null;
          max_participants: number;
          place_type: PlanPlaceType;
          place_id: string | null;
          custom_place_text: string | null;
          reminder_minutes: number | null;
          source_hangout_id: string | null;
          source_ping_id: string | null;
          created_at: string;
          updated_at: string;
          cancelled_at: string | null;
          completed_at: string | null;
          /** What the plan IS. Distinct from plan_type (how it is scheduled). */
          category: PlanCategory | null;
          /** User-uploaded cover; outranks the canonical illustration. */
          cover_image_url: string | null;
          /**
           * Days after the Plan ends that its chat closes. One of 1/3/7/14.
           * The close INSTANT is derived from this plus the Plan's live
           * timing, never stored, so a rescheduled Plan moves its own closure.
           */
          chat_close_days: number;
        };
        Insert: {
          id?: string;
          creator_id: string;
          title: string;
          description?: string | null;
          plan_type: PlanType;
          chat_close_days?: number;
          category?: PlanCategory | null;
          cover_image_url?: string | null;
          visibility_type?: PlanVisibilityType;
          status?: PlanStatus;
          start_at?: string | null;
          end_at?: string | null;
          timezone?: string;
          rsvp_deadline?: string | null;
          max_participants?: number;
          place_type?: PlanPlaceType;
          place_id?: string | null;
          custom_place_text?: string | null;
          reminder_minutes?: number | null;
          source_hangout_id?: string | null;
          source_ping_id?: string | null;
          created_at?: string;
          updated_at?: string;
          cancelled_at?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["plans"]["Insert"]>;
        Relationships: [];
      };
      plan_participants: {
        Row: {
          id: string;
          plan_id: string;
          user_id: string;
          role: PlanRole;
          rsvp_status: RsvpStatus;
          response_note: string | null;
          attendance_visibility: AttendanceVisibility;
          invited_by: string | null;
          viewed_at: string | null;
          responded_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          user_id: string;
          role?: PlanRole;
          rsvp_status?: RsvpStatus;
          response_note?: string | null;
          attendance_visibility?: AttendanceVisibility;
          invited_by?: string | null;
          viewed_at?: string | null;
          responded_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["plan_participants"]["Insert"]>;
        Relationships: [];
      };
      plan_polls: {
        Row: {
          id: string;
          plan_id: string;
          creator_id: string;
          poll_type: PollType;
          question: string;
          selection_mode: PollSelectionMode;
          results_visibility: PollResultsVisibility;
          closes_at: string | null;
          status: PollStatus;
          confirmed_option_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          creator_id: string;
          poll_type: PollType;
          question: string;
          selection_mode?: PollSelectionMode;
          results_visibility?: PollResultsVisibility;
          closes_at?: string | null;
          status?: PollStatus;
          confirmed_option_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["plan_polls"]["Insert"]>;
        Relationships: [];
      };
      plan_poll_options: {
        Row: {
          id: string;
          poll_id: string;
          label: string;
          value: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          poll_id: string;
          label: string;
          value?: string | null;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["plan_poll_options"]["Insert"]>;
        Relationships: [];
      };
      plan_poll_votes: {
        Row: {
          id: string;
          poll_id: string;
          option_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          poll_id: string;
          option_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["plan_poll_votes"]["Insert"]>;
        Relationships: [];
      };
      hangout_sessions: {
        Row: {
          id: string;
          owner_id: string;
          area_tier: string | null;
          area_derived_at: string | null;
          discovery_scope: string;
          activity_type: HangoutActivityType;
          message: string | null;
          audience_type: HangoutAudienceType;
          broad_area_text: string | null;
          starts_at: string;
          ends_at: string;
          max_participants: number;
          allow_pings: boolean;
          allow_friend_invites: boolean;
          status: HangoutStatus;
          converted_plan_id: string | null;
          timezone: string;
          audience_notified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          area_tier?: string | null;
          area_derived_at?: string | null;
          discovery_scope?: string;
          activity_type: HangoutActivityType;
          message?: string | null;
          audience_type?: HangoutAudienceType;
          broad_area_text?: string | null;
          starts_at?: string;
          ends_at: string;
          max_participants?: number;
          allow_pings?: boolean;
          allow_friend_invites?: boolean;
          status?: HangoutStatus;
          converted_plan_id?: string | null;
          timezone?: string;
          audience_notified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hangout_sessions"]["Insert"]>;
        Relationships: [];
      };
      socialize_sessions: {
        Row: {
          id: string;
          user_id: string;
          activity: string;
          note: string | null;
          area_tier: string;
          starts_at: string;
          expires_at: string;
          ended_at: string | null;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          activity: string;
          note?: string | null;
          area_tier: string;
          starts_at?: string;
          expires_at: string;
          ended_at?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["socialize_sessions"]["Insert"]>;
        Relationships: [];
      };
      hangout_audience_targets: {
        Row: {
          id: string;
          hangout_session_id: string;
          target_type: "circle" | "user" | "group";
          target_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          hangout_session_id: string;
          target_type: "circle" | "user" | "group";
          target_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hangout_audience_targets"]["Insert"]>;
        Relationships: [];
      };
      hangout_requests: {
        Row: {
          id: string;
          hangout_session_id: string;
          requester_id: string;
          status: HangoutRequestStatus;
          message: string | null;
          responded_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          hangout_session_id: string;
          requester_id: string;
          status?: HangoutRequestStatus;
          message?: string | null;
          responded_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hangout_requests"]["Insert"]>;
        Relationships: [];
      };
      events: {
        Row: {
          id: string;
          host_id: string;
          name: string;
          description: string | null;
          venue_label: string | null;
          starts_at: string;
          ends_at: string;
          checkin_opens_minutes_before: number;
          visibility: EventVisibility;
          status: EventStatus;
          /**
           * Cover artwork via the canonical media_assets stack (Stage F).
           * NULL for drafts and for legacy events predating the published-cover
           * rule; those render the deterministic generated fallback.
           */
          cover_media_id: string | null;
          /** Focal point 0..1 for cropping one image across every surface. */
          cover_focal_x: number;
          cover_focal_y: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          host_id: string;
          name: string;
          description?: string | null;
          venue_label?: string | null;
          starts_at: string;
          ends_at: string;
          checkin_opens_minutes_before?: number;
          visibility?: EventVisibility;
          status?: EventStatus;
          cover_media_id?: string | null;
          cover_focal_x?: number;
          cover_focal_y?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["events"]["Insert"]>;
        Relationships: [];
      };
      event_rsvps: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          status: EventRsvpStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          status: EventRsvpStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_rsvps"]["Insert"]>;
        Relationships: [];
      };
      linkr_profiles: {
        Row: {
          user_id: string;
          enabled: boolean;
          intent: LinkrIntentValue;
          bio: string | null;
          discovery_distance: LinkrDistanceValue;
          require_photos: boolean;
          only_active_now: boolean;
          only_new_today: boolean;
          event_mode_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          enabled?: boolean;
          intent?: LinkrIntentValue;
          bio?: string | null;
          discovery_distance?: LinkrDistanceValue;
          require_photos?: boolean;
          only_active_now?: boolean;
          only_new_today?: boolean;
          event_mode_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["linkr_profiles"]["Insert"]>;
        Relationships: [];
      };
      linkr_actions: {
        Row: {
          id: string;
          actor_id: string;
          target_id: string;
          action: "pass" | "connect";
          event_id: string | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          actor_id: string;
          target_id: string;
          action: "pass" | "connect";
          event_id?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["linkr_actions"]["Insert"]>;
        Relationships: [];
      };
      linkr_connections: {
        Row: {
          id: string;
          user_low: string;
          user_high: string;
          event_id: string | null;
          conversation_id: string | null;
          connected_at: string;
          ended_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_low: string;
          user_high: string;
          event_id?: string | null;
          conversation_id?: string | null;
          connected_at?: string;
          ended_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["linkr_connections"]["Insert"]>;
        Relationships: [];
      };
      linkr_interests: {
        Row: {
          id: string;
          user_id: string;
          interest: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          interest: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["linkr_interests"]["Insert"]>;
        Relationships: [];
      };
      event_audience_targets: {
        Row: {
          id: string;
          event_id: string;
          target_type: EventAudienceTargetType;
          target_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          target_type: EventAudienceTargetType;
          target_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_audience_targets"]["Insert"]>;
        Relationships: [];
      };
      event_locations: {
        Row: {
          event_id: string;
          latitude: number;
          longitude: number;
          locality: string | null;
          region: string | null;
          country_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          event_id: string;
          latitude: number;
          longitude: number;
          locality?: string | null;
          region?: string | null;
          country_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_locations"]["Insert"]>;
        Relationships: [];
      };
      event_admins: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          role: EventAdminRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          role?: EventAdminRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_admins"]["Insert"]>;
        Relationships: [];
      };
      event_updates: {
        Row: {
          id: string;
          event_id: string;
          author_id: string;
          body: string;
          priority: EventUpdatePriority;
          edited_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          author_id: string;
          body: string;
          priority?: EventUpdatePriority;
          edited_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_updates"]["Insert"]>;
        Relationships: [];
      };
      event_update_reactions: {
        Row: {
          id: string;
          event_update_id: string;
          user_id: string;
          reaction_type: EventUpdateReactionType;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_update_id: string;
          user_id: string;
          reaction_type: EventUpdateReactionType;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_update_reactions"]["Insert"]>;
        Relationships: [];
      };
      event_linkr_opt_ins: {
        Row: {
          id: string;
          event_id: string;
          user_id: string;
          enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          user_id: string;
          enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_linkr_opt_ins"]["Insert"]>;
        Relationships: [];
      };
      safe_arrival_sessions: {
        Row: {
          id: string;
          traveller_id: string;
          destination_type: SafeArrivalDestinationType;
          destination_label: string;
          destination_event_id: string | null;
          expected_arrival_at: string;
          grace_period_minutes: number;
          note: string | null;
          status: SafeArrivalStatus;
          started_at: string;
          confirmed_at: string | null;
          cancelled_at: string | null;
          unconfirmed_notified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          traveller_id: string;
          destination_type?: SafeArrivalDestinationType;
          destination_label: string;
          destination_event_id?: string | null;
          expected_arrival_at: string;
          grace_period_minutes?: number;
          note?: string | null;
          status?: SafeArrivalStatus;
          started_at?: string;
          confirmed_at?: string | null;
          cancelled_at?: string | null;
          unconfirmed_notified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["safe_arrival_sessions"]["Insert"]>;
        Relationships: [];
      };
      safe_arrival_contacts: {
        Row: {
          id: string;
          session_id: string;
          contact_user_id: string;
          acknowledgement_status: SafeArrivalAcknowledgement;
          acknowledged_at: string | null;
          notified_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          contact_user_id: string;
          acknowledgement_status?: SafeArrivalAcknowledgement;
          acknowledged_at?: string | null;
          notified_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["safe_arrival_contacts"]["Insert"]>;
        Relationships: [];
      };
      safe_arrival_events: {
        Row: {
          id: string;
          session_id: string;
          event_type: SafeArrivalEventType;
          created_by: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          event_type: SafeArrivalEventType;
          created_by?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["safe_arrival_events"]["Insert"]>;
        Relationships: [];
      };
      safe_arrival_blocks: {
        Row: {
          id: string;
          user_id: string;
          blocked_traveller_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          blocked_traveller_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["safe_arrival_blocks"]["Insert"]>;
        Relationships: [];
      };
      check_ins: {
        Row: {
          id: string;
          user_id: string;
          context_type: CheckInContextType;
          context_id: string;
          method: CheckInMethod;
          visibility: CheckInVisibility;
          status: CheckInStatus;
          event_glow_enabled: boolean;
          checked_in_at: string;
          checked_out_at: string | null;
          verified_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          context_type: CheckInContextType;
          context_id: string;
          method?: CheckInMethod;
          visibility?: CheckInVisibility;
          status?: CheckInStatus;
          event_glow_enabled?: boolean;
          checked_in_at?: string;
          checked_out_at?: string | null;
          verified_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["check_ins"]["Insert"]>;
        Relationships: [];
      };
      event_circles: {
        Row: {
          id: string;
          event_id: string | null;
          owner_id: string;
          name: string;
          description: string | null;
          join_mode: EventCircleJoinMode;
          status: EventCircleStatus;
          member_visibility: EventCircleMemberVisibility;
          opens_at: string | null;
          closes_at: string | null;
          archives_at: string | null;
          max_members: number;
          /** Event Rooms productization: the "Show in event" switch. */
          listed_in_event: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id?: string | null;
          owner_id: string;
          name: string;
          description?: string | null;
          join_mode?: EventCircleJoinMode;
          status?: EventCircleStatus;
          member_visibility?: EventCircleMemberVisibility;
          opens_at?: string | null;
          closes_at?: string | null;
          archives_at?: string | null;
          max_members?: number;
          listed_in_event?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_circles"]["Insert"]>;
        Relationships: [];
      };
      event_circle_invitations: {
        Row: {
          id: string;
          event_circle_id: string;
          invited_user_id: string;
          invited_by: string;
          status: "pending" | "accepted" | "revoked";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_circle_id: string;
          invited_user_id: string;
          invited_by: string;
          status?: "pending" | "accepted" | "revoked";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_circle_invitations"]["Insert"]>;
        Relationships: [];
      };
      event_circle_group_targets: {
        Row: {
          id: string;
          event_circle_id: string;
          group_conversation_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_circle_id: string;
          group_conversation_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_circle_group_targets"]["Insert"]>;
        Relationships: [];
      };
      event_announcement_reactions: {
        Row: {
          id: string;
          event_announcement_id: string;
          user_id: string;
          reaction_type: EventUpdateReactionType;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_announcement_id: string;
          user_id: string;
          reaction_type: EventUpdateReactionType;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_announcement_reactions"]["Insert"]>;
        Relationships: [];
      };
      event_circle_members: {
        Row: {
          id: string;
          event_circle_id: string;
          user_id: string;
          role: EventCircleRole;
          status: EventCircleMemberStatus;
          joined_at: string;
          left_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_circle_id: string;
          user_id: string;
          role?: EventCircleRole;
          status?: EventCircleMemberStatus;
          joined_at?: string;
          left_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_circle_members"]["Insert"]>;
        Relationships: [];
      };
      event_announcements: {
        Row: {
          id: string;
          event_circle_id: string;
          author_id: string;
          title: string;
          body: string;
          priority: "normal" | "high";
          published_at: string;
          expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_circle_id: string;
          author_id: string;
          title: string;
          body: string;
          priority?: "normal" | "high";
          published_at?: string;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_announcements"]["Insert"]>;
        Relationships: [];
      };
      media_assets: {
        Row: {
          id: string;
          owner_id: string;
          storage_key: string;
          content_type: MediaContentType;
          size_bytes: number;
          width: number | null;
          height: number | null;
          processing_status: MediaProcessingStatus;
          moderation_status: ModerationStatus;
          context_type: MediaContextType;
          intended_conversation_id: string | null;
          intended_media_kind: "image" | "voice_note" | null;
          upload_expires_at: string | null;
          duration_ms: number | null;
          waveform_data: Json | null;
          retention_policy: MediaRetentionPolicy;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          storage_key: string;
          content_type: MediaContentType;
          size_bytes: number;
          width?: number | null;
          height?: number | null;
          processing_status?: MediaProcessingStatus;
          moderation_status?: ModerationStatus;
          context_type: MediaContextType;
          intended_conversation_id?: string | null;
          intended_media_kind?: "image" | "voice_note" | null;
          upload_expires_at?: string | null;
          duration_ms?: number | null;
          waveform_data?: Json | null;
          retention_policy?: MediaRetentionPolicy;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["media_assets"]["Insert"]>;
        Relationships: [];
      };
      media_variants: {
        Row: {
          id: string;
          media_asset_id: string;
          variant_type: MediaVariantType;
          storage_key: string;
          width: number | null;
          height: number | null;
          size_bytes: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          media_asset_id: string;
          variant_type: MediaVariantType;
          storage_key: string;
          width?: number | null;
          height?: number | null;
          size_bytes?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["media_variants"]["Insert"]>;
        Relationships: [];
      };
      media_deletion_queue: {
        Row: {
          id: string;
          media_asset_id: string;
          reason: "parent_deleted" | "parent_expired" | "user_deleted" | "moderation" | "orphaned_upload";
          queued_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          media_asset_id: string;
          reason: "parent_deleted" | "parent_expired" | "user_deleted" | "moderation" | "orphaned_upload";
          queued_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["media_deletion_queue"]["Insert"]>;
        Relationships: [];
      };
      moments: {
        Row: {
          id: string;
          author_id: string;
          content_type: MomentContentType;
          text_content: string | null;
          media_id: string | null;
          caption: string | null;
          audience_type: MomentAudienceType;
          status: MomentStatus;
          starts_at: string;
          expires_at: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          author_id: string;
          content_type: MomentContentType;
          text_content?: string | null;
          media_id?: string | null;
          caption?: string | null;
          audience_type: MomentAudienceType;
          status?: MomentStatus;
          starts_at?: string;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["moments"]["Insert"]>;
        Relationships: [];
      };
      moment_audience_targets: {
        Row: {
          id: string;
          moment_id: string;
          target_type: AudienceTargetType;
          target_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          moment_id: string;
          target_type: AudienceTargetType;
          target_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["moment_audience_targets"]["Insert"]>;
        Relationships: [];
      };
      moment_reactions: {
        Row: {
          id: string;
          moment_id: string;
          user_id: string;
          reaction_type: ReactionType;
          created_at: string;
        };
        Insert: {
          id?: string;
          moment_id: string;
          user_id: string;
          reaction_type: ReactionType;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["moment_reactions"]["Insert"]>;
        Relationships: [];
      };
      /** One row per viewer per Moment: reach, not a hit counter. */
      moment_views: {
        Row: {
          id: string;
          moment_id: string;
          viewer_id: string;
          viewed_at: string;
        };
        Insert: {
          id?: string;
          moment_id: string;
          viewer_id: string;
          viewed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["moment_views"]["Insert"]>;
        Relationships: [];
      };
      /**
       * One-way, private content interest. Deliberately not a follow graph:
       * there is no "following" direction and no creator-readable list.
       */
      tune_ins: {
        Row: {
          id: string;
          viewer_id: string;
          creator_id: string;
          /** The Spotlight Moment that led here, when there was one. */
          source_moment_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          viewer_id: string;
          creator_id: string;
          source_moment_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tune_ins"]["Insert"]>;
        Relationships: [];
      };
      muddy_drops: {
        Row: {
          id: string;
          creator_id: string;
          drop_type: DropType;
          context_type: DropContextType;
          context_id: string;
          content_type: DropContentType;
          text_content: string | null;
          media_id: string | null;
          action_type: DropActionType | null;
          action_target_id: string | null;
          status: DropStatus;
          starts_at: string;
          expires_at: string;
          max_unlocks: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          drop_type: DropType;
          context_type: DropContextType;
          context_id: string;
          content_type: DropContentType;
          text_content?: string | null;
          media_id?: string | null;
          action_type?: DropActionType | null;
          action_target_id?: string | null;
          status?: DropStatus;
          starts_at?: string;
          expires_at: string;
          max_unlocks?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["muddy_drops"]["Insert"]>;
        Relationships: [];
      };
      drop_audience_targets: {
        Row: {
          id: string;
          drop_id: string;
          target_type: AudienceTargetType;
          target_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          drop_id: string;
          target_type: AudienceTargetType;
          target_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["drop_audience_targets"]["Insert"]>;
        Relationships: [];
      };
      drop_unlocks: {
        Row: {
          id: string;
          drop_id: string;
          user_id: string;
          unlocked_at: string;
          viewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          drop_id: string;
          user_id: string;
          unlocked_at?: string;
          viewed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["drop_unlocks"]["Insert"]>;
        Relationships: [];
      };
      content_reports: {
        Row: {
          id: string;
          reporter_id: string | null;
          content_type: ReportableContentType;
          content_id: string;
          reported_user_id: string | null;
          category: ReportCategory;
          details: string | null;
          status: ContentReportStatus;
          created_at: string;
          resolved_at: string | null;
          legacy_support_request_id: string | null;
        };
        Insert: {
          id?: string;
          reporter_id?: string | null;
          content_type: ReportableContentType;
          content_id: string;
          reported_user_id?: string | null;
          category: ReportCategory;
          details?: string | null;
          status?: ContentReportStatus;
          created_at?: string;
          resolved_at?: string | null;
          legacy_support_request_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["content_reports"]["Insert"]>;
        Relationships: [];
      };
      moderation_actions: {
        Row: {
          id: string;
          report_id: string | null;
          moderator_id: string | null;
          action_type: ModerationActionType;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          report_id?: string | null;
          moderator_id?: string | null;
          action_type: ModerationActionType;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["moderation_actions"]["Insert"]>;
        Relationships: [];
      };
      hidden_content: {
        Row: {
          id: string;
          user_id: string;
          content_type: ReportableContentType;
          content_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          content_type: ReportableContentType;
          content_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hidden_content"]["Insert"]>;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          conversation_type: ConversationType;
          created_by: string | null;
          context_type: ConversationContextType | null;
          context_id: string | null;
          status: ConversationStatus;
          direct_key: string | null;
          created_at: string;
          updated_at: string;
          last_message_at: string | null;
        };
        Insert: {
          id?: string;
          conversation_type: ConversationType;
          created_by?: string | null;
          context_type?: ConversationContextType | null;
          context_id?: string | null;
          status?: ConversationStatus;
          direct_key?: string | null;
          created_at?: string;
          updated_at?: string;
          last_message_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Insert"]>;
        Relationships: [];
      };
      // ---------------------------------------------------------------
      // Chats V4 + Event Rooms tables, taken verbatim from
      // `supabase gen types typescript --linked` against PRODUCTION after
      // the coordinated migration. MERGED into this curated file rather than
      // replacing it: the generated output omits the named aliases and helpers
      // (SubscriptionPlan, legacyTierOf, ...) the rest of the codebase imports
      // from here, and swapping wholesale produced 308 type errors.
      // ---------------------------------------------------------------
      conversation_message_pins: {
        Row: {
          conversation_id: string
          id: string
          message_id: string
          pinned_at: string
          pinned_by: string | null
        }
        Insert: {
          conversation_id: string
          id?: string
          message_id: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Update: {
          conversation_id?: string
          id?: string
          message_id?: string
          pinned_at?: string
          pinned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_message_pins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_message_pins_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_polls: {
        Row: {
          allow_multiple: boolean
          closed_at: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          is_anonymous: boolean
          message_id: string
          question: string
        }
        Insert: {
          allow_multiple?: boolean
          closed_at?: string | null
          conversation_id: string
          created_at?: string
          created_by?: string | null
          is_anonymous?: boolean
          message_id: string
          question: string
        }
        Update: {
          allow_multiple?: boolean
          closed_at?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          is_anonymous?: boolean
          message_id?: string
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_polls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_polls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_poll_options: {
        Row: {
          created_at: string
          id: string
          label: string
          poll_message_id: string
          position: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          poll_message_id: string
          position: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          poll_message_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_poll_options_poll_message_id_fkey"
            columns: ["poll_message_id"]
            isOneToOne: false
            referencedRelation: "chat_polls"
            referencedColumns: ["message_id"]
          },
        ]
      }
      chat_poll_votes: {
        Row: {
          created_at: string
          option_id: string
          poll_message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          option_id: string
          poll_message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          option_id?: string
          poll_message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "chat_poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_poll_votes_poll_message_id_fkey"
            columns: ["poll_message_id"]
            isOneToOne: false
            referencedRelation: "chat_polls"
            referencedColumns: ["message_id"]
          },
        ]
      }
      saved_messages: {
        Row: {
          folder_id: string | null
          message_id: string
          saved_at: string
          user_id: string
        }
        Insert: {
          folder_id?: string | null
          message_id: string
          saved_at?: string
          user_id: string
        }
        Update: {
          folder_id?: string | null
          message_id?: string
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_messages_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "saved_message_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_message_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversation_presence: {
        Row: {
          conversation_id: string
          last_active_at: string
          presence_state: string
          present_until: string
          typing_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_active_at?: string
          presence_state?: string
          present_until: string
          typing_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_active_at?: string
          presence_state?: string
          present_until?: string
          typing_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_presence_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_chat_settings: {
        Row: {
          conversation_id: string
          default_media_mode: string
          message_lifetime_seconds: number | null
          updated_at: string
          updated_by: string | null
          who_can_add_members: string
          who_can_create_polls: string
          who_can_edit_info: string
          who_can_pin: string
          who_can_use_everyone: string
        }
        Insert: {
          conversation_id: string
          default_media_mode?: string
          message_lifetime_seconds?: number | null
          updated_at?: string
          updated_by?: string | null
          who_can_add_members?: string
          who_can_create_polls?: string
          who_can_edit_info?: string
          who_can_pin?: string
          who_can_use_everyone?: string
        }
        Update: {
          conversation_id?: string
          default_media_mode?: string
          message_lifetime_seconds?: number | null
          updated_at?: string
          updated_by?: string | null
          who_can_add_members?: string
          who_can_create_polls?: string
          who_can_edit_info?: string
          who_can_pin?: string
          who_can_use_everyone?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_chat_settings_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_user_preferences: {
        Row: {
          archived_at: string | null
          conversation_id: string
          draft_text: string | null
          draft_updated_at: string | null
          favorite_rank: number | null
          marked_unread_at: string | null
          notification_preview: string
          notify_mentions_when_muted: boolean
          notify_replies_when_muted: boolean
          reading_anchor_message_id: string | null
          reading_anchor_offset: number
          theme_key: string
          updated_at: string
          user_id: string
          voice_playback_message_id: string | null
          voice_playback_seconds: number
        }
        Insert: {
          archived_at?: string | null
          conversation_id: string
          draft_text?: string | null
          draft_updated_at?: string | null
          favorite_rank?: number | null
          marked_unread_at?: string | null
          notification_preview?: string
          notify_mentions_when_muted?: boolean
          notify_replies_when_muted?: boolean
          reading_anchor_message_id?: string | null
          reading_anchor_offset?: number
          theme_key?: string
          updated_at?: string
          user_id: string
          voice_playback_message_id?: string | null
          voice_playback_seconds?: number
        }
        Update: {
          archived_at?: string | null
          conversation_id?: string
          draft_text?: string | null
          draft_updated_at?: string | null
          favorite_rank?: number | null
          marked_unread_at?: string | null
          notification_preview?: string
          notify_mentions_when_muted?: boolean
          notify_replies_when_muted?: boolean
          reading_anchor_message_id?: string | null
          reading_anchor_offset?: number
          theme_key?: string
          updated_at?: string
          user_id?: string
          voice_playback_message_id?: string | null
          voice_playback_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_user_preferences_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_user_preferences_reading_anchor_message_id_fkey"
            columns: ["reading_anchor_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_user_preferences_voice_playback_message_id_fkey"
            columns: ["voice_playback_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_contacts: {
        Row: {
          display_name: string
          email: string | null
          message_id: string
          organization: string | null
          phone: string | null
        }
        Insert: {
          display_name: string
          email?: string | null
          message_id: string
          organization?: string | null
          phone?: string | null
        }
        Update: {
          display_name?: string
          email?: string | null
          message_id?: string
          organization?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_contacts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_places: {
        Row: {
          address_label: string | null
          area_label: string | null
          message_id: string
          place_kind: string
          place_name: string
        }
        Insert: {
          address_label?: string | null
          area_label?: string | null
          message_id: string
          place_kind?: string
          place_name: string
        }
        Update: {
          address_label?: string | null
          area_label?: string | null
          message_id?: string
          place_kind?: string
          place_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_places_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_files: {
        Row: {
          byte_size: number
          file_name: string
          media_id: string
          message_id: string
          mime_type: string
          page_count: number | null
        }
        Insert: {
          byte_size: number
          file_name: string
          media_id: string
          message_id: string
          mime_type: string
          page_count?: number | null
        }
        Update: {
          byte_size?: number
          file_name?: string
          media_id?: string
          message_id?: string
          mime_type?: string
          page_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "message_files_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_files_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_event_refs: {
        Row: {
          event_id: string | null
          message_id: string
          plan_id: string | null
        }
        Insert: {
          event_id?: string | null
          message_id: string
          plan_id?: string | null
        }
        Update: {
          event_id?: string | null
          message_id?: string
          plan_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_event_refs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_event_refs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_event_refs_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_pins: {
        Row: {
          user_id: string;
          conversation_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          conversation_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversation_pins"]["Insert"]>;
        Relationships: [];
      };
      conversation_members: {
        Row: {
          id: string;
          conversation_id: string;
          user_id: string;
          role: ConversationRole;
          status: ConversationMemberStatus;
          joined_at: string;
          left_at: string | null;
          muted_until: string | null;
          last_read_message_id: string | null;
          read_receipts_enabled: boolean;
          history_visible_from: string;
          /**
           * When this member hid the conversation from their own inbox.
           * Null means visible. Per-member: the other participant is
           * unaffected, and nothing is deleted.
           */
          hidden_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          user_id: string;
          role?: ConversationRole;
          status?: ConversationMemberStatus;
          joined_at?: string;
          left_at?: string | null;
          muted_until?: string | null;
          last_read_message_id?: string | null;
          read_receipts_enabled?: boolean;
          history_visible_from?: string;
          hidden_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversation_members"]["Insert"]>;
        Relationships: [];
      };
      group_settings: {
        Row: {
          conversation_id: string;
          name: string;
          description: string | null;
          image_media_id: string | null;
          join_mode: GroupJoinMode;
          visibility: GroupVisibility;
          history_visibility: GroupHistoryVisibility;
          posting_mode: GroupPostingMode;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          conversation_id: string;
          name: string;
          description?: string | null;
          image_media_id?: string | null;
          join_mode?: GroupJoinMode;
          visibility?: GroupVisibility;
          history_visibility?: GroupHistoryVisibility;
          posting_mode?: GroupPostingMode;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["group_settings"]["Insert"]>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string | null;
          message_type: MessageType;
          text_content: string | null;
          media_id: string | null;
          reply_to_message_id: string | null;
          system_event_type: SystemEventType | null;
          quick_action_type: QuickActionType | null;
          duration_seconds: number | null;
          waveform_data: Json | null;
          status: MessageStatus;
          client_message_id: string | null;
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
          /* Chats V4 retention, added by 20260828203000 and confirmed present
             in production. media_mode drives Keep vs 24h; expires_at is the
             canonical expiry the authorization path checks BEFORE cleanup runs;
             kept_at/kept_by record a Keep in Chat. */
          media_mode: string | null;
          expires_at: string | null;
          kept_at: string | null;
          kept_by: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id?: string | null;
          message_type?: MessageType;
          text_content?: string | null;
          media_id?: string | null;
          reply_to_message_id?: string | null;
          system_event_type?: SystemEventType | null;
          quick_action_type?: QuickActionType | null;
          duration_seconds?: number | null;
          waveform_data?: Json | null;
          status?: MessageStatus;
          client_message_id?: string | null;
          created_at?: string;
          edited_at?: string | null;
          deleted_at?: string | null;
          media_mode?: string | null;
          expires_at?: string | null;
          kept_at?: string | null;
          kept_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [];
      };
      /**
       * Structured @mentions. Identity is the user id, so a display-name
       * change cannot break or misdirect a mention. No conversation_id: it is
       * derivable from the message, and storing it twice could drift.
       */
      message_mentions: {
        Row: {
          message_id: string;
          mentioned_user_id: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          mentioned_user_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["message_mentions"]["Insert"]>;
        Relationships: [];
      };
      message_reactions: {
        Row: {
          id: string;
          message_id: string;
          user_id: string;
          reaction_type: MessageReactionType;
          created_at: string;
        };
        Insert: {
          id?: string;
          message_id: string;
          user_id: string;
          reaction_type: MessageReactionType;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["message_reactions"]["Insert"]>;
        Relationships: [];
      };
      message_hides: {
        Row: { id: string; message_id: string; user_id: string; created_at: string };
        Insert: { id?: string; message_id: string; user_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["message_hides"]["Insert"]>;
        Relationships: [];
      };
      invite_links: {
        Row: {
          id: string;
          creator_id: string;
          invite_type: InviteType;
          context_id: string | null;
          token_hash: string;
          delivery_type: InviteDeliveryType;
          status: InviteStatus;
          max_uses: number;
          uses_count: number;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          invite_type: InviteType;
          context_id?: string | null;
          token_hash: string;
          delivery_type?: InviteDeliveryType;
          status?: InviteStatus;
          max_uses?: number;
          uses_count?: number;
          expires_at: string;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["invite_links"]["Insert"]>;
        Relationships: [];
      };
      qr_sessions: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          starts_at: string;
          expires_at: string;
          used_at: string | null;
          used_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token_hash: string;
          starts_at?: string;
          expires_at: string;
          used_at?: string | null;
          used_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["qr_sessions"]["Insert"]>;
        Relationships: [];
      };
      discoverability_identifiers: {
        Row: {
          id: string;
          user_id: string;
          identifier_type: IdentifierType;
          protected_identifier: string;
          is_discoverable: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          identifier_type: IdentifierType;
          protected_identifier: string;
          is_discoverable?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["discoverability_identifiers"]["Insert"]>;
        Relationships: [];
      };
      contact_match_sessions: {
        Row: {
          id: string;
          user_id: string;
          status: ContactMatchStatus;
          submitted_count: number;
          matched_count: number;
          created_at: string;
          expires_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: ContactMatchStatus;
          submitted_count?: number;
          matched_count?: number;
          created_at?: string;
          expires_at?: string | null;
          deleted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["contact_match_sessions"]["Insert"]>;
        Relationships: [];
      };
      account_verifications: {
        Row: {
          id: string;
          user_id: string;
          verification_type: VerificationType;
          status: VerificationStatus;
          provider: string | null;
          evidence_label: string | null;
          verified_at: string | null;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          verification_type: VerificationType;
          status?: VerificationStatus;
          provider?: string | null;
          evidence_label?: string | null;
          verified_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["account_verifications"]["Insert"]>;
        Relationships: [];
      };
      account_trust_events: {
        Row: {
          id: string;
          user_id: string;
          event_type: TrustEventType;
          risk_level: "low" | "medium" | "high";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_type: TrustEventType;
          risk_level?: "low" | "medium" | "high";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["account_trust_events"]["Insert"]>;
        Relationships: [];
      };
      onboarding_progress: {
        Row: {
          user_id: string;
          current_step: OnboardingStepName;
          profile_completed_at: string | null;
          privacy_reviewed_at: string | null;
          visibility_configured_at: string | null;
          location_prompted_at: string | null;
          location_permission_result: PermissionResult | null;
          first_muddy_added_at: string | null;
          activated_at: string | null;
          completed_at: string | null;
          skipped_optional: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          current_step?: OnboardingStepName;
          profile_completed_at?: string | null;
          privacy_reviewed_at?: string | null;
          visibility_configured_at?: string | null;
          location_prompted_at?: string | null;
          location_permission_result?: PermissionResult | null;
          first_muddy_added_at?: string | null;
          activated_at?: string | null;
          completed_at?: string | null;
          skipped_optional?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["onboarding_progress"]["Insert"]>;
        Relationships: [];
      };
      activation_milestones: {
        Row: { id: string; user_id: string; milestone: MilestoneName; reached_at: string };
        Insert: { id?: string; user_id: string; milestone: MilestoneName; reached_at?: string };
        Update: Partial<Database["public"]["Tables"]["activation_milestones"]["Insert"]>;
        Relationships: [];
      };
      /**
       * Per-user Mad Buddy Access. Append-mostly: a revoke sets `revoked_at`
       * and `revoked_by`, it never deletes the row or rewrites `expires_at`,
       * because "who granted this, when, and why" is what an audit asks.
       *
       * `expires_at: null` means indefinite (staff, "until revoked").
       *
       * A partial unique index allows exactly ONE `welcome_access` row per
       * user, which is what makes the 14 days unresettable by clearing
       * cookies, reinstalling or signing out. The database refuses a second
       * one even to the service role.
       */
      access_grants: {
        Row: {
          id: string;
          user_id: string;
          source: AccessSourceName;
          starts_at: string;
          expires_at: string | null;
          granted_by: string | null;
          reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          revoked_reason: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source: AccessSourceName;
          starts_at?: string;
          expires_at?: string | null;
          granted_by?: string | null;
          reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_reason?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["access_grants"]["Insert"]>;
        Relationships: [];
      };
      /**
       * Periods where Access is open to everyone.
       *
       * One row per window, never one row per user: mass-updating users would
       * make the end of a promotion destructive, because each person must fall
       * back to whatever they independently hold. Since this table never
       * touches user rows, ending a window restores those sources by itself.
       */
      /**
       * Dedupe ledger for Welcome Access reminders.
       *
       * UNIQUE (grant_id, milestone) is what makes the reminder job safe under
       * retries and overlapping cron runs. The job claims a row BEFORE sending,
       * so a crash costs a missed reminder rather than a duplicate one.
       */
      access_reminder_log: {
        Row: {
          id: string;
          grant_id: string;
          user_id: string;
          milestone: string;
          sent_at: string;
        };
        Insert: {
          id?: string;
          grant_id: string;
          user_id: string;
          milestone: string;
          sent_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["access_reminder_log"]["Insert"]>;
        Relationships: [];
      };
      access_global_windows: {
        Row: {
          id: string;
          starts_at: string;
          expires_at: string | null;
          created_by: string;
          reason: string;
          revoked_at: string | null;
          revoked_by: string | null;
          revoked_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          starts_at?: string;
          expires_at?: string | null;
          created_by: string;
          reason: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["access_global_windows"]["Insert"]>;
        Relationships: [];
      };
      profile_field_privacy: {
        Row: {
          id: string;
          user_id: string;
          field_name: ProfileFieldName;
          visibility: ProfileFieldVisibility;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          field_name: ProfileFieldName;
          visibility: ProfileFieldVisibility;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profile_field_privacy"]["Insert"]>;
        Relationships: [];
      };
      profile_birth_details: {
        Row: {
          user_id: string;
          date_of_birth: string;
          /**
           * When the single self-serve correction was spent. NULL means it is
           * still available; a timestamp means further changes go through
           * support. Added by 20260819120000_profile_owns_identity.sql.
           */
          correction_used_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          date_of_birth: string;
          correction_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profile_birth_details"]["Insert"]>;
        Relationships: [];
      };
      birthday_notification_deliveries: {
        Row: {
          id: string;
          birthday_user_id: string;
          recipient_id: string;
          birthday_day: string;
          status: "pending" | "processing" | "delivered" | "suppressed";
          created_at: string;
          claimed_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          birthday_user_id: string;
          recipient_id: string;
          birthday_day: string;
          status?: "pending" | "processing" | "delivered" | "suppressed";
          created_at?: string;
          claimed_at?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["birthday_notification_deliveries"]["Insert"]>;
        Relationships: [];
      };
      user_interests: {
        Row: { id: string; user_id: string; interest: string; created_at: string };
        Insert: { id?: string; user_id: string; interest: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["user_interests"]["Insert"]>;
        Relationships: [];
      };
      entitlement_overrides: {
        Row: {
          id: string;
          subject_type: "user" | "workspace" | "community";
          subject_id: string;
          entitlement_key: string;
          value_type: "integer" | "boolean";
          integer_value: number | null;
          boolean_value: boolean | null;
          reason: string | null;
          starts_at: string | null;
          ends_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          subject_type?: "user" | "workspace" | "community";
          subject_id: string;
          entitlement_key: string;
          value_type: "integer" | "boolean";
          integer_value?: number | null;
          boolean_value?: boolean | null;
          reason?: string | null;
          starts_at?: string | null;
          ends_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["entitlement_overrides"]["Insert"]>;
        Relationships: [];
      };
      subscription_changes: {
        Row: {
          id: string;
          subscription_id: string | null;
          user_id: string;
          change_type: "upgrade" | "downgrade" | "cancel" | "reactivate";
          from_plan: SubscriptionPlan;
          to_plan: SubscriptionPlan;
          effective_at: string | null;
          status: "scheduled" | "applied" | "cancelled" | "failed";
          requested_at: string;
          applied_at: string | null;
          cancelled_at: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          subscription_id?: string | null;
          user_id: string;
          change_type: "upgrade" | "downgrade" | "cancel" | "reactivate";
          from_plan: SubscriptionPlan;
          to_plan: SubscriptionPlan;
          effective_at?: string | null;
          status?: "scheduled" | "applied" | "cancelled" | "failed";
          requested_at?: string;
          applied_at?: string | null;
          cancelled_at?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscription_changes"]["Insert"]>;
        Relationships: [];
      };
      downgrade_adjustments: {
        Row: {
          id: string;
          subscription_change_id: string;
          resource_type: "personal_circles" | "close_friends" | "private_groups" | "active_plans" | "storage";
          resource_id: string | null;
          selected_action: "keep" | "archive" | "revert" | "restrict";
          status: "pending" | "applied" | "failed";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          subscription_change_id: string;
          resource_type: "personal_circles" | "close_friends" | "private_groups" | "active_plans" | "storage";
          resource_id?: string | null;
          selected_action: "keep" | "archive" | "revert" | "restrict";
          status?: "pending" | "applied" | "failed";
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["downgrade_adjustments"]["Insert"]>;
        Relationships: [];
      };
      promotion_codes: {
        Row: {
          id: string;
          code_hash: string;
          discount_type: "percent" | "fixed" | "trial_extension";
          discount_value: number;
          currency: string | null;
          eligible_plans: string[];
          starts_at: string | null;
          expires_at: string | null;
          max_redemptions: number | null;
          redemptions_count: number;
          per_user_limit: number;
          status: "active" | "paused" | "expired";
          created_at: string;
        };
        Insert: {
          id?: string;
          code_hash: string;
          discount_type: "percent" | "fixed" | "trial_extension";
          discount_value: number;
          currency?: string | null;
          eligible_plans?: string[];
          starts_at?: string | null;
          expires_at?: string | null;
          max_redemptions?: number | null;
          redemptions_count?: number;
          per_user_limit?: number;
          status?: "active" | "paused" | "expired";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["promotion_codes"]["Insert"]>;
        Relationships: [];
      };
      promotion_redemptions: {
        Row: {
          id: string;
          promotion_id: string;
          user_id: string;
          subscription_id: string | null;
          redeemed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          promotion_id: string;
          user_id: string;
          subscription_id?: string | null;
          redeemed_at?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["promotion_redemptions"]["Insert"]>;
        Relationships: [];
      };
      friendship_recaps: {
        Row: {
          id: string;
          user_id: string;
          period_type: "weekly" | "monthly" | "semester" | "annual";
          period_start: string;
          period_end: string;
          summary_data: Json;
          generated_at: string;
          viewed_at: string | null;
          status: "generating" | "ready" | "failed" | "dismissed";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period_type: "weekly" | "monthly" | "semester" | "annual";
          period_start: string;
          period_end: string;
          summary_data?: Json;
          generated_at?: string;
          viewed_at?: string | null;
          status?: "generating" | "ready" | "failed" | "dismissed";
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["friendship_recaps"]["Insert"]>;
        Relationships: [];
      };
      recap_preferences: {
        Row: {
          user_id: string;
          weekly_enabled: boolean;
          monthly_enabled: boolean;
          annual_enabled: boolean;
          sharing_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          weekly_enabled?: boolean;
          monthly_enabled?: boolean;
          annual_enabled?: boolean;
          sharing_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["recap_preferences"]["Insert"]>;
        Relationships: [];
      };
      friendship_streaks: {
        Row: {
          id: string;
          friendship_id: string;
          current_weeks: number;
          longest_weeks: number;
          last_qualified_period: string | null;
          status: "active" | "paused" | "ended";
          paused_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          friendship_id: string;
          current_weeks?: number;
          longest_weeks?: number;
          last_qualified_period?: string | null;
          status?: "active" | "paused" | "ended";
          paused_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["friendship_streaks"]["Insert"]>;
        Relationships: [];
      };
      streak_qualifying_events: {
        Row: {
          id: string;
          friendship_id: string;
          actor_id: string;
          event_type: StreakEventTypeName;
          event_reference_id: string | null;
          period_key: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          friendship_id: string;
          actor_id: string;
          event_type: StreakEventTypeName;
          event_reference_id?: string | null;
          period_key: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["streak_qualifying_events"]["Insert"]>;
        Relationships: [];
      };
      achievement_definitions: {
        Row: {
          id: string;
          code: string;
          name: string;
          description: string;
          category: "connection" | "community" | "privacy" | "balance" | "safety";
          criteria_type: "first_time" | "count" | "distinct_count";
          criteria_value: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          description: string;
          category: "connection" | "community" | "privacy" | "balance" | "safety";
          criteria_type: "first_time" | "count" | "distinct_count";
          criteria_value?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["achievement_definitions"]["Insert"]>;
        Relationships: [];
      };
      user_achievements: {
        Row: {
          id: string;
          user_id: string;
          achievement_code: string;
          earned_at: string;
          viewed_at: string | null;
          shared_at: string | null;
          hidden: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          achievement_code: string;
          earned_at?: string;
          viewed_at?: string | null;
          shared_at?: string | null;
          hidden?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_achievements"]["Insert"]>;
        Relationships: [];
      };
      smart_card_acknowledgements: {
        Row: {
          id: string;
          user_id: string;
          card_id: string;
          acknowledged_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          card_id: string;
          acknowledged_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["smart_card_acknowledgements"]["Insert"]>;
        Relationships: [];
      };
      buddy_score_ledger: {
        Row: {
          id: string;
          user_id: string;
          event_type: "email_verified" | "profile_completed" | "account_quarter" | "friendship_accepted" | "plan_completed" | "safe_arrival_completed" | "achievement_earned" | "admin_correction" | "moderation_penalty";
          points_delta: number;
          source_reference: string;
          rule_version: number;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_type: "email_verified" | "profile_completed" | "account_quarter" | "friendship_accepted" | "plan_completed" | "safe_arrival_completed" | "achievement_earned" | "admin_correction" | "moderation_penalty";
          points_delta: number;
          source_reference: string;
          rule_version: number;
          metadata?: Json;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      earned_premium_rewards: {
        Row: { id: string; user_id: string; reward_plan: "buddy_plus" | "buddy_pro"; source_score_snapshot: number; grant_key: string; granted_at: string; expires_at: string; grace_ends_at: string | null; ending_notified_at: string | null; rule_version: number; status: "active" | "grace" | "expired" | "revoked"; revoked_at: string | null; revoke_reason: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; user_id: string; reward_plan: "buddy_plus" | "buddy_pro"; source_score_snapshot: number; grant_key: string; granted_at?: string; expires_at: string; grace_ends_at?: string | null; ending_notified_at?: string | null; rule_version: number; status: "active" | "grace" | "expired" | "revoked"; revoked_at?: string | null; revoke_reason?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["earned_premium_rewards"]["Insert"]>;
        Relationships: [];
      };
      engagement_preferences: {
        Row: {
          user_id: string;
          recaps_enabled: boolean;
          streaks_enabled: boolean;
          achievements_enabled: boolean;
          streak_notifications_enabled: boolean;
          daily_notification_budget: number;
          exam_mode_until: string | null;
          exam_mode_allow_close_friends: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          recaps_enabled?: boolean;
          streaks_enabled?: boolean;
          achievements_enabled?: boolean;
          streak_notifications_enabled?: boolean;
          daily_notification_budget?: number;
          exam_mode_until?: string | null;
          exam_mode_allow_close_friends?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["engagement_preferences"]["Insert"]>;
        Relationships: [];
      };
      notification_budget_usage: {
        Row: {
          id: string;
          user_id: string;
          day_key: string;
          sent_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          day_key: string;
          sent_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notification_budget_usage"]["Insert"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
        Relationships: [];
      };
      device_push_tokens: {
        Row: {
          id: string;
          user_id: string;
          token: string;
          platform: string;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          token: string;
          platform: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["device_push_tokens"]["Insert"]>;
        Relationships: [];
      };
      admin_roles: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          is_system_role: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          is_system_role?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["admin_roles"]["Insert"]>;
        Relationships: [];
      };
      admin_role_permissions: {
        Row: { id: string; role_id: string; permission_key: string; created_at: string };
        Insert: { id?: string; role_id: string; permission_key: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["admin_role_permissions"]["Insert"]>;
        Relationships: [];
      };
      admin_assignments: {
        Row: {
          id: string;
          user_id: string;
          role_id: string;
          status: "active" | "suspended" | "revoked";
          assigned_by: string | null;
          starts_at: string;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role_id: string;
          status?: "active" | "suspended" | "revoked";
          assigned_by?: string | null;
          starts_at?: string;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["admin_assignments"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "admin_assignments_role_id_fkey";
            columns: ["role_id"];
            referencedRelation: "admin_roles";
            referencedColumns: ["id"];
          }
        ];
      };
      admin_audit_events: {
        Row: {
          id: string;
          actor_id: string | null;
          actor_role: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          case_reference: string | null;
          previous_state: Json | null;
          new_state: Json | null;
          reason: string | null;
          auth_strength: "password" | "mfa" | "step_up" | "break_glass" | null;
          session_reference: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          actor_role?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          case_reference?: string | null;
          previous_state?: Json | null;
          new_state?: Json | null;
          reason?: string | null;
          auth_strength?: "password" | "mfa" | "step_up" | "break_glass" | null;
          session_reference?: string | null;
          created_at?: string;
        };
        // Append-only: a database trigger rejects UPDATE and DELETE.
        Update: never;
        Relationships: [];
      };
      sensitive_access_log: {
        Row: {
          id: string;
          actor_id: string | null;
          category: string;
          subject_user_id: string | null;
          case_reference: string | null;
          reason: string;
          approved_by: string | null;
          accessed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          category: string;
          subject_user_id?: string | null;
          case_reference?: string | null;
          reason: string;
          approved_by?: string | null;
          accessed_at?: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      trust_safety_cases: {
        Row: {
          id: string;
          case_type: string;
          priority: "level_1" | "level_2" | "level_3" | "level_4";
          status: string;
          subject_user_id: string | null;
          created_from_report_id: string | null;
          assigned_to: string | null;
          opened_at: string;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          case_type: string;
          priority?: "level_1" | "level_2" | "level_3" | "level_4";
          status?: string;
          subject_user_id?: string | null;
          created_from_report_id?: string | null;
          assigned_to?: string | null;
          opened_at?: string;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["trust_safety_cases"]["Insert"]>;
        Relationships: [];
      };
      case_evidence: {
        Row: {
          id: string;
          case_id: string;
          evidence_type: string;
          protected_reference: string;
          access_level: "level_1" | "level_2" | "level_3" | "level_4";
          retention_expires_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_id: string;
          evidence_type: string;
          protected_reference: string;
          access_level?: "level_1" | "level_2" | "level_3" | "level_4";
          retention_expires_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["case_evidence"]["Insert"]>;
        Relationships: [];
      };
      case_actions: {
        Row: {
          id: string;
          case_id: string;
          actor_id: string | null;
          action_type: string;
          target_type: string | null;
          target_id: string | null;
          reason_code: string | null;
          starts_at: string;
          ends_at: string | null;
          reversed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_id: string;
          actor_id?: string | null;
          action_type: string;
          target_type?: string | null;
          target_id?: string | null;
          reason_code?: string | null;
          starts_at?: string;
          ends_at?: string | null;
          reversed_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["case_actions"]["Insert"]>;
        Relationships: [];
      };
      user_restrictions: {
        Row: {
          id: string;
          user_id: string;
          restriction_type: string;
          case_id: string | null;
          reason_code: string | null;
          starts_at: string;
          ends_at: string | null;
          lifted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          restriction_type: string;
          case_id?: string | null;
          reason_code?: string | null;
          starts_at?: string;
          ends_at?: string | null;
          lifted_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_restrictions"]["Insert"]>;
        Relationships: [];
      };
      support_tickets: {
        Row: {
          id: string;
          user_id: string | null;
          category: string;
          subject: string;
          description: string;
          diagnostics: Json;
          priority: "low" | "normal" | "high" | "urgent";
          status: string;
          assigned_to: string | null;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          category: string;
          subject: string;
          description: string;
          diagnostics?: Json;
          priority?: "low" | "normal" | "high" | "urgent";
          status?: string;
          assigned_to?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["support_tickets"]["Insert"]>;
        Relationships: [];
      };
      tier_entitlement_overrides: {
        Row: {
          id: string;
          plan: SubscriptionPlan;
          entitlement_key: string;
          value_type: "number" | "boolean";
          numeric_value: number | null;
          is_unlimited: boolean;
          boolean_value: boolean | null;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan: SubscriptionPlan;
          entitlement_key: string;
          value_type: "number" | "boolean";
          numeric_value?: number | null;
          is_unlimited?: boolean;
          boolean_value?: boolean | null;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tier_entitlement_overrides"]["Insert"]>;
        Relationships: [];
      };
      friend_glow_colors: {
        Row: {
          owner_id: string;
          friend_id: string;
          color_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          owner_id: string;
          friend_id: string;
          color_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["friend_glow_colors"]["Insert"]>;
        Relationships: [];
      };
      maintenance_mode: {
        Row: {
          id: boolean;
          is_active: boolean;
          message: string | null;
          activated_by: string | null;
          activated_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          is_active?: boolean;
          message?: string | null;
          activated_by?: string | null;
          activated_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["maintenance_mode"]["Insert"]>;
        Relationships: [];
      };
      support_ticket_messages: {
        Row: {
          id: string;
          ticket_id: string;
          sender_type: "user" | "agent" | "system";
          sender_id: string | null;
          message: string;
          attachment_media_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          sender_type: "user" | "agent" | "system";
          sender_id?: string | null;
          message: string;
          attachment_media_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_ticket_messages"]["Insert"]>;
        Relationships: [];
      };
      support_internal_notes: {
        Row: {
          id: string;
          ticket_id: string;
          author_id: string | null;
          body: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          author_id?: string | null;
          body: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_internal_notes"]["Insert"]>;
        Relationships: [];
      };
      support_ticket_events: {
        Row: {
          id: string;
          ticket_id: string;
          actor_id: string | null;
          event_type:
            | "status_changed"
            | "priority_changed"
            | "assigned"
            | "unassigned"
            | "transferred"
            | "reopened"
            | "response_sent"
            | "note_added";
          from_value: string | null;
          to_value: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          actor_id?: string | null;
          event_type:
            | "status_changed"
            | "priority_changed"
            | "assigned"
            | "unassigned"
            | "transferred"
            | "reopened"
            | "response_sent"
            | "note_added";
          from_value?: string | null;
          to_value?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["support_ticket_events"]["Insert"]>;
        Relationships: [];
      };
      appeals: {
        Row: {
          id: string;
          subject_user_id: string;
          source_action_id: string | null;
          source_restriction_id: string | null;
          reason: string;
          status: "submitted" | "in_review" | "decided" | "withdrawn";
          submitted_at: string;
          assigned_to: string | null;
          decided_at: string | null;
          decision: "upheld" | "modified" | "reversed" | null;
          decision_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          subject_user_id: string;
          source_action_id?: string | null;
          source_restriction_id?: string | null;
          reason: string;
          status?: "submitted" | "in_review" | "decided" | "withdrawn";
          submitted_at?: string;
          assigned_to?: string | null;
          decided_at?: string | null;
          decision?: "upheld" | "modified" | "reversed" | null;
          decision_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["appeals"]["Insert"]>;
        Relationships: [];
      };
      security_incidents: {
        Row: {
          id: string;
          title: string;
          severity: "sev_1" | "sev_2" | "sev_3" | "sev_4";
          status: string;
          incident_type: string;
          commander_id: string | null;
          detected_at: string;
          contained_at: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          severity: "sev_1" | "sev_2" | "sev_3" | "sev_4";
          status?: string;
          incident_type: string;
          commander_id?: string | null;
          detected_at?: string;
          contained_at?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["security_incidents"]["Insert"]>;
        Relationships: [];
      };
      incident_actions: {
        Row: {
          id: string;
          incident_id: string;
          actor_id: string | null;
          action_type: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          incident_id: string;
          actor_id?: string | null;
          action_type: string;
          description?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["incident_actions"]["Insert"]>;
        Relationships: [];
      };
      emergency_controls: {
        Row: {
          control_key: string;
          is_disabled: boolean;
          reason: string | null;
          incident_id: string | null;
          disabled_by: string | null;
          disabled_at: string | null;
          updated_at: string;
        };
        Insert: {
          control_key: string;
          is_disabled?: boolean;
          reason?: string | null;
          incident_id?: string | null;
          disabled_by?: string | null;
          disabled_at?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["emergency_controls"]["Insert"]>;
        Relationships: [];
      };
      privacy_requests: {
        Row: {
          id: string;
          user_id: string;
          request_type: string;
          status: string;
          verified_at: string | null;
          submitted_at: string;
          completed_at: string | null;
          assigned_to: string | null;
          legal_hold_reason: string | null;
          legal_hold_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          request_type: string;
          status?: string;
          verified_at?: string | null;
          submitted_at?: string;
          completed_at?: string | null;
          assigned_to?: string | null;
          legal_hold_reason?: string | null;
          legal_hold_expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["privacy_requests"]["Insert"]>;
        Relationships: [];
      };
      feature_flags: {
        Row: {
          id: string;
          key: string;
          description: string | null;
          status: "off" | "on" | "rollout" | "archived";
          default_value: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          key: string;
          description?: string | null;
          status?: "off" | "on" | "rollout" | "archived";
          default_value?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["feature_flags"]["Insert"]>;
        Relationships: [];
      };
      feature_flag_rules: {
        Row: {
          id: string;
          feature_flag_id: string;
          target_type: string;
          target_value: string | null;
          rollout_percentage: number | null;
          starts_at: string | null;
          ends_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          feature_flag_id: string;
          target_type: string;
          target_value?: string | null;
          rollout_percentage?: number | null;
          starts_at?: string | null;
          ends_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["feature_flag_rules"]["Insert"]>;
        Relationships: [];
      };
      experiments: {
        Row: {
          id: string;
          key: string;
          name: string;
          description: string;
          hypothesis: string;
          status: ExperimentStatus;
          parent_feature_flag_id: string | null;
          allocation_percentage: number;
          audience: ExperimentAudience;
          target_platforms: ExperimentPlatform[];
          target_plans: SubscriptionPlan[];
          conflict_group: string | null;
          starts_at: string | null;
          ends_at: string | null;
          primary_metric: string;
          secondary_metrics: string[];
          guardrail_metrics: string[];
          created_by: string;
          started_at: string | null;
          paused_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          name: string;
          description: string;
          hypothesis: string;
          status?: ExperimentStatus;
          parent_feature_flag_id?: string | null;
          allocation_percentage?: number;
          audience?: ExperimentAudience;
          target_platforms?: ExperimentPlatform[];
          target_plans?: SubscriptionPlan[];
          conflict_group?: string | null;
          starts_at?: string | null;
          ends_at?: string | null;
          primary_metric: string;
          secondary_metrics?: string[];
          guardrail_metrics?: string[];
          created_by: string;
          started_at?: string | null;
          paused_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["experiments"]["Insert"]>;
        Relationships: [];
      };
      experiment_variants: {
        Row: {
          id: string;
          experiment_id: string;
          key: string;
          name: string;
          description: string;
          weight_basis_points: number;
          is_control: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          experiment_id: string;
          key: string;
          name: string;
          description?: string;
          weight_basis_points: number;
          is_control?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["experiment_variants"]["Insert"]>;
        Relationships: [];
      };
      experiment_testers: {
        Row: {
          id: string;
          experiment_id: string;
          user_id: string | null;
          added_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          experiment_id: string;
          user_id: string;
          added_by: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["experiment_testers"]["Insert"]>;
        Relationships: [];
      };
      experiment_assignments: {
        Row: {
          id: string;
          experiment_id: string;
          user_id: string | null;
          variant_id: string;
          assigned_plan: SubscriptionPlan;
          assigned_platform: ExperimentPlatform;
          assigned_at: string;
        };
        Insert: {
          id?: string;
          experiment_id: string;
          user_id: string;
          variant_id: string;
          assigned_plan: SubscriptionPlan;
          assigned_platform: ExperimentPlatform;
          assigned_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["experiment_assignments"]["Insert"]>;
        Relationships: [];
      };
      experiment_exposures: {
        Row: {
          id: string;
          experiment_id: string;
          assignment_id: string;
          user_id: string | null;
          variant_id: string;
          platform: ExperimentPlatform;
          first_exposed_at: string;
        };
        Insert: {
          id?: string;
          experiment_id: string;
          assignment_id: string;
          user_id: string;
          variant_id: string;
          platform: ExperimentPlatform;
          first_exposed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["experiment_exposures"]["Insert"]>;
        Relationships: [];
      };
      relationship_notes: {
        Row: {
          id: string;
          author_id: string;
          subject_id: string;
          body: string;
          created_at: string;
          updated_at: string;
          source: "user";
        };
        Insert: {
          id?: string;
          author_id: string;
          subject_id: string;
          body: string;
          created_at?: string;
          updated_at?: string;
          source?: "user";
        };
        Update: Partial<Database["public"]["Tables"]["relationship_notes"]["Insert"]>;
        Relationships: [];
      };
      life_timeline_resets: {
        Row: {
          id: string;
          user_id: string;
          relationship_id: string;
          hidden_before: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          relationship_id: string;
          hidden_before?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["life_timeline_resets"]["Insert"]>;
        Relationships: [];
      };
      scheduler_incidents: {
        Row: {
          id: string;
          scheduler: string;
          opened_at: string;
          resolved_at: string | null;
          consecutive_failures: number;
          missing_ticks: boolean;
          alerted_at: string | null;
          recovery_notified_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          scheduler?: string;
          opened_at?: string;
          resolved_at?: string | null;
          consecutive_failures?: number;
          missing_ticks?: boolean;
          alerted_at?: string | null;
          recovery_notified_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["scheduler_incidents"]["Insert"]>;
        Relationships: [];
      };
      jobs: {
        Row: {
          id: string;
          job_type: string;
          payload: Json;
          priority: number;
          status: "queued" | "scheduled" | "processing" | "completed" | "failed" | "retrying" | "dead_letter";
          attempts: number;
          max_attempts: number;
          run_at: string;
          locked_at: string | null;
          locked_by: string | null;
          last_error_code: string | null;
          last_error_at: string | null;
          idempotency_key: string | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          job_type: string;
          payload?: Json;
          priority?: number;
          status?: "queued" | "scheduled" | "processing" | "completed" | "failed" | "retrying" | "dead_letter";
          attempts?: number;
          max_attempts?: number;
          run_at?: string;
          locked_at?: string | null;
          locked_by?: string | null;
          last_error_code?: string | null;
          last_error_at?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["jobs"]["Insert"]>;
        Relationships: [];
      };
      idempotency_keys: {
        Row: {
          id: string;
          user_id: string | null;
          scope: string;
          key: string;
          result: Json | null;
          status: "in_progress" | "completed" | "failed";
          expires_at: string;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          scope: string;
          key: string;
          result?: Json | null;
          status?: "in_progress" | "completed" | "failed";
          expires_at?: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["idempotency_keys"]["Insert"]>;
        Relationships: [];
      };
      domain_events: {
        Row: {
          id: string;
          event_type: string;
          version: number;
          resource_type: string;
          resource_id: string | null;
          actor_id: string | null;
          payload: Json;
          occurred_at: string;
          created_at: string;
          dedupe_key: string | null;
          feature_key: string | null;
          subscription_plan: SubscriptionProduct;
        };
        Insert: {
          id?: string;
          event_type: string;
          version?: number;
          resource_type: string;
          resource_id?: string | null;
          actor_id?: string | null;
          payload?: Json;
          occurred_at?: string;
          created_at?: string;
          dedupe_key?: string | null;
          feature_key?: string | null;
          subscription_plan?: SubscriptionProduct;
        };
        // Append-only: a database trigger rejects UPDATE and DELETE.
        Update: never;
        Relationships: [];
      };
      analytics_daily_user_facts: {
        Row: {
          id: string;
          event_date: string;
          user_id: string;
          event_name: string;
          feature_key: string;
          subscription_plan: SubscriptionProduct;
          action_count: number;
          first_occurred_at: string;
          last_occurred_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_date: string;
          user_id: string;
          event_name: string;
          feature_key?: string;
          subscription_plan?: SubscriptionProduct;
          action_count?: number;
          first_occurred_at: string;
          last_occurred_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["analytics_daily_user_facts"]["Insert"]>;
        Relationships: [];
      };
      privacy_setup_versions: {
        Row: {
          user_id: string;
          policy_version: string;
          setup_completed_at: string | null;
          last_reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          policy_version: string;
          setup_completed_at?: string | null;
          last_reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["privacy_setup_versions"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      save_profile_date_of_birth: {
        Args: { p_date: string };
        Returns: Array<{ outcome: "created" | "unchanged" | "corrected"; can_correct: boolean }>;
      };
      linkr_record_connect: {
        Args: { p_actor: string; p_target: string; p_event_id?: string | null };
        Returns: Array<{ matched: boolean; connection_id: string | null; created: boolean }>;
      };
      create_upfor_session: {
        Args: {
          p_activity_type: string;
          p_message: string | null;
          p_audience_type: string;
          p_broad_area_text: string | null;
          p_discovery_scope: string;
          p_starts_at: string;
          p_ends_at: string;
          p_timezone: string;
          p_max_participants: number;
          p_allow_pings: boolean;
          p_allow_friend_invites: boolean;
          p_area_tier: string | null;
          p_area_derived_at: string | null;
          p_limit: number;
        };
        Returns: Database["public"]["Tables"]["hangout_sessions"]["Row"];
      };
      create_plan_lifecycle: {
        Args: {
          p_actor_id: string;
          p_request_key: string;
          p_title: string;
          p_description: string | null;
          p_plan_type: string;
          p_start_at: string | null;
          p_end_at: string | null;
          p_timezone: string;
          p_rsvp_deadline: string | null;
          p_place_type: string;
          p_custom_place_text: string | null;
          p_reminder_minutes: number | null;
          p_category: string | null;
          p_invitee_ids: string[];
          p_initial_going_ids: string[];
          p_source_hangout_id: string | null;
          p_effective_max_active_plans: number;
          p_effective_max_participants: number;
        };
        Returns: Array<{ plan_id: string; conversation_id: string; created: boolean }>;
      };
      set_plan_participant_rsvp: {
        Args: { p_actor_id: string; p_plan_id: string; p_status: string };
        Returns: Array<{ rsvp_status: string; conversation_id: string }>;
      };
      add_plan_participants: {
        Args: {
          p_actor_id: string;
          p_plan_id: string;
          p_participant_ids: string[];
          p_effective_max_participants: number;
        };
        Returns: Array<{ added_count: number; conversation_id: string }>;
      };
      reconcile_plan_conversation_members: {
        Args: { p_plan_id: string };
        Returns: string;
      };
      // Event Rooms lifecycle authority (20260827120000_event_rooms_productization).
      reconcile_event_room_conversation: {
        Args: { p_room_id: string };
        Returns: string;
      };
      create_event_room: {
        Args: {
          p_owner_id: string;
          p_event_id: string | null;
          p_name: string;
          p_description: string | null;
          p_join_mode: string;
          p_max_members: number;
          p_listed: boolean;
          p_group_conversation_ids?: string[];
        };
        Returns: string;
      };
      join_event_room: {
        Args: { p_room_id: string; p_user_id: string };
        Returns: string;
      };
      set_event_room_membership: {
        Args: { p_room_id: string; p_user_id: string; p_status: string };
        Returns: string;
      };
      set_event_room_role: {
        Args: { p_room_id: string; p_user_id: string; p_role: string };
        Returns: string;
      };
      archive_event_room: {
        Args: { p_room_id: string; p_archives_at: string | null };
        Returns: string;
      };
      close_event_rooms_for_event: {
        Args: { p_event_id: string };
        Returns: number;
      };
      queue_stale_unattached_chat_media: {
        Args: {
          p_ready_before: string;
          p_incomplete_before: string;
          p_limit?: number;
        };
        Returns: number;
      };
      buddy_score_total: {
        Args: { target_user_id: string };
        Returns: Array<{ score_total: number }>;
      };
      get_revenue_subscription_snapshot: {
        Args: { p_now?: string };
        Returns: Array<{
          stored_plan: SubscriptionPlan;
          effective_plan: SubscriptionPlan;
          in_grace: boolean;
          grace_expired: boolean;
          user_count: number;
        }>;
      };
      get_admin_media_storage_summary: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          context_type: string;
          content_type: string;
          object_count: number;
          original_bytes: number;
          variant_bytes: number;
        }>;
      };
      record_product_event: {
        Args: {
          p_event_name: string;
          p_actor_id: string;
          p_resource_type: string;
          p_resource_id: string;
          p_feature_key?: string;
          p_occurred_at?: string;
        };
        Returns: string | null;
      };
      record_user_tour_progress: {
        Args: {
          p_user_id: string;
          p_tour_version_id: string;
          p_status: string;
          p_current_step_key?: string | null;
        };
        Returns: string;
      };
      create_experiment_definition: {
        Args: { p_definition: Json; p_created_by: string };
        Returns: string;
      };
      /**
       * Atomic Safe Arrival start: the session, its watcher rows and the
       * 'created' audit event in one transaction. Returns the session id, and
       * replays the same id for a duplicate submit within two minutes.
       */
      /**
       * Public tune-in totals. security definer so it can COUNT rows the caller
       * cannot read individually — the asymmetry that keeps identities private
       * while the aggregate stays visible.
       */
      tune_in_counts: {
        Args: { creator_ids: string[] };
        Returns: { creator_id: string; tuned_in_count: number }[];
      };
      /** Per-Moment aggregates: views, reactions, attributed tune-ins. */
      moment_engagement: {
        Args: { moment_ids: string[] };
        Returns: { moment_id: string; view_count: number; reaction_count: number; tuned_in_count: number }[];
      };
      start_safe_arrival: {
        Args: {
          p_traveller_id: string;
          p_destination_label: string;
          p_expected_arrival_at: string;
          p_grace_period_minutes: number;
          p_note: string | null;
          p_contact_ids: string[];
          p_max_active: number;
        };
        Returns: string;
      };
      process_experiment_schedules: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      feature_flag_enabled_for_subject: {
        Args: {
          p_flag_id: string;
          p_user_id: string;
          p_plan: SubscriptionPlan;
          p_platform: ExperimentPlatform;
          p_now: string;
        };
        Returns: boolean;
      };
      resolve_experiment_assignment: {
        Args: {
          p_experiment_key: string;
          p_user_id: string;
          p_platform: ExperimentPlatform;
        };
        Returns: Array<{
          experiment_id: string;
          assignment_id: string;
          variant_key: string;
          variant_name: string;
          is_control: boolean;
        }>;
      };
      record_experiment_exposure: {
        Args: {
          p_experiment_key: string;
          p_user_id: string;
          p_platform: ExperimentPlatform;
        };
        Returns: Array<{
          experiment_id: string;
          assignment_id: string;
          variant_key: string;
          variant_name: string;
          is_control: boolean;
          first_exposure: boolean;
        }>;
      };
      start_premium_trial: {
        Args: {
          p_user_id: string;
          p_owner_override?: boolean;
          p_granted_by?: string | null;
          p_override_reason?: string | null;
          p_override_plan?: SubscriptionPlan | null;
          p_source?: string;
        };
        Returns: Database["public"]["Tables"]["premium_trials"]["Row"];
      };
      convert_premium_trial: {
        Args: { p_user_id: string; p_paid_plan: SubscriptionPlan };
        Returns: string | null;
      };
      end_premium_trial: {
        Args: { p_trial_id: string; p_action: string; p_actor_id?: string | null; p_reason?: string | null };
        Returns: boolean;
      };
      process_premium_trial_lifecycle: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      claim_premium_trial_notifications: {
        Args: { p_limit?: number };
        Returns: Database["public"]["Tables"]["premium_trial_notifications"]["Row"][];
      };
      birthday_users_for_day: {
        Args: { p_month: number; p_day: number; p_include_feb_29?: boolean };
        Returns: Array<{ user_id: string }>;
      };
      // Stage 3B. Pending migration 20260807120000_group_role_architecture;
      // typed now so the action compiles against the schema it will run on.
      transfer_group_ownership: {
        Args: { p_conversation_id: string; p_new_owner_id: string };
        Returns: undefined;
      };
      accept_friend_request: {
        Args: { p_request_id: string };
        // `reactivated` is optional because the Phase 3.2B migration that adds
        // it is still pending: against today's database the column is absent,
        // and a required field would be a type that lies about production.
        // Callers must treat `undefined` as "not a reactivation".
        Returns: Array<{ sender_id: string; receiver_id: string; reactivated?: boolean }>;
      };
      consume_rate_limit: {
        Args: {
          p_user_id: string | null;
          p_ip_hash: string | null;
          p_action: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: Array<{
          allowed: boolean;
          remaining: number;
          reset_at: string;
        }>;
      };
      admin_cron_tick_runs: {
        Args: { p_limit?: number };
        Returns: Array<{ started_at: string; status: string; return_message: string | null }>;
      };
      claim_jobs: {
        Args: { p_worker: string; p_limit: number; p_stale_seconds?: number };
        Returns: Database["public"]["Tables"]["jobs"]["Row"][];
      };
      cleanup_expired_private_location: { Args: Record<string, never>; Returns: number };
      cleanup_expired_proximity_events: { Args: Record<string, never>; Returns: number };
      location_confidence_for_accuracy: {
        Args: { location_accuracy: number };
        Returns: LocationConfidence;
      };
      prepare_deleted_user_reports: { Args: { target_user_id: string }; Returns: undefined };
      admin_tour_analytics: {
        Args: { p_tour_version_id: string };
        Returns: Array<{
          scope: string;
          step_id: string | null;
          event_type: string;
          subscription_plan: SubscriptionPlan | null;
          event_count: number;
          user_count: number;
        }>;
      };
      admin_tour_eligible_count: {
        Args: { p_tour_version_id: string };
        Returns: number;
      };
      get_cancellation_reason_counts: {
        Args: { p_since: string };
        Returns: Array<{ reason: string; count: number }>;
      };
      admin_daily_signup_counts: {
        Args: { p_since: string };
        Returns: Array<{ day: string; count: number }>;
      };
      admin_active_plan_mix: {
        Args: Record<string, never>;
        Returns: Array<{ plan: string; count: number }>;
      };
      conversation_previews: {
        Args: { p_user_id: string; p_conversation_ids: string[] };
        Returns: Array<{
          conversation_id: string;
          last_text: string | null;
          last_message_type: string | null;
          last_created_at: string | null;
          unread_count: number;
          /**
           * Newest NON-SYSTEM message, or null when a conversation holds only
           * system events. The authority for un-hiding a conversation --
           * deliberately distinct from conversations.last_message_at, which
           * system events also advance.
           */
          last_user_message_at: string | null;
        }>;
      };
    };
    Enums: {
      friend_request_status: FriendRequestStatus;
      visibility_status: VisibilityStatus;
      location_confidence: LocationConfidence;
      proximity_level: ProximityLevel;
      subscription_plan: SubscriptionProduct;
      subscription_status: SubscriptionStatus;
      report_status: ReportStatus;
      meetup_status: MeetupStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type AvailabilityType =
  | "free"
  | "open_to_hang_out"
  | "maybe_available"
  | "busy"
  | "do_not_disturb";

export type ActivityType =
  | "studying"
  | "working"
  | "eating"
  | "at_an_event"
  | "exercising"
  | "gaming"
  | "travelling"
  | "heading_home"
  | "relaxing";

export type StatusVisibilityType = "all_muddies" | "selected_circles" | "selected_muddies";

export type WaveSource = "proximity_card" | "profile" | "chat" | "status" | "wave_back";

export type WaveResponseType = "wave_back" | "message" | "meeting_ping" | "none";

export type PingType = "meet" | "food" | "study" | "chat" | "walk" | "custom";

export type PingStatus =
  | "pending"
  | "seen"
  | "maybe"
  | "counter_proposed"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired"
  | "completed";

export type PingResponseType = "accept" | "maybe" | "decline" | "counter_propose" | "message";

export type CloseFriendNotificationPreference =
  | "always"
  | "meeting_pings_only"
  | "very_close_only"
  | "status_changes"
  | "normal";

export type VisibilityFeatureType = "glow" | "status" | "wave" | "meeting_ping";

export type VisibilityMode = "all_muddies" | "selected_circles" | "close_friends" | "hidden";

// --- Batch 3: Plans, RSVP, Polls, Hangout Mode ---

export type PlanType = "quick" | "scheduled" | "poll";

/**
 * What a plan IS, used to resolve its canonical cover illustration.
 *
 * Deliberately separate from PlanType, which describes how the plan is
 * SCHEDULED (quick / scheduled / poll) and says nothing about its subject.
 * Mirrors the plans_category_check constraint; adding a value here means
 * adding it there and registering an illustration in lib/plans/plan-covers.
 */
export type PlanCategory =
  | "beach"
  | "dinner"
  | "coffee"
  | "study"
  | "movie"
  | "football"
  | "gaming"
  | "concert"
  | "birthday"
  | "travel"
  | "workout"
  | "party"
  | "picnic"
  | "hiking"
  | "road_trip";
export type PlanVisibilityType = "invited" | "circle" | "close_friends";
export type PlanStatus =
  | "draft"
  | "inviting"
  | "polling"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "expired";
export type PlanPlaceType = "custom" | "decide_in_chat" | "poll";
export type PlanRole = "host" | "co_host" | "participant";
export type RsvpStatus =
  | "invited"
  | "viewed"
  | "going"
  | "maybe"
  | "not_going"
  | "removed"
  | "waitlisted";
export type AttendanceVisibility = "names" | "counts" | "host_only";

export type PollType = "time" | "date" | "place" | "activity";
export type PollSelectionMode = "single" | "multiple";
export type PollResultsVisibility = "immediate" | "after_vote" | "after_close" | "host_only";
export type PollStatus = "open" | "closed" | "confirmed";

export type HangoutActivityType =
  // The original eight. `sports` and `chill` are retained deliberately: see
  // the 20260822120000 migration for why neither was rewritten.
  | "food"
  | "study"
  | "sports"
  | "gym"
  | "walk"
  | "gaming"
  | "chill"
  | "anything"
  // Added for the approved UpFor screen.
  | "coffee"
  | "football"
  | "drinks"
  | "movie"
  | "drive"
  | "party";
export type HangoutAudienceType =
  | "all_muddies"
  | "close_friends"
  | "selected_circles"
  | "selected_muddies"
  /** Visible inside specific PUBLIC groups. Never a private Circle. */
  | "selected_groups";
export type HangoutStatus =
  | "draft"
  | "active"
  | "paused"
  | "full"
  | "expired"
  | "cancelled"
  | "converted_to_plan";
export type HangoutRequestStatus = "pending" | "accepted" | "maybe" | "declined" | "cancelled";

// --- Batch 5: Safe Arrival, Check-ins, Event Glow, Event Circles ---

export type EventVisibility =
  | "invite"
  | "link"
  | "community"
  /** Eligible for geographic discovery from the published Event location. */
  | "nearby"
  /** Eligible for broad discovery and ranking. */
  | "public";

export type EventAudienceTargetType = "user" | "community";

export type EventAdminRole = "admin";

export type EventUpdatePriority = "normal" | "high";

/** One active reaction per person per Update. */
export type EventUpdateReactionType = "heart" | "fire" | "applause" | "wow";
export type EventStatus = "draft" | "scheduled" | "active" | "ended" | "cancelled";
export type EventRsvpStatus = "interested" | "going" | "not_going";

export type SafeArrivalDestinationType = "custom" | "place" | "event";
export type SafeArrivalStatus =
  | "draft"
  | "pending_acknowledgement"
  | "active"
  | "grace_period"
  | "extended"
  | "completed"
  | "cancelled"
  | "expired"
  | "unconfirmed";
export type SafeArrivalAcknowledgement = "pending" | "watching" | "declined";
export type SafeArrivalEventType =
  | "created"
  | "acknowledged"
  | "declined"
  | "extended"
  | "confirmed"
  | "cancelled"
  | "unconfirmed_alert";

export type CheckInContextType = "event" | "plan" | "place" | "circle";
export type CheckInMethod = "manual" | "qr" | "code" | "host_assisted";
export type CheckInVisibility = "private" | "participants" | "selected_muddies" | "anonymous_count";
export type CheckInStatus = "checked_in" | "checked_out" | "revoked" | "invalidated";

export type EventCircleJoinMode = "invite" | "check_in" | "qr" | "community";
export type EventCircleStatus = "draft" | "open" | "active" | "closing" | "archived" | "deleted";
export type EventCircleMemberVisibility = "members" | "count_only" | "host_only";
export type EventCircleRole = "host" | "co_host" | "moderator" | "member";
export type EventCircleMemberStatus = "joined" | "left" | "removed" | "banned";

// --- Batch 6: Moments, Drops, Private Media, Content Safety ---

export type MediaContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "audio/webm"
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/ogg"
  | "video/mp4"
  | "video/webm"
  | "video/quicktime";
export type MediaProcessingStatus = "pending" | "processing" | "ready" | "failed" | "quarantined";
export type MediaContextType = "profile" | "moment" | "drop" | "event" | "plan" | "chat" | "group";
export type MediaRetentionPolicy = "follows_parent" | "keep_30d" | "legal_hold";
export type MediaVariantType = "thumb" | "feed" | "full";

/** Shared moderation lifecycle for content and media (spec §52). */
export type ModerationStatus =
  | "active"
  | "under_review"
  | "restricted"
  | "removed"
  | "restored"
  | "deleted_by_user";

export type MomentContentType = "text" | "photo" | "video";
export type DropContentType = "text" | "photo";
export type MomentAudienceType =
  | "all_muddies"
  | "close_friends"
  | "selected_muddies"
  | "selected_circles"
  | "nearby_muddies"
  | "event_circle"
  | "plan"
  | "public";
export type MomentStatus =
  | "active"
  | "under_review"
  | "restricted"
  | "removed"
  | "deleted_by_user"
  | "expired";
export type AudienceTargetType = "user" | "circle" | "event_circle" | "plan";
export type ReactionType = "heart" | "laugh" | "wave" | "fire" | "clap";

export type DropType = "circle" | "plan" | "event";
export type DropContextType = "circle" | "plan" | "event" | "event_circle";
export type DropActionType = "open_chat" | "join_plan" | "wave" | "rsvp" | "view_announcement";
export type DropStatus = "draft" | "scheduled" | "active" | "expired" | "cancelled" | "removed";

export type ReportableContentType = "moment" | "drop" | "message" | "profile" | "announcement" | "plan";
export type ReportCategory =
  | "harassment"
  | "threat_or_violence"
  | "sexual_content"
  | "hate_or_discrimination"
  | "spam"
  | "scam"
  | "impersonation"
  | "private_information"
  | "unwanted_contact"
  | "dangerous_location_sharing"
  | "other";
export type ContentReportStatus = "received" | "under_review" | "actioned" | "dismissed";
// --- Batch 7: Messaging, Group Chat, Plan Chat, Voice Notes ---

export type ConversationType = "direct" | "group" | "plan" | "event" | "safe_arrival";
export type ConversationContextType = "plan" | "event" | "event_circle" | "safe_arrival" | "ping" | "wave";
export type ConversationStatus = "active" | "archived" | "restricted" | "deleted";
export type ConversationRole = "owner" | "admin" | "moderator" | "member";
export type ConversationMemberStatus = "invited" | "joined" | "left" | "removed" | "banned";

export type GroupJoinMode = "invite" | "link" | "closed";
/**
 * Who can SEE a group exists. Deliberately separate from GroupJoinMode,
 * which decides what happens when they try to join: a public group may still
 * be invite-only. Pending migration 20260807180000.
 */
export type GroupVisibility = "private" | "public";
export type GroupHistoryVisibility = "since_join" | "full" | "none";
export type GroupPostingMode = "all_members" | "admins_only" | "moderated";

export type MessageType = "text" | "image" | "voice_note" | "system" | "quick_action";
export type MessageStatus = "sent" | "delivered" | "read" | "failed" | "deleted" | "removed_by_moderation";
export type MessageReactionType = "heart" | "laugh" | "thumbs_up" | "wave" | "fire" | "wow";
export type SystemEventType =
  | "plan_confirmed"
  | "plan_time_changed"
  | "plan_place_changed"
  | "plan_cancelled"
  | "poll_confirmed"
  | "participant_joined"
  | "participant_left"
  | "conversation_created"
  // Stage 3E group lifecycle; pending migration 20260807140000.
  | "member_promoted"
  | "member_demoted"
  | "ownership_transferred"
  | "participant_removed"
  | "group_renamed"
  | "group_avatar_changed";
export type QuickActionType =
  | "on_my_way"
  | "im_here"
  | "running_late"
  | "where_to_meet"
  | "cant_make_it"
  | "start_without_me";

// --- Batch 8: Discovery, Invites, QR, Contact Matching, Account Trust ---

export type RequestContextType = "school" | "work" | "church" | "event" | "friend" | "socialize" | "other";

export type InviteType = "personal" | "event" | "circle" | "community";
export type InviteDeliveryType = "link" | "qr";
export type InviteStatus = "active" | "used" | "revoked" | "expired";

export type IdentifierType = "phone" | "email";
export type ContactMatchStatus = "running" | "completed" | "failed" | "deleted";

export type VerificationType = "email" | "phone" | "institution" | "organisation";
export type VerificationStatus = "pending" | "verified" | "failed" | "expired" | "revoked";
export type TrustEventType =
  | "request_declined"
  | "blocked_by_user"
  | "report_received"
  | "invite_abuse"
  | "duplicate_content"
  | "rapid_requests"
  | "impersonation_report";

// --- Batch 9: Profiles, Onboarding, Privacy Setup ---

export type OnboardingStepName =
  | "not_started"
  | "profile_started"
  | "profile_completed"
  | "privacy_reviewed"
  | "visibility_configured"
  | "location_prompted"
  | "first_muddy_added"
  | "activated"
  | "completed";

export type PermissionResult =
  | "not_requested"
  | "pre_prompt_viewed"
  | "granted"
  | "granted_approximate"
  | "denied"
  | "denied_permanently"
  | "revoked"
  | "unsupported"
  | "error";

export type MilestoneName =
  | "account_created"
  | "email_verified"
  | "profile_completed"
  | "privacy_setup_completed"
  | "first_request_sent"
  | "first_request_accepted"
  | "first_muddy_added"
  | "first_status_created"
  | "first_wave_sent"
  | "first_glow_enabled"
  | "first_plan_created"
  /**
   * One successful user-authored DIRECT message.
   *
   * Added by 20260816120000_first_message_sent_milestone. Direct only: Plan and
   * Circle chat have their own lifecycle semantics and are a separate decision.
   */
  | "first_message_sent"
  /**
   * Added by 20260824090000_first_reply_received_milestone (MB-GOD-060).
   *
   * A DIRECT conversation this person belongs to has had messages from two
   * different senders -- "somebody replied", the completed loop that
   * distinguishes a relationship from talking into silence. Written by a
   * trigger on `messages` at the moment it becomes true, and backfilled for
   * existing accounts, so Home no longer rediscovers it by scanning message
   * history on every load.
   */
  | "first_reply_received";

export type ProfileFieldName =
  | "bio"
  | "institution"
  | "programme"
  | "graduation_year"
  | "general_area"
  | "interests"
  | "pronouns"
  | "birthday"
  | "age"
  | "zodiac";

export type ProfileFieldVisibility = "only_me" | "approved_muddies" | "close_friends" | "shared_communities";

// --- Batch 11: Recaps, Streaks, Achievements, Healthy Engagement ---

export type StreakEventTypeName =
  | "plan_completed"
  | "wave_exchanged"
  | "ping_accepted"
  | "shared_plan"
  | "safe_arrival_completed"
  | "event_checked_in_together"
  | "conversation_activity";

export type ModerationActionType =
  | "no_action"
  | "hide_content"
  | "remove_content"
  | "warn_user"
  | "rate_limit_user"
  | "suspend_feature"
  | "temporary_suspension"
  | "permanent_suspension"
  | "escalate"
  | "restore_content";

export type LinkrIntentValue = "friends" | "dating" | "networking" | "anything";

export type LinkrDistanceValue = "very_close" | "around_you" | "wider";

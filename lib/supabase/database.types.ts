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
export type LocationConfidence = "high" | "medium" | "low";
export type ProximityLevel = "very_close" | "nearby" | "around" | "far" | "hidden";
export type SubscriptionPlan = "free" | "buddy_plus" | "buddy_pro";
export type SubscriptionStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "non_renewing"
  | "attention"
  | "cancelled"
  | "expired";
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
          plan: SubscriptionPlan;
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
          plan?: SubscriptionPlan;
          status?: SubscriptionStatus;
          current_period_start?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Insert"]>;
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
          target_type: "circle" | "user";
          target_id: string;
          access_type: "include" | "exclude";
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          target_type: "circle" | "user";
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
          target_type: "circle" | "user";
          target_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          status_id: string;
          target_type: "circle" | "user";
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
        };
        Insert: {
          id?: string;
          creator_id: string;
          title: string;
          description?: string | null;
          plan_type: PlanType;
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
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
          target_type: "circle" | "user";
          target_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          hangout_session_id: string;
          target_type: "circle" | "user";
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
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["events"]["Insert"]>;
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
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["event_circles"]["Insert"]>;
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
          reason: "parent_deleted" | "parent_expired" | "user_deleted" | "moderation";
          queued_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          media_asset_id: string;
          reason: "parent_deleted" | "parent_expired" | "user_deleted" | "moderation";
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
      muddy_drops: {
        Row: {
          id: string;
          creator_id: string;
          drop_type: DropType;
          context_type: DropContextType;
          context_id: string;
          content_type: MomentContentType;
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
          content_type: MomentContentType;
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
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
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
        };
        // Append-only: a database trigger rejects UPDATE and DELETE.
        Update: never;
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
      accept_friend_request: {
        Args: { p_request_id: string };
        Returns: Array<{ sender_id: string; receiver_id: string }>;
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
    };
    Enums: {
      friend_request_status: FriendRequestStatus;
      visibility_status: VisibilityStatus;
      location_confidence: LocationConfidence;
      proximity_level: ProximityLevel;
      subscription_plan: SubscriptionPlan;
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
  | "food"
  | "study"
  | "sports"
  | "gym"
  | "walk"
  | "gaming"
  | "chill"
  | "anything";
export type HangoutAudienceType =
  | "all_muddies"
  | "close_friends"
  | "selected_circles"
  | "selected_muddies";
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

export type EventVisibility = "invite" | "link" | "community";
export type EventStatus = "draft" | "scheduled" | "active" | "ended" | "cancelled";

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

export type MediaContentType = "image/jpeg" | "image/png" | "image/webp";
export type MediaProcessingStatus = "pending" | "processing" | "ready" | "failed" | "quarantined";
export type MediaContextType = "profile" | "moment" | "drop" | "event" | "plan" | "chat";
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

export type MomentContentType = "text" | "photo";
export type MomentAudienceType =
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
  | "conversation_created";
export type QuickActionType =
  | "on_my_way"
  | "im_here"
  | "running_late"
  | "where_to_meet"
  | "cant_make_it"
  | "start_without_me";

// --- Batch 8: Discovery, Invites, QR, Contact Matching, Account Trust ---

export type RequestContextType = "school" | "work" | "church" | "event" | "friend" | "other";

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
  | "first_plan_created";

export type ProfileFieldName =
  | "bio"
  | "institution"
  | "programme"
  | "graduation_year"
  | "general_area"
  | "interests"
  | "pronouns";

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

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type FriendRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "blocked";
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
        };
        Insert: {
          id?: string;
          sender_id: string;
          receiver_id: string;
          status?: FriendRequestStatus;
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
        };
        Insert: {
          id?: string;
          user_one_id: string;
          user_two_id: string;
          created_at?: string;
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
        };
        Insert: {
          id?: string;
          user_id: string;
          provider?: string;
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
        };
        Insert: {
          id?: string;
          user_id: string;
          glow_theme?: string;
          mood_status?: string | null;
          ghost_mode_type?: string;
          scheduled_visibility?: Json;
          notification_preferences?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_preferences"]["Insert"]>;
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
    };
    Views: Record<string, never>;
    Functions: {
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
  | "plan";
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

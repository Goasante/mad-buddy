export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_global_windows: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          reason: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          starts_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          reason: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          starts_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          starts_at?: string
        }
        Relationships: []
      }
      access_grants: {
        Row: {
          created_at: string
          expires_at: string | null
          granted_by: string | null
          id: string
          metadata: Json
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          source: Database["public"]["Enums"]["access_source"]
          starts_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          source: Database["public"]["Enums"]["access_source"]
          starts_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          metadata?: Json
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          source?: Database["public"]["Enums"]["access_source"]
          starts_at?: string
          user_id?: string
        }
        Relationships: []
      }
      access_launch: {
        Row: {
          created_at: string
          id: boolean
          launched_at: string
          note: string | null
          welcome_days: number
        }
        Insert: {
          created_at?: string
          id?: boolean
          launched_at: string
          note?: string | null
          welcome_days?: number
        }
        Update: {
          created_at?: string
          id?: boolean
          launched_at?: string
          note?: string | null
          welcome_days?: number
        }
        Relationships: []
      }
      access_reminder_log: {
        Row: {
          grant_id: string
          id: string
          milestone: string
          sent_at: string
          user_id: string
        }
        Insert: {
          grant_id: string
          id?: string
          milestone: string
          sent_at?: string
          user_id: string
        }
        Update: {
          grant_id?: string
          id?: string
          milestone?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_reminder_log_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "access_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletion_requests: {
        Row: {
          id: string
          reason: string | null
          requested_at: string
          stage: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          reason?: string | null
          requested_at?: string
          stage?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          reason?: string | null
          requested_at?: string
          stage?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      account_trust_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          risk_level: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          risk_level?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          risk_level?: string
          user_id?: string
        }
        Relationships: []
      }
      account_verifications: {
        Row: {
          created_at: string
          evidence_label: string | null
          expires_at: string | null
          id: string
          provider: string | null
          status: string
          updated_at: string
          user_id: string
          verification_type: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          evidence_label?: string | null
          expires_at?: string | null
          id?: string
          provider?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verification_type: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          evidence_label?: string | null
          expires_at?: string | null
          id?: string
          provider?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verification_type?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      achievement_definitions: {
        Row: {
          category: string
          code: string
          created_at: string
          criteria_type: string
          criteria_value: number
          description: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          criteria_type: string
          criteria_value?: number
          description: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          criteria_type?: string
          criteria_value?: number
          description?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      activation_milestones: {
        Row: {
          id: string
          milestone: string
          reached_at: string
          user_id: string
        }
        Insert: {
          id?: string
          milestone: string
          reached_at?: string
          user_id: string
        }
        Update: {
          id?: string
          milestone?: string
          reached_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          role_id: string
          starts_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          role_id: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          role_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          auth_strength: string | null
          case_reference: string | null
          created_at: string
          id: string
          new_state: Json | null
          previous_state: Json | null
          reason: string | null
          session_reference: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          auth_strength?: string | null
          case_reference?: string | null
          created_at?: string
          id?: string
          new_state?: Json | null
          previous_state?: Json | null
          reason?: string | null
          session_reference?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          auth_strength?: string | null
          case_reference?: string | null
          created_at?: string
          id?: string
          new_state?: Json | null
          previous_state?: Json | null
          reason?: string | null
          session_reference?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      admin_role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_key: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_key: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "admin_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system_role: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system_role?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system_role?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          auth_user_id: string | null
          created_at: string
          disabled_at: string | null
          email: string
          id: string
          invited_by_user_id: string | null
          role: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          disabled_at?: string | null
          email: string
          id?: string
          invited_by_user_id?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          disabled_at?: string | null
          email?: string
          id?: string
          invited_by_user_id?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      analytics_daily_user_facts: {
        Row: {
          action_count: number
          created_at: string
          event_date: string
          event_name: string
          feature_key: string
          first_occurred_at: string
          id: string
          last_occurred_at: string
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          updated_at: string
          user_id: string
        }
        Insert: {
          action_count?: number
          created_at?: string
          event_date: string
          event_name: string
          feature_key?: string
          first_occurred_at: string
          id?: string
          last_occurred_at: string
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          updated_at?: string
          user_id: string
        }
        Update: {
          action_count?: number
          created_at?: string
          event_date?: string
          event_name?: string
          feature_key?: string
          first_occurred_at?: string
          id?: string
          last_occurred_at?: string
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_feedback: {
        Row: {
          category: string
          created_at: string
          id: string
          message: string
          rating: number | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          message?: string
          rating?: number | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          message?: string
          rating?: number | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      appeals: {
        Row: {
          assigned_to: string | null
          created_at: string
          decided_at: string | null
          decision: string | null
          decision_note: string | null
          id: string
          reason: string
          source_action_id: string | null
          source_restriction_id: string | null
          status: string
          subject_user_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          decided_at?: string | null
          decision?: string | null
          decision_note?: string | null
          id?: string
          reason: string
          source_action_id?: string | null
          source_restriction_id?: string | null
          status?: string
          subject_user_id: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          decided_at?: string | null
          decision?: string | null
          decision_note?: string | null
          id?: string
          reason?: string
          source_action_id?: string | null
          source_restriction_id?: string | null
          status?: string
          subject_user_id?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appeals_source_action_id_fkey"
            columns: ["source_action_id"]
            isOneToOne: false
            referencedRelation: "case_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appeals_source_restriction_id_fkey"
            columns: ["source_restriction_id"]
            isOneToOne: false
            referencedRelation: "user_restrictions"
            referencedColumns: ["id"]
          },
        ]
      }
      best_buddies: {
        Row: {
          created_at: string
          friend_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          friend_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          amount_minor: number | null
          created_at: string
          currency: string | null
          dedupe_key: string
          event_type: string
          fee_status: string
          id: string
          net_amount_minor: number | null
          occurred_at: string
          previous_plan: Database["public"]["Enums"]["subscription_plan"] | null
          provider: string
          provider_event_id: string | null
          provider_fee_minor: number | null
          source: string
          subscription_id: string | null
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          transaction_reference: string | null
          user_id: string | null
        }
        Insert: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          dedupe_key: string
          event_type: string
          fee_status?: string
          id?: string
          net_amount_minor?: number | null
          occurred_at?: string
          previous_plan?:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          provider?: string
          provider_event_id?: string | null
          provider_fee_minor?: number | null
          source: string
          subscription_id?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          transaction_reference?: string | null
          user_id?: string | null
        }
        Update: {
          amount_minor?: number | null
          created_at?: string
          currency?: string | null
          dedupe_key?: string
          event_type?: string
          fee_status?: string
          id?: string
          net_amount_minor?: number | null
          occurred_at?: string
          previous_plan?:
            | Database["public"]["Enums"]["subscription_plan"]
            | null
          provider?: string
          provider_event_id?: string | null
          provider_fee_minor?: number | null
          source?: string
          subscription_id?: string | null
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          transaction_reference?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      birthday_notification_deliveries: {
        Row: {
          birthday_day: string
          birthday_user_id: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          recipient_id: string
          status: string
        }
        Insert: {
          birthday_day: string
          birthday_user_id: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          recipient_id: string
          status?: string
        }
        Update: {
          birthday_day?: string
          birthday_user_id?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          recipient_id?: string
          status?: string
        }
        Relationships: []
      }
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      blog_images: {
        Row: {
          bytes: number
          created_at: string
          created_by: string
          height: number
          id: string
          sha256: string
          width: number
        }
        Insert: {
          bytes: number
          created_at?: string
          created_by: string
          height: number
          id?: string
          sha256: string
          width: number
        }
        Update: {
          bytes?: number
          created_at?: string
          created_by?: string
          height?: number
          id?: string
          sha256?: string
          width?: number
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          draft: Json
          id: string
          published: Json | null
          published_at: string | null
          published_updated_at: string | null
          slug: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          draft: Json
          id?: string
          published?: Json | null
          published_at?: string | null
          published_updated_at?: string | null
          slug: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          draft?: Json
          id?: string
          published?: Json | null
          published_at?: string | null
          published_updated_at?: string | null
          slug?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      blog_revisions: {
        Row: {
          draft: Json
          id: string
          post_id: string
          published: Json | null
          saved_at: string
          version: number
        }
        Insert: {
          draft: Json
          id?: string
          post_id: string
          published?: Json | null
          saved_at?: string
          version: number
        }
        Update: {
          draft?: Json
          id?: string
          post_id?: string
          published?: Json | null
          saved_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "blog_revisions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      buddy_score_ledger: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json
          points_delta: number
          rule_version: number
          source_reference: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          points_delta: number
          rule_version: number
          source_reference: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          points_delta?: number
          rule_version?: number
          source_reference?: string
          user_id?: string
        }
        Relationships: []
      }
      business_alert_rules: {
        Row: {
          created_at: string
          enabled: boolean
          rule_key: string
          threshold_percent: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          rule_key: string
          threshold_percent: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          rule_key?: string
          threshold_percent?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      case_actions: {
        Row: {
          action_type: string
          actor_id: string | null
          case_id: string
          created_at: string
          ends_at: string | null
          id: string
          reason_code: string | null
          reversed_at: string | null
          starts_at: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          case_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          reason_code?: string | null
          reversed_at?: string | null
          starts_at?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          case_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          reason_code?: string | null
          reversed_at?: string | null
          starts_at?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_actions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "trust_safety_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_evidence: {
        Row: {
          access_level: string
          case_id: string
          created_at: string
          evidence_type: string
          id: string
          protected_reference: string
          retention_expires_at: string | null
        }
        Insert: {
          access_level?: string
          case_id: string
          created_at?: string
          evidence_type: string
          id?: string
          protected_reference: string
          retention_expires_at?: string | null
        }
        Update: {
          access_level?: string
          case_id?: string
          created_at?: string
          evidence_type?: string
          id?: string
          protected_reference?: string
          retention_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "trust_safety_cases"
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
      check_ins: {
        Row: {
          checked_in_at: string
          checked_out_at: string | null
          context_id: string
          context_type: string
          created_at: string
          event_glow_enabled: boolean
          id: string
          method: string
          status: string
          updated_at: string
          user_id: string
          verified_by: string | null
          visibility: string
        }
        Insert: {
          checked_in_at?: string
          checked_out_at?: string | null
          context_id: string
          context_type: string
          created_at?: string
          event_glow_enabled?: boolean
          id?: string
          method?: string
          status?: string
          updated_at?: string
          user_id: string
          verified_by?: string | null
          visibility?: string
        }
        Update: {
          checked_in_at?: string
          checked_out_at?: string | null
          context_id?: string
          context_type?: string
          created_at?: string
          event_glow_enabled?: boolean
          id?: string
          method?: string
          status?: string
          updated_at?: string
          user_id?: string
          verified_by?: string | null
          visibility?: string
        }
        Relationships: []
      }
      circle_members: {
        Row: {
          added_by: string | null
          circle_id: string
          created_at: string
          friend_id: string
          id: string
        }
        Insert: {
          added_by?: string | null
          circle_id: string
          created_at?: string
          friend_id: string
          id?: string
        }
        Update: {
          added_by?: string | null
          circle_id?: string
          created_at?: string
          friend_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_members_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "friend_circles"
            referencedColumns: ["id"]
          },
        ]
      }
      close_friend_relationships: {
        Row: {
          created_at: string
          friend_id: string
          id: string
          notification_preference: string
          owner_id: string
          priority_level: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          friend_id: string
          id?: string
          notification_preference?: string
          owner_id: string
          priority_level?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          friend_id?: string
          id?: string
          notification_preference?: string
          owner_id?: string
          priority_level?: string
          updated_at?: string
        }
        Relationships: []
      }
      conference_hidden_users: {
        Row: {
          created_at: string
          hidden_user_id: string
          viewer_user_id: string
        }
        Insert: {
          created_at?: string
          hidden_user_id: string
          viewer_user_id: string
        }
        Update: {
          created_at?: string
          hidden_user_id?: string
          viewer_user_id?: string
        }
        Relationships: []
      }
      conference_locations: {
        Row: {
          accuracy: number
          last_updated: string
          latitude: number
          longitude: number
          user_id: string
        }
        Insert: {
          accuracy: number
          last_updated?: string
          latitude: number
          longitude: number
          user_id: string
        }
        Update: {
          accuracy?: number
          last_updated?: string
          latitude?: number
          longitude?: number
          user_id?: string
        }
        Relationships: []
      }
      conference_replies: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          hype_count: number
          id: string
          pass_count: number
          reply_to_reply_id: string | null
          status: string
          topic_id: string
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          hype_count?: number
          id?: string
          pass_count?: number
          reply_to_reply_id?: string | null
          status?: string
          topic_id: string
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          hype_count?: number
          id?: string
          pass_count?: number
          reply_to_reply_id?: string | null
          status?: string
          topic_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conference_replies_reply_to_reply_id_fkey"
            columns: ["reply_to_reply_id"]
            isOneToOne: false
            referencedRelation: "conference_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_replies_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "conference_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_topics: {
        Row: {
          author_user_id: string
          body: string
          created_at: string
          expires_at: string
          hype_count: number
          id: string
          last_activity_at: string
          origin_latitude: number | null
          origin_longitude: number | null
          pass_count: number
          reply_count: number
          status: string
          unique_voice_count: number
          updated_at: string
        }
        Insert: {
          author_user_id: string
          body: string
          created_at?: string
          expires_at?: string
          hype_count?: number
          id?: string
          last_activity_at?: string
          origin_latitude?: number | null
          origin_longitude?: number | null
          pass_count?: number
          reply_count?: number
          status?: string
          unique_voice_count?: number
          updated_at?: string
        }
        Update: {
          author_user_id?: string
          body?: string
          created_at?: string
          expires_at?: string
          hype_count?: number
          id?: string
          last_activity_at?: string
          origin_latitude?: number | null
          origin_longitude?: number | null
          pass_count?: number
          reply_count?: number
          status?: string
          unique_voice_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      conference_voice_ids: {
        Row: {
          created_at: string
          topic_id: string
          user_id: string
          voice_number: number
        }
        Insert: {
          created_at?: string
          topic_id: string
          user_id: string
          voice_number: number
        }
        Update: {
          created_at?: string
          topic_id?: string
          user_id?: string
          voice_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "conference_voice_ids_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "conference_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      conference_votes: {
        Row: {
          created_at: string
          id: string
          reply_id: string | null
          topic_id: string | null
          updated_at: string
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          reply_id?: string | null
          topic_id?: string | null
          updated_at?: string
          user_id: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          reply_id?: string | null
          topic_id?: string | null
          updated_at?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "conference_votes_reply_id_fkey"
            columns: ["reply_id"]
            isOneToOne: false
            referencedRelation: "conference_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conference_votes_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "conference_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_logs: {
        Row: {
          consent_text: string
          consent_type: string
          created_at: string
          granted: boolean
          id: string
          user_id: string
        }
        Insert: {
          consent_text: string
          consent_type: string
          created_at?: string
          granted: boolean
          id?: string
          user_id: string
        }
        Update: {
          consent_text?: string
          consent_type?: string
          created_at?: string
          granted?: boolean
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      contact_match_sessions: {
        Row: {
          created_at: string
          deleted_at: string | null
          expires_at: string | null
          id: string
          matched_count: number
          status: string
          submitted_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          expires_at?: string | null
          id?: string
          matched_count?: number
          status?: string
          submitted_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          expires_at?: string | null
          id?: string
          matched_count?: number
          status?: string
          submitted_count?: number
          user_id?: string
        }
        Relationships: []
      }
      content_reports: {
        Row: {
          category: string
          content_id: string
          content_type: string
          created_at: string
          details: string | null
          id: string
          reported_user_id: string | null
          reporter_id: string | null
          resolved_at: string | null
          status: string
        }
        Insert: {
          category: string
          content_id: string
          content_type: string
          created_at?: string
          details?: string | null
          id?: string
          reported_user_id?: string | null
          reporter_id?: string | null
          resolved_at?: string | null
          status?: string
        }
        Update: {
          category?: string
          content_id?: string
          content_type?: string
          created_at?: string
          details?: string | null
          id?: string
          reported_user_id?: string | null
          reporter_id?: string | null
          resolved_at?: string | null
          status?: string
        }
        Relationships: []
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
      conversation_members: {
        Row: {
          conversation_id: string
          created_at: string
          hidden_at: string | null
          history_visible_from: string
          id: string
          joined_at: string
          last_read_at: string | null
          last_read_message_id: string | null
          left_at: string | null
          muted_until: string | null
          read_receipts_enabled: boolean
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          hidden_at?: string | null
          history_visible_from?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          last_read_message_id?: string | null
          left_at?: string | null
          muted_until?: string | null
          read_receipts_enabled?: boolean
          role?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          hidden_at?: string | null
          history_visible_from?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          last_read_message_id?: string | null
          left_at?: string | null
          muted_until?: string | null
          read_receipts_enabled?: boolean
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      conversation_pins: {
        Row: {
          conversation_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_pins_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
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
      conversations: {
        Row: {
          context_id: string | null
          context_type: string | null
          conversation_type: string
          created_at: string
          created_by: string | null
          direct_key: string | null
          id: string
          last_message_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          context_id?: string | null
          context_type?: string | null
          conversation_type: string
          created_at?: string
          created_by?: string | null
          direct_key?: string | null
          id?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          context_id?: string | null
          context_type?: string | null
          conversation_type?: string
          created_at?: string
          created_by?: string | null
          direct_key?: string | null
          id?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      custom_wallpapers: {
        Row: {
          created_at: string
          height: number | null
          id: string
          mime_type: string
          owner_id: string
          size_bytes: number
          state: string
          storage_key: string
          updated_at: string
          width: number | null
        }
        Insert: {
          created_at?: string
          height?: number | null
          id?: string
          mime_type: string
          owner_id: string
          size_bytes: number
          state?: string
          storage_key: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          created_at?: string
          height?: number | null
          id?: string
          mime_type?: string
          owner_id?: string
          size_bytes?: number
          state?: string
          storage_key?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: []
      }
      deletion_audit_logs: {
        Row: {
          created_at: string
          deleted_at: string
          deleted_user_label: string
          deletion_reason: string | null
          id: string
          retained_billing_reference: string | null
          retained_report_reference: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string
          deleted_user_label?: string
          deletion_reason?: string | null
          id?: string
          retained_billing_reference?: string | null
          retained_report_reference?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string
          deleted_user_label?: string
          deletion_reason?: string | null
          id?: string
          retained_billing_reference?: string | null
          retained_report_reference?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      device_push_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      discoverability_identifiers: {
        Row: {
          created_at: string
          id: string
          identifier_type: string
          is_discoverable: boolean
          protected_identifier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier_type: string
          is_discoverable?: boolean
          protected_identifier: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier_type?: string
          is_discoverable?: boolean
          protected_identifier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      discovery_passes: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          passed_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          passed_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          passed_user_id?: string
          user_id?: string
        }
        Relationships: []
      }
      domain_events: {
        Row: {
          actor_id: string | null
          created_at: string
          dedupe_key: string | null
          event_type: string
          feature_key: string | null
          id: string
          occurred_at: string
          payload: Json
          resource_id: string | null
          resource_type: string
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          version: number
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_type: string
          feature_key?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          resource_id?: string | null
          resource_type: string
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          version?: number
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_type?: string
          feature_key?: string | null
          id?: string
          occurred_at?: string
          payload?: Json
          resource_id?: string | null
          resource_type?: string
          subscription_plan?: Database["public"]["Enums"]["subscription_plan"]
          version?: number
        }
        Relationships: []
      }
      downgrade_adjustments: {
        Row: {
          created_at: string
          id: string
          resource_id: string | null
          resource_type: string
          selected_action: string
          status: string
          subscription_change_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_type: string
          selected_action: string
          status?: string
          subscription_change_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_type?: string
          selected_action?: string
          status?: string
          subscription_change_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "downgrade_adjustments_subscription_change_id_fkey"
            columns: ["subscription_change_id"]
            isOneToOne: false
            referencedRelation: "subscription_changes"
            referencedColumns: ["id"]
          },
        ]
      }
      drop_audience_targets: {
        Row: {
          created_at: string
          drop_id: string
          id: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          drop_id: string
          id?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          drop_id?: string
          id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "drop_audience_targets_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "muddy_drops"
            referencedColumns: ["id"]
          },
        ]
      }
      drop_unlocks: {
        Row: {
          created_at: string
          drop_id: string
          id: string
          unlocked_at: string
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          drop_id: string
          id?: string
          unlocked_at?: string
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          drop_id?: string
          id?: string
          unlocked_at?: string
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drop_unlocks_drop_id_fkey"
            columns: ["drop_id"]
            isOneToOne: false
            referencedRelation: "muddy_drops"
            referencedColumns: ["id"]
          },
        ]
      }
      earned_premium_rewards: {
        Row: {
          created_at: string
          ending_notified_at: string | null
          expires_at: string
          grace_ends_at: string | null
          grant_key: string
          granted_at: string
          id: string
          revoke_reason: string | null
          revoked_at: string | null
          reward_plan: Database["public"]["Enums"]["subscription_plan"]
          rule_version: number
          source_score_snapshot: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ending_notified_at?: string | null
          expires_at: string
          grace_ends_at?: string | null
          grant_key: string
          granted_at?: string
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          reward_plan: Database["public"]["Enums"]["subscription_plan"]
          rule_version: number
          source_score_snapshot: number
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ending_notified_at?: string | null
          expires_at?: string
          grace_ends_at?: string | null
          grant_key?: string
          granted_at?: string
          id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          reward_plan?: Database["public"]["Enums"]["subscription_plan"]
          rule_version?: number
          source_score_snapshot?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      emergency_controls: {
        Row: {
          control_key: string
          disabled_at: string | null
          disabled_by: string | null
          incident_id: string | null
          is_disabled: boolean
          reason: string | null
          updated_at: string
        }
        Insert: {
          control_key: string
          disabled_at?: string | null
          disabled_by?: string | null
          incident_id?: string | null
          is_disabled?: boolean
          reason?: string | null
          updated_at?: string
        }
        Update: {
          control_key?: string
          disabled_at?: string | null
          disabled_by?: string | null
          incident_id?: string | null
          is_disabled?: boolean
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_controls_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "security_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_preferences: {
        Row: {
          achievements_enabled: boolean
          created_at: string
          daily_notification_budget: number
          exam_mode_allow_close_friends: boolean
          exam_mode_until: string | null
          recaps_enabled: boolean
          streak_notifications_enabled: boolean
          streaks_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          achievements_enabled?: boolean
          created_at?: string
          daily_notification_budget?: number
          exam_mode_allow_close_friends?: boolean
          exam_mode_until?: string | null
          recaps_enabled?: boolean
          streak_notifications_enabled?: boolean
          streaks_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          achievements_enabled?: boolean
          created_at?: string
          daily_notification_budget?: number
          exam_mode_allow_close_friends?: boolean
          exam_mode_until?: string | null
          recaps_enabled?: boolean
          streak_notifications_enabled?: boolean
          streaks_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      entitlement_overrides: {
        Row: {
          boolean_value: boolean | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          entitlement_key: string
          id: string
          integer_value: number | null
          reason: string | null
          starts_at: string | null
          subject_id: string
          subject_type: string
          value_type: string
        }
        Insert: {
          boolean_value?: boolean | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          entitlement_key: string
          id?: string
          integer_value?: number | null
          reason?: string | null
          starts_at?: string | null
          subject_id: string
          subject_type?: string
          value_type: string
        }
        Update: {
          boolean_value?: boolean | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          entitlement_key?: string
          id?: string
          integer_value?: number | null
          reason?: string | null
          starts_at?: string | null
          subject_id?: string
          subject_type?: string
          value_type?: string
        }
        Relationships: []
      }
      event_admins: {
        Row: {
          created_at: string
          event_id: string
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_admins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_announcement_reactions: {
        Row: {
          created_at: string
          event_announcement_id: string
          id: string
          reaction_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_announcement_id: string
          id?: string
          reaction_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_announcement_id?: string
          id?: string
          reaction_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_announcement_reactions_event_announcement_id_fkey"
            columns: ["event_announcement_id"]
            isOneToOne: false
            referencedRelation: "event_announcements"
            referencedColumns: ["id"]
          },
        ]
      }
      event_announcements: {
        Row: {
          author_id: string
          body: string
          created_at: string
          event_circle_id: string
          expires_at: string | null
          id: string
          priority: string
          published_at: string
          title: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          event_circle_id: string
          expires_at?: string | null
          id?: string
          priority?: string
          published_at?: string
          title: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          event_circle_id?: string
          expires_at?: string | null
          id?: string
          priority?: string
          published_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_announcements_event_circle_id_fkey"
            columns: ["event_circle_id"]
            isOneToOne: false
            referencedRelation: "event_circles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_audience_targets: {
        Row: {
          created_at: string
          event_id: string
          id: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_audience_targets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_circle_group_targets: {
        Row: {
          created_at: string
          event_circle_id: string
          group_conversation_id: string
          id: string
        }
        Insert: {
          created_at?: string
          event_circle_id: string
          group_conversation_id: string
          id?: string
        }
        Update: {
          created_at?: string
          event_circle_id?: string
          group_conversation_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_circle_group_targets_event_circle_id_fkey"
            columns: ["event_circle_id"]
            isOneToOne: false
            referencedRelation: "event_circles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_circle_group_targets_group_conversation_id_fkey"
            columns: ["group_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_circle_invitations: {
        Row: {
          created_at: string
          event_circle_id: string
          id: string
          invited_by: string
          invited_user_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_circle_id: string
          id?: string
          invited_by: string
          invited_user_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_circle_id?: string
          id?: string
          invited_by?: string
          invited_user_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_circle_invitations_event_circle_id_fkey"
            columns: ["event_circle_id"]
            isOneToOne: false
            referencedRelation: "event_circles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_circle_members: {
        Row: {
          created_at: string
          event_circle_id: string
          id: string
          joined_at: string
          left_at: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_circle_id: string
          id?: string
          joined_at?: string
          left_at?: string | null
          role?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_circle_id?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_circle_members_event_circle_id_fkey"
            columns: ["event_circle_id"]
            isOneToOne: false
            referencedRelation: "event_circles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_circles: {
        Row: {
          archives_at: string | null
          closes_at: string | null
          created_at: string
          description: string | null
          event_id: string | null
          id: string
          join_mode: string
          listed_in_event: boolean
          max_members: number
          member_visibility: string
          name: string
          opens_at: string | null
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          archives_at?: string | null
          closes_at?: string | null
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          join_mode?: string
          listed_in_event?: boolean
          max_members?: number
          member_visibility?: string
          name: string
          opens_at?: string | null
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          archives_at?: string | null
          closes_at?: string | null
          created_at?: string
          description?: string | null
          event_id?: string | null
          id?: string
          join_mode?: string
          listed_in_event?: boolean
          max_members?: number
          member_visibility?: string
          name?: string
          opens_at?: string | null
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_circles_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_linkr_opt_ins: {
        Row: {
          created_at: string
          enabled: boolean
          event_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          event_id: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          event_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_linkr_opt_ins_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_locations: {
        Row: {
          country_code: string | null
          created_at: string
          event_id: string
          latitude: number
          locality: string | null
          longitude: number
          region: string | null
          updated_at: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          event_id: string
          latitude: number
          locality?: string | null
          longitude: number
          region?: string | null
          updated_at?: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          event_id?: string
          latitude?: number
          locality?: string | null
          longitude?: number
          region?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_locations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_modes: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          is_active: boolean
          name: string
          starts_at: string
          updated_at: string
          user_id: string
          visibility_rule: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          is_active?: boolean
          name: string
          starts_at: string
          updated_at?: string
          user_id: string
          visibility_rule?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          is_active?: boolean
          name?: string
          starts_at?: string
          updated_at?: string
          user_id?: string
          visibility_rule?: string
        }
        Relationships: []
      }
      event_rsvps: {
        Row: {
          created_at: string
          event_id: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_update_reactions: {
        Row: {
          created_at: string
          event_update_id: string
          id: string
          reaction_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_update_id: string
          id?: string
          reaction_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_update_id?: string
          id?: string
          reaction_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_update_reactions_event_update_id_fkey"
            columns: ["event_update_id"]
            isOneToOne: false
            referencedRelation: "event_updates"
            referencedColumns: ["id"]
          },
        ]
      }
      event_updates: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          event_id: string
          id: string
          priority: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          event_id: string
          id?: string
          priority?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          event_id?: string
          id?: string
          priority?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_updates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          checkin_opens_minutes_before: number
          cover_focal_x: number
          cover_focal_y: number
          cover_media_id: string | null
          created_at: string
          description: string | null
          ends_at: string
          host_id: string
          id: string
          name: string
          starts_at: string
          status: string
          updated_at: string
          venue_label: string | null
          visibility: string
        }
        Insert: {
          checkin_opens_minutes_before?: number
          cover_focal_x?: number
          cover_focal_y?: number
          cover_media_id?: string | null
          created_at?: string
          description?: string | null
          ends_at: string
          host_id: string
          id?: string
          name: string
          starts_at: string
          status?: string
          updated_at?: string
          venue_label?: string | null
          visibility?: string
        }
        Update: {
          checkin_opens_minutes_before?: number
          cover_focal_x?: number
          cover_focal_y?: number
          cover_media_id?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string
          host_id?: string
          id?: string
          name?: string
          starts_at?: string
          status?: string
          updated_at?: string
          venue_label?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_cover_media_id_fkey"
            columns: ["cover_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_assignments: {
        Row: {
          assigned_at: string
          assigned_plan: Database["public"]["Enums"]["subscription_plan"]
          assigned_platform: string
          experiment_id: string
          id: string
          user_id: string | null
          variant_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_plan: Database["public"]["Enums"]["subscription_plan"]
          assigned_platform: string
          experiment_id: string
          id?: string
          user_id?: string | null
          variant_id: string
        }
        Update: {
          assigned_at?: string
          assigned_plan?: Database["public"]["Enums"]["subscription_plan"]
          assigned_platform?: string
          experiment_id?: string
          id?: string
          user_id?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_assignments_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "experiment_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_exposures: {
        Row: {
          assignment_id: string
          experiment_id: string
          first_exposed_at: string
          id: string
          platform: string
          user_id: string | null
          variant_id: string
        }
        Insert: {
          assignment_id: string
          experiment_id: string
          first_exposed_at?: string
          id?: string
          platform: string
          user_id?: string | null
          variant_id: string
        }
        Update: {
          assignment_id?: string
          experiment_id?: string
          first_exposed_at?: string
          id?: string
          platform?: string
          user_id?: string | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiment_exposures_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "experiment_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_exposures_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experiment_exposures_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "experiment_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_testers: {
        Row: {
          added_by: string
          created_at: string
          experiment_id: string
          id: string
          user_id: string | null
        }
        Insert: {
          added_by: string
          created_at?: string
          experiment_id: string
          id?: string
          user_id?: string | null
        }
        Update: {
          added_by?: string
          created_at?: string
          experiment_id?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "experiment_testers_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiment_variants: {
        Row: {
          created_at: string
          description: string
          experiment_id: string
          id: string
          is_control: boolean
          key: string
          name: string
          weight_basis_points: number
        }
        Insert: {
          created_at?: string
          description?: string
          experiment_id: string
          id?: string
          is_control?: boolean
          key: string
          name: string
          weight_basis_points: number
        }
        Update: {
          created_at?: string
          description?: string
          experiment_id?: string
          id?: string
          is_control?: boolean
          key?: string
          name?: string
          weight_basis_points?: number
        }
        Relationships: [
          {
            foreignKeyName: "experiment_variants_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      experiments: {
        Row: {
          allocation_percentage: number
          audience: string
          cancelled_at: string | null
          completed_at: string | null
          conflict_group: string | null
          created_at: string
          created_by: string
          description: string
          ends_at: string | null
          guardrail_metrics: string[]
          hypothesis: string
          id: string
          key: string
          name: string
          parent_feature_flag_id: string | null
          paused_at: string | null
          primary_metric: string
          secondary_metrics: string[]
          started_at: string | null
          starts_at: string | null
          status: string
          target_plans: Database["public"]["Enums"]["subscription_plan"][]
          target_platforms: string[]
          updated_at: string
        }
        Insert: {
          allocation_percentage?: number
          audience?: string
          cancelled_at?: string | null
          completed_at?: string | null
          conflict_group?: string | null
          created_at?: string
          created_by: string
          description: string
          ends_at?: string | null
          guardrail_metrics?: string[]
          hypothesis: string
          id?: string
          key: string
          name: string
          parent_feature_flag_id?: string | null
          paused_at?: string | null
          primary_metric: string
          secondary_metrics?: string[]
          started_at?: string | null
          starts_at?: string | null
          status?: string
          target_plans?: Database["public"]["Enums"]["subscription_plan"][]
          target_platforms?: string[]
          updated_at?: string
        }
        Update: {
          allocation_percentage?: number
          audience?: string
          cancelled_at?: string | null
          completed_at?: string | null
          conflict_group?: string | null
          created_at?: string
          created_by?: string
          description?: string
          ends_at?: string | null
          guardrail_metrics?: string[]
          hypothesis?: string
          id?: string
          key?: string
          name?: string
          parent_feature_flag_id?: string | null
          paused_at?: string | null
          primary_metric?: string
          secondary_metrics?: string[]
          started_at?: string | null
          starts_at?: string | null
          status?: string
          target_plans?: Database["public"]["Enums"]["subscription_plan"][]
          target_platforms?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experiments_parent_feature_flag_id_fkey"
            columns: ["parent_feature_flag_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flag_rules: {
        Row: {
          created_at: string
          ends_at: string | null
          feature_flag_id: string
          id: string
          rollout_percentage: number | null
          starts_at: string | null
          target_type: string
          target_value: string | null
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          feature_flag_id: string
          id?: string
          rollout_percentage?: number | null
          starts_at?: string | null
          target_type: string
          target_value?: string | null
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          feature_flag_id?: string
          id?: string
          rollout_percentage?: number | null
          starts_at?: string | null
          target_type?: string
          target_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_rules_feature_flag_id_fkey"
            columns: ["feature_flag_id"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          created_by: string | null
          default_value: boolean
          description: string | null
          id: string
          key: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_value?: boolean
          description?: string | null
          id?: string
          key: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_value?: boolean
          description?: string | null
          id?: string
          key?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      financial_snapshots: {
        Row: {
          active_free_users: number
          active_paid_subscriptions: number
          buddy_plus_users: number
          buddy_pro_users: number
          captured_at: string
          churned_mrr_minor: number | null
          contraction_mrr_minor: number | null
          currency: string
          ending_mrr_minor: number
          expansion_mrr_minor: number | null
          id: string
          new_mrr_minor: number | null
          opening_mrr_minor: number | null
          reactivation_mrr_minor: number | null
          reconciliation_difference_minor: number | null
          reconciliation_reason: string | null
          reconciliation_status: string
          snapshot_date: string
          updated_at: string
        }
        Insert: {
          active_free_users: number
          active_paid_subscriptions: number
          buddy_plus_users: number
          buddy_pro_users: number
          captured_at?: string
          churned_mrr_minor?: number | null
          contraction_mrr_minor?: number | null
          currency: string
          ending_mrr_minor: number
          expansion_mrr_minor?: number | null
          id?: string
          new_mrr_minor?: number | null
          opening_mrr_minor?: number | null
          reactivation_mrr_minor?: number | null
          reconciliation_difference_minor?: number | null
          reconciliation_reason?: string | null
          reconciliation_status?: string
          snapshot_date: string
          updated_at?: string
        }
        Update: {
          active_free_users?: number
          active_paid_subscriptions?: number
          buddy_plus_users?: number
          buddy_pro_users?: number
          captured_at?: string
          churned_mrr_minor?: number | null
          contraction_mrr_minor?: number | null
          currency?: string
          ending_mrr_minor?: number
          expansion_mrr_minor?: number | null
          id?: string
          new_mrr_minor?: number | null
          opening_mrr_minor?: number | null
          reactivation_mrr_minor?: number | null
          reconciliation_difference_minor?: number | null
          reconciliation_reason?: string | null
          reconciliation_status?: string
          snapshot_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      friend_circles: {
        Row: {
          archived_at: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_system_circle: boolean
          name: string
          theme: string | null
          updated_at: string
          user_id: string
          visibility_rule: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_system_circle?: boolean
          name: string
          theme?: string | null
          updated_at?: string
          user_id: string
          visibility_rule?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_system_circle?: boolean
          name?: string
          theme?: string | null
          updated_at?: string
          user_id?: string
          visibility_rule?: string
        }
        Relationships: []
      }
      friend_glow_colors: {
        Row: {
          color_id: string
          created_at: string
          friend_id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          color_id: string
          created_at?: string
          friend_id: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          color_id?: string
          created_at?: string
          friend_id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      friend_requests: {
        Row: {
          context_id: string | null
          context_type: string | null
          created_at: string
          expires_at: string | null
          id: string
          message: string | null
          receiver_id: string
          responded_at: string | null
          sender_id: string
          status: Database["public"]["Enums"]["friend_request_status"]
          updated_at: string
        }
        Insert: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          message?: string | null
          receiver_id: string
          responded_at?: string | null
          sender_id: string
          status?: Database["public"]["Enums"]["friend_request_status"]
          updated_at?: string
        }
        Update: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          message?: string | null
          receiver_id?: string
          responded_at?: string | null
          sender_id?: string
          status?: Database["public"]["Enums"]["friend_request_status"]
          updated_at?: string
        }
        Relationships: []
      }
      friendship_recaps: {
        Row: {
          created_at: string
          generated_at: string
          id: string
          period_end: string
          period_start: string
          period_type: string
          status: string
          summary_data: Json
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          created_at?: string
          generated_at?: string
          id?: string
          period_end: string
          period_start: string
          period_type: string
          status?: string
          summary_data?: Json
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          created_at?: string
          generated_at?: string
          id?: string
          period_end?: string
          period_start?: string
          period_type?: string
          status?: string
          summary_data?: Json
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: []
      }
      friendship_streaks: {
        Row: {
          created_at: string
          current_weeks: number
          friendship_id: string
          id: string
          last_qualified_period: string | null
          longest_weeks: number
          paused_until: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_weeks?: number
          friendship_id: string
          id?: string
          last_qualified_period?: string | null
          longest_weeks?: number
          paused_until?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_weeks?: number
          friendship_id?: string
          id?: string
          last_qualified_period?: string | null
          longest_weeks?: number
          paused_until?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendship_streaks_friendship_id_fkey"
            columns: ["friendship_id"]
            isOneToOne: true
            referencedRelation: "friendships"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          accepted_request_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          user_one_id: string
          user_two_id: string
        }
        Insert: {
          accepted_request_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          user_one_id: string
          user_two_id: string
        }
        Update: {
          accepted_request_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          user_one_id?: string
          user_two_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_accepted_request_id_fkey"
            columns: ["accepted_request_id"]
            isOneToOne: false
            referencedRelation: "friend_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      group_settings: {
        Row: {
          conversation_id: string
          created_at: string
          description: string | null
          history_visibility: string
          image_media_id: string | null
          join_mode: string
          name: string
          posting_mode: string
          updated_at: string
          visibility: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          description?: string | null
          history_visibility?: string
          image_media_id?: string | null
          join_mode?: string
          name: string
          posting_mode?: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          description?: string | null
          history_visibility?: string
          image_media_id?: string | null
          join_mode?: string
          name?: string
          posting_mode?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_settings_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_settings_image_media_id_fkey"
            columns: ["image_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      hangout_audience_targets: {
        Row: {
          created_at: string
          hangout_session_id: string
          id: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          hangout_session_id: string
          id?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          hangout_session_id?: string
          id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "hangout_audience_targets_hangout_session_id_fkey"
            columns: ["hangout_session_id"]
            isOneToOne: false
            referencedRelation: "hangout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      hangout_requests: {
        Row: {
          created_at: string
          hangout_session_id: string
          id: string
          message: string | null
          requester_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          hangout_session_id: string
          id?: string
          message?: string | null
          requester_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          hangout_session_id?: string
          id?: string
          message?: string | null
          requester_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "hangout_requests_hangout_session_id_fkey"
            columns: ["hangout_session_id"]
            isOneToOne: false
            referencedRelation: "hangout_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      hangout_sessions: {
        Row: {
          activity_type: string
          allow_friend_invites: boolean
          allow_pings: boolean
          area_derived_at: string | null
          area_tier: string | null
          audience_announce_claimed_at: string | null
          audience_type: string
          broad_area_text: string | null
          converted_plan_id: string | null
          created_at: string
          discovery_scope: string
          ends_at: string
          id: string
          max_participants: number
          message: string | null
          owner_id: string
          starts_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          activity_type: string
          allow_friend_invites?: boolean
          allow_pings?: boolean
          area_derived_at?: string | null
          area_tier?: string | null
          audience_announce_claimed_at?: string | null
          audience_type?: string
          broad_area_text?: string | null
          converted_plan_id?: string | null
          created_at?: string
          discovery_scope?: string
          ends_at: string
          id?: string
          max_participants?: number
          message?: string | null
          owner_id: string
          starts_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          activity_type?: string
          allow_friend_invites?: boolean
          allow_pings?: boolean
          area_derived_at?: string | null
          area_tier?: string | null
          audience_announce_claimed_at?: string | null
          audience_type?: string
          broad_area_text?: string | null
          converted_plan_id?: string | null
          created_at?: string
          discovery_scope?: string
          ends_at?: string
          id?: string
          max_participants?: number
          message?: string | null
          owner_id?: string
          starts_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hangout_sessions_converted_plan_id_fkey"
            columns: ["converted_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      hidden_content: {
        Row: {
          content_id: string
          content_type: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          content_id: string
          content_type: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          content_id?: string
          content_type?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          key: string
          result: Json | null
          scope: string
          status: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          key: string
          result?: Json | null
          scope: string
          status?: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          key?: string
          result?: Json | null
          scope?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      incident_actions: {
        Row: {
          action_type: string
          actor_id: string | null
          created_at: string
          description: string | null
          id: string
          incident_id: string
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          incident_id: string
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_actions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "security_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_links: {
        Row: {
          context_id: string | null
          created_at: string
          creator_id: string
          delivery_type: string
          expires_at: string
          id: string
          invite_type: string
          max_uses: number
          revoked_at: string | null
          status: string
          token_hash: string
          updated_at: string
          uses_count: number
        }
        Insert: {
          context_id?: string | null
          created_at?: string
          creator_id: string
          delivery_type?: string
          expires_at: string
          id?: string
          invite_type: string
          max_uses?: number
          revoked_at?: string | null
          status?: string
          token_hash: string
          updated_at?: string
          uses_count?: number
        }
        Update: {
          context_id?: string | null
          created_at?: string
          creator_id?: string
          delivery_type?: string
          expires_at?: string
          id?: string
          invite_type?: string
          max_uses?: number
          revoked_at?: string | null
          status?: string
          token_hash?: string
          updated_at?: string
          uses_count?: number
        }
        Relationships: []
      }
      jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          job_type: string
          last_error_at: string | null
          last_error_code: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          priority: number
          run_at: string
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          job_type: string
          last_error_at?: string | null
          last_error_code?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          run_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          job_type?: string
          last_error_at?: string | null
          last_error_code?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          priority?: number
          run_at?: string
          status?: string
        }
        Relationships: []
      }
      life_timeline_resets: {
        Row: {
          created_at: string
          hidden_before: string
          id: string
          relationship_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hidden_before?: string
          id?: string
          relationship_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hidden_before?: string
          id?: string
          relationship_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      linkr_actions: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          event_id: string | null
          expires_at: string | null
          id: string
          target_id: string
          updated_at: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          target_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          event_id?: string | null
          expires_at?: string | null
          id?: string
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkr_actions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      linkr_connections: {
        Row: {
          connected_at: string
          conversation_id: string | null
          created_at: string
          ended_at: string | null
          event_id: string | null
          id: string
          updated_at: string
          user_high: string
          user_low: string
        }
        Insert: {
          connected_at?: string
          conversation_id?: string | null
          created_at?: string
          ended_at?: string | null
          event_id?: string | null
          id?: string
          updated_at?: string
          user_high: string
          user_low: string
        }
        Update: {
          connected_at?: string
          conversation_id?: string | null
          created_at?: string
          ended_at?: string | null
          event_id?: string | null
          id?: string
          updated_at?: string
          user_high?: string
          user_low?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkr_connections_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkr_connections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      linkr_interests: {
        Row: {
          created_at: string
          id: string
          interest: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interest: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interest?: string
          user_id?: string
        }
        Relationships: []
      }
      linkr_profiles: {
        Row: {
          bio: string | null
          created_at: string
          discovery_distance: string
          enabled: boolean
          event_mode_enabled: boolean
          intent: string
          only_active_now: boolean
          only_new_today: boolean
          require_photos: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          discovery_distance?: string
          enabled?: boolean
          event_mode_enabled?: boolean
          intent?: string
          only_active_now?: boolean
          only_new_today?: boolean
          require_photos?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          discovery_distance?: string
          enabled?: boolean
          event_mode_enabled?: boolean
          intent?: string
          only_active_now?: boolean
          only_new_today?: boolean
          require_photos?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      maintenance_mode: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          id: boolean
          is_active: boolean
          message: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          id?: boolean
          is_active?: boolean
          message?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          id?: boolean
          is_active?: boolean
          message?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          content_type: string
          context_type: string
          created_at: string
          deleted_at: string | null
          duration_ms: number | null
          height: number | null
          id: string
          intended_conversation_id: string | null
          intended_media_kind: string | null
          moderation_status: string
          original_file_name: string | null
          owner_id: string
          processing_status: string
          retention_policy: string
          size_bytes: number
          storage_key: string
          updated_at: string
          upload_expires_at: string | null
          waveform_data: Json | null
          width: number | null
        }
        Insert: {
          content_type: string
          context_type: string
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number | null
          height?: number | null
          id?: string
          intended_conversation_id?: string | null
          intended_media_kind?: string | null
          moderation_status?: string
          original_file_name?: string | null
          owner_id: string
          processing_status?: string
          retention_policy?: string
          size_bytes: number
          storage_key: string
          updated_at?: string
          upload_expires_at?: string | null
          waveform_data?: Json | null
          width?: number | null
        }
        Update: {
          content_type?: string
          context_type?: string
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number | null
          height?: number | null
          id?: string
          intended_conversation_id?: string | null
          intended_media_kind?: string | null
          moderation_status?: string
          original_file_name?: string | null
          owner_id?: string
          processing_status?: string
          retention_policy?: string
          size_bytes?: number
          storage_key?: string
          updated_at?: string
          upload_expires_at?: string | null
          waveform_data?: Json | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_intended_conversation_id_fkey"
            columns: ["intended_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      media_deletion_queue: {
        Row: {
          id: string
          media_asset_id: string
          processed_at: string | null
          queued_at: string
          reason: string
        }
        Insert: {
          id?: string
          media_asset_id: string
          processed_at?: string | null
          queued_at?: string
          reason: string
        }
        Update: {
          id?: string
          media_asset_id?: string
          processed_at?: string | null
          queued_at?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_deletion_queue_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: true
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      media_variants: {
        Row: {
          created_at: string
          height: number | null
          id: string
          media_asset_id: string
          size_bytes: number | null
          storage_key: string
          variant_type: string
          width: number | null
        }
        Insert: {
          created_at?: string
          height?: number | null
          id?: string
          media_asset_id: string
          size_bytes?: number | null
          storage_key: string
          variant_type: string
          width?: number | null
        }
        Update: {
          created_at?: string
          height?: number | null
          id?: string
          media_asset_id?: string
          size_bytes?: number | null
          storage_key?: string
          variant_type?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "media_variants_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_ping_responses: {
        Row: {
          created_at: string
          id: string
          message: string | null
          ping_id: string
          responder_id: string
          response_type: string
          suggested_time: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          ping_id: string
          responder_id: string
          response_type: string
          suggested_time?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          ping_id?: string
          responder_id?: string
          response_type?: string
          suggested_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_ping_responses_ping_id_fkey"
            columns: ["ping_id"]
            isOneToOne: false
            referencedRelation: "meeting_pings"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_pings: {
        Row: {
          cancelled_at: string | null
          created_at: string
          custom_message: string | null
          custom_place_text: string | null
          expires_at: string
          id: string
          ping_type: string
          place_type: string
          proposed_time: string
          recipient_id: string
          responded_at: string | null
          seen_at: string | null
          sender_id: string
          status: string
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          custom_message?: string | null
          custom_place_text?: string | null
          expires_at: string
          id?: string
          ping_type: string
          place_type?: string
          proposed_time: string
          recipient_id: string
          responded_at?: string | null
          seen_at?: string | null
          sender_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          custom_message?: string | null
          custom_place_text?: string | null
          expires_at?: string
          id?: string
          ping_type?: string
          place_type?: string
          proposed_time?: string
          recipient_id?: string
          responded_at?: string | null
          seen_at?: string | null
          sender_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      meetup_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          event: string
          id: string
          meetup_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event: string
          id?: string
          meetup_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          meetup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_activity_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_discoveries: {
        Row: {
          category: string
          created_at: string
          creator_id: string
          id: string
          interest_limit: number
          listing_duration_minutes: number
          listing_expires_at: string
          max_attendees: number
          meetup_style: string
          refresh_count: number
          request_key: string
          starts_at: string
          status: string
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          creator_id: string
          id?: string
          interest_limit?: number
          listing_duration_minutes: number
          listing_expires_at: string
          max_attendees: number
          meetup_style: string
          refresh_count?: number
          request_key: string
          starts_at: string
          status?: string
          timezone: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          creator_id?: string
          id?: string
          interest_limit?: number
          listing_duration_minutes?: number
          listing_expires_at?: string
          max_attendees?: number
          meetup_style?: string
          refresh_count?: number
          request_key?: string
          starts_at?: string
          status?: string
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      meetup_discovery_interests: {
        Row: {
          created_at: string
          discovery_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          discovery_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          discovery_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_discovery_interests_discovery_id_fkey"
            columns: ["discovery_id"]
            isOneToOne: false
            referencedRelation: "meetup_discoveries"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_mutations: {
        Row: {
          actor_id: string
          meetup_id: string
          request_key: string
          result: Json
        }
        Insert: {
          actor_id: string
          meetup_id: string
          request_key: string
          result: Json
        }
        Update: {
          actor_id?: string
          meetup_id?: string
          request_key?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "meetup_mutations_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_notification_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string
          dedupe_key: string
          event: string
          id: string
          lease_id: string | null
          meetup_id: string
          recipient_id: string
          revision: number
          sender_id: string
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedupe_key: string
          event: string
          id?: string
          lease_id?: string | null
          meetup_id: string
          recipient_id: string
          revision: number
          sender_id: string
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          dedupe_key?: string
          event?: string
          id?: string
          lease_id?: string | null
          meetup_id?: string
          recipient_id?: string
          revision?: number
          sender_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_notification_outbox_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_participants: {
        Row: {
          arrival: string
          delay_minutes: number | null
          home_arrived_at: string | null
          home_started_at: string | null
          journey_state: string
          meetup_id: string
          met_at: string | null
          proximity_enabled: boolean
          proximity_observed_at: string | null
          response: string
          suggested_start_at: string | null
          user_id: string
        }
        Insert: {
          arrival?: string
          delay_minutes?: number | null
          home_arrived_at?: string | null
          home_started_at?: string | null
          journey_state?: string
          meetup_id: string
          met_at?: string | null
          proximity_enabled?: boolean
          proximity_observed_at?: string | null
          response?: string
          suggested_start_at?: string | null
          user_id: string
        }
        Update: {
          arrival?: string
          delay_minutes?: number | null
          home_arrived_at?: string | null
          home_started_at?: string | null
          journey_state?: string
          meetup_id?: string
          met_at?: string | null
          proximity_enabled?: boolean
          proximity_observed_at?: string | null
          response?: string
          suggested_start_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetup_participants_meetup_id_fkey"
            columns: ["meetup_id"]
            isOneToOne: false
            referencedRelation: "meetups"
            referencedColumns: ["id"]
          },
        ]
      }
      meetup_requests: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          message: string | null
          receiver_id: string
          sender_id: string
          status: Database["public"]["Enums"]["meetup_status"]
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          message?: string | null
          receiver_id: string
          sender_id: string
          status?: Database["public"]["Enums"]["meetup_status"]
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          message?: string | null
          receiver_id?: string
          sender_id?: string
          status?: Database["public"]["Enums"]["meetup_status"]
        }
        Relationships: []
      }
      meetups: {
        Row: {
          arranged_at: string
          beacon_confirmed_at: string | null
          beacon_latitude: number | null
          beacon_longitude: number | null
          beacon_set_at: string | null
          beacon_set_by: string | null
          category: string
          created_at: string
          creator_id: string
          expires_at: string
          host_id: string | null
          id: string
          mode: string
          note: string
          place_label: string
          request_key: string
          revision: number
          source_discovery_id: string | null
          starts_at: string
          status: string
          timezone: string
          title: string | null
          together_at: string | null
        }
        Insert: {
          arranged_at?: string
          beacon_confirmed_at?: string | null
          beacon_latitude?: number | null
          beacon_longitude?: number | null
          beacon_set_at?: string | null
          beacon_set_by?: string | null
          category?: string
          created_at?: string
          creator_id: string
          expires_at: string
          host_id?: string | null
          id?: string
          mode: string
          note?: string
          place_label: string
          request_key: string
          revision?: number
          source_discovery_id?: string | null
          starts_at: string
          status?: string
          timezone: string
          title?: string | null
          together_at?: string | null
        }
        Update: {
          arranged_at?: string
          beacon_confirmed_at?: string | null
          beacon_latitude?: number | null
          beacon_longitude?: number | null
          beacon_set_at?: string | null
          beacon_set_by?: string | null
          category?: string
          created_at?: string
          creator_id?: string
          expires_at?: string
          host_id?: string | null
          id?: string
          mode?: string
          note?: string
          place_label?: string
          request_key?: string
          revision?: number
          source_discovery_id?: string | null
          starts_at?: string
          status?: string
          timezone?: string
          title?: string | null
          together_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetups_source_discovery_id_fkey"
            columns: ["source_discovery_id"]
            isOneToOne: false
            referencedRelation: "meetup_discoveries"
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
      message_hides: {
        Row: {
          created_at: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_hides_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_mentions: {
        Row: {
          created_at: string
          mentioned_user_id: string
          message_id: string
        }
        Insert: {
          created_at?: string
          mentioned_user_id: string
          message_id: string
        }
        Update: {
          created_at?: string
          mentioned_user_id?: string
          message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_mentions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
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
      message_reactions: {
        Row: {
          created_at: string
          id: string
          message_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          client_message_id: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          edited_at: string | null
          expires_at: string | null
          forwarded_from_message_id: string | null
          id: string
          kept_at: string | null
          kept_by: string | null
          media_id: string | null
          media_mode: string
          message_type: string
          quick_action_type: string | null
          reply_to_message_id: string | null
          sender_id: string | null
          status: string
          system_event_type: string | null
          text_content: string | null
          waveform_data: Json | null
        }
        Insert: {
          client_message_id?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          edited_at?: string | null
          expires_at?: string | null
          forwarded_from_message_id?: string | null
          id?: string
          kept_at?: string | null
          kept_by?: string | null
          media_id?: string | null
          media_mode?: string
          message_type?: string
          quick_action_type?: string | null
          reply_to_message_id?: string | null
          sender_id?: string | null
          status?: string
          system_event_type?: string | null
          text_content?: string | null
          waveform_data?: Json | null
        }
        Update: {
          client_message_id?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          edited_at?: string | null
          expires_at?: string | null
          forwarded_from_message_id?: string | null
          id?: string
          kept_at?: string | null
          kept_by?: string | null
          media_id?: string | null
          media_mode?: string
          message_type?: string
          quick_action_type?: string | null
          reply_to_message_id?: string | null
          sender_id?: string | null
          status?: string
          system_event_type?: string | null
          text_content?: string | null
          waveform_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_forwarded_from_message_id_fkey"
            columns: ["forwarded_from_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          action_type: string
          created_at: string
          id: string
          moderator_id: string | null
          reason: string | null
          report_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          moderator_id?: string | null
          reason?: string | null
          report_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          moderator_id?: string | null
          reason?: string | null
          report_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "content_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      moment_audience_targets: {
        Row: {
          created_at: string
          id: string
          moment_id: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          moment_id: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          moment_id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "moment_audience_targets_moment_id_fkey"
            columns: ["moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
        ]
      }
      moment_reactions: {
        Row: {
          created_at: string
          id: string
          moment_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          moment_id: string
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          moment_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moment_reactions_moment_id_fkey"
            columns: ["moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
        ]
      }
      moment_views: {
        Row: {
          id: string
          moment_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          id?: string
          moment_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          id?: string
          moment_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moment_views_moment_id_fkey"
            columns: ["moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
        ]
      }
      moments: {
        Row: {
          audience_type: string
          author_id: string
          caption: string | null
          content_type: string
          created_at: string
          deleted_at: string | null
          expires_at: string
          id: string
          media_id: string | null
          starts_at: string
          status: string
          text_content: string | null
          updated_at: string
        }
        Insert: {
          audience_type: string
          author_id: string
          caption?: string | null
          content_type: string
          created_at?: string
          deleted_at?: string | null
          expires_at: string
          id?: string
          media_id?: string | null
          starts_at?: string
          status?: string
          text_content?: string | null
          updated_at?: string
        }
        Update: {
          audience_type?: string
          author_id?: string
          caption?: string | null
          content_type?: string
          created_at?: string
          deleted_at?: string | null
          expires_at?: string
          id?: string
          media_id?: string | null
          starts_at?: string
          status?: string
          text_content?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moments_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      muddy_drops: {
        Row: {
          action_target_id: string | null
          action_type: string | null
          content_type: string
          context_id: string
          context_type: string
          created_at: string
          creator_id: string
          drop_type: string
          expires_at: string
          id: string
          max_unlocks: number | null
          media_id: string | null
          starts_at: string
          status: string
          text_content: string | null
          updated_at: string
        }
        Insert: {
          action_target_id?: string | null
          action_type?: string | null
          content_type: string
          context_id: string
          context_type: string
          created_at?: string
          creator_id: string
          drop_type: string
          expires_at: string
          id?: string
          max_unlocks?: number | null
          media_id?: string | null
          starts_at?: string
          status?: string
          text_content?: string | null
          updated_at?: string
        }
        Update: {
          action_target_id?: string | null
          action_type?: string | null
          content_type?: string
          context_id?: string
          context_type?: string
          created_at?: string
          creator_id?: string
          drop_type?: string
          expires_at?: string
          id?: string
          max_unlocks?: number | null
          media_id?: string | null
          starts_at?: string
          status?: string
          text_content?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "muddy_drops_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_budget_usage: {
        Row: {
          created_at: string
          day_key: string
          id: string
          sent_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_key: string
          id?: string
          sent_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_key?: string
          id?: string
          sent_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_dispatches: {
        Row: {
          context: Json
          created_at: string
          dedupe_key: string | null
          expires_at: string
          id: string
          payload: Json
          user_id: string
        }
        Insert: {
          context?: Json
          created_at?: string
          dedupe_key?: string | null
          expires_at?: string
          id?: string
          payload: Json
          user_id: string
        }
        Update: {
          context?: Json
          created_at?: string
          dedupe_key?: string | null
          expires_at?: string
          id?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      notification_push_deliveries: {
        Row: {
          attempts: number
          dispatch_id: string
          id: string
          last_error: string | null
          lease_id: string | null
          locked_at: string | null
          run_at: string
          status: string
          target_id: string
          transport: string
        }
        Insert: {
          attempts?: number
          dispatch_id: string
          id?: string
          last_error?: string | null
          lease_id?: string | null
          locked_at?: string | null
          run_at?: string
          status?: string
          target_id: string
          transport: string
        }
        Update: {
          attempts?: number
          dispatch_id?: string
          id?: string
          last_error?: string | null
          lease_id?: string | null
          locked_at?: string | null
          run_at?: string
          status?: string
          target_id?: string
          transport?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_push_deliveries_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "notification_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          dedupe_key: string | null
          id: string
          is_read: boolean
          message: string
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          is_read?: boolean
          message: string
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      onboarding_progress: {
        Row: {
          activated_at: string | null
          completed_at: string | null
          created_at: string
          current_step: string
          first_muddy_added_at: string | null
          location_permission_result: string | null
          location_prompted_at: string | null
          privacy_reviewed_at: string | null
          profile_completed_at: string | null
          skipped_optional: boolean
          updated_at: string
          user_id: string
          visibility_configured_at: string | null
        }
        Insert: {
          activated_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_step?: string
          first_muddy_added_at?: string | null
          location_permission_result?: string | null
          location_prompted_at?: string | null
          privacy_reviewed_at?: string | null
          profile_completed_at?: string | null
          skipped_optional?: boolean
          updated_at?: string
          user_id: string
          visibility_configured_at?: string | null
        }
        Update: {
          activated_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_step?: string
          first_muddy_added_at?: string | null
          location_permission_result?: string | null
          location_prompted_at?: string | null
          privacy_reviewed_at?: string | null
          profile_completed_at?: string | null
          skipped_optional?: boolean
          updated_at?: string
          user_id?: string
          visibility_configured_at?: string | null
        }
        Relationships: []
      }
      paystack_webhook_events: {
        Row: {
          created_at: string
          id: string
          type: string
        }
        Insert: {
          created_at?: string
          id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          type?: string
        }
        Relationships: []
      }
      plan_participants: {
        Row: {
          attendance_visibility: string
          created_at: string
          id: string
          invited_by: string | null
          plan_id: string
          responded_at: string | null
          response_note: string | null
          role: string
          rsvp_status: string
          updated_at: string
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          attendance_visibility?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          plan_id: string
          responded_at?: string | null
          response_note?: string | null
          role?: string
          rsvp_status?: string
          updated_at?: string
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          attendance_visibility?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          plan_id?: string
          responded_at?: string | null
          response_note?: string | null
          role?: string
          rsvp_status?: string
          updated_at?: string
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_participants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_poll_options: {
        Row: {
          created_at: string
          id: string
          label: string
          poll_id: string
          sort_order: number
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          poll_id: string
          sort_order?: number
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          poll_id?: string
          sort_order?: number
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_poll_options_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "plan_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_poll_votes: {
        Row: {
          created_at: string
          id: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          option_id: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          option_id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_poll_votes_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "plan_poll_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "plan_polls"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_polls: {
        Row: {
          closes_at: string | null
          confirmed_option_id: string | null
          created_at: string
          creator_id: string
          id: string
          plan_id: string
          poll_type: string
          question: string
          results_visibility: string
          selection_mode: string
          status: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          confirmed_option_id?: string | null
          created_at?: string
          creator_id: string
          id?: string
          plan_id: string
          poll_type: string
          question: string
          results_visibility?: string
          selection_mode?: string
          status?: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          confirmed_option_id?: string | null
          created_at?: string
          creator_id?: string
          id?: string
          plan_id?: string
          poll_type?: string
          question?: string
          results_visibility?: string
          selection_mode?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_polls_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          cancelled_at: string | null
          category: string | null
          chat_close_days: number
          completed_at: string | null
          cover_image_url: string | null
          created_at: string
          creator_id: string
          custom_place_text: string | null
          description: string | null
          end_at: string | null
          id: string
          max_participants: number
          place_id: string | null
          place_type: string
          plan_type: string
          reminder_minutes: number | null
          rsvp_deadline: string | null
          source_hangout_id: string | null
          source_ping_id: string | null
          start_at: string | null
          status: string
          timezone: string
          title: string
          updated_at: string
          visibility_type: string
        }
        Insert: {
          cancelled_at?: string | null
          category?: string | null
          chat_close_days?: number
          completed_at?: string | null
          cover_image_url?: string | null
          created_at?: string
          creator_id: string
          custom_place_text?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          max_participants?: number
          place_id?: string | null
          place_type?: string
          plan_type: string
          reminder_minutes?: number | null
          rsvp_deadline?: string | null
          source_hangout_id?: string | null
          source_ping_id?: string | null
          start_at?: string | null
          status?: string
          timezone?: string
          title: string
          updated_at?: string
          visibility_type?: string
        }
        Update: {
          cancelled_at?: string | null
          category?: string | null
          chat_close_days?: number
          completed_at?: string | null
          cover_image_url?: string | null
          created_at?: string
          creator_id?: string
          custom_place_text?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          max_participants?: number
          place_id?: string | null
          place_type?: string
          plan_type?: string
          reminder_minutes?: number | null
          rsvp_deadline?: string | null
          source_hangout_id?: string | null
          source_ping_id?: string | null
          start_at?: string | null
          status?: string
          timezone?: string
          title?: string
          updated_at?: string
          visibility_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "plans_source_hangout_fk"
            columns: ["source_hangout_id"]
            isOneToOne: false
            referencedRelation: "hangout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_source_ping_id_fkey"
            columns: ["source_ping_id"]
            isOneToOne: false
            referencedRelation: "meeting_pings"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_trial_config: {
        Row: {
          available_from: string | null
          available_until: string | null
          campaign_source: string | null
          created_at: string
          duration_days: number
          eligibility_rules: Json
          eligible_plan: Database["public"]["Enums"]["subscription_plan"]
          enabled: boolean
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          available_from?: string | null
          available_until?: string | null
          campaign_source?: string | null
          created_at?: string
          duration_days?: number
          eligibility_rules?: Json
          eligible_plan?: Database["public"]["Enums"]["subscription_plan"]
          enabled?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          available_from?: string | null
          available_until?: string | null
          campaign_source?: string | null
          created_at?: string
          duration_days?: number
          eligibility_rules?: Json
          eligible_plan?: Database["public"]["Enums"]["subscription_plan"]
          enabled?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      premium_trial_events: {
        Row: {
          created_at: string
          event_key: string
          event_type: string
          feature_key: string | null
          id: string
          metadata: Json
          occurred_at: string
          trial_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_key: string
          event_type: string
          feature_key?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          trial_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_key?: string
          event_type?: string
          feature_key?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          trial_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "premium_trial_events_trial_id_fkey"
            columns: ["trial_id"]
            isOneToOne: false
            referencedRelation: "premium_trials"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_trial_notifications: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          delivery_status: string
          id: string
          last_attempt_at: string | null
          notification_type: string
          trial_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string
          id?: string
          last_attempt_at?: string | null
          notification_type: string
          trial_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string
          id?: string
          last_attempt_at?: string | null
          notification_type?: string
          trial_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "premium_trial_notifications_trial_id_fkey"
            columns: ["trial_id"]
            isOneToOne: false
            referencedRelation: "premium_trials"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_trials: {
        Row: {
          campaign_source: string | null
          cancelled_at: string | null
          converted_at: string | null
          created_at: string
          granted_by: string | null
          id: string
          override_reason: string | null
          owner_override: boolean
          plan: Database["public"]["Enums"]["subscription_plan"]
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          source: string
          status: string
          trial_ends_at: string
          trial_started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_source?: string | null
          cancelled_at?: string | null
          converted_at?: string | null
          created_at?: string
          granted_by?: string | null
          id?: string
          override_reason?: string | null
          owner_override?: boolean
          plan: Database["public"]["Enums"]["subscription_plan"]
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source?: string
          status?: string
          trial_ends_at: string
          trial_started_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_source?: string | null
          cancelled_at?: string | null
          converted_at?: string | null
          created_at?: string
          granted_by?: string | null
          id?: string
          override_reason?: string | null
          owner_override?: boolean
          plan?: Database["public"]["Enums"]["subscription_plan"]
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source?: string
          status?: string
          trial_ends_at?: string
          trial_started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      privacy_requests: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          id: string
          legal_hold_expires_at: string | null
          legal_hold_reason: string | null
          request_type: string
          status: string
          submitted_at: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          legal_hold_expires_at?: string | null
          legal_hold_reason?: string | null
          request_type: string
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          legal_hold_expires_at?: string | null
          legal_hold_reason?: string | null
          request_type?: string
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      privacy_setup_versions: {
        Row: {
          created_at: string
          last_reviewed_at: string | null
          policy_version: string
          setup_completed_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_reviewed_at?: string | null
          policy_version: string
          setup_completed_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_reviewed_at?: string | null
          policy_version?: string
          setup_completed_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      privacy_zones: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          name: string
          radius: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          name: string
          radius: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          name?: string
          radius?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_birth_details: {
        Row: {
          correction_used_at: string | null
          created_at: string
          date_of_birth: string
          updated_at: string
          user_id: string
        }
        Insert: {
          correction_used_at?: string | null
          created_at?: string
          date_of_birth: string
          updated_at?: string
          user_id: string
        }
        Update: {
          correction_used_at?: string | null
          created_at?: string
          date_of_birth?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_field_privacy: {
        Row: {
          created_at: string
          field_name: string
          id: string
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          created_at?: string
          field_name: string
          id?: string
          updated_at?: string
          user_id: string
          visibility: string
        }
        Update: {
          created_at?: string
          field_name?: string
          id?: string
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: []
      }
      profile_photos: {
        Row: {
          created_at: string
          id: string
          media_asset_id: string
          position: number
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_asset_id: string
          position: number
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          created_at?: string
          id?: string
          media_asset_id?: string
          position?: number
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_photos_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          deleted_at: string | null
          full_name: string
          general_area: string | null
          graduation_year: number | null
          id: string
          institution: string | null
          is_onboarded: boolean
          mood_status: string | null
          profile_media_id: string | null
          programme: string | null
          pronouns: string | null
          trusted_member_since: string | null
          updated_at: string
          user_id: string
          username: string
          username_changed_at: string | null
          username_normalized: string | null
          visibility_status: Database["public"]["Enums"]["visibility_status"]
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name: string
          general_area?: string | null
          graduation_year?: number | null
          id?: string
          institution?: string | null
          is_onboarded?: boolean
          mood_status?: string | null
          profile_media_id?: string | null
          programme?: string | null
          pronouns?: string | null
          trusted_member_since?: string | null
          updated_at?: string
          user_id: string
          username: string
          username_changed_at?: string | null
          username_normalized?: string | null
          visibility_status?: Database["public"]["Enums"]["visibility_status"]
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          deleted_at?: string | null
          full_name?: string
          general_area?: string | null
          graduation_year?: number | null
          id?: string
          institution?: string | null
          is_onboarded?: boolean
          mood_status?: string | null
          profile_media_id?: string | null
          programme?: string | null
          pronouns?: string | null
          trusted_member_since?: string | null
          updated_at?: string
          user_id?: string
          username?: string
          username_changed_at?: string | null
          username_normalized?: string | null
          visibility_status?: Database["public"]["Enums"]["visibility_status"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_profile_media_id_fkey"
            columns: ["profile_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_codes: {
        Row: {
          code_hash: string
          created_at: string
          currency: string | null
          discount_type: string
          discount_value: number
          eligible_plans: string[]
          expires_at: string | null
          id: string
          max_redemptions: number | null
          per_user_limit: number
          redemptions_count: number
          starts_at: string | null
          status: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          currency?: string | null
          discount_type: string
          discount_value: number
          eligible_plans?: string[]
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          per_user_limit?: number
          redemptions_count?: number
          starts_at?: string | null
          status?: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          currency?: string | null
          discount_type?: string
          discount_value?: number
          eligible_plans?: string[]
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          per_user_limit?: number
          redemptions_count?: number
          starts_at?: string | null
          status?: string
        }
        Relationships: []
      }
      promotion_redemptions: {
        Row: {
          created_at: string
          id: string
          promotion_id: string
          redeemed_at: string
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          promotion_id: string
          redeemed_at?: string
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          promotion_id?: string
          redeemed_at?: string
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotion_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_cost_records: {
        Row: {
          amount_minor: number
          billing_period: string
          category: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          notes: string | null
          provider: string
          source: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          billing_period: string
          category: string
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          notes?: string | null
          provider: string
          source: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          billing_period?: string
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          provider?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      proximity_events: {
        Row: {
          confidence: Database["public"]["Enums"]["location_confidence"]
          created_at: string
          expires_at: string
          friend_id: string
          glow_strength: number
          id: string
          proximity_level: Database["public"]["Enums"]["proximity_level"]
          user_id: string
        }
        Insert: {
          confidence: Database["public"]["Enums"]["location_confidence"]
          created_at?: string
          expires_at: string
          friend_id: string
          glow_strength: number
          id?: string
          proximity_level: Database["public"]["Enums"]["proximity_level"]
          user_id: string
        }
        Update: {
          confidence?: Database["public"]["Enums"]["location_confidence"]
          created_at?: string
          expires_at?: string
          friend_id?: string
          glow_strength?: number
          id?: string
          proximity_level?: Database["public"]["Enums"]["proximity_level"]
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      qr_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          starts_at: string
          token_hash: string
          used_at: string | null
          used_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          starts_at?: string
          token_hash: string
          used_at?: string | null
          used_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          starts_at?: string
          token_hash?: string
          used_at?: string | null
          used_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          action: string
          count: number
          created_at: string
          id: string
          ip_hash: string | null
          updated_at: string
          user_id: string | null
          window_end: string
          window_start: string
        }
        Insert: {
          action: string
          count?: number
          created_at?: string
          id?: string
          ip_hash?: string | null
          updated_at?: string
          user_id?: string | null
          window_end: string
          window_start: string
        }
        Update: {
          action?: string
          count?: number
          created_at?: string
          id?: string
          ip_hash?: string | null
          updated_at?: string
          user_id?: string | null
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      recap_preferences: {
        Row: {
          annual_enabled: boolean
          created_at: string
          monthly_enabled: boolean
          sharing_enabled: boolean
          updated_at: string
          user_id: string
          weekly_enabled: boolean
        }
        Insert: {
          annual_enabled?: boolean
          created_at?: string
          monthly_enabled?: boolean
          sharing_enabled?: boolean
          updated_at?: string
          user_id: string
          weekly_enabled?: boolean
        }
        Update: {
          annual_enabled?: boolean
          created_at?: string
          monthly_enabled?: boolean
          sharing_enabled?: boolean
          updated_at?: string
          user_id?: string
          weekly_enabled?: boolean
        }
        Relationships: []
      }
      relationship_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          source: string
          subject_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          source?: string
          subject_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          source?: string
          subject_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          description: string | null
          id: string
          reason: string
          reported_user_id: string | null
          reported_user_label: string
          reporter_id: string | null
          status: Database["public"]["Enums"]["report_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          reason: string
          reported_user_id?: string | null
          reported_user_label?: string
          reporter_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          reason?: string
          reported_user_id?: string | null
          reported_user_label?: string
          reporter_id?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          updated_at?: string
        }
        Relationships: []
      }
      safe_arrival_blocks: {
        Row: {
          blocked_traveller_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          blocked_traveller_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          blocked_traveller_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      safe_arrival_contacts: {
        Row: {
          acknowledged_at: string | null
          acknowledgement_status: string
          contact_user_id: string
          created_at: string
          id: string
          notified_at: string | null
          session_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledgement_status?: string
          contact_user_id: string
          created_at?: string
          id?: string
          notified_at?: string | null
          session_id: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledgement_status?: string
          contact_user_id?: string
          created_at?: string
          id?: string
          notified_at?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safe_arrival_contacts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "safe_arrival_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      safe_arrival_events: {
        Row: {
          client_mutation_id: string | null
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          metadata: Json
          session_id: string
        }
        Insert: {
          client_mutation_id?: string | null
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          metadata?: Json
          session_id: string
        }
        Update: {
          client_mutation_id?: string | null
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safe_arrival_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "safe_arrival_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      safe_arrival_sessions: {
        Row: {
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          destination_event_id: string | null
          destination_label: string
          destination_type: string
          expected_arrival_at: string
          expired_at: string | null
          grace_period_minutes: number
          id: string
          note: string | null
          started_at: string
          status: string
          traveller_id: string
          unconfirmed_at: string | null
          unconfirmed_notified_at: string | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          destination_event_id?: string | null
          destination_label: string
          destination_type?: string
          expected_arrival_at: string
          expired_at?: string | null
          grace_period_minutes?: number
          id?: string
          note?: string | null
          started_at?: string
          status?: string
          traveller_id: string
          unconfirmed_at?: string | null
          unconfirmed_notified_at?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          destination_event_id?: string | null
          destination_label?: string
          destination_type?: string
          expected_arrival_at?: string
          expired_at?: string | null
          grace_period_minutes?: number
          id?: string
          note?: string | null
          started_at?: string
          status?: string
          traveller_id?: string
          unconfirmed_at?: string | null
          unconfirmed_notified_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safe_arrival_sessions_destination_event_id_fkey"
            columns: ["destination_event_id"]
            isOneToOne: false
            referencedRelation: "events"
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
      scheduler_incidents: {
        Row: {
          alerted_at: string | null
          consecutive_failures: number
          created_at: string
          id: string
          missing_ticks: boolean
          opened_at: string
          recovery_notified_at: string | null
          resolved_at: string | null
          scheduler: string
        }
        Insert: {
          alerted_at?: string | null
          consecutive_failures?: number
          created_at?: string
          id?: string
          missing_ticks?: boolean
          opened_at?: string
          recovery_notified_at?: string | null
          resolved_at?: string | null
          scheduler?: string
        }
        Update: {
          alerted_at?: string | null
          consecutive_failures?: number
          created_at?: string
          id?: string
          missing_ticks?: boolean
          opened_at?: string
          recovery_notified_at?: string | null
          resolved_at?: string | null
          scheduler?: string
        }
        Relationships: []
      }
      security_incidents: {
        Row: {
          commander_id: string | null
          contained_at: string | null
          created_at: string
          detected_at: string
          id: string
          incident_type: string
          resolved_at: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          commander_id?: string | null
          contained_at?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          incident_type: string
          resolved_at?: string | null
          severity: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          commander_id?: string | null
          contained_at?: string | null
          created_at?: string
          detected_at?: string
          id?: string
          incident_type?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sensitive_access_log: {
        Row: {
          accessed_at: string
          actor_id: string | null
          approved_by: string | null
          case_reference: string | null
          category: string
          created_at: string
          id: string
          reason: string
          subject_user_id: string | null
        }
        Insert: {
          accessed_at?: string
          actor_id?: string | null
          approved_by?: string | null
          case_reference?: string | null
          category: string
          created_at?: string
          id?: string
          reason: string
          subject_user_id?: string | null
        }
        Update: {
          accessed_at?: string
          actor_id?: string | null
          approved_by?: string | null
          case_reference?: string | null
          category?: string
          created_at?: string
          id?: string
          reason?: string
          subject_user_id?: string | null
        }
        Relationships: []
      }
      smart_card_acknowledgements: {
        Row: {
          acknowledged_at: string
          card_id: string
          id: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          card_id: string
          id?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          card_id?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      socialize_sessions: {
        Row: {
          activity: string
          area_tier: string
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          note: string | null
          starts_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activity: string
          area_tier: string
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          note?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activity?: string
          area_tier?: string
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          note?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      status_visibility_targets: {
        Row: {
          created_at: string
          id: string
          status_id: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          status_id: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          status_id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_visibility_targets_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "user_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      streak_qualifying_events: {
        Row: {
          actor_id: string
          created_at: string
          event_reference_id: string | null
          event_type: string
          friendship_id: string
          id: string
          period_key: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          event_reference_id?: string | null
          event_type: string
          friendship_id: string
          id?: string
          period_key: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          event_reference_id?: string | null
          event_type?: string
          friendship_id?: string
          id?: string
          period_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "streak_qualifying_events_friendship_id_fkey"
            columns: ["friendship_id"]
            isOneToOne: false
            referencedRelation: "friendships"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          created_at: string
          id: string
          processed_at: string
          type: string
        }
        Insert: {
          created_at?: string
          id: string
          processed_at?: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          processed_at?: string
          type?: string
        }
        Relationships: []
      }
      subscription_changes: {
        Row: {
          applied_at: string | null
          cancelled_at: string | null
          change_type: string
          created_at: string
          effective_at: string | null
          from_plan: string
          id: string
          reason: string | null
          requested_at: string
          status: string
          subscription_id: string | null
          to_plan: string
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          cancelled_at?: string | null
          change_type: string
          created_at?: string
          effective_at?: string | null
          from_plan: string
          id?: string
          reason?: string | null
          requested_at?: string
          status?: string
          subscription_id?: string | null
          to_plan: string
          user_id: string
        }
        Update: {
          applied_at?: string | null
          cancelled_at?: string | null
          change_type?: string
          created_at?: string
          effective_at?: string | null
          from_plan?: string
          id?: string
          reason?: string | null
          requested_at?: string
          status?: string
          subscription_id?: string | null
          to_plan?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_changes_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          grace_ends_at: string | null
          id: string
          paystack_authorization_code: string | null
          paystack_customer_code: string | null
          paystack_email_token: string | null
          paystack_subscription_code: string | null
          plan: Database["public"]["Enums"]["subscription_plan"]
          provider: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subject_type: string
          trial_ends_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          grace_ends_at?: string | null
          id?: string
          paystack_authorization_code?: string | null
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          plan?: Database["public"]["Enums"]["subscription_plan"]
          provider?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subject_type?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          grace_ends_at?: string | null
          id?: string
          paystack_authorization_code?: string | null
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          plan?: Database["public"]["Enums"]["subscription_plan"]
          provider?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subject_type?: string
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_internal_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_internal_notes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_requests: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          message: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          message: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          message?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      support_ticket_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_value: string | null
          id: string
          note: string | null
          ticket_id: string
          to_value: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_value?: string | null
          id?: string
          note?: string | null
          ticket_id: string
          to_value?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_value?: string | null
          id?: string
          note?: string | null
          ticket_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_messages: {
        Row: {
          attachment_media_id: string | null
          created_at: string
          id: string
          message: string
          sender_id: string | null
          sender_type: string
          ticket_id: string
        }
        Insert: {
          attachment_media_id?: string | null
          created_at?: string
          id?: string
          message: string
          sender_id?: string | null
          sender_type: string
          ticket_id: string
        }
        Update: {
          attachment_media_id?: string | null
          created_at?: string
          id?: string
          message?: string
          sender_id?: string | null
          sender_type?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_attachment_media_id_fkey"
            columns: ["attachment_media_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          description: string
          diagnostics: Json
          id: string
          legacy_support_request_id: string | null
          priority: string
          resolved_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string
          description: string
          diagnostics?: Json
          id?: string
          legacy_support_request_id?: string | null
          priority?: string
          resolved_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          description?: string
          diagnostics?: Json
          id?: string
          legacy_support_request_id?: string | null
          priority?: string
          resolved_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_legacy_support_request_id_fkey"
            columns: ["legacy_support_request_id"]
            isOneToOne: true
            referencedRelation: "support_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      temporary_plans: {
        Row: {
          created_at: string
          creator_id: string
          expires_at: string
          id: string
          meeting_time: string
          participant_id: string
          place_text: string | null
          source_ping_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          expires_at: string
          id?: string
          meeting_time: string
          participant_id: string
          place_text?: string | null
          source_ping_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          expires_at?: string
          id?: string
          meeting_time?: string
          participant_id?: string
          place_text?: string | null
          source_ping_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "temporary_plans_source_ping_id_fkey"
            columns: ["source_ping_id"]
            isOneToOne: true
            referencedRelation: "meeting_pings"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_entitlement_overrides: {
        Row: {
          boolean_value: boolean | null
          entitlement_key: string
          id: string
          is_unlimited: boolean
          numeric_value: number | null
          plan: string
          updated_at: string
          updated_by: string | null
          value_type: string
        }
        Insert: {
          boolean_value?: boolean | null
          entitlement_key: string
          id?: string
          is_unlimited?: boolean
          numeric_value?: number | null
          plan: string
          updated_at?: string
          updated_by?: string | null
          value_type: string
        }
        Update: {
          boolean_value?: boolean | null
          entitlement_key?: string
          id?: string
          is_unlimited?: boolean
          numeric_value?: number | null
          plan?: string
          updated_at?: string
          updated_by?: string | null
          value_type?: string
        }
        Relationships: []
      }
      tour_steps: {
        Row: {
          body: string
          created_at: string
          cta_href: string | null
          cta_label: string | null
          entitlement_keys: string[]
          id: string
          media_path: string | null
          position: number
          requires_feature_flag: string | null
          route: string | null
          step_key: string
          target_id: string | null
          title: string
          tour_version_id: string
        }
        Insert: {
          body: string
          created_at?: string
          cta_href?: string | null
          cta_label?: string | null
          entitlement_keys?: string[]
          id?: string
          media_path?: string | null
          position: number
          requires_feature_flag?: string | null
          route?: string | null
          step_key: string
          target_id?: string | null
          title: string
          tour_version_id: string
        }
        Update: {
          body?: string
          created_at?: string
          cta_href?: string | null
          cta_label?: string | null
          entitlement_keys?: string[]
          id?: string
          media_path?: string | null
          position?: number
          requires_feature_flag?: string | null
          route?: string | null
          step_key?: string
          target_id?: string | null
          title?: string
          tour_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tour_steps_tour_version_id_fkey"
            columns: ["tour_version_id"]
            isOneToOne: false
            referencedRelation: "tour_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      tour_versions: {
        Row: {
          audience: Json
          created_at: string
          ends_at: string | null
          id: string
          publish_reason: string | null
          published_at: string | null
          starts_at: string | null
          status: string
          tour_id: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          audience?: Json
          created_at?: string
          ends_at?: string | null
          id?: string
          publish_reason?: string | null
          published_at?: string | null
          starts_at?: string | null
          status?: string
          tour_id: string
          updated_at?: string
          updated_by?: string | null
          version: number
        }
        Update: {
          audience?: Json
          created_at?: string
          ends_at?: string | null
          id?: string
          publish_reason?: string | null
          published_at?: string | null
          starts_at?: string | null
          status?: string
          tour_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tour_versions_tour_id_fkey"
            columns: ["tour_id"]
            isOneToOne: false
            referencedRelation: "tours"
            referencedColumns: ["id"]
          },
        ]
      }
      tours: {
        Row: {
          created_at: string
          description: string
          id: string
          kind: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          kind?: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          kind?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      trust_safety_cases: {
        Row: {
          assigned_to: string | null
          case_type: string
          created_at: string
          created_from_report_id: string | null
          id: string
          opened_at: string
          priority: string
          resolved_at: string | null
          status: string
          subject_user_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          case_type: string
          created_at?: string
          created_from_report_id?: string | null
          id?: string
          opened_at?: string
          priority?: string
          resolved_at?: string | null
          status?: string
          subject_user_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          case_type?: string
          created_at?: string
          created_from_report_id?: string | null
          id?: string
          opened_at?: string
          priority?: string
          resolved_at?: string | null
          status?: string
          subject_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      trusted_member_applications: {
        Row: {
          created_at: string
          id: string
          journeys_complete_at_apply: number | null
          note: string | null
          premium_days_at_apply: number | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          journeys_complete_at_apply?: number | null
          note?: string | null
          premium_days_at_apply?: number | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          journeys_complete_at_apply?: number | null
          note?: string | null
          premium_days_at_apply?: number | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tune_ins: {
        Row: {
          created_at: string
          creator_id: string
          id: string
          source_moment_id: string | null
          viewer_id: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          id?: string
          source_moment_id?: string | null
          viewer_id: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          id?: string
          source_moment_id?: string | null
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tune_ins_source_moment_id_fkey"
            columns: ["source_moment_id"]
            isOneToOne: false
            referencedRelation: "moments"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_code: string
          created_at: string
          earned_at: string
          hidden: boolean
          id: string
          shared_at: string | null
          user_id: string
          viewed_at: string | null
        }
        Insert: {
          achievement_code: string
          created_at?: string
          earned_at?: string
          hidden?: boolean
          id?: string
          shared_at?: string | null
          user_id: string
          viewed_at?: string | null
        }
        Update: {
          achievement_code?: string
          created_at?: string
          earned_at?: string
          hidden?: boolean
          id?: string
          shared_at?: string | null
          user_id?: string
          viewed_at?: string | null
        }
        Relationships: []
      }
      user_interests: {
        Row: {
          created_at: string
          id: string
          interest: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          interest: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          interest?: string
          user_id?: string
        }
        Relationships: []
      }
      user_locations: {
        Row: {
          accuracy: number
          confidence: Database["public"]["Enums"]["location_confidence"]
          id: string
          last_updated: string
          latitude: number
          longitude: number
          user_id: string
        }
        Insert: {
          accuracy: number
          confidence: Database["public"]["Enums"]["location_confidence"]
          id?: string
          last_updated?: string
          latitude: number
          longitude: number
          user_id: string
        }
        Update: {
          accuracy?: number
          confidence?: Database["public"]["Enums"]["location_confidence"]
          id?: string
          last_updated?: string
          latitude?: number
          longitude?: number
          user_id?: string
        }
        Relationships: []
      }
      user_phone_identities: {
        Row: {
          contact_discovery_enabled: boolean
          created_at: string
          match_hmac: string | null
          match_key_version: number
          phone_e164: string
          phone_region: string | null
          phone_verified_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_discovery_enabled?: boolean
          created_at?: string
          match_hmac?: string | null
          match_key_version?: number
          phone_e164: string
          phone_region?: string | null
          phone_verified_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_discovery_enabled?: boolean
          created_at?: string
          match_hmac?: string | null
          match_key_version?: number
          phone_e164?: string
          phone_region?: string | null
          phone_verified_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          app_preferences: Json
          communication_preferences: Json
          created_at: string
          ghost_mode_type: string
          glow_theme: string
          id: string
          mood_status: string | null
          notification_preferences: Json
          scheduled_visibility: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          app_preferences?: Json
          communication_preferences?: Json
          created_at?: string
          ghost_mode_type?: string
          glow_theme?: string
          id?: string
          mood_status?: string | null
          notification_preferences?: Json
          scheduled_visibility?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          app_preferences?: Json
          communication_preferences?: Json
          created_at?: string
          ghost_mode_type?: string
          glow_theme?: string
          id?: string
          mood_status?: string | null
          notification_preferences?: Json
          scheduled_visibility?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_restrictions: {
        Row: {
          case_id: string | null
          created_at: string
          ends_at: string | null
          id: string
          lifted_at: string | null
          reason_code: string | null
          restriction_type: string
          starts_at: string
          user_id: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          lifted_at?: string | null
          reason_code?: string | null
          restriction_type: string
          starts_at?: string
          user_id: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          lifted_at?: string | null
          reason_code?: string | null
          restriction_type?: string
          starts_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_restrictions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "trust_safety_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      user_statuses: {
        Row: {
          activity_type: string | null
          availability_type: string
          created_at: string
          custom_text: string | null
          expires_at: string
          id: string
          starts_at: string
          updated_at: string
          user_id: string
          visibility_type: string
        }
        Insert: {
          activity_type?: string | null
          availability_type: string
          created_at?: string
          custom_text?: string | null
          expires_at: string
          id?: string
          starts_at?: string
          updated_at?: string
          user_id: string
          visibility_type?: string
        }
        Update: {
          activity_type?: string | null
          availability_type?: string
          created_at?: string
          custom_text?: string | null
          expires_at?: string
          id?: string
          starts_at?: string
          updated_at?: string
          user_id?: string
          visibility_type?: string
        }
        Relationships: []
      }
      user_tour_progress: {
        Row: {
          completed_at: string | null
          current_step_key: string | null
          id: string
          started_at: string
          status: string
          tour_version_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          current_step_key?: string | null
          id?: string
          started_at?: string
          status: string
          tour_version_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          current_step_key?: string | null
          id?: string
          started_at?: string
          status?: string
          tour_version_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tour_progress_tour_version_id_fkey"
            columns: ["tour_version_id"]
            isOneToOne: false
            referencedRelation: "tour_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_wallpaper_preferences: {
        Row: {
          selected_slug: string
          updated_at: string
          user_id: string
        }
        Insert: {
          selected_slug?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          selected_slug?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      visibility_sessions: {
        Row: {
          created_at: string
          ends_at: string | null
          feature_type: string
          id: string
          source: string
          starts_at: string
          status: string
          updated_at: string
          user_id: string
          visibility_mode: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          feature_type?: string
          id?: string
          source?: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id: string
          visibility_mode: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          feature_type?: string
          id?: string
          source?: string
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
          visibility_mode?: string
        }
        Relationships: []
      }
      visibility_targets: {
        Row: {
          access_type: string
          created_at: string
          id: string
          session_id: string
          target_id: string
          target_type: string
        }
        Insert: {
          access_type?: string
          created_at?: string
          id?: string
          session_id: string
          target_id: string
          target_type: string
        }
        Update: {
          access_type?: string
          created_at?: string
          id?: string
          session_id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "visibility_targets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "visibility_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wallpapers: {
        Row: {
          created_at: string
          created_by: string | null
          dark_url: string | null
          id: string
          is_enabled: boolean
          light_url: string | null
          name: string
          render_mode: string
          slug: string
          sort_order: number
          source: string
          thumb_url: string | null
          tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dark_url?: string | null
          id?: string
          is_enabled?: boolean
          light_url?: string | null
          name: string
          render_mode: string
          slug: string
          sort_order?: number
          source?: string
          thumb_url?: string | null
          tier?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dark_url?: string | null
          id?: string
          is_enabled?: boolean
          light_url?: string | null
          name?: string
          render_mode?: string
          slug?: string
          sort_order?: number
          source?: string
          thumb_url?: string | null
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      wave_mutes: {
        Row: {
          created_at: string
          id: string
          muted_user_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          muted_user_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          muted_user_id?: string
          user_id?: string
        }
        Relationships: []
      }
      waves: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          recipient_id: string
          reply_to_wave_id: string | null
          responded_at: string | null
          response_type: string | null
          seen_at: string | null
          sender_id: string
          sent_at: string
          source: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          recipient_id: string
          reply_to_wave_id?: string | null
          responded_at?: string | null
          response_type?: string | null
          seen_at?: string | null
          sender_id: string
          sent_at?: string
          source?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          recipient_id?: string
          reply_to_wave_id?: string | null
          responded_at?: string | null
          response_type?: string | null
          seen_at?: string | null
          sender_id?: string
          sent_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "waves_reply_to_wave_id_fkey"
            columns: ["reply_to_wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_friend_request: {
        Args: { p_request_id: string }
        Returns: {
          reactivated: boolean
          receiver_id: string
          sender_id: string
        }[]
      }
      add_plan_participants: {
        Args: {
          p_actor_id: string
          p_effective_max_participants: number
          p_participant_ids: string[]
          p_plan_id: string
        }
        Returns: {
          added_count: number
          conversation_id: string
        }[]
      }
      admin_active_plan_mix: {
        Args: never
        Returns: {
          count: number
          plan: string
        }[]
      }
      admin_configure_cron_tick: {
        Args: { p_secret: string; p_url: string }
        Returns: undefined
      }
      admin_cron_tick_runs: {
        Args: { p_limit?: number }
        Returns: {
          return_message: string
          started_at: string
          status: string
        }[]
      }
      admin_cron_tick_status: {
        Args: never
        Returns: {
          configured: boolean
          job_scheduled: boolean
          last_response_status_code: number
          last_run_started_at: string
          last_run_status: string
        }[]
      }
      admin_daily_signup_counts: {
        Args: { p_since: string }
        Returns: {
          count: number
          day: string
        }[]
      }
      admin_safe_arrival_health: { Args: never; Returns: Json }
      admin_tour_analytics: {
        Args: { p_tour_version_id: string }
        Returns: {
          event_count: number
          event_type: string
          scope: string
          step_id: string
          subscription_plan: Database["public"]["Enums"]["subscription_plan"]
          user_count: number
        }[]
      }
      admin_tour_eligible_count: {
        Args: { p_tour_version_id: string }
        Returns: number
      }
      archive_event_room: {
        Args: { p_archives_at: string; p_room_id: string }
        Returns: string
      }
      birthday_users_for_day: {
        Args: { p_day: number; p_include_feb_29?: boolean; p_month: number }
        Returns: {
          user_id: string
        }[]
      }
      blog_image_is_published: { Args: { p_id: string }; Returns: boolean }
      buddy_score_total: {
        Args: { target_user_id: string }
        Returns: {
          score_total: number
        }[]
      }
      can_publish_open_moments: {
        Args: { subject_user_id: string }
        Returns: boolean
      }
      can_view_safe_arrival_session: {
        Args: { p_require_accepted?: boolean; p_session_id: string }
        Returns: boolean
      }
      chat_poll_parent_is_live: {
        Args: { p_message_id: string }
        Returns: boolean
      }
      claim_jobs: {
        Args: { p_limit: number; p_stale_seconds?: number; p_worker: string }
        Returns: {
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          job_type: string
          last_error_at: string | null
          last_error_code: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          priority: number
          run_at: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_meetup_notifications: { Args: { p_limit?: number }; Returns: Json }
      claim_notification_push: {
        Args: { p_dispatch_id?: string; p_limit?: number }
        Returns: {
          attempts: number
          context: Json
          dispatch_id: string
          expires_at: string
          id: string
          lease_id: string
          payload: Json
          target_id: string
          transport: string
          user_id: string
        }[]
      }
      claim_premium_trial_notifications: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          delivered_at: string | null
          delivery_status: string
          id: string
          last_attempt_at: string | null
          notification_type: string
          trial_id: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "premium_trial_notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_upfor_announcement: {
        Args: { p_require_started?: boolean; p_session_id: string }
        Returns: boolean
      }
      cleanup_conference: { Args: never; Returns: number }
      cleanup_expired_conversation_presence: { Args: never; Returns: number }
      cleanup_expired_private_location: { Args: never; Returns: number }
      cleanup_expired_proximity_events: { Args: never; Returns: number }
      close_event_rooms_for_event: {
        Args: { p_event_id: string }
        Returns: number
      }
      consume_rate_limit: {
        Args: {
          p_action: string
          p_ip_hash: string
          p_limit: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      conversation_previews: {
        Args: { p_conversation_ids: string[]; p_user_id: string }
        Returns: {
          conversation_id: string
          last_created_at: string
          last_message_type: string
          last_text: string
          last_user_message_at: string
          unread_count: number
        }[]
      }
      convert_premium_trial: {
        Args: {
          p_paid_plan: Database["public"]["Enums"]["subscription_plan"]
          p_user_id: string
        }
        Returns: string
      }
      create_event_room: {
        Args: {
          p_description: string
          p_event_id: string
          p_group_conversation_ids?: string[]
          p_join_mode: string
          p_listed: boolean
          p_max_members: number
          p_name: string
          p_owner_id: string
        }
        Returns: string
      }
      create_experiment_definition: {
        Args: { p_created_by: string; p_definition: Json }
        Returns: string
      }
      create_meetup_discovery_server: {
        Args: { p_actor_id: string; p_input: Json }
        Returns: Json
      }
      create_plan_lifecycle: {
        Args: {
          p_actor_id: string
          p_category: string
          p_custom_place_text: string
          p_description: string
          p_effective_max_active_plans: number
          p_effective_max_participants: number
          p_end_at: string
          p_initial_going_ids: string[]
          p_invitee_ids: string[]
          p_place_type: string
          p_plan_type: string
          p_reminder_minutes: number
          p_request_key: string
          p_rsvp_deadline: string
          p_source_hangout_id: string
          p_start_at: string
          p_timezone: string
          p_title: string
        }
        Returns: {
          conversation_id: string
          created: boolean
          plan_id: string
        }[]
      }
      create_upfor_session:
        | {
            Args: {
              p_activity_type: string
              p_allow_friend_invites: boolean
              p_allow_pings: boolean
              p_area_derived_at: string
              p_area_tier: string
              p_audience_type: string
              p_broad_area_text: string
              p_discovery_scope: string
              p_ends_at: string
              p_limit: number
              p_max_participants: number
              p_message: string
              p_starts_at: string
              p_timezone: string
            }
            Returns: {
              activity_type: string
              allow_friend_invites: boolean
              allow_pings: boolean
              area_derived_at: string | null
              area_tier: string | null
              audience_announce_claimed_at: string | null
              audience_type: string
              broad_area_text: string | null
              converted_plan_id: string | null
              created_at: string
              discovery_scope: string
              ends_at: string
              id: string
              max_participants: number
              message: string | null
              owner_id: string
              starts_at: string
              status: string
              timezone: string
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "hangout_sessions"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_activity_type: string
              p_allow_friend_invites: boolean
              p_allow_pings: boolean
              p_area_derived_at: string
              p_area_tier: string
              p_audience_type: string
              p_broad_area_text: string
              p_discovery_scope: string
              p_duration?: string
              p_ends_at: string
              p_limit: number
              p_max_participants: number
              p_message: string
              p_starts_at: string
              p_timezone: string
            }
            Returns: {
              activity_type: string
              allow_friend_invites: boolean
              allow_pings: boolean
              area_derived_at: string | null
              area_tier: string | null
              audience_announce_claimed_at: string | null
              audience_type: string
              broad_area_text: string | null
              converted_plan_id: string | null
              created_at: string
              discovery_scope: string
              ends_at: string
              id: string
              max_participants: number
              message: string | null
              owner_id: string
              starts_at: string
              status: string
              timezone: string
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "hangout_sessions"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      create_upfor_session_server: {
        Args: {
          p_activity_type: string
          p_allow_friend_invites: boolean
          p_allow_pings: boolean
          p_area_derived_at: string
          p_area_tier: string
          p_audience_type: string
          p_broad_area_text: string
          p_discovery_scope: string
          p_duration?: string
          p_ends_at: string
          p_max_participants: number
          p_message: string
          p_owner_id: string
          p_starts_at: string
          p_timezone: string
        }
        Returns: {
          activity_type: string
          allow_friend_invites: boolean
          allow_pings: boolean
          area_derived_at: string | null
          area_tier: string | null
          audience_announce_claimed_at: string | null
          audience_type: string
          broad_area_text: string | null
          converted_plan_id: string | null
          created_at: string
          discovery_scope: string
          ends_at: string
          id: string
          max_participants: number
          message: string | null
          owner_id: string
          starts_at: string
          status: string
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "hangout_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_experiment_plan: {
        Args: { p_now: string; p_user_id: string }
        Returns: Database["public"]["Enums"]["subscription_plan"]
      }
      delete_owned_event: {
        Args: { p_actor_id: string; p_event_id: string }
        Returns: boolean
      }
      delete_owned_plan: {
        Args: { p_actor_id: string; p_plan_id: string }
        Returns: boolean
      }
      end_premium_trial: {
        Args: {
          p_action: string
          p_actor_id?: string
          p_reason?: string
          p_trial_id: string
        }
        Returns: boolean
      }
      enqueue_notification_dispatch: {
        Args: {
          p_budget: number
          p_bypass_budget: boolean
          p_context: Json
          p_day_key: string
          p_dedupe_key: string
          p_message: string
          p_payload: Json
          p_persist: boolean
          p_push: boolean
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: Json
      }
      enqueue_safe_arrival_deadline: {
        Args: { p_phase: string; p_run_at: string; p_session_id: string }
        Returns: boolean
      }
      enqueue_safe_arrival_notifications: {
        Args: {
          p_actor?: string
          p_event: string
          p_occurrence?: string
          p_recipients: string[]
          p_session_id: string
        }
        Returns: number
      }
      expire_chat_messages: { Args: never; Returns: number }
      expire_meetup_discoveries_server: { Args: never; Returns: number }
      expire_meetups_server: { Args: never; Returns: number }
      feature_flag_enabled_for_subject: {
        Args: {
          p_flag_id: string
          p_now: string
          p_plan: Database["public"]["Enums"]["subscription_plan"]
          p_platform: string
          p_user_id: string
        }
        Returns: boolean
      }
      finish_meetup_notification: {
        Args: { p_id: string; p_lease_id: string; p_sent: boolean }
        Returns: boolean
      }
      finish_notification_push: {
        Args: {
          p_error?: string
          p_id: string
          p_lease_id: string
          p_outcome: string
        }
        Returns: boolean
      }
      get_admin_media_storage_summary: {
        Args: never
        Returns: {
          content_type: string
          context_type: string
          object_count: number
          original_bytes: number
          variant_bytes: number
        }[]
      }
      get_cancellation_reason_counts: {
        Args: { p_since: string }
        Returns: {
          count: number
          reason: string
        }[]
      }
      get_revenue_subscription_snapshot: {
        Args: { p_now?: string }
        Returns: {
          effective_plan: Database["public"]["Enums"]["subscription_plan"]
          grace_expired: boolean
          in_grace: boolean
          stored_plan: Database["public"]["Enums"]["subscription_plan"]
          user_count: number
        }[]
      }
      is_blocked_between: { Args: { target_user_id: string }; Returns: boolean }
      is_conversation_member: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      is_event_circle_owner: {
        Args: { p_event_circle_id: string }
        Returns: boolean
      }
      is_friend: { Args: { target_user_id: string }; Returns: boolean }
      is_plan_creator: { Args: { p_plan_id: string }; Returns: boolean }
      is_safe_arrival_traveller: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      join_event_room: {
        Args: { p_room_id: string; p_user_id: string }
        Returns: string
      }
      launch_welcome_access_for_existing_users: { Args: never; Returns: number }
      linkr_record_connect: {
        Args: { p_actor: string; p_event_id?: string; p_target: string }
        Returns: {
          connection_id: string
          created: boolean
          matched: boolean
        }[]
      }
      list_meetup_discoveries_server: {
        Args: { p_actor_id: string }
        Returns: Json
      }
      list_meetups_server: { Args: { p_actor_id: string }; Returns: Json }
      location_confidence_for_accuracy: {
        Args: { location_accuracy: number }
        Returns: Database["public"]["Enums"]["location_confidence"]
      }
      meetup_command_server: {
        Args: { p_action: string; p_actor_id: string; p_input: Json }
        Returns: Json
      }
      meetup_discovery_command_server: {
        Args: { p_action: string; p_actor_id: string; p_input: Json }
        Returns: Json
      }
      meetup_discovery_nearby_allowed: {
        Args: { p_creator: string; p_viewer: string }
        Returns: boolean
      }
      meetup_distance_m: {
        Args: { p_lat1: number; p_lat2: number; p_lon1: number; p_lon2: number }
        Returns: number
      }
      meetup_notification_allowed: {
        Args: { p_id: string; p_lease_id: string }
        Returns: boolean
      }
      meetup_owner_active_slot_count: {
        Args: { p_actor_id: string }
        Returns: number
      }
      meetup_pair_allowed: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      moment_engagement: {
        Args: { moment_ids: string[] }
        Returns: {
          moment_id: string
          reaction_count: number
          tuned_in_count: number
          view_count: number
        }[]
      }
      optional_feature_available: { Args: { p_key: string }; Returns: boolean }
      prepare_deleted_user_reports: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      process_due_safe_arrivals: { Args: { p_limit?: number }; Returns: number }
      process_experiment_schedules: { Args: never; Returns: number }
      process_premium_trial_lifecycle: { Args: never; Returns: number }
      process_safe_arrival_deadline: {
        Args: { p_session_id: string }
        Returns: string
      }
      queue_stale_unattached_chat_media: {
        Args: {
          p_incomplete_before: string
          p_limit?: number
          p_ready_before: string
        }
        Returns: number
      }
      reconcile_event_room_conversation: {
        Args: { p_room_id: string }
        Returns: string
      }
      reconcile_plan_conversation_members: {
        Args: { p_plan_id: string }
        Returns: string
      }
      record_experiment_exposure: {
        Args: {
          p_experiment_key: string
          p_platform: string
          p_user_id: string
        }
        Returns: {
          assignment_id: string
          experiment_id: string
          first_exposure: boolean
          is_control: boolean
          variant_key: string
          variant_name: string
        }[]
      }
      record_product_event: {
        Args: {
          p_actor_id: string
          p_event_name: string
          p_feature_key?: string
          p_occurred_at?: string
          p_resource_id: string
          p_resource_type: string
        }
        Returns: string
      }
      record_user_tour_progress: {
        Args: {
          p_current_step_key?: string
          p_status: string
          p_tour_version_id: string
          p_user_id: string
        }
        Returns: string
      }
      refresh_meetup_proximity_server: {
        Args: { p_actor_id: string }
        Returns: number
      }
      reserve_notification_budget: {
        Args: { p_budget: number; p_day_key: string; p_user_id: string }
        Returns: boolean
      }
      resolve_experiment_assignment: {
        Args: {
          p_experiment_key: string
          p_platform: string
          p_user_id: string
        }
        Returns: {
          assignment_id: string
          experiment_id: string
          is_control: boolean
          variant_key: string
          variant_name: string
        }[]
      }
      safe_arrival_relationship_current: {
        Args: { p_traveller: string; p_watcher: string }
        Returns: boolean
      }
      save_blog_post: {
        Args: {
          p_actor: string
          p_draft: Json
          p_id: string
          p_intent: string
          p_version: number
        }
        Returns: Json
      }
      save_profile_date_of_birth: {
        Args: { p_date: string }
        Returns: {
          can_correct: boolean
          outcome: string
        }[]
      }
      set_event_room_membership: {
        Args: { p_room_id: string; p_status: string; p_user_id: string }
        Returns: string
      }
      set_event_room_role: {
        Args: { p_role: string; p_room_id: string; p_user_id: string }
        Returns: string
      }
      set_plan_participant_rsvp: {
        Args: { p_actor_id: string; p_plan_id: string; p_status: string }
        Returns: {
          conversation_id: string
          rsvp_status: string
        }[]
      }
      start_premium_trial: {
        Args: {
          p_granted_by?: string
          p_override_plan?: Database["public"]["Enums"]["subscription_plan"]
          p_override_reason?: string
          p_owner_override?: boolean
          p_source?: string
          p_user_id: string
        }
        Returns: {
          campaign_source: string | null
          cancelled_at: string | null
          converted_at: string | null
          created_at: string
          granted_by: string | null
          id: string
          override_reason: string | null
          owner_override: boolean
          plan: Database["public"]["Enums"]["subscription_plan"]
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          source: string
          status: string
          trial_ends_at: string
          trial_started_at: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "premium_trials"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_safe_arrival: {
        Args: {
          p_contact_ids: string[]
          p_destination_label: string
          p_expected_arrival_at: string
          p_grace_period_minutes: number
          p_max_active: number
          p_note: string
          p_traveller_id: string
        }
        Returns: {
          canonical_status: string
          replayed: boolean
          session_id: string
        }[]
      }
      transfer_group_ownership: {
        Args: { p_conversation_id: string; p_new_owner_id: string }
        Returns: undefined
      }
      transition_safe_arrival:
        | {
            Args: {
              p_action: string
              p_actor_id: string
              p_extra_minutes?: number
              p_session_id: string
            }
            Returns: {
              canonical_status: string
              changed: boolean
              expected_arrival_at: string
              session_id: string
            }[]
          }
        | {
            Args: {
              p_action: string
              p_actor_id: string
              p_client_mutation_id?: string
              p_extra_minutes?: number
              p_session_id: string
            }
            Returns: {
              canonical_status: string
              changed: boolean
              expected_arrival_at: string
              session_id: string
            }[]
          }
      tune_in_counts: {
        Args: { creator_ids: string[] }
        Returns: {
          creator_id: string
          tuned_in_count: number
        }[]
      }
    }
    Enums: {
      access_source:
        | "welcome_access"
        | "web_subscription"
        | "apple_subscription"
        | "google_subscription"
        | "admin_grant"
        | "staff"
        | "global_promo"
      friend_request_status:
        | "pending"
        | "accepted"
        | "declined"
        | "cancelled"
        | "blocked"
        | "expired"
      location_confidence: "high" | "medium" | "low"
      meetup_status: "pending" | "accepted" | "declined" | "expired"
      proximity_level: "close" | "near" | "far" | "hidden"
      report_status: "open" | "reviewing" | "resolved" | "dismissed"
      subscription_plan:
        | "free"
        | "buddy_plus"
        | "buddy_pro"
        | "mad_buddy_access"
      subscription_status:
        | "free"
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "expired"
        | "non_renewing"
        | "attention"
      visibility_status: "visible" | "ghost" | "app_open_only"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_source: [
        "welcome_access",
        "web_subscription",
        "apple_subscription",
        "google_subscription",
        "admin_grant",
        "staff",
        "global_promo",
      ],
      friend_request_status: [
        "pending",
        "accepted",
        "declined",
        "cancelled",
        "blocked",
        "expired",
      ],
      location_confidence: ["high", "medium", "low"],
      meetup_status: ["pending", "accepted", "declined", "expired"],
      proximity_level: ["close", "near", "far", "hidden"],
      report_status: ["open", "reviewing", "resolved", "dismissed"],
      subscription_plan: [
        "free",
        "buddy_plus",
        "buddy_pro",
        "mad_buddy_access",
      ],
      subscription_status: [
        "free",
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "expired",
        "non_renewing",
        "attention",
      ],
      visibility_status: ["visible", "ghost", "app_open_only"],
    },
  },
} as const

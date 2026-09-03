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
      account_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email_updates: boolean
          full_name: string
          id: string
          updated_at: string
          username: string
          whatsapp_e164: string | null
          whatsapp_updates: boolean
          whatsapp_verified_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email_updates?: boolean
          full_name: string
          id: string
          updated_at?: string
          username: string
          whatsapp_e164?: string | null
          whatsapp_updates?: boolean
          whatsapp_verified_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email_updates?: boolean
          full_name?: string
          id?: string
          updated_at?: string
          username?: string
          whatsapp_e164?: string | null
          whatsapp_updates?: boolean
          whatsapp_verified_at?: string | null
        }
        Relationships: []
      }
      contact_submissions: {
        Row: {
          created_at: string
          email: string
          id: number
          message: string
          name: string
          request_fingerprint: string
          source: string
          status: string
          subject: string | null
          topic: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: never
          message: string
          name: string
          request_fingerprint: string
          source?: string
          status?: string
          subject?: string | null
          topic: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: never
          message?: string
          name?: string
          request_fingerprint?: string
          source?: string
          status?: string
          subject?: string | null
          topic?: string
        }
        Relationships: []
      }
      dm_conversation_states: {
        Row: {
          conversation_id: string
          created_at: string
          hidden_at: string | null
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          hidden_at?: string | null
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          hidden_at?: string | null
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_conversation_states_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "dm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_conversation_states_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          last_message_at: string
          member_one_id: string
          member_two_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          last_message_at?: string
          member_one_id: string
          member_two_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          last_message_at?: string
          member_one_id?: string
          member_two_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_conversations_member_one_id_fkey"
            columns: ["member_one_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_conversations_member_two_id_fkey"
            columns: ["member_two_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_messages: {
        Row: {
          body: string
          conversation_id: string
          deleted_at: string | null
          edited_at: string | null
          id: number
          sender_id: string
          sent_at: string
        }
        Insert: {
          body: string
          conversation_id: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: never
          sender_id: string
          sent_at?: string
        }
        Update: {
          body?: string
          conversation_id?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: never
          sender_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dm_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "dm_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dm_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_account_deletion_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          requested_at: string
          restore_discoverable: boolean
          scheduled_for: string | null
          status: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          requested_at?: string
          restore_discoverable?: boolean
          scheduled_for?: string | null
          status?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          requested_at?: string
          restore_discoverable?: boolean
          scheduled_for?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_account_deletion_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_circle_join_requests: {
        Row: {
          circle_id: string
          created_at: string
          decided_at: string | null
          requester_id: string
          status: string
        }
        Insert: {
          circle_id: string
          created_at?: string
          decided_at?: string | null
          requester_id: string
          status?: string
        }
        Update: {
          circle_id?: string
          created_at?: string
          decided_at?: string | null
          requester_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_circle_join_requests_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "social_circles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_circle_join_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_circle_members: {
        Row: {
          circle_id: string
          joined_at: string
          member_id: string
          member_role: string
        }
        Insert: {
          circle_id: string
          joined_at?: string
          member_id: string
          member_role?: string
        }
        Update: {
          circle_id?: string
          joined_at?: string
          member_id?: string
          member_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_circle_members_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "social_circles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_circle_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_circles: {
        Row: {
          created_at: string
          description: string
          id: string
          join_policy: string
          name: string
          owner_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          join_policy?: string
          name: string
          owner_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          join_policy?: string
          name?: string
          owner_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_circles_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_data_export_requests: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          expires_at: string | null
          request_id: string
          requested_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          completed_at?: string | null
          expires_at?: string | null
          request_id: string
          requested_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          completed_at?: string | null
          expires_at?: string | null
          request_id?: string
          requested_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_data_export_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_follows: {
        Row: {
          created_at: string
          followed_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followed_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followed_id?: string
          follower_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_follows_followed_id_fkey"
            columns: ["followed_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_identity_change_events: {
        Row: {
          change_type: string
          changed_at: string
          id: number
          new_value: string
          old_value: string
          request_id: string | null
          source: string
          user_id: string
        }
        Insert: {
          change_type: string
          changed_at?: string
          id?: number
          new_value: string
          old_value: string
          request_id?: string | null
          source: string
          user_id: string
        }
        Update: {
          change_type?: string
          changed_at?: string
          id?: number
          new_value?: string
          old_value?: string
          request_id?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_identity_change_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_identity_change_requests: {
        Row: {
          current_name: string
          id: string
          requested_at: string
          requested_name: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          current_name: string
          id: string
          requested_at?: string
          requested_name: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          current_name?: string
          id?: string
          requested_at?: string
          requested_name?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_identity_change_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_member_preferences: {
        Row: {
          activity_status: boolean
          email_digest: string
          notify_followers: boolean
          notify_messages: boolean
          notify_post_activity: boolean
          notify_sautify: boolean
          read_receipts: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_status?: boolean
          email_digest?: string
          notify_followers?: boolean
          notify_messages?: boolean
          notify_post_activity?: boolean
          notify_sautify?: boolean
          read_receipts?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_status?: boolean
          email_digest?: string
          notify_followers?: boolean
          notify_messages?: boolean
          notify_post_activity?: boolean
          notify_sautify?: boolean
          read_receipts?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_member_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_moderation_actions: {
        Row: {
          action_type: string
          appeal_id: number | null
          created_at: string
          id: number
          policy_version: string
          reason: string
          report_id: number
          request_id: string
          target_id: string
          target_owner_id: string | null
          target_type: string
        }
        Insert: {
          action_type: string
          appeal_id?: number | null
          created_at?: string
          id?: number
          policy_version?: string
          reason: string
          report_id: number
          request_id: string
          target_id: string
          target_owner_id?: string | null
          target_type: string
        }
        Update: {
          action_type?: string
          appeal_id?: number | null
          created_at?: string
          id?: number
          policy_version?: string
          reason?: string
          report_id?: number
          request_id?: string
          target_id?: string
          target_owner_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_moderation_actions_appeal_id_fkey"
            columns: ["appeal_id"]
            isOneToOne: false
            referencedRelation: "social_moderation_appeals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_moderation_actions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "social_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_moderation_actions_target_owner_id_fkey"
            columns: ["target_owner_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_moderation_appeals: {
        Row: {
          action_id: number
          appeal_status: string
          appellant_id: string
          assigned_to: string | null
          created_at: string
          decided_at: string | null
          decision_reason: string | null
          id: number
          reason: string
          updated_at: string
        }
        Insert: {
          action_id: number
          appeal_status?: string
          appellant_id: string
          assigned_to?: string | null
          created_at?: string
          decided_at?: string | null
          decision_reason?: string | null
          id?: number
          reason: string
          updated_at?: string
        }
        Update: {
          action_id?: number
          appeal_status?: string
          appellant_id?: string
          assigned_to?: string | null
          created_at?: string
          decided_at?: string | null
          decision_reason?: string | null
          id?: number
          reason?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_moderation_appeals_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: true
            referencedRelation: "social_moderation_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_moderation_appeals_appellant_id_fkey"
            columns: ["appellant_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_moderation_appeals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_moderation_audit: {
        Row: {
          action_id: number | null
          actor_id: string | null
          actor_role: string | null
          appeal_id: number | null
          created_at: string
          event_payload: Json
          event_type: string
          id: number
          report_id: number | null
        }
        Insert: {
          action_id?: number | null
          actor_id?: string | null
          actor_role?: string | null
          appeal_id?: number | null
          created_at?: string
          event_payload?: Json
          event_type: string
          id?: number
          report_id?: number | null
        }
        Update: {
          action_id?: number | null
          actor_id?: string | null
          actor_role?: string | null
          appeal_id?: number | null
          created_at?: string
          event_payload?: Json
          event_type?: string
          id?: number
          report_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "social_moderation_audit_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "social_moderation_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_moderation_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_moderation_audit_appeal_id_fkey"
            columns: ["appeal_id"]
            isOneToOne: false
            referencedRelation: "social_moderation_appeals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_moderation_audit_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "social_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      social_mutes: {
        Row: {
          created_at: string
          muted_id: string
          muter_id: string
        }
        Insert: {
          created_at?: string
          muted_id: string
          muter_id: string
        }
        Update: {
          created_at?: string
          muted_id?: string
          muter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_mutes_muted_id_fkey"
            columns: ["muted_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_mutes_muter_id_fkey"
            columns: ["muter_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_notifications: {
        Row: {
          actor_id: string | null
          circle_event: string | null
          circle_id: string | null
          created_at: string
          id: number
          notification_type: string
          post_id: string | null
          read_at: string | null
          recipient_id: string
        }
        Insert: {
          actor_id?: string | null
          circle_event?: string | null
          circle_id?: string | null
          created_at?: string
          id?: never
          notification_type: string
          post_id?: string | null
          read_at?: string | null
          recipient_id: string
        }
        Update: {
          actor_id?: string | null
          circle_event?: string | null
          circle_id?: string | null
          created_at?: string
          id?: never
          notification_type?: string
          post_id?: string | null
          read_at?: string | null
          recipient_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_notifications_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "social_circles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_notifications_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          moderated_at: string | null
          moderation_state: string
          post_id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderation_state?: string
          post_id: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderation_state?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_media: {
        Row: {
          alt_text: string
          attached_at: string | null
          content_type: string
          created_at: string
          duration_ms: number | null
          expires_at: string
          finalized_at: string | null
          height: number | null
          id: string
          media_kind: string
          object_key: string
          owner_id: string
          position: number | null
          post_id: string | null
          size_bytes: number
          upload_status: string
          width: number | null
        }
        Insert: {
          alt_text?: string
          attached_at?: string | null
          content_type: string
          created_at?: string
          duration_ms?: number | null
          expires_at?: string
          finalized_at?: string | null
          height?: number | null
          id: string
          media_kind: string
          object_key: string
          owner_id: string
          position?: number | null
          post_id?: string | null
          size_bytes: number
          upload_status?: string
          width?: number | null
        }
        Update: {
          alt_text?: string
          attached_at?: string | null
          content_type?: string
          created_at?: string
          duration_ms?: number | null
          expires_at?: string
          finalized_at?: string | null
          height?: number | null
          id?: string
          media_kind?: string
          object_key?: string
          owner_id?: string
          position?: number | null
          post_id?: string | null
          size_bytes?: number
          upload_status?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "social_post_media_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post_reactions: {
        Row: {
          created_at: string
          post_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          reaction_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          audience_owner_id: string
          author_id: string
          body: string
          circle_id: string | null
          client_request_id: string | null
          comment_count: number
          created_at: string
          deleted_at: string | null
          id: string
          like_count: number
          media_count: number
          moderated_at: string | null
          moderation_state: string
          parent_post_id: string | null
          post_status: string
          quote_post_id: string | null
          reply_access: string
          reply_to_post_id: string | null
          repost_count: number
          root_post_id: string | null
          thread_depth: number
          updated_at: string
          visibility: string
        }
        Insert: {
          audience_owner_id: string
          author_id: string
          body: string
          circle_id?: string | null
          client_request_id?: string | null
          comment_count?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          like_count?: number
          media_count?: number
          moderated_at?: string | null
          moderation_state?: string
          parent_post_id?: string | null
          post_status?: string
          quote_post_id?: string | null
          reply_access?: string
          reply_to_post_id?: string | null
          repost_count?: number
          root_post_id?: string | null
          thread_depth?: number
          updated_at?: string
          visibility?: string
        }
        Update: {
          audience_owner_id?: string
          author_id?: string
          body?: string
          circle_id?: string | null
          client_request_id?: string | null
          comment_count?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          like_count?: number
          media_count?: number
          moderated_at?: string | null
          moderation_state?: string
          parent_post_id?: string | null
          post_status?: string
          quote_post_id?: string | null
          reply_access?: string
          reply_to_post_id?: string | null
          repost_count?: number
          root_post_id?: string | null
          thread_depth?: number
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_audience_owner_id_fkey"
            columns: ["audience_owner_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_circle_id_fkey"
            columns: ["circle_id"]
            isOneToOne: false
            referencedRelation: "social_circles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_parent_post_id_fkey"
            columns: ["parent_post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_quote_post_id_fkey"
            columns: ["quote_post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_reply_to_post_id_fkey"
            columns: ["reply_to_post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_root_post_id_fkey"
            columns: ["root_post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_profiles: {
        Row: {
          allow_external_indexing: boolean
          avatar_key: string | null
          bio: string
          created_at: string
          display_name: string
          dm_access: string
          followers_count: number
          following_count: number
          header_key: string | null
          id: string
          is_discoverable: boolean
          is_verified: boolean
          verification_badge_type: string
          location: string | null
          updated_at: string
          username: string
          website_url: string | null
        }
        Insert: {
          allow_external_indexing?: boolean
          avatar_key?: string | null
          bio?: string
          created_at?: string
          display_name: string
          dm_access?: string
          followers_count?: number
          following_count?: number
          header_key?: string | null
          id: string
          is_discoverable?: boolean
          is_verified?: boolean
          verification_badge_type?: string
          location?: string | null
          updated_at?: string
          username: string
          website_url?: string | null
        }
        Update: {
          allow_external_indexing?: boolean
          avatar_key?: string | null
          bio?: string
          created_at?: string
          display_name?: string
          dm_access?: string
          followers_count?: number
          following_count?: number
          header_key?: string | null
          id?: string
          is_discoverable?: boolean
          is_verified?: boolean
          verification_badge_type?: string
          location?: string | null
          updated_at?: string
          username?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "account_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_reports: {
        Row: {
          assigned_to: string | null
          context_snapshot: Json | null
          created_at: string
          details: string | null
          id: number
          moderation_note: string | null
          policy_version: string
          priority: string
          reason: string
          report_status: string
          reporter_id: string
          resolved_at: string | null
          reviewed_at: string | null
          status_updated_at: string
          target_id: string
          target_owner_id: string | null
          target_type: string
        }
        Insert: {
          assigned_to?: string | null
          context_snapshot?: Json | null
          created_at?: string
          details?: string | null
          id?: never
          moderation_note?: string | null
          policy_version?: string
          priority?: string
          reason: string
          report_status?: string
          reporter_id: string
          resolved_at?: string | null
          reviewed_at?: string | null
          status_updated_at?: string
          target_id: string
          target_owner_id?: string | null
          target_type: string
        }
        Update: {
          assigned_to?: string | null
          context_snapshot?: Json | null
          created_at?: string
          details?: string | null
          id?: never
          moderation_note?: string | null
          policy_version?: string
          priority?: string
          reason?: string
          report_status?: string
          reporter_id?: string
          resolved_at?: string | null
          reviewed_at?: string | null
          status_updated_at?: string
          target_id?: string
          target_owner_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_reports_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reports_target_owner_id_fkey"
            columns: ["target_owner_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_reposts: {
        Row: {
          created_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_reposts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_reposts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      social_saved_posts: {
        Row: {
          post_id: string
          saved_at: string
          user_id: string
        }
        Insert: {
          post_id: string
          saved_at?: string
          user_id: string
        }
        Update: {
          post_id?: string
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_saved_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "social_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_saved_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_social_settings: {
        Row: {
          account_visibility: string
          created_at: string
          email_notifications: boolean
          external_search_indexing: boolean
          message_permission: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_visibility?: string
          created_at?: string
          email_notifications?: boolean
          external_search_indexing?: boolean
          message_permission?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_visibility?: string
          created_at?: string
          email_notifications?: boolean
          external_search_indexing?: boolean
          message_permission?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_social_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "social_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_members: {
        Row: {
          id: string
          joined_at: string
          launch_notified_at: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          id: string
          joined_at?: string
          launch_notified_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          id?: string
          joined_at?: string
          launch_notified_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      moderation_staff_self: {
        Row: {
          active: boolean | null
          staff_role: string | null
          user_id: string | null
        }
        Relationships: []
      }
      social_stream_events: {
        Row: {
          actor_id: string | null
          event_at: string | null
          event_key: string | null
          event_type: string | null
          post_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      change_social_identity: {
        Args: { p_change_type: string; p_request_id: string; p_value: string }
        Returns: Json
      }
      complete_social_onboarding: {
        Args: { p_display_name: string; p_username: string }
        Returns: {
          allow_external_indexing: boolean
          avatar_key: string | null
          bio: string
          created_at: string
          display_name: string
          dm_access: string
          followers_count: number
          following_count: number
          header_key: string | null
          id: string
          is_discoverable: boolean
          is_verified: boolean
          verification_badge_type: string
          location: string | null
          updated_at: string
          username: string
          website_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "social_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      dm_inbox_phase23: {
        Args: never
        Returns: {
          conversation_id: string
          last_message_at: string
          latest_body: string
          latest_message_id: number
          latest_sender_id: string
          latest_sent_at: string
          peer_id: string
          unread_count: number
        }[]
      }
      dm_peer_read_state_phase30: {
        Args: { p_conversation_id: string }
        Returns: {
          peer_last_read_at: string
        }[]
      }
      identity_change_requests_for_staff: {
        Args: never
        Returns: {
          current_name: string
          id: string
          requested_at: string
          requested_name: string
          review_note: string
          reviewed_at: string
          reviewed_by: string
          status: string
          updated_at: string
          user_id: string
          username: string
        }[]
      }
      open_dm_conversation_phase23: {
        Args: { p_peer_id: string }
        Returns: string
      }
      review_social_identity_request: {
        Args: { p_decision: string; p_note?: string; p_request_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

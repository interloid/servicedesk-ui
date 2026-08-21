export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      attachments: {
        Row: {
          checksum: string | null;
          created_at: string;
          extension: string | null;
          filename: string;
          id: string;
          message_id: string | null;
          mime: string;
          original_filename: string;
          size: number;
          storage_path: string;
          tenant_id: string;
          ticket_id: string;
          updated_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          checksum?: string | null;
          created_at?: string;
          extension?: string | null;
          filename: string;
          id?: string;
          message_id?: string | null;
          mime: string;
          original_filename: string;
          size: number;
          storage_path: string;
          tenant_id: string;
          ticket_id: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          checksum?: string | null;
          created_at?: string;
          extension?: string | null;
          filename?: string;
          id?: string;
          message_id?: string | null;
          mime?: string;
          original_filename?: string;
          size?: number;
          storage_path?: string;
          tenant_id?: string;
          ticket_id?: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "ticket_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"];
          actor_id: string | null;
          created_at: string;
          entity: string;
          entity_id: string | null;
          id: string;
          ip: unknown;
          meta_json: Json | null;
          tenant_id: string;
        };
        Insert: {
          action: Database["public"]["Enums"]["audit_action"];
          actor_id?: string | null;
          created_at?: string;
          entity: string;
          entity_id?: string | null;
          id?: string;
          ip?: unknown;
          meta_json?: Json | null;
          tenant_id: string;
        };
        Update: {
          action?: Database["public"]["Enums"]["audit_action"];
          actor_id?: string | null;
          created_at?: string;
          entity?: string;
          entity_id?: string | null;
          id?: string;
          ip?: unknown;
          meta_json?: Json | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      business_hours: {
        Row: {
          created_at: string | null;
          holidays_json: Json;
          id: string;
          name: string;
          schedule_json: Json;
          tenant_id: string;
          timezone_id: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          holidays_json?: Json;
          id?: string;
          name: string;
          schedule_json: Json;
          tenant_id: string;
          timezone_id: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          holidays_json?: Json;
          id?: string;
          name?: string;
          schedule_json?: Json;
          tenant_id?: string;
          timezone_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "business_hours_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_hours_timezone_id_fkey";
            columns: ["timezone_id"];
            isOneToOne: false;
            referencedRelation: "timezones";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          company: string | null;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          phone: string | null;
          portal_user_id: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          company?: string | null;
          created_at?: string;
          email: string;
          full_name: string;
          id?: string;
          phone?: string | null;
          portal_user_id?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          company?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          phone?: string | null;
          portal_user_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          amount: number;
          created_at: string | null;
          id: string;
          paypal_txn_id: string | null;
          period_end: string;
          period_start: string;
          status: Database["public"]["Enums"]["invoice_status"];
          storage_path: string | null;
          tenant_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string | null;
          id?: string;
          paypal_txn_id?: string | null;
          period_end: string;
          period_start: string;
          status: Database["public"]["Enums"]["invoice_status"];
          storage_path?: string | null;
          tenant_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string | null;
          id?: string;
          paypal_txn_id?: string | null;
          period_end?: string;
          period_start?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          storage_path?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          disabled_at: string | null;
          id: string;
          invited_by: string | null;
          joined_at: string | null;
          role: Database["public"]["Enums"]["membership_role"];
          status: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          disabled_at?: string | null;
          id?: string;
          invited_by?: string | null;
          joined_at?: string | null;
          role: Database["public"]["Enums"]["membership_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          disabled_at?: string | null;
          id?: string;
          invited_by?: string | null;
          joined_at?: string | null;
          role?: Database["public"]["Enums"]["membership_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_prefs: {
        Row: {
          channel_json: Json;
          created_at: string | null;
          id: string;
          tenant_id: string;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          channel_json?: Json;
          created_at?: string | null;
          id?: string;
          tenant_id: string;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          channel_json?: Json;
          created_at?: string | null;
          id?: string;
          tenant_id?: string;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_prefs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_prefs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          id: string;
          payload_json: Json;
          read_at: string | null;
          tenant_id: string;
          type: Database["public"]["Enums"]["notification_type"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          payload_json?: Json;
          read_at?: string | null;
          tenant_id: string;
          type: Database["public"]["Enums"]["notification_type"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          payload_json?: Json;
          read_at?: string | null;
          tenant_id?: string;
          type?: Database["public"]["Enums"]["notification_type"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          features_json: Json;
          id: string;
          is_active: boolean;
          name: string;
          price_month: number;
          seat_limit: number;
          sort_order: number;
          storage_limit_mb: number | null;
          ticket_limit: number | null;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string | null;
          features_json?: Json;
          id?: string;
          is_active?: boolean;
          name: string;
          price_month?: number;
          seat_limit: number;
          sort_order?: number;
          storage_limit_mb?: number | null;
          ticket_limit?: number | null;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          features_json?: Json;
          id?: string;
          is_active?: boolean;
          name?: string;
          price_month?: number;
          seat_limit?: number;
          sort_order?: number;
          storage_limit_mb?: number | null;
          ticket_limit?: number | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      saved_views: {
        Row: {
          created_at: string | null;
          filter_json: Json;
          id: string;
          is_shared: boolean;
          name: string;
          owner_user_id: string;
          tenant_id: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          filter_json?: Json;
          id?: string;
          is_shared?: boolean;
          name: string;
          owner_user_id: string;
          tenant_id: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          filter_json?: Json;
          id?: string;
          is_shared?: boolean;
          name?: string;
          owner_user_id?: string;
          tenant_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "saved_views_owner_user_id_fkey";
            columns: ["owner_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_views_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      sla_events: {
        Row: {
          breached_at: string | null;
          completed_at: string | null;
          created_at: string;
          due_at: string;
          id: string;
          status: Database["public"]["Enums"]["sla_event_status"];
          tenant_id: string;
          ticket_id: string;
          type: Database["public"]["Enums"]["sla_event_type"];
          updated_at: string;
        };
        Insert: {
          breached_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          due_at: string;
          id?: string;
          status?: Database["public"]["Enums"]["sla_event_status"];
          tenant_id: string;
          ticket_id: string;
          type: Database["public"]["Enums"]["sla_event_type"];
          updated_at?: string;
        };
        Update: {
          breached_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["sla_event_status"];
          tenant_id?: string;
          ticket_id?: string;
          type?: Database["public"]["Enums"]["sla_event_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sla_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sla_events_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      sla_policies: {
        Row: {
          applies_to: string;
          business_hours_id: string | null;
          created_at: string;
          escalate_on_breach: boolean;
          id: string;
          is_default: boolean;
          name: string;
          notify_before_breach: boolean;
          status: Database["public"]["Enums"]["sla_policy_status"];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          applies_to?: string;
          business_hours_id?: string | null;
          created_at?: string;
          escalate_on_breach?: boolean;
          id?: string;
          is_default?: boolean;
          name: string;
          notify_before_breach?: boolean;
          status?: Database["public"]["Enums"]["sla_policy_status"];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          applies_to?: string;
          business_hours_id?: string | null;
          created_at?: string;
          escalate_on_breach?: boolean;
          id?: string;
          is_default?: boolean;
          name?: string;
          notify_before_breach?: boolean;
          status?: Database["public"]["Enums"]["sla_policy_status"];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sla_policies_business_hours_id_fkey";
            columns: ["business_hours_id"];
            isOneToOne: false;
            referencedRelation: "business_hours";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sla_policies_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      sla_policy_targets: {
        Row: {
          created_at: string;
          first_response_business: boolean;
          first_response_mins: number;
          id: string;
          policy_id: string;
          priority_scope: Database["public"]["Enums"]["ticket_priority"];
          resolution_business: boolean;
          resolution_mins: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          first_response_business?: boolean;
          first_response_mins: number;
          id?: string;
          policy_id: string;
          priority_scope: Database["public"]["Enums"]["ticket_priority"];
          resolution_business?: boolean;
          resolution_mins: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          first_response_business?: boolean;
          first_response_mins?: number;
          id?: string;
          policy_id?: string;
          priority_scope?: Database["public"]["Enums"]["ticket_priority"];
          resolution_business?: boolean;
          resolution_mins?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sla_policy_targets_policy_id_fkey";
            columns: ["policy_id"];
            isOneToOne: false;
            referencedRelation: "sla_policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sla_policy_targets_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          created_at: string | null;
          current_period_end: string;
          id: string;
          paypal_subscription_id: string;
          plan_id: string;
          seats: number;
          status: Database["public"]["Enums"]["subscription_status"];
          tenant_id: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          current_period_end: string;
          id?: string;
          paypal_subscription_id: string;
          plan_id: string;
          seats?: number;
          status: Database["public"]["Enums"]["subscription_status"];
          tenant_id: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          current_period_end?: string;
          id?: string;
          paypal_subscription_id?: string;
          plan_id?: string;
          seats?: number;
          status?: Database["public"]["Enums"]["subscription_status"];
          tenant_id?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "subscriptions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          name: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tags_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          branding_json: Json;
          created_at: string;
          id: string;
          name: string;
          plan_id: string;
          slug: string;
          status: Database["public"]["Enums"]["tenant_status"];
          updated_at: string;
        };
        Insert: {
          branding_json?: Json;
          created_at?: string;
          id?: string;
          name: string;
          plan_id: string;
          slug: string;
          status?: Database["public"]["Enums"]["tenant_status"];
          updated_at?: string;
        };
        Update: {
          branding_json?: Json;
          created_at?: string;
          id?: string;
          name?: string;
          plan_id?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["tenant_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenants_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_messages: {
        Row: {
          author_id: string;
          author_type: Database["public"]["Enums"]["author_type"];
          body: string;
          created_at: string;
          edited_at: string | null;
          id: string;
          is_edited: boolean;
          tenant_id: string;
          ticket_id: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["message_visibility"];
        };
        Insert: {
          author_id: string;
          author_type: Database["public"]["Enums"]["author_type"];
          body: string;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          is_edited?: boolean;
          tenant_id: string;
          ticket_id: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["message_visibility"];
        };
        Update: {
          author_id?: string;
          author_type?: Database["public"]["Enums"]["author_type"];
          body?: string;
          created_at?: string;
          edited_at?: string | null;
          id?: string;
          is_edited?: boolean;
          tenant_id?: string;
          ticket_id?: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["message_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "ticket_messages_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      ticket_tags: {
        Row: {
          created_at: string;
          id: string;
          tag_id: string;
          tenant_id: string;
          ticket_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          tag_id: string;
          tenant_id: string;
          ticket_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          tag_id?: string;
          tenant_id?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_tags_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ticket_tags_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          assignee_user_id: string | null;
          closed_at: string | null;
          created_at: string;
          description: string;
          first_response_at: string | null;
          id: string;
          number: number;
          priority: Database["public"]["Enums"]["ticket_priority"];
          requester_customer_id: string;
          resolved_at: string | null;
          sla_policy_id: string | null;
          status: Database["public"]["Enums"]["ticket_status"];
          subject: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          assignee_user_id?: string | null;
          closed_at?: string | null;
          created_at?: string;
          description: string;
          first_response_at?: string | null;
          id?: string;
          number: number;
          priority?: Database["public"]["Enums"]["ticket_priority"];
          requester_customer_id: string;
          resolved_at?: string | null;
          sla_policy_id?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          subject: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          assignee_user_id?: string | null;
          closed_at?: string | null;
          created_at?: string;
          description?: string;
          first_response_at?: string | null;
          id?: string;
          number?: number;
          priority?: Database["public"]["Enums"]["ticket_priority"];
          requester_customer_id?: string;
          resolved_at?: string | null;
          sla_policy_id?: string | null;
          status?: Database["public"]["Enums"]["ticket_status"];
          subject?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_assignee_user_id_fkey";
            columns: ["assignee_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_requester_customer_id_fkey";
            columns: ["requester_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_sla_policy_id_fkey";
            columns: ["sla_policy_id"];
            isOneToOne: false;
            referencedRelation: "sla_policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      timezones: {
        Row: {
          code: string;
          country: string | null;
          created_at: string;
          display_name: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          country?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          country?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_customer_id: { Args: never; Returns: string };
      current_role: { Args: never; Returns: string };
      current_tenant_id: { Args: never; Returns: string };
      current_tenant_role: { Args: never; Returns: string };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      generate_ticket_number: {
        Args: { p_tenant_id: string };
        Returns: number;
      };
      get_tenant_by_slug: { Args: { p_slug: string }; Returns: Json };
      is_active_membership: { Args: never; Returns: boolean };
      process_sla_breaches: { Args: never; Returns: number };
      provision_tenant: {
        Args: {
          p_day_end: string;
          p_day_start: string;
          p_email: string;
          p_full_name: string;
          p_organization_name: string;
          p_plan_id: string;
          p_portal_slug: string;
          p_sla: Json;
          p_timezone_id: string;
          p_user_id: string;
          p_working_days: Json;
        };
        Returns: {
          business_hours_id: string;
          plan_id: string;
          tenant_id: string;
          tenant_name: string;
          tenant_slug: string;
        }[];
      };
      reports_overview: {
        Args: { p_days?: number; p_weeks?: number };
        Returns: Json;
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
    };
    Enums: {
      audit_action:
        | "create"
        | "update"
        | "delete"
        | "login"
        | "logout"
        | "invite"
        | "assign";
      author_type: "agent" | "customer" | "system";
      customer_status: "active" | "blocked";
      invoice_status: "pending" | "paid" | "failed" | "refunded";
      membership_role:
        | "platform_admin"
        | "tenant_admin"
        | "manager"
        | "agent"
        | "billing_admin"
        | "customer";
      membership_status: "invited" | "active" | "disabled";
      message_visibility: "public" | "internal";
      notification_type:
        | "ticket_assigned"
        | "ticket_created"
        | "ticket_updated"
        | "ticket_closed"
        | "mention"
        | "billing"
        | "system";
      sla_event_status: "pending" | "completed" | "breached";
      sla_event_type: "first_response" | "resolution";
      sla_policy_status: "active" | "paused" | "draft";
      subscription_status:
        "trialing" | "active" | "past_due" | "cancelled" | "expired";
      tenant_status: "active" | "suspended" | "cancelled";
      ticket_priority: "low" | "normal" | "high" | "urgent";
      ticket_status:
        "new" | "open" | "pending" | "on_hold" | "resolved" | "closed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      audit_action: [
        "create",
        "update",
        "delete",
        "login",
        "logout",
        "invite",
        "assign",
      ],
      author_type: ["agent", "customer", "system"],
      customer_status: ["active", "blocked"],
      invoice_status: ["pending", "paid", "failed", "refunded"],
      membership_role: [
        "platform_admin",
        "tenant_admin",
        "manager",
        "agent",
        "billing_admin",
        "customer",
      ],
      membership_status: ["invited", "active", "disabled"],
      message_visibility: ["public", "internal"],
      notification_type: [
        "ticket_assigned",
        "ticket_created",
        "ticket_updated",
        "ticket_closed",
        "mention",
        "billing",
        "system",
      ],
      sla_event_status: ["pending", "completed", "breached"],
      sla_event_type: ["first_response", "resolution"],
      sla_policy_status: ["active", "paused", "draft"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "expired",
      ],
      tenant_status: ["active", "suspended", "cancelled"],
      ticket_priority: ["low", "normal", "high", "urgent"],
      ticket_status: [
        "new",
        "open",
        "pending",
        "on_hold",
        "resolved",
        "closed",
      ],
    },
  },
} as const;

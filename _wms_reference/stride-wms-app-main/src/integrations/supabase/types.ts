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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_activity: {
        Row: {
          account_id: string
          actor_name: string | null
          actor_user_id: string | null
          created_at: string
          details: Json
          event_label: string
          event_type: string
          id: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_label: string
          event_type: string
          id?: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_label?: string
          event_type?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_activity_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_additional_charges: {
        Row: {
          account_id: string
          charge_amount: number
          charge_description: string | null
          charge_name: string
          charge_type: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          charge_amount: number
          charge_description?: string | null
          charge_name: string
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          charge_amount?: number
          charge_description?: string | null
          charge_name?: string
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_additional_charges_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_additional_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_additional_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      account_charge_adjustments: {
        Row: {
          account_id: string
          adjustment_type: string
          charge_type_id: string
          class_code: string | null
          created_at: string
          deleted_at: string | null
          fixed_add_amount: number | null
          id: string
          is_enabled: boolean
          notes: string | null
          override_rate: number | null
          percentage_adjust: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          adjustment_type?: string
          charge_type_id: string
          class_code?: string | null
          created_at?: string
          deleted_at?: string | null
          fixed_add_amount?: number | null
          id?: string
          is_enabled?: boolean
          notes?: string | null
          override_rate?: number | null
          percentage_adjust?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          adjustment_type?: string
          charge_type_id?: string
          class_code?: string | null
          created_at?: string
          deleted_at?: string | null
          fixed_add_amount?: number | null
          id?: string
          is_enabled?: boolean
          notes?: string | null
          override_rate?: number | null
          percentage_adjust?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_charge_adjustments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_charge_adjustments_charge_type_id_fkey"
            columns: ["charge_type_id"]
            isOneToOne: false
            referencedRelation: "charge_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_charge_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_coverage_settings: {
        Row: {
          account_id: string
          coverage_deductible_amount: number | null
          coverage_rate_full_deductible: number | null
          coverage_rate_full_no_deductible: number | null
          created_at: string | null
          created_by: string | null
          default_coverage_type: string | null
          id: string
          override_enabled: boolean | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          account_id: string
          coverage_deductible_amount?: number | null
          coverage_rate_full_deductible?: number | null
          coverage_rate_full_no_deductible?: number | null
          created_at?: string | null
          created_by?: string | null
          default_coverage_type?: string | null
          id?: string
          override_enabled?: boolean | null
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          coverage_deductible_amount?: number | null
          coverage_rate_full_deductible?: number | null
          coverage_rate_full_no_deductible?: number | null
          created_at?: string | null
          created_by?: string | null
          default_coverage_type?: string | null
          id?: string
          override_enabled?: boolean | null
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_coverage_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_coverage_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_coverage_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_coverage_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_coverage_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_coverage_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      account_credits: {
        Row: {
          account_id: string
          amount: number
          applied_to_invoice_id: string | null
          balance_remaining: number | null
          claim_id: string | null
          created_at: string
          created_by: string | null
          credit_type: string | null
          id: string
          notes: string | null
          reason: string | null
          status: string | null
          tenant_id: string
          voided_at: string | null
          voided_by: string | null
          voided_reason: string | null
        }
        Insert: {
          account_id: string
          amount: number
          applied_to_invoice_id?: string | null
          balance_remaining?: number | null
          claim_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_type?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          status?: string | null
          tenant_id: string
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          applied_to_invoice_id?: string | null
          balance_remaining?: number | null
          claim_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_type?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          status?: string | null
          tenant_id?: string
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Relationships: []
      }
      account_item_type_overrides: {
        Row: {
          account_id: string
          created_at: string | null
          created_by: string | null
          custom_packaging_rate: number | null
          id: string
          item_type_id: string
          minor_touchup_rate: number | null
          packing_rate: number | null
          pallet_sale_rate: number | null
          picking_rate: number | null
          receiving_rate: number | null
          shipping_rate: number | null
          storage_billing_frequency: string | null
          storage_rate: number | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          created_by?: string | null
          custom_packaging_rate?: number | null
          id?: string
          item_type_id: string
          minor_touchup_rate?: number | null
          packing_rate?: number | null
          pallet_sale_rate?: number | null
          picking_rate?: number | null
          receiving_rate?: number | null
          shipping_rate?: number | null
          storage_billing_frequency?: string | null
          storage_rate?: number | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          created_by?: string | null
          custom_packaging_rate?: number | null
          id?: string
          item_type_id?: string
          minor_touchup_rate?: number | null
          packing_rate?: number | null
          pallet_sale_rate?: number | null
          picking_rate?: number | null
          receiving_rate?: number | null
          shipping_rate?: number | null
          storage_billing_frequency?: string | null
          storage_rate?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_item_type_overrides_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_item_type_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_item_type_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_item_type_overrides_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      account_promo_codes: {
        Row: {
          account_id: string
          assigned_at: string
          assigned_by: string | null
          id: string
          notes: string | null
          promo_code_id: string
        }
        Insert: {
          account_id: string
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          notes?: string | null
          promo_code_id: string
        }
        Update: {
          account_id?: string
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          notes?: string | null
          promo_code_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_promo_codes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_promo_codes_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      account_rate_overrides: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          custom_packaging_rate: number | null
          deleted_at: string | null
          id: string
          item_type_id: string
          minor_touchup_rate: number | null
          packing_rate: number | null
          pallet_sale_rate: number | null
          picking_rate: number | null
          receiving_rate: number | null
          shipping_rate: number | null
          storage_billing_frequency: string | null
          storage_rate: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          custom_packaging_rate?: number | null
          deleted_at?: string | null
          id?: string
          item_type_id: string
          minor_touchup_rate?: number | null
          packing_rate?: number | null
          pallet_sale_rate?: number | null
          picking_rate?: number | null
          receiving_rate?: number | null
          shipping_rate?: number | null
          storage_billing_frequency?: string | null
          storage_rate?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          custom_packaging_rate?: number | null
          deleted_at?: string | null
          id?: string
          item_type_id?: string
          minor_touchup_rate?: number | null
          packing_rate?: number | null
          pallet_sale_rate?: number | null
          picking_rate?: number | null
          receiving_rate?: number | null
          shipping_rate?: number | null
          storage_billing_frequency?: string | null
          storage_rate?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_rate_overrides_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rate_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rate_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rate_overrides_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rate_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_room_suggestions: {
        Row: {
          account_id: string
          created_at: string
          id: string
          last_used_at: string
          room: string
          usage_count: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          last_used_at?: string
          room: string
          usage_count?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          last_used_at?: string
          room?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_room_suggestions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_service_settings: {
        Row: {
          account_id: string
          created_at: string | null
          custom_percent_adjust: number | null
          custom_rate: number | null
          id: string
          is_enabled: boolean | null
          notes: string | null
          service_code: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          custom_percent_adjust?: number | null
          custom_rate?: number | null
          id?: string
          is_enabled?: boolean | null
          notes?: string | null
          service_code: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          custom_percent_adjust?: number | null
          custom_rate?: number | null
          id?: string
          is_enabled?: boolean | null
          notes?: string | null
          service_code?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_service_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_service_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      account_service_settings_audit: {
        Row: {
          account_id: string
          account_service_setting_id: string | null
          action: string
          changed_at: string | null
          changed_by: string | null
          changed_fields: string[] | null
          id: string
          new_values: Json | null
          old_values: Json | null
          service_code: string
          tenant_id: string
        }
        Insert: {
          account_id: string
          account_service_setting_id?: string | null
          action: string
          changed_at?: string | null
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          service_code: string
          tenant_id: string
        }
        Update: {
          account_id?: string
          account_service_setting_id?: string | null
          action?: string
          changed_at?: string | null
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          service_code?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_service_settings_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_service_settings_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      account_sidemarks: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          id: string
          sidemark: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          sidemark: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          sidemark?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_sidemarks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_task_permissions: {
        Row: {
          account_id: string
          created_at: string | null
          id: string
          is_allowed: boolean | null
          task_type_id: string
          updated_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string | null
          id?: string
          is_allowed?: boolean | null
          task_type_id: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string | null
          id?: string
          is_allowed?: boolean | null
          task_type_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_task_permissions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_task_permissions_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          access_level: string | null
          account_alert_recipients: string | null
          account_code: string
          account_name: string
          account_type: string | null
          alerts_contact_email: string | null
          alerts_contact_name: string | null
          allow_item_reassignment: boolean | null
          auto_apply_coverage_on_receiving: boolean | null
          auto_assembly_on_receiving: boolean | null
          auto_inspection_on_receiving: boolean | null
          auto_quarantine_damaged_items: boolean | null
          auto_repair_on_damage: boolean | null
          billing_address: string | null
          billing_address_line1: string | null
          billing_address_line2: string | null
          billing_city: string | null
          billing_contact_email: string | null
          billing_contact_name: string | null
          billing_contact_phone: string | null
          billing_country: string | null
          billing_email: string | null
          billing_frequency: string | null
          billing_method: string | null
          billing_net_terms: number | null
          billing_postal_code: string | null
          billing_schedule: string | null
          billing_state: string | null
          billing_type: string | null
          can_delete_accounts: boolean | null
          can_modify_pricing: boolean | null
          can_view_parent_data: boolean | null
          client_sidemark_mode: string | null
          communication_settings: Json | null
          copy_from_account_id: string | null
          created_at: string
          credit_hold: boolean | null
          credit_limit: number | null
          credit_limit_amount: number | null
          currency: string | null
          default_coverage_type: string | null
          default_item_notes: string | null
          default_receiving_location_id: string | null
          default_receiving_notes: string | null
          default_receiving_status: string | null
          default_shipment_notes: string | null
          default_sidemark_id: string | null
          default_tax_rate_percent: number | null
          deleted_at: string | null
          disable_email_communications: boolean | null
          email_html_body_override: string | null
          email_recipients_override: string | null
          email_subject_override: string | null
          email_variables: Json | null
          free_storage_days: number | null
          global_rate_adjust_pct: number
          hide_internal_fields_from_clients: boolean | null
          highlight_item_notes: boolean | null
          highlight_shipment_notes: boolean | null
          id: string
          is_active: boolean
          is_master_account: boolean | null
          is_system_account: boolean | null
          is_wholesale: boolean | null
          metadata: Json | null
          net_terms: number | null
          notes: string | null
          parent_account_id: string | null
          payment_terms: string | null
          prepay_required: boolean | null
          pricing_level: string | null
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          read_only_access: boolean | null
          repair_task_type_id_for_damage: string | null
          repair_task_type_id_for_quote: string | null
          require_inspection_photos: boolean | null
          require_sidemark: boolean | null
          restrict_visible_columns: Json | null
          sidemark_label: string | null
          status: string
          storage_billing_day: number
          tenant_id: string
          updated_at: string
          use_tenant_communication_defaults: boolean | null
          use_tenant_email_defaults: boolean | null
        }
        Insert: {
          access_level?: string | null
          account_alert_recipients?: string | null
          account_code: string
          account_name: string
          account_type?: string | null
          alerts_contact_email?: string | null
          alerts_contact_name?: string | null
          allow_item_reassignment?: boolean | null
          auto_apply_coverage_on_receiving?: boolean | null
          auto_assembly_on_receiving?: boolean | null
          auto_inspection_on_receiving?: boolean | null
          auto_quarantine_damaged_items?: boolean | null
          auto_repair_on_damage?: boolean | null
          billing_address?: string | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          billing_contact_phone?: string | null
          billing_country?: string | null
          billing_email?: string | null
          billing_frequency?: string | null
          billing_method?: string | null
          billing_net_terms?: number | null
          billing_postal_code?: string | null
          billing_schedule?: string | null
          billing_state?: string | null
          billing_type?: string | null
          can_delete_accounts?: boolean | null
          can_modify_pricing?: boolean | null
          can_view_parent_data?: boolean | null
          client_sidemark_mode?: string | null
          communication_settings?: Json | null
          copy_from_account_id?: string | null
          created_at?: string
          credit_hold?: boolean | null
          credit_limit?: number | null
          credit_limit_amount?: number | null
          currency?: string | null
          default_coverage_type?: string | null
          default_item_notes?: string | null
          default_receiving_location_id?: string | null
          default_receiving_notes?: string | null
          default_receiving_status?: string | null
          default_shipment_notes?: string | null
          default_sidemark_id?: string | null
          default_tax_rate_percent?: number | null
          deleted_at?: string | null
          disable_email_communications?: boolean | null
          email_html_body_override?: string | null
          email_recipients_override?: string | null
          email_subject_override?: string | null
          email_variables?: Json | null
          free_storage_days?: number | null
          global_rate_adjust_pct?: number
          hide_internal_fields_from_clients?: boolean | null
          highlight_item_notes?: boolean | null
          highlight_shipment_notes?: boolean | null
          id?: string
          is_active?: boolean
          is_master_account?: boolean | null
          is_system_account?: boolean | null
          is_wholesale?: boolean | null
          metadata?: Json | null
          net_terms?: number | null
          notes?: string | null
          parent_account_id?: string | null
          payment_terms?: string | null
          prepay_required?: boolean | null
          pricing_level?: string | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          read_only_access?: boolean | null
          repair_task_type_id_for_damage?: string | null
          repair_task_type_id_for_quote?: string | null
          require_inspection_photos?: boolean | null
          require_sidemark?: boolean | null
          restrict_visible_columns?: Json | null
          sidemark_label?: string | null
          status?: string
          storage_billing_day?: number
          tenant_id: string
          updated_at?: string
          use_tenant_communication_defaults?: boolean | null
          use_tenant_email_defaults?: boolean | null
        }
        Update: {
          access_level?: string | null
          account_alert_recipients?: string | null
          account_code?: string
          account_name?: string
          account_type?: string | null
          alerts_contact_email?: string | null
          alerts_contact_name?: string | null
          allow_item_reassignment?: boolean | null
          auto_apply_coverage_on_receiving?: boolean | null
          auto_assembly_on_receiving?: boolean | null
          auto_inspection_on_receiving?: boolean | null
          auto_quarantine_damaged_items?: boolean | null
          auto_repair_on_damage?: boolean | null
          billing_address?: string | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_contact_email?: string | null
          billing_contact_name?: string | null
          billing_contact_phone?: string | null
          billing_country?: string | null
          billing_email?: string | null
          billing_frequency?: string | null
          billing_method?: string | null
          billing_net_terms?: number | null
          billing_postal_code?: string | null
          billing_schedule?: string | null
          billing_state?: string | null
          billing_type?: string | null
          can_delete_accounts?: boolean | null
          can_modify_pricing?: boolean | null
          can_view_parent_data?: boolean | null
          client_sidemark_mode?: string | null
          communication_settings?: Json | null
          copy_from_account_id?: string | null
          created_at?: string
          credit_hold?: boolean | null
          credit_limit?: number | null
          credit_limit_amount?: number | null
          currency?: string | null
          default_coverage_type?: string | null
          default_item_notes?: string | null
          default_receiving_location_id?: string | null
          default_receiving_notes?: string | null
          default_receiving_status?: string | null
          default_shipment_notes?: string | null
          default_sidemark_id?: string | null
          default_tax_rate_percent?: number | null
          deleted_at?: string | null
          disable_email_communications?: boolean | null
          email_html_body_override?: string | null
          email_recipients_override?: string | null
          email_subject_override?: string | null
          email_variables?: Json | null
          free_storage_days?: number | null
          global_rate_adjust_pct?: number
          hide_internal_fields_from_clients?: boolean | null
          highlight_item_notes?: boolean | null
          highlight_shipment_notes?: boolean | null
          id?: string
          is_active?: boolean
          is_master_account?: boolean | null
          is_system_account?: boolean | null
          is_wholesale?: boolean | null
          metadata?: Json | null
          net_terms?: number | null
          notes?: string | null
          parent_account_id?: string | null
          payment_terms?: string | null
          prepay_required?: boolean | null
          pricing_level?: string | null
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          read_only_access?: boolean | null
          repair_task_type_id_for_damage?: string | null
          repair_task_type_id_for_quote?: string | null
          require_inspection_photos?: boolean | null
          require_sidemark?: boolean | null
          restrict_visible_columns?: Json | null
          sidemark_label?: string | null
          status?: string
          storage_billing_day?: number
          tenant_id?: string
          updated_at?: string
          use_tenant_communication_defaults?: boolean | null
          use_tenant_email_defaults?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_copy_from_account_id_fkey"
            columns: ["copy_from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_default_receiving_location_id_fkey"
            columns: ["default_receiving_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_default_sidemark_id_fkey"
            columns: ["default_sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_repair_task_type_id_for_damage_fkey"
            columns: ["repair_task_type_id_for_damage"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_repair_task_type_id_for_quote_fkey"
            columns: ["repair_task_type_id_for_quote"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      add_ons: {
        Row: {
          code: string
          created_at: string | null
          default_rate: number | null
          description: string | null
          id: string
          is_active: boolean | null
          is_taxable: boolean | null
          name: string
          sort_order: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          default_rate?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_taxable?: boolean | null
          name: string
          sort_order?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          default_rate?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_taxable?: boolean | null
          name?: string
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "add_ons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string
          changes_json: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id: string
          changes_json?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          changes_json?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_impersonation_log: {
        Row: {
          admin_user_id: string
          created_at: string
          ended_at: string | null
          id: string
          simulated_role: string
          started_at: string
          target_tenant_id: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          simulated_role: string
          started_at?: string
          target_tenant_id: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          simulated_role?: string
          started_at?: string
          target_tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_impersonation_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_impersonation_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_impersonation_log_target_tenant_id_fkey"
            columns: ["target_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_default_templates: {
        Row: {
          alert_type_id: string
          body_template_html: string
          body_template_text: string
          channel: string
          created_at: string
          default_enabled: boolean
          id: string
          subject_template: string
        }
        Insert: {
          alert_type_id: string
          body_template_html: string
          body_template_text: string
          channel?: string
          created_at?: string
          default_enabled?: boolean
          id?: string
          subject_template: string
        }
        Update: {
          alert_type_id?: string
          body_template_html?: string
          body_template_text?: string
          channel?: string
          created_at?: string
          default_enabled?: boolean
          id?: string
          subject_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_default_templates_alert_type_id_fkey"
            columns: ["alert_type_id"]
            isOneToOne: false
            referencedRelation: "alert_types"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_queue: {
        Row: {
          alert_type: string
          body_html: string | null
          body_text: string | null
          created_at: string
          entity_id: string
          entity_type: string
          error_message: string | null
          fallback_used: boolean
          id: string
          provider: string | null
          provider_message_id: string | null
          recipient_emails: string[] | null
          sent_at: string | null
          status: string | null
          subject: string
          tenant_id: string
        }
        Insert: {
          alert_type: string
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          error_message?: string | null
          fallback_used?: boolean
          id?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient_emails?: string[] | null
          sent_at?: string | null
          status?: string | null
          subject: string
          tenant_id: string
        }
        Update: {
          alert_type?: string
          body_html?: string | null
          body_text?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          error_message?: string | null
          fallback_used?: boolean
          id?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient_emails?: string[] | null
          sent_at?: string | null
          status?: string | null
          subject?: string
          tenant_id?: string
        }
        Relationships: []
      }
      alert_recipients: {
        Row: {
          alert_type_id: string
          client_contact_id: string | null
          created_at: string
          email: string | null
          id: string
          recipient_type: string
          role_key: string | null
          tenant_id: string
        }
        Insert: {
          alert_type_id: string
          client_contact_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          recipient_type: string
          role_key?: string | null
          tenant_id: string
        }
        Update: {
          alert_type_id?: string
          client_contact_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          recipient_type?: string
          role_key?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_recipients_alert_type_id_fkey"
            columns: ["alert_type_id"]
            isOneToOne: false
            referencedRelation: "alert_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_recipients_client_contact_id_fkey"
            columns: ["client_contact_id"]
            isOneToOne: false
            referencedRelation: "client_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_recipients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_templates: {
        Row: {
          bcc_addresses: Json | null
          body_template_html: string
          body_template_text: string
          branding_settings: Json | null
          cc_addresses: Json | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          id: string
          is_active: boolean | null
          subject_template: string
          template_description: string | null
          template_name: string
          tenant_id: string
          to_addresses: Json | null
          trigger_events: string[] | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          bcc_addresses?: Json | null
          body_template_html: string
          body_template_text: string
          branding_settings?: Json | null
          cc_addresses?: Json | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          subject_template: string
          template_description?: string | null
          template_name: string
          tenant_id: string
          to_addresses?: Json | null
          trigger_events?: string[] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          bcc_addresses?: Json | null
          body_template_html?: string
          body_template_text?: string
          branding_settings?: Json | null
          cc_addresses?: Json | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          subject_template?: string
          template_description?: string | null
          template_name?: string
          tenant_id?: string
          to_addresses?: Json | null
          trigger_events?: string[] | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_types: {
        Row: {
          created_at: string
          description: string | null
          entity_type: string
          id: string
          key: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_type: string
          id?: string
          key: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_type?: string
          id?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      app_issues: {
        Row: {
          account_id: string | null
          action_context: string | null
          app_version: string | null
          component_name: string | null
          created_at: string
          environment: string
          error_message: string
          fingerprint: string
          http_status: number | null
          id: string
          level: string
          request_summary: Json | null
          route: string
          severity: string
          stack_trace: string | null
          status: string
          supabase_error_code: string | null
          tenant_id: string | null
          user_id: string | null
          user_role: string | null
        }
        Insert: {
          account_id?: string | null
          action_context?: string | null
          app_version?: string | null
          component_name?: string | null
          created_at?: string
          environment: string
          error_message: string
          fingerprint: string
          http_status?: number | null
          id?: string
          level: string
          request_summary?: Json | null
          route: string
          severity?: string
          stack_trace?: string | null
          status?: string
          supabase_error_code?: string | null
          tenant_id?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Update: {
          account_id?: string | null
          action_context?: string | null
          app_version?: string | null
          component_name?: string | null
          created_at?: string
          environment?: string
          error_message?: string
          fingerprint?: string
          http_status?: number | null
          id?: string
          level?: string
          request_summary?: Json | null
          route?: string
          severity?: string
          stack_trace?: string | null
          status?: string
          supabase_error_code?: string | null
          tenant_id?: string | null
          user_id?: string | null
          user_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_issues_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          after_json: Json | null
          before_json: Json | null
          changed_at: string
          changes_json: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: unknown
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          after_json?: Json | null
          before_json?: Json | null
          changed_at?: string
          changes_json?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: unknown
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          after_json?: Json | null
          before_json?: Json | null
          changed_at?: string
          changes_json?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: unknown
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billable_services: {
        Row: {
          base_rate: number | null
          category: string
          charge_unit: string
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_taxable: boolean | null
          name: string
          notes: string | null
          pricing_mode: string | null
          sort_order: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          base_rate?: number | null
          category?: string
          charge_unit?: string
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_taxable?: boolean | null
          name: string
          notes?: string | null
          pricing_mode?: string | null
          sort_order?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          base_rate?: number | null
          category?: string
          charge_unit?: string
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_taxable?: boolean | null
          name?: string
          notes?: string | null
          pricing_mode?: string | null
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billable_services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_charge_templates: {
        Row: {
          amount: number
          charge_type: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_charge_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_charge_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_charge_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          account_id: string | null
          calculation_metadata: Json | null
          charge_type: string
          class_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          event_type: string
          has_rate_error: boolean | null
          id: string
          invoice_id: string | null
          invoiced_at: string | null
          item_id: string | null
          metadata: Json
          needs_review: boolean | null
          occurred_at: string
          quantity: number | null
          rate_error_message: string | null
          rate_source: string | null
          service_category: string | null
          service_id: string | null
          shipment_id: string | null
          sidemark_id: string | null
          status: string
          task_id: string | null
          tenant_id: string
          total_amount: number | null
          unit_rate: number | null
        }
        Insert: {
          account_id?: string | null
          calculation_metadata?: Json | null
          charge_type: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_type: string
          has_rate_error?: boolean | null
          id?: string
          invoice_id?: string | null
          invoiced_at?: string | null
          item_id?: string | null
          metadata?: Json
          needs_review?: boolean | null
          occurred_at?: string
          quantity?: number | null
          rate_error_message?: string | null
          rate_source?: string | null
          service_category?: string | null
          service_id?: string | null
          shipment_id?: string | null
          sidemark_id?: string | null
          status?: string
          task_id?: string | null
          tenant_id: string
          total_amount?: number | null
          unit_rate?: number | null
        }
        Update: {
          account_id?: string | null
          calculation_metadata?: Json | null
          charge_type?: string
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          event_type?: string
          has_rate_error?: boolean | null
          id?: string
          invoice_id?: string | null
          invoiced_at?: string | null
          item_id?: string | null
          metadata?: Json
          needs_review?: boolean | null
          occurred_at?: string
          quantity?: number | null
          rate_error_message?: string | null
          rate_source?: string | null
          service_category?: string | null
          service_id?: string | null
          shipment_id?: string | null
          sidemark_id?: string | null
          status?: string
          task_id?: string | null
          tenant_id?: string
          total_amount?: number | null
          unit_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "billable_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_sidemark_id_fkey"
            columns: ["sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_types: {
        Row: {
          add_flag: boolean
          add_to_scan: boolean
          alert_rule: string | null
          category: string
          charge_code: string
          charge_name: string
          created_at: string
          created_by: string | null
          default_trigger: string
          deleted_at: string | null
          flag_is_indicator: boolean | null
          id: string
          input_mode: string
          is_active: boolean
          is_taxable: boolean
          legacy_service_code: string | null
          min_minutes: number | null
          min_qty: number | null
          notes: string | null
          qty_step: number | null
          tenant_id: string
          time_unit_default: string | null
          updated_at: string
        }
        Insert: {
          add_flag?: boolean
          add_to_scan?: boolean
          alert_rule?: string | null
          category?: string
          charge_code: string
          charge_name: string
          created_at?: string
          created_by?: string | null
          default_trigger?: string
          deleted_at?: string | null
          flag_is_indicator?: boolean | null
          id?: string
          input_mode?: string
          is_active?: boolean
          is_taxable?: boolean
          legacy_service_code?: string | null
          min_minutes?: number | null
          min_qty?: number | null
          notes?: string | null
          qty_step?: number | null
          tenant_id: string
          time_unit_default?: string | null
          updated_at?: string
        }
        Update: {
          add_flag?: boolean
          add_to_scan?: boolean
          alert_rule?: string | null
          category?: string
          charge_code?: string
          charge_name?: string
          created_at?: string
          created_by?: string | null
          default_trigger?: string
          deleted_at?: string | null
          flag_is_indicator?: boolean | null
          id?: string
          input_mode?: string
          is_active?: boolean
          is_taxable?: boolean
          legacy_service_code?: string | null
          min_minutes?: number | null
          min_qty?: number | null
          notes?: string | null
          qty_step?: number | null
          tenant_id?: string
          time_unit_default?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "charge_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string | null
          id: string
          tenant_id: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          tenant_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          tenant_id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          created_by: string | null
          entity_map: Json | null
          id: string
          role: string
          tool_calls: Json | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          created_by?: string | null
          entity_map?: Json | null
          id?: string
          role: string
          tool_calls?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          created_by?: string | null
          entity_map?: Json | null
          id?: string
          role?: string
          tool_calls?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_acceptance_log: {
        Row: {
          action: string
          claim_id: string
          created_at: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          action: string
          claim_id: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          claim_id?: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_acceptance_log_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_acceptance_log_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "v_claims_with_items"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_ai_analysis: {
        Row: {
          claim_id: string
          confidence_level: string
          created_at: string | null
          flags: string[] | null
          id: string
          input_snapshot: Json
          model_version: string | null
          reasoning: string | null
          recommendation_amount: number | null
          recommended_action: string
          tenant_id: string
        }
        Insert: {
          claim_id: string
          confidence_level: string
          created_at?: string | null
          flags?: string[] | null
          id?: string
          input_snapshot: Json
          model_version?: string | null
          reasoning?: string | null
          recommendation_amount?: number | null
          recommended_action: string
          tenant_id: string
        }
        Update: {
          claim_id?: string
          confidence_level?: string
          created_at?: string | null
          flags?: string[] | null
          id?: string
          input_snapshot?: Json
          model_version?: string | null
          reasoning?: string | null
          recommendation_amount?: number | null
          recommended_action?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_ai_analysis_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: true
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_ai_analysis_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: true
            referencedRelation: "v_claims_with_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_ai_analysis_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_ai_feedback: {
        Row: {
          analysis_id: string | null
          claim_id: string
          created_at: string | null
          decided_by: string | null
          decision_source: string
          delta_amount: number | null
          final_payout_amount: number | null
          final_status: string
          id: string
          override_notes: string | null
          override_reason_code: string | null
          tenant_id: string
        }
        Insert: {
          analysis_id?: string | null
          claim_id: string
          created_at?: string | null
          decided_by?: string | null
          decision_source: string
          delta_amount?: number | null
          final_payout_amount?: number | null
          final_status: string
          id?: string
          override_notes?: string | null
          override_reason_code?: string | null
          tenant_id: string
        }
        Update: {
          analysis_id?: string | null
          claim_id?: string
          created_at?: string | null
          decided_by?: string | null
          decision_source?: string
          delta_amount?: number | null
          final_payout_amount?: number | null
          final_status?: string
          id?: string
          override_notes?: string | null
          override_reason_code?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_ai_feedback_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "claim_ai_analysis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_ai_feedback_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_ai_feedback_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "v_claims_with_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_ai_feedback_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_ai_feedback_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_ai_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_attachments: {
        Row: {
          category: string | null
          claim_id: string
          created_at: string
          file_name: string | null
          id: string
          is_public: boolean
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          claim_id: string
          created_at?: string
          file_name?: string | null
          id?: string
          is_public?: boolean
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          claim_id?: string
          created_at?: string
          file_name?: string | null
          id?: string
          is_public?: boolean
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_attachments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_attachments_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "v_claims_with_items"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_audit: {
        Row: {
          action: string
          actor_id: string | null
          claim_id: string
          created_at: string
          details: Json | null
          id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          claim_id: string
          created_at?: string
          details?: Json | null
          id?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          claim_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_audit_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_audit_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "v_claims_with_items"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_items: {
        Row: {
          approved_amount: number | null
          calculated_amount: number | null
          claim_id: string
          coverage_rate: number | null
          coverage_snapshot: Json | null
          coverage_source: string | null
          coverage_type: string | null
          created_at: string | null
          declared_value: number | null
          deductible_applied: number | null
          determination_notes: string | null
          determined_at: string | null
          determined_by: string | null
          id: string
          item_id: string | null
          item_notes: string | null
          non_inventory_ref: string | null
          payout_method: string | null
          payout_processed: boolean | null
          payout_processed_at: string | null
          pop_document_id: string | null
          pop_provided: boolean | null
          pop_required: boolean | null
          pop_value: number | null
          prorated_cap: number | null
          repair_cost: number | null
          repair_quote_id: string | null
          repairable: boolean | null
          requested_amount: number | null
          tenant_id: string
          updated_at: string | null
          use_repair_cost: boolean | null
          valuation_basis: number | null
          valuation_method: string | null
          weight_lbs: number | null
        }
        Insert: {
          approved_amount?: number | null
          calculated_amount?: number | null
          claim_id: string
          coverage_rate?: number | null
          coverage_snapshot?: Json | null
          coverage_source?: string | null
          coverage_type?: string | null
          created_at?: string | null
          declared_value?: number | null
          deductible_applied?: number | null
          determination_notes?: string | null
          determined_at?: string | null
          determined_by?: string | null
          id?: string
          item_id?: string | null
          item_notes?: string | null
          non_inventory_ref?: string | null
          payout_method?: string | null
          payout_processed?: boolean | null
          payout_processed_at?: string | null
          pop_document_id?: string | null
          pop_provided?: boolean | null
          pop_required?: boolean | null
          pop_value?: number | null
          prorated_cap?: number | null
          repair_cost?: number | null
          repair_quote_id?: string | null
          repairable?: boolean | null
          requested_amount?: number | null
          tenant_id: string
          updated_at?: string | null
          use_repair_cost?: boolean | null
          valuation_basis?: number | null
          valuation_method?: string | null
          weight_lbs?: number | null
        }
        Update: {
          approved_amount?: number | null
          calculated_amount?: number | null
          claim_id?: string
          coverage_rate?: number | null
          coverage_snapshot?: Json | null
          coverage_source?: string | null
          coverage_type?: string | null
          created_at?: string | null
          declared_value?: number | null
          deductible_applied?: number | null
          determination_notes?: string | null
          determined_at?: string | null
          determined_by?: string | null
          id?: string
          item_id?: string | null
          item_notes?: string | null
          non_inventory_ref?: string | null
          payout_method?: string | null
          payout_processed?: boolean | null
          payout_processed_at?: string | null
          pop_document_id?: string | null
          pop_provided?: boolean | null
          pop_required?: boolean | null
          pop_value?: number | null
          prorated_cap?: number | null
          repair_cost?: number | null
          repair_quote_id?: string | null
          repairable?: boolean | null
          requested_amount?: number | null
          tenant_id?: string
          updated_at?: string | null
          use_repair_cost?: boolean | null
          valuation_basis?: number | null
          valuation_method?: string | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_items_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_items_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "v_claims_with_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_items_pop_document_id_fkey"
            columns: ["pop_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          acceptance_token: string | null
          acceptance_token_expires_at: string | null
          account_id: string
          admin_approval_notes: string | null
          admin_approved_at: string | null
          admin_approved_by: string | null
          approved_amount: number | null
          approved_by_system: boolean | null
          approved_payout_amount: number | null
          assigned_to: string | null
          assistance_fee_billed: boolean | null
          auto_approved: boolean | null
          claim_category: string | null
          claim_number: string
          claim_type: string
          claim_value_calculated: number | null
          claim_value_requested: number | null
          claimed_amount: number | null
          client_initiated: boolean | null
          counter_offer_amount: number | null
          counter_offer_notes: string | null
          coverage_snapshot: Json | null
          coverage_type: string | null
          created_at: string | null
          decline_reason: string | null
          deductible: number | null
          deductible_applied: number | null
          deleted_at: string | null
          description: string
          determination_sent_at: string | null
          documents: Json | null
          filed_at: string | null
          filed_by: string | null
          id: string
          incident_contact_email: string | null
          incident_contact_name: string | null
          incident_contact_phone: string | null
          incident_date: string | null
          incident_location: string | null
          internal_notes: string | null
          item_id: string | null
          non_inventory_ref: string | null
          payout_method: string | null
          payout_reference: string | null
          photos: Json | null
          public_notes: string | null
          public_report_token: string | null
          repair_task_created_id: string | null
          requires_admin_approval: boolean | null
          requires_manager_approval: boolean
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          sent_for_acceptance_at: string | null
          sent_for_acceptance_by: string | null
          settlement_acceptance_required: boolean | null
          settlement_accepted_at: string | null
          settlement_accepted_by: string | null
          settlement_accepted_ip: string | null
          settlement_declined_at: string | null
          settlement_declined_by: string | null
          settlement_terms_text: string | null
          settlement_terms_version: string | null
          shipment_id: string | null
          sidemark_id: string | null
          sla_due_at: string | null
          sla_pause_reason: string | null
          sla_paused_at: string | null
          sla_stage: string | null
          sla_status: string | null
          sla_total_paused_minutes: number | null
          status: string
          status_before_acceptance: string | null
          tenant_id: string
          total_approved_amount: number | null
          total_deductible: number | null
          total_requested_amount: number | null
          updated_at: string | null
        }
        Insert: {
          acceptance_token?: string | null
          acceptance_token_expires_at?: string | null
          account_id: string
          admin_approval_notes?: string | null
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          approved_amount?: number | null
          approved_by_system?: boolean | null
          approved_payout_amount?: number | null
          assigned_to?: string | null
          assistance_fee_billed?: boolean | null
          auto_approved?: boolean | null
          claim_category?: string | null
          claim_number: string
          claim_type?: string
          claim_value_calculated?: number | null
          claim_value_requested?: number | null
          claimed_amount?: number | null
          client_initiated?: boolean | null
          counter_offer_amount?: number | null
          counter_offer_notes?: string | null
          coverage_snapshot?: Json | null
          coverage_type?: string | null
          created_at?: string | null
          decline_reason?: string | null
          deductible?: number | null
          deductible_applied?: number | null
          deleted_at?: string | null
          description: string
          determination_sent_at?: string | null
          documents?: Json | null
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          incident_contact_email?: string | null
          incident_contact_name?: string | null
          incident_contact_phone?: string | null
          incident_date?: string | null
          incident_location?: string | null
          internal_notes?: string | null
          item_id?: string | null
          non_inventory_ref?: string | null
          payout_method?: string | null
          payout_reference?: string | null
          photos?: Json | null
          public_notes?: string | null
          public_report_token?: string | null
          repair_task_created_id?: string | null
          requires_admin_approval?: boolean | null
          requires_manager_approval?: boolean
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sent_for_acceptance_at?: string | null
          sent_for_acceptance_by?: string | null
          settlement_acceptance_required?: boolean | null
          settlement_accepted_at?: string | null
          settlement_accepted_by?: string | null
          settlement_accepted_ip?: string | null
          settlement_declined_at?: string | null
          settlement_declined_by?: string | null
          settlement_terms_text?: string | null
          settlement_terms_version?: string | null
          shipment_id?: string | null
          sidemark_id?: string | null
          sla_due_at?: string | null
          sla_pause_reason?: string | null
          sla_paused_at?: string | null
          sla_stage?: string | null
          sla_status?: string | null
          sla_total_paused_minutes?: number | null
          status?: string
          status_before_acceptance?: string | null
          tenant_id: string
          total_approved_amount?: number | null
          total_deductible?: number | null
          total_requested_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          acceptance_token?: string | null
          acceptance_token_expires_at?: string | null
          account_id?: string
          admin_approval_notes?: string | null
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          approved_amount?: number | null
          approved_by_system?: boolean | null
          approved_payout_amount?: number | null
          assigned_to?: string | null
          assistance_fee_billed?: boolean | null
          auto_approved?: boolean | null
          claim_category?: string | null
          claim_number?: string
          claim_type?: string
          claim_value_calculated?: number | null
          claim_value_requested?: number | null
          claimed_amount?: number | null
          client_initiated?: boolean | null
          counter_offer_amount?: number | null
          counter_offer_notes?: string | null
          coverage_snapshot?: Json | null
          coverage_type?: string | null
          created_at?: string | null
          decline_reason?: string | null
          deductible?: number | null
          deductible_applied?: number | null
          deleted_at?: string | null
          description?: string
          determination_sent_at?: string | null
          documents?: Json | null
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          incident_contact_email?: string | null
          incident_contact_name?: string | null
          incident_contact_phone?: string | null
          incident_date?: string | null
          incident_location?: string | null
          internal_notes?: string | null
          item_id?: string | null
          non_inventory_ref?: string | null
          payout_method?: string | null
          payout_reference?: string | null
          photos?: Json | null
          public_notes?: string | null
          public_report_token?: string | null
          repair_task_created_id?: string | null
          requires_admin_approval?: boolean | null
          requires_manager_approval?: boolean
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sent_for_acceptance_at?: string | null
          sent_for_acceptance_by?: string | null
          settlement_acceptance_required?: boolean | null
          settlement_accepted_at?: string | null
          settlement_accepted_by?: string | null
          settlement_accepted_ip?: string | null
          settlement_declined_at?: string | null
          settlement_declined_by?: string | null
          settlement_terms_text?: string | null
          settlement_terms_version?: string | null
          shipment_id?: string | null
          sidemark_id?: string | null
          sla_due_at?: string | null
          sla_pause_reason?: string | null
          sla_paused_at?: string | null
          sla_stage?: string | null
          sla_status?: string | null
          sla_total_paused_minutes?: number | null
          status?: string
          status_before_acceptance?: string | null
          tenant_id?: string
          total_approved_amount?: number | null
          total_deductible?: number | null
          total_requested_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_admin_approved_by_fkey"
            columns: ["admin_approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_admin_approved_by_fkey"
            columns: ["admin_approved_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_filed_by_fkey"
            columns: ["filed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_filed_by_fkey"
            columns: ["filed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_sent_for_acceptance_by_fkey"
            columns: ["sent_for_acceptance_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_sent_for_acceptance_by_fkey"
            columns: ["sent_for_acceptance_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_sidemark_id_fkey"
            columns: ["sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          class_code: string | null
          class_name: string | null
          code: string
          created_at: string | null
          default_inspection_minutes: number | null
          id: string
          inspection_fee_per_item: number | null
          is_active: boolean | null
          max_cubic_feet: number | null
          min_cubic_feet: number | null
          name: string
          notes: string | null
          sort_order: number | null
          storage_rate_per_day: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          class_code?: string | null
          class_name?: string | null
          code: string
          created_at?: string | null
          default_inspection_minutes?: number | null
          id?: string
          inspection_fee_per_item?: number | null
          is_active?: boolean | null
          max_cubic_feet?: number | null
          min_cubic_feet?: number | null
          name: string
          notes?: string | null
          sort_order?: number | null
          storage_rate_per_day?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          class_code?: string | null
          class_name?: string | null
          code?: string
          created_at?: string | null
          default_inspection_minutes?: number | null
          id?: string
          inspection_fee_per_item?: number | null
          is_active?: boolean | null
          max_cubic_feet?: number | null
          min_cubic_feet?: number | null
          name?: string
          notes?: string | null
          sort_order?: number | null
          storage_rate_per_day?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_chat_repair_quote_drafts: {
        Row: {
          account_id: string
          confirmed_at: string | null
          created_at: string | null
          created_by: string
          expires_at: string | null
          id: string
          item_ids: string[]
          notes: string | null
          status: string | null
          subaccount_id: string | null
          tenant_id: string
        }
        Insert: {
          account_id: string
          confirmed_at?: string | null
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          id?: string
          item_ids: string[]
          notes?: string | null
          status?: string | null
          subaccount_id?: string | null
          tenant_id: string
        }
        Update: {
          account_id?: string
          confirmed_at?: string | null
          created_at?: string | null
          created_by?: string
          expires_at?: string | null
          id?: string
          item_ids?: string[]
          notes?: string | null
          status?: string | null
          subaccount_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_chat_repair_quote_drafts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_chat_repair_quote_drafts_subaccount_id_fkey"
            columns: ["subaccount_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_chat_repair_quote_drafts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_chat_sessions: {
        Row: {
          account_id: string
          created_at: string | null
          expires_at: string | null
          id: string
          last_route: string | null
          last_selected_items: string[] | null
          pending_disambiguation: Json | null
          pending_draft: Json | null
          tenant_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_route?: string | null
          last_selected_items?: string[] | null
          pending_disambiguation?: Json | null
          pending_draft?: Json | null
          tenant_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          last_route?: string | null
          last_selected_items?: string[] | null
          pending_disambiguation?: Json | null
          pending_draft?: Json | null
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_chat_sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_chat_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_chat_will_call_drafts: {
        Row: {
          account_id: string
          confirmed_at: string | null
          created_at: string | null
          created_by: string
          expires_at: string | null
          id: string
          item_ids: string[]
          notes: string | null
          release_type: string
          released_to_name: string
          status: string | null
          subaccount_id: string | null
          tenant_id: string
        }
        Insert: {
          account_id: string
          confirmed_at?: string | null
          created_at?: string | null
          created_by: string
          expires_at?: string | null
          id?: string
          item_ids: string[]
          notes?: string | null
          release_type: string
          released_to_name: string
          status?: string | null
          subaccount_id?: string | null
          tenant_id: string
        }
        Update: {
          account_id?: string
          confirmed_at?: string | null
          created_at?: string | null
          created_by?: string
          expires_at?: string | null
          id?: string
          item_ids?: string[]
          notes?: string | null
          release_type?: string
          released_to_name?: string
          status?: string | null
          subaccount_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_chat_will_call_drafts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_chat_will_call_drafts_subaccount_id_fkey"
            columns: ["subaccount_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_chat_will_call_drafts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          account_name: string | null
          client_name: string
          contact_name: string
          created_at: string
          email: string
          id: string
          is_active: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          client_name: string
          contact_name: string
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          client_name?: string
          contact_name?: string
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invitations: {
        Row: {
          accepted_at: string | null
          account_id: string
          client_portal_user_id: string | null
          created_at: string | null
          created_by: string | null
          email: string
          expires_at: string
          first_name: string | null
          id: string
          last_name: string | null
          sent_at: string | null
          status: string
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          account_id: string
          client_portal_user_id?: string | null
          created_at?: string | null
          created_by?: string | null
          email: string
          expires_at: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          sent_at?: string | null
          status?: string
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          account_id?: string
          client_portal_user_id?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string
          expires_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          sent_at?: string | null
          status?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invitations_client_portal_user_id_fkey"
            columns: ["client_portal_user_id"]
            isOneToOne: false
            referencedRelation: "client_portal_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_users: {
        Row: {
          account_id: string
          auth_user_id: string | null
          created_at: string | null
          created_by: string | null
          email: string
          first_name: string | null
          id: string
          is_active: boolean | null
          is_primary: boolean | null
          last_login_at: string | null
          last_name: string | null
          phone: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          account_id: string
          auth_user_id?: string | null
          created_at?: string | null
          created_by?: string | null
          email: string
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          auth_user_id?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_primary?: boolean | null
          last_login_at?: string | null
          last_name?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_users_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_alerts: {
        Row: {
          channels: Json
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          key: string
          name: string
          tenant_id: string
          timing_rule: string
          trigger_event: string
          updated_at: string
        }
        Insert: {
          channels?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          key: string
          name: string
          tenant_id: string
          timing_rule?: string
          trigger_event: string
          updated_at?: string
        }
        Update: {
          channels?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          key?: string
          name?: string
          tenant_id?: string
          timing_rule?: string
          trigger_event?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_brand_settings: {
        Row: {
          brand_logo_url: string | null
          brand_primary_color: string
          brand_support_email: string | null
          created_at: string
          custom_email_domain: string | null
          dkim_verified: boolean | null
          dmarc_status: string
          email_domain_verified: boolean | null
          email_verification_token: string | null
          email_verification_type: string | null
          email_verified_at: string | null
          from_email: string | null
          from_name: string | null
          id: string
          portal_base_url: string | null
          reply_to_email: string | null
          resend_dns_records: Json | null
          resend_domain_id: string | null
          sms_sender_id: string | null
          spf_verified: boolean | null
          tenant_id: string
          updated_at: string
          use_default_email: boolean | null
        }
        Insert: {
          brand_logo_url?: string | null
          brand_primary_color?: string
          brand_support_email?: string | null
          created_at?: string
          custom_email_domain?: string | null
          dkim_verified?: boolean | null
          dmarc_status?: string
          email_domain_verified?: boolean | null
          email_verification_token?: string | null
          email_verification_type?: string | null
          email_verified_at?: string | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          portal_base_url?: string | null
          reply_to_email?: string | null
          resend_dns_records?: Json | null
          resend_domain_id?: string | null
          sms_sender_id?: string | null
          spf_verified?: boolean | null
          tenant_id: string
          updated_at?: string
          use_default_email?: boolean | null
        }
        Update: {
          brand_logo_url?: string | null
          brand_primary_color?: string
          brand_support_email?: string | null
          created_at?: string
          custom_email_domain?: string | null
          dkim_verified?: boolean | null
          dmarc_status?: string
          email_domain_verified?: boolean | null
          email_verification_token?: string | null
          email_verification_type?: string | null
          email_verified_at?: string | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          portal_base_url?: string | null
          reply_to_email?: string | null
          resend_dns_records?: Json | null
          resend_domain_id?: string | null
          sms_sender_id?: string | null
          spf_verified?: boolean | null
          tenant_id?: string
          updated_at?: string
          use_default_email?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_brand_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_design_elements: {
        Row: {
          category: string
          created_at: string
          html_snippet: string
          id: string
          is_system: boolean
          name: string
          tenant_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          html_snippet: string
          id?: string
          is_system?: boolean
          name: string
          tenant_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          html_snippet?: string
          id?: string
          is_system?: boolean
          name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_design_elements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_legacy_trigger_registry: {
        Row: {
          catalog_snapshot: Json
          created_at: string
          description: string | null
          key: string
          replacement_key: string | null
          updated_at: string
        }
        Insert: {
          catalog_snapshot?: Json
          created_at?: string
          description?: string | null
          key: string
          replacement_key?: string | null
          updated_at?: string
        }
        Update: {
          catalog_snapshot?: Json
          created_at?: string
          description?: string | null
          key?: string
          replacement_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      communication_template_versions: {
        Row: {
          body_template: string
          created_at: string
          created_by: string | null
          id: string
          subject_template: string | null
          template_id: string
          version_number: number
        }
        Insert: {
          body_template: string
          created_at?: string
          created_by?: string | null
          id?: string
          subject_template?: string | null
          template_id: string
          version_number: number
        }
        Update: {
          body_template?: string
          created_at?: string
          created_by?: string | null
          id?: string
          subject_template?: string | null
          template_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "communication_template_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_template_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_templates: {
        Row: {
          alert_id: string
          body_format: string
          body_template: string
          channel: string
          created_at: string
          editor_json: Json | null
          from_email: string | null
          from_name: string | null
          id: string
          in_app_recipients: string | null
          sms_sender_id: string | null
          subject_template: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          alert_id: string
          body_format?: string
          body_template: string
          channel: string
          created_at?: string
          editor_json?: Json | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          in_app_recipients?: string | null
          sms_sender_id?: string | null
          subject_template?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          alert_id?: string
          body_format?: string
          body_template?: string
          channel?: string
          created_at?: string
          editor_json?: Json | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          in_app_recipients?: string | null
          sms_sender_id?: string | null
          subject_template?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_templates_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "communication_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_trigger_catalog: {
        Row: {
          audience: string
          created_at: string
          default_channels: string[]
          description: string | null
          display_name: string
          id: string
          is_active: boolean
          is_legacy: boolean
          key: string
          legacy_replacement_key: string | null
          module_group: string
          severity: string
        }
        Insert: {
          audience?: string
          created_at?: string
          default_channels?: string[]
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          is_legacy?: boolean
          key: string
          legacy_replacement_key?: string | null
          module_group: string
          severity?: string
        }
        Update: {
          audience?: string
          created_at?: string
          default_channels?: string[]
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          is_legacy?: boolean
          key?: string
          legacy_replacement_key?: string | null
          module_group?: string
          severity?: string
        }
        Relationships: []
      }
      containers: {
        Row: {
          container_code: string
          container_type: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          footprint_cu_ft: number | null
          id: string
          is_active: boolean
          location_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          container_code: string
          container_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          footprint_cu_ft?: number | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          container_code?: string
          container_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          footprint_cu_ft?: number | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "containers_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_history: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string | null
          id: string
          item_id: string | null
          new_coverage_type: string | null
          new_declared_value: number | null
          note: string | null
          old_coverage_type: string | null
          old_declared_value: number | null
          shipment_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          changed_by?: string | null
          created_at?: string | null
          id?: string
          item_id?: string | null
          new_coverage_type?: string | null
          new_declared_value?: number | null
          note?: string | null
          old_coverage_type?: string | null
          old_declared_value?: number | null
          shipment_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string | null
          id?: string
          item_id?: string | null
          new_coverage_type?: string | null
          new_declared_value?: number | null
          note?: string | null
          old_coverage_type?: string | null
          old_declared_value?: number | null
          shipment_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_applications: {
        Row: {
          amount_applied: number
          applied_at: string
          applied_by: string | null
          credit_id: string
          id: string
          invoice_id: string
          notes: string | null
          tenant_id: string
        }
        Insert: {
          amount_applied: number
          applied_at?: string
          applied_by?: string | null
          credit_id: string
          id?: string
          invoice_id: string
          notes?: string | null
          tenant_id: string
        }
        Update: {
          amount_applied?: number
          applied_at?: string
          applied_by?: string | null
          credit_id?: string
          id?: string
          invoice_id?: string
          notes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_applications_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "account_credits"
            referencedColumns: ["id"]
          },
        ]
      }
      csv_import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          error_summary: Json | null
          failed_rows: number | null
          id: string
          original_file_key: string
          original_file_name: string
          processed_rows: number | null
          results_file_key: string | null
          started_at: string | null
          status: string
          successful_rows: number | null
          tenant_id: string
          total_rows: number | null
          type: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          error_summary?: Json | null
          failed_rows?: number | null
          id?: string
          original_file_key: string
          original_file_name: string
          processed_rows?: number | null
          results_file_key?: string | null
          started_at?: string | null
          status?: string
          successful_rows?: number | null
          tenant_id: string
          total_rows?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          error_summary?: Json | null
          failed_rows?: number | null
          id?: string
          original_file_key?: string
          original_file_name?: string
          processed_rows?: number | null
          results_file_key?: string | null
          started_at?: string | null
          status?: string
          successful_rows?: number | null
          tenant_id?: string
          total_rows?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "csv_import_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_import_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_import_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_billing_charges: {
        Row: {
          account_id: string | null
          amount: number
          charge_date: string
          charge_name: string
          created_at: string
          created_by: string
          deleted_at: string | null
          description: string | null
          id: string
          invoice_id: string | null
          invoiced_at: string | null
          item_id: string | null
          task_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          charge_date?: string
          charge_name: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          invoiced_at?: string | null
          item_id?: string | null
          task_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          charge_date?: string
          charge_name?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          invoiced_at?: string | null
          item_id?: string | null
          task_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_billing_charges_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_billing_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_billing_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_billing_charges_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_billing_charges_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_billing_charges_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_billing_charges_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_billing_charges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields_definitions: {
        Row: {
          created_at: string
          default_value: string | null
          deleted_at: string | null
          display_order: number | null
          dropdown_options: Json | null
          entity_type: string
          field_key: string
          field_type: string
          id: string
          is_required: boolean
          label: string
          tenant_id: string
          updated_at: string
          validation_rules: Json | null
        }
        Insert: {
          created_at?: string
          default_value?: string | null
          deleted_at?: string | null
          display_order?: number | null
          dropdown_options?: Json | null
          entity_type: string
          field_key: string
          field_type: string
          id?: string
          is_required?: boolean
          label: string
          tenant_id: string
          updated_at?: string
          validation_rules?: Json | null
        }
        Update: {
          created_at?: string
          default_value?: string | null
          deleted_at?: string | null
          display_order?: number | null
          dropdown_options?: Json | null
          entity_type?: string
          field_key?: string
          field_type?: string
          id?: string
          is_required?: boolean
          label?: string
          tenant_id?: string
          updated_at?: string
          validation_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_reports: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          data_source: string
          deleted_at: string | null
          description: string | null
          id: string
          is_shared: boolean
          is_template: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          data_source: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_shared?: boolean
          is_template?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          data_source?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_shared?: boolean
          is_template?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_ledger_entries: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          decision_key: string
          entry_type: string
          id: string
          metadata: Json
          phase: string | null
          status: string | null
          title: string | null
          version: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          decision_key: string
          entry_type: string
          id?: string
          metadata?: Json
          phase?: string | null
          status?: string | null
          title?: string | null
          version?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          decision_key?: string
          entry_type?: string
          id?: string
          metadata?: Json
          phase?: string | null
          status?: string | null
          title?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decision_ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      disposal_order_items: {
        Row: {
          created_at: string
          disposal_order_id: string
          id: string
          item_id: string
        }
        Insert: {
          created_at?: string
          disposal_order_id: string
          id?: string
          item_id: string
        }
        Update: {
          created_at?: string
          disposal_order_id?: string
          id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "disposal_order_items_disposal_order_id_fkey"
            columns: ["disposal_order_id"]
            isOneToOne: false
            referencedRelation: "disposal_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
        ]
      }
      disposal_orders: {
        Row: {
          account_id: string | null
          bill_to: string | null
          bill_to_customer_name: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          deleted_at: string | null
          disposal_method: string | null
          disposal_reason: string | null
          id: string
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          bill_to?: string | null
          bill_to_customer_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          disposal_method?: string | null
          disposal_reason?: string | null
          id?: string
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          bill_to?: string | null
          bill_to_customer_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          disposal_method?: string | null
          disposal_reason?: string | null
          id?: string
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disposal_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_orders_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_orders_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disposal_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          context_id: string | null
          context_type: string
          created_at: string | null
          created_by: string
          deleted_at: string | null
          file_name: string
          file_size: number | null
          id: string
          is_sensitive: boolean | null
          label: string | null
          mime_type: string | null
          notes: string | null
          ocr_pages: Json | null
          ocr_status: string | null
          ocr_text: string | null
          page_count: number | null
          storage_key: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          context_id?: string | null
          context_type: string
          created_at?: string | null
          created_by: string
          deleted_at?: string | null
          file_name: string
          file_size?: number | null
          id?: string
          is_sensitive?: boolean | null
          label?: string | null
          mime_type?: string | null
          notes?: string | null
          ocr_pages?: Json | null
          ocr_status?: string | null
          ocr_text?: string | null
          page_count?: number | null
          storage_key: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          context_id?: string | null
          context_type?: string
          created_at?: string | null
          created_by?: string
          deleted_at?: string | null
          file_name?: string
          file_size?: number | null
          id?: string
          is_sensitive?: boolean | null
          label?: string | null
          mime_type?: string | null
          notes?: string | null
          ocr_pages?: Json | null
          ocr_status?: string | null
          ocr_text?: string | null
          page_count?: number | null
          storage_key?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      due_date_rules: {
        Row: {
          account_id: string | null
          created_at: string | null
          days_from_creation: number
          id: string
          is_active: boolean | null
          task_type: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          days_from_creation?: number
          id?: string
          is_active?: boolean | null
          task_type: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          days_from_creation?: number
          id?: string
          is_active?: boolean | null
          task_type?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "due_date_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "due_date_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      edit_locks: {
        Row: {
          expires_at: string | null
          id: string
          locked_at: string | null
          locked_by: string
          locked_by_name: string
          resource_id: string
          resource_type: string
          tenant_id: string
        }
        Insert: {
          expires_at?: string | null
          id?: string
          locked_at?: string | null
          locked_by: string
          locked_by_name: string
          resource_id: string
          resource_type: string
          tenant_id: string
        }
        Update: {
          expires_at?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string
          locked_by_name?: string
          resource_id?: string
          resource_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edit_locks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_cleanup_logs: {
        Row: {
          attempted_at: string
          domain_name: string | null
          error_message: string | null
          id: string
          metadata: Json
          queue_id: string | null
          resend_domain_id: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          attempted_at?: string
          domain_name?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          queue_id?: string | null
          resend_domain_id?: string | null
          status: string
          tenant_id?: string | null
        }
        Update: {
          attempted_at?: string
          domain_name?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json
          queue_id?: string | null
          resend_domain_id?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_domain_cleanup_logs_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "email_domain_cleanup_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_cleanup_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_domain_cleanup_queue: {
        Row: {
          attempts: number
          domain_name: string | null
          id: string
          last_error: string | null
          metadata: Json
          processed_at: string | null
          requested_at: string
          requested_by: string | null
          resend_domain_id: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          attempts?: number
          domain_name?: string | null
          id?: string
          last_error?: string | null
          metadata?: Json
          processed_at?: string | null
          requested_at?: string
          requested_by?: string | null
          resend_domain_id?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          attempts?: number
          domain_name?: string | null
          id?: string
          last_error?: string | null
          metadata?: Json
          processed_at?: string | null
          requested_at?: string
          requested_by?: string | null
          resend_domain_id?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_domain_cleanup_queue_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_cleanup_queue_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_domain_cleanup_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          created_at: string | null
          email_type: string
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          id: string
          recipient_email: string
          recipient_name: string | null
          resend_id: string | null
          sent_at: string | null
          status: string
          subject: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          email_type: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          recipient_email: string
          recipient_name?: string | null
          resend_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          email_type?: string
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          id?: string
          recipient_email?: string
          recipient_name?: string | null
          resend_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_pay: {
        Row: {
          cost_center: string | null
          created_at: string
          id: string
          overtime_eligible: boolean
          pay_rate: number
          pay_type: string
          primary_warehouse_id: string | null
          salary_hourly_equivalent: number | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cost_center?: string | null
          created_at?: string
          id?: string
          overtime_eligible?: boolean
          pay_rate?: number
          pay_type?: string
          primary_warehouse_id?: string | null
          salary_hourly_equivalent?: number | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cost_center?: string | null
          created_at?: string
          id?: string
          overtime_eligible?: boolean
          pay_rate?: number
          pay_type?: string
          primary_warehouse_id?: string | null
          salary_hourly_equivalent?: number | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_pay_primary_warehouse_id_fkey"
            columns: ["primary_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_pay_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_pay_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_pay_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      field_suggestions: {
        Row: {
          created_at: string | null
          field_name: string
          id: string
          last_used_at: string | null
          tenant_id: string
          usage_count: number | null
          value: string
        }
        Insert: {
          created_at?: string | null
          field_name: string
          id?: string
          last_used_at?: string | null
          tenant_id: string
          usage_count?: number | null
          value: string
        }
        Update: {
          created_at?: string | null
          field_name?: string
          id?: string
          last_used_at?: string | null
          tenant_id?: string
          usage_count?: number | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_suggestions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      file_attachments: {
        Row: {
          created_at: string
          created_by: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size: number | null
          id: string
          mime_type: string | null
          storage_key: string
          storage_url: string | null
          superseded_by_attachment_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_key: string
          storage_url?: string | null
          superseded_by_attachment_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          file_size?: number | null
          id?: string
          mime_type?: string | null
          storage_key?: string
          storage_url?: string | null
          superseded_by_attachment_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_superseded_by_attachment_id_fkey"
            columns: ["superseded_by_attachment_id"]
            isOneToOne: false
            referencedRelation: "file_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      global_help_tools: {
        Row: {
          created_at: string
          created_by: string | null
          field_key: string
          help_text: string
          icon_symbol: string
          id: string
          is_active: boolean
          page_key: string
          route_path: string | null
          source_type: string
          target_selector: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          field_key: string
          help_text: string
          icon_symbol?: string
          id?: string
          is_active?: boolean
          page_key: string
          route_path?: string | null
          source_type?: string
          target_selector?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          field_key?: string
          help_text?: string
          icon_symbol?: string
          id?: string
          is_active?: boolean
          page_key?: string
          route_path?: string | null
          source_type?: string
          target_selector?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "global_help_tools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_help_tools_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_help_tools_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_help_tools_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      global_sms_consent: {
        Row: {
          consent_method: string | null
          created_at: string
          id: string
          last_keyword: string | null
          last_source: string | null
          metadata: Json
          opted_in_at: string | null
          opted_out_at: string | null
          phone_number: string
          status: string
          updated_at: string
        }
        Insert: {
          consent_method?: string | null
          created_at?: string
          id?: string
          last_keyword?: string | null
          last_source?: string | null
          metadata?: Json
          opted_in_at?: string | null
          opted_out_at?: string | null
          phone_number: string
          status?: string
          updated_at?: string
        }
        Update: {
          consent_method?: string | null
          created_at?: string
          id?: string
          last_keyword?: string | null
          last_source?: string | null
          metadata?: Json
          opted_in_at?: string | null
          opted_out_at?: string | null
          phone_number?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      global_sms_consent_log: {
        Row: {
          action: string
          consent_id: string
          created_at: string
          id: string
          keyword: string | null
          metadata: Json
          method: string | null
          new_status: string | null
          phone_number: string
          previous_status: string | null
          source: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          consent_id: string
          created_at?: string
          id?: string
          keyword?: string | null
          metadata?: Json
          method?: string | null
          new_status?: string | null
          phone_number: string
          previous_status?: string | null
          source?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          consent_id?: string
          created_at?: string
          id?: string
          keyword?: string | null
          metadata?: Json
          method?: string | null
          new_status?: string | null
          phone_number?: string
          previous_status?: string | null
          source?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "global_sms_consent_log_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "global_sms_consent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "global_sms_consent_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      guided_prompts: {
        Row: {
          archived_at: string | null
          base_prompt_id: string | null
          buttons: Json | null
          checklist_items: Json | null
          conditions: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          message: string
          min_level: string
          prompt_key: string
          prompt_type: string
          published_at: string | null
          requires_confirmation: boolean | null
          severity: string
          sort_order: number | null
          tenant_id: string | null
          tip_text: string | null
          title: string
          trigger_point: string
          updated_at: string | null
          version: number | null
          workflow: string
        }
        Insert: {
          archived_at?: string | null
          base_prompt_id?: string | null
          buttons?: Json | null
          checklist_items?: Json | null
          conditions?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          message: string
          min_level?: string
          prompt_key: string
          prompt_type: string
          published_at?: string | null
          requires_confirmation?: boolean | null
          severity?: string
          sort_order?: number | null
          tenant_id?: string | null
          tip_text?: string | null
          title: string
          trigger_point: string
          updated_at?: string | null
          version?: number | null
          workflow: string
        }
        Update: {
          archived_at?: string | null
          base_prompt_id?: string | null
          buttons?: Json | null
          checklist_items?: Json | null
          conditions?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          message?: string
          min_level?: string
          prompt_key?: string
          prompt_type?: string
          published_at?: string | null
          requires_confirmation?: boolean | null
          severity?: string
          sort_order?: number | null
          tenant_id?: string | null
          tip_text?: string | null
          title?: string
          trigger_point?: string
          updated_at?: string | null
          version?: number | null
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "guided_prompts_base_prompt_id_fkey"
            columns: ["base_prompt_id"]
            isOneToOne: false
            referencedRelation: "guided_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guided_prompts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      in_app_notifications: {
        Row: {
          action_url: string | null
          alert_queue_id: string | null
          body: string | null
          category: string
          created_at: string
          deleted_at: string | null
          expires_at: string | null
          icon: string | null
          id: string
          is_read: boolean
          notification_event_id: string | null
          priority: string
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          alert_queue_id?: string | null
          body?: string | null
          category?: string
          created_at?: string
          deleted_at?: string | null
          expires_at?: string | null
          icon?: string | null
          id?: string
          is_read?: boolean
          notification_event_id?: string | null
          priority?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          alert_queue_id?: string | null
          body?: string | null
          category?: string
          created_at?: string
          deleted_at?: string | null
          expires_at?: string | null
          icon?: string | null
          id?: string
          is_read?: boolean
          notification_event_id?: string | null
          priority?: string
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          tenant_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "in_app_notifications_alert_queue_id_fkey"
            columns: ["alert_queue_id"]
            isOneToOne: false
            referencedRelation: "alert_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "in_app_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "in_app_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "in_app_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_links: {
        Row: {
          confidence_score: number | null
          dock_intake_id: string
          id: string
          link_type: string
          linked_at: string
          linked_by: string | null
          linked_shipment_id: string
          tenant_id: string
        }
        Insert: {
          confidence_score?: number | null
          dock_intake_id: string
          id?: string
          link_type: string
          linked_at?: string
          linked_by?: string | null
          linked_shipment_id: string
          tenant_id: string
        }
        Update: {
          confidence_score?: number | null
          dock_intake_id?: string
          id?: string
          link_type?: string
          linked_at?: string
          linked_by?: string | null
          linked_shipment_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_links_dock_intake_id_fkey"
            columns: ["dock_intake_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_links_dock_intake_id_fkey"
            columns: ["dock_intake_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_links_linked_shipment_id_fkey"
            columns: ["linked_shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_links_linked_shipment_id_fkey"
            columns: ["linked_shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_column_configs: {
        Row: {
          account_id: string | null
          column_key: string
          column_width: number | null
          created_at: string | null
          data_type: string | null
          display_label: string
          id: string
          is_required: boolean | null
          is_visible: boolean | null
          sort_order: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          column_key: string
          column_width?: number | null
          created_at?: string | null
          data_type?: string | null
          display_label: string
          id?: string
          is_required?: boolean | null
          is_visible?: boolean | null
          sort_order?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          column_key?: string
          column_width?: number | null
          created_at?: string | null
          data_type?: string | null
          display_label?: string
          id?: string
          is_required?: boolean | null
          is_visible?: boolean | null
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_column_configs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_column_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          container_id: string | null
          created_at: string
          created_by: string | null
          from_location_id: string | null
          id: string
          movement_type: string
          tenant_id: string
          to_location_id: string | null
          unit_id: string
        }
        Insert: {
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          movement_type: string
          tenant_id: string
          to_location_id?: string | null
          unit_id: string
        }
        Update: {
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          from_location_id?: string | null
          id?: string
          movement_type?: string
          tenant_id?: string
          to_location_id?: string | null
          unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_units: {
        Row: {
          account_id: string
          class: string | null
          container_id: string | null
          created_at: string
          created_by: string | null
          dims_h: number | null
          dims_l: number | null
          dims_w: number | null
          ic_code: string
          id: string
          location_id: string
          shipment_id: string | null
          shipment_item_id: string | null
          status: string
          tenant_id: string
          unit_cu_ft: number | null
          updated_at: string
          updated_by: string | null
          volume_source: string | null
        }
        Insert: {
          account_id: string
          class?: string | null
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          dims_h?: number | null
          dims_l?: number | null
          dims_w?: number | null
          ic_code: string
          id?: string
          location_id: string
          shipment_id?: string | null
          shipment_item_id?: string | null
          status?: string
          tenant_id: string
          unit_cu_ft?: number | null
          updated_at?: string
          updated_by?: string | null
          volume_source?: string | null
        }
        Update: {
          account_id?: string
          class?: string | null
          container_id?: string | null
          created_at?: string
          created_by?: string | null
          dims_h?: number | null
          dims_l?: number | null
          dims_w?: number | null
          ic_code?: string
          id?: string
          location_id?: string
          shipment_id?: string | null
          shipment_item_id?: string | null
          status?: string
          tenant_id?: string
          unit_cu_ft?: number | null
          updated_at?: string
          updated_by?: string | null
          volume_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_units_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_units_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_units_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_units_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_units_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_units_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_units_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          next_number: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          next_number?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          next_number?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_line_items: {
        Row: {
          account_code: string | null
          created_at: string | null
          description: string
          id: string
          invoice_id: string
          item_code: string | null
          item_id: string | null
          line_item_type: string
          line_total: number
          quantity: number | null
          service_date: string | null
          service_type: string | null
          sort_order: number | null
          task_id: string | null
          task_item_id: string | null
          unit_price: number
        }
        Insert: {
          account_code?: string | null
          created_at?: string | null
          description: string
          id?: string
          invoice_id: string
          item_code?: string | null
          item_id?: string | null
          line_item_type: string
          line_total: number
          quantity?: number | null
          service_date?: string | null
          service_type?: string | null
          sort_order?: number | null
          task_id?: string | null
          task_item_id?: string | null
          unit_price: number
        }
        Update: {
          account_code?: string | null
          created_at?: string | null
          description?: string
          id?: string
          invoice_id?: string
          item_code?: string | null
          item_id?: string | null
          line_item_type?: string
          line_total?: number
          quantity?: number | null
          service_date?: string | null
          service_type?: string | null
          sort_order?: number | null
          task_id?: string | null
          task_item_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_task_item_id_fkey"
            columns: ["task_item_id"]
            isOneToOne: false
            referencedRelation: "task_items"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          billing_event_id: string | null
          charge_type: string | null
          created_at: string | null
          description: string
          id: string
          invoice_id: string
          is_taxable: boolean | null
          item_id: string | null
          line_order: number | null
          occurred_at: string | null
          quantity: number | null
          service_id: string | null
          sidemark_name: string | null
          subtotal: number | null
          task_id: string | null
          tax_amount: number | null
          tax_rate: number | null
          tenant_id: string
          total_amount: number
          unit_rate: number
        }
        Insert: {
          billing_event_id?: string | null
          charge_type?: string | null
          created_at?: string | null
          description: string
          id?: string
          invoice_id: string
          is_taxable?: boolean | null
          item_id?: string | null
          line_order?: number | null
          occurred_at?: string | null
          quantity?: number | null
          service_id?: string | null
          sidemark_name?: string | null
          subtotal?: number | null
          task_id?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          tenant_id: string
          total_amount?: number
          unit_rate?: number
        }
        Update: {
          billing_event_id?: string | null
          charge_type?: string | null
          created_at?: string | null
          description?: string
          id?: string
          invoice_id?: string
          is_taxable?: boolean | null
          item_id?: string | null
          line_order?: number | null
          occurred_at?: string | null
          quantity?: number | null
          service_id?: string | null
          sidemark_name?: string | null
          subtotal?: number | null
          task_id?: string | null
          tax_amount?: number | null
          tax_rate?: number | null
          tenant_id?: string
          total_amount?: number
          unit_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_billing_event_id_fkey"
            columns: ["billing_event_id"]
            isOneToOne: false
            referencedRelation: "billing_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "billable_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          credit_application_id: string | null
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: string
          payment_reference: string | null
          tenant_id: string
          voided_at: string | null
          voided_by: string | null
          voided_reason: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          credit_application_id?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          payment_date?: string
          payment_method: string
          payment_reference?: string | null
          tenant_id: string
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          credit_application_id?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string
          payment_reference?: string | null
          tenant_id?: string
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_credit_application_id_fkey"
            columns: ["credit_application_id"]
            isOneToOne: false
            referencedRelation: "credit_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_templates: {
        Row: {
          created_at: string
          created_by: string | null
          css_content: string | null
          description: string | null
          html_content: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          settings: Json
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          css_content?: string | null
          description?: string | null
          html_content: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          settings?: Json
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          css_content?: string | null
          description?: string | null
          html_content?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          settings?: Json
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          account_id: string
          batch_id: string | null
          created_at: string | null
          created_by: string | null
          credits_applied: number | null
          discount_amount: number | null
          due_date: string | null
          group_by: string | null
          id: string
          invoice_date: string
          invoice_number: string
          marked_paid_at: string | null
          marked_paid_by: string | null
          notes: string | null
          paid_amount: number | null
          paid_date: string | null
          payment_date: string | null
          payment_method: string | null
          payment_notes: string | null
          payment_reference: string | null
          payment_status: string | null
          period_end: string | null
          period_start: string | null
          qbo_invoice_id: string | null
          qbo_sync_status: string | null
          qbo_synced_at: string | null
          sidemark_id: string | null
          sort_by: string | null
          status: string | null
          storage_through_date: string | null
          subtotal: number | null
          tax_amount: number | null
          tax_rate: number | null
          tenant_id: string
          terms: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          batch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          credits_applied?: number | null
          discount_amount?: number | null
          due_date?: string | null
          group_by?: string | null
          id?: string
          invoice_date?: string
          invoice_number: string
          marked_paid_at?: string | null
          marked_paid_by?: string | null
          notes?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_notes?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          period_end?: string | null
          period_start?: string | null
          qbo_invoice_id?: string | null
          qbo_sync_status?: string | null
          qbo_synced_at?: string | null
          sidemark_id?: string | null
          sort_by?: string | null
          status?: string | null
          storage_through_date?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          tenant_id: string
          terms?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          batch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          credits_applied?: number | null
          discount_amount?: number | null
          due_date?: string | null
          group_by?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          marked_paid_at?: string | null
          marked_paid_by?: string | null
          notes?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_notes?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          period_end?: string | null
          period_start?: string | null
          qbo_invoice_id?: string | null
          qbo_sync_status?: string | null
          qbo_synced_at?: string | null
          sidemark_id?: string | null
          sort_by?: string | null
          status?: string | null
          storage_through_date?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          tenant_id?: string
          terms?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sidemark_id_fkey"
            columns: ["sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_activity: {
        Row: {
          actor_name: string | null
          actor_user_id: string | null
          created_at: string
          details: Json
          event_label: string
          event_type: string
          id: string
          item_id: string
          tenant_id: string
        }
        Insert: {
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_label: string
          event_type: string
          id?: string
          item_id: string
          tenant_id: string
        }
        Update: {
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_label?: string
          event_type?: string
          id?: string
          item_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_activity_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_activity_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
        ]
      }
      item_additional_charges: {
        Row: {
          charge_amount: number
          charge_description: string | null
          charge_name: string
          charge_type: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          item_id: string
          updated_at: string | null
        }
        Insert: {
          charge_amount: number
          charge_description?: string | null
          charge_name: string
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          item_id: string
          updated_at?: string | null
        }
        Update: {
          charge_amount?: number
          charge_description?: string | null
          charge_name?: string
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          item_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_additional_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_additional_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_additional_charges_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_additional_charges_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
        ]
      }
      item_audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          field_changed: string | null
          id: string
          item_id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          field_changed?: string | null
          id?: string
          item_id: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          field_changed?: string | null
          id?: string
          item_id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_audit_log_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_audit_log_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_custom_charges: {
        Row: {
          charge_amount: number
          charge_description: string | null
          charge_name: string
          created_at: string | null
          created_by: string | null
          id: string
          item_id: string
          tenant_id: string
        }
        Insert: {
          charge_amount: number
          charge_description?: string | null
          charge_name: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          item_id: string
          tenant_id: string
        }
        Update: {
          charge_amount?: number
          charge_description?: string | null
          charge_name?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          item_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_custom_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_custom_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_custom_charges_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_custom_charges_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_custom_charges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_custom_field_values: {
        Row: {
          created_at: string
          custom_field_id: string | null
          deleted_at: string | null
          field_key: string
          id: string
          item_id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          custom_field_id?: string | null
          deleted_at?: string | null
          field_key: string
          id?: string
          item_id: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          custom_field_id?: string | null
          deleted_at?: string | null
          field_key?: string
          id?: string
          item_id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_custom_field_values_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "tenant_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_custom_field_values_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_custom_field_values_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
        ]
      }
      item_flags: {
        Row: {
          charge_type_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          item_id: string
          service_code: string
          tenant_id: string
        }
        Insert: {
          charge_type_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          item_id: string
          service_code: string
          tenant_id: string
        }
        Update: {
          charge_type_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          item_id?: string
          service_code?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_flags_charge_type_id_fkey"
            columns: ["charge_type_id"]
            isOneToOne: false
            referencedRelation: "charge_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_flags_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_flags_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
        ]
      }
      item_notes: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          is_current: boolean | null
          item_id: string
          note: string
          note_type: string | null
          parent_note_id: string | null
          tenant_id: string | null
          updated_at: string
          version: number | null
          visibility: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          is_current?: boolean | null
          item_id: string
          note: string
          note_type?: string | null
          parent_note_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          version?: number | null
          visibility?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          is_current?: boolean | null
          item_id?: string
          note?: string
          note_type?: string | null
          parent_note_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          version?: number | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_notes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_notes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_notes_parent_note_id_fkey"
            columns: ["parent_note_id"]
            isOneToOne: false
            referencedRelation: "item_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      item_photos: {
        Row: {
          caption: string | null
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          is_primary: boolean | null
          is_repair: boolean
          item_id: string
          mime_type: string | null
          needs_attention: boolean | null
          photo_type: string | null
          storage_key: string
          storage_url: string | null
          tenant_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          is_primary?: boolean | null
          is_repair?: boolean
          item_id: string
          mime_type?: string | null
          needs_attention?: boolean | null
          photo_type?: string | null
          storage_key: string
          storage_url?: string | null
          tenant_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          is_primary?: boolean | null
          is_repair?: boolean
          item_id?: string
          mime_type?: string | null
          needs_attention?: boolean | null
          photo_type?: string | null
          storage_key?: string
          storage_url?: string | null
          tenant_id?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_photos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_photos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
        ]
      }
      item_types: {
        Row: {
          allow_on_order_entry: boolean | null
          allow_on_reservation: boolean | null
          assemblies_in_base_rate: number | null
          auto_add_assembly_fee: boolean | null
          billing_pieces: number | null
          crated_rate: number | null
          created_at: string | null
          created_by: string | null
          cubic_feet: number | null
          custom_packaging_rate: number | null
          default_item_notes: string | null
          deleted_at: string | null
          delivery_pieces: number | null
          dimension_unit: string | null
          disposal_rate: number | null
          extra_fee: number | null
          felt_pad_price: number | null
          height: number | null
          id: string
          is_active: boolean | null
          length: number | null
          minutes_per_felt_pad: number | null
          minutes_to_assemble: number | null
          minutes_to_deliver: number | null
          minutes_to_inspect: number | null
          minutes_to_load: number | null
          minutes_to_move: number | null
          minutes_to_put_in_warehouse: number | null
          model_number: string | null
          move_rate: number | null
          name: string
          notify_dispatch: boolean | null
          oversize_rate: number | null
          overweight_rate: number | null
          packing_rate: number | null
          pallet_sale_rate: number | null
          people_to_deliver: number | null
          picking_rate: number | null
          pull_for_delivery_rate: number | null
          received_without_id_rate: number | null
          removal_rate: number | null
          same_day_assembly_rate: number | null
          sort_order: number | null
          storage_billing_frequency: string | null
          storage_rate: number | null
          storage_rate_per_day: number | null
          tenant_id: string
          unstackable_extra_fee: number | null
          updated_at: string | null
          weight: number | null
          weight_unit: string | null
          width: number | null
          will_call_rate: number | null
        }
        Insert: {
          allow_on_order_entry?: boolean | null
          allow_on_reservation?: boolean | null
          assemblies_in_base_rate?: number | null
          auto_add_assembly_fee?: boolean | null
          billing_pieces?: number | null
          crated_rate?: number | null
          created_at?: string | null
          created_by?: string | null
          cubic_feet?: number | null
          custom_packaging_rate?: number | null
          default_item_notes?: string | null
          deleted_at?: string | null
          delivery_pieces?: number | null
          dimension_unit?: string | null
          disposal_rate?: number | null
          extra_fee?: number | null
          felt_pad_price?: number | null
          height?: number | null
          id?: string
          is_active?: boolean | null
          length?: number | null
          minutes_per_felt_pad?: number | null
          minutes_to_assemble?: number | null
          minutes_to_deliver?: number | null
          minutes_to_inspect?: number | null
          minutes_to_load?: number | null
          minutes_to_move?: number | null
          minutes_to_put_in_warehouse?: number | null
          model_number?: string | null
          move_rate?: number | null
          name: string
          notify_dispatch?: boolean | null
          oversize_rate?: number | null
          overweight_rate?: number | null
          packing_rate?: number | null
          pallet_sale_rate?: number | null
          people_to_deliver?: number | null
          picking_rate?: number | null
          pull_for_delivery_rate?: number | null
          received_without_id_rate?: number | null
          removal_rate?: number | null
          same_day_assembly_rate?: number | null
          sort_order?: number | null
          storage_billing_frequency?: string | null
          storage_rate?: number | null
          storage_rate_per_day?: number | null
          tenant_id: string
          unstackable_extra_fee?: number | null
          updated_at?: string | null
          weight?: number | null
          weight_unit?: string | null
          width?: number | null
          will_call_rate?: number | null
        }
        Update: {
          allow_on_order_entry?: boolean | null
          allow_on_reservation?: boolean | null
          assemblies_in_base_rate?: number | null
          auto_add_assembly_fee?: boolean | null
          billing_pieces?: number | null
          crated_rate?: number | null
          created_at?: string | null
          created_by?: string | null
          cubic_feet?: number | null
          custom_packaging_rate?: number | null
          default_item_notes?: string | null
          deleted_at?: string | null
          delivery_pieces?: number | null
          dimension_unit?: string | null
          disposal_rate?: number | null
          extra_fee?: number | null
          felt_pad_price?: number | null
          height?: number | null
          id?: string
          is_active?: boolean | null
          length?: number | null
          minutes_per_felt_pad?: number | null
          minutes_to_assemble?: number | null
          minutes_to_deliver?: number | null
          minutes_to_inspect?: number | null
          minutes_to_load?: number | null
          minutes_to_move?: number | null
          minutes_to_put_in_warehouse?: number | null
          model_number?: string | null
          move_rate?: number | null
          name?: string
          notify_dispatch?: boolean | null
          oversize_rate?: number | null
          overweight_rate?: number | null
          packing_rate?: number | null
          pallet_sale_rate?: number | null
          people_to_deliver?: number | null
          picking_rate?: number | null
          pull_for_delivery_rate?: number | null
          received_without_id_rate?: number | null
          removal_rate?: number | null
          same_day_assembly_rate?: number | null
          sort_order?: number | null
          storage_billing_frequency?: string | null
          storage_rate?: number | null
          storage_rate_per_day?: number | null
          tenant_id?: string
          unstackable_extra_fee?: number | null
          updated_at?: string | null
          weight?: number | null
          weight_unit?: string | null
          width?: number | null
          will_call_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "item_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_types_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          account_id: string | null
          assembly_status: string | null
          assembly_tier_id: string | null
          category: string | null
          class_id: string | null
          client_account: string | null
          condition: string | null
          coverage_deductible: number | null
          coverage_rate: number | null
          coverage_selected_at: string | null
          coverage_selected_by: string | null
          coverage_source: string | null
          coverage_type: string | null
          created_at: string
          current_location: string | null
          current_location_id: string | null
          declared_value: number | null
          deleted_at: string | null
          description: string | null
          has_damage: boolean | null
          id: string
          inspection_photos: Json | null
          inspection_status: string | null
          is_crated: boolean | null
          is_oversize: boolean | null
          is_overweight: boolean | null
          is_unstackable: boolean | null
          item_code: string
          item_type_id: string | null
          last_storage_invoiced_through: string | null
          link: string | null
          location_id: string | null
          metadata: Json | null
          minor_touchup_status: string | null
          needs_inspection: boolean | null
          needs_minor_touchup: boolean | null
          needs_repair: boolean | null
          needs_warehouse_assembly: boolean | null
          notify_dispatch: boolean | null
          photo_urls: Json | null
          photos: Json | null
          primary_photo_url: string | null
          quantity: number
          received_at: string | null
          received_date: string | null
          received_without_id: boolean | null
          receiving_shipment_id: string | null
          released_at: string | null
          released_date: string | null
          repair_photos: Json | null
          repair_status: string | null
          room: string | null
          sidemark: string | null
          sidemark_id: string | null
          size: number | null
          size_unit: string | null
          sku: string | null
          status: string
          tenant_id: string
          updated_at: string
          vendor: string | null
          warehouse_id: string
          weight_lbs: number | null
        }
        Insert: {
          account_id?: string | null
          assembly_status?: string | null
          assembly_tier_id?: string | null
          category?: string | null
          class_id?: string | null
          client_account?: string | null
          condition?: string | null
          coverage_deductible?: number | null
          coverage_rate?: number | null
          coverage_selected_at?: string | null
          coverage_selected_by?: string | null
          coverage_source?: string | null
          coverage_type?: string | null
          created_at?: string
          current_location?: string | null
          current_location_id?: string | null
          declared_value?: number | null
          deleted_at?: string | null
          description?: string | null
          has_damage?: boolean | null
          id?: string
          inspection_photos?: Json | null
          inspection_status?: string | null
          is_crated?: boolean | null
          is_oversize?: boolean | null
          is_overweight?: boolean | null
          is_unstackable?: boolean | null
          item_code: string
          item_type_id?: string | null
          last_storage_invoiced_through?: string | null
          link?: string | null
          location_id?: string | null
          metadata?: Json | null
          minor_touchup_status?: string | null
          needs_inspection?: boolean | null
          needs_minor_touchup?: boolean | null
          needs_repair?: boolean | null
          needs_warehouse_assembly?: boolean | null
          notify_dispatch?: boolean | null
          photo_urls?: Json | null
          photos?: Json | null
          primary_photo_url?: string | null
          quantity?: number
          received_at?: string | null
          received_date?: string | null
          received_without_id?: boolean | null
          receiving_shipment_id?: string | null
          released_at?: string | null
          released_date?: string | null
          repair_photos?: Json | null
          repair_status?: string | null
          room?: string | null
          sidemark?: string | null
          sidemark_id?: string | null
          size?: number | null
          size_unit?: string | null
          sku?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vendor?: string | null
          warehouse_id: string
          weight_lbs?: number | null
        }
        Update: {
          account_id?: string | null
          assembly_status?: string | null
          assembly_tier_id?: string | null
          category?: string | null
          class_id?: string | null
          client_account?: string | null
          condition?: string | null
          coverage_deductible?: number | null
          coverage_rate?: number | null
          coverage_selected_at?: string | null
          coverage_selected_by?: string | null
          coverage_source?: string | null
          coverage_type?: string | null
          created_at?: string
          current_location?: string | null
          current_location_id?: string | null
          declared_value?: number | null
          deleted_at?: string | null
          description?: string | null
          has_damage?: boolean | null
          id?: string
          inspection_photos?: Json | null
          inspection_status?: string | null
          is_crated?: boolean | null
          is_oversize?: boolean | null
          is_overweight?: boolean | null
          is_unstackable?: boolean | null
          item_code?: string
          item_type_id?: string | null
          last_storage_invoiced_through?: string | null
          link?: string | null
          location_id?: string | null
          metadata?: Json | null
          minor_touchup_status?: string | null
          needs_inspection?: boolean | null
          needs_minor_touchup?: boolean | null
          needs_repair?: boolean | null
          needs_warehouse_assembly?: boolean | null
          notify_dispatch?: boolean | null
          photo_urls?: Json | null
          photos?: Json | null
          primary_photo_url?: string | null
          quantity?: number
          received_at?: string | null
          received_date?: string | null
          received_without_id?: boolean | null
          receiving_shipment_id?: string | null
          released_at?: string | null
          released_date?: string | null
          repair_photos?: Json | null
          repair_status?: string | null
          room?: string | null
          sidemark?: string | null
          sidemark_id?: string | null
          size?: number | null
          size_unit?: string | null
          sku?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vendor?: string | null
          warehouse_id?: string
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_receiving_shipment_id_fkey"
            columns: ["receiving_shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_receiving_shipment_id_fkey"
            columns: ["receiving_shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_sidemark_id_fkey"
            columns: ["sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      job_time_intervals: {
        Row: {
          created_at: string
          ended_at: string | null
          ended_reason: string | null
          id: string
          job_id: string
          job_type: string
          started_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          job_id: string
          job_type: string
          started_at?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          job_id?: string
          job_type?: string
          started_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_time_intervals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_time_intervals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_time_intervals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_settings: {
        Row: {
          created_at: string
          currency_code: string
          id: string
          overtime_multiplier: number
          rounding_rule_minutes: number
          standard_workweek_hours: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code?: string
          id?: string
          overtime_multiplier?: number
          rounding_rule_minutes?: number
          standard_workweek_hours?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string
          id?: string
          overtime_multiplier?: number
          rounding_rule_minutes?: number
          standard_workweek_hours?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "labor_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      location_capacity_cache: {
        Row: {
          available_cuft: number
          location_id: string
          updated_at: string
          used_cuft: number
          utilization_pct: number
        }
        Insert: {
          available_cuft?: number
          location_id: string
          updated_at?: string
          used_cuft?: number
          utilization_pct?: number
        }
        Update: {
          available_cuft?: number
          location_id?: string
          updated_at?: string
          used_cuft?: number
          utilization_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "location_capacity_cache_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_flag_links: {
        Row: {
          charge_type_id: string | null
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          service_code: string
          tenant_id: string
        }
        Insert: {
          charge_type_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          service_code: string
          tenant_id: string
        }
        Update: {
          charge_type_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          service_code?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_flag_links_charge_type_id_fkey"
            columns: ["charge_type_id"]
            isOneToOne: false
            referencedRelation: "charge_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_flag_links_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          capacity: number | null
          capacity_cu_ft: number | null
          capacity_cuft: number | null
          capacity_sq_ft: number | null
          code: string
          created_at: string
          current_utilization: number | null
          deleted_at: string | null
          group_code: string | null
          id: string
          is_active: boolean | null
          length_in: number | null
          location_type: string | null
          metadata: Json | null
          name: string | null
          parent_location_id: string | null
          status: string
          type: string
          updated_at: string
          usable_height_in: number | null
          warehouse_id: string
          width_in: number | null
          zone_id: string | null
        }
        Insert: {
          capacity?: number | null
          capacity_cu_ft?: number | null
          capacity_cuft?: number | null
          capacity_sq_ft?: number | null
          code: string
          created_at?: string
          current_utilization?: number | null
          deleted_at?: string | null
          group_code?: string | null
          id?: string
          is_active?: boolean | null
          length_in?: number | null
          location_type?: string | null
          metadata?: Json | null
          name?: string | null
          parent_location_id?: string | null
          status?: string
          type: string
          updated_at?: string
          usable_height_in?: number | null
          warehouse_id: string
          width_in?: number | null
          zone_id?: string | null
        }
        Update: {
          capacity?: number | null
          capacity_cu_ft?: number | null
          capacity_cuft?: number | null
          capacity_sq_ft?: number | null
          code?: string
          created_at?: string
          current_utilization?: number | null
          deleted_at?: string | null
          group_code?: string | null
          id?: string
          is_active?: boolean | null
          length_in?: number | null
          location_type?: string | null
          metadata?: Json | null
          name?: string | null
          parent_location_id?: string | null
          status?: string
          type?: string
          updated_at?: string
          usable_height_in?: number | null
          warehouse_id?: string
          width_in?: number | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "locations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "warehouse_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      message_recipients: {
        Row: {
          archived_at: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_archived: boolean
          is_read: boolean
          message_id: string
          read_at: string | null
          recipient_id: string
          recipient_type: string
          user_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_archived?: boolean
          is_read?: boolean
          message_id: string
          read_at?: string | null
          recipient_id: string
          recipient_type: string
          user_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_archived?: boolean
          is_read?: boolean
          message_id?: string
          read_at?: string | null
          recipient_id?: string
          recipient_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "message_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_recipients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_recipients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          message_type: string
          metadata: Json | null
          priority: string
          related_entity_id: string | null
          related_entity_type: string | null
          sender_id: string
          subject: string
          tenant_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          message_type?: string
          metadata?: Json | null
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sender_id: string
          subject: string
          tenant_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          message_type?: string
          metadata?: Json | null
          priority?: string
          related_entity_id?: string | null
          related_entity_type?: string | null
          sender_id?: string
          subject?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      movements: {
        Row: {
          action_type: string
          actor_id: string | null
          actor_type: string
          batch_id: string | null
          created_at: string
          from_location_id: string | null
          id: string
          item_id: string
          metadata: Json | null
          moved_at: string
          note: string | null
          quantity: number | null
          tenant_id: string | null
          to_location_id: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          actor_type: string
          batch_id?: string | null
          created_at?: string
          from_location_id?: string | null
          id?: string
          item_id: string
          metadata?: Json | null
          moved_at?: string
          note?: string | null
          quantity?: number | null
          tenant_id?: string | null
          to_location_id?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          actor_type?: string
          batch_id?: string | null
          created_at?: string
          from_location_id?: string | null
          id?: string
          item_id?: string
          metadata?: Json | null
          moved_at?: string
          note?: string | null
          quantity?: number | null
          tenant_id?: string | null
          to_location_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      note_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          after_note: string | null
          before_note: string | null
          created_at: string
          id: string
          metadata: Json
          note_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_note?: string | null
          before_note?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_note?: string | null
          before_note?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_audit_log_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      note_entity_links: {
        Row: {
          created_at: string
          entity_id: string
          entity_number: string | null
          entity_type: string
          id: string
          link_kind: string
          note_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_number?: string | null
          entity_type: string
          id?: string
          link_kind?: string
          note_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_number?: string | null
          entity_type?: string
          id?: string
          link_kind?: string
          note_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_entity_links_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_entity_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      note_mentions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          mention_username: string
          mentioned_user_id: string
          note_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          mention_username: string
          mentioned_user_id: string
          note_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          mention_username?: string
          mentioned_user_id?: string
          note_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_mentions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "note_mentions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          metadata: Json
          note: string
          note_type: string
          parent_note_id: string | null
          root_note_id: string | null
          source_entity_id: string
          source_entity_number: string | null
          source_entity_type: string
          tenant_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          metadata?: Json
          note: string
          note_type?: string
          parent_note_id?: string | null
          root_note_id?: string | null
          source_entity_id: string
          source_entity_number?: string | null
          source_entity_type: string
          tenant_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          metadata?: Json
          note?: string
          note_type?: string
          parent_note_id?: string | null
          root_note_id?: string | null
          source_entity_id?: string
          source_entity_number?: string | null
          source_entity_type?: string
          tenant_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_parent_note_id_fkey"
            columns: ["parent_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_root_note_id_fkey"
            columns: ["root_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          alert_type_id: string
          body_rendered_html: string
          body_rendered_text: string
          created_at: string
          entity_id: string
          entity_type: string
          error_message: string | null
          id: string
          last_retry_at: string | null
          next_retry_at: string | null
          provider: string
          provider_message_id: string | null
          provider_response: Json | null
          retry_count: number | null
          sent_at: string | null
          status: string
          subject_rendered: string
          tenant_id: string
          to_email: string
        }
        Insert: {
          alert_type_id: string
          body_rendered_html: string
          body_rendered_text: string
          created_at?: string
          entity_id: string
          entity_type: string
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          next_retry_at?: string | null
          provider: string
          provider_message_id?: string | null
          provider_response?: Json | null
          retry_count?: number | null
          sent_at?: string | null
          status: string
          subject_rendered: string
          tenant_id: string
          to_email: string
        }
        Update: {
          alert_type_id?: string
          body_rendered_html?: string
          body_rendered_text?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          next_retry_at?: string | null
          provider?: string
          provider_message_id?: string | null
          provider_response?: Json | null
          retry_count?: number | null
          sent_at?: string | null
          status?: string
          subject_rendered?: string
          tenant_id?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_alert_type_id_fkey"
            columns: ["alert_type_id"]
            isOneToOne: false
            referencedRelation: "alert_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          alert_type_id: string
          created_at: string
          entity_id: string
          entity_type: string
          event_payload: Json
          id: string
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          alert_type_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          event_payload: Json
          id?: string
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          alert_type_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          event_payload?: Json
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_alert_type_id_fkey"
            columns: ["alert_type_id"]
            isOneToOne: false
            referencedRelation: "alert_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_claim_settings: {
        Row: {
          acceptance_token_expiry_days: number | null
          approval_required_above_threshold: boolean | null
          approval_threshold_amount: number | null
          auto_approval_threshold: number | null
          auto_create_repair_task: boolean | null
          claim_assistance_flat_fee: number | null
          coverage_allow_item: boolean | null
          coverage_allow_shipment: boolean | null
          coverage_deductible_amount: number | null
          coverage_default_type: string | null
          coverage_display_name: string
          coverage_enabled: boolean | null
          coverage_min_declared_value: number | null
          coverage_rate_full_deductible: number | null
          coverage_rate_full_no_deductible: number | null
          coverage_rate_standard: number
          created_at: string | null
          default_payout_method: string | null
          enable_ai_analysis: boolean | null
          enable_claim_assistance: boolean | null
          enable_sla_tracking: boolean | null
          id: string
          settlement_terms_template: string | null
          sla_ack_minutes: number | null
          sla_auto_approved_payout_hours: number | null
          sla_initial_review_business_hours: number | null
          sla_manual_review_business_hours: number | null
          sla_missing_docs_pause: boolean | null
          sla_public_report_business_hours: number | null
          sla_shipping_damage_packet_business_hours: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          acceptance_token_expiry_days?: number | null
          approval_required_above_threshold?: boolean | null
          approval_threshold_amount?: number | null
          auto_approval_threshold?: number | null
          auto_create_repair_task?: boolean | null
          claim_assistance_flat_fee?: number | null
          coverage_allow_item?: boolean | null
          coverage_allow_shipment?: boolean | null
          coverage_deductible_amount?: number | null
          coverage_default_type?: string | null
          coverage_display_name?: string
          coverage_enabled?: boolean | null
          coverage_min_declared_value?: number | null
          coverage_rate_full_deductible?: number | null
          coverage_rate_full_no_deductible?: number | null
          coverage_rate_standard?: number
          created_at?: string | null
          default_payout_method?: string | null
          enable_ai_analysis?: boolean | null
          enable_claim_assistance?: boolean | null
          enable_sla_tracking?: boolean | null
          id?: string
          settlement_terms_template?: string | null
          sla_ack_minutes?: number | null
          sla_auto_approved_payout_hours?: number | null
          sla_initial_review_business_hours?: number | null
          sla_manual_review_business_hours?: number | null
          sla_missing_docs_pause?: boolean | null
          sla_public_report_business_hours?: number | null
          sla_shipping_damage_packet_business_hours?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          acceptance_token_expiry_days?: number | null
          approval_required_above_threshold?: boolean | null
          approval_threshold_amount?: number | null
          auto_approval_threshold?: number | null
          auto_create_repair_task?: boolean | null
          claim_assistance_flat_fee?: number | null
          coverage_allow_item?: boolean | null
          coverage_allow_shipment?: boolean | null
          coverage_deductible_amount?: number | null
          coverage_default_type?: string | null
          coverage_display_name?: string
          coverage_enabled?: boolean | null
          coverage_min_declared_value?: number | null
          coverage_rate_full_deductible?: number | null
          coverage_rate_full_no_deductible?: number | null
          coverage_rate_standard?: number
          created_at?: string | null
          default_payout_method?: string | null
          enable_ai_analysis?: boolean | null
          enable_claim_assistance?: boolean | null
          enable_sla_tracking?: boolean | null
          id?: string
          settlement_terms_template?: string | null
          sla_ack_minutes?: number | null
          sla_auto_approved_payout_hours?: number | null
          sla_initial_review_business_hours?: number | null
          sla_manual_review_business_hours?: number | null
          sla_missing_docs_pause?: boolean | null
          sla_public_report_business_hours?: number | null
          sla_shipping_damage_packet_business_hours?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_claim_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_types: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          sort_order: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          sort_order?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_alert_template_library: {
        Row: {
          body_format: string
          body_template: string
          channel: string
          created_at: string
          created_by: string | null
          editor_json: Json | null
          id: string
          is_active: boolean
          subject_template: string | null
          trigger_event: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body_format?: string
          body_template: string
          channel: string
          created_at?: string
          created_by?: string | null
          editor_json?: Json | null
          id?: string
          is_active?: boolean
          subject_template?: string | null
          trigger_event: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body_format?: string
          body_template?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          editor_json?: Json | null
          id?: string
          is_active?: boolean
          subject_template?: string | null
          trigger_event?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_alert_template_library_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_alert_template_library_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_alert_template_library_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_alert_template_library_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_email_settings: {
        Row: {
          created_at: string
          created_by: string | null
          default_from_email: string
          default_from_name: string | null
          default_reply_to_email: string | null
          fallback_sender_domain: string | null
          id: number
          is_active: boolean
          outbound_fallback_provider: string
          outbound_primary_provider: string
          updated_at: string
          updated_by: string | null
          wrapper_html_template: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_from_email: string
          default_from_name?: string | null
          default_reply_to_email?: string | null
          fallback_sender_domain?: string | null
          id?: number
          is_active?: boolean
          outbound_fallback_provider?: string
          outbound_primary_provider?: string
          updated_at?: string
          updated_by?: string | null
          wrapper_html_template?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_from_email?: string
          default_from_name?: string | null
          default_reply_to_email?: string | null
          fallback_sender_domain?: string | null
          id?: number
          is_active?: boolean
          outbound_fallback_provider?: string
          outbound_primary_provider?: string
          updated_at?: string
          updated_by?: string | null
          wrapper_html_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_email_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_email_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_email_wrapper_versions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
          wrapper_html_template: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
          wrapper_html_template: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
          wrapper_html_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_email_wrapper_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_email_wrapper_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_email_wrapper_versions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_email_wrapper_versions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_inbound_email_settings: {
        Row: {
          created_at: string
          created_by: string | null
          id: number
          is_active: boolean
          provider: string
          reply_domain: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: number
          is_active?: boolean
          provider?: string
          reply_domain?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: number
          is_active?: boolean
          provider?: string
          reply_domain?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_inbound_email_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_inbound_email_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_inbound_email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_inbound_email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_template_rollout_audit: {
        Row: {
          action: string
          channel: string | null
          created_at: string
          created_by: string | null
          details: Json
          id: string
          rollout_id: string
          tenant_id: string | null
          trigger_event: string | null
        }
        Insert: {
          action: string
          channel?: string | null
          created_at?: string
          created_by?: string | null
          details?: Json
          id?: string
          rollout_id: string
          tenant_id?: string | null
          trigger_event?: string | null
        }
        Update: {
          action?: string
          channel?: string | null
          created_at?: string
          created_by?: string | null
          details?: Json
          id?: string
          rollout_id?: string
          tenant_id?: string | null
          trigger_event?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_template_rollout_audit_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_template_rollout_audit_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_template_rollout_audit_rollout_id_fkey"
            columns: ["rollout_id"]
            isOneToOne: false
            referencedRelation: "platform_template_rollouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_template_rollout_audit_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_template_rollouts: {
        Row: {
          allow_tenant_opt_out: boolean
          created_at: string
          created_by: string | null
          id: string
          include_triggers: string[] | null
          is_security_critical: boolean
          launched_at: string | null
          name: string
          notes: string | null
          preserve_body_text: boolean
          preserve_subject: boolean
          scheduled_for: string
          security_grace_hours: number
          security_grace_until: string | null
          status: string
          update_mode: string
          updated_at: string
          updated_by: string | null
          wrapper_version_id: string | null
        }
        Insert: {
          allow_tenant_opt_out?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          include_triggers?: string[] | null
          is_security_critical?: boolean
          launched_at?: string | null
          name: string
          notes?: string | null
          preserve_body_text?: boolean
          preserve_subject?: boolean
          scheduled_for: string
          security_grace_hours?: number
          security_grace_until?: string | null
          status?: string
          update_mode?: string
          updated_at?: string
          updated_by?: string | null
          wrapper_version_id?: string | null
        }
        Update: {
          allow_tenant_opt_out?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          include_triggers?: string[] | null
          is_security_critical?: boolean
          launched_at?: string | null
          name?: string
          notes?: string | null
          preserve_body_text?: boolean
          preserve_subject?: boolean
          scheduled_for?: string
          security_grace_hours?: number
          security_grace_until?: string | null
          status?: string
          update_mode?: string
          updated_at?: string
          updated_by?: string | null
          wrapper_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_template_rollouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_template_rollouts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_template_rollouts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_template_rollouts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_template_rollouts_wrapper_version_id_fkey"
            columns: ["wrapper_version_id"]
            isOneToOne: false
            referencedRelation: "platform_email_wrapper_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_fallback_log: {
        Row: {
          context: string | null
          created_at: string
          id: string
          service_code: string
          tenant_id: string
        }
        Insert: {
          context?: string | null
          created_at?: string
          id?: string
          service_code: string
          tenant_id: string
        }
        Update: {
          context?: string | null
          created_at?: string
          id?: string
          service_code?: string
          tenant_id?: string
        }
        Relationships: []
      }
      pricing_rules: {
        Row: {
          charge_type_id: string
          class_code: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          is_default: boolean
          minimum_charge: number | null
          notes: string | null
          pricing_method: string
          rate: number
          service_time_minutes: number | null
          tenant_id: string
          unit: string
          updated_at: string | null
        }
        Insert: {
          charge_type_id: string
          class_code?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          minimum_charge?: number | null
          notes?: string | null
          pricing_method?: string
          rate?: number
          service_time_minutes?: number | null
          tenant_id: string
          unit?: string
          updated_at?: string | null
        }
        Update: {
          charge_type_id?: string
          class_code?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_default?: boolean
          minimum_charge?: number | null
          notes?: string | null
          pricing_method?: string
          rate?: number
          service_time_minutes?: number | null
          tenant_id?: string
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_code_usages: {
        Row: {
          billing_event_id: string | null
          id: string
          promo_code_id: string
          root_account_id: string
          used_at: string
          used_by: string | null
          used_by_account_id: string
        }
        Insert: {
          billing_event_id?: string | null
          id?: string
          promo_code_id: string
          root_account_id: string
          used_at?: string
          used_by?: string | null
          used_by_account_id: string
        }
        Update: {
          billing_event_id?: string | null
          id?: string
          promo_code_id?: string
          root_account_id?: string
          used_at?: string
          used_by?: string | null
          used_by_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_code_usages_billing_event_id_fkey"
            columns: ["billing_event_id"]
            isOneToOne: true
            referencedRelation: "billing_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_usages_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_usages_root_account_id_fkey"
            columns: ["root_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_usages_used_by_account_id_fkey"
            columns: ["used_by_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          expiration_date: string | null
          expiration_type: Database["public"]["Enums"]["expiration_type"]
          id: string
          is_active: boolean
          selected_services: Json | null
          service_scope: Database["public"]["Enums"]["service_scope_type"]
          tenant_id: string
          updated_at: string
          usage_count: number
          usage_limit: number | null
          usage_limit_type: Database["public"]["Enums"]["usage_limit_type"]
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          expiration_date?: string | null
          expiration_type: Database["public"]["Enums"]["expiration_type"]
          id?: string
          is_active?: boolean
          selected_services?: Json | null
          service_scope: Database["public"]["Enums"]["service_scope_type"]
          tenant_id: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          usage_limit_type: Database["public"]["Enums"]["usage_limit_type"]
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number
          expiration_date?: string | null
          expiration_type?: Database["public"]["Enums"]["expiration_type"]
          id?: string
          is_active?: boolean
          selected_services?: Json | null
          service_scope?: Database["public"]["Enums"]["service_scope_type"]
          tenant_id?: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          usage_limit_type?: Database["public"]["Enums"]["usage_limit_type"]
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_acknowledgments: {
        Row: {
          acknowledged_at: string | null
          checklist_state: Json | null
          context_id: string | null
          context_type: string | null
          created_at: string | null
          id: string
          prompt_id: string
          snoozed_until: string | null
          status: string | null
          tenant_id: string
          user_id: string
          was_confirmed: boolean | null
        }
        Insert: {
          acknowledged_at?: string | null
          checklist_state?: Json | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          id?: string
          prompt_id: string
          snoozed_until?: string | null
          status?: string | null
          tenant_id: string
          user_id: string
          was_confirmed?: boolean | null
        }
        Update: {
          acknowledged_at?: string | null
          checklist_state?: Json | null
          context_id?: string | null
          context_type?: string | null
          created_at?: string | null
          id?: string
          prompt_id?: string
          snoozed_until?: string | null
          status?: string | null
          tenant_id?: string
          user_id?: string
          was_confirmed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_acknowledgments_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "guided_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_acknowledgments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_acknowledgments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_acknowledgments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_competency_tracking: {
        Row: {
          blocked_action_count: number | null
          created_at: string | null
          failed_completions_count: number | null
          id: string
          last_task_completed_at: string | null
          location_errors_count: number | null
          missing_photos_count: number | null
          prompts_confirmed_count: number | null
          prompts_shown_count: number | null
          qualified_at: string | null
          qualifies_for_upgrade: boolean | null
          tasks_completed: number | null
          tasks_with_errors: number | null
          tenant_id: string
          updated_at: string | null
          user_id: string
          workflow: string
        }
        Insert: {
          blocked_action_count?: number | null
          created_at?: string | null
          failed_completions_count?: number | null
          id?: string
          last_task_completed_at?: string | null
          location_errors_count?: number | null
          missing_photos_count?: number | null
          prompts_confirmed_count?: number | null
          prompts_shown_count?: number | null
          qualified_at?: string | null
          qualifies_for_upgrade?: boolean | null
          tasks_completed?: number | null
          tasks_with_errors?: number | null
          tenant_id: string
          updated_at?: string | null
          user_id: string
          workflow: string
        }
        Update: {
          blocked_action_count?: number | null
          created_at?: string | null
          failed_completions_count?: number | null
          id?: string
          last_task_completed_at?: string | null
          location_errors_count?: number | null
          missing_photos_count?: number | null
          prompts_confirmed_count?: number | null
          prompts_shown_count?: number | null
          qualified_at?: string | null
          qualifies_for_upgrade?: boolean | null
          tasks_completed?: number | null
          tasks_with_errors?: number | null
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_competency_tracking_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_competency_tracking_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_competency_tracking_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_upgrade_suggestions: {
        Row: {
          created_at: string | null
          current_level: string
          id: string
          manager_notified_at: string | null
          qualified_workflows: Json | null
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          suggested_level: string
          tenant_id: string
          user_id: string
          user_notified_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_level: string
          id?: string
          manager_notified_at?: string | null
          qualified_workflows?: Json | null
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          suggested_level: string
          tenant_id: string
          user_id: string
          user_notified_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_level?: string
          id?: string
          manager_notified_at?: string | null
          qualified_workflows?: Json | null
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          suggested_level?: string
          tenant_id?: string
          user_id?: string
          user_notified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_upgrade_suggestions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_upgrade_suggestions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_upgrade_suggestions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_upgrade_suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_upgrade_suggestions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      put_away_excluded_locations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          tenant_id: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          tenant_id: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          tenant_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "put_away_excluded_locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_excluded_locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_excluded_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_excluded_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_excluded_locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      put_away_flag_storage_requirements: {
        Row: {
          charge_type_id: string | null
          created_at: string
          created_by: string | null
          id: string
          requires_special_storage: boolean
          service_code: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          charge_type_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          requires_special_storage?: boolean
          service_code: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          charge_type_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          requires_special_storage?: boolean
          service_code?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "put_away_flag_storage_requirements_charge_type_id_fkey"
            columns: ["charge_type_id"]
            isOneToOne: false
            referencedRelation: "charge_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_flag_storage_requirements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_flag_storage_requirements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_flag_storage_requirements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_flag_storage_requirements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_flag_storage_requirements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      put_away_source_locations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          tenant_id: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          tenant_id: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          tenant_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "put_away_source_locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_source_locations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_source_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_source_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "put_away_source_locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_artifacts: {
        Row: {
          created_at: string
          id: string
          route: string
          run_id: string | null
          step_name: string | null
          storage_path: string
          suite: string
          tenant_id: string
          viewport: string
        }
        Insert: {
          created_at?: string
          id?: string
          route: string
          run_id?: string | null
          step_name?: string | null
          storage_path: string
          suite?: string
          tenant_id: string
          viewport: string
        }
        Update: {
          created_at?: string
          id?: string
          route?: string
          run_id?: string | null
          step_name?: string | null
          storage_path?: string
          suite?: string
          tenant_id?: string
          viewport?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qa_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_test_results: {
        Row: {
          created_at: string
          details: Json | null
          entity_ids: Json | null
          error_message: string | null
          error_stack: string | null
          finished_at: string | null
          id: string
          logs: string | null
          run_id: string
          started_at: string | null
          status: string
          suite: string
          tenant_id: string
          test_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          entity_ids?: Json | null
          error_message?: string | null
          error_stack?: string | null
          finished_at?: string | null
          id?: string
          logs?: string | null
          run_id: string
          started_at?: string | null
          status?: string
          suite: string
          tenant_id: string
          test_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          entity_ids?: Json | null
          error_message?: string | null
          error_stack?: string | null
          finished_at?: string | null
          id?: string
          logs?: string | null
          run_id?: string
          started_at?: string | null
          status?: string
          suite?: string
          tenant_id?: string
          test_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_test_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qa_test_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_test_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_test_runs: {
        Row: {
          created_at: string
          executed_by: string
          fail_count: number
          finished_at: string | null
          id: string
          metadata: Json | null
          mode: string
          pass_count: number
          skip_count: number
          started_at: string
          status: string
          suites_requested: string[]
          tenant_id: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string
          executed_by: string
          fail_count?: number
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          mode?: string
          pass_count?: number
          skip_count?: number
          started_at?: string
          status?: string
          suites_requested?: string[]
          tenant_id: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string
          executed_by?: string
          fail_count?: number
          finished_at?: string | null
          id?: string
          metadata?: Json | null
          mode?: string
          pass_count?: number
          skip_count?: number
          started_at?: string
          status?: string
          suites_requested?: string[]
          tenant_id?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_test_runs_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_test_runs_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_test_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_test_runs_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_connections: {
        Row: {
          access_token: string
          access_token_expires_at: string
          company_name: string | null
          connected_at: string | null
          connected_by: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          realm_id: string
          refresh_token: string
          refresh_token_expires_at: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          access_token: string
          access_token_expires_at: string
          company_name?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          realm_id: string
          refresh_token: string
          refresh_token_expires_at: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          access_token_expires_at?: string
          company_name?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          realm_id?: string
          refresh_token?: string
          refresh_token_expires_at?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_customer_map: {
        Row: {
          account_id: string
          created_at: string | null
          id: string
          last_synced_at: string | null
          qbo_customer_id: string
          qbo_display_name: string | null
          tenant_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          id?: string
          last_synced_at?: string | null
          qbo_customer_id: string
          qbo_display_name?: string | null
          tenant_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          id?: string
          last_synced_at?: string | null
          qbo_customer_id?: string
          qbo_display_name?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_customer_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_customer_map_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_invoice_sync_log: {
        Row: {
          account_id: string
          billing_event_ids: string[] | null
          billing_report_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          line_count: number | null
          period_end: string | null
          period_start: string | null
          qbo_doc_number: string | null
          qbo_invoice_id: string
          qbo_invoice_number: string | null
          status: string | null
          subtotal: number | null
          synced_at: string | null
          synced_by: string | null
          tax_amount: number | null
          tenant_id: string
          total_amount: number | null
        }
        Insert: {
          account_id: string
          billing_event_ids?: string[] | null
          billing_report_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          line_count?: number | null
          period_end?: string | null
          period_start?: string | null
          qbo_doc_number?: string | null
          qbo_invoice_id: string
          qbo_invoice_number?: string | null
          status?: string | null
          subtotal?: number | null
          synced_at?: string | null
          synced_by?: string | null
          tax_amount?: number | null
          tenant_id: string
          total_amount?: number | null
        }
        Update: {
          account_id?: string
          billing_event_ids?: string[] | null
          billing_report_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          line_count?: number | null
          period_end?: string | null
          period_start?: string | null
          qbo_doc_number?: string | null
          qbo_invoice_id?: string
          qbo_invoice_number?: string | null
          status?: string | null
          subtotal?: number | null
          synced_at?: string | null
          synced_by?: string | null
          tax_amount?: number | null
          tenant_id?: string
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_invoice_sync_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_invoice_sync_log_synced_by_fkey"
            columns: ["synced_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_invoice_sync_log_synced_by_fkey"
            columns: ["synced_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_invoice_sync_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_item_map: {
        Row: {
          created_at: string | null
          id: string
          last_synced_at: string | null
          qbo_item_id: string
          qbo_item_name: string | null
          service_type: string
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_synced_at?: string | null
          qbo_item_id: string
          qbo_item_name?: string | null
          service_type: string
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          last_synced_at?: string | null
          qbo_item_id?: string
          qbo_item_name?: string | null
          service_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_item_map_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_class_lines: {
        Row: {
          class_id: string
          created_at: string | null
          id: string
          line_discount_type:
            | Database["public"]["Enums"]["discount_type"]
            | null
          line_discount_value: number | null
          line_subtotal_after_discounts: number | null
          line_subtotal_before_discounts: number | null
          qty: number | null
          quote_id: string
          updated_at: string | null
        }
        Insert: {
          class_id: string
          created_at?: string | null
          id?: string
          line_discount_type?:
            | Database["public"]["Enums"]["discount_type"]
            | null
          line_discount_value?: number | null
          line_subtotal_after_discounts?: number | null
          line_subtotal_before_discounts?: number | null
          qty?: number | null
          quote_id: string
          updated_at?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string | null
          id?: string
          line_discount_type?:
            | Database["public"]["Enums"]["discount_type"]
            | null
          line_discount_value?: number | null
          line_subtotal_after_discounts?: number | null
          line_subtotal_before_discounts?: number | null
          qty?: number | null
          quote_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_class_lines_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_class_lines_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_class_service_selections: {
        Row: {
          class_id: string
          created_at: string | null
          id: string
          is_selected: boolean | null
          qty_override: number | null
          quote_id: string
          service_id: string
          updated_at: string | null
        }
        Insert: {
          class_id: string
          created_at?: string | null
          id?: string
          is_selected?: boolean | null
          qty_override?: number | null
          quote_id: string
          service_id: string
          updated_at?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string | null
          id?: string
          is_selected?: boolean | null
          qty_override?: number | null
          quote_id?: string
          service_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_class_service_selections_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_class_service_selections_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_class_service_selections_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "charge_types"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_events: {
        Row: {
          created_at: string | null
          created_by: string | null
          event_type: Database["public"]["Enums"]["quote_event_type"]
          id: string
          payload_json: Json | null
          quote_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          event_type: Database["public"]["Enums"]["quote_event_type"]
          id?: string
          payload_json?: Json | null
          quote_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          event_type?: Database["public"]["Enums"]["quote_event_type"]
          id?: string
          payload_json?: Json | null
          quote_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_events_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_rate_overrides: {
        Row: {
          class_id: string | null
          created_at: string | null
          id: string
          override_rate_amount: number
          quote_id: string
          reason: string | null
          service_id: string
        }
        Insert: {
          class_id?: string | null
          created_at?: string | null
          id?: string
          override_rate_amount: number
          quote_id: string
          reason?: string | null
          service_id: string
        }
        Update: {
          class_id?: string | null
          created_at?: string | null
          id?: string
          override_rate_amount?: number
          quote_id?: string
          reason?: string | null
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_rate_overrides_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_rate_overrides_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_rate_overrides_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "charge_types"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_selected_services: {
        Row: {
          applied_rate_amount: number | null
          computed_billable_qty: number | null
          created_at: string | null
          hours_input: number | null
          id: string
          is_selected: boolean | null
          line_total: number | null
          quote_id: string
          service_id: string
          updated_at: string | null
        }
        Insert: {
          applied_rate_amount?: number | null
          computed_billable_qty?: number | null
          created_at?: string | null
          hours_input?: number | null
          id?: string
          is_selected?: boolean | null
          line_total?: number | null
          quote_id: string
          service_id: string
          updated_at?: string | null
        }
        Update: {
          applied_rate_amount?: number | null
          computed_billable_qty?: number | null
          created_at?: string | null
          hours_input?: number | null
          id?: string
          is_selected?: boolean | null
          line_total?: number | null
          quote_id?: string
          service_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_selected_services_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_selected_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "charge_types"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          account_id: string
          coverage_cost: number | null
          coverage_type: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          decline_reason: string | null
          declined_at: string | null
          expiration_date: string | null
          grand_total: number | null
          id: string
          internal_notes: string | null
          magic_link_token: string | null
          notes: string | null
          quote_discount_type:
            | Database["public"]["Enums"]["discount_type"]
            | null
          quote_discount_value: number | null
          quote_number: string
          rates_locked: boolean | null
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"] | null
          storage_days: number | null
          storage_days_input: number | null
          storage_months_input: number | null
          subtotal_after_discounts: number | null
          subtotal_before_discounts: number | null
          tax_amount: number | null
          tax_enabled: boolean | null
          tax_rate_percent: number | null
          tax_rate_source: string | null
          tenant_id: string
          total_declared_value: number | null
          updated_at: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          account_id: string
          coverage_cost?: number | null
          coverage_type?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          expiration_date?: string | null
          grand_total?: number | null
          id?: string
          internal_notes?: string | null
          magic_link_token?: string | null
          notes?: string | null
          quote_discount_type?:
            | Database["public"]["Enums"]["discount_type"]
            | null
          quote_discount_value?: number | null
          quote_number: string
          rates_locked?: boolean | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"] | null
          storage_days?: number | null
          storage_days_input?: number | null
          storage_months_input?: number | null
          subtotal_after_discounts?: number | null
          subtotal_before_discounts?: number | null
          tax_amount?: number | null
          tax_enabled?: boolean | null
          tax_rate_percent?: number | null
          tax_rate_source?: string | null
          tenant_id: string
          total_declared_value?: number | null
          updated_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          account_id?: string
          coverage_cost?: number | null
          coverage_type?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          decline_reason?: string | null
          declined_at?: string | null
          expiration_date?: string | null
          grand_total?: number | null
          id?: string
          internal_notes?: string | null
          magic_link_token?: string | null
          notes?: string | null
          quote_discount_type?:
            | Database["public"]["Enums"]["discount_type"]
            | null
          quote_discount_value?: number | null
          quote_number?: string
          rates_locked?: boolean | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"] | null
          storage_days?: number | null
          storage_days_input?: number | null
          storage_months_input?: number | null
          subtotal_after_discounts?: number | null
          subtotal_before_discounts?: number | null
          tax_amount?: number | null
          tax_enabled?: boolean | null
          tax_rate_percent?: number | null
          tax_rate_source?: string | null
          tenant_id?: string
          total_declared_value?: number | null
          updated_at?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receiving_batches: {
        Row: {
          batch_number: string
          completed_at: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          notes: string | null
          received_by: string | null
          receiving_documents: Json | null
          receiving_photos: Json | null
          status: string
          tenant_id: string
          updated_at: string | null
          vendor: string | null
          warehouse_id: string | null
        }
        Insert: {
          batch_number: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          received_by?: string | null
          receiving_documents?: Json | null
          receiving_photos?: Json | null
          status?: string
          tenant_id: string
          updated_at?: string | null
          vendor?: string | null
          warehouse_id?: string | null
        }
        Update: {
          batch_number?: string
          completed_at?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          received_by?: string | null
          receiving_documents?: Json | null
          receiving_photos?: Json | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
          vendor?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receiving_batches_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_batches_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_batches_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      receiving_discrepancies: {
        Row: {
          created_at: string
          created_by: string | null
          details: Json
          id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          shipment_id: string
          status: string
          tenant_id: string
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          details?: Json
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id: string
          status?: string
          tenant_id: string
          type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          details?: Json
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id?: string
          status?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "receiving_discrepancies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_discrepancies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_discrepancies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_discrepancies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_discrepancies_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_discrepancies_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_discrepancies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receiving_sessions: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          notes: string | null
          shipment_id: string
          started_at: string
          started_by: string
          status: string
          tenant_id: string
          updated_at: string
          verification_data: Json | null
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          notes?: string | null
          shipment_id: string
          started_at?: string
          started_by: string
          status?: string
          tenant_id: string
          updated_at?: string
          verification_data?: Json | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          notes?: string | null
          shipment_id?: string
          started_at?: string
          started_by?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          verification_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "receiving_sessions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_sessions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_sessions_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_sessions_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receiving_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      release_type_map: {
        Row: {
          canonical_release_type: Database["public"]["Enums"]["canonical_release_type"]
          legacy_release_type: string
        }
        Insert: {
          canonical_release_type: Database["public"]["Enums"]["canonical_release_type"]
          legacy_release_type: string
        }
        Update: {
          canonical_release_type?: Database["public"]["Enums"]["canonical_release_type"]
          legacy_release_type?: string
        }
        Relationships: []
      }
      repair_client_offers: {
        Row: {
          client_responded_at: string | null
          client_response: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          offer_amount: number
          offered_by: string | null
          repair_quote_id: string
          tech_response_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          client_responded_at?: string | null
          client_response?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          offer_amount: number
          offered_by?: string | null
          repair_quote_id: string
          tech_response_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          client_responded_at?: string | null
          client_response?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          offer_amount?: number
          offered_by?: string | null
          repair_quote_id?: string
          tech_response_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_client_offers_offered_by_fkey"
            columns: ["offered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_client_offers_offered_by_fkey"
            columns: ["offered_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_client_offers_repair_quote_id_fkey"
            columns: ["repair_quote_id"]
            isOneToOne: false
            referencedRelation: "repair_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_client_offers_tech_response_id_fkey"
            columns: ["tech_response_id"]
            isOneToOne: false
            referencedRelation: "repair_tech_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_client_offers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_quote_items: {
        Row: {
          allocated_customer_amount: number | null
          allocated_tech_amount: number | null
          created_at: string | null
          damage_description: string | null
          damage_photos: Json | null
          id: string
          item_code: string | null
          item_description: string | null
          item_id: string
          notes_internal: string | null
          notes_public: string | null
          repair_quote_id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          allocated_customer_amount?: number | null
          allocated_tech_amount?: number | null
          created_at?: string | null
          damage_description?: string | null
          damage_photos?: Json | null
          id?: string
          item_code?: string | null
          item_description?: string | null
          item_id: string
          notes_internal?: string | null
          notes_public?: string | null
          repair_quote_id: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          allocated_customer_amount?: number | null
          allocated_tech_amount?: number | null
          created_at?: string | null
          damage_description?: string | null
          damage_photos?: Json | null
          id?: string
          item_code?: string | null
          item_description?: string | null
          item_id?: string
          notes_internal?: string | null
          notes_public?: string | null
          repair_quote_id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_quote_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quote_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quote_items_repair_quote_id_fkey"
            columns: ["repair_quote_id"]
            isOneToOne: false
            referencedRelation: "repair_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quote_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_quote_tokens: {
        Row: {
          accessed_at: string | null
          created_at: string | null
          created_by: string | null
          expires_at: string
          id: string
          recipient_email: string | null
          recipient_name: string | null
          repair_quote_id: string
          tenant_id: string
          token: string
          token_type: string
          used_at: string | null
        }
        Insert: {
          accessed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_at: string
          id?: string
          recipient_email?: string | null
          recipient_name?: string | null
          repair_quote_id: string
          tenant_id: string
          token?: string
          token_type: string
          used_at?: string | null
        }
        Update: {
          accessed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_at?: string
          id?: string
          recipient_email?: string | null
          recipient_name?: string | null
          repair_quote_id?: string
          tenant_id?: string
          token?: string
          token_type?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_quote_tokens_repair_quote_id_fkey"
            columns: ["repair_quote_id"]
            isOneToOne: false
            referencedRelation: "repair_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quote_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_quotes: {
        Row: {
          account_id: string | null
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          audit_log: Json | null
          client_responded_at: string | null
          client_responded_by: string | null
          client_response: string | null
          created_at: string
          created_by: string | null
          customer_price: number | null
          customer_total: number | null
          expires_at: string | null
          flat_rate: number | null
          id: string
          internal_cost: number | null
          item_id: string
          last_sent_at: string | null
          markup_applied: number | null
          notes: string | null
          office_notes: string | null
          pricing_locked: boolean | null
          sidemark_id: string | null
          source_task_id: string | null
          status:
            | Database["public"]["Enums"]["repair_quote_workflow_status"]
            | null
          tech_labor_hours: number | null
          tech_labor_rate: number | null
          tech_materials_cost: number | null
          tech_notes: string | null
          tech_submitted_at: string | null
          tech_total: number | null
          technician_id: string | null
          technician_name: string | null
          technician_user_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audit_log?: Json | null
          client_responded_at?: string | null
          client_responded_by?: string | null
          client_response?: string | null
          created_at?: string
          created_by?: string | null
          customer_price?: number | null
          customer_total?: number | null
          expires_at?: string | null
          flat_rate?: number | null
          id?: string
          internal_cost?: number | null
          item_id: string
          last_sent_at?: string | null
          markup_applied?: number | null
          notes?: string | null
          office_notes?: string | null
          pricing_locked?: boolean | null
          sidemark_id?: string | null
          source_task_id?: string | null
          status?:
            | Database["public"]["Enums"]["repair_quote_workflow_status"]
            | null
          tech_labor_hours?: number | null
          tech_labor_rate?: number | null
          tech_materials_cost?: number | null
          tech_notes?: string | null
          tech_submitted_at?: string | null
          tech_total?: number | null
          technician_id?: string | null
          technician_name?: string | null
          technician_user_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audit_log?: Json | null
          client_responded_at?: string | null
          client_responded_by?: string | null
          client_response?: string | null
          created_at?: string
          created_by?: string | null
          customer_price?: number | null
          customer_total?: number | null
          expires_at?: string | null
          flat_rate?: number | null
          id?: string
          internal_cost?: number | null
          item_id?: string
          last_sent_at?: string | null
          markup_applied?: number | null
          notes?: string | null
          office_notes?: string | null
          pricing_locked?: boolean | null
          sidemark_id?: string | null
          source_task_id?: string | null
          status?:
            | Database["public"]["Enums"]["repair_quote_workflow_status"]
            | null
          tech_labor_hours?: number | null
          tech_labor_rate?: number | null
          tech_materials_cost?: number | null
          tech_notes?: string | null
          tech_submitted_at?: string | null
          tech_total?: number | null
          technician_id?: string | null
          technician_name?: string | null
          technician_user_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_quotes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_sidemark_id_fkey"
            columns: ["sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_technician_user_id_fkey"
            columns: ["technician_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_quotes_technician_user_id_fkey"
            columns: ["technician_user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_tech_responses: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          labor_hours: number | null
          labor_rate: number | null
          materials_cost: number | null
          notes: string | null
          photos: Json | null
          repair_quote_id: string
          response_type: string
          submitted_at: string | null
          technician_id: string | null
          tenant_id: string
          total_estimate: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          labor_hours?: number | null
          labor_rate?: number | null
          materials_cost?: number | null
          notes?: string | null
          photos?: Json | null
          repair_quote_id: string
          response_type?: string
          submitted_at?: string | null
          technician_id?: string | null
          tenant_id: string
          total_estimate: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          labor_hours?: number | null
          labor_rate?: number | null
          materials_cost?: number | null
          notes?: string | null
          photos?: Json | null
          repair_quote_id?: string
          response_type?: string
          submitted_at?: string | null
          technician_id?: string | null
          tenant_id?: string
          total_estimate?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repair_tech_responses_repair_quote_id_fkey"
            columns: ["repair_quote_id"]
            isOneToOne: false
            referencedRelation: "repair_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tech_responses_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tech_responses_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tech_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_tech_tokens: {
        Row: {
          accessed_at: string | null
          created_at: string
          expires_at: string
          id: string
          task_id: string
          technician_email: string | null
          technician_name: string | null
          tenant_id: string
          token: string
        }
        Insert: {
          accessed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          task_id: string
          technician_email?: string | null
          technician_name?: string | null
          tenant_id: string
          token: string
        }
        Update: {
          accessed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          task_id?: string
          technician_email?: string | null
          technician_name?: string | null
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "repair_tech_tokens_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "repair_tech_tokens_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      report_executions: {
        Row: {
          data_source: string
          executed_at: string
          executed_by: string | null
          execution_time_ms: number | null
          filters_applied: Json | null
          id: string
          report_id: string | null
          report_name: string
          row_count: number | null
          tenant_id: string
        }
        Insert: {
          data_source: string
          executed_at?: string
          executed_by?: string | null
          execution_time_ms?: number | null
          filters_applied?: Json | null
          id?: string
          report_id?: string | null
          report_name: string
          row_count?: number | null
          tenant_id: string
        }
        Update: {
          data_source?: string
          executed_at?: string
          executed_by?: string | null
          execution_time_ms?: number | null
          filters_applied?: Json | null
          id?: string
          report_id?: string | null
          report_name?: string
          row_count?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_executions_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_executions_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_executions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "custom_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_executions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          allowed: boolean
          created_at: string
          id: string
          permission_key: string
          role_id: string
        }
        Insert: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_key: string
          role_id: string
        }
        Update: {
          allowed?: boolean
          created_at?: string
          id?: string
          permission_key?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          is_system: boolean
          name: string
          permissions: Json
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          permissions?: Json
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          permissions?: Json
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_plans: {
        Row: {
          base_price: number
          created_at: string | null
          id: string
          is_active: boolean
          name: string
          per_user_price: number
          stripe_meter_event_name_sms_segments: string | null
          stripe_price_id_base: string | null
          stripe_price_id_per_user: string | null
          stripe_price_id_sms_monthly_addon: string | null
          stripe_price_id_sms_segment_metered: string | null
          stripe_product_id: string | null
          updated_at: string | null
        }
        Insert: {
          base_price?: number
          created_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          per_user_price?: number
          stripe_meter_event_name_sms_segments?: string | null
          stripe_price_id_base?: string | null
          stripe_price_id_per_user?: string | null
          stripe_price_id_sms_monthly_addon?: string | null
          stripe_price_id_sms_segment_metered?: string | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Update: {
          base_price?: number
          created_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          per_user_price?: number
          stripe_meter_event_name_sms_segments?: string | null
          stripe_price_id_base?: string | null
          stripe_price_id_per_user?: string | null
          stripe_price_id_sms_monthly_addon?: string | null
          stripe_price_id_sms_segment_metered?: string | null
          stripe_product_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      saas_pricing_notice_dispatches: {
        Row: {
          id: string
          metadata: Json
          notice_type: string
          pricing_version_id: string
          recipient_count: number
          sent_at: string
          sent_by: string | null
        }
        Insert: {
          id?: string
          metadata?: Json
          notice_type: string
          pricing_version_id: string
          recipient_count?: number
          sent_at?: string
          sent_by?: string | null
        }
        Update: {
          id?: string
          metadata?: Json
          notice_type?: string
          pricing_version_id?: string
          recipient_count?: number
          sent_at?: string
          sent_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saas_pricing_notice_dispatches_pricing_version_id_fkey"
            columns: ["pricing_version_id"]
            isOneToOne: false
            referencedRelation: "saas_pricing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_pricing_versions: {
        Row: {
          app_monthly_fee: number
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          notes: string | null
          sms_monthly_addon_fee: number
          sms_segment_fee: number
          updated_at: string
        }
        Insert: {
          app_monthly_fee: number
          created_at?: string
          created_by?: string | null
          effective_from: string
          id?: string
          notes?: string | null
          sms_monthly_addon_fee: number
          sms_segment_fee: number
          updated_at?: string
        }
        Update: {
          app_monthly_fee?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          notes?: string | null
          sms_monthly_addon_fee?: number
          sms_segment_fee?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_categories: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
          sort_order: number | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
          sort_order?: number | null
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      service_events: {
        Row: {
          add_flag: boolean
          add_to_service_event_scan: boolean
          alert_rule: string | null
          billing_trigger: string
          billing_unit: string
          category_id: string | null
          class_code: string | null
          created_at: string | null
          id: string
          is_active: boolean
          notes: string | null
          rate: number | null
          service_code: string
          service_name: string
          service_time_minutes: number | null
          taxable: boolean
          tenant_id: string
          updated_at: string | null
          uses_class_pricing: boolean
        }
        Insert: {
          add_flag?: boolean
          add_to_service_event_scan?: boolean
          alert_rule?: string | null
          billing_trigger?: string
          billing_unit?: string
          category_id?: string | null
          class_code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          rate?: number | null
          service_code: string
          service_name: string
          service_time_minutes?: number | null
          taxable?: boolean
          tenant_id: string
          updated_at?: string | null
          uses_class_pricing?: boolean
        }
        Update: {
          add_flag?: boolean
          add_to_service_event_scan?: boolean
          alert_rule?: string | null
          billing_trigger?: string
          billing_unit?: string
          category_id?: string | null
          class_code?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          rate?: number | null
          service_code?: string
          service_name?: string
          service_time_minutes?: number | null
          taxable?: boolean
          tenant_id?: string
          updated_at?: string | null
          uses_class_pricing?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "service_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_events_audit: {
        Row: {
          action: string
          changed_at: string | null
          changed_by: string | null
          changed_fields: string[] | null
          class_code: string | null
          id: string
          new_values: Json | null
          old_values: Json | null
          service_code: string
          service_event_id: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          changed_at?: string | null
          changed_by?: string | null
          changed_fields?: string[] | null
          class_code?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          service_code: string
          service_event_id?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          changed_at?: string | null
          changed_by?: string | null
          changed_fields?: string[] | null
          class_code?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          service_code?: string
          service_event_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_events_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_events_audit_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_activity: {
        Row: {
          actor_name: string | null
          actor_user_id: string | null
          created_at: string
          details: Json
          event_label: string
          event_type: string
          id: string
          shipment_id: string
          tenant_id: string
        }
        Insert: {
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_label: string
          event_type: string
          id?: string
          shipment_id: string
          tenant_id: string
        }
        Update: {
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_label?: string
          event_type?: string
          id?: string
          shipment_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_activity_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_activity_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_exceptions: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          reopened_at: string | null
          reopened_by: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          shipment_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shipment_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_exceptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_exceptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_external_refs: {
        Row: {
          created_at: string
          id: string
          normalized_value: string
          ref_type: string
          shipment_id: string
          tenant_id: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          normalized_value: string
          ref_type: string
          shipment_id: string
          tenant_id: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          normalized_value?: string
          ref_type?: string
          shipment_id?: string
          tenant_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_external_refs_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_external_refs_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_external_refs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_item_allocations: {
        Row: {
          allocated_qty: number
          created_at: string
          created_by: string | null
          expected_shipment_id: string
          expected_shipment_item_id: string
          id: string
          manifest_shipment_id: string
          manifest_shipment_item_id: string
          tenant_id: string
        }
        Insert: {
          allocated_qty: number
          created_at?: string
          created_by?: string | null
          expected_shipment_id: string
          expected_shipment_item_id: string
          id?: string
          manifest_shipment_id: string
          manifest_shipment_item_id: string
          tenant_id: string
        }
        Update: {
          allocated_qty?: number
          created_at?: string
          created_by?: string | null
          expected_shipment_id?: string
          expected_shipment_item_id?: string
          id?: string
          manifest_shipment_id?: string
          manifest_shipment_item_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_item_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_allocations_expected_shipment_id_fkey"
            columns: ["expected_shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_allocations_expected_shipment_id_fkey"
            columns: ["expected_shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_allocations_expected_shipment_item_id_fkey"
            columns: ["expected_shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_allocations_manifest_shipment_id_fkey"
            columns: ["manifest_shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_allocations_manifest_shipment_id_fkey"
            columns: ["manifest_shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_allocations_manifest_shipment_item_id_fkey"
            columns: ["manifest_shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_allocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_item_photos: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          is_primary: boolean
          mime_type: string | null
          shipment_item_id: string
          storage_key: string
          storage_url: string | null
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          is_primary?: boolean
          mime_type?: string | null
          shipment_item_id: string
          storage_key: string
          storage_url?: string | null
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          is_primary?: boolean
          mime_type?: string | null
          shipment_item_id?: string
          storage_key?: string
          storage_url?: string | null
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_item_photos_shipment_item_id_fkey"
            columns: ["shipment_item_id"]
            isOneToOne: false
            referencedRelation: "shipment_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_item_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_items: {
        Row: {
          actual_quantity: number | null
          allocated_qty: number
          created_at: string
          declared_value: number | null
          expected_class_id: string | null
          expected_description: string | null
          expected_item_type_id: string | null
          expected_quantity: number
          expected_sidemark: string | null
          expected_vendor: string | null
          flags: string[] | null
          id: string
          is_staged: boolean | null
          item_id: string | null
          item_type_id: string | null
          notes: string | null
          primary_photo_id: string | null
          received_at: string | null
          released_at: string | null
          room: string | null
          shipment_id: string
          status: string
          updated_at: string
        }
        Insert: {
          actual_quantity?: number | null
          allocated_qty?: number
          created_at?: string
          declared_value?: number | null
          expected_class_id?: string | null
          expected_description?: string | null
          expected_item_type_id?: string | null
          expected_quantity?: number
          expected_sidemark?: string | null
          expected_vendor?: string | null
          flags?: string[] | null
          id?: string
          is_staged?: boolean | null
          item_id?: string | null
          item_type_id?: string | null
          notes?: string | null
          primary_photo_id?: string | null
          received_at?: string | null
          released_at?: string | null
          room?: string | null
          shipment_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          actual_quantity?: number | null
          allocated_qty?: number
          created_at?: string
          declared_value?: number | null
          expected_class_id?: string | null
          expected_description?: string | null
          expected_item_type_id?: string | null
          expected_quantity?: number
          expected_sidemark?: string | null
          expected_vendor?: string | null
          flags?: string[] | null
          id?: string
          is_staged?: boolean | null
          item_id?: string | null
          item_type_id?: string | null
          notes?: string | null
          primary_photo_id?: string | null
          received_at?: string | null
          released_at?: string | null
          room?: string | null
          shipment_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_items_expected_class_id_fkey"
            columns: ["expected_class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_expected_item_type_id_fkey"
            columns: ["expected_item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_items_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_media: {
        Row: {
          caption: string | null
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          media_type: string
          mime_type: string | null
          shipment_id: string
          storage_key: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          media_type?: string
          mime_type?: string | null
          shipment_id: string
          storage_key: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          media_type?: string
          mime_type?: string | null
          shipment_id?: string
          storage_key?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_media_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_media_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_media_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_notes: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          exception_code: string | null
          id: string
          is_chip_generated: boolean | null
          is_current: boolean | null
          note: string
          note_type: string
          parent_note_id: string | null
          shipment_id: string
          tenant_id: string | null
          updated_at: string
          version: number | null
          visibility: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          exception_code?: string | null
          id?: string
          is_chip_generated?: boolean | null
          is_current?: boolean | null
          note: string
          note_type?: string
          parent_note_id?: string | null
          shipment_id: string
          tenant_id?: string | null
          updated_at?: string
          version?: number | null
          visibility?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          exception_code?: string | null
          id?: string
          is_chip_generated?: boolean | null
          is_current?: boolean | null
          note?: string
          note_type?: string
          parent_note_id?: string | null
          shipment_id?: string
          tenant_id?: string | null
          updated_at?: string
          version?: number | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_notes_parent_note_id_fkey"
            columns: ["parent_note_id"]
            isOneToOne: false
            referencedRelation: "shipment_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_notes_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_notes_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_photos: {
        Row: {
          category: string
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          is_primary: boolean
          mime_type: string | null
          shipment_id: string
          storage_key: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          category: string
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          is_primary?: boolean
          mime_type?: string | null
          shipment_id: string
          storage_key: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          is_primary?: boolean
          mime_type?: string | null
          shipment_id?: string
          storage_key?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_photos_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_photos_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          account_id: string | null
          bill_to: string | null
          carrier: string | null
          completed_at: string | null
          completed_by: string | null
          coverage_declared_value: number | null
          coverage_deductible: number | null
          coverage_premium: number | null
          coverage_rate: number | null
          coverage_scope: string | null
          coverage_selected_at: string | null
          coverage_selected_by: string | null
          coverage_type: string | null
          created_at: string
          created_by: string | null
          customer_authorized: boolean | null
          customer_authorized_at: string | null
          customer_authorized_by: string | null
          deleted_at: string | null
          destination_name: string | null
          dock_intake_breakdown: Json | null
          driver_name: string | null
          eta_end: string | null
          eta_start: string | null
          expected_arrival_date: string | null
          expected_pieces: number | null
          highlight_notes: boolean | null
          id: string
          inbound_kind: string | null
          inbound_status: string | null
          liability_accepted: boolean | null
          metadata: Json | null
          notes: string | null
          origin_name: string | null
          outbound_type_id: string | null
          payment_amount: number | null
          payment_method: string | null
          payment_reference: string | null
          payment_status: string | null
          po_number: string | null
          portal_request_id: string | null
          received_at: string | null
          received_pieces: number | null
          receiving_documents: Json | null
          receiving_notes: string | null
          receiving_photos: Json | null
          release_photos: Json | null
          release_to_email: string | null
          release_to_name: string | null
          release_to_phone: string | null
          release_type: string | null
          released_to: string | null
          return_type: string | null
          scheduled_date: string | null
          shipment_exception_type: string | null
          shipment_number: string
          shipment_type: string
          shipped_at: string | null
          sidemark: string | null
          sidemark_id: string | null
          signature_data: string | null
          signature_name: string | null
          signature_timestamp: string | null
          signed_pieces: number | null
          source_shipment_id: string | null
          status: string
          tenant_id: string
          total_items: number | null
          tracking_number: string | null
          updated_at: string
          vendor_name: string | null
          warehouse_id: string | null
        }
        Insert: {
          account_id?: string | null
          bill_to?: string | null
          carrier?: string | null
          completed_at?: string | null
          completed_by?: string | null
          coverage_declared_value?: number | null
          coverage_deductible?: number | null
          coverage_premium?: number | null
          coverage_rate?: number | null
          coverage_scope?: string | null
          coverage_selected_at?: string | null
          coverage_selected_by?: string | null
          coverage_type?: string | null
          created_at?: string
          created_by?: string | null
          customer_authorized?: boolean | null
          customer_authorized_at?: string | null
          customer_authorized_by?: string | null
          deleted_at?: string | null
          destination_name?: string | null
          dock_intake_breakdown?: Json | null
          driver_name?: string | null
          eta_end?: string | null
          eta_start?: string | null
          expected_arrival_date?: string | null
          expected_pieces?: number | null
          highlight_notes?: boolean | null
          id?: string
          inbound_kind?: string | null
          inbound_status?: string | null
          liability_accepted?: boolean | null
          metadata?: Json | null
          notes?: string | null
          origin_name?: string | null
          outbound_type_id?: string | null
          payment_amount?: number | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          po_number?: string | null
          portal_request_id?: string | null
          received_at?: string | null
          received_pieces?: number | null
          receiving_documents?: Json | null
          receiving_notes?: string | null
          receiving_photos?: Json | null
          release_photos?: Json | null
          release_to_email?: string | null
          release_to_name?: string | null
          release_to_phone?: string | null
          release_type?: string | null
          released_to?: string | null
          return_type?: string | null
          scheduled_date?: string | null
          shipment_exception_type?: string | null
          shipment_number: string
          shipment_type?: string
          shipped_at?: string | null
          sidemark?: string | null
          sidemark_id?: string | null
          signature_data?: string | null
          signature_name?: string | null
          signature_timestamp?: string | null
          signed_pieces?: number | null
          source_shipment_id?: string | null
          status?: string
          tenant_id: string
          total_items?: number | null
          tracking_number?: string | null
          updated_at?: string
          vendor_name?: string | null
          warehouse_id?: string | null
        }
        Update: {
          account_id?: string | null
          bill_to?: string | null
          carrier?: string | null
          completed_at?: string | null
          completed_by?: string | null
          coverage_declared_value?: number | null
          coverage_deductible?: number | null
          coverage_premium?: number | null
          coverage_rate?: number | null
          coverage_scope?: string | null
          coverage_selected_at?: string | null
          coverage_selected_by?: string | null
          coverage_type?: string | null
          created_at?: string
          created_by?: string | null
          customer_authorized?: boolean | null
          customer_authorized_at?: string | null
          customer_authorized_by?: string | null
          deleted_at?: string | null
          destination_name?: string | null
          dock_intake_breakdown?: Json | null
          driver_name?: string | null
          eta_end?: string | null
          eta_start?: string | null
          expected_arrival_date?: string | null
          expected_pieces?: number | null
          highlight_notes?: boolean | null
          id?: string
          inbound_kind?: string | null
          inbound_status?: string | null
          liability_accepted?: boolean | null
          metadata?: Json | null
          notes?: string | null
          origin_name?: string | null
          outbound_type_id?: string | null
          payment_amount?: number | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          po_number?: string | null
          portal_request_id?: string | null
          received_at?: string | null
          received_pieces?: number | null
          receiving_documents?: Json | null
          receiving_notes?: string | null
          receiving_photos?: Json | null
          release_photos?: Json | null
          release_to_email?: string | null
          release_to_name?: string | null
          release_to_phone?: string | null
          release_type?: string | null
          released_to?: string | null
          return_type?: string | null
          scheduled_date?: string | null
          shipment_exception_type?: string | null
          shipment_number?: string
          shipment_type?: string
          shipped_at?: string | null
          sidemark?: string | null
          sidemark_id?: string | null
          signature_data?: string | null
          signature_name?: string | null
          signature_timestamp?: string | null
          signed_pieces?: number | null
          source_shipment_id?: string | null
          status?: string
          tenant_id?: string
          total_items?: number | null
          tracking_number?: string | null
          updated_at?: string
          vendor_name?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_coverage_selected_by_fkey"
            columns: ["coverage_selected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_coverage_selected_by_fkey"
            columns: ["coverage_selected_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_outbound_type_id_fkey"
            columns: ["outbound_type_id"]
            isOneToOne: false
            referencedRelation: "outbound_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_sidemark_id_fkey"
            columns: ["sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_source_shipment_id_fkey"
            columns: ["source_shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_source_shipment_id_fkey"
            columns: ["source_shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      sidemarks: {
        Row: {
          account_id: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          notes: string | null
          sidemark_code: string | null
          sidemark_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          sidemark_code?: string | null
          sidemark_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          sidemark_code?: string | null
          sidemark_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sidemarks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sidemarks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_consent: {
        Row: {
          account_id: string | null
          consent_method: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          id: string
          last_keyword: string | null
          opted_in_at: string | null
          opted_out_at: string | null
          phone_number: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          consent_method?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_keyword?: string | null
          opted_in_at?: string | null
          opted_out_at?: string | null
          phone_number: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          consent_method?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          last_keyword?: string | null
          opted_in_at?: string | null
          opted_out_at?: string | null
          phone_number?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_consent_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_consent_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_consent_log: {
        Row: {
          action: string
          actor_name: string | null
          actor_user_id: string | null
          consent_id: string
          created_at: string
          id: string
          ip_address: string | null
          keyword: string | null
          method: string | null
          new_status: string | null
          phone_number: string
          previous_status: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_name?: string | null
          actor_user_id?: string | null
          consent_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          keyword?: string | null
          method?: string | null
          new_status?: string | null
          phone_number: string
          previous_status?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_name?: string | null
          actor_user_id?: string | null
          consent_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          keyword?: string | null
          method?: string | null
          new_status?: string | null
          phone_number?: string
          previous_status?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_consent_log_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "sms_consent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_consent_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_usage_daily_rollups: {
        Row: {
          created_at: string
          direction: string
          estimated_segment_count: number
          first_event_at: string | null
          id: string
          last_aggregated_at: string
          last_event_at: string | null
          message_count: number
          metadata: Json
          segment_count: number
          stripe_last_sync_attempt_at: string | null
          stripe_last_sync_error: string | null
          stripe_last_synced_at: string | null
          stripe_last_usage_record_id: string | null
          stripe_sync_status: string
          stripe_synced_segment_count: number
          tenant_id: string
          twilio_exact_segment_count: number
          updated_at: string
          usage_date: string
        }
        Insert: {
          created_at?: string
          direction: string
          estimated_segment_count?: number
          first_event_at?: string | null
          id?: string
          last_aggregated_at?: string
          last_event_at?: string | null
          message_count?: number
          metadata?: Json
          segment_count?: number
          stripe_last_sync_attempt_at?: string | null
          stripe_last_sync_error?: string | null
          stripe_last_synced_at?: string | null
          stripe_last_usage_record_id?: string | null
          stripe_sync_status?: string
          stripe_synced_segment_count?: number
          tenant_id: string
          twilio_exact_segment_count?: number
          updated_at?: string
          usage_date: string
        }
        Update: {
          created_at?: string
          direction?: string
          estimated_segment_count?: number
          first_event_at?: string | null
          id?: string
          last_aggregated_at?: string
          last_event_at?: string | null
          message_count?: number
          metadata?: Json
          segment_count?: number
          stripe_last_sync_attempt_at?: string | null
          stripe_last_sync_error?: string | null
          stripe_last_synced_at?: string | null
          stripe_last_usage_record_id?: string | null
          stripe_sync_status?: string
          stripe_synced_segment_count?: number
          tenant_id?: string
          twilio_exact_segment_count?: number
          updated_at?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_usage_daily_rollups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_usage_events: {
        Row: {
          aggregated_at: string | null
          aggregated_estimated_segment_count: number
          aggregated_message_count: number
          aggregated_segment_count: number
          aggregated_twilio_segment_count: number
          billable: boolean
          created_at: string
          direction: string
          from_phone: string | null
          id: string
          message_status: string | null
          metadata: Json
          needs_reconciliation: boolean
          occurred_at: string
          provider: string
          segment_count: number
          segment_count_source: string
          tenant_id: string
          to_phone: string | null
          twilio_account_sid: string | null
          twilio_message_sid: string | null
          updated_at: string
        }
        Insert: {
          aggregated_at?: string | null
          aggregated_estimated_segment_count?: number
          aggregated_message_count?: number
          aggregated_segment_count?: number
          aggregated_twilio_segment_count?: number
          billable?: boolean
          created_at?: string
          direction: string
          from_phone?: string | null
          id?: string
          message_status?: string | null
          metadata?: Json
          needs_reconciliation?: boolean
          occurred_at?: string
          provider?: string
          segment_count?: number
          segment_count_source?: string
          tenant_id: string
          to_phone?: string | null
          twilio_account_sid?: string | null
          twilio_message_sid?: string | null
          updated_at?: string
        }
        Update: {
          aggregated_at?: string | null
          aggregated_estimated_segment_count?: number
          aggregated_message_count?: number
          aggregated_segment_count?: number
          aggregated_twilio_segment_count?: number
          billable?: boolean
          created_at?: string
          direction?: string
          from_phone?: string | null
          id?: string
          message_status?: string | null
          metadata?: Json
          needs_reconciliation?: boolean
          occurred_at?: string
          provider?: string
          segment_count?: number
          segment_count_source?: string
          tenant_id?: string
          to_phone?: string | null
          twilio_account_sid?: string | null
          twilio_message_sid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_usage_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktake_items: {
        Row: {
          counted_at: string | null
          counted_by: string | null
          counted_quantity: number | null
          created_at: string | null
          expected_location_id: string | null
          expected_quantity: number | null
          found_location_id: string | null
          id: string
          item_id: string
          notes: string | null
          status: string
          stocktake_id: string
          tenant_id: string
        }
        Insert: {
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number | null
          created_at?: string | null
          expected_location_id?: string | null
          expected_quantity?: number | null
          found_location_id?: string | null
          id?: string
          item_id: string
          notes?: string | null
          status?: string
          stocktake_id: string
          tenant_id: string
        }
        Update: {
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number | null
          created_at?: string | null
          expected_location_id?: string | null
          expected_quantity?: number | null
          found_location_id?: string | null
          id?: string
          item_id?: string
          notes?: string | null
          status?: string
          stocktake_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_items_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_expected_location_id_fkey"
            columns: ["expected_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_found_location_id_fkey"
            columns: ["found_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_stocktake_id_fkey"
            columns: ["stocktake_id"]
            isOneToOne: false
            referencedRelation: "stocktakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktake_manifest_history: {
        Row: {
          action: string
          affected_item_ids: Json | null
          changed_at: string
          changed_by: string
          description: string | null
          id: string
          manifest_id: string
          new_values: Json | null
          old_values: Json | null
        }
        Insert: {
          action: string
          affected_item_ids?: Json | null
          changed_at?: string
          changed_by: string
          description?: string | null
          id?: string
          manifest_id: string
          new_values?: Json | null
          old_values?: Json | null
        }
        Update: {
          action?: string
          affected_item_ids?: Json | null
          changed_at?: string
          changed_by?: string
          description?: string | null
          id?: string
          manifest_id?: string
          new_values?: Json | null
          old_values?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_manifest_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_history_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "stocktake_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_history_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "v_manifest_stats"
            referencedColumns: ["manifest_id"]
          },
        ]
      }
      stocktake_manifest_items: {
        Row: {
          account_id: string | null
          added_at: string | null
          added_by: string | null
          created_at: string | null
          expected_location_id: string | null
          id: string
          item_code: string
          item_description: string | null
          item_id: string
          manifest_id: string
          scanned: boolean | null
          scanned_at: string | null
          scanned_by: string | null
          scanned_location_id: string | null
        }
        Insert: {
          account_id?: string | null
          added_at?: string | null
          added_by?: string | null
          created_at?: string | null
          expected_location_id?: string | null
          id?: string
          item_code: string
          item_description?: string | null
          item_id: string
          manifest_id: string
          scanned?: boolean | null
          scanned_at?: string | null
          scanned_by?: string | null
          scanned_location_id?: string | null
        }
        Update: {
          account_id?: string | null
          added_at?: string | null
          added_by?: string | null
          created_at?: string | null
          expected_location_id?: string | null
          id?: string
          item_code?: string
          item_description?: string | null
          item_id?: string
          manifest_id?: string
          scanned?: boolean | null
          scanned_at?: string | null
          scanned_by?: string | null
          scanned_location_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_manifest_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_expected_location_id_fkey"
            columns: ["expected_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "stocktake_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "v_manifest_stats"
            referencedColumns: ["manifest_id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_items_scanned_location_id_fkey"
            columns: ["scanned_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktake_manifest_scans: {
        Row: {
          id: string
          item_code: string
          item_id: string | null
          manifest_id: string
          message: string | null
          metadata: Json | null
          scan_result: string
          scanned_at: string
          scanned_by: string
          scanned_location_id: string
        }
        Insert: {
          id?: string
          item_code: string
          item_id?: string | null
          manifest_id: string
          message?: string | null
          metadata?: Json | null
          scan_result: string
          scanned_at?: string
          scanned_by: string
          scanned_location_id: string
        }
        Update: {
          id?: string
          item_code?: string
          item_id?: string | null
          manifest_id?: string
          message?: string | null
          metadata?: Json | null
          scan_result?: string
          scanned_at?: string
          scanned_by?: string
          scanned_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_manifest_scans_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_scans_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_scans_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "stocktake_manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_scans_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "v_manifest_stats"
            referencedColumns: ["manifest_id"]
          },
          {
            foreignKeyName: "stocktake_manifest_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifest_scans_scanned_location_id_fkey"
            columns: ["scanned_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktake_manifests: {
        Row: {
          assigned_to: string | null
          billable: boolean | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          expected_item_count: number | null
          id: string
          include_accounts: Json | null
          location_ids: Json | null
          manifest_number: string
          name: string
          notes: string | null
          scanned_item_count: number | null
          scheduled_date: string | null
          started_at: string | null
          started_by: string | null
          status: string
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          warehouse_id: string
        }
        Insert: {
          assigned_to?: string | null
          billable?: boolean | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expected_item_count?: number | null
          id?: string
          include_accounts?: Json | null
          location_ids?: Json | null
          manifest_number: string
          name: string
          notes?: string | null
          scanned_item_count?: number | null
          scheduled_date?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
          warehouse_id: string
        }
        Update: {
          assigned_to?: string | null
          billable?: boolean | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expected_item_count?: number | null
          id?: string
          include_accounts?: Json | null
          location_ids?: Json | null
          manifest_number?: string
          name?: string
          notes?: string | null
          scanned_item_count?: number | null
          scheduled_date?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_manifests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktakes: {
        Row: {
          account_id: string | null
          assigned_to: string | null
          closed_at: string | null
          completed_at: string | null
          counted_item_count: number | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          duration_minutes: number | null
          expected_item_count: number | null
          freeze_moves: boolean | null
          id: string
          location_id: string | null
          metadata: Json | null
          name: string | null
          notes: string | null
          scheduled_date: string | null
          started_at: string | null
          status: string
          stocktake_number: string
          tenant_id: string
          updated_at: string | null
          variance_count: number | null
          warehouse_id: string
        }
        Insert: {
          account_id?: string | null
          assigned_to?: string | null
          closed_at?: string | null
          completed_at?: string | null
          counted_item_count?: number | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          duration_minutes?: number | null
          expected_item_count?: number | null
          freeze_moves?: boolean | null
          id?: string
          location_id?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          scheduled_date?: string | null
          started_at?: string | null
          status?: string
          stocktake_number: string
          tenant_id: string
          updated_at?: string | null
          variance_count?: number | null
          warehouse_id: string
        }
        Update: {
          account_id?: string | null
          assigned_to?: string | null
          closed_at?: string | null
          completed_at?: string | null
          counted_item_count?: number | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          duration_minutes?: number | null
          expected_item_count?: number | null
          freeze_moves?: boolean | null
          id?: string
          location_id?: string | null
          metadata?: Json | null
          name?: string | null
          notes?: string | null
          scheduled_date?: string | null
          started_at?: string | null
          status?: string
          stocktake_number?: string
          tenant_id?: string
          updated_at?: string | null
          variance_count?: number | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stocktakes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktakes_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_daily_rollup: {
        Row: {
          account_id: string
          class_id: string | null
          created_at: string
          daily_rate: number
          id: string
          item_id: string
          rollup_date: string
          sidemark_id: string | null
          tenant_id: string
        }
        Insert: {
          account_id: string
          class_id?: string | null
          created_at?: string
          daily_rate: number
          id?: string
          item_id: string
          rollup_date: string
          sidemark_id?: string | null
          tenant_id: string
        }
        Update: {
          account_id?: string
          class_id?: string | null
          created_at?: string
          daily_rate?: number
          id?: string
          item_id?: string
          rollup_date?: string
          sidemark_id?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      subtasks: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          description: string | null
          id: string
          is_completed: boolean | null
          sort_order: number | null
          task_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_completed?: boolean | null
          sort_order?: number | null
          task_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_completed?: boolean | null
          sort_order?: number | null
          task_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subtasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subtasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity: {
        Row: {
          actor_name: string | null
          actor_user_id: string | null
          created_at: string
          details: Json
          event_label: string
          event_type: string
          id: string
          task_id: string
          tenant_id: string
        }
        Insert: {
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_label: string
          event_type: string
          id?: string
          task_id: string
          tenant_id: string
        }
        Update: {
          actor_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          event_label?: string
          event_type?: string
          id?: string
          task_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      task_additional_charges: {
        Row: {
          charge_amount: number
          charge_description: string | null
          charge_name: string
          charge_type: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_applied: boolean | null
          task_id: string
          updated_at: string | null
        }
        Insert: {
          charge_amount: number
          charge_description?: string | null
          charge_name: string
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_applied?: boolean | null
          task_id: string
          updated_at?: string | null
        }
        Update: {
          charge_amount?: number
          charge_description?: string | null
          charge_name?: string
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_applied?: boolean | null
          task_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_additional_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_additional_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_additional_charges_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_additional_charges_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      task_addon_lines: {
        Row: {
          add_on_id: string | null
          created_at: string | null
          description: string
          id: string
          is_taxable: boolean | null
          ninv_number: string
          quantity: number | null
          task_id: string
          tenant_id: string
          total_amount: number | null
          unit_rate: number
          updated_at: string | null
        }
        Insert: {
          add_on_id?: string | null
          created_at?: string | null
          description: string
          id?: string
          is_taxable?: boolean | null
          ninv_number: string
          quantity?: number | null
          task_id: string
          tenant_id: string
          total_amount?: number | null
          unit_rate?: number
          updated_at?: string | null
        }
        Update: {
          add_on_id?: string | null
          created_at?: string | null
          description?: string
          id?: string
          is_taxable?: boolean | null
          ninv_number?: string
          quantity?: number | null
          task_id?: string
          tenant_id?: string
          total_amount?: number | null
          unit_rate?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_addon_lines_add_on_id_fkey"
            columns: ["add_on_id"]
            isOneToOne: false
            referencedRelation: "add_ons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_addon_lines_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_addon_lines_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_addon_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_custom_charges: {
        Row: {
          charge_amount: number
          charge_description: string | null
          charge_name: string
          charge_type: string | null
          created_at: string | null
          created_by: string | null
          id: string
          task_id: string
          template_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          charge_amount: number
          charge_description?: string | null
          charge_name: string
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          task_id: string
          template_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          charge_amount?: number
          charge_description?: string | null
          charge_name?: string
          charge_type?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          task_id?: string
          template_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_custom_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_charges_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_charges_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_charges_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "billing_charge_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_custom_charges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_items: {
        Row: {
          apply_custom_packaging: boolean | null
          apply_minor_touchup: boolean | null
          apply_pallet_sale: boolean | null
          base_service_charge: number | null
          created_at: string | null
          custom_packaging_charge: number | null
          id: string
          item_id: string
          item_type_id: string | null
          minor_touchup_charge: number | null
          pallet_sale_charge: number | null
          quantity: number | null
          task_id: string
          total_charge: number | null
          updated_at: string | null
        }
        Insert: {
          apply_custom_packaging?: boolean | null
          apply_minor_touchup?: boolean | null
          apply_pallet_sale?: boolean | null
          base_service_charge?: number | null
          created_at?: string | null
          custom_packaging_charge?: number | null
          id?: string
          item_id: string
          item_type_id?: string | null
          minor_touchup_charge?: number | null
          pallet_sale_charge?: number | null
          quantity?: number | null
          task_id: string
          total_charge?: number | null
          updated_at?: string | null
        }
        Update: {
          apply_custom_packaging?: boolean | null
          apply_minor_touchup?: boolean | null
          apply_pallet_sale?: boolean | null
          base_service_charge?: number | null
          created_at?: string | null
          custom_packaging_charge?: number | null
          id?: string
          item_id?: string
          item_type_id?: string | null
          minor_touchup_charge?: number | null
          pallet_sale_charge?: number | null
          quantity?: number | null
          task_id?: string
          total_charge?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_items_item_type_id_fkey"
            columns: ["item_type_id"]
            isOneToOne: false
            referencedRelation: "item_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      task_notes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_required: boolean | null
          note: string
          note_type: string | null
          parent_note_id: string | null
          task_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_required?: boolean | null
          note: string
          note_type?: string | null
          parent_note_id?: string | null
          task_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_required?: boolean | null
          note?: string
          note_type?: string | null
          parent_note_id?: string | null
          task_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_notes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_notes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
        ]
      }
      task_status_map: {
        Row: {
          canonical_status: Database["public"]["Enums"]["canonical_task_status"]
          legacy_status: string
        }
        Insert: {
          canonical_status: Database["public"]["Enums"]["canonical_task_status"]
          legacy_status: string
        }
        Update: {
          canonical_status?: Database["public"]["Enums"]["canonical_task_status"]
          legacy_status?: string
        }
        Relationships: []
      }
      task_type_charge_links: {
        Row: {
          charge_type_id: string
          created_at: string | null
          deleted_at: string | null
          id: string
          task_type_id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          charge_type_id: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          task_type_id: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          charge_type_id?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          task_type_id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_type_charge_links_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_type_charge_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_type_map: {
        Row: {
          canonical_type: Database["public"]["Enums"]["canonical_task_type"]
          legacy_type: string
        }
        Insert: {
          canonical_type: Database["public"]["Enums"]["canonical_task_type"]
          legacy_type: string
        }
        Update: {
          canonical_type?: Database["public"]["Enums"]["canonical_task_type"]
          legacy_type?: string
        }
        Relationships: []
      }
      task_types: {
        Row: {
          allow_rate_override: boolean | null
          billing_service_code: string | null
          category_id: string | null
          color: string | null
          created_at: string | null
          default_service_code: string | null
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_system: boolean | null
          name: string
          primary_service_code: string | null
          requires_items: boolean | null
          requires_manual_rate: boolean | null
          sort_order: number | null
          task_kind: Database["public"]["Enums"]["task_kind"]
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          allow_rate_override?: boolean | null
          billing_service_code?: string | null
          category_id?: string | null
          color?: string | null
          created_at?: string | null
          default_service_code?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name: string
          primary_service_code?: string | null
          requires_items?: boolean | null
          requires_manual_rate?: boolean | null
          sort_order?: number | null
          task_kind?: Database["public"]["Enums"]["task_kind"]
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          allow_rate_override?: boolean | null
          billing_service_code?: string | null
          category_id?: string | null
          color?: string | null
          created_at?: string | null
          default_service_code?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_system?: boolean | null
          name?: string
          primary_service_code?: string | null
          requires_items?: boolean | null
          requires_manual_rate?: boolean | null
          sort_order?: number | null
          task_kind?: Database["public"]["Enums"]["task_kind"]
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_types_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          account_id: string | null
          assigned_department: string | null
          assigned_to: string | null
          bill_to: string | null
          bill_to_customer_email: string | null
          bill_to_customer_name: string | null
          billing_charge_date: string | null
          billing_date: string | null
          billing_rate: number | null
          billing_rate_locked: boolean | null
          billing_rate_set_at: string | null
          billing_rate_set_by: string | null
          billing_status: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          custom_packaging_applied: boolean | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          duration_minutes: number | null
          ended_at: string | null
          ended_by: string | null
          id: string
          invoice_id: string | null
          metadata: Json | null
          minor_touchup_applied: boolean | null
          overdue_alert_sent_at: string | null
          pallet_sale_applied: boolean | null
          parent_task_id: string | null
          priority: string | null
          related_item_id: string | null
          service_date: string | null
          sidemark: string | null
          started_at: string | null
          started_by: string | null
          status: string
          task_notes: string | null
          task_type: string
          task_type_id: string | null
          tenant_id: string
          title: string
          unable_to_complete: boolean | null
          unable_to_complete_at: string | null
          unable_to_complete_by: string | null
          unable_to_complete_note: string | null
          unable_to_complete_reason: string | null
          updated_at: string | null
          waive_charges: boolean
          waive_notes: string | null
          waive_reason: string | null
          waived_at: string | null
          waived_by: string | null
          warehouse_id: string | null
        }
        Insert: {
          account_id?: string | null
          assigned_department?: string | null
          assigned_to?: string | null
          bill_to?: string | null
          bill_to_customer_email?: string | null
          bill_to_customer_name?: string | null
          billing_charge_date?: string | null
          billing_date?: string | null
          billing_rate?: number | null
          billing_rate_locked?: boolean | null
          billing_rate_set_at?: string | null
          billing_rate_set_by?: string | null
          billing_status?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          custom_packaging_applied?: boolean | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          invoice_id?: string | null
          metadata?: Json | null
          minor_touchup_applied?: boolean | null
          overdue_alert_sent_at?: string | null
          pallet_sale_applied?: boolean | null
          parent_task_id?: string | null
          priority?: string | null
          related_item_id?: string | null
          service_date?: string | null
          sidemark?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          task_notes?: string | null
          task_type: string
          task_type_id?: string | null
          tenant_id: string
          title: string
          unable_to_complete?: boolean | null
          unable_to_complete_at?: string | null
          unable_to_complete_by?: string | null
          unable_to_complete_note?: string | null
          unable_to_complete_reason?: string | null
          updated_at?: string | null
          waive_charges?: boolean
          waive_notes?: string | null
          waive_reason?: string | null
          waived_at?: string | null
          waived_by?: string | null
          warehouse_id?: string | null
        }
        Update: {
          account_id?: string | null
          assigned_department?: string | null
          assigned_to?: string | null
          bill_to?: string | null
          bill_to_customer_email?: string | null
          bill_to_customer_name?: string | null
          billing_charge_date?: string | null
          billing_date?: string | null
          billing_rate?: number | null
          billing_rate_locked?: boolean | null
          billing_rate_set_at?: string | null
          billing_rate_set_by?: string | null
          billing_status?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          custom_packaging_applied?: boolean | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          invoice_id?: string | null
          metadata?: Json | null
          minor_touchup_applied?: boolean | null
          overdue_alert_sent_at?: string | null
          pallet_sale_applied?: boolean | null
          parent_task_id?: string | null
          priority?: string | null
          related_item_id?: string | null
          service_date?: string | null
          sidemark?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          task_notes?: string | null
          task_type?: string
          task_type_id?: string | null
          tenant_id?: string
          title?: string
          unable_to_complete?: boolean | null
          unable_to_complete_at?: string | null
          unable_to_complete_by?: string | null
          unable_to_complete_note?: string | null
          unable_to_complete_reason?: string | null
          updated_at?: string | null
          waive_charges?: boolean
          waive_notes?: string | null
          waive_reason?: string | null
          waived_at?: string | null
          waived_by?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_tasks_invoice"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_billing_rate_set_by_fkey"
            columns: ["billing_rate_set_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_billing_rate_set_by_fkey"
            columns: ["billing_rate_set_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_item_id_fkey"
            columns: ["related_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_item_id_fkey"
            columns: ["related_item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      technicians: {
        Row: {
          created_at: string | null
          created_by: string | null
          email: string
          hourly_rate: number | null
          id: string
          is_active: boolean | null
          markup_percent: number | null
          name: string
          notes: string | null
          phone: string | null
          specialties: string[] | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          markup_percent?: number | null
          name: string
          notes?: string | null
          phone?: string | null
          specialties?: string[] | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email?: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          markup_percent?: number | null
          name?: string
          notes?: string | null
          phone?: string | null
          specialties?: string[] | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "technicians_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_alert_settings: {
        Row: {
          alert_type_id: string
          body_override_html: string | null
          body_override_text: string | null
          created_at: string
          enabled: boolean
          id: string
          subject_override: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alert_type_id: string
          body_override_html?: string | null
          body_override_text?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          subject_override?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alert_type_id?: string
          body_override_html?: string | null
          body_override_text?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          subject_override?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_alert_settings_alert_type_id_fkey"
            columns: ["alert_type_id"]
            isOneToOne: false
            referencedRelation: "alert_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_alert_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_alert_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_alert_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_billing_override_log: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          expires_at: string | null
          id: string
          is_comped: boolean
          metadata: Json
          note: string | null
          reason: string | null
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          expires_at?: string | null
          id?: string
          is_comped: boolean
          metadata?: Json
          note?: string | null
          reason?: string | null
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          expires_at?: string | null
          id?: string
          is_comped?: boolean
          metadata?: Json
          note?: string | null
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_billing_override_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_billing_overrides: {
        Row: {
          comped_at: string | null
          comped_by: string | null
          comped_note: string | null
          comped_reason: string | null
          created_at: string
          expires_at: string | null
          is_comped: boolean
          removed_at: string | null
          removed_by: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          comped_at?: string | null
          comped_by?: string | null
          comped_note?: string | null
          comped_reason?: string | null
          created_at?: string
          expires_at?: string | null
          is_comped?: boolean
          removed_at?: string | null
          removed_by?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          comped_at?: string | null
          comped_by?: string | null
          comped_note?: string | null
          comped_reason?: string | null
          created_at?: string
          expires_at?: string | null
          is_comped?: boolean
          removed_at?: string | null
          removed_by?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_billing_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_company_settings: {
        Row: {
          app_base_url: string | null
          app_subdomain: string | null
          company_address: string | null
          company_email: string | null
          company_name: string | null
          company_phone: string | null
          company_website: string | null
          created_at: string
          created_by: string | null
          default_repair_task_type_id_for_damage: string | null
          default_repair_task_type_id_for_quote: string | null
          email_signature_custom_text: string | null
          email_signature_enabled: boolean
          id: string
          logo_storage_path: string | null
          logo_url: string | null
          office_alert_emails: string | null
          remit_address_line1: string | null
          remit_address_line2: string | null
          remit_city: string | null
          remit_state: string | null
          remit_zip: string | null
          sms_additional_info: string | null
          sms_enabled: boolean
          sms_estimated_monthly_volume: string | null
          sms_help_message: string | null
          sms_notification_email: string | null
          sms_opt_in_keywords: string | null
          sms_opt_in_message: string | null
          sms_opt_in_type: string | null
          sms_privacy_policy_url: string | null
          sms_proof_of_consent_url: string | null
          sms_sample_message: string | null
          sms_sender_name: string | null
          sms_stop_message: string | null
          sms_terms_conditions_url: string | null
          sms_use_case_categories: string | null
          sms_use_case_description: string | null
          tenant_id: string
          twilio_account_sid: string | null
          twilio_from_phone: string | null
          twilio_messaging_service_sid: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          app_base_url?: string | null
          app_subdomain?: string | null
          company_address?: string | null
          company_email?: string | null
          company_name?: string | null
          company_phone?: string | null
          company_website?: string | null
          created_at?: string
          created_by?: string | null
          default_repair_task_type_id_for_damage?: string | null
          default_repair_task_type_id_for_quote?: string | null
          email_signature_custom_text?: string | null
          email_signature_enabled?: boolean
          id?: string
          logo_storage_path?: string | null
          logo_url?: string | null
          office_alert_emails?: string | null
          remit_address_line1?: string | null
          remit_address_line2?: string | null
          remit_city?: string | null
          remit_state?: string | null
          remit_zip?: string | null
          sms_additional_info?: string | null
          sms_enabled?: boolean
          sms_estimated_monthly_volume?: string | null
          sms_help_message?: string | null
          sms_notification_email?: string | null
          sms_opt_in_keywords?: string | null
          sms_opt_in_message?: string | null
          sms_opt_in_type?: string | null
          sms_privacy_policy_url?: string | null
          sms_proof_of_consent_url?: string | null
          sms_sample_message?: string | null
          sms_sender_name?: string | null
          sms_stop_message?: string | null
          sms_terms_conditions_url?: string | null
          sms_use_case_categories?: string | null
          sms_use_case_description?: string | null
          tenant_id: string
          twilio_account_sid?: string | null
          twilio_from_phone?: string | null
          twilio_messaging_service_sid?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          app_base_url?: string | null
          app_subdomain?: string | null
          company_address?: string | null
          company_email?: string | null
          company_name?: string | null
          company_phone?: string | null
          company_website?: string | null
          created_at?: string
          created_by?: string | null
          default_repair_task_type_id_for_damage?: string | null
          default_repair_task_type_id_for_quote?: string | null
          email_signature_custom_text?: string | null
          email_signature_enabled?: boolean
          id?: string
          logo_storage_path?: string | null
          logo_url?: string | null
          office_alert_emails?: string | null
          remit_address_line1?: string | null
          remit_address_line2?: string | null
          remit_city?: string | null
          remit_state?: string | null
          remit_zip?: string | null
          sms_additional_info?: string | null
          sms_enabled?: boolean
          sms_estimated_monthly_volume?: string | null
          sms_help_message?: string | null
          sms_notification_email?: string | null
          sms_opt_in_keywords?: string | null
          sms_opt_in_message?: string | null
          sms_opt_in_type?: string | null
          sms_privacy_policy_url?: string | null
          sms_proof_of_consent_url?: string | null
          sms_sample_message?: string | null
          sms_sender_name?: string | null
          sms_stop_message?: string | null
          sms_terms_conditions_url?: string | null
          sms_use_case_categories?: string | null
          sms_use_case_description?: string | null
          tenant_id?: string
          twilio_account_sid?: string | null
          twilio_from_phone?: string | null
          twilio_messaging_service_sid?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_company_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_company_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_company_settings_default_repair_task_type_id_for_da_fkey"
            columns: ["default_repair_task_type_id_for_damage"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_company_settings_default_repair_task_type_id_for_qu_fkey"
            columns: ["default_repair_task_type_id_for_quote"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_company_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_company_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_company_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_custom_fields: {
        Row: {
          created_at: string
          deleted_at: string | null
          field_name: string
          field_order: number
          field_type: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          field_name: string
          field_order?: number
          field_type?: string
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          field_name?: string
          field_order?: number
          field_type?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_custom_fields_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_email_layouts: {
        Row: {
          background_color: string | null
          body_font_size: string | null
          content_padding: number | null
          created_at: string | null
          custom_css: string | null
          font_family: string | null
          footer_background_color: string | null
          footer_links: Json | null
          footer_text: string | null
          header_background_color: string | null
          header_font_size: string | null
          id: string
          is_active: boolean | null
          layout_width: number | null
          logo_height: number | null
          logo_url: string | null
          logo_width: number | null
          primary_color: string | null
          secondary_color: string | null
          social_links: Json | null
          tenant_id: string
          text_color: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          background_color?: string | null
          body_font_size?: string | null
          content_padding?: number | null
          created_at?: string | null
          custom_css?: string | null
          font_family?: string | null
          footer_background_color?: string | null
          footer_links?: Json | null
          footer_text?: string | null
          header_background_color?: string | null
          header_font_size?: string | null
          id?: string
          is_active?: boolean | null
          layout_width?: number | null
          logo_height?: number | null
          logo_url?: string | null
          logo_width?: number | null
          primary_color?: string | null
          secondary_color?: string | null
          social_links?: Json | null
          tenant_id: string
          text_color?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          background_color?: string | null
          body_font_size?: string | null
          content_padding?: number | null
          created_at?: string | null
          custom_css?: string | null
          font_family?: string | null
          footer_background_color?: string | null
          footer_links?: Json | null
          footer_text?: string | null
          header_background_color?: string | null
          header_font_size?: string | null
          id?: string
          is_active?: boolean | null
          layout_width?: number | null
          logo_height?: number | null
          logo_url?: string | null
          logo_width?: number | null
          primary_color?: string | null
          secondary_color?: string | null
          social_links?: Json | null
          tenant_id?: string
          text_color?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_email_layouts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_email_layouts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_email_layouts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_inbound_email_events: {
        Row: {
          error_message: string | null
          forward_status: string
          forwarded_to: string | null
          from_address: string | null
          id: string
          metadata: Json
          provider: string
          received_at: string
          subject: string | null
          tenant_id: string | null
          to_address: string | null
        }
        Insert: {
          error_message?: string | null
          forward_status?: string
          forwarded_to?: string | null
          from_address?: string | null
          id?: string
          metadata?: Json
          provider?: string
          received_at?: string
          subject?: string | null
          tenant_id?: string | null
          to_address?: string | null
        }
        Update: {
          error_message?: string | null
          forward_status?: string
          forwarded_to?: string | null
          from_address?: string | null
          id?: string
          metadata?: Json
          provider?: string
          received_at?: string
          subject?: string | null
          tenant_id?: string | null
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_inbound_email_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_inbound_email_settings: {
        Row: {
          created_at: string
          forward_to_email: string | null
          is_enabled: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          forward_to_email?: string | null
          is_enabled?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          forward_to_email?: string | null
          is_enabled?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_inbound_email_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_inbound_email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_inbound_email_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_legal_pages: {
        Row: {
          content: string
          content_format: string
          created_at: string
          created_by: string | null
          effective_date: string | null
          id: string
          is_active: boolean
          page_type: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          content: string
          content_format?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean
          page_type: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          content?: string
          content_format?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean
          page_type?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_legal_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_preferences: {
        Row: {
          additional_piece_rate: number | null
          allow_billing_to_account: boolean | null
          allow_billing_to_consumer: boolean | null
          allow_felt_pads: boolean | null
          allow_typed_name_as_signature: boolean | null
          auto_apply_arrival_no_id_flag: boolean
          auto_assembly_on_receiving: boolean | null
          auto_repair_on_damage: boolean | null
          base_order_minutes: number | null
          base_rate_includes_pieces: number | null
          break_every_hours: number | null
          break_minutes: number | null
          created_at: string
          custom_field_1_label: string | null
          custom_field_1_required: boolean | null
          daily_storage_rate_per_cuft: number
          default_net_terms: number | null
          default_order_bill_to: string | null
          default_shipment_notes: string | null
          exchange_order_addition: number | null
          extra_furniture_moving_minimum: number | null
          extra_stop_rate: number | null
          free_storage_days: number
          high_rise_additional_piece_fee: number | null
          hourly_rate: number | null
          id: string
          invoice_payment_tracking_mode: string | null
          items_to_switch_to_hourly: number | null
          label_config: Json | null
          late_cancellation_fee: number | null
          max_assemblies_in_base_rate: number | null
          minutes_before_arrival_notification: number | null
          morning_starts_at: string | null
          num_reservation_date_choices: number | null
          order_field_label: string | null
          order_field_required: boolean | null
          privacy_policy_url: string | null
          receiving_charge_minimum: number | null
          removal_extra_piece_default: number | null
          removal_first_2_pieces: number | null
          require_signature_to_finish: boolean | null
          reservation_cut_off_time: string | null
          reservation_prep_days_required: number | null
          sales_tax_rate: number | null
          shipment_minimum: number | null
          should_create_inspections: boolean
          show_warehouse_in_location: boolean | null
          tenant_id: string
          terms_of_service_url: string | null
          time_tracking_allow_concurrent_shipments: boolean
          time_tracking_allow_concurrent_stocktakes: boolean
          time_tracking_allow_concurrent_tasks: boolean
          updated_at: string
          will_call_minimum: number
          window_length_hours: number | null
        }
        Insert: {
          additional_piece_rate?: number | null
          allow_billing_to_account?: boolean | null
          allow_billing_to_consumer?: boolean | null
          allow_felt_pads?: boolean | null
          allow_typed_name_as_signature?: boolean | null
          auto_apply_arrival_no_id_flag?: boolean
          auto_assembly_on_receiving?: boolean | null
          auto_repair_on_damage?: boolean | null
          base_order_minutes?: number | null
          base_rate_includes_pieces?: number | null
          break_every_hours?: number | null
          break_minutes?: number | null
          created_at?: string
          custom_field_1_label?: string | null
          custom_field_1_required?: boolean | null
          daily_storage_rate_per_cuft?: number
          default_net_terms?: number | null
          default_order_bill_to?: string | null
          default_shipment_notes?: string | null
          exchange_order_addition?: number | null
          extra_furniture_moving_minimum?: number | null
          extra_stop_rate?: number | null
          free_storage_days?: number
          high_rise_additional_piece_fee?: number | null
          hourly_rate?: number | null
          id?: string
          invoice_payment_tracking_mode?: string | null
          items_to_switch_to_hourly?: number | null
          label_config?: Json | null
          late_cancellation_fee?: number | null
          max_assemblies_in_base_rate?: number | null
          minutes_before_arrival_notification?: number | null
          morning_starts_at?: string | null
          num_reservation_date_choices?: number | null
          order_field_label?: string | null
          order_field_required?: boolean | null
          privacy_policy_url?: string | null
          receiving_charge_minimum?: number | null
          removal_extra_piece_default?: number | null
          removal_first_2_pieces?: number | null
          require_signature_to_finish?: boolean | null
          reservation_cut_off_time?: string | null
          reservation_prep_days_required?: number | null
          sales_tax_rate?: number | null
          shipment_minimum?: number | null
          should_create_inspections?: boolean
          show_warehouse_in_location?: boolean | null
          tenant_id: string
          terms_of_service_url?: string | null
          time_tracking_allow_concurrent_shipments?: boolean
          time_tracking_allow_concurrent_stocktakes?: boolean
          time_tracking_allow_concurrent_tasks?: boolean
          updated_at?: string
          will_call_minimum?: number
          window_length_hours?: number | null
        }
        Update: {
          additional_piece_rate?: number | null
          allow_billing_to_account?: boolean | null
          allow_billing_to_consumer?: boolean | null
          allow_felt_pads?: boolean | null
          allow_typed_name_as_signature?: boolean | null
          auto_apply_arrival_no_id_flag?: boolean
          auto_assembly_on_receiving?: boolean | null
          auto_repair_on_damage?: boolean | null
          base_order_minutes?: number | null
          base_rate_includes_pieces?: number | null
          break_every_hours?: number | null
          break_minutes?: number | null
          created_at?: string
          custom_field_1_label?: string | null
          custom_field_1_required?: boolean | null
          daily_storage_rate_per_cuft?: number
          default_net_terms?: number | null
          default_order_bill_to?: string | null
          default_shipment_notes?: string | null
          exchange_order_addition?: number | null
          extra_furniture_moving_minimum?: number | null
          extra_stop_rate?: number | null
          free_storage_days?: number
          high_rise_additional_piece_fee?: number | null
          hourly_rate?: number | null
          id?: string
          invoice_payment_tracking_mode?: string | null
          items_to_switch_to_hourly?: number | null
          label_config?: Json | null
          late_cancellation_fee?: number | null
          max_assemblies_in_base_rate?: number | null
          minutes_before_arrival_notification?: number | null
          morning_starts_at?: string | null
          num_reservation_date_choices?: number | null
          order_field_label?: string | null
          order_field_required?: boolean | null
          privacy_policy_url?: string | null
          receiving_charge_minimum?: number | null
          removal_extra_piece_default?: number | null
          removal_first_2_pieces?: number | null
          require_signature_to_finish?: boolean | null
          reservation_cut_off_time?: string | null
          reservation_prep_days_required?: number | null
          sales_tax_rate?: number | null
          shipment_minimum?: number | null
          should_create_inspections?: boolean
          show_warehouse_in_location?: boolean | null
          tenant_id?: string
          terms_of_service_url?: string | null
          time_tracking_allow_concurrent_shipments?: boolean
          time_tracking_allow_concurrent_stocktakes?: boolean
          time_tracking_allow_concurrent_tasks?: boolean
          updated_at?: string
          will_call_minimum?: number
          window_length_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_prompt_defaults: {
        Row: {
          auto_suggestion_enabled: boolean | null
          competency_max_errors: number | null
          competency_max_location_errors: number | null
          competency_max_missing_photos: number | null
          competency_tasks_required: number | null
          created_at: string | null
          default_prompt_level: string | null
          default_reminder_days: number | null
          id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          auto_suggestion_enabled?: boolean | null
          competency_max_errors?: number | null
          competency_max_location_errors?: number | null
          competency_max_missing_photos?: number | null
          competency_tasks_required?: number | null
          created_at?: string | null
          default_prompt_level?: string | null
          default_reminder_days?: number | null
          id?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          auto_suggestion_enabled?: boolean | null
          competency_max_errors?: number | null
          competency_max_location_errors?: number | null
          competency_max_missing_photos?: number | null
          competency_tasks_required?: number | null
          created_at?: string | null
          default_prompt_level?: string | null
          default_reminder_days?: number | null
          id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_prompt_defaults_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          default_currency: string | null
          default_tax_rate_percent: number | null
          free_storage_days: number | null
          id: string
          quote_terms_and_conditions: string | null
          quote_validity_days: number | null
          setting_key: string
          setting_value: Json | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_currency?: string | null
          default_tax_rate_percent?: number | null
          free_storage_days?: number | null
          id?: string
          quote_terms_and_conditions?: string | null
          quote_validity_days?: number | null
          setting_key: string
          setting_value?: Json | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_currency?: string | null
          default_tax_rate_percent?: number | null
          free_storage_days?: number | null
          id?: string
          quote_terms_and_conditions?: string | null
          quote_validity_days?: number | null
          setting_key?: string
          setting_value?: Json | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_sms_addon_activation: {
        Row: {
          acceptance_source: string | null
          activated_at: string | null
          activation_status: string
          created_at: string
          ip_address: string | null
          is_active: boolean
          tenant_id: string
          terms_accepted_at: string | null
          terms_accepted_by: string | null
          terms_version: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          acceptance_source?: string | null
          activated_at?: string | null
          activation_status?: string
          created_at?: string
          ip_address?: string | null
          is_active?: boolean
          tenant_id: string
          terms_accepted_at?: string | null
          terms_accepted_by?: string | null
          terms_version?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          acceptance_source?: string | null
          activated_at?: string | null
          activation_status?: string
          created_at?: string
          ip_address?: string | null
          is_active?: boolean
          tenant_id?: string
          terms_accepted_at?: string | null
          terms_accepted_by?: string | null
          terms_version?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_sms_addon_activation_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_sms_addon_activation_log: {
        Row: {
          acceptance_source: string | null
          accepted_by: string | null
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json
          tenant_id: string
          terms_version: string | null
          user_agent: string | null
        }
        Insert: {
          acceptance_source?: string | null
          accepted_by?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          tenant_id: string
          terms_version?: string | null
          user_agent?: string | null
        }
        Update: {
          acceptance_source?: string | null
          accepted_by?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json
          tenant_id?: string
          terms_version?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_sms_addon_activation_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_sms_sender_profile_log: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          notes: string | null
          status_from: string | null
          status_to: string | null
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          notes?: string | null
          status_from?: string | null
          status_to?: string | null
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          notes?: string | null
          status_from?: string | null
          status_to?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_sms_sender_profile_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_sms_sender_profiles: {
        Row: {
          billing_start_at: string | null
          created_at: string
          last_error: string | null
          metadata: Json
          provisioning_status: string
          requested_at: string | null
          requested_by: string | null
          sender_type: string
          tenant_id: string
          twilio_phone_number_e164: string | null
          twilio_phone_number_sid: string | null
          updated_at: string
          verification_approved_at: string | null
          verification_rejected_at: string | null
          verification_submitted_at: string | null
        }
        Insert: {
          billing_start_at?: string | null
          created_at?: string
          last_error?: string | null
          metadata?: Json
          provisioning_status?: string
          requested_at?: string | null
          requested_by?: string | null
          sender_type?: string
          tenant_id: string
          twilio_phone_number_e164?: string | null
          twilio_phone_number_sid?: string | null
          updated_at?: string
          verification_approved_at?: string | null
          verification_rejected_at?: string | null
          verification_submitted_at?: string | null
        }
        Update: {
          billing_start_at?: string | null
          created_at?: string
          last_error?: string | null
          metadata?: Json
          provisioning_status?: string
          requested_at?: string | null
          requested_by?: string | null
          sender_type?: string
          tenant_id?: string
          twilio_phone_number_e164?: string | null
          twilio_phone_number_sid?: string | null
          updated_at?: string
          verification_approved_at?: string | null
          verification_rejected_at?: string | null
          verification_submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_sms_sender_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscription_invoices: {
        Row: {
          amount_due: number
          amount_paid: number
          amount_remaining: number
          created_at: string
          currency: string | null
          due_date: string | null
          hosted_invoice_url: string | null
          id: string
          invoice_pdf: string | null
          metadata: Json
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          status: string
          stripe_created_at: string | null
          stripe_customer_id: string | null
          stripe_invoice_id: string
          stripe_subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          amount_remaining?: number
          created_at?: string
          currency?: string | null
          due_date?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf?: string | null
          metadata?: Json
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status: string
          stripe_created_at?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id: string
          stripe_subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          amount_remaining?: number
          created_at?: string
          currency?: string | null
          due_date?: string | null
          hosted_invoice_url?: string | null
          id?: string
          invoice_pdf?: string | null
          metadata?: Json
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_created_at?: string | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string
          stripe_subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscription_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscriptions: {
        Row: {
          base_price_override: number | null
          billable_seat_count: number | null
          billable_seat_count_updated_at: string | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          grace_until: string | null
          last_payment_failed_at: string | null
          per_user_override: number | null
          plan_id: string | null
          promo_expiration_date: string | null
          sms_subscription_items_sync_error: string | null
          sms_subscription_items_synced_at: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          stripe_subscription_item_id_per_user: string | null
          stripe_subscription_item_id_sms_metered: string | null
          stripe_subscription_item_id_sms_monthly: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          base_price_override?: number | null
          billable_seat_count?: number | null
          billable_seat_count_updated_at?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          grace_until?: string | null
          last_payment_failed_at?: string | null
          per_user_override?: number | null
          plan_id?: string | null
          promo_expiration_date?: string | null
          sms_subscription_items_sync_error?: string | null
          sms_subscription_items_synced_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          stripe_subscription_item_id_per_user?: string | null
          stripe_subscription_item_id_sms_metered?: string | null
          stripe_subscription_item_id_sms_monthly?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          base_price_override?: number | null
          billable_seat_count?: number | null
          billable_seat_count_updated_at?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          grace_until?: string | null
          last_payment_failed_at?: string | null
          per_user_override?: number | null
          plan_id?: string | null
          promo_expiration_date?: string | null
          sms_subscription_items_sync_error?: string | null
          sms_subscription_items_synced_at?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          stripe_subscription_item_id_per_user?: string | null
          stripe_subscription_item_id_sms_metered?: string | null
          stripe_subscription_item_id_sms_monthly?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "saas_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_template_rollout_decisions: {
        Row: {
          decided_at: string
          decided_by: string | null
          decision: string
          id: string
          rollout_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          decided_at?: string
          decided_by?: string | null
          decision: string
          id?: string
          rollout_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          decided_at?: string
          decided_by?: string | null
          decision?: string
          id?: string
          rollout_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_template_rollout_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_template_rollout_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_template_rollout_decisions_rollout_id_fkey"
            columns: ["rollout_id"]
            isOneToOne: false
            referencedRelation: "platform_template_rollouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_template_rollout_decisions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_template_rollout_preferences: {
        Row: {
          opt_out_non_critical: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          opt_out_non_critical?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          opt_out_non_critical?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_template_rollout_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_template_rollout_preferences_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_template_rollout_preferences_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          brand_settings: Json | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          settings: Json | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          brand_settings?: Json | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          settings?: Json | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          brand_settings?: Json | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          settings?: Json | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ui_ai_reviews: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          id: string
          mode: string | null
          model_used: string | null
          run_id: string
          screenshot_count: number | null
          status: string
          suggestions: Json | null
          summary: string | null
          tenant_id: string
          tokens_used: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          mode?: string | null
          model_used?: string | null
          run_id: string
          screenshot_count?: number | null
          status?: string
          suggestions?: Json | null
          summary?: string | null
          tenant_id: string
          tokens_used?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          id?: string
          mode?: string | null
          model_used?: string | null
          run_id?: string
          screenshot_count?: number | null
          status?: string
          suggestions?: Json | null
          summary?: string | null
          tenant_id?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ui_ai_reviews_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ui_ai_reviews_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ui_ai_reviews_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qa_test_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ui_ai_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_accounts: {
        Row: {
          access_level: string | null
          account_id: string
          created_at: string | null
          deleted_at: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_level?: string | null
          account_id: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_level?: string | null
          account_id?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dashboard_preferences: {
        Row: {
          card_order: Json | null
          created_at: string
          hidden_cards: Json | null
          id: string
          test_email: string | null
          test_phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          card_order?: Json | null
          created_at?: string
          hidden_cards?: Json | null
          id?: string
          test_email?: string | null
          test_phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          card_order?: Json | null
          created_at?: string
          hidden_cards?: Json | null
          id?: string
          test_email?: string | null
          test_phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_dashboard_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_dashboard_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      user_departments: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          department_id: string
          id: string
          is_primary: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department_id: string
          id?: string
          is_primary?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department_id?: string
          id?: string
          is_primary?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_departments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_departments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_departments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_departments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string | null
          id: string
          preference_key: string
          preference_value: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          preference_key: string
          preference_value?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          preference_key?: string
          preference_value?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      user_prompt_dismissals: {
        Row: {
          dismissed_at: string
          id: string
          prompt_id: string
          snooze_until: string | null
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          id?: string
          prompt_id: string
          snooze_until?: string | null
          user_id: string
        }
        Update: {
          dismissed_at?: string
          id?: string
          prompt_id?: string
          snooze_until?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_prompt_settings: {
        Row: {
          created_at: string | null
          id: string
          manager_notified_for_upgrade: boolean | null
          prompt_level: string
          prompt_reminder_days: number | null
          prompts_enabled_at: string | null
          reminder_sent_at: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_id: string
          user_notified_for_upgrade: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          manager_notified_for_upgrade?: boolean | null
          prompt_level?: string
          prompt_reminder_days?: number | null
          prompts_enabled_at?: string | null
          reminder_sent_at?: string | null
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
          user_id: string
          user_notified_for_upgrade?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          manager_notified_for_upgrade?: boolean | null
          prompt_level?: string
          prompt_reminder_days?: number | null
          prompts_enabled_at?: string | null
          reminder_sent_at?: string | null
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
          user_id?: string
          user_notified_for_upgrade?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "user_prompt_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_prompt_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_prompt_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_prompt_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_prompt_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          created_at: string
          deleted_at: string | null
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          account_id: string | null
          cost_center: string | null
          created_at: string
          deleted_at: string | null
          email: string
          enrolled: boolean | null
          enrolled_at: string | null
          first_name: string | null
          id: string
          invite_expires_at: string | null
          invite_token: string | null
          invited_at: string | null
          labor_rate: number | null
          last_login_at: string | null
          last_name: string | null
          overtime_eligible: boolean | null
          password_hash: string
          pay_rate: number | null
          pay_type: string | null
          phone: string | null
          status: string
          tenant_id: string
          updated_at: string
          username: string | null
          username_is_manual: boolean
          username_updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          cost_center?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          enrolled?: boolean | null
          enrolled_at?: string | null
          first_name?: string | null
          id?: string
          invite_expires_at?: string | null
          invite_token?: string | null
          invited_at?: string | null
          labor_rate?: number | null
          last_login_at?: string | null
          last_name?: string | null
          overtime_eligible?: boolean | null
          password_hash: string
          pay_rate?: number | null
          pay_type?: string | null
          phone?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          username?: string | null
          username_is_manual?: boolean
          username_updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          cost_center?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          enrolled?: boolean | null
          enrolled_at?: string | null
          first_name?: string | null
          id?: string
          invite_expires_at?: string | null
          invite_token?: string | null
          invited_at?: string | null
          labor_rate?: number | null
          last_login_at?: string | null
          last_name?: string | null
          overtime_eligible?: boolean | null
          password_hash?: string
          pay_rate?: number | null
          pay_type?: string | null
          phone?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          username?: string | null
          username_is_manual?: boolean
          username_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_map_nodes: {
        Row: {
          created_at: string
          created_by: string | null
          group_label: string | null
          height: number
          id: string
          label: string | null
          sort_order: number | null
          updated_at: string
          updated_by: string | null
          warehouse_map_id: string
          width: number
          x: number
          y: number
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          group_label?: string | null
          height?: number
          id?: string
          label?: string | null
          sort_order?: number | null
          updated_at?: string
          updated_by?: string | null
          warehouse_map_id: string
          width?: number
          x?: number
          y?: number
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          group_label?: string | null
          height?: number
          id?: string
          label?: string | null
          sort_order?: number | null
          updated_at?: string
          updated_by?: string | null
          warehouse_map_id?: string
          width?: number
          x?: number
          y?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_map_nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_map_nodes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_map_nodes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_map_nodes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_map_nodes_warehouse_map_id_fkey"
            columns: ["warehouse_map_id"]
            isOneToOne: false
            referencedRelation: "warehouse_maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_map_nodes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "warehouse_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_maps: {
        Row: {
          created_at: string
          created_by: string | null
          grid_size: number
          height: number
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          warehouse_id: string
          width: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          grid_size?: number
          height?: number
          id?: string
          is_default?: boolean
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
          width?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          grid_size?: number
          height?: number
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_maps_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_maps_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_maps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_maps_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_maps_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_maps_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_permissions: {
        Row: {
          created_at: string
          deleted_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          user_id: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_permissions_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_zones: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          sort_order: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          warehouse_id: string
          zone_code: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          sort_order?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
          zone_code: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          sort_order?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
          zone_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_zones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_zones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_zones_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_zones_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_zones_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_zones_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          code: string
          country: string | null
          created_at: string
          default_outbound_location_id: string | null
          default_receiving_location_id: string | null
          deleted_at: string | null
          id: string
          name: string
          postal_code: string | null
          settings: Json | null
          state: string | null
          status: string
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          code: string
          country?: string | null
          created_at?: string
          default_outbound_location_id?: string | null
          default_receiving_location_id?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          postal_code?: string | null
          settings?: Json | null
          state?: string | null
          status?: string
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          code?: string
          country?: string | null
          created_at?: string
          default_outbound_location_id?: string | null
          default_receiving_location_id?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          postal_code?: string | null
          settings?: Json | null
          state?: string | null
          status?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_default_outbound_location_id_fkey"
            columns: ["default_outbound_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_default_receiving_location_id_fkey"
            columns: ["default_receiving_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      will_call_items: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          item_code: string
          item_id: string | null
          quantity: number | null
          will_call_order_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          item_code: string
          item_id?: string | null
          quantity?: number | null
          will_call_order_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          item_code?: string
          item_id?: string | null
          quantity?: number | null
          will_call_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "will_call_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "will_call_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "will_call_items_will_call_order_id_fkey"
            columns: ["will_call_order_id"]
            isOneToOne: false
            referencedRelation: "will_call_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      will_call_orders: {
        Row: {
          bill_to: string | null
          client_account: string | null
          client_name: string
          completed_at: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          metadata: Json | null
          notes: string | null
          order_number: string
          picked_up_at: string | null
          picked_up_by: string | null
          scheduled_pickup_at: string | null
          signature_data: string | null
          signature_name: string | null
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          bill_to?: string | null
          client_account?: string | null
          client_name: string
          completed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          order_number: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          scheduled_pickup_at?: string | null
          signature_data?: string | null
          signature_name?: string | null
          status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          bill_to?: string | null
          client_account?: string | null
          client_name?: string
          completed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          order_number?: string
          picked_up_at?: string | null
          picked_up_by?: string | null
          scheduled_pickup_at?: string | null
          signature_data?: string | null
          signature_name?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "will_call_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      job_time_intervals_report_v1: {
        Row: {
          account_id: string | null
          account_name: string | null
          created_at: string | null
          duration_minutes: number | null
          elapsed_minutes: number | null
          ended_at: string | null
          ended_reason: string | null
          id: string | null
          is_active: boolean | null
          job_completed_at: string | null
          job_id: string | null
          job_label: string | null
          job_status: string | null
          job_subtype: string | null
          job_type: string | null
          started_at: string | null
          tenant_id: string | null
          user_email: string | null
          user_id: string | null
          user_name: string | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_time_intervals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_time_intervals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_time_intervals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      service_time_jobs_report_v1: {
        Row: {
          account_id: string | null
          account_name: string | null
          actual_cycle_minutes: number | null
          actual_minutes: number | null
          actual_snapshot_at: string | null
          completed_at: string | null
          estimated_minutes: number | null
          estimated_snapshot_at: string | null
          id: string | null
          job_id: string | null
          job_label: string | null
          job_status: string | null
          job_subtype: string | null
          job_type: string | null
          tenant_id: string | null
          variance_minutes: number | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Relationships: []
      }
      users_report_v1: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string | null
          last_name: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: never
          id?: string | null
          last_name?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: never
          id?: string | null
          last_name?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_account_credit_balance: {
        Row: {
          account_id: string | null
          account_name: string | null
          active_credits_count: number | null
          available_credit: number | null
          tenant_id: string | null
          total_credits_applied: number | null
          total_credits_issued: number | null
        }
        Relationships: []
      }
      v_claims_with_items: {
        Row: {
          acceptance_token: string | null
          acceptance_token_expires_at: string | null
          account_id: string | null
          account_name: string | null
          admin_approval_notes: string | null
          admin_approved_at: string | null
          admin_approved_by: string | null
          approved_amount: number | null
          approved_payout_amount: number | null
          assigned_to: string | null
          claim_number: string | null
          claim_type: string | null
          claim_value_calculated: number | null
          claim_value_requested: number | null
          claimed_amount: number | null
          client_initiated: boolean | null
          counter_offer_amount: number | null
          counter_offer_notes: string | null
          coverage_snapshot: Json | null
          coverage_type: string | null
          created_at: string | null
          decline_reason: string | null
          deductible: number | null
          deductible_applied: number | null
          deleted_at: string | null
          description: string | null
          determination_sent_at: string | null
          documents: Json | null
          filed_at: string | null
          filed_by: string | null
          id: string | null
          incident_contact_email: string | null
          incident_contact_name: string | null
          incident_contact_phone: string | null
          incident_date: string | null
          incident_location: string | null
          internal_notes: string | null
          item_count: number | null
          item_id: string | null
          items_total_approved: number | null
          items_total_requested: number | null
          non_inventory_ref: string | null
          payout_method: string | null
          payout_reference: string | null
          photos: Json | null
          public_notes: string | null
          repair_task_created_id: string | null
          requires_admin_approval: boolean | null
          requires_manager_approval: boolean | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          sent_for_acceptance_at: string | null
          sent_for_acceptance_by: string | null
          settlement_acceptance_required: boolean | null
          settlement_accepted_at: string | null
          settlement_accepted_by: string | null
          settlement_accepted_ip: string | null
          settlement_declined_at: string | null
          settlement_declined_by: string | null
          settlement_terms_text: string | null
          settlement_terms_version: string | null
          shipment_id: string | null
          sidemark_id: string | null
          sidemark_name: string | null
          status: string | null
          status_before_acceptance: string | null
          tenant_id: string | null
          total_approved_amount: number | null
          total_deductible: number | null
          total_requested_amount: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claims_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_admin_approved_by_fkey"
            columns: ["admin_approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_admin_approved_by_fkey"
            columns: ["admin_approved_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_filed_by_fkey"
            columns: ["filed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_filed_by_fkey"
            columns: ["filed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_sent_for_acceptance_by_fkey"
            columns: ["sent_for_acceptance_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_sent_for_acceptance_by_fkey"
            columns: ["sent_for_acceptance_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "v_shipments_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_sidemark_id_fkey"
            columns: ["sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_items_with_location: {
        Row: {
          account_id: string | null
          client_account: string | null
          created_at: string | null
          current_location_id: string | null
          deleted_at: string | null
          description: string | null
          id: string | null
          item_code: string | null
          location_code: string | null
          location_id: string | null
          location_name: string | null
          location_type: string | null
          metadata: Json | null
          primary_photo_url: string | null
          quantity: number | null
          received_at: string | null
          room: string | null
          sidemark: string | null
          size: number | null
          size_unit: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          vendor: string | null
          warehouse_code: string | null
          warehouse_id: string | null
          warehouse_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_current_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      v_manifest_stats: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          created_by: string | null
          duplicate_scans: number | null
          expected_item_count: number | null
          manifest_id: string | null
          manifest_number: string | null
          name: string | null
          progress_percent: number | null
          rejected_scans: number | null
          remaining_items: number | null
          scanned_item_count: number | null
          started_at: string | null
          started_by: string | null
          status: string | null
          valid_scans: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_manifests_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stocktake_manifests_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
        ]
      }
      v_movement_history: {
        Row: {
          action_type: string | null
          actor_email: string | null
          actor_first_name: string | null
          actor_id: string | null
          actor_last_name: string | null
          actor_type: string | null
          batch_id: string | null
          created_at: string | null
          from_location_code: string | null
          from_location_id: string | null
          id: string | null
          item_code: string | null
          item_description: string | null
          item_id: string | null
          metadata: Json | null
          moved_at: string | null
          note: string | null
          quantity: number | null
          to_location_code: string | null
          to_location_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movements_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      v_shipments_canonical: {
        Row: {
          account_id: string | null
          bill_to: string | null
          carrier: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          driver_name: string | null
          expected_arrival_date: string | null
          highlight_notes: boolean | null
          id: string | null
          liability_accepted: boolean | null
          metadata: Json | null
          notes: string | null
          outbound_type_id: string | null
          payment_amount: number | null
          payment_method: string | null
          payment_reference: string | null
          payment_status: string | null
          po_number: string | null
          received_at: string | null
          receiving_documents: Json | null
          receiving_notes: string | null
          receiving_photos: Json | null
          release_to_email: string | null
          release_to_name: string | null
          release_to_phone: string | null
          release_type: string | null
          release_type_canonical:
            | Database["public"]["Enums"]["canonical_release_type"]
            | null
          return_type: string | null
          shipment_number: string | null
          shipment_type: string | null
          shipped_at: string | null
          sidemark: string | null
          sidemark_id: string | null
          signature_data: string | null
          signature_name: string | null
          signature_timestamp: string | null
          status: string | null
          tenant_id: string | null
          tracking_number: string | null
          updated_at: string | null
          warehouse_id: string | null
        }
        Insert: {
          account_id?: string | null
          bill_to?: string | null
          carrier?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          driver_name?: string | null
          expected_arrival_date?: string | null
          highlight_notes?: boolean | null
          id?: string | null
          liability_accepted?: boolean | null
          metadata?: Json | null
          notes?: string | null
          outbound_type_id?: string | null
          payment_amount?: number | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          po_number?: string | null
          received_at?: string | null
          receiving_documents?: Json | null
          receiving_notes?: string | null
          receiving_photos?: Json | null
          release_to_email?: string | null
          release_to_name?: string | null
          release_to_phone?: string | null
          release_type?: string | null
          release_type_canonical?: never
          return_type?: string | null
          shipment_number?: string | null
          shipment_type?: string | null
          shipped_at?: string | null
          sidemark?: string | null
          sidemark_id?: string | null
          signature_data?: string | null
          signature_name?: string | null
          signature_timestamp?: string | null
          status?: string | null
          tenant_id?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
        }
        Update: {
          account_id?: string | null
          bill_to?: string | null
          carrier?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          driver_name?: string | null
          expected_arrival_date?: string | null
          highlight_notes?: boolean | null
          id?: string | null
          liability_accepted?: boolean | null
          metadata?: Json | null
          notes?: string | null
          outbound_type_id?: string | null
          payment_amount?: number | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string | null
          po_number?: string | null
          received_at?: string | null
          receiving_documents?: Json | null
          receiving_notes?: string | null
          receiving_photos?: Json | null
          release_to_email?: string | null
          release_to_name?: string | null
          release_to_phone?: string | null
          release_type?: string | null
          release_type_canonical?: never
          return_type?: string | null
          shipment_number?: string | null
          shipment_type?: string | null
          shipped_at?: string | null
          sidemark?: string | null
          sidemark_id?: string | null
          signature_data?: string | null
          signature_name?: string | null
          signature_timestamp?: string | null
          status?: string | null
          tenant_id?: string | null
          tracking_number?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_outbound_type_id_fkey"
            columns: ["outbound_type_id"]
            isOneToOne: false
            referencedRelation: "outbound_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_sidemark_id_fkey"
            columns: ["sidemark_id"]
            isOneToOne: false
            referencedRelation: "sidemarks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      v_tasks_canonical: {
        Row: {
          account_id: string | null
          assigned_department: string | null
          assigned_to: string | null
          bill_to: string | null
          bill_to_customer_email: string | null
          bill_to_customer_name: string | null
          billing_charge_date: string | null
          billing_date: string | null
          billing_rate: number | null
          billing_rate_locked: boolean | null
          billing_rate_set_at: string | null
          billing_rate_set_by: string | null
          billing_status: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          custom_packaging_applied: boolean | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          duration_minutes: number | null
          ended_at: string | null
          ended_by: string | null
          id: string | null
          invoice_id: string | null
          metadata: Json | null
          minor_touchup_applied: boolean | null
          overdue_alert_sent_at: string | null
          pallet_sale_applied: boolean | null
          parent_task_id: string | null
          priority: string | null
          related_item_id: string | null
          service_date: string | null
          sidemark: string | null
          started_at: string | null
          started_by: string | null
          status: string | null
          status_canonical:
            | Database["public"]["Enums"]["canonical_task_status"]
            | null
          task_type: string | null
          task_type_canonical:
            | Database["public"]["Enums"]["canonical_task_type"]
            | null
          task_type_id: string | null
          tenant_id: string | null
          title: string | null
          unable_to_complete: boolean | null
          unable_to_complete_at: string | null
          unable_to_complete_by: string | null
          unable_to_complete_note: string | null
          unable_to_complete_reason: string | null
          updated_at: string | null
          warehouse_id: string | null
        }
        Insert: {
          account_id?: string | null
          assigned_department?: string | null
          assigned_to?: string | null
          bill_to?: string | null
          bill_to_customer_email?: string | null
          bill_to_customer_name?: string | null
          billing_charge_date?: string | null
          billing_date?: string | null
          billing_rate?: number | null
          billing_rate_locked?: boolean | null
          billing_rate_set_at?: string | null
          billing_rate_set_by?: string | null
          billing_status?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          custom_packaging_applied?: boolean | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string | null
          invoice_id?: string | null
          metadata?: Json | null
          minor_touchup_applied?: boolean | null
          overdue_alert_sent_at?: string | null
          pallet_sale_applied?: boolean | null
          parent_task_id?: string | null
          priority?: string | null
          related_item_id?: string | null
          service_date?: string | null
          sidemark?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string | null
          status_canonical?: never
          task_type?: string | null
          task_type_canonical?: never
          task_type_id?: string | null
          tenant_id?: string | null
          title?: string | null
          unable_to_complete?: boolean | null
          unable_to_complete_at?: string | null
          unable_to_complete_by?: string | null
          unable_to_complete_note?: string | null
          unable_to_complete_reason?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
        }
        Update: {
          account_id?: string | null
          assigned_department?: string | null
          assigned_to?: string | null
          bill_to?: string | null
          bill_to_customer_email?: string | null
          bill_to_customer_name?: string | null
          billing_charge_date?: string | null
          billing_date?: string | null
          billing_rate?: number | null
          billing_rate_locked?: boolean | null
          billing_rate_set_at?: string | null
          billing_rate_set_by?: string | null
          billing_status?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          custom_packaging_applied?: boolean | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          duration_minutes?: number | null
          ended_at?: string | null
          ended_by?: string | null
          id?: string | null
          invoice_id?: string | null
          metadata?: Json | null
          minor_touchup_applied?: boolean | null
          overdue_alert_sent_at?: string | null
          pallet_sale_applied?: boolean | null
          parent_task_id?: string | null
          priority?: string | null
          related_item_id?: string | null
          service_date?: string | null
          sidemark?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string | null
          status_canonical?: never
          task_type?: string | null
          task_type_canonical?: never
          task_type_id?: string | null
          tenant_id?: string | null
          title?: string | null
          unable_to_complete?: boolean | null
          unable_to_complete_at?: string | null
          unable_to_complete_by?: string | null
          unable_to_complete_note?: string | null
          unable_to_complete_reason?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_tasks_invoice"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_billing_rate_set_by_fkey"
            columns: ["billing_rate_set_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_billing_rate_set_by_fkey"
            columns: ["billing_rate_set_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "v_tasks_canonical"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_item_id_fkey"
            columns: ["related_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_related_item_id_fkey"
            columns: ["related_item_id"]
            isOneToOne: false
            referencedRelation: "v_items_with_location"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "users_report_v1"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _catalog_default_cta_label: {
        Args: { p_module_group: string }
        Returns: string
      }
      _catalog_default_cta_link: {
        Args: { p_module_group: string }
        Returns: string
      }
      _catalog_default_email_body: {
        Args: { p_display_name: string; p_module_group: string }
        Returns: string
      }
      _catalog_default_in_app_body: {
        Args: { p_display_name: string; p_module_group: string }
        Returns: string
      }
      _catalog_default_in_app_recipients: {
        Args: { p_audience: string }
        Returns: string
      }
      _catalog_default_sms_body: {
        Args: { p_display_name: string; p_module_group: string }
        Returns: string
      }
      _coverage_check_permission: {
        Args: { p_shipment_account_id: string }
        Returns: undefined
      }
      _coverage_get_caller_context: {
        Args: never
        Returns: {
          caller_account_id: string
          caller_role: string
          caller_tenant_id: string
        }[]
      }
      _ensure_catalog_trigger_for_all_tenants: {
        Args: { p_trigger_key: string }
        Returns: Json
      }
      _ensure_catalog_trigger_for_tenant: {
        Args: { p_tenant_id: string; p_trigger_key: string }
        Returns: Json
      }
      _replace_legacy_note_placeholders: {
        Args: { p_input: string; p_replacement: string }
        Returns: string
      }
      accept_claim_settlement: {
        Args: { p_ip_address?: string; p_token: string; p_user_agent?: string }
        Returns: Json
      }
      add_manifest_items_bulk: {
        Args: {
          p_added_by: string
          p_item_ids: string[]
          p_manifest_id: string
        }
        Returns: {
          items_added: number
          message: string
          success: boolean
        }[]
      }
      apply_core_defaults: {
        Args: { p_tenant_id: string; p_user_id?: string }
        Returns: Json
      }
      apply_credit_to_invoice: {
        Args: {
          p_amount: number
          p_applied_by: string
          p_credit_id: string
          p_invoice_id: string
          p_notes?: string
        }
        Returns: string
      }
      apply_full_starter: {
        Args: { p_tenant_id: string; p_user_id?: string }
        Returns: Json
      }
      backfill_service_events_categories: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      backfill_task_types_categories: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      batch_move_items: {
        Args: {
          p_action_type?: string
          p_item_ids: string[]
          p_note?: string
          p_to_location_id: string
        }
        Returns: {
          error_message: string
          item_id: string
          success: boolean
        }[]
      }
      build_username_base: {
        Args: { p_email?: string; p_first_name: string; p_last_name: string }
        Returns: string
      }
      calculate_claim_totals: {
        Args: { p_claim_id: string }
        Returns: {
          item_count: number
          total_approved: number
          total_deductible: number
          total_requested: number
        }[]
      }
      calculate_service_price: {
        Args: {
          p_account_id: string
          p_assembly_tier_id?: string
          p_class_id?: string
          p_item_id?: string
          p_service_code: string
          p_tenant_id: string
        }
        Returns: {
          flags_applied: string[]
          minutes: number
          rate: number
          source: string
        }[]
      }
      calculate_service_price_v2: {
        Args: {
          p_account_id: string
          p_assembly_tier_id?: string
          p_class_id?: string
          p_item_id?: string
          p_service_code: string
          p_tenant_id: string
        }
        Returns: {
          calculation_breakdown: Json
          flags_applied: string[]
          minutes: number
          rate: number
          source: string
        }[]
      }
      calculate_storage_charges: {
        Args: { p_account_id: string; p_from_date: string; p_to_date: string }
        Returns: {
          cubic_feet: number
          daily_rate: number
          days_in_storage: number
          item_code: string
          item_id: string
          sidemark_id: string
          total_charge: number
        }[]
      }
      can_access_document: { Args: { doc_id: string }; Returns: boolean }
      can_complete_workflow: {
        Args: { p_entity_id: string; p_entity_type: string; p_workflow: string }
        Returns: boolean
      }
      cancel_manifest: {
        Args: { p_manifest_id: string; p_reason?: string; p_user_id: string }
        Returns: {
          message: string
          success: boolean
        }[]
      }
      canonicalize_release_type: {
        Args: { p_legacy: string }
        Returns: Database["public"]["Enums"]["canonical_release_type"]
      }
      canonicalize_task_status: {
        Args: { p_legacy: string }
        Returns: Database["public"]["Enums"]["canonical_task_status"]
      }
      canonicalize_task_type: {
        Args: { p_legacy: string }
        Returns: Database["public"]["Enums"]["canonical_task_type"]
      }
      check_past_due_tasks: { Args: never; Returns: undefined }
      cleanup_expired_client_chat_data: { Args: never; Returns: undefined }
      cleanup_qa_test_data: { Args: { p_run_id: string }; Returns: Json }
      client_portal_account_id: { Args: never; Returns: string }
      complete_manifest: {
        Args: { p_manifest_id: string; p_user_id: string }
        Returns: {
          billing_events_created: number
          message: string
          scanned_items: number
          success: boolean
          total_items: number
          unscanned_items: number
        }[]
      }
      compute_storage_days: {
        Args: { days_input: number; months_input: number }
        Returns: number
      }
      create_service_billing_event: {
        Args: {
          p_created_by: string
          p_item_id: string
          p_service_code: string
          p_tenant_id: string
        }
        Returns: string
      }
      create_unified_note: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_metadata?: Json
          p_note_text: string
          p_note_type?: string
          p_parent_note_id?: string
          p_source_entity_number?: string
        }
        Returns: string
      }
      create_unified_note_from_repair_quote_token: {
        Args: {
          p_metadata?: Json
          p_note_text: string
          p_source?: string
          p_token: string
        }
        Returns: string
      }
      current_user_id: { Args: never; Returns: string }
      current_user_is_admin_dev: { Args: never; Returns: boolean }
      decline_claim_settlement: {
        Args: {
          p_counter_offer_amount?: number
          p_counter_offer_notes?: string
          p_ip_address?: string
          p_reason: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      ensure_unidentified_account: {
        Args: { p_tenant_id?: string }
        Returns: string
      }
      fn_apply_location_capacity_deltas: {
        Args: { p_deltas: Json; p_tenant_id: string }
        Returns: number
      }
      fn_backfill_location_capacity_cache: {
        Args: { p_tenant_id: string; p_warehouse_id?: string }
        Returns: number
      }
      fn_reconcile_location_capacity: {
        Args: { p_tenant_id: string; p_warehouse_id?: string }
        Returns: number
      }
      generate_claim_number: { Args: never; Returns: string }
      generate_ic_code: { Args: { p_tenant_id: string }; Returns: string }
      generate_invoice_number: { Args: never; Returns: string }
      generate_item_code:
        | { Args: never; Returns: string }
        | { Args: { p_tenant_id: string }; Returns: string }
      generate_ninv_number: { Args: never; Returns: string }
      generate_quote_number: { Args: never; Returns: string }
      generate_shipment_number:
        | { Args: never; Returns: string }
        | { Args: { p_prefix?: string }; Returns: string }
      generate_stocktake_number: { Args: never; Returns: string }
      generate_storage_for_date: {
        Args: { p_date: string }
        Returns: undefined
      }
      generate_unique_username: {
        Args: {
          p_base: string
          p_exclude_user_id?: string
          p_tenant_id: string
        }
        Returns: string
      }
      get_account_hierarchy: {
        Args: { account_id: string }
        Returns: {
          hierarchy_account_id: string
        }[]
      }
      get_claim_by_acceptance_token: {
        Args: { p_token: string }
        Returns: {
          acceptance_token_expires_at: string
          account_id: string
          account_name: string
          claim_number: string
          claim_type: string
          description: string
          id: string
          item_count: number
          payout_method: string
          sent_for_acceptance_at: string
          settlement_accepted_at: string
          settlement_declined_at: string
          settlement_terms_text: string
          settlement_terms_version: string
          status: string
          tenant_id: string
          total_approved_amount: number
        }[]
      }
      get_claim_items_by_acceptance_token: {
        Args: { p_token: string }
        Returns: {
          approved_amount: number
          coverage_type: string
          declared_value: number
          description: string
          id: string
          item_code: string
          repair_cost: number
          repairable: boolean
          use_repair_cost: boolean
          weight_lbs: number
        }[]
      }
      get_client_sidemark_mode: {
        Args: { p_account_id: string }
        Returns: string
      }
      get_coverage_rates: {
        Args: { p_account_id?: string; p_tenant_id: string }
        Returns: {
          deductible_amount: number
          rate_full_deductible: number
          rate_full_no_deductible: number
          source: string
        }[]
      }
      get_current_user_tenant_id: { Args: never; Returns: string }
      get_effective_rate: {
        Args: {
          p_account_id?: string
          p_charge_code: string
          p_class_code?: string
          p_tenant_id: string
        }
        Returns: {
          add_flag: boolean
          add_to_scan: boolean
          adjustment_applied: boolean
          adjustment_type: string
          base_rate: number
          category: string
          charge_code: string
          charge_name: string
          charge_type_id: string
          default_trigger: string
          effective_rate: number
          error_message: string
          input_mode: string
          is_taxable: boolean
          service_time_minutes: number
          unit: string
        }[]
      }
      get_my_roles: {
        Args: never
        Returns: {
          id: string
          is_system: boolean
          name: string
          permissions: Json
          tenant_id: string
        }[]
      }
      get_or_create_receiving_dock: {
        Args: { p_warehouse_id: string }
        Returns: string
      }
      get_pricing_export_data: { Args: { p_tenant_id: string }; Returns: Json }
      get_qa_artifact_signed_url: {
        Args: { p_storage_path: string }
        Returns: string
      }
      get_service_rate: {
        Args: {
          p_class_code?: string
          p_service_code: string
          p_tenant_id: string
        }
        Returns: {
          billing_unit: string
          error_message: string
          has_error: boolean
          rate: number
          service_name: string
          service_time_minutes: number
          taxable: boolean
        }[]
      }
      get_sidemark_display: { Args: { p_sidemark_id: string }; Returns: string }
      get_total_unread_count: { Args: { p_user_id: string }; Returns: number }
      get_unread_message_count: { Args: { p_user_id: string }; Returns: number }
      get_unread_notification_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      import_pricing_data: {
        Args: { p_data: Json; p_overwrite?: boolean; p_tenant_id: string }
        Returns: Json
      }
      is_client_user: { Args: never; Returns: boolean }
      is_communication_admin: { Args: never; Returns: boolean }
      is_credit_hold_active: { Args: { account_id: string }; Returns: boolean }
      is_item_reassignment_allowed: {
        Args: { account_id: string }
        Returns: boolean
      }
      is_tenant_admin:
        | { Args: never; Returns: boolean }
        | {
            Args: { tenant_id_param: string; user_id: string }
            Returns: boolean
          }
      is_warehouse_staff: {
        Args: { tenant_id_param: string; user_id: string }
        Returns: boolean
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_invoice_paid: {
        Args: {
          p_amount: number
          p_invoice_id: string
          p_marked_by?: string
          p_notes?: string
          p_payment_date?: string
          p_payment_method: string
          p_payment_reference?: string
        }
        Returns: string
      }
      mark_message_read: {
        Args: { p_message_id: string; p_user_id: string }
        Returns: boolean
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      move_item_sidemark_and_unbilled_events: {
        Args: { p_item_id: string; p_new_sidemark_id: string }
        Returns: Json
      }
      next_global_invoice_number: { Args: never; Returns: string }
      next_invoice_number: { Args: never; Returns: string }
      normalize_sms_phone_e164ish: {
        Args: { p_phone: string }
        Returns: string
      }
      normalize_unified_note_type: {
        Args: { p_note_type: string }
        Returns: string
      }
      record_manifest_scan: {
        Args: {
          p_item_code: string
          p_item_id: string
          p_manifest_id: string
          p_scanned_by: string
          p_scanned_location_id: string
        }
        Returns: {
          is_valid: boolean
          message: string
          result: string
          scan_id: string
          trigger_error_feedback: boolean
        }[]
      }
      remove_manifest_items_bulk: {
        Args: {
          p_item_ids: string[]
          p_manifest_id: string
          p_removed_by: string
        }
        Returns: {
          items_removed: number
          message: string
          success: boolean
        }[]
      }
      resolve_unified_entity_number: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: string
      }
      rpc_activate_sms_addon: {
        Args: { p_acceptance_source?: string; p_terms_version: string }
        Returns: Json
      }
      rpc_add_unit_to_container: {
        Args: { p_container_id: string; p_unit_id: string }
        Returns: Json
      }
      rpc_admin_activate_platform_wrapper_version: {
        Args: { p_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
          wrapper_html_template: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_email_wrapper_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_admin_create_rollout_in_app_notifications: {
        Args: { p_rollout_id: string }
        Returns: Json
      }
      rpc_admin_execute_template_rollout: {
        Args: { p_rollout_id: string }
        Returns: Json
      }
      rpc_admin_force_reset_tenant_alert_templates: {
        Args: {
          p_override_token: string
          p_reason?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      rpc_admin_get_platform_email_settings: {
        Args: never
        Returns: {
          default_from_email: string
          default_from_name: string
          default_reply_to_email: string
          fallback_sender_domain: string
          is_active: boolean
          updated_at: string
        }[]
      }
      rpc_admin_get_platform_inbound_email_settings: {
        Args: never
        Returns: {
          is_active: boolean
          provider: string
          reply_domain: string
          updated_at: string
        }[]
      }
      rpc_admin_get_sms_sender_profile_log: {
        Args: { p_limit?: number; p_tenant_id: string }
        Returns: {
          actor_user_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
          notes: string
          status_from: string
          status_to: string
          tenant_id: string
        }[]
      }
      rpc_admin_get_tenant_billing_override_log: {
        Args: { p_limit?: number; p_tenant_id: string }
        Returns: {
          actor_user_id: string
          created_at: string
          event_type: string
          expires_at: string
          id: string
          is_comped: boolean
          metadata: Json
          note: string
          reason: string
          tenant_id: string
        }[]
      }
      rpc_admin_get_tenant_stripe_ops_snapshot: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      rpc_admin_list_email_cleanup_logs: {
        Args: {
          p_include_successes?: boolean
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          attempted_at: string
          attempts: number
          client_account: string
          domain_name: string
          error_message: string
          id: string
          metadata: Json
          resend_domain_id: string
          status: string
          tenant_id: string
        }[]
      }
      rpc_admin_list_email_ops_tenants: {
        Args: { p_search?: string }
        Returns: {
          company_email: string
          custom_email_domain: string
          custom_from_email: string
          dkim_verified: boolean
          dmarc_status: string
          email_domain_verified: boolean
          issue_badges: Json
          platform_sender_email: string
          reply_to_effective: string
          sender_type: string
          spf_verified: boolean
          status: string
          tenant_id: string
          tenant_name: string
          tenant_slug: string
          updated_at: string
          use_default_email: boolean
          warning_badges: Json
        }[]
      }
      rpc_admin_list_platform_alert_templates: {
        Args: { p_search?: string }
        Returns: {
          body_format: string
          body_template: string
          channel: string
          editor_json: Json
          id: string
          is_active: boolean
          subject_template: string
          trigger_event: string
          updated_at: string
        }[]
      }
      rpc_admin_list_platform_wrapper_versions: {
        Args: never
        Returns: {
          description: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          wrapper_html_template: string
        }[]
      }
      rpc_admin_list_rollout_notice_recipients: {
        Args: { p_rollout_id: string }
        Returns: {
          app_base_url: string
          company_name: string
          email: string
          tenant_id: string
          tenant_name: string
          user_id: string
        }[]
      }
      rpc_admin_list_sms_sender_profiles: {
        Args: { p_status?: string }
        Returns: {
          app_subdomain: string
          billing_start_at: string
          company_email: string
          company_name: string
          last_error: string
          profile_updated_at: string
          provisioning_status: string
          requested_at: string
          sender_type: string
          sms_addon_active: boolean
          sms_addon_status: string
          sms_enabled: boolean
          tenant_id: string
          tenant_name: string
          twilio_phone_number_e164: string
          twilio_phone_number_sid: string
          verification_approved_at: string
          verification_rejected_at: string
          verification_submitted_at: string
        }[]
      }
      rpc_admin_list_sms_usage_rollups: {
        Args: { p_limit?: number; p_tenant_id?: string }
        Returns: {
          direction: string
          estimated_segment_count: number
          last_aggregated_at: string
          message_count: number
          segment_count: number
          stripe_last_sync_attempt_at: string
          stripe_last_sync_error: string
          stripe_last_synced_at: string
          stripe_last_usage_record_id: string
          stripe_sync_status: string
          stripe_synced_segment_count: number
          tenant_id: string
          tenant_name: string
          twilio_exact_segment_count: number
          usage_date: string
        }[]
      }
      rpc_admin_list_tenant_billing_overrides: {
        Args: { p_filter?: string }
        Returns: {
          app_subdomain: string
          company_email: string
          company_name: string
          comped_at: string
          comped_by: string
          comped_note: string
          comped_reason: string
          expires_at: string
          is_comped: boolean
          override_updated_at: string
          removed_at: string
          removed_by: string
          stripe_customer_id: string
          stripe_subscription_id: string
          subscription_status: string
          tenant_id: string
          tenant_name: string
          tenant_status: string
        }[]
      }
      rpc_admin_refresh_legacy_trigger_registry: {
        Args: never
        Returns: number
      }
      rpc_admin_rollup_sms_usage_events: {
        Args: { p_limit?: number; p_tenant_id?: string }
        Returns: Json
      }
      rpc_admin_schedule_template_rollout: {
        Args: {
          p_allow_tenant_opt_out?: boolean
          p_include_triggers?: string[]
          p_is_security_critical?: boolean
          p_name: string
          p_notes?: string
          p_preserve_body_text?: boolean
          p_preserve_subject?: boolean
          p_scheduled_for?: string
          p_security_grace_hours?: number
          p_update_mode?: string
          p_wrapper_version_id?: string
        }
        Returns: {
          allow_tenant_opt_out: boolean
          created_at: string
          created_by: string | null
          id: string
          include_triggers: string[] | null
          is_security_critical: boolean
          launched_at: string | null
          name: string
          notes: string | null
          preserve_body_text: boolean
          preserve_subject: boolean
          scheduled_for: string
          security_grace_hours: number
          security_grace_until: string | null
          status: string
          update_mode: string
          updated_at: string
          updated_by: string | null
          wrapper_version_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_template_rollouts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_admin_set_platform_email_settings:
        | {
            Args: {
              p_default_from_email: string
              p_default_from_name?: string
              p_default_reply_to_email?: string
              p_is_active?: boolean
            }
            Returns: {
              default_from_email: string
              default_from_name: string
              default_reply_to_email: string
              is_active: boolean
              outbound_fallback_provider: string
              outbound_primary_provider: string
              updated_at: string
              wrapper_html_template: string
            }[]
          }
        | {
            Args: {
              p_default_from_email: string
              p_default_from_name?: string
              p_default_reply_to_email?: string
              p_fallback_sender_domain?: string
              p_is_active?: boolean
            }
            Returns: {
              default_from_email: string
              default_from_name: string
              default_reply_to_email: string
              fallback_sender_domain: string
              is_active: boolean
              updated_at: string
            }[]
          }
        | {
            Args: {
              p_default_from_email: string
              p_default_from_name?: string
              p_default_reply_to_email?: string
              p_is_active?: boolean
              p_outbound_fallback_provider?: string
              p_outbound_primary_provider?: string
              p_wrapper_html_template?: string
            }
            Returns: {
              default_from_email: string
              default_from_name: string
              default_reply_to_email: string
              is_active: boolean
              outbound_fallback_provider: string
              outbound_primary_provider: string
              updated_at: string
              wrapper_html_template: string
            }[]
          }
      rpc_admin_set_platform_inbound_email_settings: {
        Args: {
          p_is_active?: boolean
          p_provider?: string
          p_reply_domain?: string
        }
        Returns: {
          is_active: boolean
          provider: string
          reply_domain: string
          updated_at: string
        }[]
      }
      rpc_admin_set_tenant_billing_override: {
        Args: {
          p_expires_at?: string
          p_is_comped: boolean
          p_note?: string
          p_reason?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      rpc_admin_sync_trigger_catalog_to_tenants: {
        Args: { p_trigger_key?: string }
        Returns: Json
      }
      rpc_admin_upsert_platform_alert_template: {
        Args: {
          p_body_format?: string
          p_body_template?: string
          p_channel: string
          p_editor_json?: Json
          p_is_active?: boolean
          p_subject_template?: string
          p_trigger_event: string
        }
        Returns: {
          body_format: string
          body_template: string
          channel: string
          created_at: string
          created_by: string | null
          editor_json: Json | null
          id: string
          is_active: boolean
          subject_template: string | null
          trigger_event: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_alert_template_library"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_admin_upsert_platform_wrapper_version: {
        Args: {
          p_description?: string
          p_id?: string
          p_is_active?: boolean
          p_name?: string
          p_wrapper_html_template?: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
          wrapper_html_template: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_email_wrapper_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_allocate_manifest_items_to_expected: {
        Args: {
          p_expected_shipment_id: string
          p_manifest_item_ids: string[]
          p_quantities: number[]
        }
        Returns: Json
      }
      rpc_apply_grouped_item_split_off_leftover: {
        Args: {
          p_expected_start_suffix?: number
          p_leftover_qty: number
          p_parent_item_id: string
          p_split_task_id?: string
          p_target_location_id?: string
        }
        Returns: Json
      }
      rpc_apply_shipment_coverage: {
        Args: { p_coverage_type: string; p_shipment_id: string }
        Returns: Json
      }
      rpc_assign_receiving_location_for_shipment: {
        Args: { p_location_id?: string; p_note?: string; p_shipment_id: string }
        Returns: Json
      }
      rpc_auto_apply_coverage_on_receipt: {
        Args: { p_shipment_id: string }
        Returns: Json
      }
      rpc_cleanup_item_coverage_on_delete: {
        Args: { p_item_id: string }
        Returns: Json
      }
      rpc_complete_split_task: {
        Args: { p_split_task_id: string }
        Returns: Json
      }
      rpc_coverage_analytics: {
        Args: { p_date_from?: string; p_date_to?: string }
        Returns: Json
      }
      rpc_create_container: {
        Args: {
          p_container_code?: string
          p_container_type: string
          p_footprint_cu_ft?: number
          p_location_id?: string
          p_warehouse_id: string
        }
        Returns: {
          container_code: string
          container_type: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          footprint_cu_ft: number | null
          id: string
          is_active: boolean
          location_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          warehouse_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "containers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_deactivate_sms_addon: {
        Args: { p_acceptance_source?: string; p_reason?: string }
        Returns: Json
      }
      rpc_deallocate_manifest_item: {
        Args: { p_allocation_id: string }
        Returns: Json
      }
      rpc_ensure_flag_alert_trigger: {
        Args: { p_charge_type_id: string }
        Returns: Json
      }
      rpc_find_inbound_candidates: {
        Args: {
          p_account_id?: string
          p_carrier?: string
          p_pieces?: number
          p_ref_value?: string
          p_tracking_number?: string
          p_vendor_name?: string
        }
        Returns: Json
      }
      rpc_get_effective_coverage_rates: {
        Args: { p_account_id: string }
        Returns: Json
      }
      rpc_get_effective_saas_pricing: { Args: { p_at?: string }; Returns: Json }
      rpc_get_location_capacity: {
        Args: { p_location_id: string }
        Returns: Json
      }
      rpc_get_location_suggestions: {
        Args: {
          p_item_id?: string
          p_item_ids?: string[]
          p_mode: string
          p_tenant_id: string
          p_warehouse_id: string
        }
        Returns: {
          account_cluster: boolean
          available_cuft: number
          capacity_cuft: number
          flag_compliant: boolean
          group_match: boolean
          leftover_cuft: number
          location_code: string
          location_id: string
          overflow: boolean
          sku_or_vendor_match: boolean
          used_cuft: number
          utilization_pct: number
        }[]
      }
      rpc_get_my_billing_override: { Args: never; Returns: Json }
      rpc_get_my_email_sender_defaults: { Args: never; Returns: Json }
      rpc_get_my_in_app_role_eligibility: {
        Args: never
        Returns: {
          is_eligible: boolean
          is_system: boolean
          role_description: string
          role_name: string
          updated_at: string
        }[]
      }
      rpc_get_my_inbound_email_settings: { Args: never; Returns: Json }
      rpc_get_my_sms_addon_activation: { Args: never; Returns: Json }
      rpc_get_my_subscription_gate: { Args: never; Returns: Json }
      rpc_get_my_template_rollout_preference: { Args: never; Returns: boolean }
      rpc_get_platform_email_public_settings: {
        Args: never
        Returns: {
          default_from_email: string
          fallback_sender_domain: string
          is_active: boolean
          updated_at: string
        }[]
      }
      rpc_get_platform_inbound_email_public: {
        Args: never
        Returns: {
          is_active: boolean
          provider: string
          reply_domain: string
          updated_at: string
        }[]
      }
      rpc_get_tenant_billable_seat_count: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      rpc_get_warehouse_map_location_capacity: {
        Args: { p_map_id: string }
        Returns: {
          capacity_cu_ft: number
          free_cu_ft: number
          location_code: string
          location_id: string
          used_cu_ft: number
          utilization_pct: number
          zone_id: string
        }[]
      }
      rpc_get_warehouse_map_zone_capacity: {
        Args: { p_map_id: string }
        Returns: {
          capacity_cu_ft: number
          free_cu_ft: number
          height: number
          location_count: number
          node_id: string
          node_label: string
          state: string
          used_cu_ft: number
          utilization_pct: number
          width: number
          x: number
          y: number
          zone_code: string
          zone_description: string
          zone_id: string
        }[]
      }
      rpc_get_warehouse_zone_location_capacity: {
        Args: { p_map_id: string; p_zone_id: string }
        Returns: {
          capacity_cu_ft: number
          free_cu_ft: number
          location_code: string
          location_id: string
          used_cu_ft: number
          utilization_pct: number
          zone_id: string
        }[]
      }
      rpc_get_warehouse_zone_usage: {
        Args: { p_warehouse_id: string }
        Returns: {
          location_count: number
          node_count: number
          zone_id: string
        }[]
      }
      rpc_initialize_tenant_subscription_from_checkout: {
        Args: {
          p_current_period_end?: string
          p_plan_id?: string
          p_stripe_customer_id: string
          p_stripe_subscription_id: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      rpc_link_dock_intake_to_shipment: {
        Args: {
          p_confidence_score?: number
          p_dock_intake_id: string
          p_link_type: string
          p_linked_shipment_id: string
        }
        Returns: Json
      }
      rpc_list_all_tenants: {
        Args: never
        Returns: {
          created_at: string
          id: string
          name: string
        }[]
      }
      rpc_list_my_pending_template_rollouts: {
        Args: never
        Returns: {
          allow_tenant_opt_out: boolean
          decision_locked: boolean
          is_security_critical: boolean
          name: string
          notes: string
          preserve_body_text: boolean
          preserve_subject: boolean
          rollout_id: string
          scheduled_for: string
          security_grace_until: string
          status: string
          tenant_decision: string
          update_mode: string
        }[]
      }
      rpc_list_tenant_users: {
        Args: { p_tenant_id: string }
        Returns: {
          email: string
          first_name: string
          id: string
          last_name: string
          role_name: string
          status: string
        }[]
      }
      rpc_log_impersonation_end: {
        Args: { p_log_id: string }
        Returns: undefined
      }
      rpc_log_impersonation_start: {
        Args: { p_simulated_role: string; p_target_tenant_id: string }
        Returns: string
      }
      rpc_mark_payment_failed_and_start_grace: {
        Args: { p_grace_days?: number; p_stripe_subscription_id: string }
        Returns: undefined
      }
      rpc_mark_payment_ok: {
        Args: { p_stripe_subscription_id: string }
        Returns: undefined
      }
      rpc_move_container: {
        Args: { p_container_id: string; p_new_location_id: string }
        Returns: Json
      }
      rpc_normalize_ref_value: { Args: { p_value: string }; Returns: string }
      rpc_preview_grouped_item_split_off_leftover: {
        Args: { p_leftover_qty: number; p_parent_item_id: string }
        Returns: Json
      }
      rpc_preview_shipment_coverage_change: {
        Args: { p_new_type?: string; p_shipment_id: string }
        Returns: Json
      }
      rpc_process_due_template_rollouts: {
        Args: { p_limit?: number }
        Returns: Json
      }
      rpc_remove_shipment_coverage: {
        Args: { p_shipment_id: string }
        Returns: Json
      }
      rpc_remove_unit_from_container: {
        Args: { p_unit_id: string }
        Returns: Json
      }
      rpc_request_my_email_domain_cleanup: {
        Args: { p_domain_name?: string; p_resend_domain_id?: string }
        Returns: Json
      }
      rpc_resolve_receiving_location: {
        Args: { p_account_id?: string; p_warehouse_id: string }
        Returns: Json
      }
      rpc_set_account_auto_coverage: {
        Args: {
          p_account_id: string
          p_default_type?: string
          p_enabled: boolean
        }
        Returns: Json
      }
      rpc_set_default_warehouse_map: {
        Args: { p_map_id: string; p_warehouse_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          grid_size: number
          height: number
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          warehouse_id: string
          width: number
        }
        SetofOptions: {
          from: "*"
          to: "warehouse_maps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_set_my_inbound_email_settings: {
        Args: { p_forward_to_email: string; p_is_enabled?: boolean }
        Returns: Json
      }
      rpc_set_my_template_rollout_decision: {
        Args: { p_decision: string; p_rollout_id: string }
        Returns: {
          decided_at: string
          decided_by: string | null
          decision: string
          id: string
          rollout_id: string
          tenant_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tenant_template_rollout_decisions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_set_my_template_rollout_preference: {
        Args: { p_opt_out_non_critical: boolean }
        Returns: boolean
      }
      rpc_system_set_sms_sender_status: {
        Args: {
          p_error?: string
          p_metadata?: Json
          p_note?: string
          p_source?: string
          p_status: string
          p_tenant_id: string
          p_twilio_phone_number_e164?: string
          p_twilio_phone_number_sid?: string
        }
        Returns: Json
      }
      rpc_timer_end_job: {
        Args: { p_job_id: string; p_job_type: string; p_reason?: string }
        Returns: Json
      }
      rpc_timer_start_job: {
        Args: {
          p_job_id: string
          p_job_type: string
          p_pause_existing?: boolean
        }
        Returns: Json
      }
      rpc_update_item_declared_value: {
        Args: { p_declared_value: number; p_item_id: string }
        Returns: Json
      }
      rpc_upsert_subscription_invoice_from_stripe: {
        Args: {
          p_amount_due?: number
          p_amount_paid?: number
          p_amount_remaining?: number
          p_currency?: string
          p_due_date?: string
          p_hosted_invoice_url?: string
          p_invoice_pdf?: string
          p_metadata?: Json
          p_paid_at?: string
          p_period_end?: string
          p_period_start?: string
          p_status?: string
          p_stripe_created_at?: string
          p_stripe_customer_id?: string
          p_stripe_invoice_id: string
          p_stripe_subscription_id?: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      rpc_upsert_tenant_subscription_from_stripe: {
        Args: {
          p_cancel_at_period_end?: boolean
          p_current_period_end?: string
          p_status: string
          p_stripe_customer_id: string
          p_stripe_subscription_id: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      seed_core_charge_types: { Args: { p_tenant_id: string }; Returns: number }
      seed_default_billable_services: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_default_classes: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_default_outbound_types: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_enhanced_flags: { Args: { p_tenant_id: string }; Returns: undefined }
      seed_service_categories: {
        Args: { p_created_by?: string; p_tenant_id: string }
        Returns: undefined
      }
      seed_service_events: { Args: { p_tenant_id: string }; Returns: undefined }
      seed_service_events_with_categories: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_standard_roles: { Args: { p_tenant_id: string }; Returns: undefined }
      seed_starter_charge_types: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      seed_starter_classes: { Args: { p_tenant_id: string }; Returns: number }
      seed_starter_service_events: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      seed_task_types: {
        Args: { p_created_by?: string; p_tenant_id: string }
        Returns: undefined
      }
      send_claim_for_acceptance: {
        Args: {
          p_claim_id: string
          p_payout_method?: string
          p_sent_by?: string
          p_settlement_terms: string
        }
        Returns: Json
      }
      slugify_email_local_part: { Args: { p_value: string }; Returns: string }
      soft_delete_unified_note: {
        Args: { p_note_id: string }
        Returns: boolean
      }
      start_manifest: {
        Args: { p_manifest_id: string; p_user_id: string }
        Returns: {
          item_count: number
          message: string
          success: boolean
        }[]
      }
      sync_tenant_sms_consent_from_global_phone: {
        Args: {
          p_contact_name?: string
          p_phone_number: string
          p_source?: string
        }
        Returns: Json
      }
      unified_note_attach_links: {
        Args: {
          p_note_id: string
          p_source_entity_id: string
          p_source_entity_number?: string
          p_source_entity_type: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      unified_note_can_manage: {
        Args: { p_note_id: string; p_user_id: string }
        Returns: boolean
      }
      update_unified_note: {
        Args: { p_note_id: string; p_note_text: string }
        Returns: boolean
      }
      user_can_access_sidemark: {
        Args: { p_sidemark_id: string; p_user_id: string }
        Returns: boolean
      }
      user_has_permission: {
        Args: { p_permission: string; p_user_id: string }
        Returns: boolean
      }
      user_has_role: {
        Args: { p_role_name: string; p_user_id: string }
        Returns: boolean
      }
      user_has_warehouse_access: {
        Args: { p_user_id: string; p_warehouse_id: string }
        Returns: boolean
      }
      user_is_admin_dev: { Args: { p_user_id: string }; Returns: boolean }
      user_tenant_id: { Args: never; Returns: string }
      validate_movement_event: {
        Args: { p_destination_location_id: string; p_item_ids: string[] }
        Returns: Json
      }
      validate_shipment_outbound_completion: {
        Args: { p_shipment_id: string }
        Returns: Json
      }
      validate_shipment_receiving_completion: {
        Args: { p_shipment_id: string }
        Returns: Json
      }
      validate_stocktake_completion: {
        Args: { p_stocktake_id: string }
        Returns: Json
      }
      validate_task_completion: { Args: { p_task_id: string }; Returns: Json }
      validate_workflow_completion: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_user_id?: string
          p_workflow: string
        }
        Returns: {
          is_blocking: boolean
          message: string
          prompt_key: string
          severity: string
          title: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "warehouse" | "client_user"
      canonical_release_type:
        | "will_call_customer"
        | "will_call_third_party_carrier"
        | "will_call_stride_delivery"
      canonical_task_status:
        | "open"
        | "in_progress"
        | "blocked"
        | "completed"
        | "failed"
        | "cancelled"
      canonical_task_type:
        | "inspection"
        | "assembly"
        | "repair"
        | "outbound"
        | "disposal"
        | "other"
      coverage_type: "standard" | "enhanced" | "full" | "pending"
      discount_type: "percentage" | "flat_rate"
      experience_level: "new" | "learning" | "experienced"
      expiration_type: "none" | "date"
      invoice_mode: "standard" | "rolling" | "manual"
      invoice_status:
        | "draft"
        | "pending"
        | "sent"
        | "paid"
        | "partial"
        | "overdue"
        | "cancelled"
        | "void"
      item_status_enum: "pending" | "active" | "released" | "disposed" | "lost"
      media_type_enum: "photo" | "document" | "video"
      movement_type_enum:
        | "receiving"
        | "putaway"
        | "pick"
        | "move"
        | "release"
        | "stocktake_correction"
        | "reactivation"
      payout_method_enum: "credit" | "check" | "repair_vendor_pay"
      quote_billing_unit:
        | "flat"
        | "per_piece"
        | "per_line_item"
        | "per_class"
        | "per_hour"
        | "per_day"
      quote_event_type:
        | "created"
        | "updated"
        | "emailed"
        | "email_failed"
        | "exported_pdf"
        | "exported_excel"
        | "viewed"
        | "accepted"
        | "declined"
        | "expired"
        | "voided"
      quote_status:
        | "draft"
        | "sent"
        | "accepted"
        | "declined"
        | "expired"
        | "void"
      repair_quote_status:
        | "pending"
        | "submitted"
        | "approved"
        | "declined"
        | "expired"
        | "completed"
      repair_quote_workflow_status:
        | "draft"
        | "awaiting_assignment"
        | "sent_to_tech"
        | "tech_declined"
        | "tech_submitted"
        | "under_review"
        | "sent_to_client"
        | "accepted"
        | "declined"
        | "expired"
        | "closed"
      service_scope_type: "all" | "selected"
      shipment_item_status_enum:
        | "pending"
        | "received"
        | "partial"
        | "released"
        | "cancelled"
      shipment_status_enum:
        | "expected"
        | "in_progress"
        | "received"
        | "released"
        | "completed"
        | "cancelled"
      shipment_type_enum: "inbound" | "outbound" | "return" | "disposal"
      task_kind: "inspection" | "assembly" | "repair" | "disposal" | "other"
      usage_limit_type: "unlimited" | "limited"
      user_status: "pending" | "active" | "inactive"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "manager", "warehouse", "client_user"],
      canonical_release_type: [
        "will_call_customer",
        "will_call_third_party_carrier",
        "will_call_stride_delivery",
      ],
      canonical_task_status: [
        "open",
        "in_progress",
        "blocked",
        "completed",
        "failed",
        "cancelled",
      ],
      canonical_task_type: [
        "inspection",
        "assembly",
        "repair",
        "outbound",
        "disposal",
        "other",
      ],
      coverage_type: ["standard", "enhanced", "full", "pending"],
      discount_type: ["percentage", "flat_rate"],
      experience_level: ["new", "learning", "experienced"],
      expiration_type: ["none", "date"],
      invoice_mode: ["standard", "rolling", "manual"],
      invoice_status: [
        "draft",
        "pending",
        "sent",
        "paid",
        "partial",
        "overdue",
        "cancelled",
        "void",
      ],
      item_status_enum: ["pending", "active", "released", "disposed", "lost"],
      media_type_enum: ["photo", "document", "video"],
      movement_type_enum: [
        "receiving",
        "putaway",
        "pick",
        "move",
        "release",
        "stocktake_correction",
        "reactivation",
      ],
      payout_method_enum: ["credit", "check", "repair_vendor_pay"],
      quote_billing_unit: [
        "flat",
        "per_piece",
        "per_line_item",
        "per_class",
        "per_hour",
        "per_day",
      ],
      quote_event_type: [
        "created",
        "updated",
        "emailed",
        "email_failed",
        "exported_pdf",
        "exported_excel",
        "viewed",
        "accepted",
        "declined",
        "expired",
        "voided",
      ],
      quote_status: [
        "draft",
        "sent",
        "accepted",
        "declined",
        "expired",
        "void",
      ],
      repair_quote_status: [
        "pending",
        "submitted",
        "approved",
        "declined",
        "expired",
        "completed",
      ],
      repair_quote_workflow_status: [
        "draft",
        "awaiting_assignment",
        "sent_to_tech",
        "tech_declined",
        "tech_submitted",
        "under_review",
        "sent_to_client",
        "accepted",
        "declined",
        "expired",
        "closed",
      ],
      service_scope_type: ["all", "selected"],
      shipment_item_status_enum: [
        "pending",
        "received",
        "partial",
        "released",
        "cancelled",
      ],
      shipment_status_enum: [
        "expected",
        "in_progress",
        "received",
        "released",
        "completed",
        "cancelled",
      ],
      shipment_type_enum: ["inbound", "outbound", "return", "disposal"],
      task_kind: ["inspection", "assembly", "repair", "disposal", "other"],
      usage_limit_type: ["unlimited", "limited"],
      user_status: ["pending", "active", "inactive"],
    },
  },
} as const

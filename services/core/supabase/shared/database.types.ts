export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      accounts: {
        Row: {
          access_token: string | null
          account_details: Json | null
          account_id: number | null
          created_at: string
          id: number
          is_active: boolean
          name: string | null
          page_access_token: string | null
          primary_photo: string | null
          type: string | null
        }
        Insert: {
          access_token?: string | null
          account_details?: Json | null
          account_id?: number | null
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string | null
          page_access_token?: string | null
          primary_photo?: string | null
          type?: string | null
        }
        Update: {
          access_token?: string | null
          account_details?: Json | null
          account_id?: number | null
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string | null
          page_access_token?: string | null
          primary_photo?: string | null
          type?: string | null
        }
        Relationships: []
      }
      event_registrations: {
        Row: {
          cancelled_at: string | null
          check_in_method: string | null
          checked_in_at: string | null
          confirmed_at: string | null
          created_at: string | null
          email: string
          event_id: number
          id: string
          metadata: Json | null
          name: string
          phone: string | null
          profile_id: string | null
          qr_code_id: string | null
          registered_at: string
          status: string
          type: string | null
          updated_at: string | null
          verification_token: string | null
        }
        Insert: {
          cancelled_at?: string | null
          check_in_method?: string | null
          checked_in_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          email: string
          event_id: number
          id?: string
          metadata?: Json | null
          name: string
          phone?: string | null
          profile_id?: string | null
          qr_code_id?: string | null
          registered_at?: string
          status: string
          type?: string | null
          updated_at?: string | null
          verification_token?: string | null
        }
        Update: {
          cancelled_at?: string | null
          check_in_method?: string | null
          checked_in_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          email?: string
          event_id?: number
          id?: string
          metadata?: Json | null
          name?: string
          phone?: string | null
          profile_id?: string | null
          qr_code_id?: string | null
          registered_at?: string
          status?: string
          type?: string | null
          updated_at?: string | null
          verification_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_registrations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_registrations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_slugs: {
        Row: {
          event_id: number
          slug: string
        }
        Insert: {
          event_id: number
          slug: string
        }
        Update: {
          event_id?: number
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_slugs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          account_id: number | null
          cover_photo: string | null
          created_at: string
          description: string | null
          end_time: string | null
          id: number
          is_facebook_pages: boolean | null
          is_featured: boolean
          is_hidden: boolean | null
          location: string | null
          location_details: Json | null
          name: string | null
          registration_deadline: string | null
          registration_enabled: boolean | null
          registration_limit: number | null
          slug: string | null
          source: string | null
          source_id: number | null
          start_time: string | null
          ticket_url: string | null
        }
        Insert: {
          account_id?: number | null
          cover_photo?: string | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          id?: number
          is_facebook_pages?: boolean | null
          is_featured?: boolean
          is_hidden?: boolean | null
          location?: string | null
          location_details?: Json | null
          name?: string | null
          registration_deadline?: string | null
          registration_enabled?: boolean | null
          registration_limit?: number | null
          slug?: string | null
          source?: string | null
          source_id?: number | null
          start_time?: string | null
          ticket_url?: string | null
        }
        Update: {
          account_id?: number | null
          cover_photo?: string | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          id?: number
          is_facebook_pages?: boolean | null
          is_featured?: boolean
          is_hidden?: boolean | null
          location?: string | null
          location_details?: Json | null
          name?: string | null
          registration_deadline?: string | null
          registration_enabled?: boolean | null
          registration_limit?: number | null
          slug?: string | null
          source?: string | null
          source_id?: number | null
          start_time?: string | null
          ticket_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      facebook_pages: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          url: string | null
          username: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          is_active?: boolean
          url?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          url?: string | null
          username?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          contact_details: Json | null
          created_at: string | null
          deleted_at: string | null
          email: string
          id: string
          logto_user_id: string
          metadata: Json | null
          name: string | null
          social_links: Json | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          contact_details?: Json | null
          created_at?: string | null
          deleted_at?: string | null
          email: string
          id?: string
          logto_user_id: string
          metadata?: Json | null
          name?: string | null
          social_links?: Json | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          contact_details?: Json | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string
          id?: string
          logto_user_id?: string
          metadata?: Json | null
          name?: string | null
          social_links?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_events_by_location: {
        Args: Record<PropertyKey, never>
        Returns: {
          location: string
          count: number
        }[]
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const


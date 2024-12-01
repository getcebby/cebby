export type Json = string | number | boolean | null | {
  [key: string]: Json | undefined;
} | Json[];
export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          access_token: string | null;
          account_id: number | null;
          created_at: string;
          id: number;
          name: string | null;
          page_access_token: string | null;
          type: string | null;
        };
        Insert: {
          access_token?: string | null;
          account_id?: number | null;
          created_at?: string;
          id?: number;
          name?: string | null;
          page_access_token?: string | null;
          type?: string | null;
        };
        Update: {
          access_token?: string | null;
          account_id?: number | null;
          created_at?: string;
          id?: number;
          name?: string | null;
          page_access_token?: string | null;
          type?: string | null;
        };
        Relationships: [];
      };
      events: {
        Row: {
          account_id: number | null;
          cover_photo: string | null;
          created_at: string;
          description: string | null;
          end_time: string | null;
          id: number;
          is_featured: boolean;
          location: string | null;
          name: string | null;
          source: string | null;
          source_id: number | null;
          start_time: string | null;
        };
        Insert: {
          account_id?: number | null;
          cover_photo?: string | null;
          created_at?: string;
          description?: string | null;
          end_time?: string | null;
          id?: number;
          is_featured?: boolean;
          location?: string | null;
          name?: string | null;
          source?: string | null;
          source_id?: number | null;
          start_time?: string | null;
        };
        Update: {
          account_id?: number | null;
          cover_photo?: string | null;
          created_at?: string;
          description?: string | null;
          end_time?: string | null;
          id?: number;
          is_featured?: boolean;
          location?: string | null;
          name?: string | null;
          source?: string | null;
          source_id?: number | null;
          start_time?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "events_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["account_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
type PublicSchema = Database[Extract<keyof Database, "public">];
export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (
      & Database[PublicTableNameOrOptions["schema"]]["Tables"]
      & Database[PublicTableNameOrOptions["schema"]]["Views"]
    )
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database } ? (
    & Database[PublicTableNameOrOptions["schema"]]["Tables"]
    & Database[PublicTableNameOrOptions["schema"]]["Views"]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : PublicTableNameOrOptions extends
    keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    ? (PublicSchema["Tables"] & PublicSchema["Views"])[
      PublicTableNameOrOptions
    ] extends {
      Row: infer R;
    } ? R
    : never
  : never;
export type TablesInsert<
  PublicTableNameOrOptions extends keyof PublicSchema["Tables"] | {
    schema: keyof Database;
  },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;
export type TablesUpdate<
  PublicTableNameOrOptions extends keyof PublicSchema["Tables"] | {
    schema: keyof Database;
  },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;
export type Enums<
  PublicEnumNameOrOptions extends keyof PublicSchema["Enums"] | {
    schema: keyof Database;
  },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
  : never;
export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database;
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]][
      "CompositeTypes"
    ]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][
    CompositeTypeName
  ]
  : PublicCompositeTypeNameOrOptions extends
    keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

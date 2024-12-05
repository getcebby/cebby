export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
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
                    operationName?: string;
                    query?: string;
                    variables?: Json;
                    extensions?: Json;
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
            accounts: {
                Row: {
                    access_token: string | null;
                    account_details: Json | null;
                    account_id: number | null;
                    created_at: string;
                    id: number;
                    is_active: boolean;
                    name: string | null;
                    page_access_token: string | null;
                    primary_photo: string | null;
                    type: string | null;
                };
                Insert: {
                    access_token?: string | null;
                    account_details?: Json | null;
                    account_id?: number | null;
                    created_at?: string;
                    id?: number;
                    is_active?: boolean;
                    name?: string | null;
                    page_access_token?: string | null;
                    primary_photo?: string | null;
                    type?: string | null;
                };
                Update: {
                    access_token?: string | null;
                    account_details?: Json | null;
                    account_id?: number | null;
                    created_at?: string;
                    id?: number;
                    is_active?: boolean;
                    name?: string | null;
                    page_access_token?: string | null;
                    primary_photo?: string | null;
                    type?: string | null;
                };
                Relationships: [];
            };
            event_slugs: {
                Row: {
                    event_id: number;
                    slug: string;
                };
                Insert: {
                    event_id: number;
                    slug: string;
                };
                Update: {
                    event_id?: number;
                    slug?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: 'event_slugs_event_id_fkey';
                        columns: ['event_id'];
                        isOneToOne: false;
                        referencedRelation: 'events';
                        referencedColumns: ['id'];
                    },
                ];
            };
            events: {
                Row: {
                    account_id: number | null;
                    cover_photo: string | null;
                    created_at: string;
                    description: string | null;
                    end_time: string | null;
                    id: number;
                    is_facebook_pages: boolean | null;
                    is_featured: boolean;
                    location: string | null;
                    location_details: Json | null;
                    name: string | null;
                    source: string | null;
                    source_id: number | null;
                    start_time: string | null;
                    ticket_url: string | null;
                };
                Insert: {
                    account_id?: number | null;
                    cover_photo?: string | null;
                    created_at?: string;
                    description?: string | null;
                    end_time?: string | null;
                    id?: number;
                    is_facebook_pages?: boolean | null;
                    is_featured?: boolean;
                    location?: string | null;
                    location_details?: Json | null;
                    name?: string | null;
                    source?: string | null;
                    source_id?: number | null;
                    start_time?: string | null;
                    ticket_url?: string | null;
                };
                Update: {
                    account_id?: number | null;
                    cover_photo?: string | null;
                    created_at?: string;
                    description?: string | null;
                    end_time?: string | null;
                    id?: number;
                    is_facebook_pages?: boolean | null;
                    is_featured?: boolean;
                    location?: string | null;
                    location_details?: Json | null;
                    name?: string | null;
                    source?: string | null;
                    source_id?: number | null;
                    start_time?: string | null;
                    ticket_url?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: 'events_account_id_fkey';
                        columns: ['account_id'];
                        isOneToOne: false;
                        referencedRelation: 'accounts';
                        referencedColumns: ['account_id'];
                    },
                ];
            };
            facebook_pages: {
                Row: {
                    created_at: string;
                    id: number;
                    is_active: boolean;
                    url: string | null;
                    username: string | null;
                };
                Insert: {
                    created_at?: string;
                    id?: number;
                    is_active?: boolean;
                    url?: string | null;
                    username?: string | null;
                };
                Update: {
                    created_at?: string;
                    id?: number;
                    is_active?: boolean;
                    url?: string | null;
                    username?: string | null;
                };
                Relationships: [];
            };
        };
        Views: {
            [_ in never]: never;
        };
        Functions: {
            get_events_by_location: {
                Args: Record<PropertyKey, never>;
                Returns: {
                    location: string;
                    count: number;
                }[];
            };
        };
        Enums: {
            [_ in never]: never;
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
};

type PublicSchema = Database[Extract<keyof Database, 'public'>];

export type Tables<
    PublicTableNameOrOptions extends
        | keyof (PublicSchema['Tables'] & PublicSchema['Views'])
        | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database } ? keyof (
            & Database[PublicTableNameOrOptions['schema']]['Tables']
            & Database[PublicTableNameOrOptions['schema']]['Views']
        )
        : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database } ? (
        & Database[PublicTableNameOrOptions['schema']]['Tables']
        & Database[PublicTableNameOrOptions['schema']]['Views']
    )[TableName] extends {
        Row: infer R;
    } ? R
    : never
    : PublicTableNameOrOptions extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])
        ? (PublicSchema['Tables'] & PublicSchema['Views'])[PublicTableNameOrOptions] extends {
            Row: infer R;
        } ? R
        : never
    : never;

export type TablesInsert<
    PublicTableNameOrOptions extends keyof PublicSchema['Tables'] | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
        ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
        : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
        Insert: infer I;
    } ? I
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema['Tables']
        ? PublicSchema['Tables'][PublicTableNameOrOptions] extends {
            Insert: infer I;
        } ? I
        : never
    : never;

export type TablesUpdate<
    PublicTableNameOrOptions extends keyof PublicSchema['Tables'] | { schema: keyof Database },
    TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
        ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
        : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
    ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
        Update: infer U;
    } ? U
    : never
    : PublicTableNameOrOptions extends keyof PublicSchema['Tables']
        ? PublicSchema['Tables'][PublicTableNameOrOptions] extends {
            Update: infer U;
        } ? U
        : never
    : never;

export type Enums<
    PublicEnumNameOrOptions extends keyof PublicSchema['Enums'] | { schema: keyof Database },
    EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
        ? keyof Database[PublicEnumNameOrOptions['schema']]['Enums']
        : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
    ? Database[PublicEnumNameOrOptions['schema']]['Enums'][EnumName]
    : PublicEnumNameOrOptions extends keyof PublicSchema['Enums'] ? PublicSchema['Enums'][PublicEnumNameOrOptions]
    : never;

export type CompositeTypes<
    PublicCompositeTypeNameOrOptions extends keyof PublicSchema['CompositeTypes'] | { schema: keyof Database },
    CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
        schema: keyof Database;
    } ? keyof Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
        : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
    ? Database[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
    : PublicCompositeTypeNameOrOptions extends keyof PublicSchema['CompositeTypes']
        ? PublicSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

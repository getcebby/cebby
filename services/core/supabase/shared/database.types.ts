export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[];

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
            accounts: {
                Row: {
                    account_id: string;
                    account_details: Json | null;
                    created_at: string | null;
                    discovery_path: string | null;
                    ingest_kind: string | null;
                    is_active: boolean;
                    is_verified: boolean;
                    kind: string;
                    name: string;
                    organization_id: number | null;
                    primary_photo: string | null;
                    type: string;
                    updated_at: string | null;
                };
                Insert: {
                    account_id: string;
                    account_details?: Json | null;
                    created_at?: string | null;
                    discovery_path?: string | null;
                    ingest_kind?: string | null;
                    is_active?: boolean;
                    is_verified?: boolean;
                    kind: string;
                    name: string;
                    organization_id?: number | null;
                    primary_photo?: string | null;
                    type: string;
                    updated_at?: string | null;
                };
                Update: {
                    account_id?: string;
                    account_details?: Json | null;
                    created_at?: string | null;
                    discovery_path?: string | null;
                    ingest_kind?: string | null;
                    is_active?: boolean;
                    is_verified?: boolean;
                    kind?: string;
                    name?: string;
                    organization_id?: number | null;
                    primary_photo?: string | null;
                    type?: string;
                    updated_at?: string | null;
                };
                Relationships: [];
            };
            event_organizers: {
                Row: {
                    account_id: string;
                    created_at: string;
                    event_id: number;
                    position: number;
                    role: string;
                };
                Insert: {
                    account_id: string;
                    created_at?: string;
                    event_id: number;
                    position?: number;
                    role?: string;
                };
                Update: {
                    account_id?: string;
                    created_at?: string;
                    event_id?: number;
                    position?: number;
                    role?: string;
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
                Relationships: [];
            };
            event_source_links: {
                Row: {
                    created_at: string;
                    event_id: number;
                    id: number;
                    ingest_kind: string | null;
                    raw: Json | null;
                    scraped_at: string;
                    source: string;
                    source_id: string;
                    url: string | null;
                };
                Insert: {
                    created_at?: string;
                    event_id: number;
                    id?: number;
                    ingest_kind?: string | null;
                    raw?: Json | null;
                    scraped_at?: string;
                    source: string;
                    source_id: string;
                    url?: string | null;
                };
                Update: {
                    created_at?: string;
                    event_id?: number;
                    id?: number;
                    ingest_kind?: string | null;
                    raw?: Json | null;
                    scraped_at?: string;
                    source?: string;
                    source_id?: string;
                    url?: string | null;
                };
                Relationships: [];
            };
            events: {
                Row: {
                    city: string | null;
                    country: string | null;
                    cover_photo: string | null;
                    created_at: string | null;
                    description: string | null;
                    end_time: string | null;
                    format: string | null;
                    id: number;
                    is_featured: boolean | null;
                    is_published: boolean | null;
                    location: string | null;
                    location_details: Json | null;
                    name: string;
                    primary_source_link_id: number | null;
                    region: string | null;
                    slug: string | null;
                    source: string | null;
                    source_id: string | number | null;
                    start_time: string;
                    status: string | null;
                    timezone: string | null;
                    updated_at: string | null;
                };
                Insert: {
                    city?: string | null;
                    country?: string | null;
                    cover_photo?: string | null;
                    created_at?: string | null;
                    description?: string | null;
                    end_time?: string | null;
                    format?: string | null;
                    id?: number;
                    is_featured?: boolean | null;
                    is_published?: boolean | null;
                    location?: string | null;
                    location_details?: Json | null;
                    name: string;
                    primary_source_link_id?: number | null;
                    region?: string | null;
                    slug?: string | null;
                    source?: string | null;
                    source_id?: string | number | null;
                    start_time: string;
                    status?: string | null;
                    timezone?: string | null;
                    updated_at?: string | null;
                };
                Update: {
                    city?: string | null;
                    country?: string | null;
                    cover_photo?: string | null;
                    created_at?: string | null;
                    description?: string | null;
                    end_time?: string | null;
                    format?: string | null;
                    id?: number;
                    is_featured?: boolean | null;
                    is_published?: boolean | null;
                    location?: string | null;
                    location_details?: Json | null;
                    name?: string;
                    primary_source_link_id?: number | null;
                    region?: string | null;
                    slug?: string | null;
                    source?: string | null;
                    source_id?: string | number | null;
                    start_time?: string;
                    status?: string | null;
                    timezone?: string | null;
                    updated_at?: string | null;
                };
                Relationships: [];
            };
            organizations: {
                Row: {
                    created_at: string;
                    id: number;
                    is_active: boolean;
                    is_individual: boolean;
                    name: string;
                    primary_photo: string | null;
                    slug: string | null;
                    source_priority: string[] | null;
                    updated_at: string;
                    website: string | null;
                };
                Insert: {
                    created_at?: string;
                    id?: number;
                    is_active?: boolean;
                    is_individual?: boolean;
                    name: string;
                    primary_photo?: string | null;
                    slug?: string | null;
                    source_priority?: string[] | null;
                    updated_at?: string;
                    website?: string | null;
                };
                Update: {
                    created_at?: string;
                    id?: number;
                    is_active?: boolean;
                    is_individual?: boolean;
                    name?: string;
                    primary_photo?: string | null;
                    slug?: string | null;
                    source_priority?: string[] | null;
                    updated_at?: string;
                    website?: string | null;
                };
                Relationships: [];
            };
        };
        Views: {
            [_ in never]: never;
        };
        Functions: {
            find_event_matches: {
                Args: {
                    p_name: string;
                    p_start_time: string;
                    p_threshold?: number;
                    p_window_days?: number;
                };
                Returns: {
                    id: number;
                    name: string;
                    score: number;
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
    DefaultSchemaTableNameOrOptions extends
        | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
        | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    } ? keyof (
            & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
            & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views']
        )
        : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? (
        & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
        & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views']
    )[TableName] extends {
        Row: infer R;
    } ? R
    : never
    : DefaultSchemaTableNameOrOptions extends keyof (
        & DefaultSchema['Tables']
        & DefaultSchema['Views']
    ) ? (
            & DefaultSchema['Tables']
            & DefaultSchema['Views']
        )[DefaultSchemaTableNameOrOptions] extends {
            Row: infer R;
        } ? R
        : never
    : never;

export type TablesInsert<
    DefaultSchemaTableNameOrOptions extends
        | keyof DefaultSchema['Tables']
        | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
        : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
        Insert: infer I;
    } ? I
    : never
    : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
        ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
            Insert: infer I;
        } ? I
        : never
    : never;

export type TablesUpdate<
    DefaultSchemaTableNameOrOptions extends
        | keyof DefaultSchema['Tables']
        | { schema: keyof DatabaseWithoutInternals },
    TableName extends DefaultSchemaTableNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
        : never = never,
> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
        Update: infer U;
    } ? U
    : never
    : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
        ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
            Update: infer U;
        } ? U
        : never
    : never;

export type Enums<
    DefaultSchemaEnumNameOrOptions extends
        | keyof DefaultSchema['Enums']
        | { schema: keyof DatabaseWithoutInternals },
    EnumName extends DefaultSchemaEnumNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
        : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
    : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
        ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
    PublicCompositeTypeNameOrOptions extends
        | keyof DefaultSchema['CompositeTypes']
        | { schema: keyof DatabaseWithoutInternals },
    CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
        schema: keyof DatabaseWithoutInternals;
    } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
        : never = never,
> = PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
    : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
        ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
    graphql_public: {
        Enums: {},
    },
    public: {
        Enums: {},
    },
} as const;

export interface EventFromDB {
    id: string;
    name: string;
    description: string;
    start_time: string;
    end_time: string | null;
    location: string;
    cover_photo: string | null;
    created_at: string;
    updated_at: string;
    slug: string | null;

    accounts: AccountsFromDB | null;

    is_free: boolean;
    price?: number | null;
    is_online: boolean;
    status: 'scheduled' | 'cancelled' | 'postponed';
    is_featured?: boolean;

    account_id?: string;

    source: string; // facebook | manual | website
    source_id: string;

    tags?: EventTag[];
    type?: 'default' | 'workshop' | 'conference' | 'meetup';

    // The direct link to RSVP on the event
    ticket_url?: string;
}

export interface AccountsFromDB {
    created_at: string | number | Date;
    id: string;
    name: string;
    account_id: number;
    primary_photo: string;
    url?: string;
}

export interface EventRSVP {
    id: string;
    event_id: string;
    user_id: string;
    created_at: string;
}

export type SearchParams = {
    query?: string;
    filter?: string;
    page?: number;
    limit?: number;
};

export interface AccountsFromDB {
    id: string;
    name: string;
    account_id: number;
    page_access_token?: string;
    is_active?: boolean;
}

export interface EventCategory {
    id: string;
    name: string;
    event_count: number;
    slug: string;
    description?: string;
    icon?: string;
}

export interface EventOrganizer {
    id: string;
    name: string;
    logo?: string;
    description?: string;
    website?: string;
    is_verified: boolean;
    event_count: number;
    social_links?: {
        twitter?: string;
        facebook?: string;
        linkedin?: string;
    };
}

export interface LocationCount {
    location: string;
    count: number;
}

export interface EventTag {
    id: string;
    name: string;
    color: string;
}

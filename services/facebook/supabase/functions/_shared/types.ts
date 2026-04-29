export type FacebookCoverPhoto = {
    id: number;
    offset_x: number;
    offset_y: number;
    source: string;
};

export type FacebookLocation = {
    name: string;
    city: string;
    country: string;
    country_code: string;
    region: string;
    latitude: number;
    longitude: number;
};

export type FacebookPlace = {
    id: number;
    name: string;
    location: FacebookLocation;
};

export type FacebookCohost = {
    id: string | number;
    name: string;
    category?: string;
};

export type FacebookEvent = {
    id: number;
    name: string;
    description: string;
    cover: FacebookCoverPhoto;
    created_time: string;
    start_time: string;
    end_time?: string;
    place?: FacebookPlace;
    /**
     * Co-organizing pages on the event. Returned by the Graph API when the
     * `cohosts` field is requested. Shape can be either the paginated edge
     * (`{ data: [...] }`) or — defensively — a bare array.
     */
    cohosts?: { data: FacebookCohost[] } | FacebookCohost[];
};

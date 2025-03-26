export interface Organizer {
    name: string;
    avatar: string;
}

export interface Event {
    id: string;
    title: string;
    description: string;
    date: string;
    time: string;
    location: string;
    image: string;
    category: string;
    organizer: Organizer;
    price: string;
    attendees: number;
    maxAttendees: number;
}

export interface NavigationEvent {
    id: string;
    title: string;
    image: string;
}

// eventbrite.com and its country sites. Matched exactly so lookalike hosts such
// as eventbrite.attacker.example are rejected. Mirrors EVENTBRITE_HOST in
// services/eventbrite/supabase/functions/_shared/eventbriteutils.ts.
const EVENTBRITE_HOST =
    /^(?:www\.)?eventbrite\.(?:com|ca|ie|de|fr|es|it|nl|be|at|ch|pt|se|dk|fi|sg|hk|co|cl|co\.uk|co\.nz|com\.au|com\.br|com\.mx|com\.ar|com\.pe)$/;

export function isEventbriteHost(host: string): boolean {
    return EVENTBRITE_HOST.test(host.toLowerCase());
}

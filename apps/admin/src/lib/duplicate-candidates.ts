import type { EventRowForContent, SourceLinkForContent } from './event-source-content';

export interface DuplicateEventRow extends EventRowForContent {
    slug: string | null;
    status: string | null;
}

export interface DuplicateCandidate {
    target: DuplicateEventRow;
    duplicate: DuplicateEventRow;
    score: number;
    reasons: string[];
}

const STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'at',
    'by',
    'cebu',
    'event',
    'for',
    'in',
    'meetup',
    'of',
    'on',
    'the',
    'to',
    'with',
]);

const SOURCE_PRIORITY = ['luma', 'facebook', 'meetup', 'eventbrite', 'website', 'manual'];

export function normalizeTitle(input: string | null): string {
    return (input ?? '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function titleTokens(input: string | null): string[] {
    return normalizeTitle(input)
        .split(' ')
        .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function bigramScore(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const pairs = (value: string): string[] => {
        const compact = value.replace(/\s+/g, '');
        const out: string[] = [];
        for (let i = 0; i < compact.length - 1; i++) out.push(compact.slice(i, i + 2));
        return out;
    };

    const aPairs = pairs(a);
    const bPairs = pairs(b);
    if (aPairs.length === 0 || bPairs.length === 0) return 0;

    const counts = new Map<string, number>();
    for (const pair of aPairs) counts.set(pair, (counts.get(pair) ?? 0) + 1);

    let intersection = 0;
    for (const pair of bPairs) {
        const current = counts.get(pair) ?? 0;
        if (current <= 0) continue;
        counts.set(pair, current - 1);
        intersection++;
    }

    return (2 * intersection) / (aPairs.length + bPairs.length);
}

function tokenScore(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const aSet = new Set(a);
    const bSet = new Set(b);
    let intersection = 0;
    for (const token of aSet) if (bSet.has(token)) intersection++;
    const union = new Set([...aSet, ...bSet]).size;
    return union === 0 ? 0 : intersection / union;
}

function eventSimilarity(a: DuplicateEventRow, b: DuplicateEventRow): number {
    const aTitle = normalizeTitle(a.name);
    const bTitle = normalizeTitle(b.name);
    return bigramScore(aTitle, bTitle) * 0.65 + tokenScore(titleTokens(a.name), titleTokens(b.name)) * 0.35;
}

function isNearSameDay(a: string | null, b: string | null): boolean {
    if (!a || !b) return false;
    const aTime = new Date(a).getTime();
    const bTime = new Date(b).getTime();
    if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return false;
    return Math.abs(aTime - bTime) <= 36 * 60 * 60 * 1000;
}

function sourceRank(links: SourceLinkForContent[]): number {
    if (links.length === 0) return SOURCE_PRIORITY.length;
    return Math.min(
        ...links.map((link) => {
            const idx = SOURCE_PRIORITY.indexOf(link.source);
            return idx === -1 ? SOURCE_PRIORITY.length : idx;
        }),
        SOURCE_PRIORITY.length,
    );
}

function preferredTarget(
    a: DuplicateEventRow,
    b: DuplicateEventRow,
    linksByEvent: Map<number, SourceLinkForContent[]>,
): { target: DuplicateEventRow; duplicate: DuplicateEventRow } {
    const aLinks = linksByEvent.get(a.id) ?? [];
    const bLinks = linksByEvent.get(b.id) ?? [];

    if (aLinks.length !== bLinks.length) {
        return aLinks.length > bLinks.length ? { target: a, duplicate: b } : { target: b, duplicate: a };
    }

    const aRank = sourceRank(aLinks);
    const bRank = sourceRank(bLinks);
    if (aRank !== bRank) return aRank < bRank ? { target: a, duplicate: b } : { target: b, duplicate: a };

    return a.id < b.id ? { target: a, duplicate: b } : { target: b, duplicate: a };
}

function sameNormalizedTitle(a: DuplicateEventRow, b: DuplicateEventRow): boolean {
    const aTitle = normalizeTitle(a.name);
    const bTitle = normalizeTitle(b.name);
    return aTitle.length > 0 && aTitle === bTitle;
}

function hasLocationTension(a: DuplicateEventRow, b: DuplicateEventRow): boolean {
    const left = (a.location ?? '').toLowerCase();
    const right = (b.location ?? '').toLowerCase();
    if (!left || !right) return false;
    if (left === right) return false;
    return left.includes('makati') !== right.includes('makati') || left.includes('cebu') !== right.includes('cebu');
}

function buildReasons(
    a: DuplicateEventRow,
    b: DuplicateEventRow,
    score: number,
    linksByEvent: Map<number, SourceLinkForContent[]>,
): string[] {
    const reasons: string[] = [];
    if (sameNormalizedTitle(a, b)) reasons.push('same normalized title');
    if (isNearSameDay(a.start_time, b.start_time)) reasons.push('same date window');
    if (score >= 0.9) reasons.push('high title similarity');
    const aSources = new Set((linksByEvent.get(a.id) ?? []).map((link) => link.source));
    const bSources = new Set((linksByEvent.get(b.id) ?? []).map((link) => link.source));
    if ([...aSources].some((source) => bSources.has(source))) reasons.push('shared source type');
    if (hasLocationTension(a, b)) reasons.push('location conflict to review');
    return reasons;
}

export function groupSourceLinksByEvent(links: SourceLinkForContent[]): Map<number, SourceLinkForContent[]> {
    const sourceLinksByEvent = new Map<number, SourceLinkForContent[]>();
    for (const link of links) {
        const arr = sourceLinksByEvent.get(link.event_id) ?? [];
        arr.push(link);
        sourceLinksByEvent.set(link.event_id, arr);
    }
    return sourceLinksByEvent;
}

export function buildDuplicateCandidates(
    events: DuplicateEventRow[],
    links: SourceLinkForContent[],
    options: { threshold?: number; limit?: number } = {},
): DuplicateCandidate[] {
    const threshold = options.threshold ?? 0.72;
    const sourceLinksByEvent = groupSourceLinksByEvent(links);
    const candidates: DuplicateCandidate[] = [];
    const seenPairs = new Set<string>();

    for (let i = 0; i < events.length; i++) {
        const a = events[i];
        if (!a.start_time || a.status === 'hidden') continue;

        for (let j = i + 1; j < events.length; j++) {
            const b = events[j];
            if (!b.start_time || b.status === 'hidden') continue;
            if (!isNearSameDay(a.start_time, b.start_time)) continue;

            const score = eventSimilarity(a, b);
            if (score < threshold) continue;

            const pairKey = [a.id, b.id].sort((left, right) => left - right).join(':');
            if (seenPairs.has(pairKey)) continue;
            seenPairs.add(pairKey);

            const preferred = preferredTarget(a, b, sourceLinksByEvent);
            candidates.push({
                ...preferred,
                score,
                reasons: buildReasons(a, b, score, sourceLinksByEvent),
            });
        }
    }

    candidates.sort((a, b) => b.score - a.score);
    return typeof options.limit === 'number' ? candidates.slice(0, options.limit) : candidates;
}

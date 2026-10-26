export type TrustTier = 'manual' | 'partnership' | 'public_scrape';

export interface TrustTierOption {
    value: TrustTier;
    label: string;
    description: string;
}

export const TRUST_TIER_OPTIONS: TrustTierOption[] = [
    {
        value: 'manual',
        label: 'Community source',
        description: 'Added from a community or editorial source.',
    },
    {
        value: 'partnership',
        label: 'Cebby partner',
        description: 'Came through a signed Cebby partnership source.',
    },
    {
        value: 'public_scrape',
        label: 'Imported',
        description: 'Imported from a public page or scraper.',
    },
];

export function isTrustTier(value: string): value is TrustTier {
    return TRUST_TIER_OPTIONS.some((option) => option.value === value);
}

export function trustTierLabel(value: TrustTier): string {
    return TRUST_TIER_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function editableTrustTier(value: string | null | undefined, hasSourceUrl: boolean): TrustTier | null {
    if (value && isTrustTier(value)) return value;
    return hasSourceUrl ? 'public_scrape' : null;
}

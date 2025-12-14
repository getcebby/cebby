/**
 * Shared event utility functions
 */

export interface EventLocationDetails {
  name?: string;
  address?: string;
  [key: string]: unknown;
}

export interface EventWithLocation {
  location?: string | null;
  location_details?: string | EventLocationDetails | null;
}

/**
 * Extract a human-readable location from an event
 * Handles location field, location_details JSON, and fallbacks
 * @param event - Event object with location fields
 * @param fallback - Fallback value if no location found (default: 'TBA')
 * @returns Extracted location string
 */
export function extractEventLocation(
  event: EventWithLocation | null | undefined,
  fallback: string = 'TBA'
): string {
  if (!event) {
    return fallback;
  }

  let location = event.location;

  // Check if we should look at location_details instead
  const shouldCheckLocationDetails =
    !location ||
    location.trim() === '' ||
    location.toLowerCase() === 'online';

  if (shouldCheckLocationDetails && event.location_details) {
    try {
      const locationDetails: EventLocationDetails =
        typeof event.location_details === 'string'
          ? JSON.parse(event.location_details)
          : event.location_details;

      const detailsLocation = locationDetails?.name || locationDetails?.address;
      if (detailsLocation && detailsLocation.trim() !== '') {
        return detailsLocation;
      }
    } catch {
      // Failed to parse location_details, fall through to default
    }
  }

  // Return location if valid, otherwise fallback
  if (location && location.trim() !== '') {
    return location;
  }

  return fallback;
}

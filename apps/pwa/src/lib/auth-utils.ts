/**
 * Shared authentication utility functions
 */

// Type augmentation for window.authClient
declare global {
  interface Window {
    authClient?: any;
  }
}

export interface JwtPayload {
  sub: string;
  email?: string;
  name?: string;
  username?: string;
  [key: string]: unknown;
}

/**
 * Decode a JWT token and return its payload
 * @param token - JWT token string
 * @returns Decoded payload or null if not a valid JWT
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return null; // Not a JWT token
    }

    const payload = tokenParts[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '=='.substring(0, (4 - base64.length % 4) % 4);
    const decoded = atob(padded);
    return JSON.parse(decoded) as JwtPayload;
  } catch (error) {
    console.error('Error decoding JWT:', error);
    return null;
  }
}

/**
 * Check if a token is a JWT (has 3 parts separated by dots)
 */
export function isJwtToken(token: string): boolean {
  return token.split('.').length === 3;
}

/**
 * Extract user ID from JWT or opaque token
 * @param token - Access token (JWT or opaque)
 * @returns User ID (sub claim) or null if extraction fails
 */
export function getUserIdFromToken(token: string): string | null {
  const payload = decodeJwtPayload(token);
  return payload?.sub || null;
}

/**
 * Wait for auth client to be ready
 * @param timeout - Maximum wait time in milliseconds (default: 5000)
 * @returns Promise that resolves to true if auth client is ready, false otherwise
 */
export async function waitForAuthClient(timeout: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && window.authClient) {
      resolve(true);
      return;
    }
    
    const checkInterval = setInterval(() => {
      if (typeof window !== 'undefined' && window.authClient) {
        clearInterval(checkInterval);
        resolve(true);
      }
    }, 100);
    
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve(false);
    }, timeout);
  });
}

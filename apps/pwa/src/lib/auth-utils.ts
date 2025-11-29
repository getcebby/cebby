/**
 * Shared authentication utility functions
 */

// Type augmentation for window.authClient
declare global {
  interface Window {
    authClient?: any;
  }
}

/**
 * Extract user ID from JWT or opaque token
 * @param token - Access token (JWT or opaque)
 * @returns User ID (sub claim) or null if extraction fails
 */
export function getUserIdFromToken(token: string): string | null {
  try {
    const tokenParts = token.split('.');
    if (tokenParts.length === 3) {
      // JWT token - decode it
      const payload = tokenParts[1];
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '=='.substring(0, (4 - base64.length % 4) % 4);
      const decoded = atob(padded);
      const tokenPayload = JSON.parse(decoded);
      return tokenPayload.sub || null;
    }
  } catch (error) {
    console.error('Error decoding token:', error);
  }
  return null;
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

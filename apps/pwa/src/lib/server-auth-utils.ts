/**
 * Server-side authentication utility functions for API routes
 */

import { authHeaderSchema, userInfoSchema } from "./schemas";

// Auth provider OIDC endpoint - should be moved to env var in production
const LOGTO_USERINFO_ENDPOINT = "https://auth.gocebby.com/oidc/me";

export interface UserInfo {
  userId: string;
  userEmail: string;
  userName?: string;
}

/**
 * Extract and validate authentication token from request headers
 * @param request - Incoming request object
 * @returns Bearer token or null if invalid/missing
 */
export function extractAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  try {
    authHeaderSchema.parse(authHeader);
    return authHeader.substring(7); // Remove "Bearer " prefix
  } catch (error) {
    console.error("Invalid auth header format:", error);
    return null;
  }
}

/**
 * Resolve an access token to the user it belongs to.
 * Always asks Logto's userinfo endpoint: a token's own claims are never
 * trusted, since a JWT payload can be decoded (and forged) without the
 * signing key. The PWA requests no API resource, so Logto issues opaque
 * userinfo tokens that this endpoint validates.
 * @param token - Access token from the Authorization header
 * @returns User information or null if Logto rejects the token
 */
export async function getUserInfoFromToken(token: string): Promise<UserInfo | null> {
  try {
    const userinfoResponse = await fetch(LOGTO_USERINFO_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!userinfoResponse.ok) {
      console.error("Failed to fetch user info from Logto:", userinfoResponse.status);
      return null;
    }

    const rawUserInfo = await userinfoResponse.json();
    const userInfo = userInfoSchema.parse(rawUserInfo);

    return {
      userId: userInfo.sub,
      userEmail: userInfo.email,
      userName: userInfo.name || userInfo.username || undefined,
    };
  } catch (error) {
    console.error("Error fetching user info from Logto:", error);
    return null;
  }
}

/**
 * Convenience function to get authenticated user info from request
 * Combines token extraction and user info retrieval
 * @param request - Incoming request object
 * @returns User information or null if authentication fails
 */
export async function getAuthenticatedUser(request: Request): Promise<UserInfo | null> {
  const token = extractAuthToken(request);
  if (!token) {
    return null;
  }

  return getUserInfoFromToken(token);
}

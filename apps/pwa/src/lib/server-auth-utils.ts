/**
 * Server-side authentication utility functions for API routes
 */

import { z } from "zod";
import { authHeaderSchema, userInfoSchema } from "./schemas";
import { decodeJwtPayload, isJwtToken } from "./auth-utils";

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
 * Get user information from JWT or opaque token
 * Handles both JWT tokens (decoded locally) and opaque tokens (fetched from Logto OIDC)
 * @param token - Access token (JWT or opaque)
 * @returns User information or null if extraction fails
 */
export async function getUserInfoFromToken(token: string): Promise<UserInfo | null> {
  if (isJwtToken(token)) {
    // JWT token - decode it locally using shared utility
    const payload = decodeJwtPayload(token);
    if (!payload) {
      return null;
    }

    return {
      userId: payload.sub,
      userEmail: payload.email || "",
      userName: payload.name || payload.username || undefined,
    };
  } else {
    // Opaque token - fetch user info from Logto OIDC endpoint
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

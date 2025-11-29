/**
 * Server-side authentication utility functions for API routes
 */

import { z } from "zod";
import { authHeaderSchema, userInfoSchema } from "./schemas";

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
  const tokenParts = token.split(".");

  if (tokenParts.length === 3) {
    // JWT token - decode it locally
    try {
      const payload = tokenParts[1];
      const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "==".substring(0, (4 - (base64.length % 4)) % 4);
      const decoded = atob(padded);
      const tokenPayload = JSON.parse(decoded);

      return {
        userId: tokenPayload.sub,
        userEmail: tokenPayload.email,
        userName: tokenPayload.name || tokenPayload.username || undefined,
      };
    } catch (error) {
      console.error("Error decoding JWT token:", error);
      return null;
    }
  } else {
    // Opaque token - fetch user info from Logto OIDC endpoint
    try {
      const userinfoResponse = await fetch("https://auth.gocebby.com/oidc/me", {
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

import LogtoClient from "@logto/browser";

// Configuration
const LOGTO_ENDPOINT = "https://auth.gocebby.com";
const LOGTO_APP_ID = "15qc65ivakc49sim34ziu"; // Your actual app ID
// Note: SPAs don't use app secrets - they use PKCE for security

// Use a global singleton to ensure we only have one client instance
let globalLogtoClient: LogtoClient | null = null;

// Token cache with TTL
let tokenCache: {
  token: string | null;
  expiresAt: number;
} | null = null;

if (typeof window !== "undefined") {
  // Store on window to ensure true singleton across imports
  if (!(window as any).__logtoClient) {
    (window as any).__logtoClient = new LogtoClient({
      endpoint: LOGTO_ENDPOINT,
      appId: LOGTO_APP_ID,
      // No appSecret for SPA - uses PKCE instead
      scopes: ["openid profile email"],
    });
  }
  globalLogtoClient = (window as any).__logtoClient;

  // Store token cache on window as well for persistence across imports
  if (!(window as any).__logtoTokenCache) {
    (window as any).__logtoTokenCache = null;
  }
  tokenCache = (window as any).__logtoTokenCache;
}

// Initialize Logto client
export async function initLogto() {
  if (typeof window === "undefined") {
    return null;
  }

  return globalLogtoClient;
}

// Check if user is authenticated
export async function isAuthenticated(): Promise<boolean> {
  try {
    const client = await initLogto();
    if (!client) return false;
    return await client.isAuthenticated();
  } catch (error) {
    console.error("Auth check failed:", error);
    return false;
  }
}

// Get current user
export async function getUser() {
  try {
    const client = await initLogto();
    if (!client) return null;

    const authenticated = await client.isAuthenticated();
    if (!authenticated) return null;

    return await client.fetchUserInfo();
  } catch (error) {
    console.error("Failed to get user:", error);
    return null;
  }
}

// Sign in
export async function signIn(redirectUri?: string) {
  try {
    const client = await initLogto();
    if (!client) {
      throw new Error("Logto client not initialized");
    }

    // Store the current URL to redirect back after login
    if (!redirectUri) {
      redirectUri = window.location.href;
    }
    sessionStorage.setItem("logto_redirect_uri", redirectUri);

    // Use the exact callback URL including port
    // For development: http://localhost:4321/auth/callback
    // For production: https://yourdomain.com/auth/callback
    const callbackUrl =
      `${window.location.protocol}//${window.location.host}/auth/callback`;
    console.log("Sign-in redirect URI:", callbackUrl);

    // Redirect to Logto sign-in
    await client.signIn(callbackUrl);
  } catch (error) {
    console.error("Sign in failed:", error);
    throw error;
  }
}

// Sign out
export async function signOut() {
  try {
    const client = await initLogto();
    if (!client) {
      throw new Error("Logto client not initialized");
    }

    // Clear token cache before signing out
    tokenCache = null;
    if (typeof window !== "undefined") {
      (window as any).__logtoTokenCache = null;
    }

    await client.signOut(window.location.origin);
  } catch (error) {
    console.error("Sign out failed:", error);
    throw error;
  }
}

// Handle callback after sign-in
export async function handleCallback() {
  try {
    const client = await initLogto();
    if (!client) {
      throw new Error("Logto client not initialized");
    }

    // Log the current URL for debugging
    console.log("Callback URL:", window.location.href);

    // Check if we have the required parameters
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code || !state) {
      console.error("Missing required parameters in callback URL");
      console.log("Code:", code, "State:", state);
      throw new Error("Invalid callback parameters");
    }

    console.log("Attempting to handle callback with code and state...");

    // Handle the sign-in callback - this should exchange the code for tokens
    try {
      await client.handleSignInCallback(window.location.href);
      console.log("Callback handled successfully");

      // Important: Wait a bit for the storage to be updated
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify authentication after callback
      const isAuth = await client.isAuthenticated();
      console.log("Authentication status after callback:", isAuth);

      if (isAuth) {
        // Fetch and log user info to confirm
        const userInfo = await client.fetchUserInfo();
        console.log("User authenticated:", userInfo.sub);
      }
    } catch (callbackError) {
      console.error("handleSignInCallback error details:", callbackError);

      // Check if it's an OIDC error
      if (callbackError instanceof Error) {
        console.error("Error name:", callbackError.name);
        console.error("Error message:", callbackError.message);
        console.error("Error stack:", callbackError.stack);
      }

      throw callbackError;
    }

    // Get the stored redirect URI
    const redirectUri = sessionStorage.getItem("logto_redirect_uri") || "/";
    sessionStorage.removeItem("logto_redirect_uri");

    console.log("Redirecting to:", redirectUri);

    // Redirect back to the original page
    window.location.href = redirectUri;
  } catch (error) {
    console.error("Callback handling failed:", error);
    // Show more detailed error
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    console.error("Error details:", errorMessage);

    // Don't redirect on error - let the user see what happened
    throw error;
  }
}

// Get access token for API calls
export async function getAccessToken(): Promise<string | null> {
  try {
    const client = await initLogto();
    if (!client) return null;

    const authenticated = await client.isAuthenticated();
    if (!authenticated) {
      // Clear cache if not authenticated
      tokenCache = null;
      if (typeof window !== "undefined") {
        (window as any).__logtoTokenCache = null;
      }
      return null;
    }

    // Check if we have a valid cached token
    if (tokenCache && tokenCache.expiresAt > Date.now()) {
      return tokenCache.token;
    }

    // Fetch new token from Logto
    const token = await client.getAccessToken();

    // Cache the token with a 50-minute TTL (tokens typically expire in 1 hour)
    // We use 50 minutes to ensure we refresh before actual expiration
    tokenCache = {
      token,
      expiresAt: Date.now() + (50 * 60 * 1000), // 50 minutes in milliseconds
    };

    // Update global cache
    if (typeof window !== "undefined") {
      (window as any).__logtoTokenCache = tokenCache;
    }

    return token;
  } catch (error) {
    console.error("Failed to get access token:", error);
    // Clear cache on error
    tokenCache = null;
    if (typeof window !== "undefined") {
      (window as any).__logtoTokenCache = null;
    }
    return null;
  }
}

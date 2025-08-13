import type { APIRoute } from "astro";

// Simple in-memory store for online users
// In production, you might want to use Redis or a proper database
const onlineUsers = new Map<string, { timestamp: number; sessionId: string }>();
const PRESENCE_TIMEOUT = 60000; // 1 minute timeout

// Clean up expired users
function cleanupExpiredUsers() {
  const now = Date.now();
  for (const [sessionId, data] of onlineUsers.entries()) {
    if (now - data.timestamp > PRESENCE_TIMEOUT) {
      onlineUsers.delete(sessionId);
    }
  }
}

export const GET: APIRoute = async () => {
  try {
    // Clean up expired users before counting
    cleanupExpiredUsers();
    
    const count = onlineUsers.size;
    
    return new Response(
      JSON.stringify({ count }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      }
    );
  } catch (error) {
    console.error("Online count API error:", error);
    
    // Return a default count instead of failing
    return new Response(
      JSON.stringify({ count: 0 }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as {
      sessionId: string;
      action: "join" | "leave";
    };
    
    const { sessionId, action } = body;
    
    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: "Session ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (action === "join") {
      onlineUsers.set(sessionId, {
        timestamp: Date.now(),
        sessionId
      });
    } else if (action === "leave") {
      onlineUsers.delete(sessionId);
    }
    
    // Clean up and return current count
    cleanupExpiredUsers();
    const count = onlineUsers.size;
    
    return new Response(
      JSON.stringify({ success: true, count }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      }
    );
  } catch (error) {
    console.error("Online count update error:", error);
    
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
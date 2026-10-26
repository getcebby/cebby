import { z } from "zod";

// Auth-related schemas
export const userInfoSchema = z.object({
  sub: z.string(),
  email: z.email(),
  name: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
});

export const authHeaderSchema = z.string().startsWith(
  "Bearer ",
  "Authorization header must start with 'Bearer '",
);

// API response helpers
export const createApiError = (message: string, details?: any) => ({
  error: message,
  ...(details && { details }),
});

export const createValidationErrorResponse = (error: z.ZodError) => {
  return new Response(
    JSON.stringify(createApiError("Invalid request data", error.issues)),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );
};

export const createErrorResponse = (message: string, status: number = 500) => {
  return new Response(
    JSON.stringify(createApiError(message)),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
};

export const createSuccessResponse = (data: any, status: number = 200) => {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
};

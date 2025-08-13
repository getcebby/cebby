import { z } from 'zod';

// Common schemas
export const eventIdSchema = z.string().min(1, "Event ID is required");
export const eventIdNumberSchema = z.number().int().positive("Event ID must be a positive integer");

// Auth-related schemas
export const userInfoSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  username: z.string().optional(),
});

export const authHeaderSchema = z.string().startsWith("Bearer ", "Authorization header must start with 'Bearer '");

// Walk-in registration schema
export const walkinRegistrationSchema = z.object({
  eventId: z.union([z.string(), z.number()]).transform((val) => String(val)),
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  checkInImmediately: z.boolean().optional().default(false),
});

// RSVP schema
export const rsvpSchema = z.object({
  eventId: eventIdSchema,
});

// RSVP cancel schema
export const rsvpCancelSchema = z.object({
  eventId: eventIdSchema,
});

// Event check-in schema
export const eventCheckinSchema = z.object({
  qrCodeId: z.string().min(1, "QR code ID is required"),
  eventId: eventIdSchema,
});

// Test enable RSVP schema
export const testEnableRsvpSchema = z.object({
  eventId: z.string().min(1, "Event ID is required"),
  enable: z.boolean(),
});

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
      headers: { "Content-Type": "application/json" } 
    }
  );
};

export const createErrorResponse = (message: string, status: number = 500) => {
  return new Response(
    JSON.stringify(createApiError(message)),
    { 
      status, 
      headers: { "Content-Type": "application/json" } 
    }
  );
};

export const createSuccessResponse = (data: any, status: number = 200) => {
  return new Response(
    JSON.stringify(data),
    { 
      status, 
      headers: { "Content-Type": "application/json" } 
    }
  );
};
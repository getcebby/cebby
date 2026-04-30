import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';
import { z } from 'zod';
import { 
  testEnableRsvpSchema, 
  createValidationErrorResponse, 
  createErrorResponse, 
  createSuccessResponse 
} from '../../lib/schemas';

export const POST: APIRoute = async ({ request }) => {
    try {
        // Validate request body
        const rawBody = await request.json();
        const validatedBody = testEnableRsvpSchema.parse(rawBody);
        const { eventId, enable } = validatedBody;
        
        // v2: is_hidden replaced by status enum; registration_enabled column
        // dropped (RSVP-on-Cebby is killed per impeccable.md). This endpoint
        // is dormant — kept compiling but invoking it just toggles visibility.
        const { data, error } = await supabase
            .from('events')
            .update({
                status: enable ? 'hidden' : 'published',
            })
            .eq('id', parseInt(eventId, 10))
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        return createSuccessResponse({ 
            success: true, 
            event: data,
            message: `Registration ${enable ? 'enabled' : 'disabled'} for event` 
        });
    } catch (error) {
        console.error('Error updating event:', error);
        
        // Handle Zod validation errors
        if (error instanceof z.ZodError) {
            return createValidationErrorResponse(error);
        }
        
        return createErrorResponse('Failed to update event');
    }
};

export const GET: APIRoute = async ({ url }) => {
    const eventId = url.searchParams.get('eventId');
    
    if (!eventId) {
        return createErrorResponse('Event ID is required', 400);
    }
    
    try {
        const { data, error } = await supabase
            .from('events')
            .select('id, name, status')
            .eq('id', parseInt(eventId, 10))
            .single();
        
        if (error) throw error;
        
        return createSuccessResponse(data);
    } catch (error) {
        return createErrorResponse('Failed to get event');
    }
};
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
        
        // Update the event to enable/disable registration
        const { data, error } = await supabase
            .from('events')
            .update({ 
                is_hidden: enable ? true : false,
                registration_enabled: enable ? true : false 
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
            .select('id, name, is_hidden, registration_enabled')
            .eq('id', parseInt(eventId, 10))
            .single();
        
        if (error) throw error;
        
        return createSuccessResponse(data);
    } catch (error) {
        return createErrorResponse('Failed to get event');
    }
};
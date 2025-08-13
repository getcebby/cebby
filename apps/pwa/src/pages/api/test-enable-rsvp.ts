import type { APIRoute } from 'astro';
import { supabase } from '../../lib/supabase';

export const POST: APIRoute = async ({ request }) => {
    try {
        const { eventId, enable } = await request.json();
        
        if (!eventId) {
            return new Response(JSON.stringify({ error: 'Event ID is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Update the event to enable/disable registration
        const { data, error } = await supabase
            .from('events')
            .update({ 
                is_hidden: enable ? true : false,
                registration_enabled: enable ? true : false 
            })
            .eq('id', eventId)
            .select()
            .single();
        
        if (error) {
            throw error;
        }
        
        return new Response(JSON.stringify({ 
            success: true, 
            event: data,
            message: `Registration ${enable ? 'enabled' : 'disabled'} for event` 
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating event:', error);
        return new Response(JSON.stringify({ 
            error: 'Failed to update event',
            details: error 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

export const GET: APIRoute = async ({ url }) => {
    const eventId = url.searchParams.get('eventId');
    
    if (!eventId) {
        return new Response(JSON.stringify({ error: 'Event ID is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        const { data, error } = await supabase
            .from('events')
            .select('id, name, is_hidden, registration_enabled')
            .eq('id', eventId)
            .single();
        
        if (error) throw error;
        
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ 
            error: 'Failed to get event',
            details: error 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
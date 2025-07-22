export interface LogContext {
    [key: string]: unknown;
}

export const logger = {
    error: (message: string, context?: LogContext) => {
        if (import.meta.env.DEV) {
            console.error(`[ERROR] ${message}`, context);
        }
        
        // Trigger error boundary in browser environment
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('app-error', { 
                detail: { message, context } 
            }));
        }
        
        // In production, you can send to monitoring service like Sentry
        // Example: Sentry.captureException(new Error(message), { extra: context });
    },
    
    warn: (message: string, context?: LogContext) => {
        if (import.meta.env.DEV) {
            console.warn(`[WARN] ${message}`, context);
        }
    },
    
    info: (message: string, context?: LogContext) => {
        if (import.meta.env.DEV) {
            console.info(`[INFO] ${message}`, context);
        }
    },
    
    debug: (message: string, context?: LogContext) => {
        if (import.meta.env.DEV) {
            console.debug(`[DEBUG] ${message}`, context);
        }
    }
};
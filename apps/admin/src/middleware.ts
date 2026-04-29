import { defineMiddleware } from 'astro:middleware';

/**
 * HTTP basic auth gate. The admin app is for the single operator — there's no
 * user database, just one shared password set via the ADMIN_PASSWORD env var.
 * Any username works; the password must match.
 *
 * Uses 401 + WWW-Authenticate so the browser shows its native auth dialog.
 */
export const onRequest = defineMiddleware(async (context, next) => {
    const expected = import.meta.env.ADMIN_PASSWORD;
    if (!expected) {
        return new Response(
            'Server misconfigured: ADMIN_PASSWORD not set in .env',
            { status: 500 },
        );
    }

    const header = context.request.headers.get('authorization');
    if (!header || !header.startsWith('Basic ')) {
        return unauthorized();
    }

    let password: string;
    try {
        const encoded = header.slice('Basic '.length);
        const decoded = atob(encoded);
        password = decoded.split(':').slice(1).join(':');
    } catch {
        return new Response('Bad auth header', { status: 400 });
    }

    if (password !== expected) {
        return unauthorized();
    }

    return next();
});

function unauthorized(): Response {
    return new Response('Unauthorized', {
        status: 401,
        headers: {
            'WWW-Authenticate': 'Basic realm="Cebby Admin", charset="UTF-8"',
        },
    });
}

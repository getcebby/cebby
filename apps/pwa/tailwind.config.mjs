/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    theme: {
        extend: {
            container: {
                center: true,
                padding: '1rem',
            },
            fontFamily: {
                sans: [
                    'Inter',
                    'system-ui',
                    '-apple-system',
                    'BlinkMacSystemFont',
                    'Segoe UI',
                    'Roboto',
                    'Helvetica Neue',
                    'Arial',
                    'sans-serif',
                ],
            },
            keyframes: {
                typing: {
                    from: { width: '0' },
                    to: { width: '100%' },
                },
                erasing: {
                    from: { width: '100%' },
                    to: { width: '0' },
                },
                blink: {
                    'from, to': { borderColor: 'transparent' },
                    '50%': { borderColor: 'rgb(147 51 234)' },
                },
            },
            animation: {
                cursor: 'blink 1s steps(1) infinite',
            },
        },
    },
    plugins: [],
};

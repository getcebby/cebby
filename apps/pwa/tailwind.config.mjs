/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    theme: {
        extend: {
            container: {
                center: true,
                padding: '1rem',
            },
            colors: {
                'cebby-primary': {
                    DEFAULT: 'var(--cebby-primary)',
                    light: 'var(--cebby-primary-light)',
                    dark: 'var(--cebby-primary-dark)',
                },
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
        },
    },
    plugins: [],
};

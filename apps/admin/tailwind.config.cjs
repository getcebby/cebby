/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/**/*.{astro,html,ts,tsx,js,jsx}'],
    theme: {
        extend: {
            fontFamily: {
                sans: [
                    '-apple-system',
                    'BlinkMacSystemFont',
                    'Segoe UI',
                    'sans-serif',
                ],
            },
        },
    },
    plugins: [],
};

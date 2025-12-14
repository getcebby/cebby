/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
    theme: {
        extend: {
            colors: {
                'spotify-green': '#1db954',
                'spotify-black': '#191414',
                'spotify-white': '#ffffff',
                'neon-purple': '#b026ff',
                'neon-blue': '#4d4dff',
                'neon-pink': '#ff00ff',
            },
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
                'space-grotesk': ['Space Grotesk', 'sans-serif'],
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
                gradientBG: {
                    '0%': { backgroundPosition: '0% 50%' },
                    '50%': { backgroundPosition: '100% 50%' },
                    '100%': { backgroundPosition: '0% 50%' },
                },
                floatShape: {
                    '0%': { transform: 'translate(0, 0) rotate(0deg)' },
                    '100%': { transform: 'translate(30px, 30px) rotate(10deg)' },
                },
                slideIn: {
                    from: { opacity: '0', transform: 'scale(0.9) translateY(30px)' },
                    to: { opacity: '1', transform: 'scale(1) translateY(0)' },
                },
                fadeInUp: {
                    from: { opacity: '0', transform: 'translateY(40px)' },
                    to: { opacity: '1', transform: 'translateY(0)' },
                },
                scaleIn: {
                    from: { opacity: '0', transform: 'scale(0.5)' },
                    to: { opacity: '1', transform: 'scale(1)' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-200% center' },
                    '100%': { backgroundPosition: '200% center' },
                },
                pinPulse: {
                    '0%, 100%': { r: '8', opacity: '1' },
                    '50%': { r: '12', opacity: '0.7' },
                },
                slideInLeft: {
                    from: { opacity: '0', transform: 'translateX(-30px)' },
                    to: { opacity: '1', transform: 'translateX(0)' },
                },
                popIn: {
                    '0%': { opacity: '0', transform: 'scale(0.5)' },
                    '70%': { transform: 'scale(1.1)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                zoomIn: {
                    from: { opacity: '0', transform: 'scale(0.8)' },
                    to: { opacity: '1', transform: 'scale(1)' },
                },
                rotateIn: {
                    from: { opacity: '0', transform: 'rotate(-180deg) scale(0.5)' },
                    to: { opacity: '1', transform: 'rotate(0) scale(1)' },
                },
                bounceIn: {
                    '0%, 20%, 40%, 60%, 80%, 100%': { transitionTimingFunction: 'cubic-bezier(0.215, 0.610, 0.355, 1.000)' },
                    '0%': { opacity: '0', transform: 'scale3d(0.3, 0.3, 0.3)' },
                    '20%': { transform: 'scale3d(1.1, 1.1, 1.1)' },
                    '40%': { transform: 'scale3d(0.9, 0.9, 0.9)' },
                    '60%': { opacity: '1', transform: 'scale3d(1.03, 1.03, 1.03)' },
                    '80%': { transform: 'scale3d(0.97, 0.97, 0.97)' },
                    '100%': { opacity: '1', transform: 'scale3d(1, 1, 1)' },
                },
                slideUp: {
                    from: { transform: 'translateY(100%)', opacity: '0' },
                    to: { transform: 'translateY(0)', opacity: '1' },
                },
                zoomInOut: {
                    '0%': { transform: 'scale(1)' },
                    '50%': { transform: 'scale(1.05)' },
                    '100%': { transform: 'scale(1)' },
                },
                float: {
                    '0%': { transform: 'translateY(100vh) scale(0)', opacity: '0' },
                    '100%': { transform: 'translateY(-10vh) scale(1)', opacity: '1' },
                },
                glitch: {
                    '2%, 64%': { transform: 'translate(2px,0) skew(0deg)' },
                    '4%, 60%': { transform: 'translate(-2px,0) skew(0deg)' },
                    '62%': { transform: 'translate(0,0) skew(5deg)' },
                },
                glitchTop: {
                    '2%, 64%': { transform: 'translate(2px, -2px)' },
                    '4%, 60%': { transform: 'translate(-2px, 2px)' },
                    '62%': { transform: 'translate(13px, -1px) skew(-13deg)' },
                },
                glitchBottom: {
                    '2%, 64%': { transform: 'translate(-2px, 0)' },
                    '4%, 60%': { transform: 'translate(-2px, 0)' },
                    '62%': { transform: 'translate(-22px, 5px) skew(21deg)' },
                },
                sparkle: {
                    '0%, 100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
                    '50%': { transform: 'scale(1.3) rotate(180deg)', opacity: '0.7' },
                },
            },
            animation: {
                cursor: 'blink 1s steps(1) infinite',
                gradientBG: 'gradientBG 15s ease infinite',
                floatShape: 'floatShape 10s infinite ease-in-out alternate',
                slideIn: 'slideIn 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) both',
                fadeInUp: 'fadeInUp 0.8s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
                scaleIn: 'scaleIn 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
                shimmer: 'shimmer 1.5s infinite',
                pinPulse: 'pinPulse 2s ease-in-out infinite',
                slideInLeft: 'slideInLeft 0.5s ease-out forwards',
                popIn: 'popIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                zoomIn: 'zoomIn 0.8s ease-out forwards',
                rotateIn: 'rotateIn 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                bounceIn: 'bounceIn 1s forwards',
                slideUp: 'slideUp 0.8s ease-out forwards',
                zoomInOut: 'zoomInOut 3s ease-in-out infinite',
                float: 'float linear infinite',
                glitch: 'glitch 3s ease-in-out infinite',
                glitchTop: 'glitchTop 2s linear infinite',
                glitchBottom: 'glitchBottom 2.5s linear infinite',
                sparkle: 'sparkle 1.5s ease-in-out infinite',
            },
        },
    },
    plugins: [],
};

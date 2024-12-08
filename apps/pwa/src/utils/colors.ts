async function extractColors(imageUrl: string): Promise<{
    primary: string;
    secondary: string;
    background: string;
}> {
    try {
        // Create a temporary canvas and load the image
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Wait for image to load
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.crossOrigin = 'anonymous'; // Enable CORS
            img.src = imageUrl;
        });

        // Set canvas size to match image
        canvas.width = img.width;
        canvas.height = img.height;

        // Draw image to canvas
        if (!ctx) throw new Error('Could not get canvas context');
        ctx.drawImage(img, 0, 0);

        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        // Simple color extraction - get average of pixels
        let r = 0,
            g = 0,
            b = 0;
        const pixelCount = imageData.length / 4;

        for (let i = 0; i < imageData.length; i += 4) {
            r += imageData[i];
            g += imageData[i + 1];
            b += imageData[i + 2];
        }

        // Calculate average
        r = Math.round(r / pixelCount);
        g = Math.round(g / pixelCount);
        b = Math.round(b / pixelCount);

        // Generate color variations
        const primary = `rgb(${r}, ${g}, ${b})`;
        const secondary = `rgb(${Math.min(r + 30, 255)}, ${Math.min(g + 30, 255)}, ${Math.min(b + 30, 255)})`;
        const background = `rgb(${Math.max(r - 30, 0)}, ${Math.max(g - 30, 0)}, ${Math.max(b - 30, 0)})`;

        return {
            primary,
            secondary,
            background,
        };
    } catch (error) {
        console.error('Error extracting colors:', error);
        // Return default colors if extraction fails
        return {
            primary: '#8234E6',
            secondary: '#9756EA',
            background: '#6D12E2',
        };
    }
}

export { extractColors };

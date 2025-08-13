import { encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

// QR Code generation using a simple web API approach
export async function generateQRCode(data: string): Promise<string> {
  try {
    // Use QR Server API to generate QR code
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(data)}`;
    
    const response = await fetch(qrUrl);
    if (!response.ok) {
      throw new Error(`QR generation failed: ${response.statusText}`);
    }
    
    const imageBuffer = await response.arrayBuffer();
    const base64Image = encode(imageBuffer);
    
    return base64Image;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
}

export function createQRCodeDataUrl(base64Image: string): string {
  return `data:image/png;base64,${base64Image}`;
}
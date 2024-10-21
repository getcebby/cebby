import React, { useState, useEffect, useRef } from "react";

interface OptimizedImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  placeholderSrc?: string;
}

const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  alt,
  width,
  height,
  className = "",
  placeholderSrc = "/placeholder-image.jpg",
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && imgRef.current) {
            imgRef.current.src = src;
          }
        });
      },
      { rootMargin: "100px" }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      if (imgRef.current) {
        observer.unobserve(imgRef.current);
      }
    };
  }, [src]);

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ width, height }}
    >
      <img
        ref={imgRef}
        src={placeholderSrc}
        alt={alt}
        width={width}
        height={height}
        onLoad={() => setIsLoaded(true)}
        className={`
          absolute inset-0 w-full h-full object-cover transition-opacity duration-300
          ${isLoaded ? "opacity-100" : "opacity-0"}
        `}
      />
      <div
        className={`
          absolute inset-0 bg-gray-200 transition-opacity duration-300
          ${isLoaded ? "opacity-0" : "opacity-100"}
        `}
        style={{
          backgroundImage: `url(${placeholderSrc})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(10px)",
        }}
      />
    </div>
  );
};

export default OptimizedImage;

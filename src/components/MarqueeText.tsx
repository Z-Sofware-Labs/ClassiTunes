import React, { useState, useEffect, useRef } from 'react';

interface MarqueeTextProps {
  text: string;
  className?: string;
}

export const MarqueeText: React.FC<MarqueeTextProps> = ({ text, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    // Check if text exceeds container width
    if (containerRef.current && textRef.current) {
      setShouldAnimate(textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [text]);

  return (
    <div className={`overflow-hidden whitespace-nowrap ${className}`} ref={containerRef}>
      <span 
        ref={textRef}
        className={`inline-block ${shouldAnimate ? 'animate-marquee' : ''}`}
      >
        {text}
        {shouldAnimate && <span className="ml-8">{text}</span>}
      </span>
    </div>
  );
};

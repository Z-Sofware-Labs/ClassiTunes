import React, { useState, useEffect, useRef } from 'react';

interface MarqueeTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

export const MarqueeText: React.FC<MarqueeTextProps> = ({ text, className, style }) => {
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
    <div className={`overflow-hidden whitespace-nowrap leading-none py-[1px] ${className}`} style={style} ref={containerRef}>
      <span 
        ref={textRef}
        className={`inline-block leading-none ${shouldAnimate ? 'animate-marquee' : ''}`}
      >
        {text}
        {shouldAnimate && <span className="ml-8">{text}</span>}
      </span>
    </div>
  );
};

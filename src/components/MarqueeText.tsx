import React, { useState, useEffect, useRef, ReactNode } from 'react';

interface MarqueeTextProps {
  text?: string;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const MarqueeText: React.FC<MarqueeTextProps> = ({ text, children, className, style }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  const content = children !== undefined ? children : text;

  useEffect(() => {
    // Check if text exceeds container width
    if (containerRef.current && textRef.current) {
      setShouldAnimate(textRef.current.scrollWidth > containerRef.current.clientWidth);
    }
  }, [text, children]);

  return (
    <div className={`overflow-hidden whitespace-nowrap leading-none py-[1px] ${className}`} style={style} ref={containerRef}>
      <span 
        ref={textRef}
        className={`inline-block leading-none ${shouldAnimate ? 'animate-marquee' : ''}`}
      >
        {content}
        {shouldAnimate && <span className="ml-8">{content}</span>}
      </span>
    </div>
  );
};

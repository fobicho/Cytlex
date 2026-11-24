import { useId } from 'react';
import { cn } from '../lib/utils.js';

export default function CytlexLogoMark({ className, style, reduceMotion, strokeWidth = 23, decorative = false, themeColor = false }) {
  const gradientId = `cytlex-logo-gradient-${useId().replace(/:/g, '')}`;
  const gradientStops = themeColor
    ? [
        ['0%', 'hsl(var(--primary))', 1],
        ['28%', 'var(--sidebar-ribbon-gradient-shift)', 1],
        ['55%', 'hsl(var(--primary))', 1],
        ['78%', 'var(--sidebar-ribbon-gradient-shift)', 1],
        ['100%', 'hsl(var(--primary))', 1]
      ]
    : [
        ['0%', '#f9a8d4', 1],
        ['28%', '#ec4899', 1],
        ['55%', '#db2777', 1],
        ['78%', '#f472b6', 1],
        ['100%', '#f9a8d4', 1]
      ];

  return (
    <svg
      viewBox="0 0 512 512"
      className={cn('shrink-0', className)}
      style={style}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'Cytlex'}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%" spreadMethod="repeat">
          {gradientStops.map(([offset, color, opacity]) => (
            <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
          ))}
          {!reduceMotion && (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              values="-0.45 -0.45; 0.55 0.55"
              calcMode="linear"
              dur="8s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
      <text x="256" y="244" fill={`url(#${gradientId})`} stroke="hsl(var(--foreground))" strokeWidth={strokeWidth} strokeLinejoin="round" paintOrder="stroke fill" fontSize="340" fontWeight="700" textAnchor="middle" dominantBaseline="central" fontFamily="'Noto Sans CJK JP','Yu Gothic UI','Yu Gothic','Meiryo','MS Gothic',sans-serif">粘</text>
    </svg>
  );
}

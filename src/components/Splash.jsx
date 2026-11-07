import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { px, useScale } from '../lib/useScale.js';

const APPEAR = 400;
const BEAT = 500;
const EXIT = 800;

function Logo({ scale }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={px(72, scale, 58)}
      height={px(72, scale, 58)}
      role="img"
      aria-label="Cytlex"
      className="shrink-0 shadow-lg shadow-black/20"
      style={{ borderRadius: px(18, scale, 14) }}
    >
      <rect width="512" height="512" rx="112" fill="#ffffff" />
      <text
        x="256"
        y="244"
        fill="#ec4899"
        fontSize="340"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Noto Sans CJK JP','Yu Gothic UI','Yu Gothic','Meiryo','MS Gothic',sans-serif"
      >
        粘
      </text>
    </svg>
  );
}

export default function Splash({ trigger = 0, onDone = null, onExitStart = null }) {
  const scale = useScale();
  const [exiting, setExiting] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    setExiting(false);
    setGone(false);
    const toExit = setTimeout(() => {
      setExiting(true);
      if (typeof onExitStart === 'function') onExitStart();
    }, APPEAR + BEAT);
    const toDone = setTimeout(() => {
      setGone(true);
      if (typeof onDone === 'function') onDone();
    }, APPEAR + BEAT + EXIT);
    return () => {
      clearTimeout(toExit);
      clearTimeout(toDone);
    };
  }, [trigger, onDone, onExitStart]);

  if (gone) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-background"
      initial={{ y: '0%' }}
      animate={{ y: exiting ? '-100%' : '0%' }}
      transition={{ duration: EXIT / 1000, ease: [0.76, 0, 0.24, 1] }}
    >
      <motion.div
        className="flex items-center gap-4"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: APPEAR / 1000, ease: 'easeOut' }}
      >
        <Logo scale={scale} />
        <span className="font-display text-3xl font-semibold tracking-tight text-foreground">Cytlex</span>
      </motion.div>
    </motion.div>
  );
}

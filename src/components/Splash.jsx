import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const APPEAR = 900;
const BEAT = 500;
const EXIT = 800;

function Logo() {
  return (
    <svg
      viewBox="0 0 512 512"
      width="72"
      height="72"
      role="img"
      aria-label="Cytlex"
      className="shrink-0 rounded-[18px] shadow-lg shadow-black/20"
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

export default function Splash({ trigger = 0 }) {
  const [exiting, setExiting] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    setExiting(false);
    setGone(false);
    const toExit = setTimeout(() => setExiting(true), APPEAR + BEAT);
    const toDone = setTimeout(() => setGone(true), APPEAR + BEAT + EXIT);
    return () => {
      clearTimeout(toExit);
      clearTimeout(toDone);
    };
  }, [trigger]);

  if (gone) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background"
      initial={{ y: '0%' }}
      animate={{ y: exiting ? '-100%' : '0%' }}
      transition={{ duration: EXIT / 1000, ease: [0.76, 0, 0.24, 1] }}
    >
      <motion.div
        className="flex items-center gap-4"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: exiting ? 0 : 1, scale: exiting ? 0.96 : 1 }}
        transition={{ duration: APPEAR / 1000, ease: 'easeOut' }}
      >
        <Logo />
        <span className="font-display text-3xl font-semibold tracking-tight text-foreground">Cytlex</span>
      </motion.div>
    </motion.div>
  );
}
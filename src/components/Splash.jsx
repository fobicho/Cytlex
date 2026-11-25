import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { px, useScale } from '../lib/useScale.js';
import CytlexLogoMark from './CytlexLogoMark.jsx';

const APPEAR = 400;
const BEAT = 500;
const EXIT = 800;

export default function Splash({ trigger = 0, onDone = null, onExitStart = null }) {
  const scale = useScale();
  const reduceMotion = useReducedMotion();
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
        <CytlexLogoMark
          reduceMotion={reduceMotion}
          style={{ width: px(72, scale, 58), height: px(72, scale, 58) }}
        />
        <span className="font-brand text-3xl font-semibold tracking-tight text-foreground">Cytlex</span>
      </motion.div>
    </motion.div>
  );
}

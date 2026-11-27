import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { usePerformanceMode } from '../lib/usePerformanceMode.js';
import { px, useScale } from '../lib/useScale.js';
import CytlexLogoMark from './CytlexLogoMark.jsx';

const APPEAR = 400;
const BEAT = 500;
const EXIT = 800;

export default function Splash({ trigger = 0, onDone = null, onExitStart = null }) {
  const scale = useScale();
  const reduceMotion = usePerformanceMode();
  const [ready, setReady] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let toExit;
    let toDone;
    setReady(false);
    setExiting(false);
    setGone(false);

    Promise.resolve(document.fonts?.load(`600 ${px(37, scale, 30)} Satoshi`, 'Cytlex'))
      .catch(() => [])
      .then(() => {
        if (cancelled) return;
        setReady(true);
        toExit = setTimeout(() => {
          setExiting(true);
          if (typeof onExitStart === 'function') onExitStart();
        }, APPEAR + BEAT);
        toDone = setTimeout(() => {
          setGone(true);
          if (typeof onDone === 'function') onDone();
        }, APPEAR + BEAT + EXIT);
      });

    return () => {
      cancelled = true;
      clearTimeout(toExit);
      clearTimeout(toDone);
    };
  }, [trigger, onDone, onExitStart, scale]);

  if (gone) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-background"
      initial={{ y: '0%' }}
      animate={{ y: exiting ? '-100%' : '0%' }}
      transition={{ duration: EXIT / 1000, ease: [0.76, 0, 0.24, 1] }}
    >
      <motion.div
        className="flex items-center"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: ready ? 1 : 0, scale: ready ? 1 : 0.92 }}
        transition={{ duration: APPEAR / 1000, ease: 'easeOut' }}
        style={{ gap: px(12, scale, 12) }}
      >
        <CytlexLogoMark
          reduceMotion={reduceMotion}
          style={{ width: px(84, scale, 68), height: px(84, scale, 68) }}
        />
        <span className="font-brand text-3xl font-semibold tracking-tight text-foreground" style={{ fontSize: px(37, scale, 30) }}>Cytlex</span>
      </motion.div>
    </motion.div>
  );
}

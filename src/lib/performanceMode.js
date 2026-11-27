import { MotionGlobalConfig } from 'framer-motion';

let performanceModeActive = false;
let pausedAnimations = new Set();
let listenersInstalled = false;

function isInfiniteAnimation(animation) {
  return animation.effect?.getComputedTiming?.().iterations === Infinity;
}

function pauseStartedAnimation(event) {
  if (!performanceModeActive) return;
  for (const animation of event.target?.getAnimations?.() || []) {
    if (animation.playState !== 'running' || !isInfiniteAnimation(animation)) continue;
    animation.pause();
    pausedAnimations.add(animation);
  }
}

function installAnimationListeners() {
  if (listenersInstalled || typeof document === 'undefined') return;
  listenersInstalled = true;
  document.addEventListener('animationstart', pauseStartedAnimation, true);
}

export function applyPerformanceMode(enabled) {
  if (typeof document === 'undefined') return;
  const shouldPause = enabled === true;
  installAnimationListeners();

  if (shouldPause && !performanceModeActive) {
    pausedAnimations = new Set(
      (document.getAnimations?.() || []).filter((animation) => (
        animation.playState === 'running' && isInfiniteAnimation(animation)
      ))
    );
    pausedAnimations.forEach((animation) => animation.pause());
  } else if (!shouldPause && performanceModeActive) {
    pausedAnimations.forEach((animation) => {
      if (animation.playState === 'paused' && animation.effect) {
        try { animation.play(); } catch {}
      }
    });
    pausedAnimations.clear();
  }

  MotionGlobalConfig.skipAnimations = shouldPause;
  performanceModeActive = shouldPause;
  document.documentElement.setAttribute('data-performance-mode', shouldPause ? 'on' : 'off');
}

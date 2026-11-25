import { createContext, useContext } from 'react';

const LanguageLayoutMotionContext = createContext(false);

export const LanguageLayoutMotionProvider = LanguageLayoutMotionContext.Provider;

export function useLanguageLayoutMotion() {
  return useContext(LanguageLayoutMotionContext);
}

import { createContext, useContext } from 'react';
import type { StudioNodeData } from './model';

export interface StudioContextValue {
  updateNodeData: (id: string, patch: Partial<StudioNodeData>) => void;
  uploadSource: (file: File) => void;
  outputUrl: string;
  outputMeta: string;
  exportOutput: () => void;
}

export const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) {
    throw new Error('useStudio must be used inside StudioContext.Provider');
  }
  return value;
}

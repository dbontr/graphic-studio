import { createContext, useContext } from 'react';
import type { EngineTelemetry } from './engine/types';
import type { StudioNodeData } from './model';

export interface StudioContextValue {
  checkpoint: () => void;
  updateNodeData: (id: string, patch: Partial<StudioNodeData>) => void;
  uploadSource: (file: File) => void;
  extractPalette: (count?: number) => Promise<string[]>;
  sourceBitmap: ImageBitmap | null;
  outputBitmap: ImageBitmap | null;
  outputMeta: string;
  telemetry: EngineTelemetry | null;
  rendering: boolean;
  exportOutput: () => void;
}

export const StudioContext = createContext<StudioContextValue | null>(null);

export function useStudio(): StudioContextValue {
  const value = useContext(StudioContext);
  if (!value) throw new Error('useStudio must be used inside StudioContext.Provider');
  return value;
}

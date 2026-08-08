import { create } from 'zustand';

export interface TranscriptEntry {
  key: string;
  /** 'self' for our own captions. */
  peerId: string;
  displayName: string;
  text: string;
  timestamp: number;
}

interface CaptionState {
  captionsEnabled: boolean;
  /** peerId -> most recent (interim or final) caption text, for the live overlay on each tile. */
  liveCaptions: Record<string, string>;
  /** Finalized captions only, in order; this is the transcript sent to /api/ai/summarize. */
  transcript: TranscriptEntry[];

  setCaptionsEnabled: (enabled: boolean) => void;
  upsertLiveCaption: (peerId: string, text: string) => void;
  clearLiveCaption: (peerId: string) => void;
  appendTranscriptEntry: (entry: TranscriptEntry) => void;
  reset: () => void;
}

const initialState = {
  captionsEnabled: false,
  liveCaptions: {} as Record<string, string>,
  transcript: [] as TranscriptEntry[],
};

export const useCaptionStore = create<CaptionState>((set) => ({
  ...initialState,

  setCaptionsEnabled: (enabled) => set({ captionsEnabled: enabled }),

  upsertLiveCaption: (peerId, text) =>
    set((state) => ({ liveCaptions: { ...state.liveCaptions, [peerId]: text } })),

  clearLiveCaption: (peerId) =>
    set((state) => {
      const { [peerId]: _removed, ...liveCaptions } = state.liveCaptions;
      return { liveCaptions };
    }),

  appendTranscriptEntry: (entry) =>
    set((state) => ({ transcript: [...state.transcript, entry] })),

  reset: () => set(initialState),
}));

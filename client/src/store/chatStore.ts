import { create } from 'zustand';

export interface ChatMessageEntry {
  key: string;
  /** 'self' for our own messages. */
  peerId: string;
  displayName: string;
  text: string;
  timestamp: number;
}

export interface FileTransferEntry {
  /** `${peerId}:${fileId}`, 'self' as peerId for outgoing transfers. */
  key: string;
  fileId: string;
  peerId: string;
  displayName: string;
  name: string;
  size: number;
  mimeType: string;
  direction: 'incoming' | 'outgoing';
  transferredBytes: number;
  status: 'in-progress' | 'complete' | 'error';
  blobUrl?: string;
}

interface ChatState {
  messages: ChatMessageEntry[];
  unreadCount: number;
  chatOpen: boolean;
  fileTransfers: Record<string, FileTransferEntry>;

  /** Appends a message without touching the unread count; for our own outgoing messages. */
  addMessage: (message: ChatMessageEntry) => void;
  /** Appends an incoming message and bumps unread only while the panel is closed. */
  receiveMessage: (message: ChatMessageEntry) => void;
  /** Bumps unread for non-chat-message notifications (e.g. an incoming file) while closed. */
  bumpUnreadIfClosed: () => void;
  setChatOpen: (open: boolean) => void;
  upsertFileTransfer: (entry: FileTransferEntry) => void;
  setFileTransferProgress: (key: string, transferredBytes: number) => void;
  completeFileTransfer: (key: string, blobUrl?: string) => void;
  failFileTransfer: (key: string) => void;
  reset: () => void;
}

const initialState = {
  messages: [] as ChatMessageEntry[],
  unreadCount: 0,
  chatOpen: false,
  fileTransfers: {} as Record<string, FileTransferEntry>,
};

export const useChatStore = create<ChatState>((set) => ({
  ...initialState,

  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),

  receiveMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
      unreadCount: state.chatOpen ? state.unreadCount : state.unreadCount + 1,
    })),

  bumpUnreadIfClosed: () =>
    set((state) => (state.chatOpen ? state : { unreadCount: state.unreadCount + 1 })),

  setChatOpen: (open) =>
    set((state) => ({ chatOpen: open, unreadCount: open ? 0 : state.unreadCount })),

  upsertFileTransfer: (entry) =>
    set((state) => ({ fileTransfers: { ...state.fileTransfers, [entry.key]: entry } })),

  setFileTransferProgress: (key, transferredBytes) =>
    set((state) => {
      const existing = state.fileTransfers[key];
      if (!existing) return state;
      return {
        fileTransfers: { ...state.fileTransfers, [key]: { ...existing, transferredBytes } },
      };
    }),

  completeFileTransfer: (key, blobUrl) =>
    set((state) => {
      const existing = state.fileTransfers[key];
      if (!existing) return state;
      return {
        fileTransfers: {
          ...state.fileTransfers,
          [key]: { ...existing, status: 'complete', transferredBytes: existing.size, blobUrl },
        },
      };
    }),

  failFileTransfer: (key) =>
    set((state) => {
      const existing = state.fileTransfers[key];
      if (!existing) return state;
      return { fileTransfers: { ...state.fileTransfers, [key]: { ...existing, status: 'error' } } };
    }),

  // Blob URLs outlive the RTCDataChannel they arrived on, so a leave-and-rejoin within the
  // same SPA session (no full page reload) would leak them without an explicit revoke here.
  reset: () =>
    set((state) => {
      for (const transfer of Object.values(state.fileTransfers)) {
        if (transfer.blobUrl) URL.revokeObjectURL(transfer.blobUrl);
      }
      return initialState;
    }),
}));

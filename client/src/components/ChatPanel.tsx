import { MAX_FILE_SIZE } from '@patchbay/shared';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import type { ChangeEvent, ComponentPropsWithoutRef, FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import type { ChatMessageEntry, FileTransferEntry } from '../store/chatStore';

export type SummaryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; text: string }
  | { status: 'error'; message: string };

interface ChatPanelProps {
  messages: ChatMessageEntry[];
  fileTransfers: FileTransferEntry[];
  onSendMessage: (text: string) => void;
  onSendFile: (file: File) => void;
  onClose: () => void;
  transcriptAvailable: boolean;
  summaryState: SummaryState;
  onSummarize: () => void;
}

const markdownComponents = {
  h1: (props: ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  h2: (props: ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="mb-1 mt-2 text-sm font-semibold first:mt-0" {...props} />
  ),
  ul: (props: ComponentPropsWithoutRef<'ul'>) => (
    <ul className="ml-4 list-disc space-y-0.5" {...props} />
  ),
  p: (props: ComponentPropsWithoutRef<'p'>) => <p className="mb-1" {...props} />,
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function transferStatusLabel(transfer: FileTransferEntry): string {
  if (transfer.direction === 'outgoing') return transfer.status === 'complete' ? 'sent' : 'sending';
  return transfer.status === 'complete' ? 'received' : 'receiving';
}

export function ChatPanel({
  messages,
  fileTransfers,
  onSendMessage,
  onSendFile,
  onClose,
  transcriptAvailable,
  summaryState,
  onSummarize,
}: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, fileTransfers.length]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setDraft('');
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onSendFile(file);
    e.target.value = '';
  }

  return (
    <div className="flex h-full w-full flex-col rounded-lg border border-neutral-700 bg-neutral-800 text-white sm:w-80">
      <div className="flex items-center justify-between border-b border-neutral-700 p-3">
        <h2 className="text-sm font-semibold">Chat</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="text-neutral-400 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <div className="border-b border-neutral-700 p-3">
        {summaryState.status === 'idle' && (
          <p className="mb-2 text-[11px] leading-snug text-neutral-500">
            {transcriptAvailable
              ? 'Patchbay keeps a local transcript of the call from on-device speech ' +
                'recognition (even while the caption overlay is off). Clicking below sends ' +
                'it, once, to our free AI summarizer. Nothing is sent until you click, and ' +
                "there's no account or API key involved."
              : 'Free AI summaries are built in: Patchbay transcribes speech on-device ' +
                'during the call (nothing has been said yet; the button unlocks once ' +
                'someone speaks with their mic on).'}
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onSummarize}
            disabled={summaryState.status === 'loading' || !transcriptAvailable}
            title={transcriptAvailable ? undefined : 'Nothing has been said yet'}
            className="rounded bg-neutral-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {summaryState.status === 'loading' ? 'Summarizing…' : 'Summarize meeting'}
          </button>
          {summaryState.status === 'done' && (
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(summaryState.text)}
              className="text-xs text-blue-400 underline"
            >
              Copy
            </button>
          )}
        </div>
        {summaryState.status === 'error' && (
          <p className="mt-2 text-xs text-red-400">{summaryState.message}</p>
        )}
        {summaryState.status === 'done' && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded bg-neutral-900/50 p-2 text-xs">
            <Markdown components={markdownComponents}>{summaryState.text}</Markdown>
          </div>
        )}
      </div>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && fileTransfers.length === 0 && (
          <p className="text-xs leading-relaxed text-neutral-500">
            Messages here go directly peer-to-peer. Nothing passes through the server. Click{' '}
            <span className="text-neutral-300">📎</span> below to send a file too (up to{' '}
            {formatBytes(MAX_FILE_SIZE)}), also sent directly to everyone in the room.
          </p>
        )}
        {messages.map((message) => (
          <div key={message.key} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">
                {message.peerId === 'self' ? 'You' : message.displayName}
              </span>
              <span className="text-xs text-neutral-500">{formatTime(message.timestamp)}</span>
            </div>
            <p className="break-words text-neutral-200">{message.text}</p>
          </div>
        ))}

        {fileTransfers.map((transfer) => (
          <div key={transfer.key} className="rounded bg-neutral-700/50 p-2 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">
                {transfer.peerId === 'self' ? 'You' : transfer.displayName}
              </span>
              <span className="text-xs text-neutral-500">
                {transferStatusLabel(transfer)} {transfer.name} ({formatBytes(transfer.size)})
              </span>
            </div>
            {transfer.status === 'in-progress' && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-neutral-600">
                <div
                  className="h-full bg-blue-500"
                  style={{
                    width: `${Math.round((transfer.transferredBytes / transfer.size) * 100)}%`,
                  }}
                />
              </div>
            )}
            {transfer.status === 'complete' &&
              transfer.direction === 'incoming' &&
              transfer.blobUrl && (
                <a
                  href={transfer.blobUrl}
                  download={transfer.name}
                  className="text-xs text-blue-400 underline"
                >
                  Download
                </a>
              )}
            {transfer.status === 'error' && <span className="text-xs text-red-400">Failed</span>}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-700 p-3">
        <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center rounded bg-neutral-700 px-2 text-white hover:bg-neutral-600"
          title={`Attach a file (up to ${formatBytes(MAX_FILE_SIZE)}, peer-to-peer)`}
          aria-label="Attach a file"
        >
          <Paperclip size={16} />
        </button>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          className="min-w-0 flex-1 rounded bg-neutral-700 px-2 py-1.5 text-sm outline-none"
        />
        <button
          type="submit"
          aria-label="Send message"
          className="flex shrink-0 items-center gap-1 rounded bg-blue-500 px-3 py-1.5 text-sm font-medium hover:bg-blue-400"
        >
          <SendHorizontal size={14} />
          Send
        </button>
      </form>
    </div>
  );
}

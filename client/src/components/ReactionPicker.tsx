import { motion } from 'motion/react';

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const REACTIONS = ['👍', '👏', '❤️', '😂', '🎉'];

export function ReactionPicker({ onSelect, onClose }: ReactionPickerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.95 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      style={{ originY: 1 }}
      className="absolute bottom-full mb-2 flex gap-1 rounded-lg border border-neutral-700 bg-neutral-800 p-2 shadow-lg"
    >
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onSelect(emoji);
            onClose();
          }}
          className="rounded p-1.5 text-2xl hover:bg-neutral-700"
        >
          {emoji}
        </button>
      ))}
    </motion.div>
  );
}

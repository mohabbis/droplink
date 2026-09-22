import { useRef, useState, type DragEvent } from 'react';
import { UploadIcon } from './icons';

interface DropZoneProps {
  onFiles(files: File[]): void;
  compact?: boolean;
  disabled?: boolean;
}

/** Drag-and-drop target plus a native file picker for keyboard and touch users. */
export function DropZone({ onFiles, compact, disabled }: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  const onDragEnter = (e: DragEvent) => {
    if (disabled || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    depth.current += 1;
    setActive(true);
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setActive(false);
  };
  const onDragOver = (e: DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setActive(false);
    if (disabled) return;
    // Folders show up as zero-byte entries with no type; skip them.
    const files = [...e.dataTransfer.files].filter((f) => f.size > 0 || f.type !== '');
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`dropzone${compact ? ' dropzone--compact' : ''}${active ? ' dropzone--active' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="dropzone"
    >
      <div className="dropzone__icon">
        <UploadIcon size={compact ? 18 : 22} />
      </div>
      <div className="dropzone__text">
        <p className="dropzone__title">{compact ? 'Add more files' : 'Drop files here'}</p>
        {!compact && <p className="dropzone__hint">Any type, any size. Nothing is uploaded to a server.</p>}
      </div>
      <button
        type="button"
        className={`btn ${compact ? 'btn--small' : 'btn--primary'}`}
        onClick={() => input.current?.click()}
        disabled={disabled}
      >
        Choose files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

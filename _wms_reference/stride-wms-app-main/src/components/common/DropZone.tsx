import { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  hint?: string;
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const types = accept.split(',').map(t => t.trim());
  return types.some(type => {
    if (type.endsWith('/*')) {
      return file.type.startsWith(type.replace('/*', '/'));
    }
    if (type.startsWith('.')) {
      return file.name.toLowerCase().endsWith(type.toLowerCase());
    }
    return file.type === type;
  });
}

export function DropZone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  className,
  children,
  hint,
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    dragCounter.current++;
    if (e.dataTransfer.items?.length) {
      setIsDragOver(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounter.current = 0;
    if (disabled) return;

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    const filtered = droppedFiles.filter(f => matchesAccept(f, accept));
    const filesToUse = multiple ? filtered : filtered.slice(0, 1);

    if (filesToUse.length > 0) {
      onFiles(filesToUse);
    }
  }, [accept, disabled, multiple, onFiles]);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn('relative', className)}
    >
      {children}
      {isDragOver && !disabled && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-lg pointer-events-none">
          <MaterialIcon name="upload_file" className="text-[40px] text-primary mb-2" />
          <p className="text-sm font-medium text-primary">Drop files here</p>
        </div>
      )}
      {hint && (
        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
          <MaterialIcon name="drag_indicator" className="text-[14px]" />
          {hint}
        </p>
      )}
    </div>
  );
}

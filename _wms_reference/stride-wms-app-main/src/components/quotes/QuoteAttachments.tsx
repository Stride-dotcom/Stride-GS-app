import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { DropZone } from '@/components/common/DropZone';
import { QuoteAttachment } from '@/lib/quotes/types';

interface QuoteAttachmentsProps {
  attachments: QuoteAttachment[];
  canEdit: boolean;
  onUpload: (file: File) => Promise<QuoteAttachment | null>;
  onRemove: (attachment: QuoteAttachment) => Promise<boolean>;
  onAttachmentsChanged: () => void;
}

const FILE_SIZE_LIMIT = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'picture_as_pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'table_chart';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'description';
  return 'attach_file';
}

export function QuoteAttachments({
  attachments,
  canEdit,
  onUpload,
  onRemove,
  onAttachmentsChanged,
}: QuoteAttachmentsProps) {
  const [uploading, setUploading] = useState(false);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (files: File[]) => {
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > FILE_SIZE_LIMIT) continue;
        await onUpload(file);
      }
      onAttachmentsChanged();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processFiles(Array.from(files));
  };

  const handleRemove = async (attachment: QuoteAttachment) => {
    setRemovingPath(attachment.storage_path);
    try {
      const success = await onRemove(attachment);
      if (success) {
        onAttachmentsChanged();
      }
    } finally {
      setRemovingPath(null);
    }
  };

  return (
    <DropZone
      onFiles={processFiles}
      accept={ACCEPTED_TYPES.join(',')}
      disabled={!canEdit || uploading}
      hint={canEdit ? 'Drag and drop files here, or click Add Files' : undefined}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="attach_file" size="md" />
              Attachments
              {attachments.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({attachments.length})
                </span>
              )}
            </CardTitle>
            {canEdit && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPTED_TYPES.join(',')}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  ) : (
                    <MaterialIcon name="upload_file" size="sm" className="mr-2" />
                  )}
                  {uploading ? 'Uploading...' : 'Add Files'}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {attachments.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <MaterialIcon name="folder_open" size="xl" className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No attachments yet</p>
              {canEdit && (
                <p className="text-xs mt-1">Upload documents, photos, or other files (max 10MB each)</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {attachments.map((attachment) => {
                const isImage = attachment.mime_type.startsWith('image/');
                const isRemoving = removingPath === attachment.storage_path;

                return (
                  <div
                    key={attachment.storage_path}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-background hover:bg-muted/50 transition-colors"
                  >
                    {/* Thumbnail or Icon */}
                    {isImage ? (
                      <div className="w-10 h-10 rounded border overflow-hidden flex-shrink-0 bg-muted">
                        <img
                          src={attachment.file_url}
                          alt={attachment.file_name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded border flex items-center justify-center flex-shrink-0 bg-muted">
                        <MaterialIcon name={getFileIcon(attachment.mime_type)} size="md" className="text-muted-foreground" />
                      </div>
                    )}

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{attachment.file_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(attachment.file_size)}
                        {attachment.uploaded_by_name && (
                          <> &middot; {attachment.uploaded_by_name}</>
                        )}
                        {' '}&middot; {new Date(attachment.uploaded_at).toLocaleDateString()}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => window.open(attachment.file_url, '_blank')}
                        title="Download"
                      >
                        <MaterialIcon name="download" size="sm" />
                      </Button>
                      {canEdit && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleRemove(attachment)}
                          disabled={isRemoving}
                          title="Remove"
                        >
                          {isRemoving ? (
                            <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                          ) : (
                            <MaterialIcon name="delete" size="sm" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </DropZone>
  );
}

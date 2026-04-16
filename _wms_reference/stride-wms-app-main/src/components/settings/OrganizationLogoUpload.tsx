import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { DropZone } from '@/components/common/DropZone';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface OrganizationLogoUploadProps {
  logoUrl: string | null;
  uploading: boolean;
  onUpload: (file: File) => Promise<string | null>;
  onRemove: () => Promise<boolean>;
  organizationName?: string;
}

export function OrganizationLogoUpload({
  logoUrl,
  uploading,
  onUpload,
  onRemove,
  organizationName,
}: OrganizationLogoUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return;
    await onUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  const handleDroppedFiles = async (files: File[]) => {
    if (files.length > 0) await processFile(files[0]);
  };

  const handleRemove = async () => {
    setRemoving(true);
    await onRemove();
    setRemoving(false);
  };

  const getInitials = () => {
    if (organizationName) {
      return organizationName
        .split(' ')
        .map((word) => word[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return 'ORG';
  };

  return (
    <DropZone
      onFiles={handleDroppedFiles}
      accept="image/*"
      multiple={false}
      disabled={uploading}
      hint="Drag and drop a logo image, or click Upload Logo"
    >
    <div className="space-y-4">
      <Label>Organization Logo</Label>
      <div className="flex items-center gap-6">
        <Avatar className="h-24 w-24 rounded-lg">
          {logoUrl ? (
            <AvatarImage src={logoUrl} alt="Organization logo" className="object-contain" />
          ) : null}
          <AvatarFallback className="rounded-lg bg-muted">
            <MaterialIcon name="apartment" size="lg" className="text-muted-foreground" />
          </AvatarFallback>
        </Avatar>

        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <MaterialIcon name="upload" size="sm" className="mr-2" />
                  Upload Logo
                </>
              )}
            </Button>

            {logoUrl && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={removing}
                  >
                    {removing ? (
                      <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                    ) : (
                      <MaterialIcon name="delete" size="sm" />
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove Logo</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to remove the organization logo? This will remove it from all places in the app.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRemove}>Remove</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Recommended: Square image, at least 200x200px. Max 5MB.
          </p>
        </div>
      </div>
    </div>
    </DropZone>
  );
}

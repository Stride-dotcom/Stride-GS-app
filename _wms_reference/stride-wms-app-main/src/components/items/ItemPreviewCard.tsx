import { useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useItemPreview } from '@/hooks/useItemPreview';
import { cn } from '@/lib/utils';

interface ItemPreviewCardProps {
  itemId: string;
  children: React.ReactNode;
}

export function ItemPreviewCard({ itemId, children }: ItemPreviewCardProps) {
  const { data, isLoading } = useItemPreview(itemId);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);

  const photos = data?.photos || [];
  const item = data?.item;

  const handlePrevPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentPhotoIndex((prev) => (prev > 0 ? prev - 1 : photos.length - 1));
  };

  const handleNextPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentPhotoIndex((prev) => (prev < photos.length - 1 ? prev + 1 : 0));
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'in_storage':
        return 'bg-green-500';
      case 'pending':
        return 'bg-yellow-500';
      case 'released':
        return 'bg-blue-500';
      case 'disposed':
        return 'bg-red-500';
      default:
        return 'bg-muted-foreground';
    }
  };

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent 
        className="w-72 p-0 overflow-hidden" 
        side="right" 
        align="start"
        sideOffset={8}
      >
        {isLoading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-40 w-full rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : item ? (
          <div>
            {/* Photo Section */}
            <div className="relative h-40 bg-muted">
              {photos.length > 0 ? (
                <>
                  <img
                    src={photos[currentPhotoIndex]?.storage_url}
                    alt={item.item_code}
                    className="h-full w-full object-cover"
                  />
                  {photos.length > 1 && (
                    <>
                      <button
                        onClick={handlePrevPhoto}
                        className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-background/80 flex items-center justify-center hover:bg-background transition-colors"
                      >
                        <MaterialIcon name="chevron_left" size="sm" />
                      </button>
                      <button
                        onClick={handleNextPhoto}
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-background/80 flex items-center justify-center hover:bg-background transition-colors"
                      >
                        <MaterialIcon name="chevron_right" size="sm" />
                      </button>
                      {/* Dot indicators */}
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                        {photos.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentPhotoIndex(idx);
                            }}
                            className={cn(
                              "h-1.5 w-1.5 rounded-full transition-colors",
                              idx === currentPhotoIndex ? "bg-primary" : "bg-primary/40"
                            )}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : item.primary_photo_url ? (
                <img
                  src={item.primary_photo_url}
                  alt={item.item_code}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center">
                  <MaterialIcon name="inventory_2" className="text-[48px] text-muted-foreground/50" />
                </div>
              )}
            </div>

            {/* Info Section */}
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{item.item_code}</span>
                <Badge variant="outline" className="text-xs gap-1">
                  <span className={cn("h-1.5 w-1.5 rounded-full", getStatusColor(item.status))} />
                  {item.status?.replace(/_/g, ' ')}
                </Badge>
              </div>

              {item.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {item.description}
                </p>
              )}

              <div className="grid gap-1.5 text-xs">
                {item.vendor && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MaterialIcon name="label" className="text-[12px]" />
                    <span>{item.vendor}</span>
                  </div>
                )}
                {(item as any).location_code && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MaterialIcon name="location_on" className="text-[12px]" />
                    <span>{(item as any).location_code}</span>
                    {(item as any).warehouse_name && (
                      <span className="text-muted-foreground/70">• {(item as any).warehouse_name}</span>
                    )}
                  </div>
                )}
                {(item as any).client_account && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <MaterialIcon name="person" className="text-[12px]" />
                    <span>{(item as any).client_account}</span>
                    {item.sidemark && (
                      <span className="text-muted-foreground/70">• {item.sidemark}</span>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-1 border-t text-xs text-muted-foreground">
                Qty: <span className="font-medium text-foreground">{item.quantity}</span>
                {item.room && (
                  <> • Room: <span className="font-medium text-foreground">{item.room}</span></>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 text-center text-muted-foreground text-sm">
            Item not found
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

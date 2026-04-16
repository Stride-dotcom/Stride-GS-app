import { useState, useMemo } from 'react';
import { Location } from '@/hooks/useLocations';
import { Warehouse } from '@/hooks/useWarehouses';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface LocationListProps {
  locations: Location[];
  warehouses: Warehouse[];
  loading: boolean;
  onEdit: (locationId: string) => void;
  onRefresh: () => void;
  onPrintSelected: (locations: Location[]) => void;
}

export function LocationList({
  locations,
  warehouses,
  loading,
  onEdit,
  onRefresh,
  onPrintSelected,
}: LocationListProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const warehouseMap = useMemo(() => {
    return new Map(warehouses.map((w) => [w.id, w]));
  }, [warehouses]);

  const handleDeleteClick = (location: Location) => {
    setLocationToDelete(location);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!locationToDelete) return;

    try {
      setDeleting(true);
      const { error } = await supabase
        .from('locations')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', locationToDelete.id);

      if (error) throw error;

      toast({
        title: 'Location deleted',
        description: `${locationToDelete.code} has been deleted.`,
      });
      onRefresh();
    } catch (error) {
      console.error('Error deleting location:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete location. It may have items or child locations.',
      });
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setLocationToDelete(null);
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === locations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(locations.map((l) => l.id)));
    }
  };

  const handlePrintSelected = () => {
    const selected = locations.filter((l) => selectedIds.has(l.id));
    onPrintSelected(selected);
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  const getTypeBadge = (type: string) => {
    // Backward-compatible: "aisle" was renamed to "row".
    const normalizedType = type === 'aisle' ? 'row' : type;
    const colors: Record<string, string> = {
      zone: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      row: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      aisle: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200', // legacy alias
      bay: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      bin: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      shelf: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
      release: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return (
      <Badge variant="outline" className={colors[normalizedType] || colors[type] || ''}>
        {normalizedType.charAt(0).toUpperCase() + normalizedType.slice(1)}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (locations.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center h-48 text-center">
          <MaterialIcon name="location_on" size="xl" className="text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No locations yet</h3>
          <p className="text-muted-foreground text-sm mt-1">
            Get started by adding zones, aisles, or bin locations.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Locations</CardTitle>
              <CardDescription>
                {locations.length} location{locations.length !== 1 ? 's' : ''} configured
              </CardDescription>
            </div>
            {selectedIds.size > 0 && (
              <Button variant="outline" size="sm" onClick={handlePrintSelected}>
                <MaterialIcon name="print" size="sm" className="mr-2" />
                Print {selectedIds.size} Label{selectedIds.size !== 1 ? 's' : ''}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedIds.size === locations.length && locations.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((location) => {
                const warehouse = warehouseMap.get(location.warehouse_id);
                return (
                  <TableRow key={location.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(location.id)}
                        onCheckedChange={() => toggleSelect(location.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                        {location.code}
                      </code>
                    </TableCell>
                    <TableCell>{location.name || '—'}</TableCell>
                    <TableCell>{getTypeBadge(location.type)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {warehouse?.name || '—'}
                    </TableCell>
                    <TableCell>{getStatusBadge(location.status)}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MaterialIcon name="more_horiz" size="sm" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onEdit(location.id)}>
                            <MaterialIcon name="edit" size="sm" className="mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onPrintSelected([location])}>
                            <MaterialIcon name="print" size="sm" className="mr-2" />
                            Print Label
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteClick(location)}
                          >
                            <MaterialIcon name="delete" size="sm" className="mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{locationToDelete?.code}</strong>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

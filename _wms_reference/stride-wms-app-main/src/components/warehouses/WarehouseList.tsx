import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Warehouse } from '@/hooks/useWarehouses';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
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

interface WarehouseListProps {
  warehouses: Warehouse[];
  loading: boolean;
  onEdit: (warehouseId: string) => void;
  onRefresh: () => void;
}

export function WarehouseList({ warehouses, loading, onEdit, onRefresh }: WarehouseListProps) {
  const navigate = useNavigate();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [warehouseToDelete, setWarehouseToDelete] = useState<Warehouse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  const handleDeleteClick = (warehouse: Warehouse) => {
    setWarehouseToDelete(warehouse);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!warehouseToDelete) return;

    try {
      setDeleting(true);
      // Soft delete
      const { error } = await supabase
        .from('warehouses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', warehouseToDelete.id);

      if (error) throw error;

      toast({
        title: 'Warehouse deleted',
        description: `${warehouseToDelete.name} has been deleted.`,
      });
      onRefresh();
    } catch (error) {
      console.error('Error deleting warehouse:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete warehouse',
      });
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setWarehouseToDelete(null);
    }
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  const formatAddress = (warehouse: Warehouse) => {
    const parts = [warehouse.city, warehouse.state, warehouse.country].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'No address';
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <MaterialIcon name="progress_activity" className="animate-spin text-muted-foreground" style={{ fontSize: '32px' }} />
        </CardContent>
      </Card>
    );
  }

  if (warehouses.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center h-48 text-center">
          <MaterialIcon name="apartment" className="text-muted-foreground mb-4" style={{ fontSize: '48px' }} />
          <h3 className="text-lg font-medium">No warehouses yet</h3>
          <p className="text-muted-foreground text-sm mt-1">
            Get started by adding your first warehouse.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>All Warehouses</CardTitle>
          <CardDescription>
            {warehouses.length} warehouse{warehouses.length !== 1 ? 's' : ''} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warehouses.map((warehouse) => (
                <TableRow 
                  key={warehouse.id} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onEdit(warehouse.id)}
                >
                  <TableCell className="font-medium">{warehouse.name}</TableCell>
                  <TableCell>
                    <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
                      {warehouse.code}
                    </code>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MaterialIcon name="location_on" size="sm" />
                      {formatAddress(warehouse)}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {warehouse.timezone}
                  </TableCell>
                  <TableCell>{getStatusBadge(warehouse.status)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MaterialIcon name="more_horiz" size="sm" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/warehouses/${warehouse.id}/map`)}>
                          <MaterialIcon name="map" size="sm" className="mr-2" />
                          Map Builder
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/warehouses/${warehouse.id}/heatmap`)}>
                          <MaterialIcon name="whatshot" size="sm" className="mr-2" />
                          Heat Map
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/warehouses/${warehouse.id}/zones`)}>
                          <MaterialIcon name="grid_on" size="sm" className="mr-2" />
                          Zones
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEdit(warehouse.id)}>
                          <MaterialIcon name="edit" size="sm" className="mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDeleteClick(warehouse)}
                        >
                          <MaterialIcon name="delete" size="sm" className="mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Warehouse</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{warehouseToDelete?.name}</strong>?
              This action cannot be undone. All locations and items within this warehouse
              will become inaccessible.
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

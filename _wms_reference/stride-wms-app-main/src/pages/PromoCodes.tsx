/**
 * PromoCodes Page - Manage promotional discount codes
 */

import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import { usePromoCodes, PromoCode, PromoCodeInput } from '@/hooks/usePromoCodes';
import { PromoCodeDialog } from '@/components/billing/PromoCodeDialog';
import { format } from 'date-fns';

export default function PromoCodes() {
  const { promoCodes, loading, createPromoCode, updatePromoCode, deletePromoCode, toggleActive } = usePromoCodes();
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedPromoCode, setSelectedPromoCode] = useState<PromoCode | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promoToDelete, setPromoToDelete] = useState<PromoCode | null>(null);

  // Filter promo codes by search
  const filteredPromoCodes = promoCodes.filter(pc =>
    pc.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = () => {
    setSelectedPromoCode(null);
    setDialogOpen(true);
  };

  const handleEdit = (promoCode: PromoCode) => {
    setSelectedPromoCode(promoCode);
    setDialogOpen(true);
  };

  const handleSave = async (input: PromoCodeInput): Promise<boolean> => {
    if (selectedPromoCode) {
      return await updatePromoCode(selectedPromoCode.id, input);
    } else {
      const result = await createPromoCode(input);
      return result !== null;
    }
  };

  const handleDeleteClick = (promoCode: PromoCode) => {
    setPromoToDelete(promoCode);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (promoToDelete) {
      await deletePromoCode(promoToDelete.id);
      setDeleteDialogOpen(false);
      setPromoToDelete(null);
    }
  };

  const formatDiscount = (pc: PromoCode) => {
    if (pc.discount_type === 'percentage') {
      return `${pc.discount_value}%`;
    }
    return `$${pc.discount_value.toFixed(2)}`;
  };

  const getStatusBadge = (pc: PromoCode) => {
    if (!pc.is_active) {
      return <Badge variant="secondary">Inactive</Badge>;
    }
    if (pc.expiration_type === 'date' && pc.expiration_date) {
      const expirationDate = new Date(pc.expiration_date);
      if (expirationDate < new Date()) {
        return <Badge variant="destructive">Expired</Badge>;
      }
    }
    if (pc.usage_limit_type === 'limited' && pc.usage_limit && pc.usage_count >= pc.usage_limit) {
      return <Badge variant="outline">Limit Reached</Badge>;
    }
    return <Badge className="bg-green-500">Active</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Promo Codes</h1>
            <p className="text-muted-foreground">
              Create and manage promotional discount codes
            </p>
          </div>
          <Button onClick={handleCreate}>
            <MaterialIcon name="add" size="sm" className="mr-2" />
            Create Promo Code
          </Button>
        </div>

        {/* Main Content */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Promo Codes</CardTitle>
                <CardDescription>
                  {promoCodes.length} promo code{promoCodes.length !== 1 ? 's' : ''} total
                </CardDescription>
              </div>
              <div className="w-64">
                <Input
                  placeholder="Search codes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredPromoCodes.length === 0 ? (
              <div className="text-center py-12">
                <MaterialIcon name="confirmation_number" size="xl" className="mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No promo codes</h3>
                <p className="text-muted-foreground mt-1">
                  {searchQuery ? 'No codes match your search' : 'Create your first promo code to get started'}
                </p>
                {!searchQuery && (
                  <Button className="mt-4" onClick={handleCreate}>
                    <MaterialIcon name="add" size="sm" className="mr-2" />
                    Create Promo Code
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Applies To</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20">Active</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPromoCodes.map((pc) => (
                    <TableRow key={pc.id}>
                      <TableCell>
                        <span className="font-mono font-bold text-primary">{pc.code}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{formatDiscount(pc)}</span>
                        <span className="text-muted-foreground text-xs ml-1">
                          {pc.discount_type === 'percentage' ? 'off' : 'discount'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {pc.service_scope === 'all' ? (
                          <span className="text-sm">All services</span>
                        ) : (
                          <span className="text-sm">
                            {pc.selected_services?.length || 0} service{(pc.selected_services?.length || 0) !== 1 ? 's' : ''}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {pc.usage_count}
                          {pc.usage_limit_type === 'limited' && pc.usage_limit && (
                            <span className="text-muted-foreground">/{pc.usage_limit}</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        {pc.expiration_type === 'none' ? (
                          <span className="text-sm text-muted-foreground">Never</span>
                        ) : pc.expiration_date ? (
                          <span className="text-sm">
                            {format(new Date(pc.expiration_date), 'MMM d, yyyy')}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(pc)}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={pc.is_active}
                          onCheckedChange={(checked) => toggleActive(pc.id, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MaterialIcon name="more_vert" size="sm" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(pc)}>
                              <MaterialIcon name="edit" size="sm" className="mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteClick(pc)}
                              className="text-destructive"
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <PromoCodeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        promoCode={selectedPromoCode}
        onSave={handleSave}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Promo Code</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the promo code "{promoToDelete?.code}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

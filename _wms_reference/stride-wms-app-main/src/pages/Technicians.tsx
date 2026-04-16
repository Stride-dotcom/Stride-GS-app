import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  DropdownMenuSeparator,
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
import { useTechnicians, Technician } from '@/hooks/useTechnicians';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { TechnicianDialog } from '@/components/technicians/TechnicianDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardDescription,
  MobileDataCardContent,
  MobileDataCardActions,
} from '@/components/ui/mobile-data-card';

export default function Technicians() {
  const isMobile = useIsMobile();
  const {
    technicians,
    loading,
    refetch,
    deleteTechnician,
    toggleActive,
    formatTechnicianDisplay,
  } = useTechnicians();

  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTechnician, setSelectedTechnician] = useState<Technician | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [techToDelete, setTechToDelete] = useState<Technician | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const handleAddTechnician = () => {
    setSelectedTechnician(null);
    setDialogOpen(true);
  };

  const handleEditTechnician = (tech: Technician) => {
    setSelectedTechnician(tech);
    setDialogOpen(true);
  };

  const handleDeleteClick = (tech: Technician) => {
    setTechToDelete(tech);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (techToDelete) {
      await deleteTechnician(techToDelete.id);
      setDeleteDialogOpen(false);
      setTechToDelete(null);
    }
  };

  const handleToggleActive = async (tech: Technician) => {
    await toggleActive(tech.id, !tech.is_active);
  };

  const getSpecialtyBadgeColor = (specialty: string) => {
    const colors: Record<string, string> = {
      wood: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      leather: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      upholstery: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      metal: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
      fabric: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
      electronics: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      glass: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
      stone: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-200',
      antique: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      refinishing: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      structural: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return colors[specialty] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  };

  // Filter technicians
  const filteredTechnicians = technicians.filter(tech => {
    const matchesSearch =
      tech.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tech.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tech.specialties.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesActive = showInactive || tech.is_active;

    return matchesSearch && matchesActive;
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageHeader
            primaryText="Repair"
            accentText="Technicians"
            description="Manage external contractors for repair work"
          />
          <Button onClick={handleAddTechnician}>
            <MaterialIcon name="add" size="sm" className="mr-2" />
            Add Technician
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="build" size="md" />
                  Technicians
                </CardTitle>
                <CardDescription>
                  {technicians.filter(t => t.is_active).length} active technicians
                </CardDescription>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="show-inactive"
                    checked={showInactive}
                    onCheckedChange={setShowInactive}
                  />
                  <label htmlFor="show-inactive" className="text-sm text-muted-foreground">
                    Show inactive
                  </label>
                </div>
                <div className="relative w-64">
                  <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search technicians..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredTechnicians.length === 0 ? (
              <div className="text-center py-12">
                <MaterialIcon name="build" size="xl" className="mx-auto text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No technicians found</h3>
                <p className="text-muted-foreground">
                  {searchQuery
                    ? 'Try a different search term'
                    : 'Add your first technician to get started'}
                </p>
              </div>
            ) : isMobile ? (
              <div className="space-y-3">
                {filteredTechnicians.map((tech) => (
                  <MobileDataCard
                    key={tech.id}
                    onClick={() => handleEditTechnician(tech)}
                    className={!tech.is_active ? 'opacity-60' : ''}
                  >
                    <MobileDataCardHeader>
                      <div>
                        <MobileDataCardTitle className="flex items-center gap-2">
                          {tech.name}
                          {!tech.is_active && (
                            <Badge variant="secondary" className="text-xs">Inactive</Badge>
                          )}
                        </MobileDataCardTitle>
                        <MobileDataCardDescription className="flex items-center gap-1">
                          <MaterialIcon name="mail" size="sm" />
                          {tech.email}
                        </MobileDataCardDescription>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium flex items-center gap-1">
                          <MaterialIcon name="percent" size="sm" />
                          {tech.markup_percent}% markup
                        </div>
                        {tech.hourly_rate && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                            <MaterialIcon name="attach_money" size="sm" />
                            ${tech.hourly_rate}/hr
                          </div>
                        )}
                      </div>
                    </MobileDataCardHeader>
                    <MobileDataCardContent>
                      <div className="flex flex-wrap gap-1">
                        {tech.specialties.map((specialty) => (
                          <Badge
                            key={specialty}
                            variant="secondary"
                            className={getSpecialtyBadgeColor(specialty)}
                          >
                            {specialty}
                          </Badge>
                        ))}
                        {tech.specialties.length === 0 && (
                          <span className="text-muted-foreground text-xs">No specialties</span>
                        )}
                      </div>
                    </MobileDataCardContent>
                    <MobileDataCardActions>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditTechnician(tech);
                        }}
                      >
                        <MaterialIcon name="more_horiz" size="sm" />
                      </Button>
                    </MobileDataCardActions>
                  </MobileDataCard>
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Specialties</TableHead>
                    <TableHead className="text-right">Markup</TableHead>
                    <TableHead className="text-right">Hourly Rate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTechnicians.map((tech) => (
                    <TableRow
                      key={tech.id}
                      className={`cursor-pointer ${!tech.is_active ? 'opacity-60' : ''}`}
                      onClick={() => handleEditTechnician(tech)}
                    >
                      <TableCell className="font-medium">
                        {tech.name}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-sm">
                            <MaterialIcon name="mail" size="sm" className="text-muted-foreground" />
                            {tech.email}
                          </div>
                          {tech.phone && (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <MaterialIcon name="phone" size="sm" />
                              {tech.phone}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {tech.specialties.map((specialty) => (
                            <Badge
                              key={specialty}
                              variant="secondary"
                              className={getSpecialtyBadgeColor(specialty)}
                            >
                              {specialty}
                            </Badge>
                          ))}
                          {tech.specialties.length === 0 && (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {tech.markup_percent}%
                      </TableCell>
                      <TableCell className="text-right">
                        {tech.hourly_rate ? `$${tech.hourly_rate}/hr` : '-'}
                      </TableCell>
                      <TableCell>
                        {tech.is_active ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MaterialIcon name="more_horiz" size="sm" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditTechnician(tech)}>
                              <MaterialIcon name="edit" size="sm" className="mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggleActive(tech)}>
                              <MaterialIcon name="power_settings_new" size="sm" className="mr-2" />
                              {tech.is_active ? 'Deactivate' : 'Activate'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDeleteClick(tech)}
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

      <TechnicianDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        technician={selectedTechnician}
        onSuccess={refetch}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Technician</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{techToDelete?.name}"? This action cannot be undone.
              If this technician has associated quotes, the deletion may fail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

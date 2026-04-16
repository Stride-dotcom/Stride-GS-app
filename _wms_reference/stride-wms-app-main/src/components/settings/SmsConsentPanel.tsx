import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useSmsConsent, SmsConsentRecord } from '@/hooks/useSmsConsent';

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  opted_in: { label: 'Opted In', variant: 'default' },
  opted_out: { label: 'Opted Out', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'secondary' },
};

const METHOD_LABELS: Record<string, string> = {
  text_keyword: 'Text Keyword',
  web_form: 'Web Form',
  verbal: 'Verbal',
  admin_manual: 'Admin (Manual)',
  imported: 'Imported',
};

function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-()]/g, '');
  if (stripped.startsWith('+')) return '+' + stripped.slice(1).replace(/\D/g, '');
  return '+' + stripped.replace(/\D/g, '');
}

export function SmsConsentPanel() {
  const { records, loading, createConsent, updateConsent, deleteConsent } = useSmsConsent();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newStatus, setNewStatus] = useState<'opted_in' | 'opted_out' | 'pending'>('pending');
  const [newMethod, setNewMethod] = useState<SmsConsentRecord['consent_method']>('admin_manual');
  const [addSaving, setAddSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredRecords = records.filter((r) => {
    const matchesSearch =
      !searchQuery ||
      r.phone_number.includes(searchQuery) ||
      (r.contact_name && r.contact_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleAdd = async () => {
    if (!newPhone.trim()) return;
    setAddSaving(true);
    const result = await createConsent({
      phone_number: normalizePhone(newPhone),
      contact_name: newContactName || null,
      status: newStatus,
      consent_method: newMethod,
    });
    setAddSaving(false);
    if (result) {
      setShowAddDialog(false);
      setNewPhone('');
      setNewContactName('');
      setNewStatus('pending');
      setNewMethod('admin_manual');
    }
  };

  const handleToggleStatus = async (record: SmsConsentRecord) => {
    const nextStatus = record.status === 'opted_in' ? 'opted_out' : 'opted_in';
    await updateConsent(record.id, { status: nextStatus, consent_method: 'admin_manual' });
  };

  const handleDelete = async (id: string) => {
    await deleteConsent(id);
  };

  const counts = {
    opted_in: records.filter((r) => r.status === 'opted_in').length,
    opted_out: records.filter((r) => r.status === 'opted_out').length,
    pending: records.filter((r) => r.status === 'pending').length,
  };

  if (loading) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="how_to_reg" size="md" />
            SMS Consent Tracking
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-32">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="how_to_reg" size="md" />
          SMS Consent Tracking
        </CardTitle>
        <CardDescription>
          Track opt-in/opt-out status for each phone number. Required for TCPA compliance and Twilio verification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Badges */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5">
            <Badge variant="default" className="text-xs">{counts.opted_in}</Badge>
            <span className="text-xs text-muted-foreground">Opted In</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="destructive" className="text-xs">{counts.opted_out}</Badge>
            <span className="text-xs text-muted-foreground">Opted Out</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="secondary" className="text-xs">{counts.pending}</Badge>
            <span className="text-xs text-muted-foreground">Pending</span>
          </div>
        </div>

        <Separator />

        {/* Filters + Add */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Search</Label>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by phone or name..."
              className="text-sm"
            />
          </div>
          <div className="w-full sm:w-[150px] space-y-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="opted_in">Opted In</SelectItem>
                <SelectItem value="opted_out">Opted Out</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" size="sm" onClick={() => setShowAddDialog(true)}>
            <MaterialIcon name="add" size="sm" className="mr-1" />
            Add Number
          </Button>
        </div>

        {/* Table */}
        {filteredRecords.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {records.length === 0
              ? 'No consent records yet. Add phone numbers to start tracking opt-in status.'
              : 'No records match your search.'}
          </div>
        ) : (
          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-sm">{record.phone_number}</TableCell>
                    <TableCell className="text-sm">{record.contact_name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_CONFIG[record.status]?.variant || 'secondary'}>
                        {STATUS_CONFIG[record.status]?.label || record.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {record.consent_method ? METHOD_LABELS[record.consent_method] || record.consent_method : '-'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      {record.status === 'opted_in' && record.opted_in_at
                        ? new Date(record.opted_in_at).toLocaleDateString()
                        : record.status === 'opted_out' && record.opted_out_at
                        ? new Date(record.opted_out_at).toLocaleDateString()
                        : new Date(record.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleToggleStatus(record)}
                          title={record.status === 'opted_in' ? 'Opt Out' : 'Opt In'}
                        >
                          <MaterialIcon
                            name={record.status === 'opted_in' ? 'do_not_disturb_on' : 'check_circle'}
                            size="sm"
                            className={record.status === 'opted_in' ? 'text-destructive' : 'text-green-600'}
                          />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleDelete(record.id)}
                          title="Delete"
                        >
                          <MaterialIcon name="delete" size="sm" className="text-muted-foreground" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Add Consent Record Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Consent Record</DialogTitle>
            <DialogDescription>
              Add a phone number and its opt-in status for SMS consent tracking.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Phone Number</Label>
              <Input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="+12065551234"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">E.164 format (e.g. +1XXXXXXXXXX)</p>
            </div>
            <div className="space-y-1.5">
              <Label>Contact Name (optional)</Label>
              <Input
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                placeholder="John Smith"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Consent Status</Label>
              <Select value={newStatus} onValueChange={(v) => setNewStatus(v as typeof newStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opted_in">Opted In</SelectItem>
                  <SelectItem value="opted_out">Opted Out</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Consent Method</Label>
              <Select value={newMethod || ''} onValueChange={(v) => setNewMethod(v as SmsConsentRecord['consent_method'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin_manual">Admin (Manual)</SelectItem>
                  <SelectItem value="text_keyword">Text Keyword</SelectItem>
                  <SelectItem value="web_form">Web Form</SelectItem>
                  <SelectItem value="verbal">Verbal</SelectItem>
                  <SelectItem value="imported">Imported</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleAdd} disabled={addSaving || !newPhone.trim()}>
              {addSaving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Record'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

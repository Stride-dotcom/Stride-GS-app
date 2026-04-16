import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTaskTypes } from '@/hooks/useTasks';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';

interface DueDateRule {
  id: string;
  task_type: string;
  days_from_creation: number;
  account_id: string | null;
  account_name?: string;
  is_active: boolean;
}

interface Account {
  id: string;
  account_name: string;
}

export function DueDateRulesSettingsTab() {
  const { profile } = useAuth();
  const { taskTypes } = useTaskTypes();
  const { toast } = useToast();

  const [rules, setRules] = useState<DueDateRule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New rule form
  const [newRule, setNewRule] = useState({
    task_type: '',
    days_from_creation: 3,
    account_id: 'global',
  });

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchData();
    }
  }, [profile?.tenant_id]);

  const fetchData = async () => {
    if (!profile?.tenant_id) return;

    try {
      // Fetch rules
      const { data: rulesData, error: rulesError } = await supabase
        .from('due_date_rules')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('task_type');

      if (rulesError) throw rulesError;

      // Fetch accounts for the rules that have account_id
      const { data: accountsData, error: accountsError } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('account_name');

      if (accountsError) throw accountsError;

      setAccounts(accountsData || []);

      // Merge account names into rules
      const rulesWithAccounts = (rulesData || []).map(rule => ({
        ...rule,
        account_name: accountsData?.find(a => a.id === rule.account_id)?.account_name,
      }));

      setRules(rulesWithAccounts);
    } catch (error) {
      console.error('Error fetching due date rules:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddRule = async () => {
    if (!profile?.tenant_id || !newRule.task_type) return;

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('due_date_rules')
        .insert({
          tenant_id: profile.tenant_id,
          task_type: newRule.task_type,
          days_from_creation: newRule.days_from_creation,
          account_id: newRule.account_id === 'global' ? null : newRule.account_id || null,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      const accountName = accounts.find(a => a.id === newRule.account_id)?.account_name;
      setRules(prev => [...prev, { ...data, account_name: accountName }]);
      setNewRule({ task_type: '', days_from_creation: 3, account_id: 'global' });

      toast({
        title: 'Rule Added',
        description: 'Due date rule has been created.',
      });
    } catch (error: any) {
      console.error('Error adding rule:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to add rule.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateDays = async (ruleId: string, days: number) => {
    try {
      const { error } = await supabase
        .from('due_date_rules')
        .update({ days_from_creation: days })
        .eq('id', ruleId);

      if (error) throw error;

      setRules(prev =>
        prev.map(r => (r.id === ruleId ? { ...r, days_from_creation: days } : r))
      );
    } catch (error) {
      console.error('Error updating rule:', error);
    }
  };

  const handleToggleActive = async (ruleId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('due_date_rules')
        .update({ is_active: isActive })
        .eq('id', ruleId);

      if (error) throw error;

      setRules(prev =>
        prev.map(r => (r.id === ruleId ? { ...r, is_active: isActive } : r))
      );
    } catch (error) {
      console.error('Error toggling rule:', error);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      const { error } = await supabase
        .from('due_date_rules')
        .delete()
        .eq('id', ruleId);

      if (error) throw error;

      setRules(prev => prev.filter(r => r.id !== ruleId));

      toast({
        title: 'Rule Deleted',
        description: 'Due date rule has been removed.',
      });
    } catch (error) {
      console.error('Error deleting rule:', error);
    }
  };

  // Group rules by global vs account-specific
  const globalRules = rules.filter(r => !r.account_id);
  const accountRules = rules.filter(r => r.account_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add New Rule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="event" size="md" />
            Add Due Date Rule
          </CardTitle>
          <CardDescription>
            Set automatic due dates for task types. Account-specific rules override global defaults.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-2">
              <Label>Task Type</Label>
              <Select
                value={newRule.task_type}
                onValueChange={(value) => setNewRule(prev => ({ ...prev, task_type: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select task type" />
                </SelectTrigger>
                <SelectContent>
                  {taskTypes.map(type => (
                    <SelectItem key={type.id} value={type.name}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-32 space-y-2">
              <Label>Days</Label>
              <Input
                type="number"
                min={0}
                value={newRule.days_from_creation}
                onChange={(e) =>
                  setNewRule(prev => ({ ...prev, days_from_creation: parseInt(e.target.value) || 0 }))
                }
              />
            </div>

            <div className="flex-1 space-y-2">
              <Label>Account (Optional)</Label>
              <Select
                value={newRule.account_id}
                onValueChange={(value) => setNewRule(prev => ({ ...prev, account_id: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Global (all accounts)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (all accounts)</SelectItem>
                  {accounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button onClick={handleAddRule} disabled={saving || !newRule.task_type}>
                {saving ? <MaterialIcon name="progress_activity" size="sm" className="animate-spin" /> : <MaterialIcon name="add" size="sm" />}
                <span className="ml-2">Add</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Global Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Global Default Rules</CardTitle>
          <CardDescription>
            These apply to all accounts unless overridden
          </CardDescription>
        </CardHeader>
        <CardContent>
          {globalRules.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No global rules configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task Type</TableHead>
                  <TableHead>Days from Creation</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {globalRules.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <Badge variant="outline">{rule.task_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={rule.days_from_creation}
                        onChange={(e) =>
                          handleUpdateDays(rule.id, parseInt(e.target.value) || 0)
                        }
                        className="w-20"
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rule.is_active ?? true}
                        onCheckedChange={(checked) => handleToggleActive(rule.id, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteRule(rule.id)}
                      >
                        <MaterialIcon name="delete" size="sm" className="text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Account-Specific Rules */}
      <Card>
        <CardHeader>
          <CardTitle>Account-Specific Overrides</CardTitle>
          <CardDescription>
            These override global defaults for specific accounts
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accountRules.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No account-specific rules configured yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Task Type</TableHead>
                  <TableHead>Days from Creation</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountRules.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell>{rule.account_name || 'Unknown'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{rule.task_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        value={rule.days_from_creation}
                        onChange={(e) =>
                          handleUpdateDays(rule.id, parseInt(e.target.value) || 0)
                        }
                        className="w-20"
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rule.is_active ?? true}
                        onCheckedChange={(checked) => handleToggleActive(rule.id, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteRule(rule.id)}
                      >
                        <MaterialIcon name="delete" size="sm" className="text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

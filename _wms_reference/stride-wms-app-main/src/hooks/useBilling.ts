import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { queueInvoiceCreatedAlert } from '@/lib/alertQueue';
import { getEffectiveRate } from '@/lib/billing/chargeTypeUtils';

export interface Invoice {
  id: string;
  invoice_number: string;
  account_id: string;
  account_name?: string;
  invoice_date: string;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  subtotal: number | null;
  tax_amount: number | null;
  total_amount: number | null;
  notes: string | null;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  line_item_type: string;
  service_type: string | null;
  service_date: string | null;
  quantity: number | null;
  unit_price: number;
  line_total: number;
  item_id: string | null;
  item_code?: string;
  task_id: string | null;
  account_code: string | null;
}

export interface BillableCharge {
  id: string;
  charge_type: 'task' | 'storage' | 'custom';
  description: string;
  service_type: string;
  service_date: string;
  quantity: number;
  unit_price: number;
  total: number;
  account_id: string;
  account_name: string;
  item_id?: string;
  item_code?: string;
  task_id?: string;
}

export interface ChargeTemplate {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  charge_type: string | null;
  is_active: boolean;
}

export function useInvoices() {
  const { profile } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchInvoices();
    }
  }, [profile?.tenant_id]);

  const fetchInvoices = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          accounts:account_id (account_name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .order('invoice_date', { ascending: false });

      if (error) throw error;

      const invoicesWithAccounts = (data || []).map(inv => ({
        ...inv,
        account_name: inv.accounts?.account_name,
      }));

      setInvoices(invoicesWithAccounts);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const createInvoice = async (
    accountId: string,
    periodStart: string,
    periodEnd: string,
    lineItems: Omit<InvoiceLineItem, 'id' | 'invoice_id'>[]
  ) => {
    if (!profile?.tenant_id) return null;

    try {
      // Fetch tenant preferences for sales tax rate
      const { data: preferences } = await supabase
        .from('tenant_preferences')
        .select('sales_tax_rate')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      const salesTaxRate = preferences?.sales_tax_rate || 0;

      // Fetch rate card details to check which services are taxable
      const serviceTypes = [...new Set(lineItems.map(item => item.service_type).filter(Boolean))];
      let taxableServices = new Set<string>();

      if (serviceTypes.length > 0 && salesTaxRate > 0) {
        const { data: rateDetails } = await (supabase as any)
          .from('rate_card_details')
          .select('service_type, is_taxable')
          .in('service_type', serviceTypes)
          .eq('is_taxable', true);

        if (rateDetails) {
          taxableServices = new Set(rateDetails.map(r => r.service_type));
        }
      }

      // Generate invoice number
      const invoiceNumber = `INV-${Date.now()}`;
      const subtotal = lineItems.reduce((sum, item) => sum + item.line_total, 0);

      // Calculate tax only for taxable line items
      const taxableTotal = lineItems
        .filter(item => item.service_type && taxableServices.has(item.service_type))
        .reduce((sum, item) => sum + item.line_total, 0);
      const taxAmount = taxableTotal * salesTaxRate;
      const totalAmount = subtotal + taxAmount;

      // Create invoice
      const { data: invoice, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          tenant_id: profile.tenant_id,
          account_id: accountId,
          invoice_number: invoiceNumber,
          invoice_date: new Date().toISOString().split('T')[0],
          period_start: periodStart,
          period_end: periodEnd,
          status: 'draft',
          subtotal,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          created_by: profile.id,
        })
        .select()
        .single();

      if (invoiceError) throw invoiceError;

      // Add line items
      if (lineItems.length > 0) {
        const itemsToInsert = lineItems.map((item, index) => ({
          invoice_id: invoice.id,
          description: item.description,
          line_item_type: item.line_item_type,
          service_type: item.service_type,
          service_date: item.service_date,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
          item_id: item.item_id,
          item_code: item.item_code,
          task_id: item.task_id,
          account_code: item.account_code,
          sort_order: index,
        }));

        const { error: lineItemsError } = await supabase
          .from('invoice_line_items')
          .insert(itemsToInsert);

        if (lineItemsError) throw lineItemsError;
      }

      // Queue invoice.created alert
      if (invoice) {
        await queueInvoiceCreatedAlert(
          profile.tenant_id,
          invoice.id,
          invoiceNumber,
          totalAmount
        );
      }

      await fetchInvoices();
      return invoice;
    } catch (error) {
      console.error('Error creating invoice:', error);
      return null;
    }
  };

  const updateInvoiceStatus = async (invoiceId: string, status: string) => {
    try {
      const { error } = await supabase
        .from('invoices')
        .update({ status })
        .eq('id', invoiceId);

      if (error) throw error;

      setInvoices(prev =>
        prev.map(inv => (inv.id === invoiceId ? { ...inv, status } : inv))
      );
    } catch (error) {
      console.error('Error updating invoice status:', error);
    }
  };

  return {
    invoices,
    loading,
    refetch: fetchInvoices,
    createInvoice,
    updateInvoiceStatus,
  };
}

export function useBillableCharges(
  accountIds: string[],
  periodStart: string,
  periodEnd: string,
  chargeTypes: string[]
) {
  const { profile } = useAuth();
  const [charges, setCharges] = useState<BillableCharge[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCharges = async () => {
    if (!profile?.tenant_id || accountIds.length === 0) {
      setCharges([]);
      return;
    }

    setLoading(true);
    const allCharges: BillableCharge[] = [];

    try {
      // Fetch completed tasks for selected accounts
      if (chargeTypes.includes('tasks')) {
        const { data: tasks, error: tasksError } = await supabase
          .from('tasks')
          .select(`
            id,
            title,
            task_type,
            completed_at,
            account_id,
            accounts:account_id (account_name)
          `)
          .eq('tenant_id', profile.tenant_id)
          .in('account_id', accountIds)
          .eq('status', 'completed')
          .gte('completed_at', periodStart)
          .lte('completed_at', periodEnd);

        if (!tasksError && tasks) {
          // Map task types to service codes in the Price List
          const taskTypeToServiceCode: Record<string, string> = {
            'receiving': 'RCVG',
            'shipping': 'Shipping',
            'delivery': 'Delivery',
            'assembly': '15MA',
            'inspection': 'INSP',
            'repair': '1HRO',
            'will call': 'Will_Call',
            'disposal': 'Disposal',
            'returns': 'Returns',
          };

          // Fetch all classes for mapping class_id to code
          const { data: allClasses } = await supabase
            .from('classes')
            .select('id, code')
            .eq('tenant_id', profile.tenant_id);
          const classMap = new Map((allClasses || []).map((c: any) => [c.id, c.code]));

          // Get task items with their class codes for rate lookup from Price List
          for (const task of tasks) {
            const { data: taskItems } = await supabase
              .from('task_items')
              .select(`
                id,
                quantity,
                item_id,
                items:item_id (
                  item_code,
                  class_id
                )
              `)
              .eq('task_id', task.id);

            if (taskItems && taskItems.length > 0) {
              for (const taskItem of taskItems) {
                const classId = (taskItem.items as any)?.class_id || null;
                const classCode = classId ? classMap.get(classId) : null;
                const serviceCode = taskTypeToServiceCode[task.task_type.toLowerCase()] || null;
                let rate = 0;

                // Look up rate via unified pricing (new system first, legacy fallback)
                if (serviceCode) {
                  try {
                    const rateResult = await getEffectiveRate({
                      tenantId: profile.tenant_id,
                      chargeCode: serviceCode,
                      classCode: classCode || undefined,
                    });
                    if (!rateResult.has_error) {
                      rate = rateResult.effective_rate || 0;
                    }
                  } catch {
                    // Swallow — rate stays 0
                  }
                }

                if (rate > 0) {
                  allCharges.push({
                    id: `task-${task.id}-${taskItem.id}`,
                    charge_type: 'task',
                    description: `${task.task_type} - ${(taskItem.items as any)?.item_code || 'Item'}`,
                    service_type: task.task_type,
                    service_date: task.completed_at || periodEnd,
                    quantity: taskItem.quantity || 1,
                    unit_price: rate,
                    total: (taskItem.quantity || 1) * rate,
                    account_id: task.account_id,
                    account_name: task.accounts?.account_name || '',
                    item_id: taskItem.item_id || undefined,
                    item_code: (taskItem.items as any)?.item_code || undefined,
                    task_id: task.id,
                  });
                }
              }
            }
          }
        }
      }

      // Fetch storage charges for items in active inventory during the period
      if (chargeTypes.includes('storage')) {
        // Get tenant preferences for free storage days
        const { data: preferences } = await supabase
          .from('tenant_preferences')
          .select('free_storage_days')
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle();

        const freeStorageDays = preferences?.free_storage_days || 0;

        // Fetch all classes for mapping class_id to code (for storage rate lookup)
        const { data: storageClasses } = await supabase
          .from('classes')
          .select('id, code')
          .eq('tenant_id', profile.tenant_id);
        const storageClassMap = new Map((storageClasses || []).map((c: any) => [c.id, c.code]));

        // Get items that were in active stock during the billing period
        // Active = received_at <= periodEnd AND (released_at IS NULL OR released_at >= periodStart)
        // Use class for storage rate lookup from Price List
        const { data: items, error: itemsError } = await (supabase
          .from('items') as any)
          .select(`
            id,
            item_code,
            description,
            received_at,
            released_at,
            account_id,
            accounts:account_id (account_name),
            class_id
          `)
          .eq('tenant_id', profile.tenant_id)
          .in('account_id', accountIds)
          .lte('received_at', periodEnd)
          .or(`released_at.is.null,released_at.gte.${periodStart}`);

        if (!itemsError && items) {
          const periodStartDate = new Date(periodStart);
          const periodEndDate = new Date(periodEnd);

          for (const item of items) {
            const classCode = item.class_id ? storageClassMap.get(item.class_id) : null;

            // Look up storage rate via unified pricing (new system first, legacy fallback)
            let dailyRate = 0;
            try {
              const storageResult = await getEffectiveRate({
                tenantId: profile.tenant_id,
                chargeCode: 'STORAGE',
                classCode: classCode || undefined,
              });
              if (!storageResult.has_error) {
                dailyRate = storageResult.effective_rate || 0;
              }
            } catch {
              // Swallow — dailyRate stays 0
            }

            if (dailyRate <= 0) continue;

            const receivedAt = new Date(item.received_at);
            const releasedAt = item.released_at ? new Date(item.released_at) : null;

            // Calculate active start within billing period
            const activeStart = receivedAt > periodStartDate ? receivedAt : periodStartDate;
            // Calculate active end within billing period
            const activeEnd = releasedAt && releasedAt < periodEndDate ? releasedAt : periodEndDate;

            if (activeEnd <= activeStart) continue;

            // Calculate days in period
            const msPerDay = 1000 * 60 * 60 * 24;
            let daysInPeriod = Math.ceil((activeEnd.getTime() - activeStart.getTime()) / msPerDay);

            // Apply free storage days (only if this is within the first N days of receiving)
            if (freeStorageDays > 0) {
              const daysSinceReceived = Math.ceil((activeStart.getTime() - receivedAt.getTime()) / msPerDay);
              const remainingFreeDays = Math.max(0, freeStorageDays - daysSinceReceived);
              daysInPeriod = Math.max(0, daysInPeriod - remainingFreeDays);
            }

            if (daysInPeriod <= 0) continue;

            const storageCharge = dailyRate * daysInPeriod;

            allCharges.push({
              id: `storage-${item.id}-${periodStart}`,
              charge_type: 'storage',
              description: `Storage: ${item.item_code || item.description || 'Item'} (${classCode || 'No Class'} × ${daysInPeriod} days)`,
              service_type: 'Storage',
              service_date: periodEnd,
              quantity: daysInPeriod,
              unit_price: dailyRate,
              total: storageCharge,
              account_id: item.account_id,
              account_name: item.accounts?.account_name || '',
              item_id: item.id,
              item_code: item.item_code || undefined,
            });
          }
        }
      }

      // Fetch custom billing charges
      if (chargeTypes.includes('custom')) {
        const { data: customCharges, error: customError } = await supabase
          .from('custom_billing_charges')
          .select(`
            *,
            accounts:account_id (account_name),
            items:item_id (item_code)
          `)
          .eq('tenant_id', profile.tenant_id)
          .in('account_id', accountIds)
          .gte('charge_date', periodStart)
          .lte('charge_date', periodEnd)
          .is('invoiced_at', null)
          .is('deleted_at', null);

        if (!customError && customCharges) {
          for (const charge of customCharges) {
            allCharges.push({
              id: `custom-${charge.id}`,
              charge_type: 'custom',
              description: charge.charge_name + (charge.description ? `: ${charge.description}` : ''),
              service_type: 'Custom Charge',
              service_date: charge.charge_date,
              quantity: 1,
              unit_price: charge.amount,
              total: charge.amount,
              account_id: charge.account_id || '',
              account_name: charge.accounts?.account_name || '',
              item_id: charge.item_id || undefined,
              item_code: charge.items?.item_code || undefined,
            });
          }
        }
      }

      // Sort by service date, then by service type
      allCharges.sort((a, b) => {
        const dateCompare = a.service_date.localeCompare(b.service_date);
        if (dateCompare !== 0) return dateCompare;
        return a.service_type.localeCompare(b.service_type);
      });

      setCharges(allCharges);
    } catch (error) {
      console.error('Error fetching billable charges:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accountIds.length > 0 && periodStart && periodEnd) {
      fetchCharges();
    }
  }, [accountIds.join(','), periodStart, periodEnd, chargeTypes.join(',')]);

  return { charges, loading, refetch: fetchCharges };
}

export function useChargeTemplates() {
  const { profile } = useAuth();
  const [templates, setTemplates] = useState<ChargeTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchTemplates();
    }
  }, [profile?.tenant_id]);

  const fetchTemplates = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('billing_charge_templates')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoading(false);
    }
  };

  return { templates, loading, refetch: fetchTemplates };
}

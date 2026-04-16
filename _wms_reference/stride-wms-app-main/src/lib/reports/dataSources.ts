// Data Source Definitions for Custom Report Builder

import { DataSource, ColumnDefinition } from './types';

// Items data source
const itemsColumns: ColumnDefinition[] = [
  { id: 'item_code', label: 'Item Code', dbColumn: 'item_code', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'description', label: 'Description', dbColumn: 'description', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'status', label: 'Status', dbColumn: 'status', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'in_storage': { label: 'In Storage', variant: 'default' },
      'received': { label: 'Received', variant: 'secondary' },
      'released': { label: 'Released', variant: 'outline' },
      'pending': { label: 'Pending', variant: 'secondary' },
    }
  },
  { id: 'account_name', label: 'Account', dbColumn: 'account_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'accounts', joinColumn: 'account_name' },
  { id: 'sidemark_name', label: 'Sidemark', dbColumn: 'sidemark_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'sidemarks', joinColumn: 'sidemark_name' },
  { id: 'class_name', label: 'Class', dbColumn: 'class_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'classes', joinColumn: 'name' },
  { id: 'vendor', label: 'Vendor', dbColumn: 'vendor', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'location_name', label: 'Location', dbColumn: 'current_location_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'locations', joinColumn: 'name' },
  { id: 'declared_value', label: 'Declared Value', dbColumn: 'declared_value', format: 'currency', sortable: true, filterable: true, aggregatable: true },
  { id: 'weight', label: 'Weight', dbColumn: 'weight', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'length', label: 'Length', dbColumn: 'length', format: 'number', sortable: true, filterable: true, aggregatable: false },
  { id: 'width', label: 'Width', dbColumn: 'width', format: 'number', sortable: true, filterable: true, aggregatable: false },
  { id: 'height', label: 'Height', dbColumn: 'height', format: 'number', sortable: true, filterable: true, aggregatable: false },
  { id: 'received_at', label: 'Received Date', dbColumn: 'received_at', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'released_at', label: 'Released Date', dbColumn: 'released_at', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'created_at', label: 'Created', dbColumn: 'created_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'is_overweight', label: 'Overweight', dbColumn: 'is_overweight', format: 'boolean', sortable: true, filterable: true, aggregatable: false },
  { id: 'is_oversize', label: 'Oversize', dbColumn: 'is_oversize', format: 'boolean', sortable: true, filterable: true, aggregatable: false },
  { id: 'has_damage', label: 'Has Damage', dbColumn: 'has_damage', format: 'boolean', sortable: true, filterable: true, aggregatable: false },
  { id: 'needs_repair', label: 'Needs Repair', dbColumn: 'needs_repair', format: 'boolean', sortable: true, filterable: true, aggregatable: false },
];

// Billing Events data source
const billingEventsColumns: ColumnDefinition[] = [
  { id: 'occurred_at', label: 'Date', dbColumn: 'occurred_at', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'account_name', label: 'Account', dbColumn: 'account_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'accounts', joinColumn: 'account_name' },
  { id: 'sidemark_name', label: 'Sidemark', dbColumn: 'sidemark_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'sidemarks', joinColumn: 'sidemark_name' },
  { id: 'item_code', label: 'Item Code', dbColumn: 'item_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'items', joinColumn: 'item_code' },
  { id: 'event_type', label: 'Event Type', dbColumn: 'event_type', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'charge_type', label: 'Charge Type', dbColumn: 'charge_type', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'description', label: 'Description', dbColumn: 'description', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'quantity', label: 'Quantity', dbColumn: 'quantity', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'unit_rate', label: 'Unit Rate', dbColumn: 'unit_rate', format: 'currency', sortable: true, filterable: true, aggregatable: false },
  { id: 'total_amount', label: 'Total Amount', dbColumn: 'total_amount', format: 'currency', sortable: true, filterable: true, aggregatable: true },
  { id: 'status', label: 'Status', dbColumn: 'status', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'unbilled': { label: 'Unbilled', variant: 'outline' },
      'invoiced': { label: 'Invoiced', variant: 'default' },
      'void': { label: 'Void', variant: 'destructive' },
    }
  },
  { id: 'has_rate_error', label: 'Rate Error', dbColumn: 'has_rate_error', format: 'boolean', sortable: true, filterable: true, aggregatable: false },
  { id: 'created_at', label: 'Created', dbColumn: 'created_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
];

// Job Time Intervals (report view) data source
const jobTimeIntervalsColumns: ColumnDefinition[] = [
  { id: 'job_type', label: 'Job Type', dbColumn: 'job_type', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      task: { label: 'Task', variant: 'default' },
      shipment: { label: 'Shipment', variant: 'secondary' },
      stocktake: { label: 'Stocktake', variant: 'outline' },
    }
  },
  { id: 'job_label', label: 'Job', dbColumn: 'job_label', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'job_subtype', label: 'Subtype', dbColumn: 'job_subtype', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'job_status', label: 'Job Status', dbColumn: 'job_status', format: 'badge', sortable: true, filterable: true, aggregatable: false },
  { id: 'user_name', label: 'Employee', dbColumn: 'user_name', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'user_email', label: 'Employee Email', dbColumn: 'user_email', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'account_name', label: 'Account', dbColumn: 'account_name', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'warehouse_name', label: 'Warehouse', dbColumn: 'warehouse_name', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'started_at', label: 'Started', dbColumn: 'started_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'ended_at', label: 'Ended', dbColumn: 'ended_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'ended_reason', label: 'End Reason', dbColumn: 'ended_reason', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'is_active', label: 'Active', dbColumn: 'is_active', format: 'boolean', sortable: true, filterable: true, aggregatable: false },
  { id: 'duration_minutes', label: 'Duration (min)', dbColumn: 'duration_minutes', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'elapsed_minutes', label: 'Elapsed (min)', dbColumn: 'elapsed_minutes', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'job_completed_at', label: 'Job Completed', dbColumn: 'job_completed_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'job_id', label: 'Job ID', dbColumn: 'job_id', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'user_id', label: 'Employee ID', dbColumn: 'user_id', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'account_id', label: 'Account ID', dbColumn: 'account_id', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'warehouse_id', label: 'Warehouse ID', dbColumn: 'warehouse_id', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'created_at', label: 'Created', dbColumn: 'created_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
];

// Service Time Jobs (report view) data source
const serviceTimeJobsColumns: ColumnDefinition[] = [
  { id: 'job_type', label: 'Job Type', dbColumn: 'job_type', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      task: { label: 'Task', variant: 'default' },
      shipment: { label: 'Shipment', variant: 'secondary' },
      stocktake: { label: 'Stocktake', variant: 'outline' },
    }
  },
  { id: 'job_label', label: 'Job', dbColumn: 'job_label', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'job_subtype', label: 'Subtype', dbColumn: 'job_subtype', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'job_status', label: 'Status', dbColumn: 'job_status', format: 'badge', sortable: true, filterable: true, aggregatable: false },
  { id: 'account_name', label: 'Account', dbColumn: 'account_name', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'warehouse_name', label: 'Warehouse', dbColumn: 'warehouse_name', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'completed_at', label: 'Completed', dbColumn: 'completed_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'estimated_minutes', label: 'Estimated (min)', dbColumn: 'estimated_minutes', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'actual_minutes', label: 'Actual (min)', dbColumn: 'actual_minutes', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'variance_minutes', label: 'Variance (min)', dbColumn: 'variance_minutes', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'estimated_snapshot_at', label: 'Est Snapshotted', dbColumn: 'estimated_snapshot_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'actual_snapshot_at', label: 'Actual Snapshotted', dbColumn: 'actual_snapshot_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'actual_cycle_minutes', label: 'Cycle (min)', dbColumn: 'actual_cycle_minutes', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'job_id', label: 'Job ID', dbColumn: 'job_id', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'account_id', label: 'Account ID', dbColumn: 'account_id', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'warehouse_id', label: 'Warehouse ID', dbColumn: 'warehouse_id', format: 'text', sortable: true, filterable: true, aggregatable: false },
];

// Tasks data source
const tasksColumns: ColumnDefinition[] = [
  { id: 'task_id', label: 'Task ID', dbColumn: 'id', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'task_type', label: 'Type', dbColumn: 'task_type', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'receiving': { label: 'Receiving', variant: 'default' },
      'inspection': { label: 'Inspection', variant: 'secondary' },
      'assembly': { label: 'Assembly', variant: 'default' },
      'repair': { label: 'Repair', variant: 'outline' },
      'storage': { label: 'Storage', variant: 'secondary' },
      'disposal': { label: 'Disposal', variant: 'destructive' },
      'custom': { label: 'Custom', variant: 'outline' },
    }
  },
  { id: 'status', label: 'Status', dbColumn: 'status', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'pending': { label: 'Pending', variant: 'outline' },
      'in_progress': { label: 'In Progress', variant: 'secondary' },
      'completed': { label: 'Completed', variant: 'default' },
      'cancelled': { label: 'Cancelled', variant: 'destructive' },
    }
  },
  { id: 'account_name', label: 'Account', dbColumn: 'account_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'accounts', joinColumn: 'account_name' },
  { id: 'warehouse_name', label: 'Warehouse', dbColumn: 'warehouse_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'warehouses', joinColumn: 'name' },
  { id: 'assigned_to_name', label: 'Assigned To', dbColumn: 'assigned_to', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'users_report_v1', joinColumn: 'full_name' },
  { id: 'priority', label: 'Priority', dbColumn: 'priority', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'low': { label: 'Low', variant: 'outline' },
      'normal': { label: 'Normal', variant: 'secondary' },
      'high': { label: 'High', variant: 'default' },
      'urgent': { label: 'Urgent', variant: 'destructive' },
    }
  },
  { id: 'due_date', label: 'Due Date', dbColumn: 'due_date', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'started_at', label: 'Started', dbColumn: 'started_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'completed_at', label: 'Completed', dbColumn: 'completed_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'duration_minutes', label: 'Duration (min)', dbColumn: 'duration_minutes', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'notes', label: 'Notes', dbColumn: 'notes', format: 'text', sortable: false, filterable: true, aggregatable: false },
  { id: 'created_at', label: 'Created', dbColumn: 'created_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
];

// Shipments data source
const shipmentsColumns: ColumnDefinition[] = [
  { id: 'shipment_number', label: 'Shipment #', dbColumn: 'shipment_number', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'shipment_type', label: 'Type', dbColumn: 'shipment_type', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'inbound': { label: 'Inbound', variant: 'default' },
      'outbound': { label: 'Outbound', variant: 'secondary' },
      'return': { label: 'Return', variant: 'outline' },
    }
  },
  { id: 'status', label: 'Status', dbColumn: 'status', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'draft': { label: 'Draft', variant: 'outline' },
      'in_transit': { label: 'In Transit', variant: 'secondary' },
      'received': { label: 'Received', variant: 'default' },
      'released': { label: 'Released', variant: 'default' },
      'cancelled': { label: 'Cancelled', variant: 'destructive' },
    }
  },
  { id: 'account_name', label: 'Account', dbColumn: 'account_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'accounts', joinColumn: 'account_name' },
  { id: 'sidemark_name', label: 'Sidemark', dbColumn: 'sidemark_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'sidemarks', joinColumn: 'sidemark_name' },
  { id: 'warehouse_name', label: 'Warehouse', dbColumn: 'warehouse_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'warehouses', joinColumn: 'name' },
  { id: 'carrier', label: 'Carrier', dbColumn: 'carrier', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'tracking_number', label: 'Tracking #', dbColumn: 'tracking_number', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'expected_date', label: 'Expected Date', dbColumn: 'expected_date', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'received_at', label: 'Received', dbColumn: 'received_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'released_at', label: 'Released', dbColumn: 'released_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
  { id: 'item_count', label: 'Item Count', dbColumn: 'item_count', format: 'number', sortable: true, filterable: true, aggregatable: true },
  { id: 'notes', label: 'Notes', dbColumn: 'notes', format: 'text', sortable: false, filterable: true, aggregatable: false },
  { id: 'created_at', label: 'Created', dbColumn: 'created_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
];

// Claims data source
const claimsColumns: ColumnDefinition[] = [
  { id: 'claim_number', label: 'Claim #', dbColumn: 'claim_number', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'status', label: 'Status', dbColumn: 'status', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'initiated': { label: 'Initiated', variant: 'outline' },
      'under_review': { label: 'Under Review', variant: 'secondary' },
      'approved': { label: 'Approved', variant: 'default' },
      'denied': { label: 'Denied', variant: 'destructive' },
      'paid': { label: 'Paid', variant: 'default' },
      'closed': { label: 'Closed', variant: 'secondary' },
    }
  },
  { id: 'account_name', label: 'Account', dbColumn: 'account_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'accounts', joinColumn: 'account_name' },
  { id: 'claim_type', label: 'Claim Type', dbColumn: 'claim_type', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'total_claimed_value', label: 'Claimed Value', dbColumn: 'total_claimed_value', format: 'currency', sortable: true, filterable: true, aggregatable: true },
  { id: 'total_payout', label: 'Payout', dbColumn: 'total_payout', format: 'currency', sortable: true, filterable: true, aggregatable: true },
  { id: 'payout_method', label: 'Payout Method', dbColumn: 'payout_method', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'filed_at', label: 'Filed Date', dbColumn: 'filed_at', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'resolved_at', label: 'Resolved Date', dbColumn: 'resolved_at', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'description', label: 'Description', dbColumn: 'description', format: 'text', sortable: false, filterable: true, aggregatable: false },
  { id: 'created_at', label: 'Created', dbColumn: 'created_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
];

// Invoices data source
const invoicesColumns: ColumnDefinition[] = [
  { id: 'invoice_number', label: 'Invoice #', dbColumn: 'invoice_number', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'status', label: 'Status', dbColumn: 'status', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'draft': { label: 'Draft', variant: 'outline' },
      'sent': { label: 'Sent', variant: 'secondary' },
      'paid': { label: 'Paid', variant: 'default' },
      'partial': { label: 'Partial', variant: 'secondary' },
      'overdue': { label: 'Overdue', variant: 'destructive' },
      'void': { label: 'Void', variant: 'destructive' },
    }
  },
  { id: 'account_name', label: 'Account', dbColumn: 'account_id', format: 'text', sortable: true, filterable: true, aggregatable: false, joinTable: 'accounts', joinColumn: 'account_name' },
  { id: 'period_start', label: 'Period Start', dbColumn: 'period_start', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'period_end', label: 'Period End', dbColumn: 'period_end', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'total_amount', label: 'Total', dbColumn: 'total_amount', format: 'currency', sortable: true, filterable: true, aggregatable: true },
  { id: 'paid_amount', label: 'Paid', dbColumn: 'paid_amount', format: 'currency', sortable: true, filterable: true, aggregatable: true },
  { id: 'credits_applied', label: 'Credits Applied', dbColumn: 'credits_applied', format: 'currency', sortable: true, filterable: true, aggregatable: true },
  { id: 'payment_status', label: 'Payment Status', dbColumn: 'payment_status', format: 'badge', sortable: true, filterable: true, aggregatable: false,
    badgeConfig: {
      'pending': { label: 'Pending', variant: 'outline' },
      'partial': { label: 'Partial', variant: 'secondary' },
      'paid': { label: 'Paid', variant: 'default' },
      'overpaid': { label: 'Overpaid', variant: 'default' },
    }
  },
  { id: 'payment_date', label: 'Payment Date', dbColumn: 'payment_date', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'due_date', label: 'Due Date', dbColumn: 'due_date', format: 'date', sortable: true, filterable: true, aggregatable: false },
  { id: 'invoice_type', label: 'Invoice Type', dbColumn: 'invoice_type', format: 'text', sortable: true, filterable: true, aggregatable: false },
  { id: 'created_at', label: 'Created', dbColumn: 'created_at', format: 'datetime', sortable: true, filterable: true, aggregatable: false },
];

// Export all data sources
export const DATA_SOURCES: Record<string, DataSource> = {
  items: {
    id: 'items',
    label: 'Inventory Items',
    description: 'All inventory items with status, location, and attributes',
    tableName: 'items',
    columns: itemsColumns,
    defaultSort: [{ column: 'created_at', direction: 'desc' }],
  },
  billing_events: {
    id: 'billing_events',
    label: 'Billing Events',
    description: 'All billing charges and events',
    tableName: 'billing_events',
    hasDeletedAt: false,
    columns: billingEventsColumns,
    defaultSort: [{ column: 'occurred_at', direction: 'desc' }],
  },
  tasks: {
    id: 'tasks',
    label: 'Tasks',
    description: 'Warehouse tasks and assignments',
    tableName: 'tasks',
    columns: tasksColumns,
    defaultSort: [{ column: 'created_at', direction: 'desc' }],
  },
  shipments: {
    id: 'shipments',
    label: 'Shipments',
    description: 'Inbound and outbound shipments',
    tableName: 'shipments',
    columns: shipmentsColumns,
    defaultSort: [{ column: 'created_at', direction: 'desc' }],
  },
  claims: {
    id: 'claims',
    label: 'Claims',
    description: 'Damage and loss claims',
    tableName: 'claims',
    columns: claimsColumns,
    defaultSort: [{ column: 'created_at', direction: 'desc' }],
  },
  invoices: {
    id: 'invoices',
    label: 'Invoices',
    description: 'Customer invoices and payments',
    tableName: 'invoices',
    hasDeletedAt: false,
    columns: invoicesColumns,
    defaultSort: [{ column: 'created_at', direction: 'desc' }],
  },
  job_time_intervals: {
    id: 'job_time_intervals',
    label: 'Time Intervals',
    description: 'Timer intervals (who worked on what, when, and for how long)',
    tableName: 'job_time_intervals_report_v1',
    hasDeletedAt: false,
    columns: jobTimeIntervalsColumns,
    defaultSort: [{ column: 'started_at', direction: 'desc' }],
  },
  service_time_jobs: {
    id: 'service_time_jobs',
    label: 'Service Time Jobs',
    description: 'Estimated vs actual service time snapshots (tasks/shipments/stocktakes)',
    tableName: 'service_time_jobs_report_v1',
    hasDeletedAt: false,
    columns: serviceTimeJobsColumns,
    defaultSort: [{ column: 'completed_at', direction: 'desc' }],
  },
};

// Get default columns for a data source (first 6 columns visible)
export function getDefaultColumns(dataSourceId: string): ColumnDefinition[] {
  const source = DATA_SOURCES[dataSourceId];
  if (!source) return [];
  return source.columns.slice(0, 8);
}

// Get all available columns for a data source
export function getAvailableColumns(dataSourceId: string): ColumnDefinition[] {
  const source = DATA_SOURCES[dataSourceId];
  if (!source) return [];
  return source.columns;
}

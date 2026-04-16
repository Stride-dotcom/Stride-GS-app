export const fieldDescriptions = {
  // === Add Service Form: Step 1 ===
  serviceName: 'Display name shown on invoices, reports, and the Price List. Choose something clear that both staff and customers will understand.',
  serviceCode: 'Short alphanumeric code used in reports, scanning, and quick lookups. Auto-generated from the service name but can be customized. Must be unique within your account.',
  glAccountCode: 'General Ledger account code for accounting system export (e.g., QuickBooks). Optional — only needed if you sync billing data to an external accounting system.',
  description: 'Brief description that appears on invoices and reports below the service name. Helps customers understand what this charge is for.',

  // === Add Service Form: Step 2 ===
  chargeCategory: 'Organizes this service in menus, filters, and reports. Categories are for display only — they do NOT affect billing calculations or automated workflows. You can manage categories in the Categories tab.',
  billingTrigger: 'Controls WHEN the system automatically creates a charge. This is the automation behavior only. A charge can always be added manually, via Scan Hub, or via Flag regardless of this setting.',
  triggerAuto: 'Charge is automatically created when an item is received or processed through the receiving workflow.',
  triggerTask: 'Charge is automatically created when the linked task is marked as complete.',
  triggerShipment: 'Charge is automatically created when an outbound shipment is completed.',
  triggerStorage: 'Charge accrues automatically on a daily or monthly basis while items are in inventory. Calculated when invoices are generated.',
  triggerManual: 'No automatic charge creation. Staff must manually add this charge to work orders or items.',

  // === Add Service Form: Step 3 ===
  pricingMethod: 'How the rate is determined. Class-based uses your item classification system to charge different rates for different item types. Flat rate charges the same amount regardless of item classification.',
  classBasedPricing: 'Different rates for each item class. When an item is billed, the system looks up its class and applies the matching rate. Useful when some items cost more to handle than others.',
  flatPerItem: 'Same rate for every item regardless of its class. Simple and predictable — good for services where item type does not affect the cost.',
  flatPerTask: 'One flat charge for the entire task or job, not per item. Best for fixed-scope work like inspections or audits.',
  unitPrice: 'Direct price per unit. Used for materials, parts, packaging, and other items billed by quantity.',
  minimumCharge: 'Floor amount charged even if the calculated rate is lower. Protects against unprofitable small orders. Example: if a class rate is $2/item and minimum is $15, a 3-item order ($6 calculated) would be charged $15 instead.',
  serviceTime: 'Estimated minutes for labor planning and scheduling. This value is used by the labor tracking system to forecast workload. It does NOT affect billing.',

  // === Add Service Form: Step 4 ===
  activeToggle: 'When active, this service appears in dropdowns, Scan Hub, and can be used on work orders. Deactivating hides it from new work but preserves historical data.',
  taxableToggle: 'When enabled, sales tax is applied to this charge at the rate configured in Organization > Preferences. Tax is calculated at invoice time.',
  scanHubToggle: 'When enabled, this service appears as a scannable option in the Scan Hub. Workers can apply this charge by scanning an item and selecting the service.',
  flagToggle: 'Creates a checkbox on item detail pages. When a worker checks the flag, configured actions happen automatically (add charge, alert office, add service time). Example: a "No ID" flag that automatically adds a $15 processing charge.',
  flagAddsCharge: 'When the flag is checked on an item, a billing event is automatically created using the rate configured for this service.',
  flagAlertOffice: 'When the flag is checked on an item, an email notification is sent to the organization contact email.',
  flagAddsTime: 'When the flag is checked on an item, the specified number of minutes is added to the service time for labor planning.',

  // === Classes Tab ===
  classCode: 'Short code for this class (e.g., SM, LG, PLAT). Displayed in compact views and used in pricing rule lookups.',
  className: 'Full display name for this class (e.g., Small, Large, Platinum).',
  classCubicFeet: 'Default cubic-feet size for this class. Used to auto-fill item size when a class is selected. Leave empty if you do not want a default size.',
  classSortOrder: 'Display order in lists and rate grids. Lower numbers appear first.',
  classAlertOnReceive: 'When an item of this class is received, send an alert to the organization contact email. Useful for high-value or oversized items that need special attention.',
  classExplanation: 'Classes let you group items so different groups can have different rates. You define the groups — the system applies the right rate automatically. You can classify by size, value, handling needs, or anything that makes sense for your business.',

  // === Categories Tab ===
  categoryName: 'Display name for this category. Shown in filters, dropdowns, and report groupings.',
  categoryDescription: 'Brief description of what types of services belong in this category.',
  categorySortOrder: 'Display order in dropdowns and filters. Lower numbers appear first.',
  categorySystem: 'System categories are built-in and cannot be deleted. You can disable them to hide them from menus.',

  // === Task Templates Tab ===
  templateName: 'Name for this template. Shown when selecting a template during task creation.',
  templateDescription: 'Brief description of when to use this template.',
  templateBillable: 'Billable templates generate billing events when the task is completed. Non-billable templates are for internal workflows only.',
  templateServices: 'Services that are automatically added to a task when this template is selected. Each service generates a separate billing event at task completion.',
  templateAutoCalculate: 'When enabled, the system automatically determines the quantity based on the number of items in the task. When disabled, staff must enter the quantity manually.',
} as const;

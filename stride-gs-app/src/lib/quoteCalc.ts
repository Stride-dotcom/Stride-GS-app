import type {
  Quote, ServiceDef, ClassDef, CoverageOption, CalcResult, CalcLineItem,
} from './quoteTypes';

export function calcQuote(
  quote: Quote,
  services: ServiceDef[],
  classes: ClassDef[],
  coverageOptions: CoverageOption[],
): CalcResult {
  const lineItems: CalcLineItem[] = [];
  const activeClasses = classes.filter(c => c.active).sort((a, b) => a.order - b.order);

  // 1. Matrix services (class-based, showInMatrix)
  for (const svc of services.filter(s => s.active && s.showInMatrix)) {
    for (const cls of activeClasses) {
      const key = `${cls.id}:${svc.id}`;
      const cell = quote.matrixCells[key];
      if (!cell?.selected) continue;
      const clsLine = quote.classLines.find(cl => cl.classId === cls.id);
      const qty = cell.qty || clsLine?.qty || 0;
      if (qty <= 0) continue;
      const rate = svc.billing === 'class_based'
        ? (svc.rates[cls.id as keyof typeof svc.rates] ?? 0)
        : svc.flatRate;
      lineItems.push({
        serviceId: svc.id, serviceName: svc.name, serviceCode: svc.code,
        classId: cls.id, className: cls.name,
        qty, rate, amount: qty * rate,
        taxable: svc.taxable, category: svc.category,
      });
    }
  }

  // 2. Storage services
  const storageDays = (quote.storage.months * 30) + quote.storage.days;
  if (storageDays > 0) {
    for (const svc of services.filter(s => s.active && s.isStorage)) {
      for (const cls of activeClasses) {
        const key = `${cls.id}:${svc.id}`;
        const cell = quote.storageCells[key];
        if (!cell?.selected) continue;
        const clsLine = quote.classLines.find(cl => cl.classId === cls.id);
        const qty = clsLine?.qty || 0;
        if (qty <= 0) continue;
        const rate = svc.billing === 'class_based'
          ? (svc.rates[cls.id as keyof typeof svc.rates] ?? 0)
          : svc.flatRate;
        const amount = qty * storageDays * rate;
        lineItems.push({
          serviceId: svc.id, serviceName: svc.name, serviceCode: svc.code,
          classId: cls.id, className: cls.name,
          qty, rate, amount,
          taxable: svc.taxable, category: 'Storage',
        });
      }
    }
  }

  // 3. Other services (flat, not in matrix, not storage)
  for (const svc of services.filter(s => s.active && !s.showInMatrix && !s.isStorage)) {
    const entry = quote.otherServices[svc.id];
    if (!entry?.selected) continue;
    const qty = entry.qty || 1;
    const rate = entry.rateOverride ?? svc.flatRate;
    if (rate <= 0 && entry.rateOverride == null) continue;
    lineItems.push({
      serviceId: svc.id, serviceName: svc.name, serviceCode: svc.code,
      qty, rate, amount: qty * rate,
      taxable: svc.taxable, category: svc.category,
    });
  }

  // 4. Subtotals
  const subtotal = lineItems.reduce((s, li) => s + li.amount, 0);
  const taxableSubtotal = lineItems.filter(li => li.taxable).reduce((s, li) => s + li.amount, 0);
  const nonTaxableSubtotal = subtotal - taxableSubtotal;

  // 5. Discount
  let discountAmount = 0;
  if (quote.discount.value > 0) {
    discountAmount = quote.discount.type === 'percent'
      ? subtotal * (quote.discount.value / 100)
      : Math.min(quote.discount.value, subtotal);
  }

  // 6. Tax — proportionally distribute discount, then tax only taxable portion
  let taxAmount = 0;
  if (quote.taxEnabled && quote.taxRate > 0 && taxableSubtotal > 0) {
    const taxableProportion = subtotal > 0 ? taxableSubtotal / subtotal : 0;
    const taxableDiscount = discountAmount * taxableProportion;
    const taxableAfterDiscount = taxableSubtotal - taxableDiscount;
    taxAmount = Math.max(0, taxableAfterDiscount) * (quote.taxRate / 100);
  }

  // 7. Coverage
  let coverageCost = 0;
  const covOption = coverageOptions.find(c => c.id === quote.coverage.typeId);
  if (covOption && !covOption.included) {
    if (quote.coverage.costOverride != null) {
      coverageCost = quote.coverage.costOverride;
    } else if (covOption.method === 'per_lb') {
      coverageCost = covOption.rate * quote.coverage.weightLbs;
    } else if (covOption.method === 'percent_declared') {
      coverageCost = (covOption.rate / 100) * quote.coverage.declaredValue;
    } else if (covOption.method === 'flat') {
      coverageCost = covOption.rate;
    }
  }

  // 8. Grand total
  const grandTotal = subtotal - discountAmount + taxAmount + coverageCost;

  return {
    lineItems,
    subtotal: round2(subtotal),
    taxableSubtotal: round2(taxableSubtotal),
    nonTaxableSubtotal: round2(nonTaxableSubtotal),
    discountAmount: round2(discountAmount),
    taxAmount: round2(taxAmount),
    coverageCost: round2(coverageCost),
    grandTotal: round2(grandTotal),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

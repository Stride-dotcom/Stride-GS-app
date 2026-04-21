/**
 * exportPriceListExcel — generate a formatted .xlsx from the service catalog.
 *
 * Sheet layout (per session 73 spec):
 *   1. Warehouse Services — class-based rates with XXL
 *   2. Delivery Services  — flat rate per service
 *   3. Storage             — class-based daily rates
 *   4. Fabric Protection  — code / name / rate
 *   5. All Services        — flat view of every row
 */
import * as XLSX from 'xlsx';
import type { CatalogService } from '../../hooks/useServiceCatalog';
import type { DeliveryZone } from '../../hooks/useDeliveryZones';
import type { ItemClass } from '../../hooks/useItemClasses';
import type { CoverageOption } from '../../hooks/useCoverageOptions';
import { formatCoverageRate } from '../../hooks/useCoverageOptions';

function today(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function unitLabel(u: CatalogService['unit']): string {
  return u === 'per_item' ? 'Per Item'
    : u === 'per_day' ? 'Per Day'
    : u === 'per_task' ? 'Per Task'
    : 'Per Hour';
}

function rateOrDash(n: number | undefined): number | string {
  if (n == null || n === 0) return '';
  return Number(n.toFixed(2));
}

/**
 * Auto-size column widths based on the longest value per column. Keeps the
 * sheet readable without manual formatting after download.
 */
function autoSize(rows: Array<Record<string, unknown>>): XLSX.ColInfo[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  return keys.map(key => {
    let maxLen = key.length;
    for (const r of rows) {
      const v = r[key];
      const s = v == null ? '' : String(v);
      if (s.length > maxLen) maxLen = s.length;
    }
    return { wch: Math.min(40, Math.max(10, maxLen + 2)) };
  });
}

export function downloadPriceListExcel(
  services: CatalogService[],
  deliveryZones: DeliveryZone[] = [],
  itemClasses: ItemClass[] = [],
  coverageOptions: CoverageOption[] = [],
): void {
  const wb = XLSX.utils.book_new();

  // ── 1. Warehouse Services ─────────────────────────────────────────────
  const warehouseRows = services
    .filter(s => s.category === 'Warehouse' && s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({
      Code:      s.code,
      Name:      s.name,
      'XS Rate': rateOrDash(s.rates.XS),
      'S Rate':  rateOrDash(s.rates.S),
      'M Rate':  rateOrDash(s.rates.M),
      'L Rate':  rateOrDash(s.rates.L),
      'XL Rate': rateOrDash(s.rates.XL),
      'XXL Rate': rateOrDash(s.rates.XXL ?? s.xxlRate),
      Unit:      unitLabel(s.unit),
      Taxable:   s.taxable ? 'Yes' : 'No',
    }));
  const wsWarehouse = XLSX.utils.json_to_sheet(warehouseRows);
  wsWarehouse['!cols'] = autoSize(warehouseRows);
  XLSX.utils.book_append_sheet(wb, wsWarehouse, 'Warehouse Services');

  // ── 2. Delivery Services ──────────────────────────────────────────────
  const deliveryRows = services
    .filter(s => s.category === 'Delivery' && s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({
      Code: s.code,
      Name: s.name,
      Rate: s.billing === 'flat'
        ? (s.flatRate > 0 ? Number(s.flatRate.toFixed(2)) : '')
        : rateOrDash(s.rates.L ?? 0),
      Unit: unitLabel(s.unit),
    }));
  const wsDelivery = XLSX.utils.json_to_sheet(deliveryRows);
  wsDelivery['!cols'] = autoSize(deliveryRows);
  XLSX.utils.book_append_sheet(wb, wsDelivery, 'Delivery Services');

  // ── 3. Storage ────────────────────────────────────────────────────────
  const storageRows = services
    .filter(s => s.category === 'Storage' && s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({
      Code:      s.code,
      Name:      s.name,
      'XS Rate': rateOrDash(s.rates.XS),
      'S Rate':  rateOrDash(s.rates.S),
      'M Rate':  rateOrDash(s.rates.M),
      'L Rate':  rateOrDash(s.rates.L),
      'XL Rate': rateOrDash(s.rates.XL),
      'XXL Rate': rateOrDash(s.rates.XXL ?? s.xxlRate),
      Unit:      unitLabel(s.unit),
    }));
  const wsStorage = XLSX.utils.json_to_sheet(storageRows);
  wsStorage['!cols'] = autoSize(storageRows);
  XLSX.utils.book_append_sheet(wb, wsStorage, 'Storage');

  // ── 4. Fabric Protection ──────────────────────────────────────────────
  const fabricRows = services
    .filter(s => (s.category as string) === 'Fabric Protection' && s.active)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({
      Code: s.code,
      Name: s.name,
      Rate: s.billing === 'flat'
        ? (s.flatRate > 0 ? Number(s.flatRate.toFixed(2)) : '')
        : rateOrDash(s.rates.L ?? 0),
    }));
  const wsFabric = XLSX.utils.json_to_sheet(fabricRows);
  wsFabric['!cols'] = autoSize(fabricRows);
  XLSX.utils.book_append_sheet(wb, wsFabric, 'Fabric Protection');

  // ── 5. All Services ───────────────────────────────────────────────────
  const allRows = [...services]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({
      Code:       s.code,
      Name:       s.name,
      Category:   s.category,
      Billing:    s.billing === 'class_based' ? 'Class-Based' : 'Flat',
      Unit:       unitLabel(s.unit),
      'Flat Rate':s.flatRate > 0 ? Number(s.flatRate.toFixed(2)) : '',
      'XS Rate':  rateOrDash(s.rates.XS),
      'S Rate':   rateOrDash(s.rates.S),
      'M Rate':   rateOrDash(s.rates.M),
      'L Rate':   rateOrDash(s.rates.L),
      'XL Rate':  rateOrDash(s.rates.XL),
      'XXL Rate': rateOrDash(s.rates.XXL ?? s.xxlRate),
      Taxable:    s.taxable ? 'Yes' : 'No',
      Active:     s.active ? 'Yes' : 'No',
      Matrix:     s.showInMatrix ? 'Yes' : '',
      Task:       s.showAsTask ? 'Yes' : '',
      Delivery:   s.showAsDeliveryService ? 'Yes' : '',
      'Rcv Add-on': s.showAsReceivingAddon ? 'Yes' : '',
    }));
  const wsAll = XLSX.utils.json_to_sheet(allRows);
  wsAll['!cols'] = autoSize(allRows);
  XLSX.utils.book_append_sheet(wb, wsAll, 'All Services');

  // ── 6. Classes ────────────────────────────────────────────────────────
  // Reference sheet — the cubic-foot value that storage billing multiplies
  // against the STOR rate. Include inactive rows so legacy classes remain
  // auditable.
  if (itemClasses.length > 0) {
    const classRows = [...itemClasses]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(c => ({
        Class:          c.id,
        Name:           c.name,
        'Storage Size': c.storageSize > 0 ? Number(c.storageSize.toFixed(2)) : '',
        Active:         c.active ? 'Yes' : 'No',
      }));
    const wsClasses = XLSX.utils.json_to_sheet(classRows);
    wsClasses['!cols'] = autoSize(classRows);
    XLSX.utils.book_append_sheet(wb, wsClasses, 'Classes');
  }

  // ── 7. Coverage ───────────────────────────────────────────────────────
  // Handling valuation tiers + storage-policy coverage. Single source
  // of truth — Quote Tool and public rate sheet read the same rows.
  if (coverageOptions.length > 0) {
    const covRows = [...coverageOptions]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(o => ({
        Code:    o.id,
        Name:    o.name,
        'Calc Type': o.calcType,
        Rate:    formatCoverageRate(o),
        Note:    o.note ?? '',
        Active:  o.active ? 'Yes' : 'No',
      }));
    const wsCov = XLSX.utils.json_to_sheet(covRows);
    wsCov['!cols'] = autoSize(covRows);
    XLSX.utils.book_append_sheet(wb, wsCov, 'Coverage');
  }

  // ── 8. Delivery Zones ─────────────────────────────────────────────────
  // All zones regardless of active flag — the sheet is a reference sheet,
  // so showing which zips are Call-for-Quote / Out-of-Area is useful.
  if (deliveryZones.length > 0) {
    const zoneRows = [...deliveryZones]
      .sort((a, b) => a.zipCode.localeCompare(b.zipCode))
      .map(z => ({
        'Zip Code':      z.zipCode,
        City:            z.city,
        'Service Days':  z.serviceDays ?? '',
        Rate:            z.callForQuote ? 'CALL FOR QUOTE' : (z.updatedRate > 0 ? Number(z.updatedRate.toFixed(2)) : ''),
        Zone:            z.zone ?? '',
        Status:          z.outOfArea ? 'Out of Area' : (z.callForQuote ? 'Call for Quote' : (z.active ? 'Active' : 'Inactive')),
        Notes:           z.notes ?? '',
      }));
    const wsZones = XLSX.utils.json_to_sheet(zoneRows);
    wsZones['!cols'] = autoSize(zoneRows);
    XLSX.utils.book_append_sheet(wb, wsZones, 'Delivery Zones');
  }

  XLSX.writeFile(wb, `Stride_Price_List_${today()}.xlsx`);
}

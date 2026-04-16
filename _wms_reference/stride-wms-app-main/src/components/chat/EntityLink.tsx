import React from 'react';
import { Link } from 'react-router-dom';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ENTITY_CONFIG, EntityType } from '@/config/entities';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Map Lucide icon names to Material icon names
const ICON_MAP: Record<string, string> = {
  CheckSquare: 'check_box',
  Truck: 'local_shipping',
  Wrench: 'build',
  Package: 'inventory_2',
  FileText: 'description',
  ShieldAlert: 'gpp_bad',
  Receipt: 'receipt',
  Building: 'business',
  Clipboard: 'assignment',
};

// Color class mappings for Tailwind
const COLOR_CLASSES: Record<string, { bg: string; text: string; hover: string; ring: string }> = {
  blue: {
    bg: 'bg-blue-100',
    text: 'text-blue-800',
    hover: 'hover:bg-blue-200',
    ring: 'focus:ring-blue-500',
  },
  green: {
    bg: 'bg-green-100',
    text: 'text-green-800',
    hover: 'hover:bg-green-200',
    ring: 'focus:ring-green-500',
  },
  orange: {
    bg: 'bg-orange-100',
    text: 'text-orange-800',
    hover: 'hover:bg-orange-200',
    ring: 'focus:ring-orange-500',
  },
  purple: {
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    hover: 'hover:bg-purple-200',
    ring: 'focus:ring-purple-500',
  },
  teal: {
    bg: 'bg-teal-100',
    text: 'text-teal-800',
    hover: 'hover:bg-teal-200',
    ring: 'focus:ring-teal-500',
  },
  emerald: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    hover: 'hover:bg-emerald-200',
    ring: 'focus:ring-emerald-500',
  },
  indigo: {
    bg: 'bg-indigo-100',
    text: 'text-indigo-800',
    hover: 'hover:bg-indigo-200',
    ring: 'focus:ring-indigo-500',
  },
  amber: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    hover: 'hover:bg-amber-200',
    ring: 'focus:ring-amber-500',
  },
  rose: {
    bg: 'bg-rose-100',
    text: 'text-rose-800',
    hover: 'hover:bg-rose-200',
    ring: 'focus:ring-rose-500',
  },
};

export interface EntityLinkProps {
  type: EntityType;
  number: string;
  id?: string;
  exists?: boolean;
  summary?: string;
  /** Display style: "chip" (default) or "inline" (activity feed style) */
  variant?: 'chip' | 'inline';
}

export function EntityLink({
  type,
  number,
  id,
  exists = true,
  summary,
  variant = 'chip',
}: EntityLinkProps) {
  const config = ENTITY_CONFIG[type];
  const materialIconName = ICON_MAP[config.icon] || 'description';
  const colors = COLOR_CLASSES[config.color] || COLOR_CLASSES.blue;

  // Entity not found state
  if (!exists) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-medium bg-gray-100 text-gray-500 cursor-not-allowed">
              <MaterialIcon name="warning" className="mr-1" style={{ fontSize: '12px' }} />
              {number}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{config.label} not found</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Compute navigation target.
  // Some entities have multiple "detail" routes (e.g., inbound shipments),
  // and some screens don't have a dedicated detail route by number.
  const upper = number.toUpperCase();
  let to = id ? `${config.route}/${id}` : config.route;

  if (type === 'item') {
    // ItemDetail route expects UUID; fall back to scan redirect for item_code-only links.
    to = id ? `/inventory/${id}` : `/scan/item/${encodeURIComponent(upper)}`;
  }

  if (type === 'shipment') {
    const prefix = upper.split('-')[0] || 'SHP';
    const base =
      prefix === 'MAN' ? '/incoming/manifest'
      : prefix === 'EXP' ? '/incoming/expected'
      : prefix === 'INT' ? '/incoming/dock-intake'
      : '/shipments';

    // Prefer direct UUID route when available; otherwise use scan redirect by shipment_number.
    to = id ? `${base}/${id}` : `/scan/shipment/${encodeURIComponent(upper)}`;
  }

  const linkContent = variant === 'inline' ? (
    <Link
      to={to}
      className={cn(
        'inline-flex items-baseline whitespace-nowrap font-medium underline underline-offset-2 decoration-primary/40',
        'text-primary hover:decoration-primary focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-sm px-0.5'
      )}
    >
      {number}
    </Link>
  ) : (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-sm font-medium transition-colors focus:outline-none focus:ring-2',
        colors.bg,
        colors.text,
        colors.hover,
        colors.ring
      )}
    >
      <MaterialIcon name={materialIconName} className="mr-1" style={{ fontSize: '12px' }} />
      {number}
    </Link>
  );

  // With summary tooltip
  if (summary) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">{config.label}</p>
            <p className="text-sm text-gray-500">{summary}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return linkContent;
}

export default EntityLink;

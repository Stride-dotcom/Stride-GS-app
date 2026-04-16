import { useState, useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { formatClassCubicFeetLabel } from '@/lib/pricing/classCubicFeet';

interface ItemClass {
  id: string;
  name: string;
  code: string;
  min_cubic_feet: number | null;
  max_cubic_feet: number | null;
}

interface ClassSelectProps {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Reusable class (pricing tier) selector.
 * Classes are tenant-scoped and define storage/service pricing tiers (XS-XL).
 */
export function ClassSelect({
  value,
  onChange,
  placeholder = 'Select class...',
  disabled = false,
  className,
}: ClassSelectProps) {
  const { profile } = useAuth();
  const [classes, setClasses] = useState<ItemClass[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchClasses = async () => {
      if (!profile?.tenant_id) return;
      
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('classes')
          .select('id, name, code, min_cubic_feet, max_cubic_feet')
          .eq('tenant_id', profile.tenant_id)
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (error) {
          console.error('Error fetching classes:', error);
          return;
        }

        setClasses(data || []);
      } finally {
        setLoading(false);
      }
    };

    fetchClasses();
  }, [profile?.tenant_id]);

  const formatClassLabel = (cls: ItemClass) => {
    const sizeLabel = formatClassCubicFeetLabel(cls);
    return `${cls.name}${sizeLabel ? ` (${sizeLabel})` : ''}`;
  };

  return (
    <Select
      value={value || '_none_'}
      onValueChange={(val) => onChange(val === '_none_' ? '' : val)}
      disabled={disabled || loading}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={loading ? 'Loading...' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="_none_">No class</SelectItem>
        {classes.map((cls) => (
          <SelectItem key={cls.id} value={cls.id}>
            {formatClassLabel(cls)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default ClassSelect;

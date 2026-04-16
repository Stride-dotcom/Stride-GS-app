import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface ItemResult {
  id: string;
  item_code: string;
  description: string | null;
  location_code: string | null;
  warehouse_name: string | null;
}

interface LocationResult {
  id: string;
  code: string;
  name: string | null;
}

interface ItemSearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onSelect: (item: ItemResult) => void;
  title?: string;
  excludeIds?: string[];
}

export function ItemSearchOverlay({ 
  open, 
  onClose, 
  onSelect, 
  title = 'Search Items',
  excludeIds = []
}: ItemSearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    const searchItems = async () => {
      if (query.length < 1) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('v_items_with_location')
          .select('id, item_code, description, location_code, warehouse_name')
          .ilike('item_code', `%${query}%`)
          .limit(20);

        if (error) throw error;

        const filtered = (data || []).filter(item => !excludeIds.includes(item.id));
        setResults(filtered);
      } catch (err) {
        console.error('Search error:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchItems, 200);
    return () => clearTimeout(debounce);
  }, [query, excludeIds]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col pt-safe">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-background">
        <button
          onClick={onClose}
          className="p-2 hover:bg-muted rounded-xl transition-colors"
        >
          <MaterialIcon name="close" size="lg" />
        </button>
        <div className="flex-1 relative">
          <MaterialIcon name="search" size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search Item Code"
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            className="w-full h-12 pl-10 pr-4 text-lg bg-muted rounded-xl border-2 border-transparent focus:border-primary focus:outline-none"
            autoFocus
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <MaterialIcon name="progress_activity" className="text-[32px] animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && query.length > 0 && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MaterialIcon name="inventory_2" className="text-5xl mb-4" />
            <p>No items found for "{query}"</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <div className="p-2">
            {results.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className="w-full flex items-center gap-4 p-4 hover:bg-muted rounded-xl transition-colors text-left"
              >
                <MaterialIcon name="inventory_2" className="text-[32px] text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-lg">{item.item_code}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {item.description || 'No description'}
                  </p>
                </div>
                {item.location_code && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground shrink-0">
                    <MaterialIcon name="location_on" size="sm" />
                    {item.location_code}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {!loading && query.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MaterialIcon name="search" className="text-5xl mb-4" />
            <p>Start typing to search items</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface LocationSearchOverlayProps {
  open: boolean;
  onClose: () => void;
  onSelect: (location: LocationResult) => void;
  locations: LocationResult[];
  title?: string;
}

export function LocationSearchOverlay({ 
  open, 
  onClose, 
  onSelect, 
  locations,
  title = 'Select Location'
}: LocationSearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [filteredLocations, setFilteredLocations] = useState<LocationResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setFilteredLocations(locations);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, locations]);

  useEffect(() => {
    if (query.length === 0) {
      setFilteredLocations(locations);
    } else {
      const q = query.toLowerCase();
      setFilteredLocations(
        locations.filter(
          loc => 
            loc.code.toLowerCase().includes(q) || 
            (loc.name && loc.name.toLowerCase().includes(q))
        )
      );
    }
  }, [query, locations]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col pt-safe">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b bg-background">
        <button
          onClick={onClose}
          className="p-2 hover:bg-muted rounded-xl transition-colors"
        >
          <MaterialIcon name="close" size="lg" />
        </button>
        <div className="flex-1 relative">
          <MaterialIcon name="search" size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search storage locations..."
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            className="w-full h-12 pl-10 pr-4 text-lg bg-muted rounded-xl border-2 border-transparent focus:border-primary focus:outline-none"
            autoFocus
          />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {filteredLocations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MaterialIcon name="location_on" className="text-5xl mb-4" />
            <p>No locations found</p>
          </div>
        )}

        {filteredLocations.length > 0 && (
          <div className="p-2">
            {filteredLocations.map((loc) => (
              <button
                key={loc.id}
                onClick={() => onSelect(loc)}
                className="w-full flex items-center gap-4 p-4 hover:bg-muted rounded-xl transition-colors text-left"
              >
                <MaterialIcon name="location_on" className="text-[32px] text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-lg">{loc.code}</p>
                  {loc.name && (
                    <p className="text-sm text-muted-foreground truncate">
                      {loc.name}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

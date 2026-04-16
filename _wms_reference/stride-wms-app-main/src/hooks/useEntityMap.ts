import { useEffect, useState } from 'react';
import { extractEntityNumbers, type EntityMap } from '@/utils/parseEntityLinks';
import { resolveEntities, buildEntityMap } from '@/services/entityResolver';

type ActivityLike = {
  event_label?: string | null;
  details?: Record<string, unknown> | null;
};

/**
 * Best-effort resolver that scans activity text/details for entity numbers and maps them to IDs.
 * Useful for deep-linking entity references in activity feeds.
 */
export function useEntityMap(activities: ActivityLike[], warnLabel?: string): EntityMap | undefined {
  const [entityMap, setEntityMap] = useState<EntityMap | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      try {
        const textBlobs: string[] = [];
        for (const a of activities) {
          if (a.event_label) textBlobs.push(a.event_label);
          for (const v of Object.values(a.details || {})) {
            if (typeof v === 'string' && v) textBlobs.push(v);
          }
        }

        const numbers = [...new Set(textBlobs.flatMap((t) => extractEntityNumbers(t)))];
        if (numbers.length === 0) {
          if (!cancelled) setEntityMap(undefined);
          return;
        }

        const resolved = await resolveEntities(numbers);
        const map = buildEntityMap(resolved);
        if (!cancelled) setEntityMap(map as unknown as EntityMap);
      } catch (err) {
        if (warnLabel) console.warn(warnLabel, err);
        if (!cancelled) setEntityMap(undefined);
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [activities, warnLabel]);

  return entityMap;
}


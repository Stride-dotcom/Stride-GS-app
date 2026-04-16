import { useState, useEffect, useRef } from 'react';

/**
 * Animates a number from 0 to `end` over `duration` ms using ease-out.
 * Returns the current animated value.
 */
export function useCountUp(end: number, duration = 600, delay = 0): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>();
  const startTimeRef = useRef<number>();

  useEffect(() => {
    // Reset when end changes
    setValue(0);

    if (end <= 0) return;

    const timeout = setTimeout(() => {
      startTimeRef.current = undefined;

      const animate = (timestamp: number) => {
        if (startTimeRef.current === undefined) {
          startTimeRef.current = timestamp;
        }

        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);

        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * end));

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [end, duration, delay]);

  return value;
}

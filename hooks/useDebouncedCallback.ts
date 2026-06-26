import { useEffect, useMemo, useRef } from 'react';

/**
 * Returns a stable debounced wrapper around the latest `callback`. The returned
 * function keeps a constant identity (so it's safe in effect deps), always calls
 * the freshest callback, and coalesces rapid calls into one trailing invocation.
 *
 * Used to collapse bursts of Supabase realtime events into a single refetch
 * instead of firing one full `select` per change.
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delay: number,
) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const debounced = useMemo(
    () =>
      (...args: A) => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => callbackRef.current(...args), delay);
      },
    [delay],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return debounced;
}

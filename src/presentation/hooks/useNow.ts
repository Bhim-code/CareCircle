import { useEffect, useState } from 'react';

/** The current time, refreshed every minute so "Due now" and "Missed" stay correct. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

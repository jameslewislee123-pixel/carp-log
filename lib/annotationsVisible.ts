'use client';
import { useCallback, useEffect, useState } from 'react';

// Toggle for whether lake_annotations should render on the Lake Map and the
// Trip Map. Persisted in localStorage so the choice survives navigation
// between the two surfaces and across tab refreshes. Default ON — most
// users want to see the productive/snag pins.
//
// Coordinated across multiple subscribers in the same tab via a custom
// event so flipping the toggle on one map updates the other instantly
// (the native 'storage' event only fires cross-tab).

const KEY = 'cl_annotations_visible';
const EVENT = 'cl-annotations-visible';

function readPref(): boolean {
  if (typeof window === 'undefined') return true;
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

export function useAnnotationsVisible(): [boolean, () => void] {
  const [visible, setVisible] = useState<boolean>(true);

  useEffect(() => {
    setVisible(readPref());
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setVisible(readPref()); };
    const onCustom = () => setVisible(readPref());
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT, onCustom);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !readPref();
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch {}
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
  }, []);

  return [visible, toggle];
}

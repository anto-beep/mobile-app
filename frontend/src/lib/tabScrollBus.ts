// Tiny pubsub so the (tabs) layout can fire a "scroll-to-top" event
// when a tab is re-pressed while already focused. Each tab screen
// subscribes by name and scrolls its ScrollView to the top.
//
// This avoids @react-navigation/native's `useScrollToTop` hook which
// crashes when the screen is also reachable as a root route (e.g.
// `/family-wall` re-exported from `(tabs)/family.tsx`).
type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export const TabScrollBus = {
  subscribe(tab: string, fn: Listener): () => void {
    let s = listeners.get(tab);
    if (!s) { s = new Set(); listeners.set(tab, s); }
    s.add(fn);
    return () => { s!.delete(fn); };
  },
  publish(tab: string): void {
    const s = listeners.get(tab);
    if (!s) return;
    for (const fn of s) {
      try { fn(); } catch { /* ignore */ }
    }
  },
};

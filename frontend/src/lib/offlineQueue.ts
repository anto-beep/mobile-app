// Tiny client-side mutation queue for offline tolerance.
// ------------------------------------------------------
// What it does:
//   • While offline, callers can `enqueue()` a mutation (method + url + body).
//   • When NetInfo reports back online, `flushQueue()` retries each item in order.
//   • Successful items get removed; persistent failures (after 3 retries) are
//     dropped to avoid blocking forever.
//
// What it deliberately does NOT do:
//   • It's not a sync engine. GETs are not cached/replayed — only mutations.
//   • It doesn't dedupe; if you enqueue the same POST twice it sends twice.
//   • It doesn't handle multipart/file uploads (we'd need to serialise the
//     blob, which is complex on RN). Statement uploads / document uploads stay
//     online-only by design.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const QUEUE_KEY = 'wayly:offline_queue_v1';
const MAX_RETRIES = 3;

export type QueuedMutation = {
  id: string;
  method: 'post' | 'patch' | 'delete' | 'put';
  url: string;        // relative to the /api base, e.g. "/visits"
  body?: any;
  enqueued_at: string;
  attempts: number;
  label?: string;     // user-friendly description for the offline banner
};

async function readAll(): Promise<QueuedMutation[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(items: QueuedMutation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {}
}

export async function getQueue(): Promise<QueuedMutation[]> {
  return readAll();
}

export async function enqueue(item: Omit<QueuedMutation, 'id' | 'enqueued_at' | 'attempts'>): Promise<QueuedMutation> {
  const all = await readAll();
  const next: QueuedMutation = {
    ...item,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    enqueued_at: new Date().toISOString(),
    attempts: 0,
  };
  all.push(next);
  await writeAll(all);
  return next;
}

export async function dropAll(): Promise<void> {
  await writeAll([]);
}

let flushing = false;

/** Drain the queue. Safe to call repeatedly — internally guarded against
 *  concurrent flushes. Returns counts so callers can toast results. */
export async function flushQueue(): Promise<{ replayed: number; dropped: number; remaining: number }> {
  if (flushing) return { replayed: 0, dropped: 0, remaining: (await readAll()).length };
  flushing = true;
  let replayed = 0;
  let dropped = 0;
  try {
    let all = await readAll();
    const survivors: QueuedMutation[] = [];
    for (const item of all) {
      try {
        const method = item.method;
        if (method === 'post') await api.post(item.url, item.body || {});
        else if (method === 'patch') await api.patch(item.url, item.body || {});
        else if (method === 'put') await api.put(item.url, item.body || {});
        else if (method === 'delete') await api.delete(item.url);
        replayed += 1;
      } catch (err: any) {
        const status = err?.response?.status;
        // 4xx → permanent client error, drop the item rather than infinite retry.
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          dropped += 1;
          continue;
        }
        item.attempts += 1;
        if (item.attempts >= MAX_RETRIES) {
          dropped += 1;
        } else {
          survivors.push(item);
        }
      }
    }
    await writeAll(survivors);
    return { replayed, dropped, remaining: survivors.length };
  } finally {
    flushing = false;
  }
}

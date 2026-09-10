import type { Bill, Customer, Transaction } from '../types';
import {
  patchTransactions,
  removeBill,
  removeCustomer,
  removeTransactions,
  upsertBill,
  upsertCustomer,
  upsertTransactions,
} from './db';
import { safeSetItem } from './safeLocalStorage';

const OUTBOX_KEY = 'sandouk-halab-outbox-v1';

export type QueueStep =
  | { type: 'upsertTransactions'; txs: Transaction[] }
  | { type: 'removeTransactions'; ids: string[] }
  | { type: 'upsertBill'; bill: Bill }
  | { type: 'removeBill'; id: string }
  | { type: 'upsertCustomer'; customer: Customer }
  | { type: 'removeCustomer'; id: string }
  | { type: 'patchTransactions'; ids: string[]; patch: Partial<Transaction> }
  | { type: 'compound'; steps: QueueStep[] };

export type QueuedMutation = QueueStep & { id: string };

function readQueue(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedMutation[]): void {
  safeSetItem(OUTBOX_KEY, JSON.stringify(queue));
}

export function getQueueLength(): number {
  return readQueue().length;
}

export function enqueue(mutation: QueuedMutation): void {
  const queue = readQueue();
  queue.push(mutation);
  writeQueue(queue);
}

export function peekQueue(): QueuedMutation[] {
  return readQueue();
}

export function clearQueue(): void {
  localStorage.removeItem(OUTBOX_KEY);
}

export function makeQueueItem(steps: QueueStep | QueueStep[]): QueuedMutation {
  const id = crypto.randomUUID();
  const list = Array.isArray(steps) ? steps : [steps];
  if (list.length === 1) return { id, ...list[0] };
  return { id, type: 'compound', steps: list };
}

export function isRetryableError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch|network|timeout|aborted|failed|connection|offline|enotfound|econn/i.test(msg)) {
    return true;
  }
  return false;
}

export async function executeQueueStep(step: QueueStep): Promise<void> {
  switch (step.type) {
    case 'upsertTransactions':
      if (step.txs.length) await upsertTransactions(step.txs);
      return;
    case 'removeTransactions':
      if (step.ids.length) await removeTransactions(step.ids);
      return;
    case 'upsertBill':
      await upsertBill(step.bill);
      return;
    case 'removeBill':
      await removeBill(step.id);
      return;
    case 'upsertCustomer':
      await upsertCustomer(step.customer);
      return;
    case 'removeCustomer':
      await removeCustomer(step.id);
      return;
    case 'patchTransactions':
      await patchTransactions(step.ids, step.patch);
      return;
    case 'compound':
      for (const child of step.steps) await executeQueueStep(child);
      return;
    default:
      return;
  }
}

export async function executeQueuedMutation(mutation: QueuedMutation): Promise<void> {
  const { id: _id, ...step } = mutation;
  await executeQueueStep(step as QueueStep);
}

export async function flushOfflineQueue(
  onRemaining?: (count: number) => void,
): Promise<{ flushed: number; stopped: boolean }> {
  let flushed = 0;

  while (true) {
    const queue = readQueue();
    if (!queue.length) {
      onRemaining?.(0);
      return { flushed, stopped: false };
    }

    const head = queue[0];
    try {
      await executeQueuedMutation(head);
      writeQueue(queue.slice(1));
      flushed++;
      onRemaining?.(queue.length - 1);
    } catch (err) {
      if (isRetryableError(err)) {
        onRemaining?.(queue.length);
        return { flushed, stopped: true };
      }
      throw err;
    }
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { usePipelineContext } from '@/hooks/usePipelineContext';
import type { Contact } from '@/lib/types';
import type { PipelineSummary } from '@/lib/pipeline-data';
const loader = vi.hoisted(() => vi.fn());
vi.mock('@/lib/pipeline-data', () => ({ loadPipelineContext: loader }));
afterEach(() => { cleanup(); loader.mockReset(); });
const contacts: Contact[] = [{ id: 'synthetic', name: null, status: 'Lead' }];
function deferred() {
  let resolve!: (value: PipelineSummary) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<PipelineSummary>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const summary = (id: string): PipelineSummary => ({ tasks: [{ id, title: 'Synthetic task', status: 'pending' }], activities: [] });

describe('independent context lifecycle', () => {
  it('aborts superseded requests and ignores late successes', async () => {
    const old = deferred(); const current = deferred();
    loader.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { result, rerender } = renderHook(({ revision }) => usePipelineContext(contacts, revision), { initialProps: { revision: 0 } });
    expect(result.current.available).toBe(false);
    rerender({ revision: 1 });
    expect((loader.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
    await act(async () => current.resolve(summary('new')));
    expect(result.current.tasks[0].id).toBe('new');
    await act(async () => old.resolve(summary('old')));
    expect(result.current.tasks[0].id).toBe('new');
  });
  it('late failure cannot overwrite the current context', async () => {
    const old = deferred();
    loader.mockReturnValueOnce(old.promise).mockResolvedValueOnce(summary('new'));
    const { result, rerender, unmount } = renderHook(({ revision }) => usePipelineContext(contacts, revision), { initialProps: { revision: 0 } });
    rerender({ revision: 1 });
    await waitFor(() => expect(result.current.available).toBe(true));
    await act(async () => old.reject(new Error('synthetic')));
    expect(result.current.tasks[0].id).toBe('new');
    const signal = loader.mock.calls[1][0] as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
  });
  it('failure clears stale context and leaves task filtering unavailable', async () => {
    loader.mockResolvedValueOnce(summary('old')).mockRejectedValueOnce(new Error('synthetic'));
    const { result, rerender } = renderHook(({ revision }) => usePipelineContext(contacts, revision), { initialProps: { revision: 0 } });
    await waitFor(() => expect(result.current.available).toBe(true));
    rerender({ revision: 1 });
    await waitFor(() => expect(result.current.available).toBe(false));
    expect(result.current.tasks).toEqual([]);
  });
});

import { useEffect, useState } from 'react';
import type { Contact } from '@/lib/types';
import { loadPipelineContext, type PipelineSummary } from '@/lib/pipeline-data';

const empty: PipelineSummary = { tasks: [], activities: [] };
export function usePipelineContext(contacts: Contact[], revision: number) {
  const [state, setState] = useState({ ...empty, available: false, contacts: null as Contact[] | null, revision: -1 });
  useEffect(() => {
    const controller = new AbortController();
    if (contacts.length) {
      loadPipelineContext(controller.signal).then((summary) => {
        if (!controller.signal.aborted) setState({ ...summary, available: true, contacts, revision });
      }).catch(() => {
        if (!controller.signal.aborted) setState({ ...empty, available: false, contacts, revision });
      });
    }
    return () => controller.abort();
  }, [contacts, revision]);
  return state.contacts === contacts && state.revision === revision ? state : { ...empty, available: false };
}

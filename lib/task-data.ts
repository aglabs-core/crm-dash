import { supabase } from './supabase';
import type { Task } from './types';

/** Paginate pending and completed tasks; never turn a failed query into zero tasks. */
export async function loadTasks(client = supabase): Promise<Task[]> {
  const tasks: Task[] = [];
  for (let offset = 0; ; offset = tasks.length) {
    const { data, error } = await client.from('tasks')
      .select('*, contacts ( id, name )')
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    if (!data?.length) return tasks;
    tasks.push(...data as Task[]);
  }
}

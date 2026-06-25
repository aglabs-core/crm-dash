import { supabase } from './supabase';
import type { Activity, ActivityType } from './types';

/** Insert an activity for the current user. Stage changes are logged
 *  automatically by a DB trigger; this is for manual notes/calls/emails/etc. */
export async function logActivity(input: {
  contact_id?: string | null;
  type: ActivityType;
  content: string;
}): Promise<Activity | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('activities')
    .insert([{ user_id: userData.user.id, ...input }])
    .select();

  if (error) throw error;
  return (data?.[0] as Activity) ?? null;
}

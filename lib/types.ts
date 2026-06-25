// Domain types — single source of truth, replacing the per-file `any[]` usage.

export type DealStage =
  | 'Lead'
  | 'Contatado'
  | 'Proposta'
  | 'Negociação'
  | 'Ganho'
  | 'Perdido';

export type ContactStatus =
  | 'Lead'
  | 'Contatado'
  | 'Proposta'
  | 'Negociação'
  | 'Ganho'
  | 'Cliente'
  | 'Inativo';

export type Priority = 'Baixa' | 'Média' | 'Alta';

export type TaskStatus = 'pending' | 'completed';

export type ActivityType =
  | 'note'
  | 'call'
  | 'email'
  | 'meeting'
  | 'stage_change'
  | 'task';

export type Contact = {
  id: string;
  user_id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  status: ContactStatus;
  produto?: string | null;
  lp_url?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Deal = {
  id: string;
  user_id?: string;
  title: string;
  company?: string | null;
  amount: number;
  stage: DealStage;
  priority?: Priority | null;
  produto?: string | null;
  expected_close_date?: string | null;
  closed_at?: string | null;
  lost_reason?: string | null;
  contact_id?: string | null;
  contacts?: Pick<Contact, 'id' | 'name' | 'produto'> | null;
  created_at?: string;
  updated_at?: string;
};

export type Task = {
  id: string;
  user_id?: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  status: TaskStatus;
  priority?: Priority | null;
  contact_id?: string | null;
  contacts?: Pick<Contact, 'id' | 'name'> | null;
  created_at?: string;
  updated_at?: string;
};

export type Activity = {
  id: string;
  user_id?: string;
  contact_id?: string | null;
  deal_id?: string | null;
  type: ActivityType;
  content?: string | null;
  created_at: string;
};

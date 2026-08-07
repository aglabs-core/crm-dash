// Domain types — single source of truth, replacing the per-file `any[]` usage.

// The funnel lives on the contact now (one flow per contact). The active
// stages mirror the WhatsApp/message attendance flow:
//   Lead (waiting) · Contatado · Atendimento (in conversation) ·
//   Proposta (quote sent) · Pagamento (awaiting payment)   -> Kanban
//   Cliente · Inativo (inactive client)                    -> won
//   Arquivado (didn't close)                               -> lost
export type ContactStatus =
  | 'Lead'
  | 'Contatado'
  | 'Atendimento'
  | 'Proposta'
  | 'Pagamento'
  | 'Cliente'
  | 'Inativo'
  | 'Arquivado';

export type ContactOrigin = 'web' | 'prospeccao' | 'whatsapp' | 'manual' | 'compra';

/** Gateways de pagamento que alimentam o CRM automaticamente. */
export type Gateway = 'stripe' | 'asaas' | 'mercadopago';

export type Priority = 'Baixa' | 'Média' | 'Alta';

export type TaskStatus = 'pending' | 'completed';

/** Handling status of an inbound (web-captured) institutional lead. */
export type LeadStatus = 'novo' | 'contatado' | 'convertido' | 'descartado';

// Intenção da interação — o quê. O meio fica em `ActivityChannel`.
export type ActivityType =
  | 'note'
  | 'followup'
  | 'boas_vindas'
  | 'disparo'
  | 'suporte'
  | 'meeting'
  | 'stage_change'
  | 'task';

/** Meio pelo qual a interação aconteceu — por onde. */
export type ActivityChannel = 'whatsapp' | 'email' | 'telefone' | 'presencial' | 'sistema';

// A Contact is now the pipeline unit: it carries the funnel position (`status`)
// AND the deal economics (amount, expected_close_date, closed_at, …).
export type Contact = {
  id: string;
  user_id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  status: ContactStatus;
  origin?: ContactOrigin | null;
  produto?: string | null;
  lp_url?: string | null;
  amount?: number | null;
  priority?: Priority | null;
  expected_close_date?: string | null;
  closed_at?: string | null;
  lost_reason?: string | null;
  // Rastro da ingestão automática de pagamentos. Só preenchidos quando
  // `origin` é 'compra'.
  gateway?: Gateway | null;
  external_id?: string | null;
  documento?: string | null;
  created_at?: string;
  updated_at?: string;
};

/**
 * Inbound lead captured by the public web form (table `leads_institucional`).
 * These are opt-in, pre-qualified leads kept separate from worked `contacts`.
 */
export type InstitutionalLead = {
  id: string;
  lead: string; // captured name
  email?: string | null;
  whatsapp?: string | null;
  produto?: string | null;
  status: LeadStatus;
  notes?: string | null;
  contact_id?: string | null; // set once converted into a contact
  created_at?: string;
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
  type: ActivityType;
  channel?: ActivityChannel | null;
  content?: string | null;
  created_at: string;
};

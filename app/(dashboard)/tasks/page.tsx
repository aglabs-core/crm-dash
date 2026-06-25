'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Plus, Calendar, Users, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { Task, Contact } from '@/lib/types';
import { PRIORITIES, priorityTone } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { isTaskOverdue } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, Button, Modal, Field, Input, Textarea, Select, Badge, PageLoader } from '@/components/ui';

const TASK_SELECT = `*, contacts ( id, name )`;

const emptyForm = {
  title: '',
  description: '',
  due_date: '',
  priority: 'Média',
  contact_id: '',
};

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const openNewTaskModal = () => {
    setEditingTask(null);
    setFormData(emptyForm);
    setIsModalOpen(true);
  };

  const openEditTaskModal = (task: Task) => {
    setEditingTask(task);
    setFormData({
      title: task.title,
      description: task.description || '',
      due_date: task.due_date ? task.due_date.split('T')[0] : '',
      priority: task.priority || 'Média',
      contact_id: task.contact_id || '',
    });
    setIsModalOpen(true);
  };

  const handleDeleteTask = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta tarefa?')) return;
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
      setTasks((prev) => prev.filter((t) => t.id !== id));
      toast.success('Tarefa excluída com sucesso!');
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Erro ao excluir tarefa.');
    }
  };

  useEffect(() => {
    fetchTasks(true);
    fetchContacts();
    const sub = supabase
      .channel('tasks-page-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => fetchTasks())
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, []);

  const fetchContacts = async () => {
    const { data } = await supabase.from('contacts').select('id, name').order('name', { ascending: true });
    setContacts((data as Contact[]) || []);
  };

  const fetchTasks = async (showLoader = false) => {
    try {
      if (showLoader) setIsLoading(true);
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTasks((data as Task[]) || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      const payload = {
        title: formData.title,
        description: formData.description || null,
        due_date: formData.due_date || null,
        priority: formData.priority,
        contact_id: formData.contact_id || null,
      };

      if (editingTask) {
        const { data, error } = await supabase
          .from('tasks')
          .update(payload)
          .eq('id', editingTask.id)
          .select(TASK_SELECT);
        if (error) throw error;
        if (data) {
          setTasks((prev) => prev.map((t) => (t.id === editingTask.id ? (data[0] as Task) : t)));
          toast.success('Tarefa atualizada com sucesso!');
        }
      } else {
        const { data, error } = await supabase
          .from('tasks')
          .insert([{ user_id: userData.user.id, status: 'pending', ...payload }])
          .select(TASK_SELECT);
        if (error) throw error;
        if (data) {
          setTasks((prev) => [data[0] as Task, ...prev]);
          toast.success('Tarefa criada com sucesso!');
        }
      }
      setIsModalOpen(false);
      setEditingTask(null);
    } catch (error) {
      console.error('Error saving task:', error);
      toast.error('Erro ao salvar tarefa. Verifique se você está logado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTaskStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus as Task['status'] } : t)));
    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', id);
    if (error) {
      console.error('Error updating task status:', error);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: currentStatus as Task['status'] } : t)));
      toast.error('Erro ao atualizar o status da tarefa.');
    }
  };

  const pendingTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === 'pending')
        .sort((a, b) => {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        }),
    [tasks],
  );
  const completedTasks = useMemo(() => tasks.filter((t) => t.status === 'completed'), [tasks]);
  const overdueCount = useMemo(() => pendingTasks.filter(isTaskOverdue).length, [pendingTasks]);

  return (
    <div className="relative mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Minhas Tarefas</h1>
        <Button onClick={openNewTaskModal}>
          <Plus className="h-4 w-4" />
          Nova Tarefa
        </Button>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : (
        <>
          {overdueCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400">
              <AlertTriangle className="h-4 w-4" />
              {overdueCount} {overdueCount === 1 ? 'tarefa vencida' : 'tarefas vencidas'} pendentes.
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Pendentes
                <Badge tone="indigo">{pendingTasks.length}</Badge>
              </CardTitle>
            </CardHeader>
            <ul className="divide-y divide-border">
              {pendingTasks.map((task) => {
                const overdue = isTaskOverdue(task);
                return (
                  <li key={task.id} className="group flex items-start gap-4 p-4 transition-colors hover:bg-surface-2/50">
                    <button
                      onClick={() => toggleTaskStatus(task.id, task.status)}
                      className="mt-0.5 shrink-0 text-muted transition-colors hover:text-brand"
                      aria-label="Concluir tarefa"
                    >
                      <Circle className="h-6 w-6" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="truncate text-sm font-semibold text-fg">{task.title}</h3>
                        <div className="flex shrink-0 items-center gap-3">
                          <Badge tone={priorityTone(task.priority)}>{task.priority || 'Média'}</Badge>
                          <div className="flex items-center gap-2 text-muted opacity-0 transition-opacity group-hover:opacity-100">
                            <button onClick={() => openEditTaskModal(task)} className="hover:text-brand" aria-label="Editar">
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button onClick={() => handleDeleteTask(task.id)} className="hover:text-red-500" aria-label="Excluir">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                      </div>
                      {task.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{task.description}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
                        {task.due_date && (
                          <span
                            className={cn(
                              'flex items-center gap-1.5 font-medium',
                              overdue ? 'text-red-600 dark:text-red-400' : 'text-muted',
                            )}
                          >
                            <Calendar className="h-4 w-4" />
                            {formatDate(task.due_date)}
                            {overdue && ' · Vencida'}
                          </span>
                        )}
                        {task.contacts && (
                          <Link
                            href={`/contacts/${task.contacts.id}`}
                            className="flex items-center gap-1.5 rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand hover:underline"
                          >
                            <Users className="h-3 w-3" />
                            {task.contacts.name}
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
              {pendingTasks.length === 0 && (
                <li className="p-8 text-center text-sm text-muted">Nenhuma tarefa pendente. Você está em dia!</li>
              )}
            </ul>
          </Card>

          <Card className="opacity-80">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Concluídas
                <Badge tone="gray">{completedTasks.length}</Badge>
              </CardTitle>
            </CardHeader>
            <ul className="divide-y divide-border">
              {completedTasks.map((task) => (
                <li key={task.id} className="group flex items-start gap-4 p-4 transition-colors hover:bg-surface-2/50">
                  <button
                    onClick={() => toggleTaskStatus(task.id, task.status)}
                    className="mt-0.5 shrink-0 text-emerald-500 transition-colors hover:text-muted"
                    aria-label="Reabrir tarefa"
                  >
                    <CheckCircle2 className="h-6 w-6" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="truncate text-sm font-semibold text-muted line-through">{task.title}</h3>
                      <div className="flex items-center gap-2 text-muted opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => openEditTaskModal(task)} className="hover:text-brand" aria-label="Editar">
                          <Pencil className="h-5 w-5" />
                        </button>
                        <button onClick={() => handleDeleteTask(task.id)} className="hover:text-red-500" aria-label="Excluir">
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {completedTasks.length === 0 && (
                <li className="p-8 text-center text-sm text-muted">Nenhuma tarefa concluída ainda.</li>
              )}
            </ul>
          </Card>
        </>
      )}

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTask ? 'Editar Tarefa' : 'Nova Tarefa'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="task-form" loading={isSubmitting}>
              {editingTask ? 'Salvar' : 'Criar Tarefa'}
            </Button>
          </>
        }
      >
        <form id="task-form" onSubmit={handleSaveTask} className="space-y-4">
          <Field label="Título da Tarefa" htmlFor="title" required>
            <Input
              id="title"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ex: Ligar para o cliente"
            />
          </Field>
          <Field label="Descrição" htmlFor="description">
            <Textarea
              id="description"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Detalhes adicionais..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Vencimento" htmlFor="due_date">
              <Input
                id="due_date"
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              />
            </Field>
            <Field label="Prioridade" htmlFor="priority">
              <Select
                id="priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Contato Relacionado" htmlFor="contact_id">
            <Select
              id="contact_id"
              value={formData.contact_id}
              onChange={(e) => setFormData({ ...formData, contact_id: e.target.value })}
            >
              <option value="">Nenhum contato</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </Modal>
    </div>
  );
}

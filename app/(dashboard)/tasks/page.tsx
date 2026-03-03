'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, Clock, MoreVertical, Plus, Calendar, Loader2, X, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Task = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  priority: string;
  user_id: string;
};

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    due_date: '',
    priority: 'Média'
  });

  const openNewTaskModal = () => {
    setEditingTask(null);
    setFormData({ title: '', description: '', due_date: '', priority: 'Média' });
    setIsModalOpen(true);
  };

  const openEditTaskModal = (task: Task) => {
    setEditingTask(task);
    setFormData({
      title: task.title,
      description: task.description || '',
      due_date: task.due_date ? task.due_date.split('T')[0] : '', // Format for date input
      priority: task.priority || 'Média'
    });
    setIsModalOpen(true);
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTasks(data || []);
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

      if (editingTask) {
        const { data, error } = await supabase
          .from('tasks')
          .update({
            title: formData.title,
            description: formData.description || null,
            due_date: formData.due_date || null,
            priority: formData.priority,
          })
          .eq('id', editingTask.id)
          .select();

        if (error) throw error;

        if (data) {
          setTasks(tasks.map(t => t.id === editingTask.id ? data[0] : t));
          setIsModalOpen(false);
          setEditingTask(null);
        }
      } else {
        const { data, error } = await supabase
          .from('tasks')
          .insert([
            {
              user_id: userData.user.id,
              title: formData.title,
              description: formData.description || null,
              due_date: formData.due_date || null,
              priority: formData.priority,
              status: 'pending'
            }
          ])
          .select();

        if (error) throw error;

        if (data) {
          setTasks([data[0], ...tasks]);
          setIsModalOpen(false);
        }
      }
    } catch (error) {
      console.error('Error saving task:', error);
      alert('Erro ao salvar tarefa. Verifique se você está logado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTaskStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    
    // Optimistic update
    setTasks(tasks.map(task => 
      task.id === id ? { ...task, status: newStatus } : task
    ));

    try {
      const { error } = await supabase
        .from('tasks')
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      console.error('Error updating task status:', error);
      // Revert on error
      setTasks(tasks.map(task => 
        task.id === id ? { ...task, status: currentStatus } : task
      ));
      alert('Erro ao atualizar o status da tarefa.');
    }
  };

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  return (
    <div className="max-w-4xl mx-auto space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Minhas Tarefas</h1>
        <button 
          onClick={openNewTaskModal}
          className="inline-flex items-center justify-center bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4 mr-2" />
          Nova Tarefa
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                Pendentes
                <span className="bg-indigo-100 text-indigo-700 py-0.5 px-2.5 rounded-full text-xs font-medium">
                  {pendingTasks.length}
                </span>
              </h2>
            </div>
            <ul className="divide-y divide-gray-100">
              {pendingTasks.map((task) => (
                <li key={task.id} className="p-4 hover:bg-gray-50 transition-colors group flex items-start gap-4">
                  <button 
                    onClick={() => toggleTaskStatus(task.id, task.status)}
                    className="mt-1 flex-shrink-0 text-gray-400 hover:text-indigo-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-full"
                  >
                    <Circle className="h-6 w-6" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{task.title}</h3>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium
                          ${task.priority === 'Alta' ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20' : 
                            task.priority === 'Média' ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20' : 
                            'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'}`}>
                          {task.priority}
                        </span>
                        <button 
                          onClick={() => openEditTaskModal(task)}
                          className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-indigo-600"
                          title="Editar tarefa"
                        >
                          <Pencil className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-sm text-gray-500 line-clamp-2">{task.description}</p>
                    )}
                    <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                      {task.due_date && (
                        <div className="flex items-center gap-1.5 font-medium">
                          <Calendar className="h-4 w-4" />
                          {new Date(task.due_date).toLocaleDateString('pt-BR')}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {pendingTasks.length === 0 && (
                <li className="p-8 text-center text-gray-500 text-sm">
                  Nenhuma tarefa pendente. Você está em dia!
                </li>
              )}
            </ul>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden opacity-75">
            <div className="p-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                Concluídas
                <span className="bg-gray-200 text-gray-700 py-0.5 px-2.5 rounded-full text-xs font-medium">
                  {completedTasks.length}
                </span>
              </h2>
            </div>
            <ul className="divide-y divide-gray-100">
              {completedTasks.map((task) => (
                <li key={task.id} className="p-4 hover:bg-gray-50 transition-colors group flex items-start gap-4">
                  <button 
                    onClick={() => toggleTaskStatus(task.id, task.status)}
                    className="mt-1 flex-shrink-0 text-emerald-500 hover:text-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-full"
                  >
                    <CheckCircle2 className="h-6 w-6" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-4">
                      <h3 className="text-sm font-semibold text-gray-500 line-through truncate">{task.title}</h3>
                      <button 
                        onClick={() => openEditTaskModal(task)}
                        className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-indigo-600"
                        title="Editar tarefa"
                      >
                        <Pencil className="h-5 w-5" />
                      </button>
                    </div>
                    {task.description && (
                      <p className="mt-1 text-sm text-gray-400 line-clamp-1">{task.description}</p>
                    )}
                  </div>
                </li>
              ))}
              {completedTasks.length === 0 && (
                <li className="p-8 text-center text-gray-500 text-sm">
                  Nenhuma tarefa concluída ainda.
                </li>
              )}
            </ul>
          </div>
        </>
      )}

      {/* Modal de Nova Tarefa */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingTask ? 'Editar Tarefa' : 'Nova Tarefa'}
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveTask} className="p-4 space-y-4">
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">Título da Tarefa *</label>
                <input
                  id="title"
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Ex: Ligar para o cliente"
                />
              </div>
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea
                  id="description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Detalhes adicionais..."
                />
              </div>
              <div>
                <label htmlFor="due_date" className="block text-sm font-medium text-gray-700 mb-1">Data de Vencimento</label>
                <input
                  id="due_date"
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => setFormData({...formData, due_date: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-1">Prioridade</label>
                <select
                  id="priority"
                  value={formData.priority}
                  onChange={(e) => setFormData({...formData, priority: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="Baixa">Baixa</option>
                  <option value="Média">Média</option>
                  <option value="Alta">Alta</option>
                </select>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    editingTask ? 'Salvar Alterações' : 'Salvar Tarefa'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

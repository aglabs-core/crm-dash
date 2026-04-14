'use client';

import { useState, useEffect, Suspense } from 'react';
import { Plus, MoreHorizontal, Calendar, DollarSign, GripVertical, Loader2, X, Pencil, Trash2 } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useSearchParams, useRouter } from 'next/navigation';

const initialColumns = [
  { id: 'Lead', title: 'Lead' },
  { id: 'Contatado', title: 'Contatado' },
  { id: 'Proposta', title: 'Proposta' },
  { id: 'Negociação', title: 'Negociação' },
  { id: 'Ganho', title: 'Ganho' },
];

type Deal = {
  id: string;
  title: string;
  company: string;
  amount: number;
  stage: string;
  expected_close_date: string | null;
  priority?: string;
  contact_id?: string | null;
  contacts?: {
    id: string;
    name: string;
    produto?: string;
  } | null;
};

type Contact = {
  id: string;
  name: string;
  company: string;
  produto?: string;
};

function DealsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [productFilter, setProductFilter] = useState('Todos');
  const [isMounted, setIsMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    company: '',
    amount: '',
    stage: 'Lead',
    expected_close_date: '',
    priority: 'Média',
    contact_id: ''
  });

  const openNewDealModal = (stage = 'Lead', contactId = '') => {
    setEditingDeal(null);
    setFormData({ title: '', company: '', amount: '', stage, expected_close_date: '', priority: 'Média', contact_id: contactId });
    setIsModalOpen(true);
  };

  const openEditDealModal = (deal: Deal) => {
    setEditingDeal(deal);
    setFormData({
      title: deal.title,
      company: deal.company || '',
      amount: deal.amount ? deal.amount.toString() : '',
      stage: deal.stage || 'Lead',
      expected_close_date: deal.expected_close_date ? deal.expected_close_date.split('T')[0] : '',
      priority: deal.priority || 'Média',
      contact_id: deal.contact_id || ''
    });
    setIsModalOpen(true);
  };

  const handleDeleteDeal = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este negócio?')) return;
    
    try {
      const { error } = await supabase
        .from('deals')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setDeals(deals.filter(d => d.id !== id));
      toast.success('Negócio excluído com sucesso!');
    } catch (error) {
      console.error('Error deleting deal:', error);
      toast.error('Erro ao excluir negócio.');
    }
  };

  useEffect(() => {
    setIsMounted(true);
    fetchDeals();
    fetchContacts();

    const dealsSubscription = supabase
      .channel('deals-page-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deals' }, () => {
        fetchDeals();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(dealsSubscription);
    };
  }, []);

  useEffect(() => {
    const contactId = searchParams.get('new_deal_contact_id');
    if (contactId && contacts.length > 0) {
      openNewDealModal('Lead', contactId);
      // Remove query param
      router.replace('/deals');
    }
  }, [searchParams, contacts, router]);

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, company, produto')
        .order('name', { ascending: true });
      
      if (error) throw error;
      setContacts(data || []);
    } catch (error) {
      console.error('Error fetching contacts:', error);
    }
  };

  const fetchDeals = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('deals')
        .select(`
          *,
          contacts (
            id,
            name,
            produto
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Normalize stages to ensure they appear in the funnel
      const normalizedData = (data || []).map(deal => {
        const stageStr = deal.stage || '';
        // Try to find an exact or case-insensitive match
        const matchedColumn = initialColumns.find(
          col => col.id.toLowerCase() === stageStr.toLowerCase()
        );
        
        // If it's "Perdido" (Lost), we might still want to keep it as "Perdido" 
        // but the funnel doesn't have a "Perdido" column.
        // Let's just map unknown stages to 'Lead' so they show up.
        let finalStage = matchedColumn ? matchedColumn.id : 'Lead';
        
        if (stageStr.toLowerCase() === 'perdido') {
           finalStage = 'Perdido'; // Keep it as Perdido if it's lost, though it won't show in funnel
        }

        return {
          ...deal,
          stage: finalStage
        };
      });
      
      setDeals(normalizedData);
    } catch (error) {
      console.error('Error fetching deals:', error);
      toast.error('Erro ao carregar negócios.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      if (editingDeal) {
        const { data, error } = await supabase
          .from('deals')
          .update({
            title: formData.title,
            company: formData.company,
            amount: parseFloat(formData.amount) || 0,
            stage: formData.stage,
            expected_close_date: formData.expected_close_date || null,
            priority: formData.priority,
            contact_id: formData.contact_id || null
          })
          .eq('id', editingDeal.id)
          .select(`*, contacts(id, name, produto)`);

        if (error) throw error;

        if (data) {
          setDeals(deals.map(d => d.id === editingDeal.id ? data[0] : d));
          setIsModalOpen(false);
          setEditingDeal(null);
          toast.success('Negócio atualizado com sucesso!');
        }
      } else {
        const { data, error } = await supabase
          .from('deals')
          .insert([
            {
              user_id: userData.user.id,
              title: formData.title,
              company: formData.company,
              amount: parseFloat(formData.amount) || 0,
              stage: formData.stage,
              expected_close_date: formData.expected_close_date || null,
              priority: formData.priority,
              contact_id: formData.contact_id || null
            }
          ])
          .select(`*, contacts(id, name, produto)`);

        if (error) throw error;

        if (data) {
          setDeals([data[0], ...deals]);
          setIsModalOpen(false);
          setFormData({ title: '', company: '', amount: '', stage: 'Lead', expected_close_date: '', priority: 'Média', contact_id: '' });
          toast.success('Negócio criado com sucesso!');
        }
      }
    } catch (error) {
      console.error('Error saving deal:', error);
      toast.error('Erro ao salvar negócio. Verifique se você está logado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination) return;

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const newDeals = Array.from(deals);
    const draggedDealIndex = newDeals.findIndex(d => d.id === draggableId);
    
    if (draggedDealIndex !== -1) {
      const draggedDeal = newDeals[draggedDealIndex];
      const previousStage = draggedDeal.stage;
      
      // Optimistic update
      newDeals[draggedDealIndex] = {
        ...draggedDeal,
        stage: destination.droppableId
      };
      setDeals(newDeals);

      // Update in Supabase
      try {
        const { error } = await supabase
          .from('deals')
          .update({ stage: destination.droppableId })
          .eq('id', draggableId);

        if (error) throw error;
      } catch (error) {
        console.error('Error updating deal stage:', error);
        // Revert on error
        const revertedDeals = Array.from(newDeals);
        revertedDeals[draggedDealIndex] = {
          ...draggedDeal,
          stage: previousStage
        };
        setDeals(revertedDeals);
        toast.error('Erro ao atualizar o estágio do negócio.');
      }
    }
  };

  if (!isMounted) {
    return null; // Prevent hydration mismatch with dnd
  }

  // Get unique products from deals' contacts
  const uniqueProducts = Array.from(new Set(deals.map(d => d.contacts?.produto).filter(Boolean)));

  const filteredDeals = deals.filter(deal => {
    if (productFilter === 'Todos') return true;
    return deal.contacts?.produto === productFilter;
  });

  return (
    <div className="h-full flex flex-col space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Funil de Vendas</h1>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <select
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            className="block w-full sm:w-48 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
          >
            <option value="Todos">Todos os Produtos</option>
            {uniqueProducts.map(product => (
              <option key={product} value={product}>{product}</option>
            ))}
          </select>
          <button 
            onClick={() => openNewDealModal()}
            className="inline-flex items-center justify-center bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            Novo Negócio
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-6 h-full min-w-max items-start">
              {initialColumns.map((column) => {
                const columnDeals = filteredDeals.filter(d => d.stage === column.id);
                const columnTotal = columnDeals.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

                return (
                  <div key={column.id} className="w-80 flex flex-col bg-gray-100/80 rounded-xl border border-gray-200/80 max-h-full">
                    <div className="p-4 border-b border-gray-200/80 flex items-center justify-between bg-gray-100 rounded-t-xl shrink-0">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                          {column.title}
                          <span className="bg-white border border-gray-200 text-gray-700 py-0.5 px-2 rounded-full text-xs font-medium shadow-sm">
                            {columnDeals.length}
                          </span>
                        </h3>
                        <p className="text-xs text-gray-500 mt-1 font-medium">
                          R$ {columnTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <button 
                        onClick={() => openNewDealModal(column.id)}
                        className="text-gray-400 hover:text-indigo-600 transition-colors p-1 rounded-md hover:bg-gray-200"
                      >
                        <Plus className="h-5 w-5" />
                      </button>
                    </div>

                    <Droppable droppableId={column.id}>
                      {(provided, snapshot) => (
                        <div 
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`flex-1 p-3 overflow-y-auto space-y-3 min-h-[150px] transition-colors [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${
                            snapshot.isDraggingOver ? 'bg-indigo-50/50' : ''
                          }`}
                        >
                          {columnDeals.map((deal, index) => (
                            <Draggable key={deal.id} draggableId={deal.id} index={index}>
                              {(provided, snapshot) => (
                                <div 
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`bg-white p-4 rounded-lg border transition-all group ${
                                    snapshot.isDragging 
                                      ? 'border-indigo-400 shadow-lg rotate-2 scale-105 z-50' 
                                      : 'border-gray-200 shadow-sm hover:border-indigo-300 hover:shadow-md'
                                  }`}
                                >
                                  <div className="flex justify-between items-start mb-2">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider
                                      ${deal.priority === 'Alta' ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20' : 
                                        deal.priority === 'Média' ? 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20' : 
                                        'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20'}`}>
                                      {deal.priority || 'Normal'}
                                    </span>
                                    <div className="flex items-center text-gray-400 gap-1">
                                      <button 
                                        onClick={() => openEditDealModal(deal)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-indigo-600"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </button>
                                      <button 
                                        onClick={() => handleDeleteDeal(deal.id)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                      <GripVertical className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing ml-1" />
                                    </div>
                                  </div>
                                  <h4 className="text-sm font-semibold text-gray-900 mb-1">{deal.title}</h4>
                                  <p className="text-xs text-gray-500 mb-4">
                                    {deal.company || '-'}
                                    {deal.contacts && (
                                      <span className="block mt-1 text-indigo-600">
                                        👤 {deal.contacts.name}
                                      </span>
                                    )}
                                  </p>
                                  
                                  <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-100">
                                    <div className="flex items-center gap-1 font-medium text-gray-700">
                                      <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                                      {Number(deal.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </div>
                                    {deal.expected_close_date && (
                                      <div className="flex items-center gap-1">
                                        <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                                        {new Date(deal.expected_close_date).toLocaleDateString('pt-BR')}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </DragDropContext>
        )}
      </div>

      {/* Modal de Novo Negócio */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingDeal ? 'Editar Negócio' : 'Novo Negócio'}
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveDeal} className="p-4 space-y-4">
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">Título do Negócio *</label>
                <input
                  id="title"
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({...formData, title: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Ex: Redesign de Site"
                />
              </div>
              <div>
                <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
                <input
                  id="company"
                  type="text"
                  value={formData.company}
                  onChange={(e) => setFormData({...formData, company: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Nome da Empresa"
                />
              </div>
              <div>
                <label htmlFor="contact_id" className="block text-sm font-medium text-gray-700 mb-1">Contato (Lead)</label>
                <select
                  id="contact_id"
                  value={formData.contact_id}
                  onChange={(e) => setFormData({...formData, contact_id: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="">Selecione um contato</option>
                  {contacts.map(contact => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name} {contact.company ? `(${contact.company})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
                <input
                  id="amount"
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({...formData, amount: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label htmlFor="stage" className="block text-sm font-medium text-gray-700 mb-1">Estágio</label>
                <select
                  id="stage"
                  value={formData.stage}
                  onChange={(e) => setFormData({...formData, stage: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  {initialColumns.map(col => (
                    <option key={col.id} value={col.id}>{col.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="expected_close_date" className="block text-sm font-medium text-gray-700 mb-1">Data de Fechamento Esperada</label>
                <input
                  id="expected_close_date"
                  type="date"
                  value={formData.expected_close_date}
                  onChange={(e) => setFormData({...formData, expected_close_date: e.target.value})}
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
                    'Salvar Negócio'
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

export default function Deals() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 text-indigo-500 animate-spin" /></div>}>
      <DealsContent />
    </Suspense>
  );
}

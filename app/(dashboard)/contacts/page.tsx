'use client';

import { useState, useEffect } from 'react';
import { Search, Filter, MoreHorizontal, Mail, Phone, Plus, Users, X, Loader2, Pencil, Trash2, CheckCircle2, Briefcase, Clock, DollarSign } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import Link from 'next/link';

type Contact = {
  id: string;
  name: string;
  title?: string;
  company: string;
  email: string;
  phone: string;
  status: string;
  lp_url?: string;
};

export default function Contacts() {
  const [searchTerm, setSearchTerm] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    status: 'Lead',
    lp_url: ''
  });

  const openNewContactModal = () => {
    setEditingContact(null);
    setFormData({ name: '', email: '', phone: '', company: '', status: 'Lead', lp_url: '' });
    setIsModalOpen(true);
  };

  const openEditContactModal = (contact: Contact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      email: contact.email || '',
      phone: contact.phone || '',
      company: contact.company || '',
      status: contact.status || 'Lead',
      lp_url: contact.lp_url || ''
    });
    setIsModalOpen(true);
  };

  const handleDeleteContact = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este contato?')) return;
    
    try {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setContacts(contacts.filter(c => c.id !== id));
      toast.success('Contato excluído com sucesso!');
    } catch (error) {
      console.error('Error deleting contact:', error);
      toast.error('Erro ao excluir contato.');
    }
  };

  useEffect(() => {
    fetchContacts();

    const contactsSubscription = supabase
      .channel('contacts-page-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => {
        fetchContacts();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(contactsSubscription);
    };
  }, []);

  const fetchContacts = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContacts(data || []);
    } catch (error) {
      console.error('Error fetching contacts:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error('User not authenticated');

      if (editingContact) {
        const { data, error } = await supabase
          .from('contacts')
          .update({
            name: formData.name,
            email: formData.email,
            phone: formData.phone,
            company: formData.company,
            status: formData.status,
            lp_url: formData.lp_url
          })
          .eq('id', editingContact.id)
          .select();

        if (error) throw error;

        if (data) {
          setContacts(contacts.map(c => c.id === editingContact.id ? data[0] : c));
          setIsModalOpen(false);
          setEditingContact(null);
          toast.success('Contato atualizado com sucesso!');
        }
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .insert([
            {
              user_id: userData.user.id,
              name: formData.name,
              email: formData.email,
              phone: formData.phone,
              company: formData.company,
              status: formData.status,
              lp_url: formData.lp_url
            }
          ])
          .select();

        if (error) throw error;

        if (data) {
          setContacts([data[0], ...contacts]);
          setIsModalOpen(false);
          setFormData({ name: '', email: '', phone: '', company: '', status: 'Lead', lp_url: '' });
          toast.success('Contato criado com sucesso!');
        }
      }
    } catch (error) {
      console.error('Error saving contact:', error);
      toast.error('Erro ao salvar contato. Verifique se você está logado.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredContacts = contacts.filter(contact => 
    contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (contact.company && contact.company.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Calculate totals
  const totalContacts = contacts.length;
  const totalLeads = contacts.filter(c => c.status === 'Lead').length;
  const totalContacted = contacts.filter(c => c.status === 'Contatado').length;
  const totalNegotiation = contacts.filter(c => c.status === 'Negociação' || c.status === 'Proposta').length;
  const totalWon = contacts.filter(c => c.status === 'Ganho' || c.status === 'Cliente').length;

  return (
    <div className="space-y-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Contatos</h1>
        <button 
          onClick={openNewContactModal}
          className="inline-flex items-center justify-center bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4 mr-2" />
          Adicionar Contato
        </button>
      </div>

      {/* Totals Section */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-1"><Users className="w-4 h-4" /> Total</span>
          <span className="text-2xl font-bold text-gray-900">{totalContacts}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-1"><Clock className="w-4 h-4" /> Leads</span>
          <span className="text-2xl font-bold text-gray-900">{totalLeads}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-1"><Phone className="w-4 h-4" /> Contatados</span>
          <span className="text-2xl font-bold text-gray-900">{totalContacted}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-1"><Briefcase className="w-4 h-4" /> Em Negociação</span>
          <span className="text-2xl font-bold text-gray-900">{totalNegotiation}</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col">
          <span className="text-sm font-medium text-gray-500 mb-1 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Clientes</span>
          <span className="text-2xl font-bold text-gray-900">{totalWon}</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative max-w-sm w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="Buscar contatos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
            <Filter className="h-4 w-4 mr-2 text-gray-400" />
            Filtros
          </button>
        </div>

        <div className="overflow-x-auto min-h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Nome
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Empresa
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Informações de Contato
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    LP URL
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="relative px-6 py-3">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredContacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10">
                          <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
                            {contact.name?.split(' ').map(n => n?.[0] || '').slice(0, 2).join('').toUpperCase() || '?'}
                          </div>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{contact.name}</div>
                          {contact.title && <div className="text-sm text-gray-500">{contact.title}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{contact.company || '-'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1 text-sm text-gray-500">
                        {contact.email && (
                          <div className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5" />
                            {contact.email}
                          </div>
                        )}
                        {contact.phone && (
                          <div className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5" />
                            {contact.phone}
                          </div>
                        )}
                        {!contact.email && !contact.phone && '-'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {contact.lp_url ? (
                        <a href={contact.lp_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:text-indigo-900 truncate max-w-[150px] inline-block">
                          {contact.lp_url}
                        </a>
                      ) : (
                        <span className="text-sm text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
                        ${contact.status === 'Cliente' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20' : 
                          'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-500/20'}`}>
                        {contact.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/deals?new_deal_contact_id=${contact.id}`}
                          className="text-gray-400 hover:text-emerald-600 transition-colors"
                          title="Criar Negócio"
                        >
                          <DollarSign className="h-5 w-5" />
                        </Link>
                        <button 
                          onClick={() => openEditContactModal(contact)}
                          className="text-gray-400 hover:text-indigo-600 transition-colors"
                          title="Editar contato"
                        >
                          <Pencil className="h-5 w-5" />
                        </button>
                        <button 
                          onClick={() => handleDeleteContact(contact.id)}
                          className="text-gray-400 hover:text-red-600 transition-colors"
                          title="Excluir contato"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!isLoading && filteredContacts.length === 0 && (
          <div className="text-center py-12">
            <Users className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-semibold text-gray-900">Nenhum contato encontrado</h3>
            <p className="mt-1 text-sm text-gray-500">Tente ajustar sua busca ou adicione um novo contato.</p>
          </div>
        )}
      </div>

      {/* Modal de Novo Contato */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingContact ? 'Editar Contato' : 'Novo Contato'}
              </h2>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveContact} className="p-4 space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Nome Completo *</label>
                <input
                  id="name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="Ex: João Silva"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="joao@exemplo.com"
                />
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                <input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="(11) 99999-9999"
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
                <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  id="status"
                  value={formData.status}
                  onChange={(e) => setFormData({...formData, status: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="Lead">Lead</option>
                  <option value="Prospect">Prospect</option>
                  <option value="Cliente">Cliente</option>
                  <option value="Inativo">Inativo</option>
                </select>
              </div>
              <div>
                <label htmlFor="lp_url" className="block text-sm font-medium text-gray-700 mb-1">LP URL</label>
                <input
                  id="lp_url"
                  type="url"
                  value={formData.lp_url}
                  onChange={(e) => setFormData({...formData, lp_url: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="https://exemplo.com/lp"
                />
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
                    editingContact ? 'Salvar Alterações' : 'Salvar Contato'
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

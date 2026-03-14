'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Loader2, Users, Briefcase, CheckSquare, ArrowRight } from 'lucide-react';
import Link from 'next/link';

function SearchContent() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';
  
  const [isLoading, setIsLoading] = useState(true);
  const [results, setResults] = useState<{
    contacts: any[];
    deals: any[];
    tasks: any[];
  }>({
    contacts: [],
    deals: [],
    tasks: []
  });

  useEffect(() => {
    if (query) {
      fetchResults(query);
    } else {
      setResults({ contacts: [], deals: [], tasks: [] });
      setIsLoading(false);
    }
  }, [query]);

  const fetchResults = async (searchQuery: string) => {
    try {
      setIsLoading(true);
      const likeQuery = `%${searchQuery}%`;

      // Fetch Contacts
      const { data: contactsData, error: contactsError } = await supabase
        .from('contacts')
        .select('*')
        .or(`name.ilike.${likeQuery},email.ilike.${likeQuery},company.ilike.${likeQuery}`)
        .limit(10);

      if (contactsError) throw contactsError;

      // Fetch Deals
      const { data: dealsData, error: dealsError } = await supabase
        .from('deals')
        .select('*')
        .or(`title.ilike.${likeQuery},company.ilike.${likeQuery}`)
        .limit(10);

      if (dealsError) throw dealsError;

      // Fetch Tasks
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .or(`title.ilike.${likeQuery}`)
        .limit(10);

      if (tasksError) throw tasksError;

      setResults({
        contacts: contactsData || [],
        deals: dealsData || [],
        tasks: tasksData || []
      });
    } catch (error) {
      console.error('Error fetching search results:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!query) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="bg-gray-100 p-4 rounded-full mb-4">
          <Users className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900">Digite algo para buscar</h3>
        <p className="mt-1 text-gray-500">Busque por contatos, negócios ou tarefas.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  const hasResults = results.contacts.length > 0 || results.deals.length > 0 || results.tasks.length > 0;

  if (!hasResults) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="bg-gray-100 p-4 rounded-full mb-4">
          <Users className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900">Nenhum resultado encontrado</h3>
        <p className="mt-1 text-gray-500">Não encontramos nada correspondente a &quot;{query}&quot;.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-gray-200 pb-5">
        <h3 className="text-base font-semibold leading-6 text-gray-900">
          Resultados da busca para &quot;{query}&quot;
        </h3>
      </div>

      {results.contacts.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-medium text-gray-900 flex items-center">
              <Users className="h-5 w-5 mr-2 text-indigo-500" />
              Contatos ({results.contacts.length})
            </h4>
            <Link href="/contacts" className="text-sm text-indigo-600 hover:text-indigo-500 flex items-center">
              Ver todos <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
          <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-hidden">
            <ul role="list" className="divide-y divide-gray-100">
              {results.contacts.map((contact) => (
                <li key={contact.id} className="relative flex justify-between gap-x-6 px-4 py-5 hover:bg-gray-50 sm:px-6">
                  <div className="flex min-w-0 gap-x-4">
                    <div className="h-12 w-12 flex-none rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-lg">
                      {contact.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-auto">
                      <p className="text-sm font-semibold leading-6 text-gray-900">
                        <Link href="/contacts">
                          <span className="absolute inset-x-0 -top-px bottom-0" />
                          {contact.name}
                        </Link>
                      </p>
                      <p className="mt-1 flex text-xs leading-5 text-gray-500">
                        {contact.email} {contact.company && `• ${contact.company}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-x-4">
                    <div className="hidden sm:flex sm:flex-col sm:items-end">
                      <p className="text-sm leading-6 text-gray-900">{contact.status}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {results.deals.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-medium text-gray-900 flex items-center">
              <Briefcase className="h-5 w-5 mr-2 text-indigo-500" />
              Negócios ({results.deals.length})
            </h4>
            <Link href="/deals" className="text-sm text-indigo-600 hover:text-indigo-500 flex items-center">
              Ver todos <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
          <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-hidden">
            <ul role="list" className="divide-y divide-gray-100">
              {results.deals.map((deal) => (
                <li key={deal.id} className="relative flex justify-between gap-x-6 px-4 py-5 hover:bg-gray-50 sm:px-6">
                  <div className="flex min-w-0 gap-x-4">
                    <div className="min-w-0 flex-auto">
                      <p className="text-sm font-semibold leading-6 text-gray-900">
                        <Link href="/deals">
                          <span className="absolute inset-x-0 -top-px bottom-0" />
                          {deal.title}
                        </Link>
                      </p>
                      <p className="mt-1 flex text-xs leading-5 text-gray-500">
                        {deal.company}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-x-4">
                    <div className="hidden sm:flex sm:flex-col sm:items-end">
                      <p className="text-sm leading-6 text-gray-900 font-medium">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(deal.amount) || 0)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-gray-500">{deal.stage}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {results.tasks.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-medium text-gray-900 flex items-center">
              <CheckSquare className="h-5 w-5 mr-2 text-indigo-500" />
              Tarefas ({results.tasks.length})
            </h4>
            <Link href="/tasks" className="text-sm text-indigo-600 hover:text-indigo-500 flex items-center">
              Ver todas <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </div>
          <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-hidden">
            <ul role="list" className="divide-y divide-gray-100">
              {results.tasks.map((task) => (
                <li key={task.id} className="relative flex justify-between gap-x-6 px-4 py-5 hover:bg-gray-50 sm:px-6">
                  <div className="flex min-w-0 gap-x-4 items-center">
                    <input
                      type="checkbox"
                      checked={task.status === 'completed'}
                      readOnly
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                    />
                    <div className="min-w-0 flex-auto">
                      <p className={`text-sm font-semibold leading-6 ${task.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                        <Link href="/tasks">
                          <span className="absolute inset-x-0 -top-px bottom-0" />
                          {task.title}
                        </Link>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-x-4">
                    <div className="hidden sm:flex sm:flex-col sm:items-end">
                      <p className="text-sm leading-6 text-gray-900">{task.priority}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Busca Global</h1>
      </div>
      <Suspense fallback={
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
        </div>
      }>
        <SearchContent />
      </Suspense>
    </div>
  );
}

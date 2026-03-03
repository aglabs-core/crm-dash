import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { Suspense } from 'react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Suspense fallback={<header className="flex h-16 shrink-0 items-center border-b border-gray-200 bg-white px-4 shadow-sm" />}>
          <Header />
        </Suspense>
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

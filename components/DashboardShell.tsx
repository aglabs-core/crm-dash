'use client';

import { Suspense, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Suspense fallback={<header className="h-16 shrink-0 border-b border-border bg-surface" />}>
          <Header onMenuClick={() => setMobileOpen(true)} />
        </Suspense>
        <motion.main
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex-1 overflow-y-auto p-4 sm:p-6"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}

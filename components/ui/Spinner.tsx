import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-brand', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-full min-h-[400px] items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

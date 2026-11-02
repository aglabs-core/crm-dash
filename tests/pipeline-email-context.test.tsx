import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PipelineContext } from '@/components/PipelineContext';
afterEach(cleanup);
it('shows product email evidence separately from account and commercial stage', () => {
  render(<PipelineContext contactId="synthetic" tasks={[]} activities={[]} available accountStatus="trial_encerrado" email={{ id: 'e', contact_id: 'synthetic', category: 'automacao', source_key: 'barberias.trial.recuperacao', status: 'delivered', sent_at: '2026-10-25T10:00:00Z' }} />);
  expect(screen.getByText('Teste encerrado')).toBeTruthy();
  expect(screen.getByText(/Recuperação.*Entregue/)).toBeTruthy();
  expect(screen.getByText(/Sem conversa humana registrada/)).toBeTruthy();
  expect(screen.getByText(/Definir tarefa manual/)).toBeTruthy();
  expect(screen.queryByText('Contatado')).toBeNull();
});

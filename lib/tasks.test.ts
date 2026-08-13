import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TASK_ASSIGNEES,
  assigneeLabel,
  buildTaskPayload,
  taskMatchesAssignee,
} from './tasks';

describe('task assignment handoff', () => {
  it('offers the operational owners used by Maia handoffs', () => {
    assert.deepEqual(
      TASK_ASSIGNEES.map((owner) => owner.id),
      ['maia', 'leo', 'antonio', 'tecnico'],
    );
  });

  it('builds a persisted task payload with a structured assignee', () => {
    assert.deepEqual(
      buildTaskPayload({
        title: 'Retornar cliente',
        description: 'Confirmar renovação',
        due_date: '2026-08-14',
        priority: 'Alta',
        contact_id: 'contact-1',
        assigned_to: 'leo',
      }),
      {
        title: 'Retornar cliente',
        description: 'Confirmar renovação',
        due_date: '2026-08-14',
        priority: 'Alta',
        contact_id: 'contact-1',
        assigned_to: 'leo',
      },
    );
  });

  it('normalizes empty optional values without inventing an assignee', () => {
    assert.deepEqual(
      buildTaskPayload({
        title: 'Revisar atendimento',
        description: '',
        due_date: '',
        priority: 'Média',
        contact_id: '',
        assigned_to: '',
      }),
      {
        title: 'Revisar atendimento',
        description: null,
        due_date: null,
        priority: 'Média',
        contact_id: null,
        assigned_to: null,
      },
    );
  });

  it('labels and filters assigned tasks', () => {
    assert.equal(assigneeLabel('leo'), 'Léo');
    assert.equal(assigneeLabel(null), 'Sem responsável');
    assert.equal(taskMatchesAssignee({ assigned_to: 'leo' }, 'leo'), true);
    assert.equal(taskMatchesAssignee({ assigned_to: 'maia' }, 'leo'), false);
    assert.equal(taskMatchesAssignee({ assigned_to: null }, 'unassigned'), true);
    assert.equal(taskMatchesAssignee({ assigned_to: 'leo' }, 'all'), true);
  });
});

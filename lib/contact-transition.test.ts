import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCustomerDowngrade } from './contact-transition';
test('customers keep relationship while lifecycle transitions remain possible', () => {
  for (const status of ['Cliente', 'Inativo'] as const) {
    assert.equal(isCustomerDowngrade({ status }, 'Lead'), true);
    assert.equal(isCustomerDowngrade({ status }, 'Atendimento'), true);
    assert.equal(isCustomerDowngrade({ status }, 'Arquivado', true), true);
    assert.equal(isCustomerDowngrade({ status }, 'Cliente'), false);
    assert.equal(isCustomerDowngrade({ status }, 'Inativo'), false);
    assert.equal(isCustomerDowngrade({ status }, 'Arquivado'), false);
  }
  assert.equal(isCustomerDowngrade({ status: 'Arquivado' }, 'Lead'), false);
});

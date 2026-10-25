import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productLabel } from './product-label';
test('nomes antigos do serviço são apresentados como Desenvolvimento web', () => {
  for (const key of ['localsite', 'LocalSite', ' local-site ', 'desenvolvimento_web', 'desenvolvimento-web']) assert.equal(productLabel(key), 'Desenvolvimento web');
  assert.equal(productLabel('barberias'), 'Barberias');
  assert.equal(productLabel('Outro produto'), 'Outro produto');
});

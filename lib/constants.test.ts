import assert from 'node:assert/strict';
import { it } from 'node:test';
import { originLabel, originTone } from './constants';

it('uses a neutral label for missing or unknown origin', () => {
  assert.equal(originLabel(null), 'Não informada');
  assert.equal(originLabel(undefined), 'Não informada');
  assert.equal(originLabel('unexpected-origin'), 'Não informada');
  assert.equal(originTone(null), 'gray');
});

it('preserves labels for known origins', () => {
  assert.equal(originLabel('prospeccao'), 'Prospecção');
  assert.equal(originLabel('whatsapp'), 'WhatsApp');
  assert.equal(originLabel('email'), 'E-mail');
});

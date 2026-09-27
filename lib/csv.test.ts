import assert from 'node:assert/strict';
import test from 'node:test';
import { csvCell, csvFile } from './csv';

test('escapes spreadsheet formulas and preserves numeric amounts', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"');
  assert.equal(csvCell('  +SUM(1,2)'), "'  +SUM(1,2)");
  assert.equal(csvCell(-30), '-30');
  assert.equal(csvFile([['Produto', 'Valor'], ['A;B', 30]]), '\uFEFFProduto;Valor\r\n"A;B";30');
});

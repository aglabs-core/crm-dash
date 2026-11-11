import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_SECTIONS, sectionOf, tabsFor } from './navigation';

test('every screen belongs to exactly one section and no tab is repeated', () => {
  const hrefs = NAV_SECTIONS.flatMap((section) => (section.tabs ?? [{ href: section.href }]).map((tab) => tab.href));
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const section of NAV_SECTIONS) {
    assert.equal(sectionOf(section.href)?.id, section.id);
    if (section.tabs) assert.equal(section.tabs[0].href, section.href);
  }
});

test('grouped screens resolve to their section; the home never swallows other routes', () => {
  assert.equal(sectionOf('/')?.id, 'overview');
  assert.equal(sectionOf('/operations')?.id, 'overview');
  assert.equal(sectionOf('/ecosystem')?.id, 'overview');
  assert.equal(sectionOf('/leads')?.id, 'contacts');
  assert.equal(sectionOf('/clients')?.id, 'contacts');
  assert.equal(sectionOf('/contacts/abc')?.id, 'contacts');
  assert.equal(sectionOf('/actions')?.id, 'tasks');
  assert.equal(sectionOf('/documents')?.id, 'finance');
  assert.equal(sectionOf('/campaigns/templates')?.id, 'email');
  assert.equal(sectionOf('/search'), undefined);
  assert.equal(sectionOf('/settings'), undefined);
});

test('tabs show on the main screens of a section and stay out of detail pages', () => {
  assert.deepEqual(tabsFor('/leads').map((tab) => tab.href), ['/contacts', '/leads', '/clients']);
  assert.deepEqual(tabsFor('/contacts/abc'), []);
  assert.deepEqual(tabsFor('/deals'), []);
  assert.deepEqual(tabsFor('/campaigns'), []);
  assert.deepEqual(tabsFor('/settings'), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parse} from 'yaml';
import {repair} from '../tools/repair-archive-yaml.mjs';
const note=(status='done',tags='[archived]')=>`---\ntype: задача\nuid: one\nstatus: ${status}\ntags: ${tags}\ntitle: Read: chapter one\n---\n# Body\n\n- [x] Already done\n`;
test('archive repair preserves title, uid, status and every body byte',()=>{
  const text=note(),out=repair(text),fm=parse(out.split('---')[1]);
  assert.equal(fm.title,'Read: chapter one');assert.equal(fm.uid,'one');assert.equal(fm.status,'done');
  assert.equal(out.slice(out.indexOf('# Body')),text.slice(text.indexOf('# Body')));
  assert.equal(repair(out),null);
});
test('archive repair refuses open and unarchived tasks',()=>{
  assert.equal(repair(note('open')),null);assert.equal(repair(note('done','[]')),null);
});
test('archive repair refuses ambiguous corruption and preserves CRLF',()=>{
  assert.equal(repair(note().replace('type: задача','type: [')),null);
  const out=repair(note().replaceAll('\n','\r\n'));assert.ok(out);assert.ok(!/(?<!\r)\n/.test(out));
});

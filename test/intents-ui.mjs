import { J, sleep, until } from './cdp.mjs';

export async function checkIntentsUI(page, mobile=false) {
  const click=async expr=>{
    const at=await until(()=>page.eval(`const e=${expr};if(!e)return false;e.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const b=e.matches('a')?[...e.getClientRects()].find(r=>r.width&&r.height):e.getBoundingClientRect();if(!b)return false;const point={x:b.left+b.width/2,y:b.top+b.height/2};const hit=document.elementFromPoint(point.x,point.y);return hit&&e.contains(hit)?point:false;`),'idea control is visible and uncovered');
    if(mobile)await page.tap(at);else await page.click(at);
    await sleep(100);
  };
  const root="app.workspace.activeLeaf.view.containerEl";
  const viewport=await page.eval(`return {width:innerWidth,height:innerHeight};`);
  const card=title=>`[...${root}.querySelectorAll('.ft-intent-card')].find(e=>e.querySelector('.ft-intent-title')?.textContent===${J(title)})`;
  const set=async(selector,value)=>page.eval(`const e=document.querySelector(${J(selector)});if(!e)throw Error('editor field missing');e.value=${J(value)};e.dispatchEvent(new Event('input',{bubbles:true}));return true;`);
  const modal=async()=>{await until(()=>page.eval(`return !!document.querySelector('.ft-intent-modal .ft-intent-title-input');`),'idea editor');await sleep(mobile?500:120);};
  await page.eval(`if(!['focus-tasks-e2e','focus-tasks-mobile'].includes(app.vault.getName()))throw Error('test vault guard');const p=app.plugins.plugins['focus-tasks'];await p.createArea('Ideas UI');await app.commands.executeCommandById('focus-tasks:open');p.setIntentsShown(true);return true;`);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].notes().some(n=>n.area==='Ideas UI'&&!n.project);`),'idea area indexed');
  await until(()=>page.eval(`return !!${root}.querySelector('.ft-intents-toggle');`),'ideas control');
  await page.eval(`await app.commands.executeCommandById('focus-tasks:add-intent');return true;`);await modal();
  await set('.ft-intent-title-input','Ideas UI possibility');await set('.ft-intent-body-input','A long optional possibility with **details** and context.');await set('.ft-intent-area-input','Ideas UI');
  await click(`document.querySelector('.ft-intent-save')`);
  await until(()=>page.eval(`return !!(${card('Ideas UI possibility')});`),'created idea card');
  if(!await page.eval(`const e=(${card('Ideas UI possibility')}).querySelector('.ft-intent-title'),r=document.createRange();r.setStart(e.firstChild,0);r.setEnd(e.firstChild,1);return Math.abs(r.getBoundingClientRect().left-e.getBoundingClientRect().left)<2;`))throw Error('idea title is not aligned to its text column');
  if(await page.eval(`const e=${card('Ideas UI possibility')};return !!e.querySelector('input,.ft-date,.ft-priority,.ft-calendar-status');`))throw Error('idea looks like an executable task');
  await click(`(${card('Ideas UI possibility')}).querySelector('.ft-intent-title')`);await modal();
  await set('.ft-intent-title-input','Ideas UI renamed');await set('.ft-intent-body-input','Edited context');
  // A failed write must leave the draft and its editor open.
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];window.__realIntentSave=p.saveIntent;p.saveIntent=async()=>{throw Error('test disk failure')};return true;`);
  await click(`document.querySelector('.ft-intent-save')`);
  await until(()=>page.eval(`return !!document.querySelector('.ft-intent-error')?.textContent;`),'save failure visible');
  if(!await page.eval(`return document.querySelector('.ft-intent-title-input')?.value==='Ideas UI renamed'&&document.querySelector('.ft-intent-body-input')?.value==='Edited context';`))throw Error('idea draft lost');
  await page.eval(`app.plugins.plugins['focus-tasks'].saveIntent=__realIntentSave;return true;`);
  await click(`document.querySelector('.ft-intent-save')`);
  await until(()=>page.eval(`return !!(${card('Ideas UI renamed')});`),'edited card');
  await click(`(${card('Ideas UI renamed')}).querySelector('.ft-intent-task')`);await modal();
  if(await page.eval(`return !!document.querySelector('.ft-intent-title-input').value;`))throw Error('deriving a task did not ask for a concrete action');
  await set('.ft-intent-title-input','Ideas UI concrete action');await click(`document.querySelector('.ft-intent-save')`);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().some(t=>t.text==='Ideas UI concrete action');`),'derived task');
  if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],task=p.tasks().find(t=>t.text==='Ideas UI concrete action');return !task.date&&task.area==='Ideas UI'&&!!(${card('Ideas UI renamed')});`))throw Error('derived task consumed or scheduled its idea');
  await click(`(${card('Ideas UI renamed')}).querySelector('.ft-intent-task')`);await modal();
  await set('.ft-intent-title-input','Ideas UI focus action');await set('.ft-intent-destination','today');await click(`document.querySelector('.ft-intent-save')`);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().some(t=>t.text==='Ideas UI focus action'&&t.date&&!t.at);`),'task enters focus');
  if(!await page.eval(`return (await app.plugins.plugins['focus-tasks'].collect(false)).some(a=>a.rows.some(r=>r.kind==='task'&&r.task.text==='Ideas UI focus action'));`))throw Error('Focus choice did not activate the action');
  // Legacy blocks are available without modifying their source or creating task notes.
  const sourceText='---\nparents:\n  - "[[Ideas UI]]"\n---\n\n# Material\nKeep this\n### TODO\n- [ ] Optional legacy thought [[Ideas UI context]]\n- [x] Past action\n### Rest\nKeep that\n';
  const source=await page.eval(`if(!app.vault.getAbstractFileByPath('Notes'))await app.vault.createFolder('Notes');await app.vault.create('Notes/Ideas UI context.md','Source material');const file=await app.vault.create('Notes/Ideas UI source.md',${J(sourceText)});window.__ideaSourceBefore=await app.vault.read(file);return file.path;`);
  await until(()=>page.eval(`return !!(${card('Ideas UI source')});`),'legacy source card');
  if(!await page.eval(`const e=${card('Ideas UI source')};return !e.querySelector('input[type=checkbox]')&&e.textContent.includes('Optional legacy thought');`))throw Error('legacy checkboxes stayed executable');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];p.setIntentsShown(false);const v=app.workspace.activeLeaf.view.renderer;await v.find();return true;`);
  await until(()=>page.eval(`return !!document.querySelector('.prompt-input');`),'common search');
  const q=await page.eval(`const e=document.querySelector('.prompt-input');const b=e.getBoundingClientRect();return {x:b.left+20,y:b.top+b.height/2};`);
  if(mobile)await page.tap(q);else await page.click(q);await page.type('Optional legacy thought');
  await until(()=>page.eval(`return [...document.querySelectorAll('.suggestion-item')].some(e=>e.textContent.includes('Ideas UI source'));`),'body search finds idea');
  await page.key('Enter');await until(()=>page.eval(`return !!(${card('Ideas UI source')});`),'search reveals card in plugin');
  if(!await page.eval(`const file=app.vault.getAbstractFileByPath(${J(source)});return await app.vault.read(file)===__ideaSourceBefore;`))throw Error('viewing ideas changed source');
  const migrated=await page.eval(`const p=app.plugins.plugins['focus-tasks'],file=app.vault.getAbstractFileByPath(${J(source)});const r=await p.migrateTodoFile(file,__ideaSourceBefore);window.__ideaImportedUid=r.moved[0].uid;return r.moved.length;`);
  if(migrated!==1)throw Error('native TODO migration did not create one card');
  await until(()=>page.eval(`return !!${root}.querySelector('[data-intent-id="'+__ideaImportedUid+'"]');`),'imported card has stable identity');
  if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],file=app.vault.getAbstractFileByPath(${J(source)}),idea=(await p.intentCards()).find(i=>i.uid===__ideaImportedUid);return !(await app.vault.read(file)).includes('### TODO')&&idea.sourceFile===file&&idea.body.includes('~~Past action~~')&&!p.tasks().some(t=>t.uid===idea.uid);`))throw Error('migration lost context, history or idea isolation');
  await click(`${root}.querySelector('[data-intent-id="'+__ideaImportedUid+'"] a.internal-link')`);
  await until(()=>page.eval(`return app.workspace.getActiveFile()?.path==='Notes/Ideas UI context.md';`),'idea wiki link opens context');
  await page.eval(`await app.plugins.plugins['focus-tasks'].openView();return true;`);
  await until(()=>page.eval(`return !!${root}.querySelector('[data-intent-id="'+__ideaImportedUid+'"]');`),'Focus survives context link');
  await page.shot('test/shots/intents-'+(mobile?'mobile':'desktop')+'.png');
  await page.eval(`await app.commands.executeCommandById('focus-tasks:add-intent');return true;`);await modal();
  await set('.ft-intent-title-input','Ideas UI discard');await set('.ft-intent-body-input','Disposable material');await set('.ft-intent-area-input','Ideas UI');await click(`document.querySelector('.ft-intent-save')`);
  await until(()=>page.eval(`return !!(${card('Ideas UI discard')});`),'deletion fixture');
  await click(`(${card('Ideas UI discard')}).querySelector('.ft-intent-title')`);await modal();await click(`document.querySelector('.ft-intent-delete')`);
  await until(()=>page.eval(`return document.querySelectorAll('.modal-container').length>=2;`),'idea deletion confirmation');
  await click(`[...document.querySelectorAll('.modal-container')].at(-1).querySelector('button.mod-warning')`);
  await until(()=>page.eval(`return !(${card('Ideas UI discard')});`),'idea deleted');
  await click(`[...document.querySelectorAll('.notice .ft-undo')].at(-1)`);await until(()=>page.eval(`return !!(${card('Ideas UI discard')});`),'deleted idea restored by Undo');
  if(mobile)for(const width of [320,390,430]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:2,mobile:true});
    await page.eval(`const root=${root}.querySelector('.focus-tasks-view');root.style.fontSize='26px';return true;`);await sleep(150);
    const bad=await page.eval(`return [...${root}.querySelectorAll('.ft-intent-card,.ft-intent-title,.ft-intent-task')].filter(e=>{const b=e.getBoundingClientRect();return b.width&& (b.left<0||b.right>innerWidth+1)}).map(e=>e.className);`);
    if(bad.length)throw Error('mobile idea overflow: '+bad.join(','));
  }
  if(mobile)await page.send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:2,mobile:true});
  await page.eval(`const root=${root}.querySelector('.focus-tasks-view');root.style.fontSize='';app.plugins.plugins['focus-tasks'].setIntentsShown(false);return true;`);
}

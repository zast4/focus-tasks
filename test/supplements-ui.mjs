import { J, sleep, until } from './cdp.mjs';

export async function checkSupplementsUI(page, mobile=false) {
  const root='app.workspace.activeLeaf.view.containerEl';
  const area=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Supplements UI')`;
  const project=`[...${root}.querySelectorAll('li.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='SUP Project')`;
  const click=async expr=>{
    await page.front();await page.eval(`const e=${expr};e?.scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(180);
    const at=await until(()=>page.eval(`const e=${expr};if(!e)return false;const r=e.getBoundingClientRect(),at={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(at.x,at.y);return r.width&&r.height&&hit&&e.contains(hit)?at:false;`),'supplement control: '+expr);
    if(mobile)await page.tap(at);else await page.click(at);await sleep(120);
    const active=await page.eval(`return app.workspace.activeLeaf.view.getViewType();`);if(active!=='focus-tasks-view'&&!expr.includes('ft-page')&&!expr.includes('ft-area-page'))throw Error('supplement click switched away from Focus: '+expr+' -> '+active);
  };
  const geometry=async label=>{
    const result=await page.eval(`const root=${root},issues=[];const groups=[...root.querySelectorAll('.ft-supplement-switch')].filter(e=>e.getBoundingClientRect().width);if(!groups.length)issues.push('missing component');
      for(const g of groups){const r=g.getBoundingClientRect(),buttons=[...g.children];if(r.left<0||r.right>innerWidth+1)issues.push('group outside screen');
        for(let i=0;i<buttons.length;i++){const b=buttons[i].getBoundingClientRect();if(b.width<${mobile?44:25}||b.height<${mobile?44:24})issues.push('small target');if(b.left<r.left-1||b.right>r.right+1)issues.push('button outside group');if(i&&b.left<buttons[i-1].getBoundingClientRect().right-0.5)issues.push('overlapping segments');}
        for(const sibling of [...g.parentElement.children].filter(e=>e!==g&&!e.contains(g)&&!g.contains(e)&&!e.classList.contains('ft-grip'))){const b=sibling.getBoundingClientRect();if(b.width&&b.height&&Math.min(r.right,b.right)-Math.max(r.left,b.left)>1&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>1)issues.push('group overlaps '+sibling.className);}}
      const rows=[...root.querySelectorAll('.ft-project-intents li.ft-task')].filter(e=>e.getBoundingClientRect().width);
      const normal=[...root.querySelectorAll('li.ft-task:not(.ft-project-row)')].find(e=>!e.closest('.ft-intents')&&e.getBoundingClientRect().width);
      for(const row of rows){const r=row.getBoundingClientRect(),text=row.querySelector(':scope > .ft-text'),box=row.querySelector('input[type=checkbox]');if(r.left<0||r.right>innerWidth+1)issues.push('idea row outside screen');if(!text||text.getBoundingClientRect().width<80)issues.push('idea text squeezed');
        if(${mobile}&&normal&&box){const ref=normal.querySelector('input[type=checkbox]');if(ref&&Math.abs(ref.getBoundingClientRect().left-box.getBoundingClientRect().left)>1)issues.push('idea checkbox column differs');}}
      return {issues,groups:groups.length};`);
    if(result.issues.length)throw Error(label+': '+J(result));
  };
  const viewport=await page.eval(`return {width:innerWidth,height:innerHeight};`);
  await page.eval(`if(!['focus-tasks-e2e','focus-tasks-mobile'].includes(app.vault.getName()))throw Error('test vault guard');const p=app.plugins.plugins['focus-tasks'];const file=await p.createArea('Supplements UI');const area={name:'Supplements UI',note:file};const pf=await p.createProject(area,'SUP Project');window.__supPaths={project:pf.path,area:file.path};
    await p.frontOwned(pf,fm=>fm.uid='ui-supplement-project');
    await p.createTask('SUP Focus',{area:area.name,project:pf.basename,projectFile:pf},moment().format('YYYY-MM-DD'));
    await p.createTask('SUP Project later',{area:area.name,project:pf.basename,projectFile:pf},moment().add(1,'day').format('YYYY-MM-DD'));
    await p.createTask('SUP Area focus',{area:area.name,project:null},moment().format('YYYY-MM-DD'));
    await p.createTask('SUP Area later',{area:area.name,project:null},moment().add(1,'day').format('YYYY-MM-DD'));
    const list=await p.createIntentList('SUP Independent',area.name);await p.createTask('SUP Area idea',{area:area.name,project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid},null);
    const linked=await p.createIntentList('SUP Bound',area.name);await p.frontOwned(linked.file,fm=>{fm.intentProjectUid='ui-supplement-project';fm.intentProject='[['+pf.path.replace(/\\.md$/,'')+']]';});
    await p.createTask('SUP Project idea',{area:area.name,project:linked.file.basename,projectFile:linked.file,intentList:true,listUid:linked.uid},null);
    p.forgetScan();window.__supTaskCount=p.tasks().length;p.setEverything(false);delete p.data.folded['area:'+area.name];delete p.data.opened['intents:'+area.name];delete p.data.opened['project-intents:'+pf.path];p.saveFolds();await app.commands.executeCommandById('focus-tasks:open');p.refresh();return true;`);
  await until(()=>page.eval(`return !!(${area});`),'supplement fixture visible');
  if(!await page.eval(`return (${area}).querySelector(':scope > .ft-area-title .ft-supplement-switch')?.children.length===2;`))throw Error('area needs one two-segment component');
  if(!await page.eval(`return (${project}).querySelector('.ft-supplement-switch')?.children.length===2;`))throw Error('project needs the same two-segment component');
  if(await page.eval(`return !!${root}.querySelector('.ft-foot .ft-intents-chip,.ft-foot .ft-intents-toggle');`))throw Error('global Ideas entry must not be added');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-intents-chip')`);
  await until(()=>page.eval(`return (${area}).querySelectorAll('.ft-intent-list-row').length===2;`),'area shows independent and project collections');
  if(!await page.eval(`return [...(${area}).querySelectorAll('.ft-intent-list-row .ft-link')].some(e=>e.textContent.startsWith('SUP Project'));`))throw Error('project collection needs its project name');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !(${area}).querySelector(':scope > .ft-intents')&&!!(${area}).querySelector(':scope > .ft-future-block');`),'backlog replaces area ideas');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !(${area}).querySelector(':scope > .ft-future-block');`),'active backlog collapses');
  if(!mobile){
    await page.mouse('mouseMoved',0,0,0);await sleep(120);
    const before=await page.eval(`const e=(${project}).querySelector('.ft-supplement-switch');const r=e.getBoundingClientRect();return {x:r.x,y:r.y};`);
    const over=await page.eval(`const r=(${project}).getBoundingClientRect();return {x:r.left+50,y:r.top+r.height/2};`);
    await page.mouse('mouseMoved',over.x,over.y,0);await sleep(120);
    const after=await page.eval(`const r=(${project}).querySelector('.ft-supplement-switch').getBoundingClientRect();return {x:r.x,y:r.y};`);
    if(Math.abs(before.x-after.x)>1||Math.abs(before.y-after.y)>1)throw Error('hover moved the supplement under the pointer');
  }
  await page.front();await page.eval(`(${project}).querySelector('.ft-intents-chip').scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(180);
  const pressed=await page.eval(`window.__supPressed=(${project}).querySelector('.ft-intents-chip');const r=__supPressed.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};`);
  if(mobile)await page.touch('touchStart',[pressed]);else await page.mouse('mousePressed',pressed.x,pressed.y,1);
  await page.eval(`app.plugins.plugins['focus-tasks'].refresh();return true;`);await sleep(200);
  if(!await page.eval(`return __supPressed.isConnected;`))throw Error('redraw replaced a pressed supplement');
  if(mobile)await page.touch('touchEnd',[]);else await page.mouse('mouseReleased',pressed.x,pressed.y,1);
  await page.eval(`delete window.__supPressed;return true;`);
  await until(()=>page.eval(`return !!${root}.querySelector('.ft-project-intents .ft-text');`),'project ideas open as task rows');
  if(await page.eval(`return !!${root}.querySelector('.ft-project-intents .ft-intent-list-row');`))throw Error('project ideas must not add a list level');
  await click(`${root}.querySelector('.ft-project-intents .ft-intents-add')`);
  await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'project idea editor');await page.type('SUP New project idea');await page.key('Enter');await page.key('Escape');
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.read().intentTasks.some(x=>x.text==='SUP New project idea');`),'project idea saved');
  if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.tasks().length===__supTaskCount&&p.projectIntentLists(app.vault.getAbstractFileByPath(__supPaths.project))[0]&&p.everything()===false;`))throw Error('idea leaked to tasks or changed All');
  // The same project can have a Focus row and an area-backlog alias. Ideas belong to one slot.
  await click(`(${project}).querySelector('.ft-intents-chip')`);
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  const alias=`(${area}).querySelector(':scope > .ft-future-block .ft-project-row:not(.ft-intent-list-row)')`;
  await until(()=>page.eval(`return !!(${alias});`),'project backlog alias');
  await click(`(${alias}).querySelector('.ft-intents-chip')`);
  await until(()=>page.eval(`const blocks=[...${root}.querySelectorAll('.ft-project-intents')].filter(e=>e.getAttribute('data-intent-project')===__supPaths.project);return blocks.length===1&&!!blocks[0].closest('.ft-future-block');`),'ideas appear once at the clicked backlog alias');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`const blocks=[...${root}.querySelectorAll('.ft-project-intents')].filter(e=>e.getAttribute('data-intent-project')===__supPaths.project);return blocks.length===1&&!blocks[0].closest('.ft-future-block');`),'closing parent backlog keeps ideas in the remaining project row');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-intents-chip')`);
  await until(()=>page.eval(`return !${root}.querySelector('.ft-project-intents')&&!!(${area}).querySelector(':scope > .ft-intents');`),'area ideas replace its separately open project ideas');
  await click(`(${project}).querySelector('.ft-intents-chip')`);
  await until(()=>page.eval(`return !(${area}).querySelector(':scope > .ft-intents')&&!!${root}.querySelector('.ft-project-intents');`),'project ideas replace the parent area collection');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];const file=await p.createProject({name:'Supplements UI',note:app.vault.getAbstractFileByPath(__supPaths.area)},'SUP Empty',null,null,true);__supPaths.empty=file.path;p.refresh();return true;`);
  const emptyProject=`[...${root}.querySelectorAll('li.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='SUP Empty')`;
  await until(()=>page.eval(`return !!(${emptyProject});`),'empty project visible');
  if(!await page.eval(`return (${emptyProject}).querySelector('.ft-supplement-switch').children.length===1;`))throw Error('empty backlog must not expose a dead clock segment');
  await click(`(${emptyProject}).querySelector('.ft-intents-chip')`);
  await until(()=>page.eval(`return !!${root}.querySelector('.ft-project-intents[data-intent-project="'+__supPaths.empty+'"]');`),'empty project ideas opened');
  if(!await page.eval(`return app.plugins.plugins['focus-tasks'].projectIntentLists(app.vault.getAbstractFileByPath(__supPaths.empty)).length===0;`))throw Error('opening empty ideas created notes');
  await click(`${root}.querySelector('.ft-project-intents[data-intent-project="'+__supPaths.empty+'"] .ft-empty-add')`);
  await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'first idea lazily creates collection and editor');
  await page.type('SUP First empty project idea');await page.key('Enter');await page.key('Escape');
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.projectIntentLists(app.vault.getAbstractFileByPath(__supPaths.empty)).length===1&&p.read().intentTasks.some(x=>x.text==='SUP First empty project idea');`),'first idea belongs to its project');
  for(const width of mobile?[320,390,430]:[620,1000]){
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:viewport.height,deviceScaleFactor:mobile?2:1,mobile});
    for(const font of [18,26]){await page.eval(`document.body.style.setProperty('--font-text-size','${font}px');document.body.style.setProperty('--font-ui-medium','${font}px');return true;`);await sleep(400);await geometry('pane '+width+'px/'+font+'px');if(width===(mobile?390:1000)&&font===18)await page.shot(new URL('./shots/supplements-'+(mobile?'phone':'desktop')+'.png',import.meta.url).pathname);}
  }
  for(const [path,selector] of [['project','.ft-page'],['area','.ft-area-page']]){
    await page.eval(`const f=app.vault.getAbstractFileByPath(__supPaths[${J(path)}]);if(!f)throw Error('missing scoped note '+${J(path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(f,{state:{mode:'preview'}});return true;`);
    await until(()=>page.eval(`return !!${root}.querySelector(${J(selector+' .ft-supplement-switch')});`),'scoped supplement component');
    const n=await page.eval(`return ${root}.querySelector(${J(selector+' .ft-supplement-switch')}).children.length;`);
    if(n!==(selector==='.ft-page'?2:1))throw Error('wrong scoped segment count');
    await geometry(selector);
  }
  await page.eval(`document.body.style.removeProperty('--font-text-size');document.body.style.removeProperty('--font-ui-medium');const p=app.plugins.plugins['focus-tasks'];const area=(await p.collect(true)).find(x=>x.name==='Supplements UI');await p.removeArea(area);await app.commands.executeCommandById('focus-tasks:open');delete window.__supTaskCount;delete window.__supPaths;return true;`);
  await page.send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:mobile?2:1,mobile});await sleep(300);
}

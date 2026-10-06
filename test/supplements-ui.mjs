import { J, sleep, until } from './cdp.mjs';

export async function checkSupplementsUI(page, mobile=false) {
  const root="(window.__supScoped ? app.workspace.activeLeaf.view.containerEl : app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl)";
  const area=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Supplements UI')`;
  const project=`[...${root}.querySelectorAll('li.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.getBoundingClientRect().width>0&&e.querySelector('.ft-project-name .ft-link')?.textContent==='SUP Project')`;
  const click=async expr=>{
    await page.front();await page.eval(`if(!window.__supScoped)await app.plugins.plugins['focus-tasks'].openView();const e=${expr};e?.scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(180);
    if(!mobile){const r=await page.eval(`const r=(${expr})?.getBoundingClientRect();return r&&{x:r.left+r.width/2,y:r.top+r.height/2};`);if(r)await page.mouse('mouseMoved',r.x,r.y,0);}
    const at=await until(()=>page.eval(`const e=${expr};if(!e)return false;const r=e.getBoundingClientRect(),at={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(at.x,at.y);return r.width&&r.height&&hit&&e.contains(hit)?at:false;`),'supplement control: '+expr);
    if(mobile)await page.tap(at);else await page.click(at);await sleep(120);
    const active=await page.eval(`return {type:app.workspace.activeLeaf.view.getViewType(),scoped:!!window.__supScoped};`);if(active.type!=='focus-tasks-view'&&!active.scoped)throw Error('supplement click switched away from Focus: '+expr+' -> '+active.type);
  };
  const cleanRows=async label=>{
    const issues=await page.eval(`const root=${root},issues=[];for(const body of root.querySelectorAll('li.ft-steps')){if(body.getBoundingClientRect().width&&!body.querySelector('li.ft-task'))issues.push('empty expanded steps');}
      for(const row of root.querySelectorAll('li.ft-project-row')){if(!row.getBoundingClientRect().width)continue;const body=row.nextElementSibling?.matches('.ft-steps')?row.nextElementSibling:null;if(row.querySelector(':scope > .ft-fold')&&!body?.querySelector('li.ft-task'))issues.push('fold arrow without steps');if(row.querySelector('.ft-steps-more')&&!row.querySelector('.ft-text:not(.ft-no-step)')&&!body?.querySelector('li.ft-task'))issues.push('extra step arrow without content');}return issues;`);
    if(issues.length)throw Error(label+': '+issues.join('; '));
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
  await page.eval(`if(!['focus-tasks-e2e','focus-tasks-mobile'].includes(app.vault.getName()))throw Error('test vault guard');window.__supScoped=false;const p=app.plugins.plugins['focus-tasks'];const file=await p.createArea('Supplements UI');const area={name:'Supplements UI',note:file};const pf=await p.createProject(area,'SUP Project');window.__supPaths={project:pf.path,area:file.path};
    await p.frontOwned(pf,fm=>fm.uid='ui-supplement-project');
    await p.createTask('SUP Focus',{area:area.name,project:pf.basename,projectFile:pf},moment().format('YYYY-MM-DD'));
    await p.createTask('SUP Project later',{area:area.name,project:pf.basename,projectFile:pf},moment().add(1,'day').format('YYYY-MM-DD'));
    await p.createTask('SUP Area focus',{area:area.name,project:null},moment().format('YYYY-MM-DD'));
    await p.createTask('SUP Area later',{area:area.name,project:null},moment().add(1,'day').format('YYYY-MM-DD'));
    const pending=await p.createTask('SUP Pending',{area:area.name,project:pf.basename,projectFile:pf},moment().add(2,'day').format('YYYY-MM-DD'));await p.setWaiting(pending,true);
    const list=await p.createIntentList('SUP Independent',area.name);await p.createTask('SUP Area idea',{area:area.name,project:list.file.basename,projectFile:list.file,intentList:true,listUid:list.uid},null);
    const linked=await p.createIntentList('SUP Bound',area.name);await p.frontOwned(linked.file,fm=>{fm.intentProjectUid='ui-supplement-project';fm.intentProject='[['+pf.path.replace(/\\.md$/,'')+']]';});
    await p.createTask('SUP Project idea',{area:area.name,project:linked.file.basename,projectFile:linked.file,intentList:true,listUid:linked.uid},null);
    p.forgetScan();window.__supTaskCount=p.tasks().length;p.setEverything(false);delete p.data.folded['area:'+area.name];delete p.data.opened['intents:'+area.name];delete p.data.opened['project-intents:'+pf.path];p.saveFolds();const leaf=await p.openView();await leaf.view.renderer.rerendered();return true;`);
  await until(()=>page.eval(`return !!(${area});`),'supplement fixture visible');
  if(!await page.eval(`return (${area}).querySelector(':scope > .ft-area-title .ft-supplement-switch')?.children.length===3;`))throw Error('area needs one three-category component');
  if(!await page.eval(`return (${project}).querySelector('.ft-supplement-switch')?.children.length===3;`))throw Error('project needs the same three-category component');
  if(!await page.eval(`return [(${area}).querySelector(':scope > .ft-area-title .ft-intents-chip svg'),(${project}).querySelector('.ft-intents-chip svg')].every(svg=>svg?.classList.contains('lucide-lightbulb'));`))throw Error('Ideas must use the chosen lightbulb icon in area and project controls');
  if(await page.eval(`return !!${root}.querySelector('.ft-foot .ft-intents-chip,.ft-foot .ft-intents-toggle');`))throw Error('global Ideas entry must not be added');
  await until(()=>page.eval(`return JSON.stringify([...(${area}).querySelectorAll(':scope > .ft-area-title .ft-supplement-count')].map(e=>Number(e.textContent)))==='[2,2,2]';`),'indexed counters after fixture writes');
  const counts=await page.eval(`return [...(${area}).querySelectorAll(':scope > .ft-area-title .ft-supplement-count')].map(e=>Number(e.textContent));`);
  if(JSON.stringify(counts)!=='[2,2,2]')throw Error('area counts are task counts, not project rows: '+JSON.stringify(counts));
  // A folded area hides every category. Its controls must reflect that, while preserving
  // the saved combination; clicking any dim control reveals it instead of toggling it off.
  for(const kind of ['later','intents'])await click(`(${area}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`);
  for(const kind of ['focus','later','intents']){
    await click(`(${area}).querySelector(':scope > .ft-area-title > .ft-caret')`);
    await until(()=>page.eval(`return !(${area}).querySelector(':scope > .ft-list,:scope > .ft-future-block,:scope > .ft-intents');`),'area folded before category reveal');
    if(!await page.eval(`const a=${area},buttons=[...a.querySelectorAll(':scope > .ft-area-title .ft-supplement-switch button')];return buttons.every(b=>b.getAttribute('aria-pressed')==='false'&&Number(getComputedStyle(b).opacity)===0.45)&&JSON.stringify(buttons.map(b=>Number(b.querySelector('.ft-supplement-count').textContent)))==='[2,2,2]';`))throw Error('folded area categories remain highlighted although their tasks are hidden');
    await click(`(${area}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`);
    await until(()=>page.eval(`const a=${area};return [...a.querySelectorAll(':scope > .ft-area-title .ft-supplement-switch button')].every(b=>b.getAttribute('aria-pressed')==='true')&&[...a.querySelectorAll('.ft-text')].some(e=>e.textContent==='SUP Area later')&&!!a.querySelector(':scope > .ft-intents');`),'dim category opens area and preserves the saved combination: '+kind);
  }
  // Other areas inherit an open backlog from All, including empty scopes. The folded
  // header must still stay dim, and its clock must open the area on the first click.
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.createArea('SUP Zero');p.setEverything(true);p.refresh();return true;`);
  const zero=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='SUP Zero')`;
  await until(()=>page.eval(`return !!(${zero});`),'empty other area visible');
  if(!await page.eval(`return [...(${zero}).querySelectorAll(':scope > .ft-area-title .ft-supplement-switch button')].every(b=>b.getAttribute('aria-pressed')==='false'&&b.querySelector('.ft-supplement-count').textContent==='0'&&Number(getComputedStyle(b).opacity)===0.45);`))throw Error('empty folded area has misleading highlighted counters');
  await click(`(${zero}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !!(${zero}).querySelector('.ft-empty-add')&&(${zero}).querySelector('.ft-later-chip').getAttribute('aria-pressed')==='true';`),'empty inherited backlog opens on the first click');
  await click(`(${zero}).querySelector(':scope > .ft-area-title > .ft-caret')`);
  await click(`(${zero}).querySelector(':scope > .ft-area-title .ft-intents-chip')`);
  await until(()=>page.eval(`return !!(${zero}).querySelector(':scope > .ft-intents')&&(${zero}).querySelector('.ft-later-chip').getAttribute('aria-pressed')==='true';`),'empty ideas reveal keeps the inherited backlog');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];if(p.read().intents.some(x=>x.area==='SUP Zero')||p.tasks().some(x=>x.area==='SUP Zero'))throw Error('empty category reveal wrote tasks/lists');await p.removeArea((await p.collect(true)).find(a=>a.name==='SUP Zero'));p.setEverything(false);p.refresh();return true;`);
  await until(()=>page.eval(`return !(${zero})&&!!(${area});`),'empty area fixture removed');
  for(let mask=0;mask<8;mask++){
    for(const [kind,on] of [['focus',!!(mask&1)],['later',!!(mask&2)],['intents',!!(mask&4)]]){
      const expr=`(${area}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`;
      if(await page.eval(`return (${expr}).getAttribute('aria-pressed')==='true';`)!==on)await click(expr);
    }
    await until(()=>page.eval(`const a=${area},text=[...a.querySelectorAll('.ft-text')].map(e=>e.textContent);return text.includes('SUP Area focus')===${!!(mask&1)}&&text.includes('SUP Area later')===${!!(mask&2)}&&!!a.querySelector(':scope > .ft-intents')===${!!(mask&4)};`),'independent category combination '+mask);
    if(!await page.eval(`return !!(${project})===${!!(mask&3)};`))throw Error('hidden focus retained an empty project header: '+mask);
    await cleanRows('area category combination '+mask);
    if(!await page.eval(`const a=${area},g=a.querySelector(':scope > .ft-area-title .ft-supplement-switch'),buttons=[...g.children];return JSON.stringify(buttons.map(e=>Number(e.querySelector('.ft-supplement-count').textContent)))==='[2,2,2]'&&buttons.every(e=>{const c=getComputedStyle(e);return !!e.querySelector('svg')&&e.getBoundingClientRect().width>0&&c.backgroundColor==='rgba(0, 0, 0, 0)'&&c.borderTopWidth==='0px'&&!c.textDecorationLine.includes('underline')&&Number(c.opacity)===(e.getAttribute('aria-pressed')==='true'?1:0.45);})&&!a.querySelector('.ft-intents-head');`))throw Error('category numbers, plain icons/style or visibility changed');
  }
  // Exercise the project's own controls through real clicks. Restoring the area's Focus
  // restores its hidden projects; a project with all categories off leaves no empty header.
  for(let mask=0;mask<8;mask++){
    for(const kind of ['focus','later','intents']){
      const b=`(${area}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`;
      if(await page.eval(`return (${b}).getAttribute('aria-pressed')==='true';`))await click(b);
      if(kind==='focus')await click(b);
    }
    await until(()=>page.eval(`return !!(${project});`),'project restored by area Focus');
    for(const [kind,on] of [['intents',!!(mask&4)],['later',!!(mask&2)],['focus',!!(mask&1)]]){
      const b=`(${project}).querySelector('.ft-${kind}-chip')`;
      if(await page.eval(`return (${b}).getAttribute('aria-pressed')==='true';`)!==on)await click(b);
    }
    await until(()=>page.eval(`const a=${area},text=[...a.querySelectorAll('.ft-text')].map(e=>e.textContent);return !!(${project})===${!!mask}&&text.includes('SUP Focus')===${!!(mask&1)}&&text.includes('SUP Project later')===${!!(mask&2)}&&!!a.querySelector('.ft-project-intents')===${!!(mask&4)};`),'project category combination '+mask);
    await cleanRows('project category combination '+mask);
    if(mask===4&&!await page.eval(`return !(${project}).querySelector('.ft-fold,.ft-steps-more,.ft-no-step,input.task-list-item-checkbox');`))throw Error('ideas-only project exposes empty fold/completion controls');
  }
  // Return to the normal Focus-only combination before the interaction regression scenarios.
  for(const [kind,on] of [['focus',true],['later',false],['intents',false]]){
    const expr=`(${area}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`;
    // Apply the parent state even if its icon already matches; child overrides may differ.
    if(await page.eval(`return (${expr}).getAttribute('aria-pressed')==='true';`)===on)await click(expr);
    await click(expr);
  }
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-intents-chip')`);
  await until(()=>page.eval(`return (${area}).querySelectorAll('.ft-intent-list-row').length===2;`),'area shows independent and project collections');
  if(!await page.eval(`return [...(${area}).querySelectorAll('.ft-intent-list-row .ft-link')].some(e=>e.textContent.startsWith('SUP Project'));`))throw Error('project collection needs its project name');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !!(${area}).querySelector(':scope > .ft-intents')&&!!(${area}).querySelector(':scope > .ft-future-block:not(.ft-intents)');`),'backlog and area ideas open together');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !(${area}).querySelector(':scope > .ft-future-block:not(.ft-intents)')&&!!(${area}).querySelector(':scope > .ft-intents');`),'backlog collapses independently of ideas');
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
  // Opening the parent backlog keeps one project header and one copy of each task.
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return [...(${area}).querySelectorAll('.ft-text')].filter(e=>e.textContent==='SUP Project later').length===1;`),'project backlog appears exactly once');
  if(!await page.eval(`return [...(${area}).querySelectorAll('.ft-project-row:not(.ft-intent-list-row) .ft-project-name .ft-link')].filter(e=>e.textContent==='SUP Project').length===1;`))throw Error('project header duplicated between categories');
  if(!await page.eval(`return !!${root}.querySelector('.ft-project-intents');`))throw Error('opening backlog hid project ideas');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !!${root}.querySelector('.ft-project-intents')&&![...(${area}).querySelectorAll('.ft-text')].some(e=>e.textContent==='SUP Project later');`),'closing backlog preserves project ideas');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-intents-chip')`);
  await until(()=>page.eval(`return !${root}.querySelector('.ft-project-intents')&&!!(${area}).querySelector(':scope > .ft-intents');`),'area ideas replace its separately open project ideas');
  await click(`(${project}).querySelector('.ft-intents-chip')`);
  await until(()=>page.eval(`return !(${area}).querySelector(':scope > .ft-intents')&&!!${root}.querySelector('.ft-project-intents');`),'project ideas replace the parent area collection');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];const file=await p.createProject({name:'Supplements UI',note:app.vault.getAbstractFileByPath(__supPaths.area)},'SUP Empty',null,null,true);__supPaths.empty=file.path;p.refresh();return true;`);
  const emptyProject=`[...${root}.querySelectorAll('li.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='SUP Empty')`;
  await until(()=>page.eval(`return !!(${emptyProject});`),'empty project visible');
  if(!await page.eval(`return (${emptyProject}).querySelector('.ft-supplement-switch').children.length===3;`))throw Error('all categories, including zero, must stay accessible');
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
    await page.eval(`window.__supScoped=true;const f=app.vault.getAbstractFileByPath(__supPaths[${J(path)}]);if(!f)throw Error('missing scoped note '+${J(path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(f,{state:{mode:'preview'}});return true;`);
    await until(()=>page.eval(`return !!${root}.querySelector(${J(selector+' .ft-supplement-switch')});`),'scoped supplement component');
    const n=await page.eval(`return ${root}.querySelector(${J(selector+' .ft-supplement-switch')}).children.length;`);
    if(n!==3)throw Error('wrong scoped segment count');
    await geometry(selector);
    if(path==='area'){
      const ideas=`[...${root}.querySelectorAll('${selector} > .ft-area-title .ft-intents-chip')].find(e=>e.getBoundingClientRect().width>0)`;
      if(!await page.eval(`return (${ideas}).getAttribute('aria-pressed')==='true';`))await click(ideas);
      await click(ideas); // close the parent and clear independently opened project collections
    }
    for(let mask=0;mask<8;mask++){
      for(const [kind,on] of [['focus',!!(mask&1)],['later',!!(mask&2)],['intents',!!(mask&4)]]){
        const b=`[...${root}.querySelectorAll('${selector} > .ft-area-title .ft-${kind}-chip')].find(e=>e.getBoundingClientRect().width>0)`;
        if(await page.eval(`return (${b}).getAttribute('aria-pressed')==='true';`)!==on)await click(b);
      }
      await until(()=>page.eval(`const block=[...${root}.querySelectorAll('${selector}')].find(e=>e.getBoundingClientRect().width>0),text=[...block.querySelectorAll('.ft-text')].map(e=>e.textContent);return text.includes('SUP Focus')===${!!(mask&1)}&&text.includes('SUP Project later')===${!!(mask&2)}&&!!block.querySelector('${path==='area'?'.ft-intents':'.ft-project-intents'}')===${!!(mask&4)};`),'scoped '+path+' combination '+mask);
      if(path==='area'&&!await page.eval(`return !!(${project})===${!!(mask&3)};`))throw Error('scoped area retained a hidden project: '+mask);
      await cleanRows('scoped '+path+' combination '+mask);
    }
    if(await page.eval(`return [...${root}.querySelectorAll('${selector} .ft-text')].some(e=>e.textContent==='SUP Pending');`))throw Error('pending Waiting leaked into a category');
    const waiting=`[...${root}.querySelectorAll('${selector} .ft-page-waiting')].find(e=>e.getBoundingClientRect().width>0)`;
    await click(waiting);
    await until(()=>page.eval(`return [...${root}.querySelectorAll('${selector} .ft-waiting .ft-text')].some(e=>e.textContent==='SUP Pending');`),'Waiting has its own scoped shelf');
    const f=`[...${root}.querySelectorAll('${selector} .ft-focus-chip')].find(e=>e.getBoundingClientRect().width>0)`;
    await click(f);
    await until(()=>page.eval(`return ![...${root}.querySelectorAll('${selector} .ft-text')].some(e=>e.textContent==='SUP Area focus'||e.textContent==='SUP Focus');`),'scoped focus can be hidden');
    const clock=`[...${root}.querySelectorAll('${selector} .ft-later-chip')].find(e=>e.getBoundingClientRect().width>0)`;
    if(await page.eval(`return (${clock}).getAttribute('aria-pressed')==='true';`))await click(clock);
    const plus=`[...${root}.querySelectorAll('${selector} > .ft-area-title > .ft-plus')].find(e=>e.getBoundingClientRect().width>0)`;
    await click(plus);
    await until(()=>page.eval(`return !!${root}.querySelector('[contenteditable=true]');`),'add while categories are hidden');
    const title='SUP '+path+' hidden addition';await page.type(title);await page.key('Enter');await page.key('Escape');
    await until(()=>page.eval(`return [...${root}.querySelectorAll('${selector} .ft-future-block .ft-text')].some(e=>e.textContent===${J(title)});`),'new undated task stays visible in its category');
    if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],task=p.tasks().find(t=>t.text===${J(title)});return task&&!task.date&&(${clock}).getAttribute('aria-pressed')==='true'&&(${f}).getAttribute('aria-pressed')==='false';`))throw Error('addition silently changed date or reopened the wrong category');
    await click(f);
  }
  await page.eval(`window.__supScoped=false;const p=app.plugins.plugins['focus-tasks'];await p.openView();p.data.opened['focusoff:Supplements UI']=true;p.data.opened['project-focusoff:'+__supPaths.project]=true;delete p.data.opened['project-focuson:'+__supPaths.project];p.saveFolds();p.refresh();return true;`);
  await sleep(250);
  if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],task=p.tasks().find(t=>t.text==='SUP Focus');return await p.openTask(task.uid);`))throw Error('UID link failed to restore a hidden Focus category');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-focus-chip')`);
  if(!await page.eval(`return app.workspace.activeLeaf.view.renderer.selected.size===0;`))throw Error('hiding a category left invisible task selection active');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];delete p.data.opened['future:Supplements UI'];delete p.data.opened['later:'+__supPaths.project];p.data.opened['pagefold:'+__supPaths.project]=true;p.saveFolds();p.refresh();return true;`);
  await sleep(250);
  if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'],task=p.tasks().find(t=>t.text==='SUP Project later');return await p.openTask(task.uid);`))throw Error('UID link failed to restore a hidden Backlog category');
  await page.eval(`document.body.style.removeProperty('--font-text-size');document.body.style.removeProperty('--font-ui-medium');const p=app.plugins.plugins['focus-tasks'];const area=(await p.collect(true)).find(x=>x.name==='Supplements UI');await p.removeArea(area);await app.commands.executeCommandById('focus-tasks:open');delete window.__supTaskCount;delete window.__supPaths;delete window.__supScoped;return true;`);
  await page.send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:mobile?2:1,mobile});await sleep(300);
}

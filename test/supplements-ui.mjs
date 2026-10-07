import { J, sleep, until } from './cdp.mjs';

export async function checkSupplementsUI(page, mobile=false) {
  const root="(window.__supScoped ? app.workspace.activeLeaf.view.containerEl : app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl)";
  const area=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Supplements UI')`;
  const project=`[...${root}.querySelectorAll('li.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.getBoundingClientRect().width>0&&e.querySelector('.ft-project-name .ft-link')?.textContent==='SUP Project')`;
  const hover=async expr=>{
    await page.front();
    if(mobile&&await page.eval(`const picker=(${expr})?.closest('.ft-category-picker');return !!picker&&!picker.classList.contains('is-open')&&!!document.querySelector('.ft-category-picker.is-open');`)){await page.tap({x:8,y:400});await sleep(100);}
    const at=await page.eval(`if(!window.__supScoped)await app.plugins.plugins['focus-tasks'].openView();const e=${expr},h=e?.closest('.ft-category-host')||e;h?.scrollIntoView({block:'center',behavior:'instant'});const picker=e?.closest('.ft-category-picker'),summary=picker?.querySelector(':scope > .ft-category-total,:scope > .ft-steps-more');const target=picker?.classList.contains("is-open")?picker.querySelector(":scope > .ft-supplement-switch"):(summary||(e?.getBoundingClientRect().width?e:h));const r=target?.getBoundingClientRect();return r&&{x:r.left+r.width/2,y:r.top+r.height/2,needsTap:!!summary&&!picker.classList.contains('is-open')};`);
    if(mobile&&at?.needsTap)await page.tap(at);else if(!mobile&&at)await page.mouse('mouseMoved',at.x,at.y,0);
    await sleep(180);
    if(await page.eval(`return !!(${expr})?.closest('.ft-category-picker');`))await until(async()=>{
      const live=await page.eval(`const p=(${expr})?.closest('.ft-category-picker');if(p?.classList.contains('is-open')&&(${mobile}||p.matches(':hover')))return {open:true};const summary=p?.querySelector(':scope > .ft-category-total,:scope > .ft-steps-more'),target=p?.classList.contains('is-open')?p.querySelector(':scope > .ft-supplement-switch'):summary;target?.scrollIntoView({block:'center',behavior:'instant'});const r=target?.getBoundingClientRect();return r?.width&&r.top>=0&&r.bottom<=innerHeight?{x:r.left+r.width/2,y:r.top+r.height/2,reenter:target.matches(':hover')}:false;`);
      if(live?.open)return true;if(live){if(mobile)await page.tap(live);else {if(live.reenter)await page.mouse('mouseMoved',1,1,0);await page.mouse('mouseMoved',live.x,live.y,0);}await sleep(80);}return false;
    },'real pointer opens count popup '+expr);
  };
  const click=async(expr,withRedraw=false)=>{
    if(await page.eval(`return !(${expr})?.closest('.ft-category-picker')&&!!document.querySelector('.ft-category-picker.is-open');`)){
      const point=await page.eval(`const r=${root}.getBoundingClientRect();return {x:r.left+2,y:r.top+2};`);if(mobile)await page.tap(point);else await page.click(point);await sleep(100);
    }
    await hover(expr);
    const locate=()=>page.eval(`const e=${expr};if(!e)return false;const r=e.getBoundingClientRect(),at={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(at.x,at.y);return r.width&&r.height&&hit&&e.contains(hit)?at:false;`);
    let at=await until(locate,'supplement control: '+expr);
    if(!mobile){
      // Moving from the header to its controls can wrap a narrow header. Hit the
      // settled button, as a real pointer does, rather than its previous rectangle.
      for(let n=0;n<4;n++){await page.mouse('mouseMoved',at.x,at.y,0);await sleep(80);const next=await until(locate,'settled supplement control '+expr).catch(async err=>{const info=await page.eval(`const e=${expr},g=e?.closest('.ft-supplement-switch'),picker=e?.closest('.ft-category-picker');return {button:e?.getBoundingClientRect().toJSON(),popup:g?.getBoundingClientRect().toJSON(),open:picker?.className,active:document.activeElement?.outerHTML.slice(0,120),hit:document.elementFromPoint(${at.x},${at.y})?.outerHTML.slice(0,180)};`);throw Error(err.message+' '+J(info));});if(Math.abs(next.x-at.x)<1&&Math.abs(next.y-at.y)<1){at=next;break;}at=next;}
    }
    const category=await page.eval(`const b=${expr};return b?.dataset.ftCategory?{key:b.parentElement.dataset.ftCategoryKey,kind:b.dataset.ftCategory}:null;`);
    if(category)await page.eval(`window.__supClicks=[];if(!window.__supClickProbe){window.__supClickProbe=e=>{const b=e.target.closest?.('button'),r=b?.getBoundingClientRect();__supClicks.push({type:e.type,key:b?.parentElement.dataset.ftCategoryKey,kind:b?.dataset.ftCategory,x:e.clientX,y:e.clientY,rect:r&&{x:r.x,y:r.y,w:r.width,h:r.height},tag:e.target.tagName});};for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,__supClickProbe,true);}return true;`);
    if(withRedraw&&!mobile){
      await page.eval(`window.__supPressed=${expr};return true;`);
      await page.mouse('mousePressed',at.x,at.y,1);
      await page.eval(`app.plugins.plugins['focus-tasks'].refresh();return true;`);await sleep(400);
      if(!await page.eval(`return __supPressed===${expr}&&__supPressed.isConnected;`))throw Error('metadata redraw replaced the pressed category before release');
      await page.mouse('mouseReleased',at.x,at.y,0);await sleep(150);
    }else if(mobile)await page.tap(at);else await page.click(at);await sleep(120);
    if(category){const seen=await page.eval('return __supClicks;');if(!seen.some(e=>e.type==='click'&&e.key===category.key&&e.kind===category.kind))throw Error('native category click missed '+JSON.stringify({category,at,seen}));}
    const active=await page.eval(`return {type:app.workspace.activeLeaf.view.getViewType(),scoped:!!window.__supScoped};`);if(active.type!=='focus-tasks-view'&&!active.scoped)throw Error('supplement click switched away from Focus: '+expr+' -> '+active.type);
  };
  const cleanRows=async label=>{
    const issues=await page.eval(`const root=${root},issues=[];for(const body of root.querySelectorAll('li.ft-steps')){if(body.getBoundingClientRect().width&&!body.querySelector('li.ft-task'))issues.push('empty expanded steps');}
      for(const row of root.querySelectorAll('li.ft-project-row')){if(!row.getBoundingClientRect().width)continue;const body=row.nextElementSibling?.matches('.ft-steps')?row.nextElementSibling:null;if(row.querySelector(':scope > .ft-fold')&&!body?.querySelector('li.ft-task'))issues.push('fold arrow without steps');const more=row.querySelector('.ft-steps-more');if(more?.hasAttribute('data-ft-fold')&&!row.querySelector('.ft-text:not(.ft-no-step)')&&!body?.querySelector('li.ft-task'))issues.push('extra step control without content');if(more?.hasAttribute('data-ft-fold')&&(more.querySelector('svg')||!/^[-−+][1-9][0-9]*$/.test(more.textContent)))issues.push('project expansion must show +N or minus N');}return issues;`);
    if(issues.length)throw Error(label+': '+issues.join('; '));
  };
  const visibility=async(expr,role,label,hasFocus=true)=>{
    await page.front();
    await page.eval(`const g=${expr};(g.closest('.ft-category-host')||g).scrollIntoView({block:'center',behavior:'instant'});document.activeElement?.blur();return true;`);
    const inspect=async(revealed)=>{
      const issues=await page.eval(`const g=${expr},picker=g.closest('.ft-category-picker'),issues=[];
        if(!g.classList.contains('ft-supplement-${role}'))issues.push('wrong scope role');
        const buttons=[...g.querySelectorAll('button[data-ft-category]')];
        if(${role==='backlog-area'}&&g.querySelector('.ft-focus-chip'))issues.push('impossible Focus control');
        if(${role==='project'}&&buttons.some(b=>b.querySelector('.ft-supplement-count').textContent==='0'))issues.push('empty project category');
        for(const b of buttons){const r=b.getBoundingClientRect(),expected=b.getAttribute('aria-pressed')==='true'?1:0.45;
          if(${revealed}?(r.width<=0||r.height<=0||Number(getComputedStyle(b).opacity)!==expected):(r.width||r.height))issues.push('inline visibility '+b.className+' revealed='+${revealed}+' rect='+r.width+'x'+r.height+' opacity='+getComputedStyle(b).opacity+' open='+picker.className);}
        if(${revealed})for(const b of buttons){const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!hit||!b.contains(hit))issues.push('category clipped or covered '+b.className);}
        const summary=picker.querySelector(':scope > .ft-category-total,:scope > .ft-steps-more'),r=summary.getBoundingClientRect();if(!r.width)issues.push('missing single counter');
        if(!${revealed}){const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!hit||!summary.contains(hit))issues.push('counter clipped or covered by another row');}
        if(${revealed}){const box=g.getBoundingClientRect();if(box.left<0||box.right>innerWidth+1||box.top<0||box.bottom>innerHeight+1)issues.push('popup overflow');}
        const host=picker.closest('li.ft-task,.ft-mobile-project-caption,.ft-area-title'),box=g.getBoundingClientRect();
        if(!${revealed})picker.__inlineBefore={height:host?.getBoundingClientRect().height,left:summary?.getBoundingClientRect().left};
        else {const style=getComputedStyle(g);if(style.position!=='static'||style.boxShadow!=='none'||style.backgroundColor!=='rgba(0, 0, 0, 0)')issues.push('categories must replace the count inline, without a popup');
          if(Number(getComputedStyle(summary).opacity)!==0||getComputedStyle(summary).position!=='absolute')issues.push('old counter retains a visible flow slot');
          if(picker.__inlineBefore&&Math.abs(host.getBoundingClientRect().height-picker.__inlineBefore.height)>0.5)issues.push('inline categories change row height');
          if(${role!=='project'}&&picker.__inlineBefore&&(box.left>picker.__inlineBefore.left+2||box.right<picker.__inlineBefore.left-2))issues.push('categories do not replace the area count at its position');}
        return issues;`);
      if(issues.length)throw Error(label+': '+issues.join('; '));
    };
    await page.eval(`document.activeElement?.blur();const picker=(${expr}).closest('.ft-category-picker'),p=app.plugins.plugins['focus-tasks'],v=[...p.views].find(v=>v.containerEl.contains(picker));v?.closeCategoryPicker?.();return true;`);
    await page.mouse('mouseMoved',1,1,0);await sleep(240);await inspect(false);
    await hover(expr);await inspect(true);
    if(!mobile){await page.eval(`(${expr}).querySelector('button[data-ft-category]')?.focus();return true;`);await inspect(true);}
  };
  const geometry=async label=>{
    const result=await page.eval(`const root=${root},issues=[];
      for(const h of root.querySelectorAll('.ft-area-title,li.ft-task,.ft-mobile-project-caption')){if(!h.getBoundingClientRect().width)continue;
        for(const e of h.children){const c=getComputedStyle(e);if(['absolute','fixed'].includes(c.position))continue;
          if(c.display==='none'||c.visibility==='hidden'||Number(c.opacity)===0){const r=e.getBoundingClientRect();if(r.width||r.height)issues.push('hidden flow rectangle '+e.className);}}}
      const groups=[...root.querySelectorAll('.ft-supplement-switch')].filter(e=>e.parentElement.getBoundingClientRect().width);if(!groups.length)issues.push('missing component');
      for(const g of groups){const r=g.getBoundingClientRect(),buttons=[...g.children].filter(b=>b.getBoundingClientRect().width);if(r.left<0||r.right>innerWidth+1)issues.push('group outside screen');
        for(let i=0;i<buttons.length;i++){const b=buttons[i].getBoundingClientRect();if(b.width<${mobile?44:25}||b.height<${mobile?44:24})issues.push('small target');if(b.left<r.left-1||b.right>r.right+1)issues.push('button outside group');if(i){const prev=buttons[i-1].getBoundingClientRect();if(Math.min(b.right,prev.right)-Math.max(b.left,prev.left)>0.5&&Math.min(b.bottom,prev.bottom)-Math.max(b.top,prev.top)>0.5)issues.push('overlapping segments');}}
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
  await until(()=>page.eval(`return (${project}).querySelector('.ft-supplement-switch')?.querySelectorAll(':scope > button[data-ft-category]').length===3;`),'project metadata exposes all three categories');
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
    if(!await page.eval(`const a=${area},buttons=[...a.querySelectorAll(':scope > .ft-area-title .ft-supplement-switch button')];return buttons.every(b=>b.getAttribute('aria-pressed')==='false')&&JSON.stringify(buttons.map(b=>Number(b.querySelector('.ft-supplement-count').textContent)))==='[2,2,2]';`))throw Error('folded area categories remain highlighted although their tasks are hidden');
    await visibility(`(${area}).querySelector(':scope > .ft-area-title .ft-supplement-switch')`,'focus-area','folded area '+kind);
    await click(`(${area}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`);
    await until(()=>page.eval(`const a=${area};return [...a.querySelectorAll(':scope > .ft-area-title .ft-supplement-switch button')].every(b=>b.getAttribute('aria-pressed')==='true')&&[...a.querySelectorAll('.ft-text')].some(e=>e.textContent==='SUP Area later')&&!!a.querySelector(':scope > .ft-intents');`),'dim category opens area and preserves the saved combination: '+kind);
  }
  // Other areas inherit an open backlog from All, including empty scopes. The folded
  // header must still stay dim, and its clock must open the area on the first click.
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.createArea('SUP Zero');p.setEverything(true);p.refresh();return true;`);
  const zero=`[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='SUP Zero')`;
  await until(()=>page.eval(`return !!(${zero});`),'empty other area visible');
  if(!await page.eval(`return !(${zero}).querySelector('.ft-focus-chip')&&[...(${zero}).querySelectorAll(':scope > .ft-area-title .ft-supplement-switch button')].every(b=>b.getAttribute('aria-pressed')==='false'&&b.querySelector('.ft-supplement-count').textContent==='0');`))throw Error('empty folded area has misleading/impossible counters');
  await visibility(`(${zero}).querySelector(':scope > .ft-area-title .ft-supplement-switch')`,'backlog-area','empty queue area');
  await click(`(${zero}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !!(${zero}).querySelector('.ft-empty-add')&&(${zero}).querySelector('.ft-later-chip').getAttribute('aria-pressed')==='true';`),'empty inherited backlog opens on the first click');
  await click(`(${zero}).querySelector(':scope > .ft-area-title > .ft-caret')`);
  await click(`(${zero}).querySelector(':scope > .ft-area-title .ft-intents-chip')`);
  await until(()=>page.eval(`return !!(${zero}).querySelector(':scope > .ft-intents')&&(${zero}).querySelector('.ft-later-chip').getAttribute('aria-pressed')==='true';`),'empty ideas reveal keeps the inherited backlog');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'],a=(await p.collect(true)).find(a=>a.name==='SUP Zero'),f=await p.createProject(a,'SUP Later project');window.__supQueuePaths={area:a.note.path,project:f.path};await p.setProjectDate(f,'2099-01-01');await p.createTask('SUP Queue step',{area:a.name,project:f.basename,projectFile:f},'2099-01-01');const list=await p.ensureProjectIntentList(f);await p.createTask('SUP Queue idea',{area:a.name,projectFile:list.file,project:list.file.basename,intentList:true,listUid:list.uid},null);return true;`);
  const queuedProject=`[...(${zero}).querySelectorAll('li.ft-project-row:not(.ft-intent-list-row)')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent==='SUP Later project')`;
  await until(()=>page.eval(`return !!(${queuedProject})&&!(${zero}).querySelector('.ft-focus-chip');`),'queue-only project exposes no impossible Focus category');
  await visibility(`(${queuedProject}).querySelector('.ft-supplement-switch')`,'project','queue-only project hover',false);
  for(let mask=0;mask<4;mask++){
    for(const [kind,on] of [['later',!!(mask&1)],['intents',!!(mask&2)]]){
      const b=`(${zero}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`;
      if(await page.eval(`return (${b}).getAttribute('aria-pressed')==='true';`)!==on)await click(b);
    }
    await until(()=>page.eval(`const a=${zero};return !!a.querySelector(':scope > .ft-intents')===${!!(mask&2)}&&[...a.querySelectorAll('.ft-text')].some(e=>e.textContent==='SUP Queue step')===${!!(mask&1)};`),'queue area combination '+mask);
    await visibility(`(${zero}).querySelector(':scope > .ft-area-title .ft-supplement-switch')`,'backlog-area','queue area combination '+mask);
    await cleanRows('queue area combination '+mask);
  }
  // Queue-only scopes never expose a Focus button, including the note embeds.
  for(const [slot,selector,role] of [['area','.ft-area-page','backlog-area'],['project','.ft-page','project']]){
    await page.eval(`window.__supScoped=true;const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath(__supQueuePaths[${J(slot)}]),{state:{mode:'preview'}});return true;`);
    const group=`[...${root}.querySelectorAll('${selector} > .ft-area-title .ft-supplement-switch')].find(e=>e.parentElement.getBoundingClientRect().width>0)`;
    await until(()=>page.eval(`return !!(${group})&&!(${group}).querySelector('.ft-focus-chip');`),'queue-only '+slot+' note has no Focus control');
    for(let mask=0;mask<4;mask++){
      for(const [kind,on] of [['later',!!(mask&1)],['intents',!!(mask&2)]]){
        const b=`(${group}).querySelector('.ft-${kind}-chip')`;
        if(await page.eval(`return (${b}).getAttribute('aria-pressed')==='true';`)!==on)await click(b);
      }
      await until(()=>page.eval(`const block=[...${root}.querySelectorAll('${selector}')].find(e=>e.getBoundingClientRect().width>0);return [...block.querySelectorAll('.ft-text')].some(e=>e.textContent==='SUP Queue step')===${!!(mask&1)}&&!!block.querySelector('${slot==='area'?'.ft-intents':'.ft-project-intents'}')===${!!(mask&2)};`),'queue-only '+slot+' note combination '+mask);
      await visibility(group,role,'queue-only '+slot+' note combination '+mask,false);
      await cleanRows('queue-only '+slot+' note combination '+mask);
    }
  }
  await page.eval(`window.__supScoped=false;delete window.__supQueuePaths;await app.plugins.plugins['focus-tasks'].openView();return true;`);
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];if(p.read().intents.filter(x=>x.area==='SUP Zero').length!==1||p.read().intentTasks.filter(x=>x.area==='SUP Zero').length!==1||p.tasks().filter(x=>x.area==='SUP Zero').length!==1)throw Error('empty category reveal wrote tasks/lists');await p.removeArea((await p.collect(true)).find(a=>a.name==='SUP Zero'));p.setEverything(false);p.refresh();return true;`);
  await until(()=>page.eval(`return !(${zero})&&!!(${area});`),'empty area fixture removed');
  for(let mask=0;mask<8;mask++){
    for(const [kind,on] of [['focus',!!(mask&1)],['later',!!(mask&2)],['intents',!!(mask&4)]]){
      const expr=`(${area}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`;
      if(await page.eval(`return (${expr}).getAttribute('aria-pressed')==='true';`)!==on)await click(expr);
    }
    await until(()=>page.eval(`const a=${area},text=[...a.querySelectorAll('.ft-text')].map(e=>e.textContent);return text.includes('SUP Area focus')===${!!(mask&1)}&&text.includes('SUP Area later')===${!!(mask&2)}&&!!a.querySelector(':scope > .ft-intents')===${!!(mask&4)};`),'independent category combination '+mask);
    if(!await page.eval(`return !!(${project})===${!!(mask&3)};`))throw Error('hidden focus retained an empty project header: '+mask);
    await cleanRows('area category combination '+mask);
    await visibility(`(${area}).querySelector(':scope > .ft-area-title .ft-supplement-switch')`,'focus-area','area hover combination '+mask);
    if(!await page.eval(`const a=${area},g=a.querySelector(':scope > .ft-area-title .ft-supplement-switch'),buttons=[...g.querySelectorAll("button[data-ft-category]")];return JSON.stringify(buttons.map(e=>Number(e.querySelector('.ft-supplement-count').textContent)))==='[2,2,2]'&&buttons.every(e=>{const c=getComputedStyle(e);return !!e.querySelector('svg')&&c.backgroundColor==='rgba(0, 0, 0, 0)'&&c.borderTopWidth==='0px'&&!c.textDecorationLine.includes('underline');})&&!a.querySelector('.ft-intents-head');`))throw Error('category numbers, plain icons/style or visibility changed');
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
    if(mask)await visibility(`(${project}).querySelector('.ft-supplement-switch')`,'project','project hover combination '+mask);
    if(mask===4&&!await page.eval(`return !(${project}).querySelector('.ft-fold,.ft-no-step,input.task-list-item-checkbox');`))throw Error('ideas-only project exposes empty fold/completion controls');
  }
  if(!mobile){
    const blank=await page.eval(`const r=${root}.getBoundingClientRect();return {x:r.left+2,y:r.top+2};`);await page.click(blank);
    const name=await page.eval(`const e=(${project}).querySelector('.ft-project-icon'),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};`);await page.mouse('mouseMoved',name.x,name.y,0);await sleep(220);
    if(!await page.eval(`const r=${project},expand=r.querySelector('.ft-category-expand');return (!expand||!expand.getBoundingClientRect().width)&&r.querySelector('.ft-steps-more').getBoundingClientRect().width>0;`))throw Error('ordinary project hover duplicates the expansion count');
  }
  // Return to the normal Focus-only combination before the interaction regression scenarios.
  for(const [kind,on] of [['focus',true],['later',false],['intents',false]]){
    const expr=`(${area}).querySelector(':scope > .ft-area-title .ft-${kind}-chip')`;
    // Apply the parent state even if its icon already matches; child overrides may differ.
    if(await page.eval(`return (${expr}).getAttribute('aria-pressed')==='true';`)===on)await click(expr);
    await click(expr);
  }
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-intents-chip')`);
  await until(()=>page.eval(`return (${area}).querySelectorAll('.ft-intent-list-row:not(.ft-loose-ideas-row)').length===2;`),'area shows independent and project collections');
  if(!await page.eval(`return [...(${area}).querySelectorAll('.ft-intent-list-row .ft-link')].some(e=>e.textContent.startsWith('SUP Project'));`))throw Error('project collection needs its project name');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !!(${area}).querySelector(':scope > .ft-intents')&&!!(${area}).querySelector(':scope > .ft-future-block:not(.ft-intents)');`),'backlog and area ideas open together');
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(()=>page.eval(`return !(${area}).querySelector(':scope > .ft-future-block:not(.ft-intents)')&&!!(${area}).querySelector(':scope > .ft-intents');`),'backlog collapses independently of ideas');
  await hover(`(${project}).querySelector('.ft-supplement-switch')`);
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
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return !!p.classify(app.vault.getAbstractFileByPath(__supPaths.empty))?.project&&![...p.views].some(v=>v.busy);`),'empty project metadata settled');
  await sleep(450);
  if(!await page.eval(`return !(${emptyProject}).querySelector('.ft-category-picker');`))throw Error('empty project exposes a dead count popup');
  await page.eval(`(${emptyProject}).querySelector('.ft-project-name').scrollIntoView({block:'center',behavior:'instant'});return true;`);await sleep(150);
  const emptyAt=await page.eval(`const e=(${emptyProject}).querySelector('.ft-project-name'),r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};`);
  if(mobile){await page.touch('touchStart',[emptyAt]);await sleep(750);await page.touch('touchEnd',[]);}else await page.rightClick(emptyAt);
  const addIdea=`[...document.querySelectorAll('.menu-item')].find(e=>e.textContent.trim()===${J(mobile?'Добавить замысел':'Add an idea')})`;
  await until(()=>page.eval(`return !!(${addIdea});`),'empty project Add idea menu');await click(addIdea);
  await until(()=>page.eval(`return !!document.querySelector('.modal input[type=text]');`),'first project idea name');
  await page.type('SUP First empty project idea');await page.key('Enter');
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.projectIntentLists(app.vault.getAbstractFileByPath(__supPaths.empty)).length===1&&p.read().intentTasks.some(x=>x.text==='SUP First empty project idea');`),'first idea belongs to its project');
  for(const width of mobile?[320,390,430]:[620,1000]){
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:viewport.height,deviceScaleFactor:mobile?2:1,mobile});
    for(const font of [18,26]){
      await page.eval(`document.body.style.setProperty('--font-text-size','${font}px');document.body.style.setProperty('--font-ui-medium','${font}px');return true;`);await sleep(400);
      await visibility(`(${area}).querySelector(':scope > .ft-area-title .ft-supplement-switch')`,'focus-area','area width '+width+'/'+font);
      await visibility(`(${project}).querySelector('.ft-supplement-switch')`,'project','project width '+width+'/'+font);
      await geometry('pane '+width+'px/'+font+'px');
      if(!mobile&&width===620){
        for(const expr of [`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`,`(${project}).querySelector('.ft-later-chip')`]){
          await sleep(500);
          const before=await page.eval(`return (${expr}).getAttribute('aria-pressed');`);
          await click(expr,true);
          await until(()=>page.eval(`return (${expr}).getAttribute('aria-pressed')!==${J(before)};`),'narrow counter first click changes '+expr+' at '+font+'px');
          await page.eval(`const p=app.plugins.plugins['focus-tasks'];p.refresh();await Promise.all([...p.views].filter(v=>v.containerEl.querySelector('.ft-supplement-switch')).map(v=>v.rerendered()));return true;`);
          await sleep(120);
          if(!await page.eval(`return (${expr}).getBoundingClientRect().width>0;`))throw Error('a narrow hovered counter disappeared after redraw at '+font+'px');
          await click(expr);
          await until(()=>page.eval(`return (${expr}).getAttribute('aria-pressed')===${J(before)};`),'narrow counter round trip restores '+expr+' at '+font+'px');
        }
      }
      if(width===(mobile?390:1000)&&font===18)await page.shot(new URL('./shots/supplements-'+(mobile?'phone':'desktop')+'.png',import.meta.url).pathname);
    }
  }
  for(const [path,selector] of [['project','.ft-page'],['area','.ft-area-page']]){
    await page.eval(`window.__supScoped=true;const f=app.vault.getAbstractFileByPath(__supPaths[${J(path)}]);if(!f)throw Error('missing scoped note '+${J(path)});const leaf=app.workspace.getLeaf('tab');await leaf.openFile(f,{state:{mode:'preview'}});return true;`);
    await until(()=>page.eval(`return !!${root}.querySelector(${J(selector+' .ft-supplement-switch')});`),'scoped supplement component');
    const n=await page.eval(`return ${root}.querySelector(${J(selector+' .ft-supplement-switch')}).children.length;`);
    if(n!==3)throw Error('wrong scoped segment count');
    await geometry(selector);
    await visibility(`[...${root}.querySelectorAll('${selector} > .ft-area-title .ft-supplement-switch')].find(e=>e.parentElement.getBoundingClientRect().width>0)`,path==='area'?'focus-area':'project','scoped '+path+' hover');
    if(path==='area'){
      const ideas=`[...${root}.querySelectorAll('${selector} > .ft-area-title .ft-intents-chip')].find(e=>e.closest('.ft-category-host')?.getBoundingClientRect().width>0)`;
      if(!await page.eval(`return (${ideas}).getAttribute('aria-pressed')==='true';`))await click(ideas);
      await click(ideas); // close the parent and clear independently opened project collections
    }
    for(let mask=0;mask<8;mask++){
      for(const [kind,on] of [['focus',!!(mask&1)],['later',!!(mask&2)],['intents',!!(mask&4)]]){
        const b=`[...${root}.querySelectorAll('${selector} > .ft-area-title .ft-${kind}-chip')].find(e=>e.closest('.ft-category-host')?.getBoundingClientRect().width>0)`;
        if(await page.eval(`return (${b}).getAttribute('aria-pressed')==='true';`)!==on)await click(b);
      }
      await until(()=>page.eval(`const block=[...${root}.querySelectorAll('${selector}')].find(e=>e.getBoundingClientRect().width>0),text=[...block.querySelectorAll('.ft-text')].map(e=>e.textContent);return text.includes('SUP Focus')===${!!(mask&1)}&&text.includes('SUP Project later')===${!!(mask&2)}&&!!block.querySelector('${path==='area'?'.ft-intents':'.ft-project-intents'}')===${!!(mask&4)};`),'scoped '+path+' combination '+mask);
      if(path==='area'&&!await page.eval(`return !!(${project})===${!!(mask&3)};`))throw Error('scoped area retained a hidden project: '+mask);
      await cleanRows('scoped '+path+' combination '+mask);
      await visibility(`[...${root}.querySelectorAll('${selector} > .ft-area-title .ft-supplement-switch')].find(e=>e.parentElement.getBoundingClientRect().width>0)`,path==='area'?'focus-area':'project','scoped '+path+' hover combination '+mask);
    }
    if(await page.eval(`return [...${root}.querySelectorAll('${selector} .ft-text')].some(e=>e.textContent==='SUP Pending');`))throw Error('pending Waiting leaked into a category');
    const waiting=`[...${root}.querySelectorAll('${selector} .ft-page-waiting')].find(e=>e.getBoundingClientRect().width>0)`;
    await click(waiting);
    await until(()=>page.eval(`return [...${root}.querySelectorAll('${selector} .ft-waiting .ft-text')].some(e=>e.textContent==='SUP Pending');`),'Waiting has its own scoped shelf');
    const f=`[...${root}.querySelectorAll('${selector} .ft-focus-chip')].find(e=>e.closest('.ft-category-host')?.getBoundingClientRect().width>0)`;
    await click(f);
    await until(()=>page.eval(`return ![...${root}.querySelectorAll('${selector} .ft-text')].some(e=>e.textContent==='SUP Area focus'||e.textContent==='SUP Focus');`),'scoped focus can be hidden');
    const clock=`[...${root}.querySelectorAll('${selector} .ft-later-chip')].find(e=>e.closest('.ft-category-host')?.getBoundingClientRect().width>0)`;
    if(await page.eval(`return (${clock}).getAttribute('aria-pressed')==='true';`))await click(clock);
    const plus=`[...${root}.querySelectorAll('${selector} > .ft-area-title > .ft-plus')].find(e=>e.closest('.ft-category-host')?.getBoundingClientRect().width>0)`;
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

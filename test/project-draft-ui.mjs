import{J,sleep,until}from './cdp.mjs';
export async function checkProjectDraftUI(page,mobile=false){
 const root=`(window.__pdScoped?[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.focus-tasks-view')].find(e=>e.getBoundingClientRect().width):app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl)`;
 const row=`[...${root}.querySelectorAll('li.ft-project-row')].find(e=>e.querySelector('.ft-project-name .ft-link')?.textContent===__pd.name)`;
 const click=async expr=>{
  await page.front();await page.eval(`if(!window.__pdScoped&&app.workspace.activeLeaf?.view.getViewType()!=='focus-tasks-view')await app.plugins.plugins['focus-tasks'].openView();return true;`);const at=await page.eval(`const e=${expr},h=e.closest('li.ft-task,.ft-page-head')||e;h.scrollIntoView({block:'center',behavior:'instant'});const r=h.getBoundingClientRect();return {x:r.left+20,y:r.top+4};`);
  await until(()=>page.eval(`const p=app.plugins.plugins['focus-tasks'];return ![...p.views].some(v=>v.containerEl===${root}&&v.busy)&&(typeof __ftLast==='undefined'||Date.now()-__ftLast>700);`),'draft placement view settled');
  if(!mobile)await page.mouse('mouseMoved',at.x,at.y,0);await sleep(150);
  const pointNow=()=>page.eval(`const e=${expr},r=e?.getBoundingClientRect();if(!r?.width)return false;const p={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(p.x,p.y);if(!e.contains(hit))return false;return p;`);
  let point=await until(pointNow,'draft placement control '+expr);
  if(!mobile){await page.mouse('mouseMoved',point.x,point.y,0);await page.eval(`await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;`);point=await until(pointNow,'draft control after real hover '+expr);}
  if(mobile)await page.tap(point,60,false);else await page.click(point,0,false);
 };
 await page.eval(`if(app.vault.getName()!==${J(mobile?'focus-tasks-mobile':'focus-tasks-e2e')})throw Error('fixture guard');const p=app.plugins.plugins['focus-tasks'],area=await p.createArea('Draft placement UI');window.__pd={area:area.path};return true;`);
 await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].notes().some(x=>x.area==='Draft placement UI');`),'draft area indexed');
 for(const context of ['pane','area','project','backlog'])for(const action of ['plus','enter','empty']){
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];__pd.name=${J('DP '+context+' '+action)};const f=await p.createProject({name:'Draft placement UI',note:app.vault.getAbstractFileByPath(__pd.area)},__pd.name);__pd.project=f.path;const t=${action==='empty'?'null':`await p.createTask(__pd.name+' first',{area:'Draft placement UI',project:f.basename,projectFile:f},${context==='backlog'?'null':"moment().format('YYYY-MM-DD')"})`};__pd.uid=t?.uid;delete p.data.folded['area:Draft placement UI'];p.data.opened['steps:'+f.path]=false;p.data.opened['future:Draft placement UI']=true;await p.saveFolds();p.setEverything(${context==='backlog'});window.__pdScoped=${['area','project'].includes(context)};if(__pdScoped){const leaf=app.workspace.getLeaf('tab');await leaf.openFile(app.vault.getAbstractFileByPath(${context==='project'?'__pd.project':'__pd.area'}),{state:{mode:'preview'}});}else{const leaf=await p.openView();await leaf.view.renderer.rerendered();}return true;`);
  await until(()=>page.eval(`return !!${root}&&(${context==='project'?`${root}.querySelector('.ft-page')`:row});`),'single-step '+context);
  const text=context==='project'?`${root}.querySelector('li.ft-task .ft-text')`:`(${row}).querySelector('.ft-line > .ft-text')`;
  if(action==='plus'||action==='empty')await click(context==='project'?`${root}.querySelector('.ft-page-head .ft-plus')`:`(${row}).querySelector('.ft-plus')`);
  else{await click(text);await until(()=>page.eval(`return !!${root}.querySelector('.is-editing');`),'first-step editor');await page.key('Enter');}
  if(action==='empty'){await until(()=>page.eval(`return !!${root}.querySelector('.is-editing');`),'first empty-project draft');await page.type('DP '+context+' '+action+' first');await page.key('Enter');}
  await until(()=>page.eval(`return !!${root}.querySelector('.ft-draft-row .is-editing');`),'new draft in '+context+'/'+action);
  const check=async()=>{
   const issues=await page.eval(`const root=${root},draft=root.querySelector('.ft-draft-row .is-editing')?.closest('li.ft-task'),p=app.plugins.plugins['focus-tasks'],first=[...root.querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent===__pd.name+' first'),issues=[];
    if(!draft||!first)issues.push('missing original or draft');else{if(draft.parentElement!==first.parentElement)issues.push('draft outside the original step list');if(${context!=='project'}&&!draft.closest('.ft-steps'))issues.push('draft outside expanded project');if(Math.abs(draft.querySelector('.ft-text').getBoundingClientRect().left-first.querySelector('.ft-text').getBoundingClientRect().left)>1)issues.push('draft text column differs');}
    if(p.tasks().filter(t=>t.project===__pd.name).length!==1)issues.push('unsaved draft created a note');return issues;`);
   if(issues.length)throw Error(context+'/'+action+': '+issues.join('; '));
  };
  await check();await page.type('DP second '+context+' '+action);await check();
  await page.key('Enter');await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().filter(t=>t.project===__pd.name).length===2;`),'second step saved once');
  await until(()=>page.eval(`return !!${root}.querySelector('.ft-draft-row .is-editing');`),'next draft ready');await page.key('Escape');
  await until(()=>page.eval(`return !${root}.querySelector('.is-editing');`),'empty third draft cancelled');
  if(!await page.eval(`const p=app.plugins.plugins['focus-tasks'];return p.tasks().filter(t=>t.project===__pd.name).length===2;`))throw Error('cancellation changed project steps');
 }
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],a=(await p.collect(true)).find(a=>a.name==='Draft placement UI');await p.removeArea(a);delete window.__pd;window.__pdScoped=false;await p.openView();return true;`);
}

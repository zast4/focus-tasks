import {J,sleep,until} from './cdp.mjs';
export async function checkHoverLayoutUI(page){
 const root="app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl";
 await page.eval(`if(app.vault.getName()!=='focus-tasks-e2e')throw Error('fixture guard');const p=app.plugins.plugins['focus-tasks'],a=await p.createArea('Hover geometry');window.__hl={area:a.path};return true;`);
 await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].notes().some(x=>x.area==='Hover geometry');`),'hover area metadata');
 const title='Make dragging tasks work from any part of the row while keeping the selected project and its first step readable';
 await page.eval(`const p=app.plugins.plugins['focus-tasks'],a={name:'Hover geometry',note:app.vault.getAbstractFileByPath(__hl.area)},f=await p.createProject(a,'Hover Project');__hl.project=f.path;await p.createTask(${J(title)},{area:a.name,project:f.basename,projectFile:f},moment().format('YYYY-MM-DD'));await p.createTask('Short row',{area:a.name},null);p.setEverything(true);delete p.data.folded['area:'+a.name];await p.saveFolds();await p.openView();p.refresh();return true;`);
 const rows=`[...${root}.querySelectorAll('li.ft-hover-host')].filter(e=>e.textContent.includes(${J(title)})||e.querySelector(':scope > .ft-text')?.textContent==='Short row')`;
 await until(()=>page.eval(`return (${rows}).length===2;`),'hover test rows');
 const viewport=await page.eval('return {width:innerWidth,height:innerHeight};');
 for(const width of [620,1000,1400])for(const font of [16,26]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:viewport.height,deviceScaleFactor:1,mobile:false});await page.eval(`document.body.style.setProperty('--font-text-size','${font}px');return true;`);await sleep(250);
  for(let i=0;i<2;i++){
   await page.eval(`const e=(${rows})[${i}];document.activeElement?.blur();e.scrollIntoView({block:'center',behavior:'instant'});return true;`);await page.mouse('mouseMoved',1,1,0);await sleep(100);
   const before=await page.eval(`const e=(${rows})[${i}],t=e.querySelector(':scope > .ft-line,:scope > .ft-text'),r=e.getBoundingClientRect(),b=t.getBoundingClientRect();return {height:r.height,left:b.left,top:b.top,width:b.width,heightText:b.height};`);
   const at=await page.eval(`const r=(${rows})[${i}].getBoundingClientRect();return {x:r.left+30,y:r.top+r.height/2};`);await page.mouse('mouseMoved',at.x,at.y,0);await sleep(100);
   for(const state of ['hover','keyboard']){
    if(state==='keyboard'){await page.mouse('mouseMoved',1,1,0);await page.eval(`(${rows})[${i}].focus();return true;`);}
    const issues=await page.eval(`const e=(${rows})[${i}],t=e.querySelector(':scope > .ft-line,:scope > .ft-text'),r=e.getBoundingClientRect(),b=t.getBoundingClientRect(),old=${J(before)},issues=[];for(const[k,v]of Object.entries({height:r.height,left:b.left,top:b.top,width:b.width,heightText:b.height}))if(Math.abs(v-old[k])>0.5)issues.push(k+' changed '+old[k]+' -> '+v);const tools=e.querySelector('.ft-hover-tools'),a=tools?.getBoundingClientRect();if(!a?.width)issues.push('tools inaccessible');else{if(a.left<0||a.right>innerWidth+1)issues.push('tools overflow');if(Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)issues.push('tools cover active text');}return issues;`);
    if(issues.length)throw Error(width+'/'+font+'/'+state+': '+issues.join('; '));
   }
  }
 }
 await page.send('Emulation.setDeviceMetricsOverride',{...viewport,deviceScaleFactor:1,mobile:false});await page.eval(`document.body.style.removeProperty('--font-text-size');const p=app.plugins.plugins['focus-tasks'],a=(await p.collect(true)).find(x=>x.name==='Hover geometry');await p.removeArea(a);delete window.__hl;return true;`);
}

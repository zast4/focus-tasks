import fs from 'node:fs';
import path from 'node:path';
import { J, sleep, until } from './cdp.mjs';

// Real controls, including hover-only ones. Measure SVG/text centres, not just their wrappers.
export async function checkRowAlignment(page, today, tomorrow, shots) {
  const names = ['Alignment project action with enough text to wrap over several lines and keep every control on its first line',
    'Alignment waiting action with a deadline and a calendar reminder', 'Alignment ordinary timed action'];
  const fixture = await page.eval(`
    if(app.vault.getName()!=='focus-tasks-e2e')throw Error('test vault guard');
    const p=app.plugins.plugins['focus-tasks'],area=await p.createArea('Alignment Area');
    const project=await p.createProject({name:'Alignment Area',note:area},'Alignment Project');
    const tasks=[];
    for(const [i,name] of ${J(names)}.entries()) {
      const task=await p.createTask(name,{area:'Alignment Area',project:i===0?'Alignment Project':null},${J(today)});
      // Midnight is always due today; 01:00 incorrectly hides the Waiting fixture before 1 AM.
      await p.setFields(task,{scheduled:${J(today+'T00:00')},...(i<2?{status:i===1?'waiting':'open',priority:'low',due:${J(tomorrow)}}:{})});tasks.push(task);
    }
    await p.createTask('Alignment future project step',{area:'Alignment Area',project:'Alignment Project'},${J(tomorrow)});
    await p.setEverything(true);await p.setOpen('area:Alignment Area',true);p.data.opened['steps:'+project.path]=false;p.saveFolds();
    for(const dir of ['Internals','Internals/FocusTasks'])if(!app.vault.getAbstractFileByPath(dir))await app.vault.createFolder(dir);
    const receipt={schema:2,contract:'focus-view-at-start-v1',enabled:true,connected:true,tasks:Object.fromEntries(tasks.map((t,i)=>[t.uid,{file:t.file.path,title:t.text,scheduled:${J(today+'T00:00')},waiting:i===1,status:'synced',checkedAt:new Date().toISOString()}]))};
    const file='Internals/FocusTasks/calendar-status.md',text=${J('---\ntype: focus-tasks-calendar-status\n---\n\n```json\n')}+JSON.stringify(receipt)+${J('\n```\n')};
    const old=app.vault.getAbstractFileByPath(file);if(old)await app.vault.modify(old,text);else await app.vault.create(file,text);
    p.refresh();return {area:area.path,project:project.path};
  `);
  await page.eval(`window.__alignmentRoot=()=>[...app.workspace.activeLeaf.view.containerEl.querySelectorAll('.focus-tasks-view')].find(e=>e.getClientRects().length);return true;`);
  const reports=[];
  try { for(const context of ['pane','area','project']) {
    await page.eval(context==='pane'
      ? `await app.commands.executeCommandById('focus-tasks:open');return true;`
      : `const file=${J(fixture[context])};const leaf=app.workspace.getLeaf(true);await leaf.openFile(app.vault.getAbstractFileByPath(file));await leaf.setViewState({type:'markdown',state:{file,mode:'preview'}});return true;`);
    await until(()=>page.eval(`return !!window.__alignmentRoot()?.querySelector('.ft-calendar-status.is-synced');`),context+' calendar receipt');
    const targets=context==='project'?[names[0]]:names;
    try {
      for(const width of [620,1000])for(const font of [14,18,26]) {
        await page.eval(`const root=window.__alignmentRoot();root.style.width=${J(width+'px')};root.style.maxWidth='none';root.style.fontSize=${J(font+'px')};return true;`);
        await sleep(100);
        for(const name of targets) {
          const point=await page.eval(`const row=[...window.__alignmentRoot().querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent.trim()===${J(name)});if(!row)throw Error('missing row fixture');row.scrollIntoView({block:'center',behavior:'instant'});const b=row.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+4};`);
          await page.mouse('mouseMoved',point.x,point.y,0);
          await page.eval(`await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;`);
          const report=await page.eval(`
            const root=window.__alignmentRoot(),row=[...root.querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent.trim()===${J(name)});
            const rect=e=>{const b=e.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height,right:b.right,cy:b.top+b.height/2};};
            const line=row.querySelector(':scope > .ft-line, :scope > .ft-text'),first=rect(line).y+parseFloat(getComputedStyle(line).lineHeight)/2;
            const selectors=['.ft-box input','.ft-grip svg','.ft-running svg','.ft-priority','.ft-chip svg','.ft-plus svg','.ft-due svg','.ft-due > span:not(.ft-due-icon)','.ft-calendar-status svg','.ft-date-text'];
            const controls=selectors.flatMap(selector=>[...row.querySelectorAll(selector)].filter(e=>e.getClientRects().length).map(e=>({selector,...rect(e)})));
            const actors=[...row.children].filter(e=>e.matches('.ft-running,.ft-priority,.ft-chip,.ft-plus,.ft-due,.ft-date')&&e.getClientRects().length).map(rect);
            return {context:${J(context)},width:${width},font:${font},actualFont:parseFloat(getComputedStyle(line).fontSize),actualWidth:rect(root).w,project:row.classList.contains('ft-project-row'),first,row:rect(row),controls,actors};
          `);
          if(Math.abs(report.actualFont-font)>0.2||Math.abs(report.actualWidth-width)>0.2)throw Error('layout matrix dimensions were not applied');
          if(!report.controls.some(x=>x.selector==='.ft-calendar-status svg'))throw Error('missing calendar fixture '+context);
          if(report.project&&!report.controls.some(x=>x.selector==='.ft-plus svg'))throw Error('missing hovered project add button '+context);
          if(report.project&&context==='pane'&&!report.controls.some(x=>x.selector==='.ft-chip svg'))throw Error('missing hovered project clock fixture '+context+' '+width+'/'+font);
          if(name===names[1]&&!report.controls.some(x=>x.selector==='.ft-running svg'))throw Error('missing Waiting control fixture');
          for(const item of report.controls) {
            if(item.w<4||item.h<4)throw Error('zero-size control '+item.selector);
            if(Math.abs(item.cy-report.first)>1.5)throw Error(`${context} ${width}px/${font}px: ${item.selector} off first line by ${(item.cy-report.first).toFixed(2)}px`);
            if(item.selector!=='.ft-grip svg'&&(item.x<report.row.x-1||item.right>report.row.right+1))throw Error('control outside row '+item.selector);
          }
          for(let i=1;i<report.actors.length;i++)if(report.actors[i].x<report.actors[i-1].right-1)throw Error('overlapping controls');
          const icons=report.controls.filter(x=>x.selector.endsWith('svg'));
          if(Math.max(...icons.map(x=>x.w))-Math.min(...icons.map(x=>x.w))>0.5)throw Error('inconsistent row icon sizes');
          reports.push(report);
        }
        if(font===26&&width===620)await page.shot(path.join(shots,'desktop-row-'+context+'-620-26.png'));
      }
    } finally {
      await page.eval(`const root=window.__alignmentRoot();if(root){root.style.width='';root.style.maxWidth='';root.style.fontSize='';}return true;`);
    }
  } } finally {
    // Embedded-view checks leave another note active. Restore the Focus pane for later scenarios.
    await page.eval(`await app.commands.executeCommandById('focus-tasks:open');return true;`);
    await until(()=>page.eval(`return !!document.querySelector('.focus-tasks-pane')?.getClientRects().length;`),'Focus pane restored after row geometry');
  }
  fs.mkdirSync(shots,{recursive:true});
  fs.writeFileSync(path.join(shots,'desktop-row-geometry.json'),JSON.stringify(reports,null,2));
}

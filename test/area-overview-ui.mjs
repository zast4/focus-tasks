import { J, sleep, until } from './cdp.mjs';

export async function checkAreaOverviewUI(page, mobile = false) {
  const name = mobile ? 'focus-tasks-mobile' : 'focus-tasks-e2e';
  const root = "app.workspace.getLeavesOfType('focus-tasks-view')[0].view.containerEl";
  const area = `[...${root}.querySelectorAll('.ft-area')].find(e=>e.querySelector(':scope > .ft-area-title .ft-link')?.textContent==='Area overview UI')`;
  const project = (title, bucket) => `(${area}).querySelector('[data-ft-project-path="'+__overview[${J(title)}]+'"][data-ft-project-bucket="${bucket}"]')`;
  const click = async expr => {
    await page.front();
    await page.eval(`const e=${expr};if(!e)throw Error('missing target');(e.closest('.ft-category-picker')||e).scrollIntoView({block:'center',behavior:'instant'});return true;`);
    const summary = `${expr}.closest('.ft-category-picker')?.querySelector(':scope > .ft-category-total,:scope > .ft-steps-more')`;
    const summaryPoint = await page.eval(`const e=${summary},r=e?.getBoundingClientRect();return r&&r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null;`);
    if (summaryPoint) { if (mobile) await page.tap(summaryPoint); else await page.mouse('mouseMoved', summaryPoint.x, summaryPoint.y, 0); await sleep(150); }
    const point = await until(() => page.eval(`const e=${expr},r=e?.getBoundingClientRect(),p=r&&{x:r.left+r.width/2,y:r.top+r.height/2};return p&&r.width&&e.contains(document.elementFromPoint(p.x,p.y))?p:false;`), 'overview target ' + expr);
    if (mobile) await page.tap(point); else await page.click(point);
    await sleep(150);
  };
  await page.eval(`if(app.vault.getName()!==${J(name)}||app.vault.adapter.getBasePath()!==${J('/Users/daniil/Projects/obsidian-focus-tasks/test/'+name)})throw Error('fixture guard');
    const p=app.plugins.plugins['focus-tasks'],a='Area overview UI',note=await p.createArea(a),area={name:a,note},day=moment().format('YYYY-MM-DD');window.__overview={area:a};
    for(const title of ['Mixed','Queue','Other']){const f=await p.createProject(area,'OV '+title);__overview[title]=f.path;
      if(title==='Mixed')await p.createTask('OV Focus',{area:a,projectFile:f,project:f.basename},day);
      for(let i=0;i<3;i++)await p.createTask('OV '+title+' backlog '+i,{area:a,projectFile:f,project:f.basename,noDate:true},null);}
    await p.createTask('OV Loose Focus',{area:a},day);await p.createTask('OV Loose Backlog',{area:a,noDate:true},null);
    p.setEverything(false);delete p.data.folded['area:'+a];delete p.data.opened['future:'+a];p.data.opened['steps:'+__overview.Mixed]=true;
    p.data.opened['focusoff:'+a]=true;p.data.opened['project-focusoff:'+__overview.Mixed]=true;
    await p.saveFolds();await p.openView();p.refresh();return true;`);
  await until(() => page.eval(`return !!(${project('Mixed','focus')})&&[...(${area}).querySelectorAll('.ft-text')].some(e=>e.textContent==='OV Focus');`), 'legacy Focus hiding is ignored');
  const snapshot = () => page.eval(`const a=${area},focus=a.querySelector(':scope > ul.ft-list');return {text:focus.textContent,rows:[...focus.querySelectorAll('li.ft-project-row')].map(e=>({path:e.dataset.ftProjectPath,open:e.classList.contains('is-open')}))};`);
  const before = await snapshot();
  await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(() => page.eval(`return !!(${project('Queue','backlog')})&&!!(${project('Mixed','backlog')});`), 'area backlog previews below Focus');
  const after = await snapshot();
  if (J(before) !== J(after)) throw Error('opening area backlog changed the Focus list: '+J({before,after}));
  if (!await page.eval(`return !(${project('Mixed','focus')}).querySelector('.ft-focus-chip');`)) throw Error('redundant project Focus toggle');
  if(!mobile&&!await page.eval(`return (${project('Mixed','focus')}).getAttribute('data-ft-hover-key')!==(${project('Mixed','backlog')}).getAttribute('data-ft-hover-key');`))throw Error('two project previews share keyboard restoration identity');
  if (!await page.eval(`const a=${area},b=a.querySelector(':scope > .ft-future-block'),f=a.querySelector(':scope > ul.ft-list');return !!b&&f.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING&&!b.querySelector('li.ft-steps,.ft-project-category-add,.ft-later-steps')&&b.querySelectorAll('li.ft-project-row').length===3&&[...b.querySelectorAll('li.ft-project-row')].every(e=>!e.classList.contains('is-open'))&&a.querySelector(':scope > .ft-area-title .ft-focus-chip').tagName==='SPAN';`)) throw Error('area backlog expands projects or exposes redundant creation controls');
  await page.shot(new URL('./shots/area-overview-'+(mobile?'phone':'desktop')+'.png',import.meta.url).pathname);
  // Opening one project's category must affect only that project, without duplicate tasks.
  await click(`(${project('Mixed','focus')}).querySelector('.ft-later-chip')`);
  await until(() => page.eval(`return !(${project('Mixed','backlog')})&&(${area}).querySelectorAll('.ft-later-steps li.ft-task').length===3;`), 'only explicitly chosen project expands');
  if (!await page.eval(`const a=${area};return !a.querySelector('.ft-later-steps .ft-project-category-add')&&['Queue','Other'].every(k=>!a.querySelector('[data-ft-project-path="'+__overview[k]+'"]').classList.contains('is-open'))&&[...a.querySelectorAll('.ft-text')].filter(e=>e.textContent==='OV Mixed backlog 2').length===1;`)) throw Error('local backlog affects other projects, duplicates tasks or adds a filled-category button');
  if (!await page.eval(`return [...(${area}).querySelectorAll('.ft-text')].some(e=>e.textContent==='OV Focus');`)) throw Error('repeated project Focus click hides tasks');
  await click(`[...(${area}).querySelectorAll('.ft-later-steps .ft-text')].find(e=>e.textContent==='OV Mixed backlog 2')`);
  await until(() => page.eval(`return !!${root}.querySelector('[contenteditable=true]');`), 'edit last backlog task');
  await page.key('Enter');
  await until(() => page.eval(`return !!${root}.querySelector('.ft-draft-row [contenteditable=true]');`), 'Enter appends inside backlog');
  await page.type('OV Enter Backlog'); await page.key('Enter'); await page.key('Escape');
  await until(() => page.eval(`const t=app.plugins.plugins['focus-tasks'].tasks().find(t=>t.text==='OV Enter Backlog');return t&&!t.date&&app.plugins.plugins['focus-tasks'].projectFile(t)?.path===__overview.Mixed;`), 'Enter keeps backlog and project');
  for (let i=0;i<2;i++) await click(`(${area}).querySelector(':scope > .ft-area-title .ft-later-chip')`);
  await until(() => page.eval(`return !!(${project('Mixed','backlog')})&&!(${area}).querySelector('.ft-later-steps,.ft-project-category-add');`), 'area reopens a compact overview');
  await page.eval(`const p=app.plugins.plugins['focus-tasks'];await p.removeArea((await p.collect(true)).find(a=>a.name===__overview.area));delete window.__overview;p.refresh();return true;`);
}

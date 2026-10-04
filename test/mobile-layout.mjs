// Shared layout contracts, exercised inside actual Obsidian mobile emulation.
// Fixture data stays in the disposable vault; never exercise these writes on a user's vault.
import path from 'node:path';
import {J, sleep, until} from './cdp.mjs';

export async function layoutFixture(page, today) {
  await page.eval(`
    if(app.vault.getName()!=='focus-tasks-mobile')throw new Error('fixture vault required');
    if(window.__layoutFixture)return true;
    window.__layoutRoot=()=>[...document.querySelectorAll('.focus-tasks-view')].find(e=>e.getBoundingClientRect().width>0);
    const p=app.plugins.plugins['focus-tasks'];
    p.build={mode:'test',commit:'mobile-layout-fixture',queue:1};
    const note=async(file,front,body='')=>app.vault.create(file,'---\\n'+front+'\\n---\\n'+body);
    const area='👨‍💻IT UI', project='Пройти учебный курс UI';
    await note('Areas/IT UI.md','type: область\\narea: "'+area+'"','\`\`\`focus-tasks\\n\`\`\`');
    await note('Areas/'+project+'.md','type: проект\\narea: "'+area+'"','\`\`\`focus-tasks\\n\`\`\`');
    const longProject='Организовать баланс между работой в IT и созданием собственной законченной системы UI';
    await note('Areas/'+longProject+'.md','type: проект\\narea: "'+area+'"','\`\`\`focus-tasks\\n\`\`\`');
    await note('Areas/Пустой проект UI.md','type: проект\\narea: "'+area+'"\\nscheduled: '+${J(today)},'\`\`\`focus-tasks\\n\`\`\`');
    const tasks=[
      ['Первый шаг','Пройти часть 2 в уроке *00 Как устроена LLM*', 'open', moment(${J(today)}).subtract(6,'days').format('YYYY-MM-DD'), project],
      ['Второй шаг','Разобраться в актуальных моделях и сравнить результаты длинного исследования', 'open', moment(${J(today)}).subtract(1,'day').format('YYYY-MM-DD'), project],
      ['Отложенный шаг','Продолжить обучение после проверки первой законченной версии', 'open', '', project],
      ['Ожидание','Решить, когда летим в отпуск', 'waiting', ${J(today)}+'T00:01:00', null],
      ['Ожидание позже','Получить ответ о согласовании поездки и проверить доступные даты', 'waiting', moment(${J(today)}).add(1,'day').format('YYYY-MM-DD')+'T19:45:00', project],
      ['Без проекта','Разобраться с очень длинным названием задачи, которое должно читаться целиком', 'open', ${J(today)}, null],
      ['Один шаг','Расписать заметку о работе и других обязательствах, сохранив достаточно места для текста', 'open', ${J(today)}, longProject],
      ['Закрытая','Проверить отображение выполненной задачи из проекта с очень длинным названием', 'done', ${J(today)}, longProject],
    ];
    for(const [i,[file,title,status,scheduled,proj]] of tasks.entries())await note('Задачи/UI '+file+'.md',
      'uid: ft-ui-'+i+'\\ntype: задача\\narea: "'+area+'"\\nstatus: '+status+'\\ntitle: '+JSON.stringify(title)+
      (scheduled?'\\nscheduled: '+scheduled:'')+(proj?'\\nprojects:\\n  - "[['+proj+']]"':'')+
      (status==='done'?'\\ncompletedDate: '+${J(today)}:'')+
      (file==='Ожидание'?'\\npriority: low\\ndue: '+moment(${J(today)}).subtract(1,'day').format('YYYY-MM-DD') : ''));
    await note('UI Фокус.md','cssclasses: [focus-tasks-note]','\`\`\`focus-tasks\\n\`\`\`');
    await note('Задачи/UI Без области.md','uid: ft-ui-orphan\\ntype: задача\\nstatus: open\\ntitle: "Разобрать длинную задачу без области, добавленную другим инструментом"');
    await note('Areas/Длинная область UI.md','type: область\\narea: "👨🏻Длинная область"');
    await note('Задачи/UI Длинная область.md','uid: ft-ui-long-area\\ntype: задача\\nstatus: open\\narea: "👨🏻Длинная область"\\nscheduled: '+${J(today)});
    p.data.folded['area:👨🏻Длинная область']=true;
    p.data.opened['steps:Areas/'+project+'.md']=false;
    p.data.folded['area:'+area]=false;
    p.data.folded['area:🧤Рутина']=true;p.data.folded['area:🏡Дом']=true;p.data.order.areas=[area,'🧤Рутина','🏡Дом'];
    p.data.order.tasks['area:'+area]=['p:Areas/'+project+'.md','ft-ui-3','ft-ui-5','p:Areas/'+longProject+'.md','p:Areas/Пустой проект UI.md'];
    p.data.opened['later:Areas/'+project+'.md']=false;
    app.saveLocalStorage('focus-tasks-all',null);p.setWaitingShown(true);p.setDoneShown(true);p.saveFolds();p.refresh();
    window.__layoutFixture=true;return true;`);
  await until(()=>page.eval(`return app.plugins.plugins['focus-tasks'].tasks().some(t=>t.uid==='ft-ui-5');`),'layout fixture indexed');
}

export async function openLayoutContext(page, context) {
  await until(()=>page.eval(`return [...app.plugins.plugins['focus-tasks'].views].every(v=>!v.editing&&!v.busy&&!v.held);`),'previous layout action finished');
  await page.eval(`
    if(app.vault.getName()!=='focus-tasks-mobile')throw new Error('fixture vault required');
    const p=app.plugins.plugins['focus-tasks'];p.data.opened['steps:Areas/Пройти учебный курс UI.md']=false;p.saveFolds();
    const context=${J(context)};
    if(context==='pane') {
      await p.openView();
      const leaf=app.workspace.getLeavesOfType('focus-tasks-view')[0];
      if(!leaf)throw new Error('Focus pane was not created');
      app.workspace.setActiveLeaf(leaf,{focus:true});
    } else {
      const file=context==='area'?'Areas/IT UI.md':context==='project'?'Areas/Пройти учебный курс UI.md':'UI Фокус.md';
      let leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view.file?.path===file);
      window.__layoutNavError=null;
      if(!leaf) {
        leaf=app.workspace.getLeaf('tab');
        leaf.setViewState({type:'markdown',state:{file,mode:'preview'}}).catch(e=>window.__layoutNavError=String(e));
      }
      // Obsidian's reveal promise may outlive a replaced leaf. Observe the actual file and visible
      // renderer instead of treating an unresolved navigation promise as UI readiness.
      app.workspace.revealLeaf(leaf).catch(e=>window.__layoutNavError=String(e));
      app.workspace.setActiveLeaf(leaf,{focus:true});
    }
    p.refresh();return true;`);
  await until(()=>page.eval(`if(window.__layoutNavError)throw new Error(window.__layoutNavError);
    const context=${J(context)},leaf=app.workspace.activeLeaf,root=window.__layoutRoot();
    const file=context==='area'?'Areas/IT UI.md':context==='project'?'Areas/Пройти учебный курс UI.md':'UI Фокус.md';
    const correct=context==='pane'?leaf.view.getViewType()==='focus-tasks-view':leaf.view.file?.path===file;
    return correct&&root?.getBoundingClientRect().width>0&&root.querySelector('li.ft-task')&&
      (context==='area'?!!root.querySelector('.ft-area-page'):context==='project'?!!root.querySelector('.ft-page'):!root.querySelector('.ft-page,.ft-area-page'));`),'visible layout context '+context);
  await sleep(450);
}

// Keep geometry in one place: title and checkbox on the first action line; project context shares
// the checkbox/text columns; metadata cannot steal title width. Bounds alone miss these failures.
function inspectLayout() {
  const root=window.__layoutRoot();
  const rect=e=>e?.getBoundingClientRect();
  const visible=e=>e&&rect(e).width>0&&rect(e).height>0;
  const errors=[];
  const fail=(message,row)=>errors.push(message+': '+row?.textContent.trim().slice(0,110));
  const overlaps=(a,b)=>a&&b&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
  const rows=[...root.querySelectorAll('li.ft-task')].filter(visible);
  const reference=rows.find(row=>row.querySelector('.ft-text')&&visible(row.querySelector(':scope > .ft-box')));
  if(root.scrollWidth>root.clientWidth+1)errors.push('view scrolls horizontally');
  if(root.classList.contains('ft-reordering')) {
    const done=root.querySelector('.ft-reorder-done'),d=rect(done);
    if(!d||d.width<44||d.height<44||d.left<0||d.right>innerWidth+1||d.top<0||d.bottom>innerHeight)errors.push('reordering Done is not reachable');
  }
  for(const header of [...root.querySelectorAll('.ft-area-title')].filter(visible)) {
    const emoji=header.querySelector(':scope > .ft-emoji');
    if(header.matches('.ft-area-page-head')&&!visible(emoji))fail('local area emoji is joined to its name',header);
    if(visible(emoji)&&emoji.textContent) {
      const name=emoji.nextElementSibling,glyph=document.createRange(),letter=document.createRange();
      glyph.selectNodeContents(emoji);const first=document.createTreeWalker(name,NodeFilter.SHOW_TEXT).nextNode();
      if(first){letter.setStart(first,0);letter.setEnd(first,1);if(letter.getBoundingClientRect().left-glyph.getBoundingClientRect().right<3)fail('area name is stuck to its emoji',header);}
    }
    const controls=[...header.querySelectorAll(':scope > .ft-grip, :scope > .ft-caret, :scope > .ft-plus, :scope > .ft-more, :scope > .ft-chip')].filter(visible);
    for(const c of controls) {
      const q=rect(c);
      if(q.left<0||q.right>innerWidth+1)fail('header control outside screen '+c.className,header);
      if(q.width<24||q.height<24)fail('header target below 24px '+c.className,header);
    }
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)
      if(overlaps(rect(controls[i]),rect(controls[j])))fail('header targets overlap '+controls[i].className+'/'+controls[j].className,header);
  }
  const seen=[];
  for(const row of rows) {
    const text=row.querySelector('.ft-text'),box=row.querySelector(':scope > .ft-box'),grip=row.querySelector(':scope > .ft-grip');
    const r=rect(row),t=rect(text),b=visible(box)?rect(box):null,g=visible(grip)?rect(grip):null;
    if(!root.classList.contains('ft-reordering')) {
      if(g)fail('grip is visible outside reordering',row);
      if(b&&Math.abs(b.left-r.left-parseFloat(getComputedStyle(row).paddingLeft))>2)fail('hidden grip still reserves a column',row);
    }
    if(r.right>innerWidth+1||r.left<0)fail('row outside screen',row);
    const separator=getComputedStyle(row,'::before');
    if(reference&&separator.content!=='none'&&separator.display!=='none') {
      const column=rect(reference.querySelector('.ft-text')).left-r.left;
      if(Math.abs(parseFloat(separator.left)-column)>2||Math.abs(parseFloat(separator.right))>1)fail('separator off text column',row);
    }
    if(t&&b) {
      const line=parseFloat(getComputedStyle(text).lineHeight);
      const expected=text.classList.contains('is-editing')?text.scrollHeight:Math.min(text.scrollHeight,line*3);
      if(Math.abs(text.clientHeight-expected)>2)fail('task preview or editor clips the wrong number of lines',row);
      if(Math.abs((b.top+b.height/2)-(t.top+line/2))>2)fail('checkbox off first text line',row);
      if(t.width<r.right-t.left-2)fail('metadata compresses title',row);
      if(text.scrollWidth>text.clientWidth+1)fail('title scrolls horizontally',row);
      seen.push({box:b.left,text:t.left});
    }
    if(g&&b&&(Math.abs((g.top+g.height/2)-(b.top+b.height/2))>2))fail('grip off checkbox line',row);
    const caption=row.querySelector('.ft-mobile-project-caption');
    const more=caption?.querySelector('.ft-steps-more');
    if(more?.classList.contains('is-late')||more?.classList.contains('is-open')) {
      const probe=document.createElement('span');probe.style.color=more.classList.contains('is-open')?'var(--interactive-accent)':'var(--text-error)';
      more.parentElement.appendChild(probe);const expected=getComputedStyle(probe).color;probe.remove();
      if(getComputedStyle(more).color!==expected)fail('project count loses overdue/open state colour',row);
    }
    if(caption&&reference) {
      const icon=rect(caption.querySelector('.ft-project-icon')),link=rect(caption.querySelector('.ft-link'));
      const referenceBox=rect(reference.querySelector(':scope > .ft-box')),referenceText=rect(reference.querySelector('.ft-text'));
      if(Math.abs((icon.left+icon.width/2)-(referenceBox.left+referenceBox.width/2))>2)fail('project folder off shared checkbox column',row);
      if(Math.abs(link.left-referenceText.left)>2)fail('project title off shared action column',row);
    }
    if(caption&&text) {
      const icon=rect(caption.querySelector('.ft-project-icon')),link=rect(caption.querySelector('.ft-link'));
      if(rect(caption).bottom>t.top+1)fail('project overlaps action',row);
      if(!icon||Math.abs((icon.left+icon.width/2)-(b.left+b.width/2))>2)fail('project icon off checkbox column',row);
      if(!link||Math.abs(link.left-t.left)>2)fail('project name off title column',row);
    }
    const controls=[...row.querySelectorAll(':scope > .ft-box, :scope > .ft-grip, .ft-date, .ft-running, .ft-priority, .ft-steps-more, .ft-plus, .ft-later-chip, .ft-place, .ft-mobile-project-caption .ft-link')].filter(visible);
    for(const c of controls) {
      const q=rect(c);
      if(q.width<24||q.height<24)fail('touch target below 24px '+c.className,row);
      if(q.left<0||q.right>innerWidth+1)fail('control outside screen '+c.className,row);
      if(c.matches('.ft-date,.ft-running,.ft-priority')&&t&&q.top<t.bottom-1)fail('metadata beside title',row);
      if(t&&overlaps(q,t))fail('control overlaps title '+c.className,row);
    }
    for(let i=0;i<controls.length;i++)for(let j=i+1;j<controls.length;j++)
      if(overlaps(rect(controls[i]),rect(controls[j])))fail('touch targets overlap '+controls[i].className+'/'+controls[j].className,row);
  }
  if(seen.length>1&&Math.max(...seen.map(x=>x.box))-Math.min(...seen.map(x=>x.box))>2)errors.push('task checkbox columns diverge');
  if(!rows.length)errors.push('no rows checked');
  if(!rows.some(row=>row.querySelector('.ft-text')?.textContent.includes('Пройти часть 2')))errors.push('fixture first step missing');
  return {errors,rows:rows.length,font:getComputedStyle(root).fontSize};
}

export async function checkLayoutMatrix(page, context, shots) {
  for(const width of [320,390,430])for(const font of [18,22,26]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:2,mobile:true});
    await page.eval(`const root=window.__layoutRoot();root.style.fontSize=${J(font+'px')};return true;`);
    await sleep(120);
    const state=await page.eval('return ('+inspectLayout.toString()+')();');
    if(state.errors.length)throw new Error(context+' '+width+'px / '+font+'px: '+J(state));
    if(width===390&&font===18||width===320&&font===26||width===430&&font===18) {
      await page.eval(`const root=window.__layoutRoot();const row=[...root.querySelectorAll('li.ft-task')].find(e=>e.querySelector('.ft-text')?.textContent.includes('Пройти часть 2'));row?.scrollIntoView({block:'center',behavior:'instant'});return true;`);
      await sleep(180);
      await page.shot(path.join(shots,'mobile-layout-'+context+'-'+width+'-'+font+'.png'));
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await page.eval(`const root=window.__layoutRoot();root.style.removeProperty('font-size');return true;`);
}

export async function checkCurrentLayout(page, context, shots) {
  const state=await page.eval('return ('+inspectLayout.toString()+')();');
  if(state.errors.length)throw new Error(context+': '+J(state));
  await page.shot(path.join(shots,'mobile-layout-'+context+'.png'));
}

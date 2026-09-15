function jiraClosureStatus(issue) {
  return issue.isOnTime===true?'按期':issue.isOnTime===false?'超期':'无法判定';
}

function jiraOverdueStages(issue) { return (issue.stageTimings||[]).filter(x=>x.overdueDays>0); }

function jiraStageOverdueTotal(issue) {
  const stages=issue.stageTimings||[];
  if(!stages.length||stages.some(stage=>!Number.isFinite(stage.overdueDays)))return null;
  return stages.reduce((total,stage)=>total+Math.max(0,stage.overdueDays),0);
}

function jiraStageTimingHtml(issue) {
  const stages=issue.stageTimings||[];
  const overdue=jiraOverdueStages(issue);
  if(!stages.length) return issue.historyTruncated?'历史不完整':'—';
  return `<details class="jira-stage-timing"><summary>${overdue.length?esc(overdue.map(x=>x.name).join('、')):'未发现阶段超期'}</summary><div>${stages.map(x=>`<p><strong>${esc(x.name)}</strong> ${Number(x.elapsedDays).toFixed(1)}天 / 时限 ${x.limitDays??'未配置'}${x.limitDays===null?'':'天'} · ${x.overdueDays===null?'无法判定':x.overdueDays>0?`超期${x.overdueDays}天`:'按期'}</p>`).join('')}</div></details>`;
}

function jiraReviewIssue(record) {
  const x=record.snapshot;
  return {...x,isOnTime:x.closureOverdueDays===null?null:x.closureOverdueDays===0,timingReliable:true,stageCode:'closed'};
}

function jiraReviewIdentity(issue) { return `${issue.projectKey}|${issue.issueId||issue.key}`; }

function jiraClosureCells(issue) {
  const overdueDays=jiraStageOverdueTotal(issue);
  return `<td><a href="${esc(issue.url)}" target="_blank" rel="noopener noreferrer">${esc(issue.key)}</a><small class="jira-cell-note">${esc(issue.projectKey)}</small></td><td class="jira-review-title">${esc(issue.summary)}</td><td><span class="jira-severity ${esc(issue.severityKey?.toLowerCase())}">${esc(issue.severityLabel)}</span></td><td>${jiraStageTimingHtml(issue)}</td><td>${overdueDays===null?'<span class="jira-unknown-tag" title="阶段数据或时效标准不完整，无法计算累计超期天数">无法判定</span>':`${overdueDays}天`}</td><td>${esc(String(issue.closedAt||'').slice(0,10))||'—'}</td>`;
}

function jiraReviewCsv(title,headers,rows) {
  if(!rows.length) return;
  const csv='\uFEFF'+[headers,...rows].map(row=>row.map(jiraCsvCell).join(',')).join('\r\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  link.download=`${title}_${jiraToday()}.csv`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(link.href);
  toast(`已导出 ${rows.length} 条记录。`);
}

function jiraClosureExportRow(issue) {
  return [issue.projectKey,issue.key,issue.summary,issue.severityLabel,
    jiraOverdueStages(issue).map(x=>`${x.name}：${x.overdueDays}天`).join('；'),jiraStageOverdueTotal(issue)??'无法判定',
    issue.closedAt||'',issue.timingReliable?issue.closureElapsedDays:'无法判定',issue.closureLimitDays??'未配置'];
}
const jiraClosureHeaders=['所属项目','Jira编号','标题','严重等级','超期阶段及天数','超期天数（各阶段累计）','关闭日期','关闭周期天数','关闭总周期时限'];

function jiraReviewSelect(label,key,values) {
  return `<label><span>${esc(label)}</span><select data-review-filter="${key}"><option value="">全部</option>${[...new Set(values)].filter(x=>x!==null&&x!==undefined&&x!=='').sort().map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label>`;
}

async function openJiraClosedDetails(data,{onTimeOnly=false}={}) {
  const items=data.issues.filter(x=>x.stageCode==='closed'&&(!onTimeOnly||x.isOnTime===true));
  const title=onTimeOnly?'按期关闭问题（总周期）':'已关闭问题';
  let page=1,filtered=items,records=[],reviewError='',recordRequest,loaded=!hasPermission('JIRA_REVIEW_VIEW');
  const trigger=document.activeElement;
  const filters={};
  modalRoot.innerHTML=`<div class="modal-backdrop jira-detail-backdrop"><div class="jira-detail-modal" role="dialog" aria-modal="true" aria-label="${title}"><div class="jira-detail-head"><div><h3>${title} · ${items.length}项</h3><p>${onTimeOnly?'仅展示总关闭周期达标的问题，仍可能存在阶段超期。':'展示全部已关闭问题。'}超期天数为各阶段超期天数（分别向上取整）的累计；展开超期阶段可查看耗时与标准。</p></div><div class="jira-detail-actions"><button type="button" class="btn btn-light btn-sm" data-closed-export>导出筛选结果</button><button type="button" class="jira-detail-close" aria-label="关闭">×</button></div></div><div class="jira-detail-filters jira-closed-filters"><label><span>编号 / 标题</span><input data-review-filter="keyword" placeholder="搜索问题"></label>${jiraReviewSelect('项目','project',items.map(x=>x.projectKey))}${jiraReviewSelect('严重等级','severity',items.map(x=>x.severityLabel))}${jiraReviewSelect('总周期时效','timing',onTimeOnly?['按期']:['按期','超期','无法判定'])}${jiraReviewSelect('超期阶段','stage',items.flatMap(x=>jiraOverdueStages(x).map(s=>s.name)))}${jiraReviewSelect('复盘状态','review',['已复盘','未复盘'])}<label><span>关闭日期起</span><input type="date" data-review-filter="from"></label><label><span>关闭日期止</span><input type="date" data-review-filter="to"></label></div><div data-closed-review-status></div><div class="jira-detail-body" data-closed-body></div></div></div>`;
  const host=modalRoot.querySelector('.jira-detail-modal');
  const onKey=e=>{if(byId('drawer-root').childElementCount)return;if(e.key==='Escape')close();if(e.key==='Tab')jiraTrapFocus(e,host);};
  const close=()=>{recordRequest?.abort();document.removeEventListener('keydown',onKey);modalRoot.replaceChildren();trigger?.focus?.();};
  document.addEventListener('keydown',onKey);
  host.querySelector('.jira-detail-close').onclick=close;
  modalRoot.firstElementChild.onclick=e=>{if(e.target===modalRoot.firstElementChild)close();};
  const render=()=>{
    if(!host.isConnected)return;
    const lookup=new Map(records.map(r=>[jiraReviewIdentity(r.snapshot),r]));
    const reviewFor=x=>lookup.get(jiraReviewIdentity(x));
    const keyword=(filters.keyword||'').toLowerCase();
    filtered=items.filter(x=>(!keyword||`${x.key} ${x.summary}`.toLowerCase().includes(keyword))&&(!filters.project||x.projectKey===filters.project)&&(!filters.severity||x.severityLabel===filters.severity)&&(!filters.timing||jiraClosureStatus(x)===filters.timing)&&(!filters.stage||jiraOverdueStages(x).some(s=>s.name===filters.stage))&&(!filters.review||(filters.review==='已复盘')===!!reviewFor(x))&&(!filters.from||String(x.closedAt||'').slice(0,10)>=filters.from)&&(!filters.to||String(x.closedAt||'').slice(0,10)<=filters.to));
    const pages=Math.max(1,Math.ceil(filtered.length/50));page=Math.min(page,pages);
    host.querySelector('[data-closed-review-status]').innerHTML=!loaded?'<p class="form-hint">正在读取复盘状态…</p>':reviewError?`<div class="jira-warning">复盘状态读取失败：${esc(reviewError)} <button type="button" class="btn btn-light btn-sm" data-reviews-retry>重试</button></div>`:!hasPermission('JIRA_REVIEW_VIEW')?'<p class="form-hint">当前账号没有复盘查看权限，无法显示已保存状态。</p>':'';
    host.querySelector('[data-review-filter="review"]').disabled=!hasPermission('JIRA_REVIEW_VIEW')||!loaded||!!reviewError;
    host.querySelector('[data-closed-export]').disabled=!filtered.length;
    const visible=filtered.slice((page-1)*50,page*50);
    host.querySelector('[data-closed-body]').innerHTML=filtered.length?`<div class="jira-detail-table-wrap"><table class="jira-closed-table"><thead><tr><th>操作</th><th>Jira编号 / 项目</th><th>标题</th><th>严重等级</th><th>超期阶段</th><th title="各阶段超期天数之和">超期天数</th><th>关闭日期</th><th>复盘状态</th></tr></thead><tbody>${visible.map((x,index)=>{const record=reviewFor(x),eligible=x.timingReliable&&(x.isOnTime===false||jiraOverdueStages(x).length>0),canCreate=hasPermission('JIRA_REVIEW_CREATE')&&eligible&&loaded&&!reviewError;return `<tr><td><button type="button" class="btn btn-light btn-sm" data-closed-review="${index}" ${record||canCreate?'':'disabled'} title="${esc(record?'查看已保存复盘':!hasPermission('JIRA_REVIEW_CREATE')?'没有新增复盘权限':!x.timingReliable?'历史数据不完整，无法复盘':!eligible?'该问题未发现超期':!loaded?'正在读取复盘状态':reviewError?'请先重试读取复盘状态':'填写超期复盘')}">${record?'查看 / 编辑':'复盘'}</button>${record||canCreate?'':`<small class="jira-cell-note">${!hasPermission('JIRA_REVIEW_CREATE')?'无新增权限':!x.timingReliable?'历史不完整':!eligible?'未发现超期':!loaded?'读取状态中…':'状态加载失败，请重试'}</small>`}</td>${jiraClosureCells(x)}<td>${record?'已复盘':hasPermission('JIRA_REVIEW_VIEW')&&loaded&&!reviewError?'未复盘':'—'}</td></tr>`;}).join('')}</tbody></table></div><div class="jira-detail-pagination"><span>筛选后 ${filtered.length} 项 · 第 ${page}/${pages} 页</span><div><button class="btn btn-light btn-sm" type="button" data-closed-prev ${page===1?'disabled':''}>上一页</button><button class="btn btn-light btn-sm" type="button" data-closed-next ${page===pages?'disabled':''}>下一页</button></div></div>`:jiraNoData('当前筛选条件下暂无已关闭问题');
    host.querySelector('[data-closed-prev]')?.addEventListener('click',()=>{page--;render();});
    host.querySelector('[data-closed-next]')?.addEventListener('click',()=>{page++;render();});
    host.querySelectorAll('[data-closed-review]').forEach(button=>button.onclick=async()=>{
      const issue=visible[Number(button.dataset.closedReview)];
      try{await openJiraReviewEditor(issue,reviewFor(issue),async()=>{await loadRecords();});}catch(error){toast(error.message,'error');}
    });
    host.querySelector('[data-reviews-retry]')?.addEventListener('click',loadRecords);
  };
  const loadRecords=async()=>{
    if(!hasPermission('JIRA_REVIEW_VIEW')){render();return;}
    loaded=false;render();recordRequest=new AbortController();
    const controller=recordRequest,timeout=setTimeout(()=>controller.abort(),15000);
    try{records=(await api('/internal/jira-reviews',{signal:controller.signal})).items;reviewError='';}
    catch(error){reviewError=error.name==='AbortError'?'复盘状态读取超时，请重试。':error.message;filters.review='';host.querySelector('[data-review-filter="review"]').value='';}
    finally{clearTimeout(timeout);}
    loaded=true;render();
  };
  host.querySelectorAll('[data-review-filter]').forEach(input=>input.addEventListener(input.tagName==='INPUT'&&input.type!=='date'?'input':'change',()=>{filters[input.dataset.reviewFilter]=input.value;page=1;render();}));
  host.querySelector('[data-closed-export]').onclick=()=>jiraReviewCsv(title,jiraClosureHeaders,filtered.map(jiraClosureExportRow));
  render();host.querySelector('input').focus();await loadRecords();
}

function jiraTrapFocus(event,host) {
  const elements=[...host.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary')];
  const first=elements[0],last=elements.at(-1);if(!first)return;
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}

async function openJiraReviewEditor(issue,record,onSaved) {
  const editable=record?hasPermission('JIRA_REVIEW_EDIT'):hasPermission('JIRA_REVIEW_CREATE');
  const root=byId('drawer-root'),trigger=document.activeElement;
  const source=record?jiraReviewIssue(record):issue;
  if(root.childElementCount)return;
  let saving=false,optionsReady=!editable,requestController;
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  root.innerHTML=`<div class="jira-review-overlay"><aside class="jira-review-drawer" role="dialog" aria-modal="true" aria-label="超期复盘"><div class="jira-detail-head"><div><h3>${record?'问题复盘':'填写超期复盘'}</h3><p>${esc(source.key)} · ${esc(source.severityLabel)} · ${jiraClosureStatus(source)}</p></div><button type="button" class="jira-detail-close" aria-label="关闭">×</button></div><div class="jira-review-body"><div class="jira-review-context"><strong>${esc(source.summary)}</strong><p>关闭周期 ${Number(source.closureElapsedDays).toFixed(1)}天 / 标准 ${source.closureLimitDays??'未配置'}${source.closureLimitDays===null?'':'天'}</p>${jiraStageTimingHtml(source)}${record?`<p>复盘依据：截至 ${esc(record.snapshot.cutoffDate)} · 标准版本 ${record.snapshot.standardRevision}</p>`:''}</div><form id="jira-review-form"><div class="field"><label>处理超时原因 *</label><textarea name="reason" required maxlength="4000" rows="6" ${editable?'':'readonly'} placeholder="说明发生超时的具体原因">${esc(record?.reason||'')}</textarea></div><div class="field"><label>责任人 *</label><input name="responsiblePerson" required maxlength="150" value="${esc(record?.responsiblePerson||'')}" ${editable?'':'readonly'} placeholder="填写责任人，可包含供应商人员"></div><div class="field"><label>超时原因分类 *</label>${editable?'<select name="categoryItemId" required disabled><option value="">正在加载分类…</option></select><div data-category-status role="status"></div>':`<input readonly value="${esc(record?.categoryName)}">`}</div></form><div data-review-error class="jira-warning" role="alert" hidden></div>${record?`<p class="form-hint">复盘人：${esc(record.createdBy)} · ${esc(fmtDate(record.createdAt))}<br>最后修改：${esc(record.updatedBy)} · ${esc(fmtDate(record.updatedAt))}</p>`:''}</div><div class="jira-review-footer"><button type="button" class="btn btn-light" data-review-cancel>关闭</button>${editable?'<button type="button" class="btn btn-primary" data-review-save disabled>保存复盘</button>':''}</div></aside></div>`;
  const host=root.querySelector('aside');
  const close=()=>{if(saving)return;requestController?.abort();document.removeEventListener('keydown',onKey,true);document.body.style.overflow=previousOverflow;root.replaceChildren();if(trigger?.isConnected)trigger.focus();};
  const onKey=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();close();}if(e.key==='Tab'){e.stopImmediatePropagation();jiraTrapFocus(e,host);}};
  document.addEventListener('keydown',onKey,true);
  host.querySelector('.jira-detail-close').onclick=close;
  host.querySelector('[data-review-cancel]').onclick=close;
  root.firstElementChild.onclick=e=>{if(e.target===root.firstElementChild)close();};
  host.querySelector('[data-review-save]')?.addEventListener('click',async event=>{
    if(saving||!optionsReady)return;
    const form=host.querySelector('form'),errorHost=host.querySelector('[data-review-error]');errorHost.hidden=true;if(!form.reportValidity())return;
    const reason=form.elements.reason.value.trim(),person=form.elements.responsiblePerson.value.trim();
    if(!reason||!person){errorHost.textContent='请填写具体超时原因和责任人。';errorHost.hidden=false;errorHost.scrollIntoView({block:'nearest'});return;}
    const button=event.currentTarget;saving=true;button.disabled=true;button.textContent='保存中…';
    try{
      const payload={...(record?{}:issue.reviewContext),reason,responsiblePerson:person,categoryItemId:Number(form.elements.categoryItemId.value),revision:record?.revision||0};
      await api(record?`/internal/jira-reviews/${record.id}`:'/internal/jira-reviews',{method:record?'PUT':'POST',body:JSON.stringify(payload)});
      saving=false;close();toast('复盘已保存。');
      try{await onSaved?.();}catch(error){toast(`复盘已保存，但列表刷新失败：${error.message}`,'error');}
    }catch(error){saving=false;if(button.isConnected){errorHost.textContent=error.message;errorHost.hidden=false;errorHost.scrollIntoView({block:'nearest'});button.disabled=false;button.textContent='保存复盘';}}
  });
  host.querySelector('form').onsubmit=event=>{event.preventDefault();host.querySelector('[data-review-save]')?.click();};
  host.querySelector('textarea').focus();
  const loadOptions=async()=>{
    requestController=new AbortController();
    const controller=requestController;
    const timeout=setTimeout(()=>controller.abort(),15000);
    const select=host.querySelector('[name="categoryItemId"]'),status=host.querySelector('[data-category-status]');
    status.innerHTML='<p class="form-hint">正在读取原因分类，可先填写原因和责任人。</p>';
    try{
      const {categories}=await api('/internal/jira-reviews/reference-data',{signal:requestController.signal});
      if(!host.isConnected)return;
      select.innerHTML='<option value="">请选择</option>'+categories.map(x=>`<option value="${x.id}" ${x.id===record?.categoryItemId?'selected':''}>${esc(x.name)}</option>`).join('');
      optionsReady=categories.length>0;select.disabled=!optionsReady;
      host.querySelector('[data-review-save]').disabled=!optionsReady;
      status.innerHTML=optionsReady?'':'<p class="form-hint">暂无可用分类，请联系字典管理员维护“Jira超时原因分类”。</p><button type="button" class="btn btn-light btn-sm" data-category-retry>重新加载</button>';
    }catch(error){
      if(!host.isConnected)return;
      select.innerHTML='<option value="">分类读取失败</option>';
      status.innerHTML=`<div class="jira-warning" role="alert">${esc(error.name==='AbortError'?'分类读取超时，请重试。':error.message)} <button type="button" class="btn btn-light btn-sm" data-category-retry>重试</button></div>`;
    }finally{clearTimeout(timeout);}
    status.querySelector('[data-category-retry]')?.addEventListener('click',loadOptions);
  };
  if(editable)await loadOptions();
}

async function renderJiraReviews() {
  setPage('超期处理分析','集中查看已保存复盘，分析原因分类、超期阶段和责任信息');
  content.innerHTML='<div class="loading">正在读取复盘记录…</div>';
  try{
    const data=await api('/internal/jira-reviews');
    if(state.route!=='jira-reviews')return;
    const records=data.items;let page=1,filtered=records;
    const filters={};
    content.innerHTML=`<section class="jira-panel"><div class="jira-panel-head"><div><h3>已复盘问题</h3><p>当前Jira来源的共享复盘记录；所有统计仅代表已复盘样本，超期天数为各阶段超期天数之和。</p></div><button class="btn btn-light" type="button" data-review-export>导出筛选结果</button></div><div class="jira-detail-filters jira-review-filters"><label><span>编号 / 标题 / 原因</span><input data-review-filter="keyword" placeholder="搜索复盘记录"></label>${jiraReviewSelect('项目','project',records.map(x=>x.snapshot.projectKey))}${jiraReviewSelect('严重等级','severity',records.map(x=>x.snapshot.severityLabel))}${jiraReviewSelect('责任人','person',records.map(x=>x.responsiblePerson))}${jiraReviewSelect('原因分类','category',records.map(x=>x.categoryName))}${jiraReviewSelect('超期阶段','stage',records.flatMap(x=>jiraOverdueStages(x.snapshot).map(s=>s.name)))}<label><span>复盘日期起</span><input type="date" data-review-filter="from"></label><label><span>复盘日期止</span><input type="date" data-review-filter="to"></label></div></section><div data-review-analytics></div><section class="jira-panel" data-review-table></section>`;
    const host=content;
    const render=()=>{
      const keyword=(filters.keyword||'').toLowerCase();
      filtered=records.filter(r=>{const x=r.snapshot,date=r.createdAt.slice(0,10);return (!keyword||`${x.key} ${x.summary} ${r.reason}`.toLowerCase().includes(keyword))&&(!filters.project||x.projectKey===filters.project)&&(!filters.severity||x.severityLabel===filters.severity)&&(!filters.person||r.responsiblePerson===filters.person)&&(!filters.category||r.categoryName===filters.category)&&(!filters.stage||jiraOverdueStages(x).some(s=>s.name===filters.stage))&&(!filters.from||date>=filters.from)&&(!filters.to||date<=filters.to);});
      const pages=Math.max(1,Math.ceil(filtered.length/50));page=Math.min(page,pages);
      const visible=filtered.slice((page-1)*50,page*50);
      const counts=values=>[...jiraGroupBy(values,x=>x)].map(([name,items])=>({name,count:items.length})).sort((a,b)=>b.count-a.count);
      host.querySelector('[data-review-analytics]').innerHTML=`<div class="jira-review-kpis"><strong>${filtered.length}<small>已复盘问题</small></strong><strong>${filtered.filter(x=>x.snapshot.closureOverdueDays>0).length}<small>关闭总周期超期</small></strong><strong>${new Set(filtered.map(x=>x.responsiblePerson)).size}<small>涉及责任人</small></strong></div><div class="jira-review-charts">${jiraReviewBars('原因分类分布',counts(filtered.map(x=>x.categoryName)),'category')}${jiraReviewBars('超期阶段分布',counts(filtered.flatMap(x=>jiraOverdueStages(x.snapshot).map(s=>s.name))),'stage')}${jiraReviewBars('责任人关联问题数',counts(filtered.map(x=>x.responsiblePerson)),'person')}</div><p class="form-hint">一条问题可能涉及多个超期阶段；责任人关联数量仅表示复盘记录分布。</p>`;
      host.querySelector('[data-review-export]').disabled=!filtered.length;
      host.querySelector('[data-review-table]').innerHTML=filtered.length?`<div class="jira-review-table-wrap"><table class="jira-closed-table"><thead><tr><th>操作</th><th>Jira编号 / 项目</th><th>标题</th><th>严重等级</th><th>超期阶段</th><th title="各阶段超期天数之和">超期天数</th><th>关闭日期</th><th>处理超时原因</th><th>责任人</th><th>原因分类</th><th>复盘人 / 时间</th></tr></thead><tbody>${visible.map((r,i)=>`<tr><td><div class="inline-actions"><button class="btn btn-light btn-sm" type="button" data-review-open="${i}">${hasPermission('JIRA_REVIEW_EDIT')?'查看 / 编辑':'查看'}</button>${hasPermission('JIRA_REVIEW_DELETE')?`<button class="btn btn-danger btn-sm" type="button" data-review-delete="${i}">删除</button>`:''}</div></td>${jiraClosureCells(jiraReviewIssue(r))}<td class="jira-review-reason">${esc(r.reason)}</td><td>${esc(r.responsiblePerson)}</td><td>${esc(r.categoryName)}</td><td>${esc(r.createdBy)}<small class="jira-cell-note">${esc(fmtDate(r.createdAt))}</small></td></tr>`).join('')}</tbody></table></div><div class="jira-detail-pagination"><span>筛选后 ${filtered.length} 项 · 第 ${page}/${pages} 页</span><div><button class="btn btn-light btn-sm" type="button" data-review-prev ${page===1?'disabled':''}>上一页</button><button class="btn btn-light btn-sm" type="button" data-review-next ${page===pages?'disabled':''}>下一页</button></div></div>`:jiraNoData('暂无复盘记录，可从Jira看板的“已关闭问题”进入复盘');
      host.querySelector('[data-review-prev]')?.addEventListener('click',()=>{page--;render();});host.querySelector('[data-review-next]')?.addEventListener('click',()=>{page++;render();});
      const refresh=async()=>{
        const next=await api('/internal/jira-reviews');if(state.route!=='jira-reviews')return;records.splice(0,records.length,...next.items);
        const options={project:records.map(x=>x.snapshot.projectKey),severity:records.map(x=>x.snapshot.severityLabel),person:records.map(x=>x.responsiblePerson),category:records.map(x=>x.categoryName),stage:records.flatMap(x=>jiraOverdueStages(x.snapshot).map(s=>s.name))};
        Object.entries(options).forEach(([key,values])=>{const select=host.querySelector(`[data-review-filter="${key}"]`),unique=[...new Set(values)].sort();if(filters[key]&&!unique.includes(filters[key]))filters[key]='';select.innerHTML='<option value="">全部</option>'+unique.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');select.value=filters[key]||'';});
        render();
      };
      host.querySelectorAll('[data-review-open]').forEach(b=>b.onclick=async()=>{try{await openJiraReviewEditor(null,visible[Number(b.dataset.reviewOpen)],refresh);}catch(error){toast(error.message,'error');}});
      host.querySelectorAll('[data-review-delete]').forEach(b=>b.onclick=async()=>{
        const record=visible[Number(b.dataset.reviewDelete)];const result=await confirmAction('删除复盘',`确认删除 ${record.snapshot.key} 的复盘记录？`,{submitText:'确认删除',danger:true});if(!result.confirmed)return;
        try{await api(`/internal/jira-reviews/${record.id}?revision=${record.revision}`,{method:'DELETE'});toast('复盘已删除。');await refresh();}catch(error){toast(error.message,'error');}
      });
      host.querySelectorAll('[data-review-bar]').forEach(b=>b.onclick=()=>{filters[b.dataset.filter]=b.dataset.reviewBar;host.querySelector(`[data-review-filter="${b.dataset.filter}"]`).value=b.dataset.reviewBar;page=1;render();});
    };
    host.querySelectorAll('[data-review-filter]').forEach(input=>input.addEventListener(input.tagName==='INPUT'&&input.type!=='date'?'input':'change',()=>{filters[input.dataset.reviewFilter]=input.value;page=1;render();}));
    host.querySelector('[data-review-export]').onclick=()=>jiraReviewCsv('超期复盘分析',[...jiraClosureHeaders,'处理超时原因','责任人','原因分类','复盘人','复盘时间','最后修改人','最后修改时间','标准版本'],filtered.map(r=>[...jiraClosureExportRow(jiraReviewIssue(r)),r.reason,r.responsiblePerson,r.categoryName,r.createdBy,r.createdAt,r.updatedBy,r.updatedAt,r.snapshot.standardRevision]));
    render();
  }catch(error){if(state.route==='jira-reviews')content.innerHTML=`<section class="jira-panel"><div class="jira-warning">读取失败：${esc(error.message)}</div><button class="btn btn-light" type="button" id="jira-review-retry">重试</button></section>`;byId('jira-review-retry')?.addEventListener('click',renderJiraReviews);}
}

function jiraReviewBars(title,items,filter) {
  const max=Math.max(1,...items.map(x=>x.count));
  return `<section class="jira-panel jira-review-chart"><h3>${esc(title)}</h3><div class="jira-review-bars">${items.length?items.map(x=>`<button type="button" data-review-bar="${esc(x.name)}" data-filter="${filter}"><span>${esc(x.name)}</span><i><b style="width:${x.count/max*100}%"></b></i><strong>${x.count}</strong></button>`).join(''):jiraNoData('暂无样本')}</div></section>`;
}

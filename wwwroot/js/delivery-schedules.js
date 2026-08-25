const deliveryScheduleStatusNames={
  UPCOMING:'未到期',
  DUE_SOON:'即将到期',
  OVERDUE_UNDELIVERED:'延期未交付',
  LATE_DELIVERED:'延期交付',
  ON_TIME_DELIVERED:'正常交付'
};

function deliveryScheduleStatusText(row){
  switch(row.status){
    case'DUE_SOON':return row.days===0?'今天到期':`${row.days}天后到期`;
    case'OVERDUE_UNDELIVERED':return`已延期${row.days}天`;
    case'LATE_DELIVERED':return`延期${row.days}天交付`;
    case'ON_TIME_DELIVERED':return row.days===0?'按期交付':`提前${Math.abs(row.days||0)}天交付`;
    case'UPCOMING':return`还有${row.days}天`;
    default:return deliveryScheduleStatusNames[row.status]||row.status;
  }
}

function deliveryScheduleTone(status){
  return ({
    DUE_SOON:'warning',
    OVERDUE_UNDELIVERED:'danger',
    LATE_DELIVERED:'late',
    ON_TIME_DELIVERED:'success',
    UPCOMING:'neutral'
  })[status]||'neutral';
}

function deliveryScheduleStatusVisual(row){
  const tone=deliveryScheduleTone(row.status);
  return `<div class="schedule-status schedule-status-${tone}"><span class="schedule-status-dot"></span><span><strong>${esc(deliveryScheduleStatusNames[row.status]||row.status)}</strong><small>${esc(deliveryScheduleStatusText(row))}</small></span></div>`;
}

function deliveryScheduleDelta(row){
  const tone=deliveryScheduleTone(row.status);
  return `<span class="schedule-delta schedule-delta-${tone}">${esc(deliveryScheduleStatusText(row))}</span>`;
}

function groupDeliveryPlanItems(items){
  const groups=[];
  for(const row of items){
    let group=groups.find(x=>x.typeId===row.typeId);
    if(!group){
      group={typeId:row.typeId,typeCode:row.typeCode,typeName:row.typeName,items:[]};
      groups.push(group);
    }
    group.items.push(row);
  }
  return groups;
}

async function updateDeliveryPlanDates(planIds,plannedDeliveryDate){
  return api('/internal/delivery-schedules',{method:'PUT',body:JSON.stringify({planIds,plannedDeliveryDate,operator:operatorName()})});
}
async function deleteDeliveryPlans(planIds){
  return api('/internal/delivery-schedules',{method:'DELETE',body:JSON.stringify({planIds,operator:operatorName()})});
}
async function createDeliveryPlans(projectId,items){
  return api('/internal/delivery-schedules',{method:'POST',body:JSON.stringify({projectId,items,operator:operatorName()})});
}

function openBulkPlanDate(planIds,onSaved,title='批量调整计划日期'){
  showModal(title,`<form id="schedule-bulk-form"><div class="field"><label>新的计划交付日期 *</label><input type="date" name="plannedDeliveryDate" required autofocus></div><p class="form-hint">将同时调整已选择的 ${planIds.length} 条车型交付计划。</p></form>`,{
    submitText:'确认调整',
    onSubmit:async close=>{
      const form=byId('schedule-bulk-form');
      if(!form.reportValidity())throw new Error('请选择计划交付日期。');
      await updateDeliveryPlanDates(planIds,new FormData(form).get('plannedDeliveryDate'));
      close();
      toast(`已更新 ${planIds.length} 条交付计划。`);
      await onSaved();
    }
  });
}

function openAddDeliveryPlans(data,onSaved){
  const existing=new Set((data.items||[]).map(x=>Number(x.categoryId)));
  const candidates=(data.categories||[]).filter(x=>x.canEdit&&!existing.has(Number(x.id)));
  if(!candidates.length){toast('当前车型下没有可新增的交付物类别。');return;}
  const groups=groupDeliveryPlanItems(candidates.map(x=>({...x,categoryId:x.id,categoryName:x.name,categoryCode:x.code})));
  const groupHtml=groups.map(group=>`<section class="schedule-add-group" data-add-group="${group.typeId}"><div class="schedule-add-group-head"><label class="schedule-group-check"><input type="checkbox" class="schedule-add-group-check" data-type-id="${group.typeId}"><span><strong>${esc(group.typeName)}</strong><small>${group.items.length} 个可选类别</small></span></label><label class="schedule-group-date"><span>整组日期</span><input type="date" class="schedule-add-group-date" data-type-id="${group.typeId}" title="填写后将自动选择并填充本组全部类别"></label></div><div class="schedule-add-list">${group.items.map(item=>`<div class="schedule-add-row" data-search="${esc(`${group.typeName} ${item.categoryName} ${item.categoryCode}`.toLowerCase())}" data-type-id="${group.typeId}"><label class="schedule-add-main"><input type="checkbox" class="schedule-add-check" value="${item.categoryId}"><span><strong>${esc(item.categoryName)}</strong><small>${esc(item.categoryCode)}</small></span></label><div class="schedule-add-date-wrap"><span>计划日期</span><input type="date" class="schedule-add-date" data-category-id="${item.categoryId}" aria-label="${esc(item.categoryName)}计划交付日期"></div></div>`).join('')}</div></section>`).join('');
  const modal=showModal('添加交付计划',`<form id="schedule-add-form"><div class="schedule-add-toolbar"><div class="schedule-add-title"><strong>批量编排交付类别</strong><span id="schedule-add-selected">尚未选择类别</span></div><div class="field schedule-add-search"><label>快速查找</label><input id="schedule-add-search" placeholder="输入类型、类别名称或编码"></div><div class="schedule-add-hint">填写“整组日期”可一次选中整组并填充日期；个别类别可在右侧单独覆盖。</div></div><div class="schedule-add-groups">${groupHtml}</div></form>`,{
    submitText:'添加到计划',
    onSubmit:async close=>{
      const selected=[...modal.root.querySelectorAll('.schedule-add-check:checked')];
      if(!selected.length)throw new Error('请至少选择一个交付物类别。');
      const items=selected.map(check=>{
        const categoryId=Number(check.value);
        const date=modal.root.querySelector(`.schedule-add-date[data-category-id="${categoryId}"]`)?.value||'';
        return{categoryId,plannedDeliveryDate:date};
      });
      const missing=items.find(x=>!x.plannedDeliveryDate);
      if(missing){
        modal.root.querySelector(`.schedule-add-date[data-category-id="${missing.categoryId}"]`)?.focus();
        throw new Error('请为所有已选择类别设置计划交付日期。');
      }
      await createDeliveryPlans(Number(data.selectedProjectId),items);
      close();
      toast(`已添加 ${items.length} 条交付计划。`);
      await onSaved();
    }
  });
  modal.root.classList.add('schedule-plan-modal');

  const refreshSelectedCount=()=>{
    const count=modal.root.querySelectorAll('.schedule-add-check:checked').length;
    const label=modal.root.querySelector('#schedule-add-selected');
    if(label)label.textContent=count?`已选择 ${count} 项`:'尚未选择类别';
  };
  const refreshGroupCheck=typeId=>{
    const rows=[...modal.root.querySelectorAll(`.schedule-add-row[data-type-id="${typeId}"]:not(.hidden)`)];
    const groupCheck=modal.root.querySelector(`.schedule-add-group-check[data-type-id="${typeId}"]`);
    if(!groupCheck||!rows.length)return;
    const checks=rows.map(row=>row.querySelector('.schedule-add-check'));
    groupCheck.checked=checks.every(x=>x.checked);
    groupCheck.indeterminate=!groupCheck.checked&&checks.some(x=>x.checked);
  };
  modal.root.querySelectorAll('.schedule-add-group-check').forEach(check=>check.onchange=()=>{
    const typeId=check.dataset.typeId;
    modal.root.querySelectorAll(`.schedule-add-row[data-type-id="${typeId}"]:not(.hidden) .schedule-add-check`).forEach(x=>x.checked=check.checked);
    refreshSelectedCount();
  });
  modal.root.querySelectorAll('.schedule-add-group-date').forEach(input=>input.onchange=()=>{
    if(!input.value)return;
    const typeId=input.dataset.typeId;
    modal.root.querySelectorAll(`.schedule-add-row[data-type-id="${typeId}"]`).forEach(row=>{
      row.querySelector('.schedule-add-check').checked=true;
      row.querySelector('.schedule-add-date').value=input.value;
    });
    refreshGroupCheck(typeId);
    refreshSelectedCount();
  });
  modal.root.querySelectorAll('.schedule-add-check').forEach(check=>check.onchange=()=>{
    refreshGroupCheck(check.closest('.schedule-add-row').dataset.typeId);
    refreshSelectedCount();
  });
  modal.root.querySelectorAll('.schedule-add-date').forEach(input=>input.onchange=()=>{
    if(input.value)input.closest('.schedule-add-row').querySelector('.schedule-add-check').checked=true;
    refreshGroupCheck(input.closest('.schedule-add-row').dataset.typeId);
    refreshSelectedCount();
  });
  byId('schedule-add-search').oninput=event=>{
    const keyword=event.target.value.trim().toLowerCase();
    modal.root.querySelectorAll('.schedule-add-row').forEach(row=>row.classList.toggle('hidden',keyword&&!row.dataset.search.includes(keyword)));
    modal.root.querySelectorAll('.schedule-add-group').forEach(group=>{
      const visible=[...group.querySelectorAll('.schedule-add-row')].some(row=>!row.classList.contains('hidden'));
      group.classList.toggle('hidden',!visible);
      if(visible)refreshGroupCheck(group.dataset.addGroup);
    });
  };
  refreshSelectedCount();
}

async function renderDeliverySchedules(initialStatus='',projectOverride=null){
  setPage('交付计划','按车型管理应交付类别、计划节点与实际交付状态');
  if(projectOverride)state.scheduleProjectId=Number(projectOverride);
  state.scheduleProjectId ||= null;
  state.scheduleStatusFilter=initialStatus||state.scheduleStatusFilter||'';
  state.scheduleKeyword ??='';
  state.schedulePendingOnly ??=false;

  const query=state.scheduleProjectId?`?projectId=${state.scheduleProjectId}`:'';
  const data=await api(`/internal/delivery-schedules${query}`);
  state.scheduleProjectId=data.selectedProjectId||null;

  const hasEditPermission=hasPermission('DELIVERY_SCHEDULE_EDIT');
  const existingCategories=new Set((data.items||[]).map(x=>Number(x.categoryId)));
  const canAdd=hasEditPermission&&(data.categories||[]).some(x=>x.canEdit&&!existingCategories.has(Number(x.id)));
  const hasEditableRows=hasEditPermission&&(data.items||[]).some(x=>x.canEdit);
  const currentProject=(data.projects||[]).find(x=>Number(x.id)===Number(data.selectedProjectId))||null;
  const projectOptions=(data.projects||[]).map(p=>`<option value="${p.id}" ${Number(p.id)===Number(data.selectedProjectId)?'selected':''}>${esc(p.vehicleModel?`${p.vehicleModel} · ${p.name}`:p.name)}</option>`).join('');
  const filters=[['','全部状态'],['DUE_SOON','即将到期'],['OVERDUE_UNDELIVERED','延期未交付'],['LATE_DELIVERED','延期交付'],['ON_TIME_DELIVERED','正常交付'],['UPCOMING','未到期']];
  const filterOptions=filters.map(([value,name])=>`<option value="${value}" ${state.scheduleStatusFilter===value?'selected':''}>${name}</option>`).join('');

  const allItems=data.items||[];
  const delivered=Number(data.summary.onTimeDelivered||0)+Number(data.summary.lateDelivered||0);
  const pending=Math.max(0,Number(data.summary.total||0)-delivered);
  const completion=Number(data.summary.total||0)>0?Math.round(delivered/Number(data.summary.total)*100):0;
  const statusCard=(label,value,status,desc,tone)=>`<button type="button" class="schedule-risk-card schedule-risk-${tone} ${state.scheduleStatusFilter===status?'active':''}" data-schedule-status="${status}"><span class="schedule-risk-icon"></span><span class="schedule-risk-copy"><small>${esc(label)}</small><strong>${Number(value||0)}</strong><em>${esc(desc)}</em></span></button>`;

  const matchesPending=row=>['UPCOMING','DUE_SOON','OVERDUE_UNDELIVERED'].includes(row.status);
  const visible=allItems.filter(x=>(!state.scheduleStatusFilter||x.status===state.scheduleStatusFilter)&&(!state.schedulePendingOnly||matchesPending(x)));
  const groups=groupDeliveryPlanItems(visible);
  const rows=groups.length?groups.map(group=>{
    const editableGroup=group.items.some(x=>x.canEdit);
    const riskCount=group.items.filter(x=>x.status==='DUE_SOON'||x.status==='OVERDUE_UNDELIVERED').length;
    const deliveredCount=group.items.filter(x=>x.status==='LATE_DELIVERED'||x.status==='ON_TIME_DELIVERED').length;
    const groupSummary=riskCount?`<span class="schedule-group-risk">${riskCount} 项风险</span>`:`<span class="schedule-group-ok">${deliveredCount===group.items.length&&group.items.length?'全部完成':'当前无风险'}</span>`;
    return `<tr class="schedule-group-row" data-schedule-group="${group.typeId}"><td>${editableGroup?`<input type="checkbox" class="schedule-group-main-check" data-type-id="${group.typeId}" title="选择本组可编辑项">`:''}</td><td colspan="4"><div class="schedule-group-title"><span><strong>${esc(group.typeName)}</strong><small>${esc(group.typeCode)} · ${group.items.length} 项</small></span>${groupSummary}</div></td></tr>${group.items.map(row=>{
      const actual=row.actualDeliveryDate?String(row.actualDeliveryDate).slice(0,10):'';
      return `<tr class="schedule-data-row schedule-row-${deliveryScheduleTone(row.status)}" data-schedule-row="${row.id}" data-type-id="${row.typeId}" data-search="${esc(`${row.typeName} ${row.categoryName} ${row.categoryCode}`.toLowerCase())}"><td>${row.canEdit?`<input type="checkbox" class="schedule-row-check" value="${row.id}">`:''}</td><td><div class="schedule-category"><strong>${esc(row.categoryName)}</strong><small>${esc(row.categoryCode)}${row.matchedDeliverables?` · 匹配 ${row.matchedDeliverables} 条台账`:' · 尚无对应台账'}</small></div></td><td><div class="schedule-node-flow"><div class="schedule-node"><small>计划</small>${row.canEdit?`<input type="date" class="schedule-date-input" data-id="${row.id}" value="${esc(row.plannedDeliveryDate)}">`:`<strong>${esc(row.plannedDeliveryDate)}</strong>`}</div><span class="schedule-node-arrow">→</span><div class="schedule-node schedule-node-actual"><small>实际</small><strong>${esc(actual||'—')}</strong></div>${deliveryScheduleDelta(row)}</div></td><td>${deliveryScheduleStatusVisual(row)}</td><td>${row.canEdit?`<button type="button" class="schedule-row-action schedule-delete-one" data-id="${row.id}" data-name="${esc(row.categoryName)}" title="删除计划">删除</button>`:'—'}</td></tr>`;
    }).join('')}`;
  }).join(''):`<tr><td colspan="5"><div class="schedule-empty"><strong>${allItems.length?'没有符合当前筛选条件的计划项':'当前车型尚未配置交付计划'}</strong><span>${allItems.length?'可清除状态、待交付或搜索条件后继续查看。':'添加交付物类别并同时设置计划日期即可开始跟踪。'}</span>${canAdd&&!allItems.length?'<button type="button" class="btn btn-primary" id="schedule-empty-add">+ 添加交付计划</button>':''}</div></td></tr>`;

  const heroTitle=currentProject?(currentProject.vehicleModel||currentProject.name):'暂无可查看车型';
  const heroSubtitle=currentProject?`${currentProject.name}${currentProject.code?` · ${currentProject.code}`:''}`:'当前账号没有可查看的车型交付计划';
  content.innerHTML=`
    <section class="schedule-hero">
      <div class="schedule-hero-main">
        <div class="schedule-context-kicker">当前车型</div>
        <div class="schedule-context-title"><h2>${esc(heroTitle)}</h2><select id="schedule-project" aria-label="切换车型">${projectOptions}</select></div>
        <p>${esc(heroSubtitle)}</p>
        <div class="schedule-hero-metrics">
          <span><small>计划项</small><strong>${Number(data.summary.total||0)}</strong></span>
          <span><small>已交付</small><strong>${delivered}</strong></span>
          <span><small>待交付</small><strong>${pending}</strong></span>
          <span class="schedule-completion"><small>完成率</small><strong>${completion}%</strong><i><b style="width:${completion}%"></b></i></span>
        </div>
      </div>
      <div class="schedule-hero-actions">
        <span>提前 ${data.warningDays} 天预警${Number(data.summary.available||0)>0?` · 还有 ${Number(data.summary.available)} 个类别可添加`:''}</span>
        ${canAdd?'<button type="button" id="schedule-add" class="btn btn-primary">+ 添加交付计划</button>':''}
      </div>
    </section>

    <section class="schedule-risk-grid">
      ${statusCard('即将到期',data.summary.dueSoon,'DUE_SOON',`未来 ${data.warningDays} 天需要关注`,'warning')}
      ${statusCard('延期未交付',data.summary.overdueUndelivered,'OVERDUE_UNDELIVERED','当前最需要处理','danger')}
      ${statusCard('延期交付',data.summary.lateDelivered,'LATE_DELIVERED','已交付但晚于计划','late')}
      ${statusCard('正常交付',data.summary.onTimeDelivered,'ON_TIME_DELIVERED','按期或提前完成','success')}
    </section>

    <section class="card schedule-toolbar-card"><div class="card-body"><div class="schedule-toolbar">
      <div class="schedule-search-box"><span>⌕</span><input id="schedule-search" value="${esc(state.scheduleKeyword)}" placeholder="搜索交付物类型 / 类别 / 编码"></div>
      <select id="schedule-status-filter" class="schedule-filter-select">${filterOptions}</select>
      <label class="schedule-pending-toggle"><input type="checkbox" id="schedule-pending-only" ${state.schedulePendingOnly?'checked':''}><span>仅看待交付</span></label>
      ${(state.scheduleStatusFilter||state.schedulePendingOnly||state.scheduleKeyword)?'<button type="button" class="schedule-clear-filter" id="schedule-clear-filter">清除筛选</button>':''}
    </div></div></section>

    <section class="card schedule-table-card"><div class="card-head"><div><h3>车型交付计划</h3><p class="muted section-note">计划日期 → 实际首次交付日期 → 时间差。实际日期自动取同车型、同类别台账中最早的首个版本创建时间。</p></div></div><div class="table-wrap"><table class="schedule-table"><thead><tr><th style="width:42px">${hasEditableRows?'<input type="checkbox" id="schedule-check-all" title="全选当前可编辑结果">':''}</th><th>交付物类别</th><th>交付节点</th><th>状态</th><th style="width:72px">操作</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    ${hasEditableRows?'<div class="schedule-selection-bar hidden" id="schedule-selection-bar"><div><strong id="schedule-selected-count">已选择 0 项</strong><span>批量操作仅作用于当前可编辑项</span></div><div><button type="button" id="schedule-bulk-set" class="btn btn-light btn-sm">批量改期</button><button type="button" id="schedule-bulk-delete" class="btn btn-danger btn-sm">删除计划</button><button type="button" id="schedule-selection-clear" class="schedule-selection-close" title="取消选择">×</button></div></div>':''}`;

  byId('schedule-project')?.addEventListener('change',async event=>{
    state.scheduleProjectId=Number(event.target.value)||null;
    state.scheduleStatusFilter='';
    state.scheduleKeyword='';
    state.schedulePendingOnly=false;
    await renderDeliverySchedules('');
  });
  byId('schedule-status-filter')?.addEventListener('change',async event=>{
    state.scheduleStatusFilter=event.target.value;
    await renderDeliverySchedules(event.target.value);
  });
  byId('schedule-pending-only')?.addEventListener('change',async event=>{
    state.schedulePendingOnly=event.target.checked;
    await renderDeliverySchedules(state.scheduleStatusFilter);
  });
  byId('schedule-clear-filter')?.addEventListener('click',async()=>{
    state.scheduleStatusFilter='';
    state.schedulePendingOnly=false;
    state.scheduleKeyword='';
    await renderDeliverySchedules('');
  });
  content.querySelectorAll('[data-schedule-status]').forEach(button=>button.onclick=async()=>{
    state.scheduleStatusFilter=state.scheduleStatusFilter===button.dataset.scheduleStatus?'':(button.dataset.scheduleStatus||'');
    await renderDeliverySchedules(state.scheduleStatusFilter);
  });

  let refreshSelection=()=>{};
  const applyScheduleSearch=value=>{
    state.scheduleKeyword=value;
    const keyword=value.trim().toLowerCase();
    content.querySelectorAll('tr[data-schedule-row]').forEach(row=>{
      const hidden=!!keyword&&!row.dataset.search.includes(keyword);
      row.classList.toggle('hidden',hidden);
      const check=row.querySelector('.schedule-row-check');
      if(hidden&&check)check.checked=false;
    });
    content.querySelectorAll('[data-schedule-group]').forEach(groupRow=>{
      const typeId=groupRow.dataset.scheduleGroup;
      const groupRows=[...content.querySelectorAll(`tr[data-type-id="${typeId}"][data-schedule-row]`)];
      const visibleRows=groupRows.filter(row=>!row.classList.contains('hidden'));
      groupRow.classList.toggle('hidden',!visibleRows.length);
    });
    refreshSelection();
  };
  byId('schedule-search')?.addEventListener('input',event=>applyScheduleSearch(event.target.value));
  applyScheduleSearch(state.scheduleKeyword);

  const refresh=()=>renderDeliverySchedules(state.scheduleStatusFilter);
  if(canAdd){
    byId('schedule-add')?.addEventListener('click',()=>openAddDeliveryPlans(data,refresh));
    byId('schedule-empty-add')?.addEventListener('click',()=>openAddDeliveryPlans(data,refresh));
  }
  if(!hasEditableRows)return;

  const selectedIds=()=>[...content.querySelectorAll('tr[data-schedule-row]:not(.hidden) .schedule-row-check:checked')].map(x=>Number(x.value));
  refreshSelection=()=>{
    const ids=selectedIds();
    const bar=byId('schedule-selection-bar');
    if(bar)bar.classList.toggle('hidden',!ids.length);
    if(byId('schedule-selected-count'))byId('schedule-selected-count').textContent=`已选择 ${ids.length} 项`;
    content.querySelectorAll('.schedule-group-main-check').forEach(groupCheck=>{
      const checks=[...content.querySelectorAll(`tr[data-type-id="${groupCheck.dataset.typeId}"]:not(.hidden) .schedule-row-check`)];
      groupCheck.checked=checks.length>0&&checks.every(x=>x.checked);
      groupCheck.indeterminate=!groupCheck.checked&&checks.some(x=>x.checked);
    });
    const all=[...content.querySelectorAll('tr[data-schedule-row]:not(.hidden) .schedule-row-check')];
    const allCheck=byId('schedule-check-all');
    if(allCheck){
      allCheck.checked=all.length>0&&all.every(x=>x.checked);
      allCheck.indeterminate=!allCheck.checked&&all.some(x=>x.checked);
    }
  };
  refreshSelection();

  content.querySelectorAll('.schedule-row-check').forEach(check=>check.onchange=refreshSelection);
  content.querySelectorAll('.schedule-group-main-check').forEach(check=>check.onchange=()=>{
    content.querySelectorAll(`tr[data-type-id="${check.dataset.typeId}"]:not(.hidden) .schedule-row-check`).forEach(x=>x.checked=check.checked);
    refreshSelection();
  });
  byId('schedule-check-all')?.addEventListener('change',event=>{
    content.querySelectorAll('tr[data-schedule-row]:not(.hidden) .schedule-row-check').forEach(x=>x.checked=event.target.checked);
    refreshSelection();
  });
  byId('schedule-selection-clear')?.addEventListener('click',()=>{
    content.querySelectorAll('.schedule-row-check:checked').forEach(x=>x.checked=false);
    refreshSelection();
  });

  content.querySelectorAll('.schedule-date-input').forEach(input=>input.onchange=async()=>{
    const previous=allItems.find(x=>Number(x.id)===Number(input.dataset.id))?.plannedDeliveryDate||'';
    if(!input.value){
      input.value=previous;
      toast('计划项必须保留计划交付日期；如不再跟踪请使用“删除”。','error');
      return;
    }
    input.disabled=true;
    try{
      await updateDeliveryPlanDates([Number(input.dataset.id)],input.value);
      toast('计划交付日期已更新。');
      await refresh();
    }catch(error){
      toast(error.message,'error');
      input.value=previous;
      input.disabled=false;
    }
  });
  byId('schedule-bulk-set').onclick=()=>openBulkPlanDate(selectedIds(),refresh);
  const deleteSelected=async ids=>{
    const result=await confirmAction('删除交付计划',`确认删除已选择的 ${ids.length} 条车型交付计划吗？仅删除计划项，不会删除交付物类别或台账数据。`,{submitText:'确认删除',danger:true});
    if(!result.confirmed)return;
    await deleteDeliveryPlans(ids);
    toast(`已删除 ${ids.length} 条交付计划。`);
    await refresh();
  };
  byId('schedule-bulk-delete').onclick=()=>deleteSelected(selectedIds());
  content.querySelectorAll('.schedule-delete-one').forEach(button=>button.onclick=async()=>{
    const result=await confirmAction('删除交付计划',`确认删除“${button.dataset.name}”的车型交付计划吗？不会删除基础类别或交付物台账。`,{submitText:'确认删除',danger:true});
    if(!result.confirmed)return;
    await deleteDeliveryPlans([Number(button.dataset.id)]);
    toast('交付计划已删除。');
    await refresh();
  });
}

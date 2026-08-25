const deliveryScheduleStatusNames={UNSET:'未设置',UPCOMING:'未到期',DUE_SOON:'即将到期',OVERDUE_UNDELIVERED:'延期未交付',LATE_DELIVERED:'延期交付',ON_TIME_DELIVERED:'正常交付'};

function deliveryScheduleStatusText(row){
  switch(row.status){
    case 'DUE_SOON': return row.days===0?'今天到期':`${row.days}天后到期`;
    case 'OVERDUE_UNDELIVERED': return `已延期${row.days}天`;
    case 'LATE_DELIVERED': return `延期${row.days}天交付`;
    case 'ON_TIME_DELIVERED': return row.days===0?'按期交付':`提前${Math.abs(row.days||0)}天交付`;
    case 'UPCOMING': return `还有${row.days}天`;
    default:return deliveryScheduleStatusNames[row.status]||row.status;
  }
}
function deliveryScheduleBadge(row){
  const cls={DUE_SOON:'in_review',OVERDUE_UNDELIVERED:'deprecated',LATE_DELIVERED:'deprecated',ON_TIME_DELIVERED:'released',UPCOMING:'active',UNSET:''}[row.status]||'';
  return `<span class="badge ${cls}">${esc(deliveryScheduleStatusText(row))}</span>`;
}
async function saveDeliverySchedule(deliverableIds,plannedDeliveryDate){
  await api('/internal/delivery-schedules',{method:'PUT',body:JSON.stringify({deliverableIds,plannedDeliveryDate:plannedDeliveryDate||null,operator:operatorName()})});
}
async function openBulkScheduleDate(ids,onSaved,title='批量设置计划交付日期'){
  showModal(title,`<form id="schedule-bulk-form"><div class="field"><label>计划交付日期 *</label><input type="date" name="plannedDeliveryDate" required></div><p class="form-hint">将同时更新 ${ids.length} 项交付物。</p></form>`,{submitText:'保存',onSubmit:async close=>{const form=byId('schedule-bulk-form');if(!form.reportValidity())throw new Error('请选择计划交付日期。');await saveDeliverySchedule(ids,new FormData(form).get('plannedDeliveryDate'));close();toast(`已更新 ${ids.length} 项交付计划。`);await onSaved();}});
}
async function renderDeliverySchedules(initialStatus=''){
  setPage('交付计划','按车型集中编排交付节点，并自动识别到期与延期状态');
  state.scheduleProjectId ||= null;
  state.scheduleStatusFilter=initialStatus||state.scheduleStatusFilter||'';
  const query=state.scheduleProjectId?`?projectId=${state.scheduleProjectId}`:'';
  const data=await api(`/internal/delivery-schedules${query}`);
  state.scheduleProjectId=data.selectedProjectId||null;
  const canEdit=hasPermission('DELIVERY_SCHEDULE_EDIT');
  const projectOptions=(data.projects||[]).map(p=>`<option value="${p.id}" ${Number(p.id)===Number(data.selectedProjectId)?'selected':''}>${esc(p.vehicleModel?`${p.vehicleModel} · ${p.name}`:p.name)}</option>`).join('');
  const filters=[['','全部状态'],['UNSET','仅看未设置'],['DUE_SOON','即将到期'],['OVERDUE_UNDELIVERED','延期未交付'],['LATE_DELIVERED','延期交付'],['ON_TIME_DELIVERED','正常交付'],['UPCOMING','未到期']];
  const filterOptions=filters.map(([v,n])=>`<option value="${v}" ${state.scheduleStatusFilter===v?'selected':''}>${n}</option>`).join('');
  const visible=(data.items||[]).filter(x=>!state.scheduleStatusFilter||x.status===state.scheduleStatusFilter);
  const groups=[];for(const row of visible){let g=groups.find(x=>x.typeId===row.typeId);if(!g){g={typeId:row.typeId,typeName:row.typeName,items:[]};groups.push(g);}g.items.push(row);}
  const stat=(label,value,status,help)=>`<button type="button" class="stat-card" data-schedule-status="${status}" style="text-align:left;border:0;cursor:pointer"><span>${esc(label)}</span><strong>${Number(value||0)}</strong><small>${esc(help)}</small></button>`;
  content.innerHTML=`
    <section class="card" style="margin-bottom:18px"><div class="card-body">
      <div class="filter-bar" style="align-items:end">
        <div class="field" style="min-width:260px"><label>车型 / 项目</label><select id="schedule-project">${projectOptions}</select></div>
        <div class="field" style="min-width:180px"><label>状态筛选</label><select id="schedule-status-filter">${filterOptions}</select></div>
        <div style="margin-left:auto" class="muted">预警窗口：计划日期前 ${data.warningDays} 天</div>
      </div>
    </div></section>
    <section class="stat-grid" style="margin-bottom:18px">
      ${stat('交付物总数',data.summary.total,'','项')}
      ${stat('已设置',data.summary.configured,'','项')}
      ${stat('未设置',data.summary.unset,'UNSET','项')}
      ${stat('即将到期',data.summary.dueSoon,'DUE_SOON','项')}
      ${stat('延期未交付',data.summary.overdueUndelivered,'OVERDUE_UNDELIVERED','项')}
      ${stat('延期交付',data.summary.lateDelivered,'LATE_DELIVERED','项')}
      ${stat('正常交付',data.summary.onTimeDelivered,'ON_TIME_DELIVERED','项')}
    </section>
    <section class="card"><div class="card-head"><div><h3>交付物计划</h3><p class="muted section-note">实际交付日期取该交付物第一个版本的创建时间，与版本是否正式发布无关。</p></div>${canEdit?'<div class="inline-actions"><button type="button" id="schedule-bulk-set" class="btn btn-primary" disabled>批量设置日期</button><button type="button" id="schedule-bulk-clear" class="btn btn-light" disabled>清除日期</button></div>':''}</div>
      <div class="table-wrap"><table><thead><tr><th style="width:38px">${canEdit?'<input type="checkbox" id="schedule-check-all">':''}</th><th>交付物</th><th>类别</th><th>责任人</th><th>计划交付日期</th><th>实际交付日期</th><th>状态</th></tr></thead><tbody>
      ${groups.length?groups.map(g=>`<tr><td colspan="7" style="background:#f8fafc"><div style="display:flex;align-items:center;justify-content:space-between"><strong>${esc(g.typeName)}（${g.items.length}）</strong>${canEdit?`<button type="button" class="btn btn-light btn-sm" data-group-set="${g.typeId}">设置整组日期</button>`:''}</div></td></tr>${g.items.map(x=>`<tr data-schedule-row="${x.id}"><td>${canEdit?`<input type="checkbox" class="schedule-row-check" value="${x.id}">`:''}</td><td><strong>${esc(x.name)}</strong><small style="display:block" class="muted">${esc(x.code)}</small></td><td>${esc(x.categoryName)}</td><td>${esc(x.responsiblePerson||'—')}</td><td>${canEdit?`<input type="date" class="schedule-date-input" data-id="${x.id}" value="${esc(x.plannedDeliveryDate||'')}" style="min-width:145px">`:esc(x.plannedDeliveryDate||'—')}</td><td>${esc(x.actualDeliveryDate?String(x.actualDeliveryDate).slice(0,10):'—')}</td><td>${deliveryScheduleBadge(x)}</td></tr>`).join('')}`).join(''):'<tr><td colspan="7"><div class="empty">当前筛选条件下没有交付物。</div></td></tr>'}
      </tbody></table></div></section>`;
  byId('schedule-project')?.addEventListener('change',async e=>{state.scheduleProjectId=Number(e.target.value)||null;state.scheduleStatusFilter='';await renderDeliverySchedules('');});
  byId('schedule-status-filter')?.addEventListener('change',async e=>{state.scheduleStatusFilter=e.target.value;await renderDeliverySchedules(e.target.value);});
  content.querySelectorAll('[data-schedule-status]').forEach(b=>b.onclick=async()=>{state.scheduleStatusFilter=b.dataset.scheduleStatus||'';await renderDeliverySchedules(state.scheduleStatusFilter);});
  if(!canEdit)return;
  const checks=()=>[...content.querySelectorAll('.schedule-row-check:checked')].map(x=>Number(x.value));
  const refreshButtons=()=>{const ids=checks();byId('schedule-bulk-set').disabled=!ids.length;byId('schedule-bulk-clear').disabled=!ids.length;};
  content.querySelectorAll('.schedule-row-check').forEach(x=>x.onchange=refreshButtons);
  byId('schedule-check-all')?.addEventListener('change',e=>{content.querySelectorAll('.schedule-row-check').forEach(x=>x.checked=e.target.checked);refreshButtons();});
  content.querySelectorAll('.schedule-date-input').forEach(input=>input.onchange=async()=>{try{await saveDeliverySchedule([Number(input.dataset.id)],input.value||null);toast(input.value?'计划交付日期已更新。':'计划交付日期已清除。');await renderDeliverySchedules(state.scheduleStatusFilter);}catch(error){toast(error.message,'error');await renderDeliverySchedules(state.scheduleStatusFilter);}});
  content.querySelectorAll('[data-group-set]').forEach(button=>button.onclick=()=>{const ids=(data.items||[]).filter(x=>x.typeId===Number(button.dataset.groupSet)).map(x=>x.id);openBulkScheduleDate(ids,()=>renderDeliverySchedules(state.scheduleStatusFilter),`设置${button.closest('tr').querySelector('strong').textContent}日期`);});
  byId('schedule-bulk-set').onclick=()=>openBulkScheduleDate(checks(),()=>renderDeliverySchedules(state.scheduleStatusFilter));
  byId('schedule-bulk-clear').onclick=async()=>{const ids=checks();const result=await confirmAction('清除计划交付日期',`确认清除已选择的 ${ids.length} 项计划日期吗？`,{submitText:'确认清除',danger:true});if(!result.confirmed)return;await saveDeliverySchedule(ids,null);toast(`已清除 ${ids.length} 项计划日期。`);await renderDeliverySchedules(state.scheduleStatusFilter);};
}

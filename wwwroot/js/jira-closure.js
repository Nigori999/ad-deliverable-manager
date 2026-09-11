// Closure comparisons use server-local calendar boundaries and raw server timing judgments.
const JIRA_DAY_MS = 86400000;

function jiraClosureSummary(issues) {
  const closed = issues.filter(x => x.stageCode === 'closed');
  const assessed = closed.filter(x => typeof x.isOnTime === 'boolean');
  const onTime = assessed.filter(x => x.isOnTime).length;
  return { onTimeClosed:onTime, assessedClosed:assessed.length, unassessableClosed:closed.length-assessed.length,
    onTimeRate:assessed.length ? onTime*100/assessed.length : null };
}

function jiraCalendarOffset(value) {
  const match = String(value).match(/([+-])(\d{2}):(\d{2})$/);
  return match ? (match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3]))*60000 : 0;
}

function jiraPeriodStart(value, unit) {
  const d = new Date(value);
  d.setUTCHours(0,0,0,0);
  if (unit==='week') d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  if (unit==='month') d.setUTCDate(1);
  if (unit==='year') { d.setUTCMonth(0,1); }
  return d.valueOf();
}

function jiraShiftPeriod(value, unit, count) {
  const d = new Date(value);
  if (unit==='week') d.setUTCDate(d.getUTCDate()+count*7);
  if (unit==='month') d.setUTCMonth(d.getUTCMonth()+count);
  if (unit==='year') d.setUTCFullYear(d.getUTCFullYear()+count);
  return d.valueOf();
}

function jiraIsoWeek(value) {
  const thursday = new Date(jiraPeriodStart(value,'week')+3*JIRA_DAY_MS);
  const year = thursday.getUTCFullYear();
  const first = jiraPeriodStart(Date.UTC(year,0,4),'week');
  return { year, week:Math.round((jiraPeriodStart(value,'week')-first)/(7*JIRA_DAY_MS))+1 };
}

function jiraComparisonStart(start, unit, mode) {
  if (mode==='mom' || unit==='year') return jiraShiftPeriod(start,unit,-1);
  if (unit==='month') return jiraShiftPeriod(start,'year',-1);
  const {year,week} = jiraIsoWeek(start);
  const previous = jiraPeriodStart(Date.UTC(year-1,0,4),'week')+(week-1)*7*JIRA_DAY_MS;
  return jiraIsoWeek(previous).year===year-1 ? previous : null;
}

function jiraPeriodLabel(start,unit) {
  if (unit==='week') { const x=jiraIsoWeek(start); return `${x.year} W${String(x.week).padStart(2,'0')}`; }
  return new Date(start).toISOString().slice(0,unit==='year'?4:7);
}

function jiraPeriodSample(issues,start,end,offset) {
  if (start===null || end===null) return { rate:null,days:null,onTime:0,assessed:0,unknown:0,count:0,durationCount:0,issues:[],start,end };
  const samples=[];
  for (const issue of issues) {
    const events=(issue.closureEvents||[]).filter(event => {
      const closed=Date.parse(event.closedAt)+offset;
      return closed>=start && closed<end && (!event.reopenedAt || Date.parse(event.reopenedAt)+offset>=end);
    });
    const event=events.at(-1);
    if (event) samples.push({...issue,stageCode:'closed',closedAt:event.closedAt,closureElapsedDays:event.elapsedDays,
      isOnTime:event.isOnTime,timingReliable:event.timingReliable,stageTimings:[],
      closureOverdueDays:event.isOnTime===false ? Math.max(1,Math.ceil(event.elapsedDays-issue.closureLimitDays)) : 0});
    else if (issue.stageCode==='closed' && !issue.timingReliable && issue.closedAt) {
      const closed=Date.parse(issue.closedAt)+offset;
      if (closed>=start && closed<end) samples.push({...issue,isOnTime:null,timingReliable:false,stageTimings:[]});
    }
  }
  const assessed=samples.filter(x=>typeof x.isOnTime==='boolean');
  const durations=samples.filter(x=>x.timingReliable && Number.isFinite(x.closureElapsedDays));
  const onTime=assessed.filter(x=>x.isOnTime).length;
  return {rate:assessed.length?onTime*100/assessed.length:null,
    days:durations.length?durations.reduce((sum,x)=>sum+x.closureElapsedDays,0)/durations.length:null,
    onTime,assessed:assessed.length,unknown:samples.length-assessed.length,count:samples.length,
    durationCount:durations.length,issues:samples,start,end};
}

function jiraClosureComparisons(data,unit,mode,dateFrom,dateTo) {
  const stamp=data.effectiveCutoff || data.generatedAt;
  const offset=jiraCalendarOffset(stamp);
  const cutoff=Date.parse(stamp)+offset+1;
  const from=Date.parse(`${dateFrom}T00:00:00Z`),to=Math.min(Date.parse(`${dateTo}T00:00:00Z`)+JIRA_DAY_MS,cutoff);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from>=to) return [];
  const rows=[];
  const periodCount=unit==='week'?Math.ceil((to-jiraPeriodStart(from,unit))/(7*JIRA_DAY_MS)):
    unit==='month'?(new Date(to-1).getUTCFullYear()-new Date(from).getUTCFullYear())*12+new Date(to-1).getUTCMonth()-new Date(from).getUTCMonth()+1:
    new Date(to-1).getUTCFullYear()-new Date(from).getUTCFullYear()+1;
  if(periodCount>120) return [];
  for(let start=jiraPeriodStart(from,unit);start<to;start=jiraShiftPeriod(start,unit,1)) {
    const next=jiraShiftPeriod(start,unit,1),end=Math.min(next,to);
    const baseStart=jiraComparisonStart(start,unit,mode);
    const baseEnd=baseStart===null?null:(end===next?jiraShiftPeriod(baseStart,unit,1):Math.min(jiraShiftPeriod(baseStart,unit,1),baseStart+end-start));
    rows.push({label:jiraPeriodLabel(start,unit),partial:end<next,
      current:jiraPeriodSample(data.issues,start,end,offset),base:jiraPeriodSample(data.issues,baseStart,baseEnd,offset)});
  }
  return rows;
}

function jiraComparisonRangeText(sample) {
  if (sample.start===null) return '上一年无对应周';
  return `${new Date(sample.start).toISOString().slice(0,10)} ~ ${new Date(sample.end-1).toISOString().slice(0,10)}`;
}

function jiraComparisonChart(rows,metric) {
  if (!rows.length) return jiraNoData('请选择有效范围，每次最多展示120个周期');
  const width=Math.max(540,rows.length*85),height=245,left=48,top=18,plotHeight=170;
  const values=rows.flatMap(r=>[r.current[metric],r.base[metric]]).filter(x=>x!==null);
  if(!values.length) return jiraNoData('该范围暂无可判定样本，请检查查询方案及历史数据');
  const max=metric==='rate'?100:Math.max(1,...values)*1.1;
  const x=i=>left+(i+.5)*(width-left-18)/rows.length,y=v=>top+plotHeight-v/max*plotHeight;
  const line=(kind,color)=>{
    let inSegment=false;
    const path=rows.map((row,i)=>{const v=row[kind][metric];if(v===null){inSegment=false;return '';}const p=`${inSegment?'L':'M'}${x(i)},${y(v)}`;inSegment=true;return p;}).join(' ');
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" ${kind==='base'?'stroke-dasharray="5 4"':''}/>`;
  };
  const grids=Array.from({length:5},(_,i)=>{const v=max*i/4;return `<line x1="${left}" y1="${y(v)}" x2="${width-15}" y2="${y(v)}" stroke="#e8edf5"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${v.toFixed(metric==='rate'?0:1)}${metric==='rate'?'%':''}</text>`;}).join('');
  const dots=rows.map((row,i)=>['current','base'].map(kind=>{
    const sample=row[kind],value=sample[metric];if(value===null)return '';
    const label=`${jiraComparisonRangeText(sample)} ${kind==='current'?'本期':'对比期'}：${value.toFixed(1)}${metric==='rate'?'%':'天'}；按期 ${sample.onTime}/${sample.assessed}，无法判定 ${sample.unknown}，周期有效样本 ${sample.durationCount}`;
    return `<g data-jira-compare-point="${i}" data-kind="${kind}" data-metric="${metric}" role="button" tabindex="0" aria-label="${esc(label)}"><title>${esc(label)}</title><circle cx="${x(i)}" cy="${y(value)}" r="12" fill="transparent"/><circle cx="${x(i)}" cy="${y(value)}" r="4" fill="${kind==='current'?'#3b5ccc':'#e49b43'}"/></g>`;
  }).join('')).join('');
  const latest=rows.at(-1),a=latest.current[metric],b=latest.base[metric];
  const delta=a===null||b===null?'暂无可比数据':metric==='rate'?`${a-b>=0?'+':''}${(a-b).toFixed(1)} 个百分点`:`${a-b>=0?'+':''}${(a-b).toFixed(1)} 天${b===0?'（基期为0，不计算增幅）':` / ${((a-b)/b*100).toFixed(1)}%`}`;
  return `<div class="jira-compare-caption"><span><i class="current"></i>本期 <i class="base"></i>对比期</span><strong>${esc(latest.label)}：${esc(delta)}</strong></div><div class="jira-compare-scroll"><svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="${metric==='rate'?'按期关闭率':'关闭周期'}对比">${grids}${line('base','#e49b43')}${line('current','#3b5ccc')}${dots}${rows.map((r,i)=>`<text x="${x(i)}" y="216" text-anchor="middle">${esc(r.label)}${r.partial?'*':''}</text>`).join('')}</svg></div>`;
}

function renderJiraClosureComparisons(data) {
  const host=byId('jira-closure-comparison');if(!host)return;
  const settings=jiraBoardState.comparison;
  const rows=jiraClosureComparisons(data,settings.unit,settings.mode,settings.from,settings.to);
  host.innerHTML=`<div class="jira-panel-head"><div><h3>关闭效率同比 / 环比</h3><p>按关闭日期归入周期；当前严重等级匹配当前项目时效标准。* 表示未结束周期，对比期按相同进度截取。</p></div></div>
    <div class="jira-compare-controls"><label>统计粒度<select data-compare="unit">${[['week','周'],['month','月'],['year','年']].map(([v,n])=>`<option value="${v}" ${v===settings.unit?'selected':''}>${n}</option>`).join('')}</select></label><label>对比方式<select data-compare="mode"><option value="yoy" ${settings.mode==='yoy'?'selected':''}>同比</option><option value="mom" ${settings.mode==='mom'?'selected':''}>环比</option></select></label><label>起始周期<input type="date" data-compare="from" value="${esc(settings.from)}" max="${esc(data.cutoffDate)}"></label><label>截至日期<input type="date" data-compare="to" value="${esc(settings.to)}" max="${esc(data.cutoffDate)}"></label><button type="button" class="btn btn-light btn-sm" data-compare-apply>更新图表</button></div>
    ${settings.unit==='year'?'<p class="form-hint">按完整年度统计时，同比与环比均以上一年为基期。</p>':''}
    <p class="form-hint">起始日期按所选粒度对齐周期起点，最多展示120个周期。范围仅包含本次查询命中的问题；状态、创建时间等查询条件可能限制历史样本。</p>
    ${data.truncated?'<div class="jira-warning">查询问题数量超过上限，无法形成完整对比。请缩小范围后重新分析。</div>':`<div class="jira-two-column"><section class="jira-compare-card"><h3>按期关闭率${settings.mode==='yoy'?'同比':'环比'}</h3><p>总周期达标的已关闭问题 ÷ 可判定时效的已关闭问题；超期问题计入分母。</p>${jiraComparisonChart(rows,'rate')}</section><section class="jira-compare-card"><h3>关闭周期${settings.mode==='yoy'?'同比':'环比'}</h3><p>周期内已关闭问题的平均创建至关闭天数，包含超期关闭问题。</p>${jiraComparisonChart(rows,'days')}</section></div>`}`;
  host.querySelector('[data-compare-apply]').onclick=()=>{
    const read=key=>host.querySelector(`[data-compare="${key}"]`).value;
    if(!read('from')||!read('to')||read('from')>read('to')||read('to')>data.cutoffDate){toast('请选择有效的起止日期，不能晚于统计截止日期。','error');return;}
    jiraBoardState.comparison={unit:read('unit'),mode:read('mode'),from:read('from'),to:read('to')};
    renderJiraClosureComparisons(data);
  };
  host.querySelectorAll('[data-jira-compare-point]').forEach(point=>{
    const open=()=>{const sample=rows[Number(point.dataset.jiraComparePoint)][point.dataset.kind];
      openJiraDetails(`${jiraComparisonRangeText(sample)} · 已关闭问题（按周期末状态）`,sample.issues,'closure');};
    point.onclick=open;point.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
  });
}

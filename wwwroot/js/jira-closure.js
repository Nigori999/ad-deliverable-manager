// Closure comparisons use server-local calendar boundaries and raw server timing judgments.
const JIRA_DAY_MS = 86400000;

function jiraClosureSummary(issues) {
  const closed = issues.filter(x => x.stageCode === 'closed');
  const assessed = closed.filter(x => typeof x.isOnTime === 'boolean');
  const onTime = assessed.filter(x => x.isOnTime).length;
  const stageResults = closed.map(issue => {
    const stages = issue.stageTimings || [];
    if (stages.some(stage => stage.overdueDays > 0)) return true;
    return stages.length && stages.every(stage => Number.isFinite(stage.overdueDays)) ? false : null;
  });
  return { stageOverdueClosed:stageResults.filter(x => x === true).length,
    unassessableStageClosed:stageResults.filter(x => x === null).length, onTimeClosed:onTime, assessedClosed:assessed.length, unassessableClosed:closed.length-assessed.length,
    onTimeRate:closed.length ? onTime*100/closed.length : null };
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
    // Choose the latest closure operation at period end before testing membership.
    // An earlier closed status must not reappear after a later closure is reopened.
    const event=(issue.closureEvents||[]).filter(x=>Date.parse(x.closedAt)+offset<end)
      .reduce((latest,x)=>!latest||Date.parse(x.closedAt)>=Date.parse(latest.closedAt)?x:latest,null);
    if(!event)continue;
    const closed=Date.parse(event.closedAt)+offset;
    if(closed<start||(event.reopenedAt&&Date.parse(event.reopenedAt)+offset<end))continue;
    samples.push({...issue,stageCode:'closed',closedAt:event.closedAt,closureElapsedDays:event.elapsedDays,
      isOnTime:event.isOnTime,timingReliable:event.timingReliable,stageTimings:[],
      closureOverdueDays:event.isOnTime===false ? Math.max(1,Math.ceil(event.elapsedDays-issue.closureLimitDays)) : 0});
  }
  const assessed=samples.filter(x=>typeof x.isOnTime==='boolean');
  const durations=samples.filter(x=>x.timingReliable && Number.isFinite(x.closureElapsedDays));
  const onTime=assessed.filter(x=>x.isOnTime).length;
  return {rate:samples.length?onTime*100/samples.length:null,
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

function jiraComparisonChange(row,metric) {
  const current=row.current[metric],base=row.base[metric];
  if(!Number.isFinite(current)||!Number.isFinite(base)||(metric==='days'&&base===0))return null;
  return metric==='rate'?current-base:(current-base)/base*100;
}

function jiraComparisonChangeText(row,metric) {
  const change=jiraComparisonChange(row,metric);
  if(change===null)return metric==='days'&&row.base.days===0?'基期为0，不计算变化率':'暂无可比数据';
  const rounded=Number(change.toFixed(1));
  return `${rounded>0?'+':''}${rounded.toFixed(1)}${metric==='rate'?' 个百分点':'%'}`;
}

function jiraComparisonScale(rows,metric) {
  const nice=value=>{
    if(value<=0)return 1;
    const power=10**Math.floor(Math.log10(value)),fraction=value/power;
    return [1,2,5,10].find(step=>step>=fraction)*power;
  };
  const values=rows.flatMap(row=>[row.current[metric],row.base[metric]]).filter(Number.isFinite);
  const changes=rows.map(row=>jiraComparisonChange(row,metric)).filter(Number.isFinite);
  return {maximum:metric==='rate'?100:nice(Math.max(1,...values)),
    changeMaximum:nice(Math.max(1,...changes.map(Math.abs)))};
}

function jiraComparisonTooltip(row,metric,mode) {
  const unit=metric==='rate'?'%':'天',baseName=mode==='yoy'?'去年同期':'上一周期';
  const describe=(sample,name)=>`${name} ${jiraComparisonRangeText(sample)}\n${Number.isFinite(sample[metric])?sample[metric].toFixed(1)+unit:'—（无有效样本）'}；按期 ${sample.onTime}/${sample.count}，总周期无法判定 ${sample.unknown}，周期有效样本 ${sample.durationCount}`;
  return `${row.label}${row.partial?'（未结束周期，按相同进度对比）':''}\n${describe(row.base,baseName)}\n${describe(row.current,'当期')}\n变化：${jiraComparisonChangeText(row,metric)}`;
}

// The export renderer shares both axes with the full chart, even when it splits a long range.
function jiraComparisonSvg(rows,metric,mode,scale=jiraComparisonScale(rows,metric)) {
  const width=Math.max(520,rows.length*116+124),height=330,left=58,right=66,top=48,plotHeight=224;
  const bottom=top+plotHeight,plotWidth=width-left-right,step=plotWidth/rows.length;
  const x=i=>left+(i+.5)*step,y=value=>bottom-value/scale.maximum*plotHeight;
  const changeY=value=>top+plotHeight/2-value/scale.changeMaximum*plotHeight/2;
  const unit=metric==='rate'?'%':'天',changeUnit=metric==='rate'?'百分点':'%';
  const grids=Array.from({length:5},(_,i)=>{
    const value=scale.maximum*i/4,change=-scale.changeMaximum+scale.changeMaximum*i/2,position=bottom-i*plotHeight/4;
    return `<line x1="${left}" y1="${position}" x2="${width-right}" y2="${position}" stroke="#e8edf5"/><text x="${left-8}" y="${position+4}" text-anchor="end">${Number(value.toFixed(2))}</text><text class="jira-compare-change-label" x="${width-right+8}" y="${position+4}">${change>0?'+':''}${Number(change.toFixed(2))}</text>`;
  }).join('');
  const bars=rows.map((row,i)=>['base','current'].map(kind=>{
    const sample=row[kind],value=sample[metric],center=x(i)+(kind==='base'?-25:25),barWidth=28;
    if(!Number.isFinite(value))return `<text x="${center}" y="${bottom-8}" text-anchor="middle">—</text>`;
    const name=kind==='current'?'当期':mode==='yoy'?'去年同期':'上一周期';
    const label=`${name}：${value.toFixed(1)}${unit}；按期 ${sample.onTime}/${sample.count}，总周期无法判定 ${sample.unknown}，周期有效样本 ${sample.durationCount}。点击查看该周期已关闭问题。`;
    const tip=jiraComparisonTooltip(row,metric,mode);
    return `<g data-jira-compare-point="${i}" data-kind="${kind}" data-metric="${metric}" data-compare-tooltip="${esc(tip)}" role="button" tabindex="0" aria-label="${esc(jiraComparisonRangeText(sample)+' '+label)}"><rect class="jira-compare-hit" x="${center-22}" y="${top-20}" width="44" height="${plotHeight+20}" fill="transparent"/><rect class="jira-compare-bar ${kind}" x="${center-barWidth/2}" y="${y(value)}" width="${barWidth}" height="${bottom-y(value)}" rx="3" fill="${kind==='base'?'#a8b3c4':'#3b5ccc'}"/>${value===0?`<line x1="${center-barWidth/2}" x2="${center+barWidth/2}" y1="${bottom}" y2="${bottom}" stroke="${kind==='base'?'#a8b3c4':'#3b5ccc'}" stroke-width="2"/>`:''}<text class="jira-compare-value" x="${center}" y="${y(value)-8}" text-anchor="middle">${value.toFixed(1)}</text></g>`;
  }).join('')).join('');
  let inSegment=false;
  const path=rows.map((row,i)=>{
    const value=jiraComparisonChange(row,metric);
    if(value===null){inSegment=false;return '';}
    const segment=`${inSegment?'L':'M'}${x(i)},${changeY(value)}`;inSegment=true;return segment;
  }).join(' ');
  const points=rows.map((row,i)=>{
    const value=jiraComparisonChange(row,metric);if(value===null)return '';
    const tip=jiraComparisonTooltip(row,metric,mode);
    return `<g data-compare-change="${i}" data-compare-tooltip="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(tip)}"><circle cx="${x(i)}" cy="${changeY(value)}" r="10" fill="transparent"/><circle class="jira-compare-change-dot" cx="${x(i)}" cy="${changeY(value)}" r="4" fill="#d97706" stroke="#fff" stroke-width="1.5"/></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="group" aria-label="${metric==='rate'?'按期关闭率':'平均关闭周期'}柱线对比图"><text x="${left}" y="20">${metric==='rate'?'按期关闭率（%）':'平均周期（天）'}</text><text class="jira-compare-change-label" x="${width-right}" y="20" text-anchor="end">变化（${changeUnit}）· 右轴</text>${grids}<line class="jira-compare-zero" x1="${left}" x2="${width-right}" y1="${changeY(0)}" y2="${changeY(0)}" stroke="#d97706" stroke-opacity=".5" stroke-dasharray="4 4"/>${bars}<path class="jira-compare-change-line" d="${path}" fill="none" stroke="#d97706" stroke-width="2.5" pointer-events="none"/>${points}${rows.map((row,i)=>`<text x="${x(i)}" y="${bottom+25}" text-anchor="middle">${esc(row.label)}${row.partial?'*':''}</text>`).join('')}</svg>`;
}

function jiraComparisonChart(rows,metric,mode) {
  if(!rows.length)return jiraNoData('请选择有效范围，每次最多展示120个周期');
  if(!rows.some(row=>Number.isFinite(row.current[metric])||Number.isFinite(row.base[metric])))return jiraNoData('该范围暂无可判定样本，请检查查询方案及历史数据');
  const latest=rows.at(-1),baseName=mode==='yoy'?'去年同期':'上一周期';
  return `<div class="jira-compare-caption"><span class="jira-compare-legend"><span><i class="base"></i>${baseName}</span><span><i class="current"></i>当期</span><span><i class="change"></i>变化（右轴）</span></span><strong>${esc(latest.label)}：${esc(jiraComparisonChangeText(latest,metric))}</strong></div><div class="jira-compare-plot"><div class="jira-compare-scroll">${jiraComparisonSvg(rows,metric,mode)}</div><div class="jira-compare-tooltip" role="tooltip" hidden></div></div><div class="jira-compare-note">${metric==='rate'?'折线高于零线表示按期率提升；差值单位为百分点。':'折线低于零线表示平均周期缩短；变化率＝（当期－基期）÷ 基期。'} 柱子可点击查看明细；— 表示无有效样本。</div>`;
}

function prepareJiraComparisonPdf(root,data,settings) {
  const rows=jiraClosureComparisons(data,settings.unit,settings.mode,settings.from,settings.to);
  root.querySelectorAll('.jira-compare-card').forEach((card,index)=>{
    const plot=card.querySelector('.jira-compare-plot');if(!plot)return;
    const metric=index===0?'rate':'days',scale=jiraComparisonScale(rows,metric),chunks=[];
    for(let start=0;start<rows.length;start+=4)chunks.push(jiraComparisonSvg(rows.slice(start,start+4),metric,settings.mode,scale));
    plot.innerHTML=chunks.join('');
    plot.querySelectorAll('[tabindex]').forEach(point=>point.removeAttribute('tabindex'));
    const note=card.querySelector('.jira-compare-note');
    if(note)note.textContent=note.textContent.replace('柱子可点击查看明细；','');
  });
}

function renderJiraClosureComparisons(data) {
  const host=byId('jira-closure-comparison');if(!host)return;
  const settings=jiraBoardState.comparison;
  const rows=jiraClosureComparisons(data,settings.unit,settings.mode,settings.from,settings.to);
  host.innerHTML=`<div class="jira-panel-head"><div><h3>关闭效率同比 / 环比</h3><p>按关闭日期归入周期；当前严重等级匹配当前项目时效标准。* 表示未结束周期，对比期按相同进度截取。</p></div></div>
    <div class="jira-compare-body"><div class="jira-compare-controls"><label><span>统计粒度</span><select data-compare="unit">${[['week','周'],['month','月'],['year','年']].map(([v,n])=>`<option value="${v}" ${v===settings.unit?'selected':''}>${n}</option>`).join('')}</select></label><label><span>对比方式</span><select data-compare="mode"><option value="yoy" ${settings.mode==='yoy'?'selected':''}>同比</option><option value="mom" ${settings.mode==='mom'?'selected':''}>环比</option></select></label><label><span>起始周期</span><input type="date" data-compare="from" value="${esc(settings.from)}" max="${esc(data.cutoffDate)}"></label><label><span>截至日期</span><input type="date" data-compare="to" value="${esc(settings.to)}" max="${esc(data.cutoffDate)}"></label><button type="button" class="btn btn-light btn-sm" data-compare-apply>更新图表</button></div>
    ${settings.unit==='year'?'<p class="form-hint">按完整年度统计时，同比与环比均以上一年为基期。</p>':''}
    <p class="form-hint">起始日期按所选粒度对齐周期起点，最多展示120个周期。范围仅包含本次查询命中的问题；状态、创建时间等查询条件可能限制历史样本。</p>
    ${data.issues.some(x=>x.stageCode==='closed'&&!x.closedAt)?'<p class="form-hint">部分已关闭问题缺少关闭状态操作时间，无法归入周/月/年，未纳入对比图；仍计入总览按期关闭率的分母。</p>':''}
    ${data.truncated?'<div class="jira-warning">查询问题数量超过上限，无法形成完整对比。请缩小范围后重新分析。</div>':`<div class="jira-two-column jira-compare-grid"><section class="jira-compare-card"><h3>按期关闭率${settings.mode==='yoy'?'同比':'环比'}</h3><p>总周期达标的已关闭问题 ÷ 周期内全部已关闭问题；超期及无法判定均计入分母。</p>${jiraComparisonChart(rows,'rate',settings.mode)}</section><section class="jira-compare-card"><h3>平均关闭周期${settings.mode==='yoy'?'同比':'环比'}</h3><p>周期内已关闭问题的平均创建至关闭天数，包含超期关闭问题。</p>${jiraComparisonChart(rows,'days',settings.mode)}</section></div>`}</div>`;
  host.querySelector('[data-compare-apply]').onclick=()=>{
    const read=key=>host.querySelector(`[data-compare="${key}"]`).value;
    if(!read('from')||!read('to')||read('from')>read('to')||read('to')>data.cutoffDate){toast('请选择有效的起止日期，不能晚于统计截止日期。','error');return;}
    jiraBoardState.comparison={unit:read('unit'),mode:read('mode'),from:read('from'),to:read('to')};
    renderJiraClosureComparisons(data);
  };
  host.querySelectorAll('.jira-compare-plot').forEach((plot,index)=>{
    const tooltip=plot.querySelector('.jira-compare-tooltip');
    tooltip.id=`jira-compare-tooltip-${index}`;
    plot.querySelectorAll('[data-compare-tooltip]').forEach(point=>{
      point.setAttribute('aria-describedby',tooltip.id);
      const show=event=>{
        tooltip.textContent=point.dataset.compareTooltip;tooltip.hidden=false;
        const bounds=plot.getBoundingClientRect(),target=point.getBoundingClientRect();
        const anchor=Number.isFinite(event.clientX)?event.clientX:target.left+target.width/2;
        tooltip.style.left=`${Math.max(0,Math.min(bounds.width-tooltip.offsetWidth,anchor-bounds.left+12))}px`;
        tooltip.style.top='28px';
      };
      point.onmouseenter=show;point.onmousemove=show;point.onfocus=show;
      point.onmouseleave=point.onblur=()=>{tooltip.hidden=true;};
      point.addEventListener('keydown',event=>{if(event.key==='Escape')tooltip.hidden=true;});
    });
    plot.querySelector('.jira-compare-scroll').onscroll=()=>{tooltip.hidden=true;};
  });
  host.querySelectorAll('[data-jira-compare-point]').forEach(point=>{
    const open=()=>{const sample=rows[Number(point.dataset.jiraComparePoint)][point.dataset.kind];
      openJiraDetails(`${point.dataset.kind==='current'?'当期':settings.mode==='yoy'?'去年同期':'上一周期'} ${jiraComparisonRangeText(sample)} · 已关闭问题（按周期末状态）`,sample.issues,'closure');};
    point.onclick=open;point.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
  });
}

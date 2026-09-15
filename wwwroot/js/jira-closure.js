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

function jiraComparisonTooltip(row,metric,mode) {
  const unit=metric==='rate'?'%':'天',baseName=mode==='yoy'?'去年同期':'上一周期';
  const describe=(sample,name)=>`${name} ${jiraComparisonRangeText(sample)}\n${Number.isFinite(sample[metric])?sample[metric].toFixed(1)+unit:'—（无有效样本）'}；按期 ${sample.onTime}/${sample.count}，总周期无法判定 ${sample.unknown}，周期有效样本 ${sample.durationCount}`;
  return `${row.label}${row.partial?'（未结束周期，按相同进度对比）':''}\n${describe(row.base,baseName)}\n${describe(row.current,'当期')}\n变化：${jiraComparisonChangeText(row,metric)}`;
}

function jiraComparisonOption(rows,metric,mode,width,start=null,print=false) {
  const rate=metric==='rate',baseName=mode==='yoy'?'去年同期':'上一周期';
  const changeName=rate?'按期率变化（百分点）':'平均周期变化率（%）';
  const changes=rows.map(row=>jiraComparisonChange(row,metric));
  const low=Math.min(0,...changes.filter(Number.isFinite)),high=Math.max(0,...changes.filter(Number.isFinite));
  const option=jiraChartBase(rate?'按期关闭率同比/环比':'平均关闭周期同比/环比');
  return {...option,legend:{...option.legend,type:'plain',left:'center',itemWidth:16,itemHeight:8,itemGap:10,data:[baseName,'当期',changeName]},
    grid:{left:8,right:12,top:76,bottom:48,containLabel:true},
    tooltip:{...option.tooltip,trigger:'axis',axisPointer:{type:'shadow'},formatter:params=>esc(jiraComparisonTooltip(rows[params[0].dataIndex],metric,mode)).replace(/\n/g,'<br>')},
    xAxis:{type:'category',data:rows.map(row=>row.label+(row.partial?'*':'')),axisLabel:{hideOverlap:true,fontSize:11},axisTick:{alignWithLabel:true}},
    yAxis:[{type:'value',name:rate?'按期率（%）':'平均周期（天）',min:0,max:rate?100:jiraChartMaximum(rows.flatMap(row=>[row.base.days,row.current.days])),axisLabel:{fontSize:11},splitLine:{lineStyle:{color:'#eaf0f6'}}},
      {type:'value',name:rate?'变化（百分点）':'变化率（%）',min:low===high?-1:low<0?-jiraChartMaximum(changes.filter(Number.isFinite).map(value=>-value)):0,max:low===high?1:high>0?jiraChartMaximum(changes):0,axisLabel:{fontSize:11,color:'#ad620e',formatter:value=>`${value>0?'+':''}${value}`},splitLine:{show:false}}],
    dataZoom:jiraChartZoom(rows.length,print?4:Math.max(1,Math.min(6,Math.floor((width-110)/100))),'x',start,print),
    series:[...['base','current'].map((kind,seriesIndex)=>({name:seriesIndex?'当期':baseName,type:'bar',barMaxWidth:28,barMinHeight:2,clip:true,
      itemStyle:{color:seriesIndex?'#3b5ccc':'#a8b3c4',borderRadius:[3,3,0,0]},label:{show:true,position:'top',fontSize:11,color:'#43536d',formatter:p=>Number.isFinite(p.value)?p.value.toFixed(1):'—'},
      data:rows.map((row,itemIndex)=>({value:row[kind][metric],itemIndex}))})),
      {name:changeName,type:'line',yAxisIndex:1,symbolSize:7,connectNulls:false,clip:true,itemStyle:{color:'#d97706'},lineStyle:{width:2},data:changes,
        markLine:{silent:true,symbol:'none',label:{show:true,formatter:'变化为0',position:'insideEndTop',fontSize:10},lineStyle:{type:'dashed',color:'#d97706',opacity:.65},data:[{yAxis:0}]}}]};
}

function jiraComparisonChart(rows,metric) {
  if(!rows.length)return jiraNoData('请选择有效范围，每次最多展示120个周期');
  if(!rows.some(row=>Number.isFinite(row.current[metric])||Number.isFinite(row.base[metric])))return jiraNoData('该范围暂无可判定样本，请检查查询方案及历史数据');
  const latest=rows.at(-1);
  return `<div class="jira-compare-caption"><strong>${esc(latest.label)}：${esc(jiraComparisonChangeText(latest,metric))}</strong></div>${jiraChartSlot('compare-'+metric,metric==='rate'?'按期关闭率同比/环比':'平均关闭周期同比/环比',340)}<div class="jira-compare-note">${metric==='rate'?'折线高于零线表示按期率提升；差值单位为百分点。':'折线低于零线表示平均周期缩短；变化率＝（当期－基期）÷ 基期。'} 无样本不绘制数值，基期周期为0时不计算周期变化率。</div>`;
}

function mountJiraClosureComparisons(rows,mode) {
  for(const metric of ['rate','days'])jiraMountChart('compare-'+metric,{
    title:metric==='rate'?'按期关闭率同比/环比':'平均关闭周期同比/环比',
    options:width=>jiraComparisonOption(rows,metric,mode,width),
    rows:rows.flatMap((row,dataIndex)=>['base','current'].map((kind,seriesIndex)=>({
      name:`${row.label} ${kind==='current'?'当期':mode==='yoy'?'去年同期':'上一周期'}`,
      value:Number.isFinite(row[kind][metric])?row[kind][metric].toFixed(1)+(metric==='rate'?'%':'天'):'—',
      detail:`${jiraComparisonRangeText(row[kind])}；按期 ${row[kind].onTime}/${row[kind].count}，总周期无法判定 ${row[kind].unknown}；变化 ${jiraComparisonChangeText(row,metric)}`,
      dataIndex,seriesIndex,clickable:Number.isFinite(row[kind][metric])}))),
    onClick:p=>{if(p.seriesIndex>1)return;const sample=rows[p.dataIndex][p.seriesIndex===0?'base':'current'];
      if(!Number.isFinite(sample[metric]))return;
      openJiraDetails(`${p.seriesIndex===1?'当期':mode==='yoy'?'去年同期':'上一周期'} ${jiraComparisonRangeText(sample)} · 已关闭问题（按周期末状态）`,sample.issues,'closure');},
    exportOptions:width=>Array.from({length:Math.ceil(rows.length/4)},(_,index)=>({width,height:340,option:jiraComparisonOption(rows,metric,mode,width,index*4,true)}))
  });
}

function renderJiraClosureComparisons(data) {
  const host=byId('jira-closure-comparison');if(!host)return;
  disposeJiraCharts(host);
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
  if(!data.truncated)mountJiraClosureComparisons(rows,settings.mode);
}

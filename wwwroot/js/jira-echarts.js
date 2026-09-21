// Shared rendering, lifecycle and export for Jira board and drilldown charts.
const jiraCharts = new Map();
const jiraChartColors = ['#3b5ccc','#16a38f','#e2a13a','#d95067','#7b61d8','#4c93c9','#9a6b44','#7d8da8'];
const jiraChartResize = new ResizeObserver(entries=>entries.forEach(({target})=>{
  const entry=jiraCharts.get(target);
  if(entry&&target.clientWidth>0&&(entry.width!==target.clientWidth||entry.height!==target.clientHeight)){
    entry.width=target.clientWidth;entry.height=target.clientHeight;
    entry.chart.resize({width:entry.width,height:entry.height});
    const previous=entry.chart.getOption(),zoom=previous.dataZoom;
    entry.chart.setOption(entry.options(entry.width),{notMerge:true});
    if(previous.legend?.length)entry.chart.setOption({legend:previous.legend.map(legend=>({selected:legend.selected}))});
    if(zoom?.length)entry.chart.setOption({dataZoom:zoom.map(z=>({id:z.id,start:z.start,end:z.end,startValue:z.startValue,endValue:z.endValue}))});
  }
}));
const jiraChartRemoval = new MutationObserver(()=>{
  for(const [node] of jiraCharts)if(!node.isConnected)disposeJiraCharts(node);
});

function disposeJiraCharts(root) {
  if(!root)return;
  for(const [node,entry] of jiraCharts)if(root===node||root.contains(node)){
    jiraChartResize.unobserve(node);entry.chart.dispose();jiraCharts.delete(node);
  }
  if(!jiraCharts.size)jiraChartRemoval.disconnect();
}

function jiraChartSlot(name,title,height=300) {
  return `<div class="jira-echart-wrap"><div id="jira-ec-${name}" class="jira-echart" data-jira-chart="${name}" style="height:${height}px" aria-label="${esc(title)}"></div><details class="jira-chart-data"><summary>查看数据与明细</summary><div class="jira-chart-data-body"></div></details></div>`;
}

function jiraChartBase(title) {
  return {animation:false,color:jiraChartColors,textStyle:{fontFamily:'Microsoft YaHei UI, PingFang SC, Segoe UI, sans-serif',fontSize:12,color:'#53647e'},
    aria:{enabled:true,label:{description:title}},
    tooltip:{confine:true,backgroundColor:'#fff',borderColor:'#dce3ed',textStyle:{color:'#35465f',fontSize:12},extraCssText:'max-width:340px;white-space:normal;overflow-wrap:anywhere;line-height:1.7;z-index:20'},
    legend:{type:'scroll',top:0,textStyle:{color:'#64748b',fontSize:11}},
    grid:{left:12,right:28,top:40,bottom:32,containLabel:true}};
}

// Fix axes to the complete comparison range while ECharts filters off-screen categories.
function jiraChartMaximum(values) {
  const maximum=Math.max(1,...values.filter(Number.isFinite));
  const magnitude=10**Math.floor(Math.log10(maximum));
  return [1,2,5,10].find(step=>step*magnitude>=maximum)*magnitude;
}

function jiraChartZoom(count,visible=10,axis='x',start=null) {
  if(count===0||count<=visible)return [];
  start=start??(axis==='x'?Math.max(0,count-visible):0);
  const axisIndex=axis==='x'?{xAxisIndex:0}:{yAxisIndex:0};
  const common={...axisIndex,filterMode:'filter',startValue:start,endValue:Math.min(count-1,start+visible-1)};
  return [{id:'range',type:'slider',...common,height:axis==='x'?18:undefined,width:axis==='y'?14:undefined,bottom:axis==='x'?4:undefined,right:axis==='y'?0:undefined,showDetail:false,brushSelect:false},
    {id:'inside-range',type:'inside',...common,zoomOnMouseWheel:false,moveOnMouseWheel:false}];
}

function jiraMountChart(name,{title,options,rows=[],onClick=null,exportOption=null,actionLabel='明细'}) {
  const node=byId(`jira-ec-${name}`);if(!node)return;
  disposeJiraCharts(node);
  // Hidden mobile breakdowns receive their actual size when they become visible.
  const width=node.clientWidth||320;
  const chart=echarts.init(node,null,{renderer:'svg',width,height:node.clientHeight||240});
  const entry={chart,options,rows,onClick,exportOption,width,height:node.clientHeight||240};jiraCharts.set(node,entry);
  chart.setOption(options(width),{notMerge:true});
  if(onClick)chart.on('click',params=>{if(params.componentType==='series'){chart.dispatchAction({type:'hideTip'});onClick(params);}});
  const body=node.parentElement.querySelector('.jira-chart-data-body');
  if(body){
    body.innerHTML=rows.length?`<table><thead><tr><th>项目</th><th>数值</th><th>说明</th>${onClick?'<th>操作</th>':''}</tr></thead><tbody>${rows.map((row,index)=>`<tr><td>${esc(row.name)}</td><td>${esc(row.value)}</td><td>${esc(row.detail||'')}</td>${onClick?`<td>${row.clickable===false?'—':`<button type="button" class="btn btn-light btn-sm" data-chart-row="${index}" aria-label="${esc(row.name+' '+row.value+' '+(row.detail||'')+' '+actionLabel)}">${esc(actionLabel)}</button>`}</td>`:''}</tr>`).join('')}</tbody></table>`:jiraNoData('暂无数据');
    body.querySelectorAll('[data-chart-row]').forEach(button=>button.onclick=()=>{
      const row=rows[Number(button.dataset.chartRow)];onClick({componentType:'series',seriesIndex:row.seriesIndex||0,dataIndex:row.dataIndex,data:{itemIndex:row.dataIndex},seriesType:row.seriesType});
    });
  }
  jiraChartResize.observe(node);jiraChartRemoval.observe(document.body,{childList:true,subtree:true});
  return chart;
}

function jiraBarOption(items,{title,unit='项',max=null,visible=10,print=false}={}) {
  const option=jiraChartBase(title),zoom=items.length>visible&&!print;
  return {...option,title:items.length?undefined:{text:'暂无数据',left:'center',top:'middle',textStyle:{fontSize:13,fontWeight:'normal',color:'#8996a9'}},legend:{show:false},grid:{left:8,right:zoom?46:32,top:28,bottom:18,containLabel:true},
    tooltip:{...option.tooltip,trigger:'axis',axisPointer:{type:'shadow'},formatter:params=>{const item=items[params[0].dataIndex];return `${esc(item.name)}<br><b>${esc(Number.isFinite(item.value)?item.value.toFixed(unit==='项'?0:1)+unit:'—')}</b>${item.detail?'<br>'+esc(item.detail):''}`;}},
    xAxis:{type:'value',min:0,max:max||jiraChartMaximum(items.map(item=>item.value)),minInterval:unit==='项'?1:undefined,name:unit,nameTextStyle:{padding:[0,0,0,-14]},splitLine:{lineStyle:{color:'#eaf0f6'}}},
    yAxis:{type:'category',inverse:true,data:items.map(item=>item.name),axisLine:{show:false},axisTick:{show:false},axisLabel:{width:112,overflow:'truncate',fontSize:11}},
    dataZoom:print?[]:jiraChartZoom(items.length,visible,'y',0),
    series:[{name:title,type:'bar',barMaxWidth:18,barMinHeight:2,clip:true,label:{show:true,position:'right',color:'#43536d',fontSize:11,formatter:p=>Number.isFinite(p.value)?p.value.toFixed(unit==='项'?0:1):'—'},
      data:items.map((item,index)=>({value:item.value,itemIndex:index,itemStyle:{color:item.color||jiraChartColors[0],borderRadius:[0,3,3,0]}}))}]};
}

function jiraMountBars(name,items,{title,unit='项',max=null,visible=10,onClick=null}={}) {
  return jiraMountChart(name,{title,options:()=>jiraBarOption(items,{title,unit,max,visible}),
    rows:items.map((item,dataIndex)=>({name:item.name,value:Number.isFinite(item.value)?item.value.toFixed(unit==='项'?0:1)+unit:'—',detail:item.detail,dataIndex,clickable:Number.isFinite(item.value)})),onClick,
    exportOption:width=>({width,height:Math.max(190,items.length*30+65),option:jiraBarOption(items,{title,unit,max,visible:items.length,print:true})})});
}

function jiraPieOption(items,title,centerText,width) {
  const base=jiraChartBase(title),total=items.reduce((sum,item)=>sum+item.value,0);
  return {...base,legend:{type:'scroll',bottom:0,top:'auto',textStyle:{fontSize:11},selectedMode:false},
    title:{text:centerText??jiraNumber(total),subtext:title,left:'center',top:'31%',textStyle:{fontSize:width<260?21:27,color:'#243c70'},subtextStyle:{fontSize:11,color:'#718097'}},
    tooltip:{...base.tooltip,trigger:'item',formatter:p=>`${esc(p.name)}<br>${jiraNumber(p.value)} 项 · ${jiraPercent(total?p.value/total*100:null)}`},
    series:[{type:'pie',stillShowZeroSum:false,radius:['53%','72%'],center:['50%','44%'],avoidLabelOverlap:true,label:{show:false},emphasis:{scaleSize:4},
      data:items.map((item,index)=>({name:item.name,value:item.value,itemIndex:index,itemStyle:{color:item.color||jiraChartColors[index%jiraChartColors.length]}}))}]};
}

function jiraMountPie(name,items,{title,centerText,onClick=null,actionLabel='明细'}={}) {
  jiraMountChart(name,{title,options:width=>jiraPieOption(items,title,centerText,width),
    rows:items.map((item,dataIndex)=>({name:item.name,value:jiraNumber(item.value)+'项',dataIndex})),onClick,actionLabel});
}

function renderJiraTrend(data) {
  const host=byId('jira-trend-chart');if(!host)return;
  disposeJiraCharts(host);host.innerHTML=jiraChartSlot('trend','问题新增与关闭趋势',320);
  const buckets=jiraTrendBuckets(data,jiraBoardState.trendRange);jiraBoardState.trendBuckets=buckets;
  const make=(width,print=false)=>{
    const option=jiraChartBase('问题新增与关闭趋势');
    return {...option,legend:{...option.legend,selected:{新增问题:jiraBoardState.trendVisible.created,关闭问题:jiraBoardState.trendVisible.closed}},
      tooltip:{...option.tooltip,trigger:'axis',formatter:params=>{const b=buckets[params[0].dataIndex];return `${esc(b.start)} ~ ${esc(b.end)}<br>新增 ${b.created} · 关闭 ${b.closed} · 净增 ${b.created-b.closed}`;}},
      grid:{left:12,right:24,top:42,bottom:46,containLabel:true},
      xAxis:{type:'category',data:buckets.map(b=>b.label),axisLabel:{hideOverlap:true,showMinLabel:true,showMaxLabel:true,fontSize:11},axisTick:{alignWithLabel:true}},
      yAxis:{type:'value',min:0,max:jiraChartMaximum(buckets.flatMap(b=>[b.created,b.closed])),minInterval:1,name:'问题数',splitLine:{lineStyle:{color:'#eaf0f6'}}},
      dataZoom:print?[]:jiraChartZoom(buckets.length,width<600?10:30,'x'),
      series:['created','closed'].map((kind,index)=>({name:index?'关闭问题':'新增问题',type:'line',showSymbol:!print||buckets.length<=30,symbolSize:7,connectNulls:false,clip:true,itemStyle:{color:jiraChartColors[index]},
        data:buckets.map((b,itemIndex)=>({value:b[kind],itemIndex})),lineStyle:{width:2}}))};
  };
  const chart=jiraMountChart('trend',{title:'问题新增与关闭趋势',options:width=>make(width),
    rows:buckets.flatMap((b,dataIndex)=>['created','closed'].map((kind,seriesIndex)=>({name:`${b.start} ~ ${b.end} ${seriesIndex?'关闭':'新增'}`,value:b[kind]+'项',dataIndex,seriesIndex}))),
    onClick:p=>{const bucket=buckets[p.dataIndex],kind=p.seriesIndex===0?'created':'closed';
      const issues=data.issues.filter(issue=>{const key=jiraDateKey(kind==='created'?issue.createdAt:issue.closedAt);return key>=bucket.start&&key<=bucket.end;});
      openJiraDetails(`${bucket.start} ~ ${bucket.end} · ${kind==='created'?'新增':'关闭'}问题 · ${issues.length}项`,issues,kind==='closed'?'closure':'stage');},
    exportOption:width=>({width,height:320,option:make(width,true)})});
  chart?.on('legendselectchanged',event=>{
    if(!event.selected.新增问题&&!event.selected.关闭问题){chart.dispatchAction({type:'legendSelect',name:event.name});event.selected[event.name]=true;}
    jiraBoardState.trendVisible={created:event.selected.新增问题,closed:event.selected.关闭问题};
  });
  document.querySelectorAll('[data-jira-trend-range]').forEach(button=>button.classList.toggle('active',button.dataset.jiraTrendRange===jiraBoardState.trendRange));
}

function jiraCategoryPath(data, id) {
  const nodes=new Map((data.categories||[]).map(x=>[String(x.id),x]));
  const path=[],seen=new Set();let node=nodes.get(String(id));
  while(node&&!seen.has(node.id)){seen.add(node.id);path.unshift(node);node=nodes.get(String(node.parentItemId));}
  return path;
}

function jiraCategoryIncludes(data, issue, id) {
  if(id==='')return true;
  if(id==='unmapped')return !jiraCategoryPath(data,issue.categoryItemId).length;
  return jiraCategoryPath(data,issue.categoryItemId).some(x=>String(x.id)===String(id));
}

function jiraCategoryLabel(data, issue) {
  return jiraCategoryPath(data,issue.categoryItemId).map(x=>x.name).join(' / ')||'未分类';
}

function jiraCategoryOptions(data) {
  const rows=(data.categories||[]).map(node=>({node,path:jiraCategoryPath(data,node.id)}));
  rows.sort((a,b)=>{
    for(let i=0;i<Math.min(a.path.length,b.path.length);i++){
      if(a.path[i].id!==b.path[i].id)return a.path[i].sortOrder-b.path[i].sortOrder||a.path[i].name.localeCompare(b.path[i].name,'zh-CN')||a.path[i].id-b.path[i].id;
    }
    return a.path.length-b.path.length;
  });
  return '<option value="">全部大类</option>'+rows.map(({node,path})=>`<option value="${node.id}">${esc(path.map(x=>x.name).join(' / '))}</option>`).join('')+'<option value="unmapped">未分类</option>';
}

// Mutually exclusive groups: leaf categories plus direct parent mappings, never parent rollups.
function jiraDimensionGroups(data,issues=data.issues) {
  const categories=data.categories||[],known=new Set(categories.map(x=>x.id));
  const category=categories.filter(node=>!categories.some(x=>x.parentItemId===node.id)||issues.some(x=>x.categoryItemId===node.id))
    .sort((a,b)=>{
      const ap=jiraCategoryPath(data,a.id),bp=jiraCategoryPath(data,b.id);
      for(let i=0;i<Math.min(ap.length,bp.length);i++)if(ap[i].id!==bp[i].id)return ap[i].sortOrder-bp[i].sortOrder||ap[i].name.localeCompare(bp[i].name,'zh-CN')||ap[i].id-bp[i].id;
      return ap.length-bp.length;
    }).map(node=>({key:String(node.id),name:node.name+(categories.some(x=>x.parentItemId===node.id)?'（未细分）':''),path:jiraCategoryPath(data,node.id).map(x=>x.name).join(' / '),issues:issues.filter(x=>x.categoryItemId===node.id)}));
  const unmapped=issues.filter(x=>!known.has(x.categoryItemId));
  if(unmapped.length)category.push({key:'unmapped',name:'未分类',path:'未分类',issues:unmapped});
  const keys=['S','A','B','C'];
  if(issues.some(x=>!keys.includes(x.severityKey)))keys.push('UNKNOWN');
  const severity=keys.map(key=>({key,name:key==='UNKNOWN'?'未匹配等级':key+'级',issues:issues.filter(x=>key==='UNKNOWN'?!['S','A','B','C'].includes(x.severityKey):x.severityKey===key)}));
  return {severity,category};
}

function renderJiraCategories(data) {
  const active=data.issues.filter(x=>x.stageCode!=='closed'),dimensions=jiraDimensionGroups(data,active);
  for(const [dimension,title] of [['severity','按严重等级'],['category','按问题分类']]){
    const groups=dimensions[dimension].map(x=>({...x,value:x.issues.length}));
    jiraMountPie(`active-${dimension}`,groups,{title,actionLabel:'联动人员',onClick:p=>{
      jiraBoardState.distributionSelection={dimension,key:groups[p.dataIndex].key};
      renderJiraAssigneeScope(data);
    }});
  }
  renderJiraAssigneeScope(data);
}

function renderJiraAssigneeScope(data) {
  const active=data.issues.filter(x=>x.stageCode!=='closed'),selection=jiraBoardState.distributionSelection,dimensions=jiraDimensionGroups(data,active);
  const group=selection?dimensions[selection.dimension]?.find(x=>x.key===selection.key):null;
  if(!group)jiraBoardState.distributionSelection=null;
  const issues=group?group.issues:active,name=group?`${selection.dimension==='severity'?'严重等级':'问题分类'} · ${group.path||group.name}`:'全部未关闭问题';
  byId('jira-category-selection').textContent=`${name} · ${issues.length}项`;
  byId('jira-distribution-reset').disabled=!group;
  byId('jira-distribution-details').disabled=!issues.length;
  byId('jira-distribution-reset').onclick=()=>{jiraBoardState.distributionSelection=null;renderJiraAssigneeScope(data);};
  byId('jira-distribution-details').onclick=()=>openJiraDetails(`${name} · ${issues.length}项`,issues,'stage',{category:true});
  for(const [node,entry] of jiraCharts){
    const dimension=node.dataset.jiraChart?.replace('active-','');
    if(!['severity','category'].includes(dimension))continue;
    entry.chart.dispatchAction({type:'downplay'});
    if(group&&selection.dimension===dimension){
      const index=dimensions[dimension].findIndex(x=>x.key===selection.key);
      entry.chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:index});
    }
  }
  const assignees=jiraDistribution(issues,'assignee','未分配');
  jiraMountBars('variant-assignee',assignees.map(([name,value])=>({name,value})),{title:`${name} · 当前处理人问题堆积`,onClick:p=>{
    const assignee=assignees[p.dataIndex][0],selected=issues.filter(x=>(x.assignee||'未分配')===assignee);
    openJiraDetails(`${name} · ${assignee} · ${selected.length}项`,selected,'stage',{category:true});
  }});
}

function jiraRateGroups(data) {
  const dimensions=jiraDimensionGroups(data);
  return Object.fromEntries(Object.entries(dimensions).map(([dimension,groups])=>[dimension,groups.map(group=>{
    const closed=group.issues.filter(x=>x.stageCode==='closed'),summary=jiraClosureSummary(closed);
    return {...group,closed,total:group.issues.length,closureRate:group.issues.length?closed.length*100/group.issues.length:null,
      onTimeRate:summary.onTimeRate,onTime:summary.onTimeClosed,unknown:summary.unassessableClosed,overdue:summary.assessedClosed-summary.onTimeClosed};
  })]));
}

function jiraRateOption(groups,metric,title,width,print=false) {
  const base=jiraChartBase(title),visible=width<500?5:8;
  return {...base,legend:{show:false},grid:{left:12,right:20,top:36,bottom:print?65:80,containLabel:true},
    tooltip:{...base.tooltip,trigger:'axis',axisPointer:{type:'shadow'},formatter:params=>{
      const g=groups[params[0].dataIndex];return `${esc(g.path||g.name)}<br><b>${jiraPercent(g[metric])}</b><br>${esc(jiraRateDescription(g,metric))}`;
    }},
    xAxis:{type:'category',data:groups.map(g=>g.name+(g[metric]===null?'\n—':'')),axisTick:{alignWithLabel:true},axisLabel:{interval:0,rotate:groups.length>5?30:0,fontSize:11,formatter:name=>name.match(/.{1,7}/g)?.join('\n')||name}},
    yAxis:{type:'value',min:0,max:100,interval:20,name:'比例（%）',axisLabel:{formatter:'{value}%'},splitLine:{lineStyle:{color:'#eaf0f6'}}},
    dataZoom:print?[]:jiraChartZoom(groups.length,visible,'x',0),
    series:[{name:title,type:'bar',barMaxWidth:42,itemStyle:{color:metric==='onTimeRate'?'#16a38f':'#3b5ccc',borderRadius:[4,4,0,0]},
      label:{show:!print||groups.length<=16,position:'top',formatter:p=>jiraPercent(p.value)},data:groups.map(g=>g[metric])}]};
}

function jiraRateDescription(group,metric) {
  return metric==='onTimeRate'?`按期 ${group.onTime} / 已关闭 ${group.closed.length} · 总周期超期 ${group.overdue} · 无法判定 ${group.unknown}`:`已关闭 ${group.closed.length} / 全部 ${group.total}`;
}

function renderJiraRates(data) {
  const dimensions=jiraRateGroups(data);
  for(const [dimension,groups] of Object.entries(dimensions))for(const [prefix,metric,label] of [['closure','closureRate','问题关闭率'],['ontime','onTimeRate','按期关闭率']]){
    const title=`${dimension==='severity'?'严重等级':'问题分类'} · ${label}`;
    jiraMountChart(`${prefix}-${dimension}`,{title,options:width=>jiraRateOption(groups,metric,title,width),
      rows:groups.map((g,dataIndex)=>({name:g.path||g.name,value:jiraPercent(g[metric]),detail:jiraRateDescription(g,metric),dataIndex,clickable:g[metric]!==null})),
      onClick:p=>{const group=groups[p.dataIndex];openJiraDetails(`${group.path||group.name} · ${label}`,metric==='onTimeRate'?group.closed:group.issues,'closure',{category:true,timing:metric==='onTimeRate'});},
      exportOption:width=>({width,height:groups.length>12?400:340,option:jiraRateOption(groups,metric,title,width,true)})});
  }
}

function renderJiraOverdue(data) {
  const host=byId('jira-overdue-chart');if(!host)return;
  disposeJiraCharts(host);host.innerHTML=jiraChartSlot('overdue','处理超时报表',255);
  const items=jiraBoardState.overdueSort==='count'?[...data.overdue].sort((a,b)=>b.count-a.count):data.overdue;
  jiraMountBars('overdue',items.map(item=>({name:item.name,value:item.count,color:jiraStageColors[item.code],detail:item.count?`最长超时 ${item.maxOverdueDays} 天`:'暂无超时'})),{title:'处理超时报表',onClick:p=>{
    const item=items[p.dataIndex],code=item.code;
    const issues=code==='closure'?data.issues.filter(x=>x.stageCode!=='closed'&&x.closureOverdueDays>0).sort((a,b)=>b.closureOverdueDays-a.closureOverdueDays):data.issues.filter(x=>x.stageCode===code&&x.stageOverdueDays>0).sort((a,b)=>b.stageOverdueDays-a.stageOverdueDays);
    openJiraDetails(`${item.name}超时 · ${issues.length}项`,issues,code==='closure'?'closure':'stage');
  }});
  document.querySelectorAll('[data-jira-overdue-sort]').forEach(button=>button.classList.toggle('active',button.dataset.jiraOverdueSort===jiraBoardState.overdueSort));
}

function renderJiraBoardCharts(data) {
  const funnel=data.funnel;
  jiraMountChart('funnel',{title:'问题处理阶段累计到达量',options:()=>{
    const base=jiraChartBase('问题处理阶段累计到达量');return {...base,legend:{show:false},tooltip:{...base.tooltip,trigger:'item',formatter:p=>`${esc(p.name)} · ${p.value}项`},
      series:[{type:'funnel',sort:'none',left:'8%',right:'8%',top:12,bottom:12,min:0,max:Math.max(1,...funnel.map(x=>x.count)),minSize:'0%',gap:6,
        label:{show:true,position:'inside',formatter:p=>`${p.name} · ${p.value}项`,fontSize:13,color:'#fff',textBorderColor:'#334155',textBorderWidth:2},
        data:funnel.map((item,itemIndex)=>({name:item.name,value:item.count,itemIndex,itemStyle:{color:jiraStageColors[item.code]}}))}]};},
    rows:funnel.map((item,dataIndex)=>({name:item.name,value:item.count+'项',dataIndex})),onClick:p=>{const item=funnel[p.dataIndex];openJiraDetails(`${item.name}累计到达 · ${item.count}项`,data.issues.filter(x=>x.maxReachedStageOrder>=item.order),item.code==='closed'?'closure':'stage');}});
  renderJiraOverdue(data);
  renderJiraRates(data);
  renderJiraDurationAnalysis(data);
}

// Each point retains its exact valid sample set for tooltips, drilldown and CSV.
function jiraDurationValue(issue,stageCode=null) {
  if(issue.stageCode!=='closed'||issue.timingReliable!==true)return null;
  const value=stageCode?issue.completedStageDays?.[stageCode]:issue.closureElapsedDays;
  return Number.isFinite(value)&&value>=0?value:null;
}

function jiraDurationGroups(data) {
  const closed=data.issues.filter(x=>x.stageCode==='closed');
  const point=(name,issues,stageCode=null,path=name)=>{
    const samples=issues.filter(x=>jiraDurationValue(x,stageCode)!==null);
    const value=samples.length?samples.reduce((sum,x)=>sum+jiraDurationValue(x,stageCode),0)/samples.length:null;
    return {name,path,value,issues:samples,sampleCount:samples.length,excluded:issues.length-samples.length,stageCode};
  };
  const dimensions=jiraDimensionGroups(data,closed);
  const categoryPoints=dimensions.category.map(g=>point(g.name,g.issues,null,g.path));
  const severityPoints=dimensions.severity.map(g=>point(g.name,g.issues));
  const stagePoints=data.funnel.filter(x=>x.code!=='closed').map(stage=>point(stage.name,closed.filter(x=>Object.hasOwn(x.completedStageDays||{},stage.code)),stage.code));
  return [{name:'问题分类',points:categoryPoints},{name:'严重等级',points:severityPoints},{name:'处理阶段',points:stagePoints}];
}

function jiraDurationOption(groups,width) {
  const base=jiraChartBase('问题处理时长分析'),maximum=jiraChartMaximum(groups.flatMap(g=>g.points.map(p=>p.value)));
  const left=56,right=24,gap=32,available=width-left-right-gap*2;
  const weights=groups.map(g=>Math.max(4,g.points.length)),sum=weights.reduce((a,b)=>a+b,0);
  let offset=left;
  const layouts=weights.map(weight=>{const layout={left:offset,width:available*weight/sum};offset+=layout.width+gap;return layout;});
  const crowded=groups.some((g,i)=>layouts[i].width/Math.max(1,g.points.length)<65);
  return {...base,legend:{show:false},
    title:groups.map((g,i)=>({text:g.name,left:layouts[i].left+layouts[i].width/2,textAlign:'center',top:12,textStyle:{fontSize:14,color:jiraChartColors[i],fontWeight:600}})),
    grid:layouts.map(x=>({...x,top:74,bottom:crowded?104:76})),
    xAxis:groups.map((g,i)=>({type:'category',gridIndex:i,boundaryGap:true,data:g.points.map(p=>p.name),axisTick:{alignWithLabel:true},axisLine:{lineStyle:{color:'#dce4ef'}},axisLabel:{interval:0,fontSize:11,rotate:crowded?45:0,formatter:(name,index)=>{
      const wrapped=crowded?name:(name.match(/.{1,6}/g)||[name]).join('\n');return wrapped+(g.points[index].value===null?'\n—':'');
    }}})),
    yAxis:groups.map((_,i)=>({type:'value',gridIndex:i,min:0,max:maximum,interval:maximum/5,name:i===0?'平均周期（天）':'',axisLabel:{show:i===0,fontSize:11},axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:'#eaf0f6'}}})),
    tooltip:{...base.tooltip,trigger:'item',formatter:p=>{
      const group=groups[p.seriesIndex],point=group.points[p.dataIndex];
      return `${esc(group.name+' · '+point.path)}<br>平均 ${point.value.toFixed(1)} 天<br>有效样本 ${point.sampleCount} 项 · 无法判定 ${point.excluded} 项<br>${point.stageCode?'已关闭问题在本阶段的累计耗时':'实际关闭时间－创建时间'}`;
    }},
    series:groups.map((g,i)=>({name:g.name,type:'line',xAxisIndex:i,yAxisIndex:i,connectNulls:false,smooth:false,symbol:'circle',symbolSize:8,clip:true,itemStyle:{color:jiraChartColors[i]},lineStyle:{width:2},
      label:{show:!crowded,position:'top',fontSize:11,formatter:p=>Number.isFinite(p.value)?p.value.toFixed(1):'—'},data:g.points.map(p=>p.value)})),
    graphic:layouts.slice(1).map(x=>({type:'line',silent:true,shape:{x1:x.left-gap/2,y1:48,x2:x.left-gap/2,y2:342},style:{stroke:'#dce4ef',lineDash:[4,4]}}))};
}

function renderJiraDurationAnalysis(data) {
  const groups=jiraDurationGroups(data),minimum=Math.max(920,groups.reduce((sum,g)=>sum+Math.max(4,g.points.length)*70,0)+144);
  const node=byId('jira-ec-duration-analysis');node.parentElement.style.minWidth=minimum+'px';
  const rows=groups.flatMap((group,seriesIndex)=>group.points.map((point,dataIndex)=>({name:group.name+' · '+point.path,value:point.value===null?'—':point.value.toFixed(1)+'天',detail:`有效样本 ${point.sampleCount}项；无法判定 ${point.excluded}项`,seriesIndex,dataIndex,clickable:point.sampleCount>0})));
  jiraMountChart('duration-analysis',{title:'问题处理时长分析',options:width=>jiraDurationOption(groups,width),rows,
    exportOption:width=>({width,height:420,option:jiraDurationOption(groups,width)}),
    onClick:p=>{
      const group=groups[p.seriesIndex],point=group.points[p.dataIndex];if(!point.sampleCount)return;
      openJiraDetails(`${group.name} · ${point.path} · 平均${point.value.toFixed(1)}天 · ${point.sampleCount}项`,point.issues,'closure',{category:p.seriesIndex===0,duration:{stageCode:point.stageCode}});
    }});
}

function renderJiraFollowUpChart(host,items,failedCount) {
  disposeJiraCharts(host);
  host.innerHTML=`<div class="jira-followup-total"><button type="button" class="btn btn-light" data-jira-followup="all">当日未跟进 ${jiraNumber(items.length)} 项 · 查看明细</button></div>${jiraChartSlot('followup','当日未跟进问题严重等级分布',210)}${failedCount?`<p class="jira-chart-warning">另有 ${failedCount} 项最新评论读取失败，未纳入统计。<button type="button" id="jira-comment-retry">重试失败项</button></p>`:''}`;
  const groups=[...jiraGroupBy(items,x=>`${x.severityKey}|${x.severityLabel}`).values()].map(group=>({name:group[0].severityLabel,key:group[0].severityKey,value:group.length})).sort((a,b)=>jiraSeverityOrder(a.key)-jiraSeverityOrder(b.key));
  jiraMountBars('followup',groups,{title:'当日未跟进问题严重等级分布',onClick:p=>{const item=groups[p.dataIndex],selected=items.filter(x=>x.severityLabel===item.name);openJiraDetails(`当日未跟进 · ${item.name} · ${selected.length}项`,selected,'stage',{compact:true});}});
  host.querySelector('[data-jira-followup]').onclick=()=>openJiraDetails(`当日未跟进 · ${items.length}项`,items,'stage',{compact:true});
}

function renderJiraDetailCharts(items) {
  jiraMountPie('detail-severity',jiraDistribution(items,'severityLabel','未设置').map(([name,value])=>({name,value})),{title:'严重等级分布'});
  jiraMountBars('detail-assignee',jiraDistribution(items,'assignee','未分配').map(([name,value])=>({name,value})),{title:'处理人分布',visible:6});
}

function prepareJiraChartsPdf(snapshots,clone) {
  clone.querySelectorAll('[data-jira-chart]').forEach(node=>{
    const snapshot=snapshots.get(node.dataset.jiraChart);
    if(!snapshot)throw new Error('Missing chart snapshot: '+node.dataset.jiraChart);
    const {entry,legend,height}=snapshot,width=Math.max(200,node.clientWidth);
    const spec=entry.exportOption?entry.exportOption(width):{width,height,option:entry.options(width)};
    node.replaceChildren();node.style.height=spec.height+'px';node.removeAttribute('_echarts_instance_');
    const chart=echarts.init(null,null,{renderer:'svg',ssr:true,width:spec.width,height:spec.height});
    try{
      chart.setOption({...spec.option,animation:false,tooltip:{show:false}});
      if(legend.length)chart.setOption({legend:legend.map(item=>({selected:item.selected}))});
      node.innerHTML=chart.renderToSVGString();
    }finally{chart.dispose();}
  });
  clone.querySelectorAll('.jira-chart-data').forEach(node=>node.remove());
}

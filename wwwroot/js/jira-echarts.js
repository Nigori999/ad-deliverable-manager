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

function jiraChartZoom(count,visible=10,axis='x',start=null,print=false) {
  if(count===0||(count<=visible&&!print))return [];
  start=start??(axis==='x'?Math.max(0,count-visible):0);
  const axisIndex=axis==='x'?{xAxisIndex:0}:{yAxisIndex:0};
  const common={...axisIndex,filterMode:'filter',startValue:start,endValue:Math.min(count-1,start+visible-1)};
  return [{id:'range',type:'slider',...common,show:!print,height:axis==='x'?18:undefined,width:axis==='y'?14:undefined,bottom:axis==='x'?4:undefined,right:axis==='y'?0:undefined,showDetail:false,brushSelect:false},
    {id:'inside-range',type:'inside',...common,disabled:print,zoomOnMouseWheel:false,moveOnMouseWheel:false}];
}

function jiraMountChart(name,{title,options,rows=[],onClick=null,exportOptions=null}) {
  const node=byId(`jira-ec-${name}`);if(!node)return;
  disposeJiraCharts(node);
  // Hidden mobile breakdowns receive their actual size when they become visible.
  const width=node.clientWidth||320;
  const chart=echarts.init(node,null,{renderer:'svg',width,height:node.clientHeight||240});
  const entry={chart,options,rows,onClick,exportOptions,width,height:node.clientHeight||240};jiraCharts.set(node,entry);
  chart.setOption(options(width),{notMerge:true});
  if(onClick)chart.on('click',params=>{if(params.componentType==='series'){chart.dispatchAction({type:'hideTip'});onClick(params);}});
  const body=node.parentElement.querySelector('.jira-chart-data-body');
  if(body){
    body.innerHTML=rows.length?`<table><thead><tr><th>项目</th><th>数值</th><th>说明</th>${onClick?'<th>操作</th>':''}</tr></thead><tbody>${rows.map((row,index)=>`<tr><td>${esc(row.name)}</td><td>${esc(row.value)}</td><td>${esc(row.detail||'')}</td>${onClick?`<td>${row.clickable===false?'—':`<button type="button" class="btn btn-light btn-sm" data-chart-row="${index}" aria-label="${esc(row.name+' '+row.value+' '+(row.detail||'')+' 查看明细')}">明细</button>`}</td>`:''}</tr>`).join('')}</tbody></table>`:jiraNoData('暂无数据');
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
    dataZoom:jiraChartZoom(items.length,visible,'y',0,print),
    series:[{name:title,type:'bar',barMaxWidth:18,barMinHeight:2,clip:true,label:{show:true,position:'right',color:'#43536d',fontSize:11,formatter:p=>Number.isFinite(p.value)?p.value.toFixed(unit==='项'?0:1):'—'},
      data:items.map((item,index)=>({value:item.value,itemIndex:index,itemStyle:{color:item.color||jiraChartColors[0],borderRadius:[0,3,3,0]}}))}]};
}

function jiraMountBars(name,items,{title,unit='项',max=null,visible=10,onClick=null}={}) {
  return jiraMountChart(name,{title,options:()=>jiraBarOption(items,{title,unit,max,visible}),
    rows:items.map((item,dataIndex)=>({name:item.name,value:Number.isFinite(item.value)?item.value.toFixed(unit==='项'?0:1)+unit:'—',detail:item.detail,dataIndex,clickable:Number.isFinite(item.value)})),onClick,
    exportOptions:width=>[{width,height:Math.max(190,items.length*30+65),option:jiraBarOption(items,{title,unit,max,visible:items.length,print:true})}]});
}

function jiraPieOption(items,title,centerText,width) {
  const base=jiraChartBase(title),total=items.reduce((sum,item)=>sum+item.value,0);
  return {...base,legend:{type:'scroll',bottom:0,top:'auto',textStyle:{fontSize:11},selectedMode:false},
    title:{text:centerText??jiraNumber(total),subtext:title,left:'center',top:'31%',textStyle:{fontSize:width<260?21:27,color:'#243c70'},subtextStyle:{fontSize:11,color:'#718097'}},
    tooltip:{...base.tooltip,trigger:'item',formatter:p=>`${esc(p.name)}<br>${jiraNumber(p.value)} 项 · ${jiraPercent(total?p.value/total*100:null)}`},
    series:[{type:'pie',stillShowZeroSum:false,radius:['53%','72%'],center:['50%','44%'],avoidLabelOverlap:true,label:{show:false},emphasis:{scaleSize:4},
      data:items.map((item,index)=>({name:item.name,value:item.value,itemIndex:index,itemStyle:{color:item.color||jiraChartColors[index%jiraChartColors.length]}}))}]};
}

function jiraMountPie(name,items,{title,centerText,onClick=null}={}) {
  jiraMountChart(name,{title,options:width=>jiraPieOption(items,title,centerText,width),
    rows:items.map((item,dataIndex)=>({name:item.name,value:jiraNumber(item.value)+'项',dataIndex})),onClick});
}

function renderJiraTrend(data) {
  const host=byId('jira-trend-chart');if(!host)return;
  disposeJiraCharts(host);host.innerHTML=jiraChartSlot('trend','问题新增与关闭趋势',320);
  const buckets=jiraTrendBuckets(data,jiraBoardState.trendRange);jiraBoardState.trendBuckets=buckets;
  const make=(width,start=null,print=false)=>{
    const option=jiraChartBase('问题新增与关闭趋势');
    return {...option,legend:{...option.legend,selected:{新增问题:jiraBoardState.trendVisible.created,关闭问题:jiraBoardState.trendVisible.closed}},
      tooltip:{...option.tooltip,trigger:'axis',formatter:params=>{const b=buckets[params[0].dataIndex];return `${esc(b.start)} ~ ${esc(b.end)}<br>新增 ${b.created} · 关闭 ${b.closed} · 净增 ${b.created-b.closed}`;}},
      grid:{left:12,right:24,top:42,bottom:46,containLabel:true},
      xAxis:{type:'category',data:buckets.map(b=>b.label),axisLabel:{hideOverlap:true,fontSize:11},axisTick:{alignWithLabel:true}},
      yAxis:{type:'value',min:0,max:jiraChartMaximum(buckets.flatMap(b=>[b.created,b.closed])),minInterval:1,name:'问题数',splitLine:{lineStyle:{color:'#eaf0f6'}}},
      dataZoom:jiraChartZoom(buckets.length,print?12:width<600?10:30,'x',start,print),
      series:['created','closed'].map((kind,index)=>({name:index?'关闭问题':'新增问题',type:'line',showSymbol:true,symbolSize:7,connectNulls:false,clip:true,itemStyle:{color:jiraChartColors[index]},
        data:buckets.map((b,itemIndex)=>({value:b[kind],itemIndex})),lineStyle:{width:2}}))};
  };
  const chart=jiraMountChart('trend',{title:'问题新增与关闭趋势',options:width=>make(width),
    rows:buckets.flatMap((b,dataIndex)=>['created','closed'].map((kind,seriesIndex)=>({name:`${b.start} ~ ${b.end} ${seriesIndex?'关闭':'新增'}`,value:b[kind]+'项',dataIndex,seriesIndex}))),
    onClick:p=>{const bucket=buckets[p.dataIndex],kind=p.seriesIndex===0?'created':'closed';
      const issues=data.issues.filter(issue=>{const key=jiraDateKey(kind==='created'?issue.createdAt:issue.closedAt);return key>=bucket.start&&key<=bucket.end;});
      openJiraDetails(`${bucket.start} ~ ${bucket.end} · ${kind==='created'?'新增':'关闭'}问题 · ${issues.length}项`,issues,kind==='closed'?'closure':'stage');},
    exportOptions:width=>Array.from({length:Math.ceil(buckets.length/12)},(_,index)=>({width,height:300,option:make(width,index*12,true)}))});
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

function jiraCategoryGroups(data, selection) {
  const issues=data.issues.filter(x=>x.stageCode!=='closed'&&jiraCategoryIncludes(data,x,selection));
  const groups=new Map();
  issues.forEach(issue=>{
    const path=jiraCategoryPath(data,issue.categoryItemId);
    let key,name;
    if(selection==='unmapped'){key=issue.variantLabel||'未填写';name=key;}
    else if(!path.length){key='unmapped';name='未分类';}
    else {
      const index=selection===''?-1:path.findIndex(x=>String(x.id)===selection);
      const node=path[index+1]||path[index];key=String(node.id);
      name=node.name+(selection===key&&(data.categories||[]).some(x=>String(x.parentItemId)===selection)?'（本级）':'');
    }
    if(!groups.has(key))groups.set(key,{key,name,value:0,issues:[]});
    const group=groups.get(key);group.value++;group.issues.push(issue);
  });
  const order=new Map((data.categories||[]).map(x=>[String(x.id),x.sortOrder]));
  return [...groups.values()].sort((a,b)=>(order.get(a.key)??99999)-(order.get(b.key)??99999)||a.name.localeCompare(b.name,'zh-CN'));
}

function renderJiraCategories(data) {
  const selection=jiraBoardState.categoryId;
  const selectedName=selection==='unmapped'?'未分类':selection===''?'全部大类':jiraCategoryPath(data,selection).map(x=>x.name).join(' / ');
  const groups=jiraCategoryGroups(data,selection);
  byId('jira-category-selection').textContent=selectedName;
  const pieHost=byId('jira-category-distribution');
  disposeJiraCharts(pieHost);pieHost.innerHTML=jiraChartSlot('variant','未关闭问题分类分布',300);
  jiraMountPie('variant',groups,{title:selectedName,onClick:p=>{
    const item=groups[p.dataIndex];
    openJiraDetails(`${selectedName} · ${item.name} · ${item.value}项`,item.issues,'stage',{category:true});
  }});
  const host=byId('jira-variant-assignee-chart');
  disposeJiraCharts(host);host.innerHTML=jiraChartSlot('variant-assignee','当前处理人问题堆积',340);
  const issues=data.issues.filter(issue=>issue.stageCode!=='closed'&&jiraCategoryIncludes(data,issue,selection));
  const assignees=jiraDistribution(issues,'assignee','未分配');
  jiraMountBars('variant-assignee',assignees.map(([name,value])=>({name,value})),{title:`${selectedName} · 当前处理人问题堆积`,onClick:p=>{
    const assignee=assignees[p.dataIndex][0],selected=issues.filter(x=>(x.assignee||'未分配')===assignee);
    openJiraDetails(`${selectedName} · ${assignee} · ${selected.length}项`,selected,'stage',{category:true});
  }});
  const unmapped=data.issues.filter(x=>x.stageCode!=='closed'&&!jiraCategoryPath(data,x.categoryItemId).length).length;
  byId('jira-category-hint').textContent=`按当前选择统计未关闭问题；选择大类包含全部下级，图中展示下一层分布。未分类 ${unmapped} 项，可切换查看原始选项。`;
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
  jiraMountPie('closure-total',[{name:'已关闭',value:data.summary.closed,color:'#16a38f'},{name:'待关闭',value:data.summary.active,color:'#dce4f0'}],{title:'整体关闭率',centerText:jiraPercent(data.summary.closureRate),onClick:p=>openJiraDetails(p.dataIndex===0?'已关闭问题':'待关闭问题',data.issues.filter(x=>p.dataIndex===0?x.stageCode==='closed':x.stageCode!=='closed'),p.dataIndex===0?'closure':'stage')});
  jiraMountBars('closure-severity',data.closureRates.map(x=>({name:x.severity,value:x.rate,detail:`已关闭 ${x.closed} / 全部 ${x.total}`})),{title:'严重等级关闭率',unit:'%',max:100,onClick:p=>{const item=data.closureRates[p.dataIndex];openJiraDetails(`${item.severity}级问题关闭情况`,data.issues.filter(x=>x.severityLabel===item.severity),'closure');}});
  jiraMountBars('duration-severity',data.severityAverages.map(x=>({name:x.severity,value:x.averageDays,detail:`有效样本 ${x.sampleCount}项`})),{title:'严重等级平均关闭周期',unit:'天',onClick:p=>{const item=data.severityAverages[p.dataIndex];openJiraDetails(`${item.severity}级已关闭问题`,data.issues.filter(x=>x.stageCode==='closed'&&x.severityLabel===item.severity),'closure');}});
  jiraMountBars('duration-stage',data.stageAverages.map(x=>({name:x.name,value:x.averageDays,color:jiraStageColors[x.code],detail:`有效样本 ${x.sampleCount}项`})),{title:'各阶段平均处理周期',unit:'天',onClick:p=>{const item=data.stageAverages[p.dataIndex];openJiraDetails(`${item.name}已完成阶段样本`,data.issues.filter(x=>x.completedStageDays&&x.completedStageDays[item.code]!==undefined),'stage');}});
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

function prepareJiraChartsPdf(source,clone) {
  const original=[...source.querySelectorAll('[data-jira-chart]')];
  clone.querySelectorAll('[data-jira-chart]').forEach((node,index)=>{
    const entry=jiraCharts.get(original[index]);if(!entry)return;
    const width=Math.max(200,node.clientWidth),specs=entry.exportOptions?entry.exportOptions(width):[{width,height:original[index].clientHeight||300,option:entry.options(width)}];
    node.innerHTML='';node.style.height='auto';node.removeAttribute('_echarts_instance_');
    for(const spec of specs){
      const chart=echarts.init(null,null,{renderer:'svg',ssr:true,width:spec.width,height:spec.height});
      try{chart.setOption({...spec.option,animation:false,tooltip:{show:false}});node.insertAdjacentHTML('beforeend',chart.renderToSVGString());}finally{chart.dispose();}
    }
  });
  clone.querySelectorAll('.jira-chart-data').forEach(node=>node.remove());
}

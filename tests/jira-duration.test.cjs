const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context=vm.createContext({console,ResizeObserver:class{},MutationObserver:class{},esc:String});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../wwwroot/js/jira-echarts.js'),'utf8'),context);
const categories=[{id:1,name:'ADS',parentItemId:null,sortOrder:10},{id:2,name:'传感器',parentItemId:null,sortOrder:20},{id:3,name:'激光雷达',parentItemId:2,sortOrder:10},{id:4,name:'摄像头',parentItemId:2,sortOrder:20},{id:5,name:'毫米波雷达',parentItemId:2,sortOrder:30}];
const funnel=[{code:'new',name:'创建'},{code:'analysis',name:'原因分析'},{code:'verify',name:'测试验证'},{code:'closed',name:'问题关闭'}];
const issue=(key,categoryItemId,severityKey,days,analysis,extra={})=>({key,categoryItemId,severityKey,stageCode:'closed',timingReliable:true,closureElapsedDays:days,completedStageDays:{analysis},...extra});
const build=issues=>context.jiraDurationGroups({categories,funnel,issues});
test('分类直接显示ADS与传感器细分项，没有传感器汇总；三个区只取已关闭可靠样本',()=>{
 const groups=build([issue('a',1,'S',10,2),issue('b',3,'A',20,6),issue('open',3,'A',100,80,{stageCode:'analysis'}),issue('unknown',3,'A',90,30,{timingReliable:false})]);
 assert.deepEqual(Array.from(groups[0].points,p=>p.name),['ADS','激光雷达','摄像头','毫米波雷达']);
 assert.equal(groups[0].points[1].value,20);assert.equal(groups[0].points[1].excluded,1);
 assert.equal(groups[1].points[0].value,10);assert.equal(groups[1].points[1].value,20);
 assert.equal(groups[2].points[1].value,4);assert.equal(groups[2].points[1].sampleCount,2);
 assert.deepEqual(Array.from(groups[2].points[1].issues,x=>x.key),['a','b']);
});
test('零天有效；空值、字符串、负数与缺失阶段不当成零天，阶段按参与问题而非进入次数平均',()=>{
 const groups=build([issue('zero',1,'S',0,0),issue('null',1,'S',null,null),issue('string',1,'S','10','3'),issue('negative',1,'S',-1,-1),issue('reentry',1,'S',10,2.75),issue('skipped',1,'S',20,undefined,{completedStageDays:{}})]);
 assert.equal(groups[0].points[0].value,10);assert.equal(groups[0].points[0].sampleCount,3);
 assert.equal(groups[2].points[1].value,1.375);assert.equal(groups[2].points[1].sampleCount,2);
 assert.equal(groups[2].points[0].value,null);
});
test('动态新增/改名/未分类数据保留；父级直接映射单独标明未细分避免遗漏和双计',()=>{
 const data={categories:[...categories,{id:6,name:'超声波雷达',parentItemId:2,sortOrder:40}],funnel,issues:[issue('new',6,'B',3,1),issue('parent',2,'S',5,2),issue('unmapped',null,'UNKNOWN',7,3)]};
 const groups=context.jiraDurationGroups(data);
 assert.equal(groups[0].points.find(p=>p.name==='超声波雷达').value,3);
 assert.equal(groups[0].points.find(p=>p.name==='传感器（未细分）').value,5);
 assert.equal(groups[0].points.find(p=>p.name==='未分类').value,7);
 assert.equal(groups[0].points.reduce((sum,p)=>sum+p.sampleCount,0),3);
});
test('一个ECharts实例、三个横向网格、同一Y轴刻度、三条独立且不跨空值的折线',()=>{
 const groups=build([issue('a',1,'S',10,2),issue('b',3,'A',20,6)]);
 const option=context.jiraDurationOption(groups,1300);
 assert.equal(option.grid.length,3);assert.equal(option.series.length,3);
 for(let i=0;i<3;i++){
  assert.equal(option.series[i].type,'line');assert.equal(option.series[i].xAxisIndex,i);assert.equal(option.series[i].yAxisIndex,i);assert.equal(option.series[i].connectNulls,false);
  assert.equal(option.yAxis[i].min,0);assert.equal(option.yAxis[i].max,20);assert.equal(option.yAxis[i].interval,4);
  if(i)assert.ok(option.grid[i].left>option.grid[i-1].left+option.grid[i-1].width);
 }
 assert.equal(option.series[0].data[2],null);assert.equal(option.series[1].data[2],null);
});
test('空数据不伪造0天；稠密分类全部进入横轴与序列',()=>{
 const empty=context.jiraDurationOption(build([]),1300);assert.ok(empty.series.every(s=>s.data.every(x=>x===null)));assert.equal(empty.yAxis[0].max,1);
 const many={categories:Array.from({length:30},(_,i)=>({id:i,name:'动态分类'+i,parentItemId:null,sortOrder:i})),funnel,issues:[]};
 const groups=context.jiraDurationGroups(many),option=context.jiraDurationOption(groups,1300);
 assert.equal(option.xAxis[0].data.length,30);assert.equal(option.series[0].data.length,30);assert.equal(option.xAxis[0].axisLabel.interval,0);
});

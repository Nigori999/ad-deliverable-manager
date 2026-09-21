const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context=vm.createContext({console,ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},window:{},document:{},esc:x=>String(x).replaceAll('<','&lt;')});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../wwwroot/js/jira-echarts.js'),'utf8'),context);
const categories=[{id:1,name:'ADS',parentItemId:null,sortOrder:10},{id:2,name:'传感器',parentItemId:null,sortOrder:20},{id:3,name:'激光雷达',parentItemId:2,sortOrder:10},{id:4,name:'摄像头',parentItemId:2,sortOrder:20},{id:5,name:'前视',parentItemId:4,sortOrder:10}];
const issues=[1,3,4,5,null,null,999,2].map((id,i)=>({key:String(i),stageCode:'analysis',categoryItemId:id,variantLabel:i===4?'新选项':i===5?'未填写':'原始值'}));
issues.push({stageCode:'closed',categoryItemId:3});
const data={categories,issues};
const groups=(source=data)=>context.jiraDimensionGroups(source,source.issues.filter(x=>x.stageCode!=='closed')).category;
test('所有叶子与父级直接映射分别计数，不含已关闭、不丢失或双计',()=>{
 assert.deepEqual(Array.from(groups(),x=>[x.name,x.issues.length]),[['ADS',1],['传感器（未细分）',1],['激光雷达',1],['摄像头（未细分）',1],['前视',1],['未分类',3]]);
 assert.equal(groups().reduce((sum,x)=>sum+x.issues.length,0),8);
});
test('明细父级筛选包含全部后代，叶子按稳定ID匹配',()=>{
 assert.equal(context.jiraCategoryIncludes(data,issues[3],'2'),true);
 assert.equal(context.jiraCategoryIncludes(data,issues[0],'2'),false);
 const renamed={...data,categories:categories.map(x=>x.id===2?{...x,name:'新传感器名称'}:x)};
 assert.equal(context.jiraCategoryLabel(renamed,issues[3]),'新传感器名称 / 摄像头 / 前视');
 assert.equal(context.jiraCategoryIncludes(renamed,issues[3],'5'),true);
});
test('未映射、删除分类、空字段均保留在未分类，原始名称仍在问题中',()=>{
 assert.equal(groups().at(-1).issues.length,3);
 assert.ok(groups().at(-1).issues.some(x=>x.variantLabel==='新选项'));
 assert.equal(groups({...data,categories:categories.filter(x=>x.id!==3)}).at(-1).issues.length,4);
});
test('空字典/空数据及动态增加的分类无需写死代码',()=>{
 assert.equal(groups({categories:[],issues:[]}).length,0);
 assert.equal(groups({categories:[],issues})[0].issues.length,8);
 const added={...data,categories:[...categories,{id:9,name:'毫米波雷达',parentItemId:2,sortOrder:30}]};
 assert.equal(groups(added).find(x=>x.name==='毫米波雷达').issues.length,0);
 assert.match(context.jiraCategoryOptions(added),/传感器 \/ 毫米波雷达/);
});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../wwwroot/js/jira-closure.js'),'utf8'),context);
test('关闭率只看状态，按期率分母含所有已关闭及无法判定，沿用每问题服务端判断',()=>{
 const sample=[{stageCode:'closed',isOnTime:true},{stageCode:'closed',isOnTime:false},{stageCode:'closed',isOnTime:null},{stageCode:'analysis',isOnTime:true}].map((x,i)=>({...x,key:i,categoryItemId:1,severityKey:'S',stageTimings:[{overdueDays:10}]}));
 const result=context.jiraRateGroups({categories,issues:sample});
 for(const group of [result.category[0],result.severity[0]]){
  assert.equal(group.closureRate,75);assert.equal(group.onTimeRate,100/3);assert.equal(group.onTime,1);assert.equal(group.overdue,1);assert.equal(group.unknown,1);
 }
 assert.equal(result.category.find(g=>g.key==='3').closureRate,null);
 assert.equal(result.severity.find(g=>g.key==='A').onTimeRate,null);
});
test('未知严重等级保留；两个维度汇总回全部分母；零关闭率区别于无样本',()=>{
 const sample=[{stageCode:'analysis',categoryItemId:3,severityKey:'A'},{stageCode:'closed',categoryItemId:null,severityKey:'P1',isOnTime:false}];
 const result=context.jiraRateGroups({categories,issues:sample});
 for(const groups of Object.values(result)){
  assert.equal(groups.reduce((n,g)=>n+g.total,0),2);assert.equal(groups.reduce((n,g)=>n+g.closed.length,0),1);
 }
 const lidar=result.category.find(g=>g.key==='3');assert.equal(lidar.closureRate,0);assert.equal(lidar.onTimeRate,null);
 assert.equal(result.severity.at(-1).name,'未匹配等级');assert.equal(result.severity.at(-1).onTimeRate,0);
});
test('比率柱状图统一0–100%，零值保留、空值不补零，PDF全部分类只生成一张图',()=>{
 const groups=context.jiraRateGroups({categories,issues:[]}).category;
 const screen=context.jiraRateOption(groups,'onTimeRate','按期关闭率',400),pdf=context.jiraRateOption(groups,'onTimeRate','按期关闭率',600,true);
 assert.equal(screen.yAxis.max,100);assert.equal(screen.yAxis.min,0);assert.equal(screen.series[0].type,'bar');
 assert.ok(screen.series[0].data.every(v=>v===null));assert.equal(pdf.dataZoom.length,0);assert.equal(pdf.series.length,1);assert.equal(pdf.xAxis.data.length,groups.length);
});

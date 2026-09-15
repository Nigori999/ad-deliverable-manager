const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context=vm.createContext({console,ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},window:{},document:{},esc:x=>String(x).replaceAll('<','&lt;')});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../wwwroot/js/jira-echarts.js'),'utf8'),context);
const categories=[{id:1,name:'ADS',parentItemId:null,sortOrder:10},{id:2,name:'传感器',parentItemId:null,sortOrder:20},{id:3,name:'激光雷达',parentItemId:2,sortOrder:10},{id:4,name:'摄像头',parentItemId:2,sortOrder:20},{id:5,name:'前视',parentItemId:4,sortOrder:10}];
const issues=[1,3,4,5,null,null,999,2].map((id,i)=>({key:String(i),stageCode:'analysis',categoryItemId:id,variantLabel:i===4?'新选项':i===5?'未填写':'原始值'}));
issues.push({stageCode:'closed',categoryItemId:3});
const data={categories,issues};
const groups=selection=>context.jiraCategoryGroups(data,selection);
test('大类分布覆盖全部未关闭问题，一条问题只计一次，已关闭不参与',()=>{
 assert.deepEqual(Array.from(groups(''),x=>[x.name,x.value]),[['ADS',1],['传感器',4],['未分类',3]]);
 assert.equal(groups('').reduce((sum,x)=>sum+x.value,0),8);
});
test('选择父级含全部后代，本级直接映射的问题单独保留',()=>{
 assert.deepEqual(Array.from(groups('2'),x=>[x.name,x.value]),[['激光雷达',1],['传感器（本级）',1],['摄像头',2]]);
 assert.equal(context.jiraCategoryIncludes(data,issues[3],'2'),true);
 assert.equal(context.jiraCategoryIncludes(data,issues[0],'2'),false);
});
test('多层与叶子筛选按稳定ID，不依赖显示名',()=>{
 assert.equal(groups('4').reduce((sum,x)=>sum+x.value,0),2);
 assert.equal(groups('5')[0].value,1);
 const renamed={...data,categories:categories.map(x=>x.id===2?{...x,name:'新传感器名称'}:x)};
 assert.equal(context.jiraCategoryLabel(renamed,issues[3]),'新传感器名称 / 摄像头 / 前视');
 assert.equal(context.jiraCategoryIncludes(renamed,issues[3],'2'),true);
});
test('未分类保留原始名称，删除分类后问题仍在未分类，不丢失',()=>{
 assert.equal(groups('unmapped').length,3);
 assert.ok(groups('unmapped').some(x=>x.name==='新选项'));
 assert.equal(context.jiraCategoryIncludes(data,issues[6],'unmapped'),true);
 const removed={...data,categories:categories.filter(x=>x.id!==3)};
 assert.equal(context.jiraCategoryGroups(removed,'unmapped').reduce((sum,x)=>sum+x.value,0),4);
});
test('空字典/空数据正常展示；动态新增分类自动出现在筛选器',()=>{
 assert.equal(context.jiraCategoryGroups({categories:[],issues:[]},'').length,0);
 assert.equal(context.jiraCategoryGroups({categories:[],issues},'')[0].value,8);
 assert.match(context.jiraCategoryOptions({categories:[...categories,{id:9,name:'毫米波雷达',parentItemId:2,sortOrder:30}]}),/传感器 \/ 毫米波雷达/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({Date,Map,Set,console});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../wwwroot/js/jira-closure.js'),'utf8'),context);
const run=(script)=>vm.runInContext(script,context);
const issue=(key,date,days,onTime,limit=14)=>({key,projectKey:'AD',stageCode:'closed',closedAt:date,
  closureLimitDays:limit,closureElapsedDays:days,isOnTime:onTime,timingReliable:true,
  closureEvents:[{closedAt:date,reopenedAt:null,elapsedDays:days,isOnTime:onTime,timingReliable:true}]});

test('按期率包含超期分母、排除无法判定和未关闭，不能退化为普通关闭率',()=>{
  context.items=[issue('AD-1','2026-09-02T12:00:00+08:00',14,true),issue('AD-2','2026-09-03T12:00:00+08:00',14.00001,false),
    {...issue('AD-3','2026-09-04T12:00:00+08:00',10,null),timingReliable:false}, {stageCode:'analysis',isOnTime:null}];
  const s=run('jiraClosureSummary(items)');assert.equal(s.onTimeRate,50);assert.equal(s.onTimeClosed,1);assert.equal(s.assessedClosed,2);assert.equal(s.unassessableClosed,1);
});

test('不同项目时限的服务端判定保持独立，前端不会写死S级14天',()=>{
  context.items=[issue('AD-1','2026-09-02T12:00:00+08:00',18,true,21),{...issue('BD-1','2026-09-02T12:00:00+08:00',12,false,10),projectKey:'BD'}];
  assert.equal(run('jiraClosureSummary(items).onTimeRate'),50);
  context.items[0].isOnTime=false;assert.equal(run('jiraClosureSummary(items).onTimeRate'),0);
});

test('部分月份同比只比较相同进度，并按Jira时区归档',()=>{
  context.data={effectiveCutoff:'2026-09-11T12:00:00+08:00',issues:[
    issue('AD-1','2026-08-31T16:30:00Z',14,true),issue('AD-2','2026-09-11T05:00:00Z',15,false),
    issue('AD-3','2025-09-11T03:00:00Z',12,true),issue('AD-4','2025-09-12T03:00:00Z',16,false)]};
  const row=run("jiraClosureComparisons(data,'month','yoy','2026-09-01','2026-09-11')[0]");
  assert.equal(row.current.assessed,1);assert.equal(row.current.rate,100);assert.equal(row.base.assessed,1);assert.equal(row.partial,true);
});

test('完成月份对比完整上月，不将31天和28天截成相同时长',()=>{
  context.data={effectiveCutoff:'2026-04-02T12:00:00Z',issues:[issue('AD-1','2026-02-28T23:00:00Z',3,true),issue('AD-2','2026-03-31T23:00:00Z',5,true)]};
  const row=run("jiraClosureComparisons(data,'month','mom','2026-03-01','2026-03-31')[0]");
  assert.equal(row.base.count,1);assert.equal(row.current.count,1);assert.equal(row.partial,false);
});

test('周以周一开始，跨年ISO周及缺失第53周不会错配',()=>{
  assert.equal(run("new Date(jiraPeriodStart(Date.parse('2026-01-01'),'week')).toISOString().slice(0,10)"),'2025-12-29');
  assert.equal(run("jiraPeriodLabel(Date.parse('2025-12-29'),'week')"),'2026 W01');
  assert.equal(run("jiraComparisonStart(Date.parse('2020-12-28'),'week','yoy')"),null);
});

test('重新打开的问题按周期末状态去重，历史关闭不会被当前未关闭状态抹掉',()=>{
  const x=issue('AD-1','2026-01-05T00:00:00Z',4,true);
  x.closureEvents[0].reopenedAt='2026-02-02T00:00:00Z';
  x.closureEvents.push({closedAt:'2026-02-05T00:00:00Z',reopenedAt:'2026-02-06T00:00:00Z',elapsedDays:35,isOnTime:false,timingReliable:true});
  x.stageCode='analysis';x.closedAt=null;
  context.data={effectiveCutoff:'2026-03-01T00:00:00Z',issues:[x]};
  const rows=run("jiraClosureComparisons(data,'month','mom','2026-01-01','2026-02-28')");
  assert.equal(rows[0].current.count,1);assert.equal(rows[1].current.count,0);
});

test('关闭周期包含超期样本，无时限只影响按期率，不影响可靠周期',()=>{
  context.items=[issue('AD-1','2026-09-02T00:00:00Z',10,true),issue('AD-2','2026-09-03T00:00:00Z',20,false),issue('AD-3','2026-09-04T00:00:00Z',30,null,null)];
  const sample=run("jiraPeriodSample(items,Date.parse('2026-09-01'),Date.parse('2026-10-01'),0)");
  assert.equal(sample.rate,50);assert.equal(sample.days,20);assert.equal(sample.unknown,1);assert.equal(sample.durationCount,3);
});

test('无样本返回空值；年度同比与环比基期一致',()=>{
  assert.equal(run('jiraClosureSummary([]).onTimeRate'),null);
  assert.equal(run("jiraComparisonStart(Date.parse('2026-01-01'),'year','yoy')"),run("jiraComparisonStart(Date.parse('2026-01-01'),'year','mom')"));
});

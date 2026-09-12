const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..');
const output=process.env.JIRA_TEST_OUTPUT_DIR;
if(output)fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=require('node:http').createServer((req,res)=>{
   const pathname=new URL(req.url,'http://localhost').pathname;
   const file=path.resolve(repo,'wwwroot','.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(path.join(repo,'wwwroot')+path.sep)){res.writeHead(403).end();return;}
   fs.readFile(file,(error,body)=>{if(error){res.writeHead(404).end();return;}
     res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(body);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,
   args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process']});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let records=[],nextId=1,optionDelay=0,optionFailure=false,saveFailure=false;
 const categories=[{id:1,name:'定位分析耗时'},{id:2,name:'跨团队或供应商依赖'}];
 const issues=Array.from({length:18},(_,i)=>{const month=i<6?'09':i<12?'08':'07',day=String(i%6+1).padStart(2,'0'),elapsed=i%3===0?18:i%3===1?14:9,onTime=elapsed<=14;
 const closedAt=`2026-${month}-${day}T12:00:00+08:00`;return {issueId:String(100+i),key:`AD-${i+1}`,summary:['城市NOA路口通行策略优化，供应商版本修复后完成验证','高速匝道变道时机异常','停车场车位识别问题'][i%3],url:`https://jira.example/browse/AD-${i+1}`,status:'Closed',stageCode:'closed',stageName:'问题关闭',assignee:'张工',severityLabel:i%2?'A级':'S级',severityKey:i%2?'A':'S',variantLabel:'ADS',variantKey:'ADS',maxReachedStageOrder:5,createdAt:new Date(Date.parse(closedAt)-elapsed*86400000).toISOString(),closedAt,closureElapsedDays:elapsed,closureLimitDays:14,closureOverdueDays:onTime?0:4,stageElapsedDays:0,stageLimitDays:null,stageOverdueDays:0,completedStageDays:{analysis:i%3===0?6:1},historyTruncated:false,isOnTime:onTime,timingReliable:true,stageTimings:[{code:'analysis',name:'原因分析',elapsedDays:i%3===0?6:1,limitDays:2,overdueDays:i%3===0?4:0},{code:'fix',name:'问题修复',elapsedDays:i%3===0?5:i%3===1?4:2,limitDays:2,overdueDays:i%3===0?3:i%3===1?2:0}],closureEvents:[{closedAt,reopenedAt:null,elapsedDays:elapsed,isOnTime:onTime,timingReliable:true}]};});
 const fixture={data:{project:'AD',standard:{id:1,projectName:'A10',revision:3},jiraBaseUrl:'https://jira.example',generatedAt:'2026-09-11T12:00:00+08:00',effectiveCutoff:'2026-09-11T12:00:00+08:00',sourceTotal:issues.length,issues},preset:{name:'A10全部问题',projectKey:'AD',severityFieldId:'customfield_100',variantFieldId:'customfield_101'}};
 await page.route('**/internal/**',async route=>{const req=route.request(),url=new URL(req.url());let body={};
 if(url.pathname==='/internal/auth/status')body={authenticated:false};
 else if(url.pathname==='/internal/jira-reviews/reference-data'){
 if(optionDelay)await new Promise(r=>setTimeout(r,optionDelay));
 if(optionFailure){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'分类服务暂时不可用'})});return;}
 body={categories};
 }
 else if(url.pathname==='/internal/jira-reviews'&&req.method()==='GET')body={items:records};
 else if(url.pathname==='/internal/jira-reviews'&&req.method()==='POST'){
 if(saveFailure){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'标准已变化，请重新分析'})});return;}
 const p=req.postDataJSON(),issue=issues.find(x=>x.key===p.issueKey);assert.equal(p.severityFieldId,'customfield_100');assert.equal(p.projectKey,'AD');
 records.push({id:nextId++,snapshot:{...issue,projectKey:'AD',jiraBaseUrl:'https://jira.example',standardRevision:3,cutoffDate:p.cutoffDate},reason:p.reason,responsiblePerson:p.responsiblePerson,categoryItemId:p.categoryItemId,categoryName:categories.find(x=>x.id===p.categoryItemId).name,createdBy:'测试用户',updatedBy:'测试用户',createdAt:'2026-09-11T12:00:00Z',updatedAt:'2026-09-11T12:00:00Z',revision:1});body={id:records.at(-1).id};
 }else if(url.pathname.startsWith('/internal/jira-reviews/')&&req.method()==='PUT'){
 const id=Number(url.pathname.split('/').at(-1)),p=req.postDataJSON(),r=records.find(x=>x.id===id);Object.assign(r,{reason:p.reason,responsiblePerson:p.responsiblePerson,categoryItemId:p.categoryItemId,categoryName:categories.find(x=>x.id===p.categoryItemId).name,revision:r.revision+1});
 }else if(url.pathname.startsWith('/internal/jira-reviews/')&&req.method()==='DELETE'){records=records.filter(x=>x.id!==Number(url.pathname.split('/').at(-1)));}
 else if(url.pathname==='/internal/jira-board/comments')body={items:[]};
 else throw Error(`Unexpected route ${req.method()} ${url.pathname}`);
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('#auth-form');
 const fontRoot=process.env.JIRA_TEST_FONT_DIR;
 if(fontRoot&&fs.existsSync(fontRoot)){
 let css=fs.readFileSync(fontRoot+'/400.css','utf8').replaceAll('Noto Sans SC','Microsoft YaHei UI');
 css=css.replace(/url\(([^)]+)\)/g,(_,url)=>'url(data:font/woff2;base64,'+fs.readFileSync(path.join(fontRoot,url.replace(/["']/g,''))).toString('base64')+')');
 await page.addStyleTag({content:css+'body{font-family:"Microsoft YaHei UI",sans-serif}'});await page.evaluate(()=>document.fonts.ready);
 }

 await page.evaluate(f=>{
 state.auth={authenticated:true,user:{permissions:['JIRA_BOARD_VIEW','JIRA_REVIEW_VIEW','JIRA_REVIEW_CREATE','JIRA_REVIEW_EDIT','JIRA_REVIEW_DELETE']}};state.route='jira-board';authRoot.replaceChildren();appShell.classList.remove('hidden');
 content.innerHTML='<div class="jira-board"><section class="jira-config-card" style="display:none"></section><div id="jira-board-results"></div></div>';
 jiraBoardState.analysis=mergeJiraAnalyses([f],'2026-09-11');jiraBoardState.comparison={unit:'month',mode:'mom',from:'2026-07-01',to:'2026-09-11'};renderJiraResults(jiraBoardState.analysis);setPage('JIRA看板','统计与复盘验证');
 },fixture);
 assert.match(await page.locator('[data-jira-kind="on-time"]').innerText(),/66.7%/);
 await page.locator('[data-jira-kind="on-time"]').click();
 await page.locator('.jira-closed-table').waitFor();
 assert.match(await page.locator('.jira-detail-head h3').innerText(),/按期关闭问题（总周期）/);
 assert.equal(await page.locator('.jira-closed-table tbody tr').count(),12);
 assert.equal(await page.locator('.jira-closed-table th').allTextContents().then(x=>x.includes('是否关闭超期')),false);
 await page.locator('[data-review-filter="timing"]').selectOption('');
 assert.equal(await page.locator('.jira-closed-table tbody tr').count(),12);
 assert.equal(await page.locator('[data-review-filter="timing"] option[value="超期"]').count(),0);
 assert.equal(await page.locator('.jira-closed-table tbody tr').first().locator('td').nth(5).innerText(),'2天');
 const downloadPromise=page.waitForEvent('download');await page.locator('[data-closed-export]').click();
 const download=await downloadPromise,chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);
 const csv=Buffer.concat(chunks).toString('utf8');assert.equal(csv.split('\r\n').length,13);assert.ok(!csv.includes('"AD-1"'));assert.ok(!csv.includes('是否关闭超期'));
 await page.locator('.jira-detail-close').click();
 if(output)await page.locator('#jira-closure-comparison').screenshot({path:path.join(output,'jira-charts.png')});
 await page.locator('[data-jira-kind="closed-list"]').click();await page.waitForSelector('[data-closed-review="0"]:not([disabled])');
 assert.equal(await page.locator('.jira-closed-table th').first().innerText(),'操作');
 assert.equal(await page.locator('.jira-closed-table tbody tr').count(),18);
 assert.equal(await page.locator('.jira-closed-table tbody tr').first().locator('td').nth(5).innerText(),'7天');
 await page.locator('[data-review-filter="timing"]').selectOption('超期');assert.equal(await page.locator('.jira-closed-table tbody tr').count(),6);
 optionDelay=1200;
 await page.locator('[data-closed-review="0"]').click();
 assert.equal(await page.locator('.jira-review-drawer').isVisible(),true);
 assert.equal(await page.locator('[data-review-save]').isDisabled(),true);
 await page.locator('textarea').fill('加载分类时也可以填写');
 await page.waitForSelector('[data-review-save]:not([disabled])');optionDelay=0;
 await page.locator('textarea').fill('');
 await page.locator('[data-review-save]').click();assert.equal(records.length,0);
 await page.locator('textarea[name="reason"]').fill('供应商定位耗时，补充日志后完成修复。');await page.locator('input[name="responsiblePerson"]').fill('供应商张工');await page.locator('select[name="categoryItemId"]').selectOption('2');saveFailure=true;await page.locator('[data-review-save]').click();
 await page.locator('[data-review-error]:not([hidden])').waitFor();assert.equal(records.length,0);
 assert.equal(await page.locator('textarea').inputValue(),'供应商定位耗时，补充日志后完成修复。');
 saveFailure=false;await page.locator('[data-review-save]').click();await page.waitForSelector('.jira-review-drawer',{state:'detached'});
 assert.equal(records.length,1);await page.waitForFunction(()=>document.querySelector('[data-closed-review="0"]')?.textContent==='查看 / 编辑');
 await page.locator('[data-review-filter="review"]').selectOption('已复盘');assert.equal(await page.locator('.jira-closed-table tbody tr').count(),1);
 if(output)await page.locator('.jira-detail-modal').screenshot({path:path.join(output,'jira-closed.png')});
 await page.locator('.jira-detail-close').click();
 await page.evaluate(()=>{state.route='jira-reviews';return renderJiraReviews();});await page.waitForSelector('[data-review-open="0"]');
 assert.equal(await page.locator('[data-review-table] th').allTextContents().then(x=>x.includes('是否关闭超期')),false);
 assert.equal(await page.locator('[data-review-table] tbody tr').first().locator('td').nth(5).innerText(),'7天');
 await page.locator('[data-review-open="0"]').click();await page.locator('textarea[name="reason"]').fill('供应商定位耗时；已明确日志交付要求。');await page.locator('[data-review-save]').click();await page.waitForSelector('.jira-review-drawer',{state:'detached'});assert.match(records[0].reason,/日志交付/);
 if(output)await page.screenshot({path:path.join(output,'jira-reviews.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});if(output)await page.screenshot({path:path.join(output,'jira-reviews-mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(overflow.scroll<=overflow.width+2,JSON.stringify(overflow));
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>{state.auth.user.permissions=['JIRA_REVIEW_VIEW'];return renderJiraReviews();});assert.equal(await page.locator('[data-review-delete]').count(),0);await page.locator('[data-review-open="0"]').click();assert.equal(await page.locator('[data-review-save]').count(),0);assert.equal(await page.locator('textarea').getAttribute('readonly'),'');await page.locator('[data-review-cancel]').click();
 await page.evaluate(()=>{state.auth.user.permissions.push('JIRA_REVIEW_DELETE');return renderJiraReviews();});await page.locator('[data-review-delete="0"]').click();await page.locator('.modal-submit').click();await page.waitForFunction(()=>document.querySelector('[data-review-table]')?.innerText.includes('暂无复盘记录'));assert.equal(records.length,0);
 
 await page.evaluate(()=>{state.auth.user.permissions=['JIRA_BOARD_VIEW','JIRA_REVIEW_VIEW','JIRA_REVIEW_CREATE','JIRA_REVIEW_EDIT','JIRA_REVIEW_DELETE'];});
 optionFailure=true;
 await page.evaluate(()=>{void openJiraReviewEditor(jiraBoardState.analysis.issues[0]);});
 await page.locator('[data-category-retry]').waitFor();assert.equal(await page.locator('.jira-review-drawer').isVisible(),true);
 await page.locator('textarea').fill('失败后保留的原因');optionFailure=false;
 await page.locator('[data-category-retry]').click();await page.waitForSelector('[data-review-save]:not([disabled])');
 assert.equal(await page.locator('textarea').inputValue(),'失败后保留的原因');await page.locator('[data-review-cancel]').click();
 optionDelay=1200;
 await page.evaluate(()=>{void openJiraReviewEditor(jiraBoardState.analysis.issues[0]);});
 await page.locator('[data-review-cancel]').click();await page.waitForTimeout(1400);assert.equal(await page.locator('.jira-review-drawer').count(),0);optionDelay=0;
 // All chart drilldowns share the standard/compact list; exercise their common renderer and actual chart entry points.
 for(const size of [{width:1440,height:900},{width:1280,height:720},{width:1024,height:768},{width:390,height:844},{width:844,height:390}]){
   await page.setViewportSize(size);
   for(const variant of ['standard','compact','closed']){
     await page.evaluate(v=>{
       const source=jiraBoardState.analysis.issues;
       const many=Array.from({length:121},(_,i)=>({...source[i%source.length],key:`TEST-${i+1}`,summary:'带有很长标题的穿透问题，用于验证自动换行和操作列：'+('测试说明'.repeat(15)),assignee:'处理人姓名和部门较长的展示测试'}));
       if(v==='closed')void openJiraClosedDetails({...jiraBoardState.analysis,issues:many});
       else openJiraDetails('穿透列表 · 较长的图表名称和当前统计范围',many,'closure',{compact:v==='compact'});
     },variant);
     await page.locator('.jira-detail-pagination').waitFor();
     const layout=await page.evaluate(()=>{
       const modal=document.querySelector('.jira-detail-modal'),table=document.querySelector('.jira-detail-table-wrap'),footer=document.querySelector('.jira-detail-pagination');
       const m=modal.getBoundingClientRect(),t=table.getBoundingClientRect(),f=footer.getBoundingClientRect();
       return {left:m.left,right:m.right,bottom:m.bottom,width:innerWidth,height:innerHeight,tableHeight:t.height,footerHeight:f.height,modalScroll:modal.scrollHeight>modal.clientHeight,footerBottom:f.bottom};
     });
     assert.ok(layout.left>=0&&layout.right<=size.width+1&&layout.bottom<=size.height+1,JSON.stringify({variant,size,layout}));
     assert.ok(layout.tableHeight>=85,JSON.stringify({variant,size,layout}));
     const next=page.locator(variant==='closed'?'[data-closed-next]':'[data-page="next"]');await next.click();
     assert.match(await page.locator('.jira-detail-pagination').innerText(),/2\/3/);
     const search=page.locator('.jira-detail-modal').locator(variant==='closed'?'[data-review-filter="keyword"]':'#jira-detail-search');
     await search.fill('TEST-121');assert.equal(await page.locator('.jira-detail-table-wrap tbody tr').count(),1);
     await search.fill('no-matching-issue');assert.equal(await page.locator('.jira-detail-modal .jira-no-data').isVisible(),true);
     await page.locator('.jira-detail-close').click();
   }
 }
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>{content.innerHTML='<div id="jira-board-results"></div>';renderJiraResults(jiraBoardState.analysis);});
 for(const selector of ['[data-jira-kind="on-time"]','[data-jira-stage]','[data-jira-duration]','[data-jira-compare-point]','[data-jira-rate-severity]','[data-jira-overdue]','[data-jira-variant]','[data-jira-trend-index]','[data-jira-followup]']){
   const entry=selector==='[data-jira-trend-index]'?page.locator(selector).last().locator('circle.hit'):page.locator(selector).first();if(!await entry.count())continue;
   console.log('Checking drilldown',selector);await entry.click();await page.locator('.jira-detail-modal').waitFor({timeout:5000});await page.locator('.jira-detail-close').click();
 }
 for(const size of [{width:1440,height:900},{width:1024,height:768},{width:390,height:844}]){
   await page.setViewportSize(size);
   const layout=await page.locator('#jira-closure-comparison').evaluate(host=>{
     const controls=host.querySelector('.jira-compare-controls').getBoundingClientRect(),hint=host.querySelector('.jira-compare-body>.form-hint').getBoundingClientRect();
     return {width:host.clientWidth,scroll:host.scrollWidth,controlBottom:controls.bottom,hintTop:hint.top,fields:[...host.querySelectorAll('.jira-compare-controls label')].map(label=>({label:label.clientWidth,input:label.querySelector('input,select').getBoundingClientRect().width}))};
   });
   assert.ok(layout.scroll<=layout.width+1&&layout.hintTop>=layout.controlBottom,JSON.stringify(layout));
   assert.ok(layout.fields.every(x=>x.input<=x.label+1),JSON.stringify(layout));
 }
 // Unknown closure timing stays in the denominator throughout card and chart rendering.
 await page.setViewportSize({width:1440,height:900});
 await page.evaluate(()=>{
   const base=jiraBoardState.analysis.issues[0];
   const issues=[true,false,null].map((onTime,i)=>({...base,key:`RATE-${i}`,issueId:`rate-${i}`,isOnTime:onTime,
     closureElapsedDays:i===0?14:15,closureOverdueDays:i===0?0:1,closedAt:'2026-09-02T00:00:00Z',
     closureEvents:[{closedAt:'2026-09-02T00:00:00Z',reopenedAt:null,elapsedDays:i===0?14:15,isOnTime:onTime,timingReliable:true}]}));
   const data=jiraBoardState.analysis;
   data.issues=issues;data.summary={...data.summary,...jiraClosureSummary(issues),total:3,closed:3};
   jiraBoardState.comparison={unit:'month',mode:'mom',from:'2026-09-01',to:'2026-09-11'};
   renderJiraResults(data);
 });
 assert.match(await page.locator('[data-jira-kind="on-time"]').innerText(),/33.3%/);
 const ratePoint=page.locator('[data-jira-compare-point][data-kind="current"][data-metric="rate"]').first();
 assert.match(await ratePoint.getAttribute('aria-label'),/按期 1\/3，总周期无法判定 1/);
 await page.locator('[data-jira-kind="on-time"]').click();
 assert.equal(await page.locator('.jira-closed-table tbody tr').count(),1);await page.locator('.jira-detail-close').click();
 await page.evaluate(()=>{
   const data=jiraBoardState.analysis;
   data.issues.push({...data.issues[0],key:'NO-CLOSE-TIME',issueId:'missing',closedAt:null,closureElapsedDays:null,isOnTime:null,timingReliable:false,closureEvents:[]});
   data.summary={...data.summary,...jiraClosureSummary(data.issues),total:4,closed:4};renderJiraResults(data);
 });
 assert.match(await page.locator('[data-jira-kind="on-time"]').innerText(),/25.0%/);
 assert.match(await page.locator('#jira-closure-comparison').innerText(),/缺少关闭状态操作时间/);
 assert.deepEqual(errors,[]);console.log('PASS: full application scripts/styles; review CRUD, slow/error/retry/cancel/save failure, readonly permissions; standard/compact/closed drilldowns with 121 rows at five viewport sizes; chart entry points; zero uncaught JS errors (mock API).');}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});

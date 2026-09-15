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
 const closedAt=`2026-${month}-${day}T12:00:00+08:00`;return {issueId:String(100+i),key:`AD-${i+1}`,summary:['城市NOA路口通行策略优化，供应商版本修复后完成验证','高速匝道变道时机异常','停车场车位识别问题'][i%3],url:`https://jira.example/browse/AD-${i+1}`,status:'Closed',stageCode:'closed',stageName:'问题关闭',assignee:'张工',severityLabel:i%2?'A级':'S级',severityKey:i%2?'A':'S',variantLabel:'ADS',categoryItemId:1,maxReachedStageOrder:5,createdAt:new Date(Date.parse(closedAt)-elapsed*86400000).toISOString(),closedAt,closureElapsedDays:elapsed,closureLimitDays:14,closureOverdueDays:onTime?0:4,stageElapsedDays:0,stageLimitDays:null,stageOverdueDays:0,completedStageDays:{analysis:i%3===0?6:1},historyTruncated:false,isOnTime:onTime,timingReliable:true,stageTimings:[{code:'analysis',name:'原因分析',elapsedDays:i%3===0?6:1,limitDays:2,overdueDays:i%3===0?4:0},{code:'fix',name:'问题修复',elapsedDays:i%3===0?5:i%3===1?4:2,limitDays:2,overdueDays:i%3===0?3:i%3===1?2:0}],closureEvents:[{closedAt,reopenedAt:null,elapsedDays:elapsed,isOnTime:onTime,timingReliable:true}]};});
 const fixture={data:{categories:[{id:1,name:'ADS',parentItemId:null,sortOrder:10},{id:2,name:'传感器',parentItemId:null,sortOrder:20},{id:3,name:'激光雷达',parentItemId:2,sortOrder:20},{id:4,name:'摄像头',parentItemId:2,sortOrder:30}],project:'AD',standard:{id:1,projectName:'A10',revision:3},jiraBaseUrl:'https://jira.example',generatedAt:'2026-09-11T12:00:00+08:00',effectiveCutoff:'2026-09-11T12:00:00+08:00',sourceTotal:issues.length,issues},preset:{name:'A10全部问题',projectKey:'AD',severityFieldId:'customfield_100',variantFieldId:'customfield_101'}};
 const mockApi=async route=>{const req=route.request(),url=new URL(req.url());let body={};
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
 else if(url.pathname==='/internal/jira-board/comments')body={items:req.postDataJSON().issueKeys.map(key=>({key,body:null,created:null}))};
 else throw Error(`Unexpected route ${req.method()} ${url.pathname}`);
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 };
 await page.route('**/internal/**',mockApi);
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
 // Use native ECharts graphic bounds to exercise real mouse events, including both bars.
 const clickChart=async(name,seriesIndex,dataIndex,hover=false)=>{
   const plot=page.locator(`#jira-ec-${name}`);await plot.evaluate(node=>node.scrollIntoView({block:'center'}));
   const point=await plot.evaluate((node,{seriesIndex,dataIndex})=>{
     const chart=echarts.getInstanceByDom(node),data=chart.getModel().getSeriesByIndex(seriesIndex).getData();
     const element=data.getItemGraphicEl(data.indexOfRawIndex(dataIndex));
     if(!element)throw Error(`No graphic for ${node.id}: ${seriesIndex}/${dataIndex}`);
     let x,y;
     if(element.shape?.cx!==undefined){const shape=element.shape,angle=(shape.startAngle+shape.endAngle)/2,radius=(shape.r+(shape.r0||0))/2;x=shape.cx+Math.cos(angle)*radius;y=shape.cy+Math.sin(angle)*radius;}
     else {const bounds=element.getBoundingRect().clone();bounds.applyTransform(element.getComputedTransform());x=bounds.x+bounds.width/2;y=bounds.y+bounds.height/2;}
     const rect=node.getBoundingClientRect();return {x:rect.left+x,y:rect.top+y};
   },{seriesIndex,dataIndex});
   if(hover)await page.mouse.move(point.x,point.y);else await page.mouse.click(point.x,point.y);
 };
 assert.equal(await page.locator('#jira-board-results [data-jira-chart]').count(),12);
 for(const [seriesIndex,key] of [[0,'AD-13'],[1,'AD-7']]){
   await clickChart('compare-rate',seriesIndex,1);
   await page.locator('.jira-detail-modal').waitFor();
   assert.equal(await page.locator('.jira-detail-table-wrap tbody tr').count(),6);
   assert.match(await page.locator('.jira-detail-table-wrap tbody tr').first().innerText(),new RegExp(key));
   assert.equal(await page.locator('.jira-detail-modal [data-jira-chart] svg').count(),2);
   await page.locator('.jira-detail-close').click();
 }
 await clickChart('compare-rate',1,1,true);
 await page.waitForFunction(()=>[...document.querySelectorAll('#jira-ec-compare-rate div')].some(x=>x.innerText.includes('上一周期 2026-07-01')));
 for(const unit of ['week','year','month']){
   await page.locator('[data-compare="unit"]').selectOption(unit);await page.locator('[data-compare-apply]').click();
   assert.equal(await page.locator('.jira-compare-card svg').count(),2);
 }
 await page.locator('[data-compare="mode"]').selectOption('yoy');await page.locator('[data-compare-apply]').click();
 const yearly=await page.locator('#jira-ec-compare-rate').evaluate(node=>echarts.getInstanceByDom(node).getOption());
 assert.equal(yearly.series[0].name,'去年同期');assert.ok(yearly.series[0].data.every(x=>x.value===null));
 assert.ok(yearly.series[2].data.every(x=>x===null));
 await page.locator('[data-compare="mode"]').selectOption('mom');await page.locator('[data-compare-apply]').click();
 // Export a long range through the actual PDF window: four periods per SVG, shared axes, two columns.
 await page.locator('[data-compare="from"]').fill('2025-06-01');await page.locator('[data-compare-apply]').click();
 await page.evaluate(()=>{
   const original=window.open;
   window.open=function(...args){const popup=original.apply(this,args);popup.print=()=>{popup.__printCalled=true;};popup.close=()=>{popup.__closeRequested=true;};window.open=original;return popup;};
   setJiraPdfReady(true);
 });
 // Avoid Chromium single-process interception stalling document.open() popup stylesheet requests.
 await page.unroute('**/internal/**',mockApi);
 const popupPromise=page.waitForEvent('popup');await page.locator('#jira-export-pdf').click();const pdfPage=await popupPromise;
 await pdfPage.bringToFront();
 await pdfPage.waitForFunction(()=>window.__printCalled===true);
 assert.equal(await pdfPage.locator('.jira-compare-card').first().locator('svg').count(),4);
 assert.equal(await pdfPage.locator('.jira-chart-data').count(),0);
 const printLayout=await pdfPage.locator('.jira-compare-grid').evaluate(grid=>{
   const cards=[...grid.children].map(card=>card.getBoundingClientRect());
   return {sameRow:cards[0].top===cards[1].top,overlap:cards[0].right>cards[1].left,
     fits:[...grid.querySelectorAll('.jira-echart>svg')].every(svg=>svg.getBoundingClientRect().width<=svg.parentElement.clientWidth+1)};
 });
 assert.deepEqual(printLayout,{sameRow:true,overlap:false,fits:true});
 if(output){await pdfPage.locator('#jira-closure-comparison').screenshot({path:path.join(output,'jira-charts-pdf.png')});await pdfPage.pdf({path:path.join(output,'jira-board.pdf'),preferCSSPageSize:true,printBackground:true});}
 await pdfPage.close();
 await page.route('**/internal/**',mockApi);
 await page.locator('[data-compare="from"]').fill('2026-07-01');await page.locator('[data-compare-apply]').click();
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
 // Exercise every chart's shared keyboard-accessible data/drilldown entry, including zero bars.
 for(const name of ['funnel','overdue','trend','variant','variant-assignee','closure-total','closure-severity','duration-severity','duration-stage','compare-rate','compare-days']){
   const wrapper=page.locator(`#jira-ec-${name}`).locator('..');
   const button=wrapper.locator('[data-chart-row]').first();if(!await button.count())continue;
   await wrapper.locator('summary').click();await button.focus();await button.press('Enter');
   await page.locator('.jira-detail-modal').waitFor();await page.locator('.jira-detail-close').click();
   await wrapper.locator('summary').click();
 }
 await page.locator('[data-jira-followup]').click();await page.locator('.jira-detail-modal').waitFor();await page.locator('.jira-detail-close').click();
 for(const size of [{width:1440,height:900},{width:1024,height:768},{width:390,height:844}]){
   await page.setViewportSize(size);
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-jira-chart]')].every(node=>!node.clientWidth||Math.abs(echarts.getInstanceByDom(node).getWidth()-node.clientWidth)<2));
   if(size.width===1024){
     const visible=await page.locator('#jira-ec-compare-rate').evaluate(node=>{const chart=echarts.getInstanceByDom(node);return {series:chart.getModel().getSeries().map(s=>s.getData().count()),label:chart.getModel().getComponent('xAxis').axis.scale.getExtent()};});
     assert.deepEqual(visible,{series:[1,1,1],label:[2,2]});
     await clickChart('compare-rate',1,2);await page.locator('.jira-detail-modal').waitFor();
     assert.match(await page.locator('.jira-detail-table-wrap tbody tr').first().innerText(),/AD-1\b/);
     await page.locator('.jira-detail-close').click();
   }
   const layout=await page.locator('#jira-closure-comparison').evaluate(host=>{
     const controls=host.querySelector('.jira-compare-controls').getBoundingClientRect(),hint=host.querySelector('.jira-compare-body>.form-hint').getBoundingClientRect();
     const cards=[...host.querySelectorAll('.jira-compare-card')].map(card=>card.getBoundingClientRect());
     return {sameRow:cards[0].top===cards[1].top,width:host.clientWidth,scroll:host.scrollWidth,controlBottom:controls.bottom,hintTop:hint.top,fields:[...host.querySelectorAll('.jira-compare-controls label')].map(label=>({label:label.clientWidth,input:label.querySelector('input,select').getBoundingClientRect().width}))};
   });
   assert.equal(layout.sameRow,size.width>760,JSON.stringify(layout));
   assert.ok(layout.scroll<=layout.width+1&&layout.hintTop>=layout.controlBottom,JSON.stringify(layout));
   assert.ok(layout.fields.every(x=>x.input<=x.label+1),JSON.stringify(layout));
   if(output)await page.locator('#jira-closure-comparison').screenshot({path:path.join(output,`jira-charts-${size.width}.png`)});
 }
 // Nonzero samples cover native events across all chart families and long category lists.
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(f=>{
   const active=Array.from({length:24},(_,i)=>({...f.data.issues[0],key:`OPEN-${i+1}`,issueId:`open-${i}`,stageCode:['new','confirm','analysis','action','verify'][i%5],stageName:['创建','问题确认','原因分析','措施确认','测试验证'][i%5],maxReachedStageOrder:i%5,status:'Analysis',
     assignee:`处理人${String(i+1).padStart(2,'0')}（供应商项目团队）`,categoryItemId:i<12?1:3,variantLabel:i<12?'ADS':'LiDAR',severityKey:i%2?'A':'S',severityLabel:i%2?'A级':'S级',
     closedAt:null,isOnTime:null,closureEvents:[],closureElapsedDays:null,stageOverdueDays:i%2?3:0,closureOverdueDays:i%3?0:4,completedStageDays:i%5>=3?{analysis:8}:{} }));
   jiraBoardState.commentCache.clear();jiraBoardState.analysis=mergeJiraAnalyses([{...f,data:{...f.data,issues:[...f.data.issues,...active]}}],'2026-09-11');
   jiraBoardState.comparison={unit:'month',mode:'mom',from:'2026-07-01',to:'2026-09-11'};renderJiraResults(jiraBoardState.analysis);
 },fixture);
 await page.waitForFunction(()=>jiraBoardState.pdfReady);
 assert.equal(await page.evaluate(()=>jiraCharts.size),12);
 if(output)await page.locator('#jira-board-results').screenshot({path:path.join(output,'jira-dashboard.png')});
 for(const [name,series,index,count] of [['funnel',0,2,32],['trend',1,79,1],['duration-stage',0,2,27],['overdue',0,2,2],['variant',0,0,12],['variant-assignee',0,0,1],['closure-total',0,0,18],['closure-severity',0,0,21],['duration-severity',0,0,9],['followup',0,0,12]]){
   await clickChart(name,series,index);await page.locator('.jira-detail-modal').waitFor({timeout:5000});
   assert.equal(await page.locator('.jira-detail-table-wrap tbody tr').count(),count,name);
   assert.equal(await page.evaluate(()=>jiraCharts.size),14);
   if(name==='variant'&&output)await page.locator('.jira-detail-modal').screenshot({path:path.join(output,'jira-detail-echarts.png')});
   await page.locator('.jira-detail-close').click();assert.equal(await page.evaluate(()=>jiraCharts.size),12);
 }
 await page.locator('#jira-category-filter').selectOption('3');
 await page.locator('#jira-ec-variant-assignee').evaluate(node=>echarts.getInstanceByDom(node).dispatchAction({type:'dataZoom',startValue:10,endValue:11}));
 await clickChart('variant-assignee',0,11);await page.locator('.jira-detail-modal').waitFor();
 assert.match(await page.locator('.jira-detail-table-wrap tbody tr').first().innerText(),/OPEN-24/);
 await page.locator('.jira-detail-close').click();
 // Repeated partial redraws and route removal release instances instead of retaining detached DOM.
 for(let i=0;i<3;i++){await page.locator('[data-jira-overdue-sort="count"]').click();await page.locator('[data-compare-apply]').click();}
 assert.equal(await page.evaluate(()=>jiraCharts.size),12);
 await page.locator('[data-jira-kind="all"]').click();await page.locator('#jira-detail-search').fill('OPEN-24');
 assert.equal(await page.locator('#jira-ec-detail-severity').evaluate(node=>echarts.getInstanceByDom(node).getOption().series[0].data.reduce((sum,x)=>sum+x.value,0)),1);
 await page.locator('#jira-detail-search').fill('not-present');assert.equal(await page.evaluate(()=>jiraCharts.size),12);
 await page.locator('.jira-detail-close').click();
 await page.evaluate(()=>{content.replaceChildren();});await page.waitForFunction(()=>jiraCharts.size===0);
 await page.evaluate(f=>{content.innerHTML='<div id="jira-board-results"></div>';jiraBoardState.analysis=mergeJiraAnalyses([f],'2026-09-11');renderJiraResults(jiraBoardState.analysis);},fixture);
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
 const ratePoint=page.locator('#jira-ec-compare-rate').locator('..').locator('[data-chart-row="1"]');
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
 // Configurable categories: parent/leaf scope, raw unmapped labels, CSV and PDF.
 await page.evaluate(f=>{
   const active=[1,3,4,null,null].map((categoryItemId,i)=>({...f.data.issues[0],key:`CAT-${i}`,issueId:`cat-${i}`,categoryItemId,variantLabel:['ADS','LiDAR','Front camera','New Radar','未填写'][i],stageCode:'analysis',status:'Analysis',closedAt:null,isOnTime:null,closureEvents:[]}));
   jiraBoardState.categoryId='';jiraBoardState.commentCache.clear();jiraBoardState.analysis=mergeJiraAnalyses([{...f,data:{...f.data,issues:active}}],'2026-09-11');renderJiraResults(jiraBoardState.analysis);
 },fixture);
 const pieData=()=>page.locator('#jira-ec-variant').evaluate(node=>echarts.getInstanceByDom(node).getOption().series[0].data.map(x=>[x.name,x.value]));
 assert.deepEqual(await pieData(),[['ADS',1],['传感器',2],['未分类',2]]);
 await clickChart('variant',0,1);await page.locator('.jira-detail-modal').waitFor();
 assert.equal(await page.locator('.jira-detail-table-wrap tbody tr').count(),2);
 await page.locator('#jira-detail-category').selectOption('4');
 assert.equal(await page.locator('.jira-detail-table-wrap tbody tr').count(),1);
 assert.match(await page.locator('.jira-detail-table-wrap').innerText(),/传感器 \/ 摄像头/);
 const categoryDownload=page.waitForEvent('download');await page.locator('[data-jira-export]').click();
 const categoryCsvDownload=await categoryDownload,categoryChunks=[];
 for await(const chunk of await categoryCsvDownload.createReadStream())categoryChunks.push(chunk);
 const categoryCsv=Buffer.concat(categoryChunks).toString('utf8');
 assert.match(categoryCsv,/问题分类/);assert.match(categoryCsv,/JIRA原始选项/);assert.match(categoryCsv,/Front camera/);assert.doesNotMatch(categoryCsv,/LiDAR/);
 await page.locator('.jira-detail-close').click();
 await page.locator('#jira-category-filter').selectOption('2');
 assert.deepEqual(await pieData(),[['激光雷达',1],['摄像头',1]]);
 await clickChart('variant-assignee',0,0);await page.locator('.jira-detail-modal').waitFor();assert.equal(await page.locator('.jira-detail-table-wrap tbody tr').count(),2);await page.locator('.jira-detail-close').click();
 await page.locator('#jira-category-filter').selectOption('unmapped');
 assert.equal((await pieData()).length,2);assert.ok((await pieData()).some(x=>x[0]==='New Radar'));
 await page.locator('#jira-category-filter').selectOption('3');assert.deepEqual(await pieData(),[['激光雷达',1]]);
 for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
   const overflow=await page.locator('.jira-variant-panel').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,select:el.querySelector('select').getBoundingClientRect().right,right:el.getBoundingClientRect().right}));
   assert.ok(overflow.scroll<=overflow.width+1&&overflow.select<=overflow.right,JSON.stringify(overflow));
   if(output)await page.locator('.jira-variant-panel').screenshot({path:path.join(output,`jira-categories-${width}.png`)});
 }
 await page.waitForFunction(()=>jiraBoardState.pdfReady);
 await page.unroute('**/internal/**',mockApi);
 await page.evaluate(()=>{const original=window.open;window.open=function(...args){const popup=original.apply(this,args);popup.print=()=>{popup.__printCalled=true;};popup.close=()=>{popup.__closeRequested=true;};window.open=original;return popup;};});
 const categoryPopupPromise=page.waitForEvent('popup');await page.locator('#jira-export-pdf').click();const categoryPdf=await categoryPopupPromise;
 await categoryPdf.waitForFunction(()=>window.__printCalled===true);
 assert.equal(await categoryPdf.locator('#jira-category-filter').inputValue(),'3');
 assert.match(await categoryPdf.locator('.jira-variant-panel').innerText(),/激光雷达/);
 assert.equal(await categoryPdf.locator('.jira-variant-panel svg').count(),2);
 await categoryPdf.close();await page.route('**/internal/**',mockApi);
 // Dictionary editor CRUD and field/option mapping payloads using mock persistence.
 const dictionary={id:150,code:'JIRA_ISSUE_CATEGORY',name:'JIRA问题分类',scopeMode:'NONE',structureMode:'TREE',isSystem:true,isEnabled:true,sortOrder:150};
 let dictItems=[{id:201,value:'SENSOR',name:'传感器',parentItemId:null,sortOrder:10,childCount:0,usageCount:0,jiraMappings:[]}],dictPayloads=[];
 await page.route('**/internal/master-data/dictionaries**',async route=>{
   const req=route.request(),url=new URL(req.url());let body={};
   if(req.method()==='GET')body=url.pathname.endsWith('/dictionaries')?{items:[{...dictionary,itemCount:dictItems.length}],scopeOptions:{deliverableTypes:[]}}:{dictionary,items:dictItems};
   else if(req.method()==='POST'||req.method()==='PUT'){
     const p=req.postDataJSON();dictPayloads.push(p);const id=req.method()==='POST'?202:Number(url.pathname.split('/').at(-1));
     const value={id,value:p.itemCode,name:p.itemName,parentItemId:p.parentItemId,sortOrder:p.sortOrder,description:p.description,jiraMappings:p.jiraMappings,childCount:0,usageCount:0};
     dictItems=dictItems.filter(x=>x.id!==id);dictItems.push(value);body={id};
   }else if(req.method()==='DELETE'){dictItems=dictItems.filter(x=>x.id!==Number(url.pathname.split('/').at(-1)));}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.evaluate(()=>{state.route='dictionaries';state.auth.user.permissions=['DICTIONARY_VIEW','DICTIONARY_CREATE','DICTIONARY_EDIT','DICTIONARY_DELETE'];dictionaryManagementState.filters={keyword:'',type:'',structure:'',status:''};return renderDictionaryManagement();});
 await page.locator('.dictionary-item-child').click();
 assert.equal(await page.locator('[name="parentItemId"]').inputValue(),'201');
 await page.locator('[name="itemCode"]').fill('CAMERA');await page.locator('[name="itemName"]').fill('摄像头');
 await page.locator('#jira-mapping-add').click();await page.locator('[data-mapping-value]').fill('Front camera');
 await page.locator('#jira-mapping-add').click();const idRow=page.locator('.jira-mapping-row').nth(1);
 await idRow.locator('[data-mapping-type]').selectOption('ID');assert.equal(await idRow.locator('[data-mapping-field]').getAttribute('required'),'');
 await idRow.locator('[data-mapping-field]').fill('customfield_101');await idRow.locator('[data-mapping-value]').fill('12345');
 for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});const sizes=await page.locator('#dictionary-item-form').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(sizes.scroll<=sizes.width+1,JSON.stringify(sizes));
   if(output)await page.locator('.modal').screenshot({path:path.join(output,`jira-category-editor-${width}.png`)});
 }
 await page.locator('.modal-submit').click();await page.waitForFunction(()=>!document.querySelector('#dictionary-item-form'));
 assert.equal(dictPayloads.at(-1).jiraMappings.length,2);assert.equal(dictPayloads.at(-1).jiraMappings[1].matchValue,'12345');
 await page.locator('.dictionary-item-edit[data-id="202"]').click();assert.equal(await page.locator('.jira-mapping-row').count(),2);
 await page.locator('[name="itemName"]').fill('前视摄像头');await page.locator('.jira-mapping-row').first().locator('button').click();
 await page.locator('.modal-submit').click();await page.waitForFunction(()=>!document.querySelector('#dictionary-item-form'));
 assert.equal(dictPayloads.at(-1).jiraMappings.length,1);assert.equal(dictPayloads.at(-1).itemName,'前视摄像头');
 await page.locator('.dictionary-item-delete[data-id="202"]').click();await page.locator('.modal-submit').click();await page.waitForFunction(()=>!document.querySelector('.dictionary-item-edit[data-id="202"]'));
 await page.evaluate(()=>{state.auth.user.permissions=['DICTIONARY_VIEW'];return renderDictionaryManagement();});
 assert.equal(await page.locator('.dictionary-item-edit,.dictionary-item-delete,#new-dictionary-item').count(),0);
 console.log('PASS: category hierarchy, parent/leaf/unmapped charts, detail filtering, CSV/PDF, responsive editor, mapping create/edit/delete and readonly UI (mock API).');

 assert.deepEqual(errors,[]);console.log('PASS: full application scripts/styles; review CRUD, slow/error/retry/cancel/save failure, readonly permissions; standard/compact/closed drilldowns with 121 rows at five viewport sizes; chart entry points; combo chart axes, period bars, data drilldowns, week/month/year, native ECharts events, zoom, resize, lifecycle and PDF layout; zero uncaught JS errors (mock API).');}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});

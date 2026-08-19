async function renderAnalytics() {
  setPage('完整度分析', '从车型交付完整度与上下游协同链路两个视角识别缺口');
  const data = await api('/internal/analytics/completeness');
  const s = data.summary;
  const projectIssues = (data.projectCompleteness || []).flatMap(project => (project.types || []).flatMap(type => (type.missing || []).map(item => ({kind:'COVERAGE',project, type, item}))));
  const swpIssues = ((data.collaboration?.swpToTestReport?.details)||[]).filter(x=>!x.hasTestReport);
  content.innerHTML = `
    <div class="ux-page-intro analytics-intro"><div><strong>完整度 = 车型交付是否齐全 + 上下游协同是否闭环</strong><span>车型视角按“项目 × 交付物类型 × 启用类别”动态检查；协同视角关注 PRD→FR、FR→测试用例，以及硬件类别的软件包→测试报告验收闭环。</span></div></div>
    <section class="analytics-summary-grid">
      ${analyticsSummaryCard('车型交付完整度',`${s.projectPercent}%`,'各车型应有交付物类别覆盖情况','vehicle')}
      ${analyticsSummaryCard('协同链路完整度',`${s.collaborationPercent}%`,'上下游交付关系与验收闭环','collaboration')}
      ${analyticsSummaryCard('字段数据完整度',`${s.metadataPercent}%`,`${s.completeDeliverables}/${s.deliverables} 项字段完整`,'metadata')}
      ${analyticsSummaryCard('待处理事项',s.pendingReview+s.pendingChanges,`${s.pendingReview} 个待审批版本 · ${s.pendingChanges} 个未关闭变更`,'action')}
    </section>

    <section class="analytics-view-section" id="analytics-vehicle"><div class="analytics-section-head"><div><span class="analytics-section-kicker">01 · 车型视角</span><h3>车型交付物完整度</h3><p>回答“这个车型该有的交付物是否齐全”。期望项直接读取基础设置中各交付物类型启用的类别，不在代码中写死。</p></div><span class="analytics-section-badge">${projectIssues.length?`${projectIssues.length} 项缺失`:'全部完整'}</span></div>
      <div class="analytics-project-grid">${(data.projectCompleteness||[]).length?(data.projectCompleteness||[]).map(project=>projectCompletenessCard(project)).join(''):'<div class="empty">当前数据范围内没有可分析的车型/项目</div>'}</div>
    </section>

    <section class="analytics-view-section" id="analytics-collaboration"><div class="analytics-section-head"><div><span class="analytics-section-kicker">02 · 协同视角</span><h3>上下游链路完整度</h3><p>回答“已经产生的交付物之间，必要的协同关系是否形成闭环”。硬件验收按车型和硬件类别判断，不要求每个 Fix Bug/联调版本都单独出测试报告。</p></div></div>
      <div class="analytics-chain-grid">
        ${chainCard('产品需求 → 功能需求','PRD → FR',data.collaboration?.prdToFr,'检查 PRD 是否通过“派生”关系关联 FR')}
        ${chainCard('功能需求 → 测试用例','FR → TC',data.collaboration?.frToTestCase,'检查 FR 是否通过“验证”关系关联测试用例')}
        ${chainCard('硬件软件包 → 测试报告','SWP → TR',data.collaboration?.swpToTestReport,'按同车型、同硬件类别编码检查是否存在验收测试报告')}
      </div>
      ${swpAcceptanceTable(data.collaboration?.swpToTestReport)}
    </section>

    <section class="analytics-view-section" id="analytics-issues"><div class="analytics-section-head"><div><span class="analytics-section-kicker">03 · 整改视角</span><h3>待整改事项</h3><p>汇总车型缺失、硬件验收缺口和字段质量问题，便于从指标直接落到具体整改对象。</p></div><span class="analytics-section-badge">${projectIssues.length+swpIssues.length+(data.metadataIssues||[]).length} 项</span></div>
      ${renderAnalyticsIssues(projectIssues,swpIssues,data.metadataIssues||[])}
    </section>`;
}

function analyticsSummaryCard(label,value,note,tone){return `<div class="analytics-summary-card ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;}
function projectCompletenessCard(project){return `<article class="analytics-project-card"><div class="analytics-project-head"><div><span class="code">${esc(project.projectCode)}</span><h4>${esc(project.projectName)}</h4></div><div class="analytics-project-score"><strong>${project.percent}%</strong><span>${project.covered}/${project.expected}</span></div></div><div class="compact-progress"><span style="width:${Math.max(0,Math.min(100,project.percent))}%"></span></div><div class="analytics-type-list">${(project.types||[]).map(type=>`<div class="analytics-type-row"><div><strong>${esc(type.typeName)}</strong><small>${type.covered}/${type.expected} 个类别</small></div><div class="analytics-type-status"><b>${type.percent}%</b>${type.missing?.length?`<div class="analytics-missing-tags">${type.missing.map(x=>`<span>${esc(x.name)}</span>`).join('')}</div>`:'<span class="badge released">完整</span>'}</div></div>`).join('')}</div></article>`;}
function chainCard(title,code,item,note){if(!item?.available)return `<article class="analytics-chain-card unavailable"><span class="analytics-chain-code">${esc(code)}</span><h4>${esc(title)}</h4><strong>—</strong><p>${esc(item?.note||'当前数据范围无法分析该链路')}</p></article>`;return `<article class="analytics-chain-card"><span class="analytics-chain-code">${esc(code)}</span><h4>${esc(title)}</h4><div class="analytics-chain-score"><strong>${item.percent}%</strong><span>${item.linked}/${item.total}</span></div><div class="compact-progress"><span style="width:${Math.max(0,Math.min(100,item.percent))}%"></span></div><p>${esc(note)}</p></article>`;}
function swpAcceptanceTable(item){if(!item?.available)return '';const details=item.details||[];return `<div class="analytics-subpanel"><div class="card-head"><div><h4>硬件类别验收闭环</h4><p class="ux-section-note">只判断该车型的硬件类别是否存在测试报告，不按软件版本逐个要求验收报告。</p></div><span class="analytics-section-badge">${item.linked}/${item.total}</span></div><div class="table-wrap"><table><thead><tr><th>车型/项目</th><th>硬件类别</th><th>类别编码</th><th>测试报告</th></tr></thead><tbody>${details.length?details.map(x=>`<tr><td><strong>${esc(x.projectName)}</strong><div class="muted">${esc(x.projectCode)}</div></td><td>${esc(x.categoryName)}</td><td class="code">${esc(x.categoryCode)}</td><td>${x.hasTestReport?'<span class="badge released">已形成验收闭环</span>':'<span class="badge deprecated">缺少测试报告</span>'}</td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">当前没有硬件软件包类别需要检查</div></td></tr>'}</tbody></table></div></div>`;}
function renderAnalyticsIssues(projectIssues,swpIssues,metadataIssues){const rows=[];projectIssues.forEach(x=>rows.push({priority:'高',kind:'车型缺失',object:`${x.project.projectName} · ${x.type.typeName}`,problem:`缺少“${x.item.name}”`,link:'#/deliverables'}));swpIssues.forEach(x=>rows.push({priority:'高',kind:'验收链路',object:`${x.projectName} · ${x.categoryName}`,problem:'硬件软件包已存在，但没有同类别测试报告',link:'#/deliverables'}));metadataIssues.forEach(x=>rows.push({priority:x.percent<70?'高':'中',kind:'数据质量',object:`${x.project} · ${x.name}`,problem:(x.missing||[]).length?`缺少：${x.missing.join('、')}`:'超过90天未更新',link:`#/deliverables/${x.id}`}));return rows.length?`<div class="table-wrap analytics-issue-table"><table><thead><tr><th>优先级</th><th>问题类型</th><th>对象</th><th>问题</th><th>操作</th></tr></thead><tbody>${rows.slice(0,150).map(x=>`<tr><td><span class="badge ${x.priority==='高'?'deprecated':'pending_assessment'}">${x.priority}</span></td><td>${esc(x.kind)}</td><td><strong>${esc(x.object)}</strong></td><td>${esc(x.problem)}</td><td><a class="btn btn-light btn-sm" href="${x.link}">查看</a></td></tr>`).join('')}</tbody></table></div>`:'<div class="ux-empty-success"><strong>当前未发现待整改事项</strong><span>车型覆盖、协同链路和字段数据均处于完整状态。</span></div>';}

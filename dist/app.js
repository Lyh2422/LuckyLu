const LEGACY_STORAGE_KEY = 'mianmian-cycle-v1';
const defaultState = { profile: { nickname: '', cycleLength: 28, periodLength: 5, reminder: true, reminderDays: 3 }, logs: {} };
let state = structuredClone(defaultState);
let session = null;
let activeSpace = null;
let revision = 0;
let currentView = 'today';
let calendarCursor = new Date();
let selectedFlow = '';
let selectedMood = '';
let selectedPain = null;
let selectedSleep = '';
let toastTimer;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const pad = value => String(value).padStart(2, '0');
const toKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (date, amount) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
const dayDiff = (a, b) => Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
const formatDate = date => `${date.getMonth() + 1}月${date.getDate()}日`;

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', 'X-Lulu-CSRF': '1', ...(options.headers || {}) } });
  } catch {
    const error = new Error('无法连接服务器，请检查网络后重试'); error.status = 0; throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || '请求没有成功'); error.status = response.status; error.code = data.code; throw error; }
  return data;
}

function setSyncStatus(kind, text) {
  const indicator = $('#syncIndicator');
  indicator.classList.toggle('sync-saving', kind === 'saving');
  indicator.classList.toggle('sync-error', kind === 'error');
  indicator.lastChild.textContent = ` ${text}`;
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function showAuth(message = '') { $('#authGate').hidden = false; $('#authError').textContent = message; document.body.classList.add('auth-pending'); }
function hideAuth() { $('#authGate').hidden = true; $('#authError').textContent = ''; document.body.classList.remove('auth-pending'); }

function setReadonly(readonly) {
  document.body.classList.toggle('read-only', readonly);
  $('#profileForm').querySelectorAll('input,button').forEach(element => element.disabled = readonly);
  $('#importInput').disabled = readonly; $('#clearButton').disabled = readonly; $('#migrateButton').disabled = readonly;
}

async function loadSession() {
  session = await api('/api/auth/me');
  const remote = await api('/api/state');
  state = { profile: { ...defaultState.profile, ...remote.profile }, logs: remote.logs || {} };
  revision = remote.revision; activeSpace = remote.space;
  hideAuth(); renderAll(); renderAccount();
  setSyncStatus('ok', activeSpace.canEdit ? '已同步' : '只读共享');
  setReadonly(!activeSpace.canEdit);
  $('#migrateButton').hidden = !hasLegacyData() || !activeSpace.canEdit;
  await processInviteFromUrl();
}

async function saveState(message = '已同步') {
  if (!activeSpace?.canEdit) return showToast('当前空间是只读的');
  setSyncStatus('saving', '正在同步');
  try {
    const saved = await api('/api/state', { method: 'PUT', body: JSON.stringify({ ...state, revision }) });
    state = { profile: saved.profile, logs: saved.logs }; revision = saved.revision;
    renderAll(); setSyncStatus('ok', '已同步'); showToast(message);
  } catch (error) {
    setSyncStatus('error', '同步失败');
    if (error.code === 'REVISION_CONFLICT') { showToast('另一台设备刚刚更新了数据，正在刷新'); await loadSession(); }
    else showToast(error.message);
  }
}

function hasLegacyData() {
  try { const old = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)); return Boolean(old?.profile && old?.logs && (Object.keys(old.logs).length || old.profile.nickname)); }
  catch { return false; }
}

function periodStarts() {
  const periodKeys = Object.keys(state.logs).filter(key => state.logs[key].period).sort();
  return periodKeys.filter((key, index) => index === 0 || dayDiff(fromKey(key), fromKey(periodKeys[index - 1])) > 1).map(fromKey);
}
function cycleLengths() { const starts = periodStarts(); return starts.slice(1).map((date, i) => dayDiff(date, starts[i])).filter(length => length >= 15 && length <= 60); }
function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2); }
function estimatedCycle() { const lengths = cycleLengths().slice(-6); return lengths.length ? median(lengths) : state.profile.cycleLength; }
function latestStart() { return periodStarts().at(-1) || null; }
function predictedStart() { const latest = latestStart(); return latest ? addDays(latest, estimatedCycle()) : null; }
function predictionMeta() {
  const lengths = cycleLengths().slice(-6);
  if (!lengths.length) return { label: '初步估算', range: 7, hint: '再记录 2 个完整周期会更可靠' };
  const spread = Math.max(...lengths) - Math.min(...lengths);
  if (lengths.length >= 4 && spread <= 5) return { label: '较高', range: Math.max(2, Math.ceil(spread / 2)), hint: `依据近 ${lengths.length} 个周期，波动约 ${spread} 天` };
  if (lengths.length >= 2) return { label: '一般', range: Math.max(3, Math.ceil(spread / 2)), hint: `依据近 ${lengths.length} 个周期，波动约 ${spread} 天` };
  return { label: '较低', range: 5, hint: '目前只有 1 个完整周期' };
}
function phaseInfo(date = new Date()) {
  const current = fromKey(toKey(date)); const start = latestStart(); const prediction = predictedStart();
  if (!start || !prediction || current < start) return { label: '等待记录', hint: '记录经期开始日后生成阶段' };
  const day = Math.max(1, dayDiff(current, start) + 1);
  if (state.logs[toKey(current)]?.period || day <= state.profile.periodLength) return { label: '经期', hint: `周期第 ${day} 天，优先照顾休息与舒适` };
  if (current < prediction) return { label: '周期中', hint: `周期第 ${day} 天，留意睡眠、情绪和身体感受` };
  return { label: '等待经期', hint: '预测可能有浮动，如有记录请及时更新' };
}
function periodDurations() {
  return periodStarts().map(start => { let count = 0; for (let i = 0; i < 14 && state.logs[toKey(addDays(start, i))]?.period; i++) count++; return count; }).filter(Boolean);
}

function renderAll() { renderToday(); renderCalendar(); renderInsights(); renderSettings(); }

function renderToday() {
  const now = new Date(); const hour = now.getHours(); const nickname = state.profile.nickname.trim();
  $('#greeting').textContent = `${hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好'}${nickname ? `，${nickname}` : ''}`;
  $('#todayDate').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · ${['周日','周一','周二','周三','周四','周五','周六'][now.getDay()]}`;
  const latest = latestStart(); const prediction = predictedStart(); const meta = predictionMeta(); const phase = phaseInfo(now);
  $('#todayPhase').textContent = phase.label; $('#todayPhaseHint').textContent = phase.hint;
  $('#predictionConfidence').textContent = meta.label;
  $('#predictionRange').textContent = prediction ? `${formatDate(addDays(prediction, -meta.range))}—${formatDate(addDays(prediction, meta.range))}` : meta.hint;
  if (latest) {
    const day = Math.max(1, dayDiff(now, latest) + 1); const length = estimatedCycle();
    $('#cycleLabel').textContent = phase.label; $('#cycleDay').textContent = day; $('#cycleCaption').textContent = `周期第 ${day} 天 · 预计 ${length} 天`;
    $('#ringProgress').style.strokeDashoffset = 578 * (1 - Math.min(day, length) / length);
    const until = prediction ? dayDiff(prediction, now) : null;
    $('#heroTitle').innerHTML = until !== null && until >= 0 ? `离下次经期<br><em>大约 ${until} 天</em>` : `听听身体<br><em>今天想说什么</em>`;
    $('#heroSubtitle').textContent = day <= state.profile.periodLength ? '经期里，休息不是偷懒。记下感受，给身体多一点耐心。' : '预测只是参考。睡眠、压力和旅行，都可能让身体改变节奏。';
    $('#dailyInsight').textContent = until !== null && until <= state.profile.reminderDays && until >= 0 && state.profile.reminder ? '经期可能快到了，可以提前准备用品，也给日程留一点余地。' : phase.hint;
  } else {
    $('#cycleLabel').textContent = '等待记录'; $('#cycleDay').textContent = '—'; $('#cycleCaption').textContent = '你的节奏，由你定义'; $('#ringProgress').style.strokeDashoffset = 578;
    $('#heroTitle').innerHTML = '潞潞，听听身体<br><em>今天想说什么</em>'; $('#heroSubtitle').textContent = '先记下一次经期，月汐会慢慢读懂你的节奏。';
    $('#dailyInsight').textContent = '从一次真实记录开始，完整周期越多，预测范围会越清晰。';
  }
  const log = state.logs[toKey(now)] || {};
  $('#todayFlow').textContent = log.period ? (log.flow || '经期中') : '未记录';
  $('#todayPain').textContent = log.painLevel === null || log.painLevel === undefined ? '未记录' : ['无疼痛', '轻微', '明显', '严重'][log.painLevel];
  $('#todaySymptoms').textContent = log.symptoms?.length ? log.symptoms.slice(0, 2).join('、') : '感觉如何？';
  $('#todayMood').textContent = log.mood || '记下此刻'; $('#todaySleep').textContent = log.sleep || '未记录'; $('#todayNote').textContent = log.note || '留一句话';
}

function renderCalendar() {
  const year = calendarCursor.getFullYear(); const month = calendarCursor.getMonth();
  $('#monthTitle').textContent = `${year}年 ${month + 1}月`; $('#settingCycle').textContent = estimatedCycle();
  const grid = $('#calendarGrid'); grid.innerHTML = '';
  const first = new Date(year, month, 1); const mondayOffset = (first.getDay() + 6) % 7; const start = addDays(first, -mondayOffset);
  const prediction = predictedStart(); const meta = predictionMeta();
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i); const key = toKey(date); const log = state.logs[key];
    const button = document.createElement('button'); button.className = 'calendar-day'; button.textContent = date.getDate();
    if (date.getMonth() !== month) button.classList.add('muted'); if (key === toKey(new Date())) button.classList.add('today');
    let dayStatus = '';
    if (log?.period) { button.classList.add('period'); dayStatus = '，经期'; }
    else if (prediction && date >= prediction && date < addDays(prediction, state.profile.periodLength)) { button.classList.add('predicted'); dayStatus = '，预测经期'; }
    if (log && (log.note || log.mood || log.symptoms?.length || log.flow || log.painLevel !== null && log.painLevel !== undefined || log.sleep)) { button.classList.add('has-log'); dayStatus += '，有记录'; }
    button.setAttribute('aria-label', `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日${dayStatus}`);
    button.addEventListener('click', () => openLog(key)); grid.appendChild(button);
  }
  $('#nextPeriodDate').textContent = prediction ? formatDate(prediction) : '等待记录';
  $('#nextPeriodHint').textContent = prediction ? `预计范围 ${formatDate(addDays(prediction, -meta.range))}—${formatDate(addDays(prediction, meta.range))}` : '记录至少一次经期开始日后显示';
  $('#currentCycleHint').textContent = cycleLengths().length ? '按最近完整周期的中位数估算' : '暂按设置中的平均周期估算';
  $('#calendarConfidence').textContent = meta.label; $('#calendarConfidenceHint').textContent = meta.hint;
}

function renderInsights() {
  const lengths = cycleLengths(); const avg = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null; const meta = predictionMeta();
  $('#avgCycle').textContent = avg || '—';
  if (lengths.length > 1) { const spread = Math.max(...lengths) - Math.min(...lengths); $('#cycleRegularity').textContent = spread <= 7 ? '近期波动较小' : `近期相差约 ${spread} 天`; }
  else $('#cycleRegularity').textContent = '需要 2 次经期记录';
  const starts = periodStarts();
  const durations = periodDurations();
  $('#avgPeriod').textContent = durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length) : '—'; $('#loggedDays').textContent = Object.keys(state.logs).length;
  $('#insightConfidence').textContent = meta.label; $('#insightConfidenceHint').textContent = meta.hint;
  const chart = $('#cycleChart'); chart.innerHTML = '';
  if (!lengths.length) chart.innerHTML = '<p class="empty-state">完成两次经期记录后，会在这里看到周期长度。</p>';
  else lengths.slice(-6).forEach((length, i) => { const item = document.createElement('div'); item.className = 'bar-item'; item.innerHTML = `<b>${length}</b><i style="--h:${Math.max(12, length / 45 * 100)}%"></i><span>周期 ${Math.max(1, starts.length - lengths.slice(-6).length + i)}</span>`; chart.appendChild(item); });
  const cutoff = addDays(new Date(), -29); const counts = {};
  Object.entries(state.logs).filter(([key]) => fromKey(key) >= cutoff).forEach(([,log]) => (log.symptoms || []).forEach(symptom => counts[symptom] = (counts[symptom] || 0) + 1));
  const stats = $('#symptomStats'); stats.innerHTML = ''; const ranked = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if (!ranked.length) stats.innerHTML = '<p class="empty-state">记录症状后，这里会出现趋势。</p>';
  else ranked.forEach(([name,count]) => { const row=document.createElement('div'); row.className='symptom-stat'; row.innerHTML=`<span>${name}</span><i style="--w:${count/ranked[0][1]*100}%"></i><b>${count}</b>`; stats.appendChild(row); });

  const history = $('#cycleHistory'); history.innerHTML = '';
  if (!starts.length) history.innerHTML = '<p class="empty-state">记录经期后，这里会整理每次周期。</p>';
  else starts.slice(-6).reverse().forEach(start => {
    const index = starts.findIndex(item => toKey(item) === toKey(start)); const next = starts[index + 1];
    let duration = 0; for (let i = 0; i < 14 && state.logs[toKey(addDays(start, i))]?.period; i++) duration++;
    const row = document.createElement('div'); row.className = 'history-row';
    row.innerHTML = `<strong>${formatDate(start)}</strong><span>${duration || '—'} 天经期</span><span>${next ? `${dayDiff(next, start)} 天周期` : '当前周期'}</span>`; history.appendChild(row);
  });

  const signals = [];
  if (lengths.length > 1 && Math.max(...lengths) - Math.min(...lengths) > 7) signals.push('近期周期波动超过 7 天，可以继续观察是否持续。');
  if (durations.some(duration => duration > 7)) signals.push('记录中出现超过 7 天的经期，如反复发生可咨询医生。');
  const recentLogs = Object.entries(state.logs).filter(([key]) => fromKey(key) >= addDays(new Date(), -90)).map(([, log]) => log);
  if (recentLogs.filter(log => log.painLevel === 3).length >= 2) signals.push('近 90 天多次记录严重疼痛，若影响生活建议及时就医。');
  if (recentLogs.filter(log => log.period && log.flow === '较多').length >= 3) signals.push('近期多次记录经量较多，请结合自身情况持续留意。');
  if (!signals.length) signals.push('暂无需要特别提示的重复趋势。继续如实记录，不必追求“标准周期”。');
  const care = $('#careSignals'); care.innerHTML = ''; signals.forEach(text => { const item = document.createElement('p'); item.innerHTML = `<span>✦</span>${text}`; care.appendChild(item); });
}

function renderSettings() { $('#nicknameInput').value = state.profile.nickname || ''; $('#cycleLengthInput').value = state.profile.cycleLength; $('#periodLengthInput').value = state.profile.periodLength; $('#reminderDaysInput').value = state.profile.reminderDays; $('#reminderToggle').checked = state.profile.reminder; }
function roleLabel(role) { return ({ owner: '所有者', editor: '可编辑', viewer: '只读' })[role] || role; }

function renderAccount() {
  if (!session || !activeSpace) return;
  const name = session.user.displayName;
  $('#accountName').textContent = name; $('#accountInitial').textContent = name.slice(0, 1); $('#settingsAvatar').textContent = name.slice(0, 1);
  $('#settingsAccountName').textContent = name; $('#settingsUsername').textContent = `@${session.user.username}`; $('#settingsRole').textContent = roleLabel(activeSpace.role);
  $('#spacePermissionHint').textContent = activeSpace.canEdit ? '你可以记录和修改这个空间的数据，保存后会同步到服务器。' : '这是只读共享空间，你可以查看，但不能修改她的记录。';
  const picker = $('#spacePicker'); picker.innerHTML = '';
  session.spaces.forEach(space => { const option = document.createElement('option'); option.value = space.id; option.textContent = `${space.name} · ${roleLabel(space.role)}`; option.selected = space.id === activeSpace.id; picker.appendChild(option); });
  $('#spacePickerLabel').hidden = session.spaces.length < 2; $('#sharingCard').hidden = activeSpace.role !== 'owner';
  if (activeSpace.role === 'owner') loadMembers();
}

async function loadMembers() {
  try {
    const { members } = await api('/api/members'); const list = $('#memberList'); list.innerHTML = '<small>已共享成员</small>';
    members.forEach(member => {
      const row = document.createElement('div'); row.className = 'member-row'; const info = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = member.displayName; const detail = document.createElement('small'); detail.textContent = `@${member.username} · ${roleLabel(member.role)}`;
      info.append(name, detail); row.appendChild(info);
      if (member.role !== 'owner') {
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除';
        remove.addEventListener('click', async () => { if (!confirm(`确定移除 ${member.displayName} 的访问权限吗？`)) return; try { await api(`/api/members/${member.id}`, { method: 'DELETE' }); await loadMembers(); showToast('访问权限已移除'); } catch (error) { showToast(error.message); } }); row.appendChild(remove);
      }
      list.appendChild(row);
    });
  } catch (error) { showToast(error.message); }
}

function navigate(view) {
  currentView = view; $$('.view').forEach(section => section.classList.toggle('active', section.dataset.view === view));
  $$('.bottom-nav [data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === view)); window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'calendar') renderCalendar(); if (view === 'insights') renderInsights();
}

function openLog(key = toKey(new Date()), focus = '') {
  if (!activeSpace?.canEdit) return showToast('这是只读共享空间');
  const log = state.logs[key] || {};
  $('#logDate').value = key; $('#periodToggle').checked = !!log.period; $('#flowSection').classList.toggle('show', !!log.period); selectedFlow = log.flow || ''; selectedMood = log.mood || ''; selectedPain = log.painLevel ?? null; selectedSleep = log.sleep || '';
  $$('[data-group="flow"] button').forEach(button => { const selected = button.dataset.value === selectedFlow; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $$('[data-group="pain"] button').forEach(button => { const selected = Number(button.dataset.value) === selectedPain; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $$('#symptomChoices button').forEach(button => { const selected = (log.symptoms || []).includes(button.dataset.value); button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $$('#moodChoices button').forEach(button => { const selected = button.dataset.value === selectedMood; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $$('[data-group="sleep"] button').forEach(button => { const selected = button.dataset.value === selectedSleep; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $('#noteInput').value = log.note || ''; $('#deleteLogButton').style.visibility = state.logs[key] ? 'visible' : 'hidden'; $('#logDialog').showModal();
  if (focus) setTimeout(() => {
    const targets = { flow: '#flowSection', pain: '#painSection', symptoms: '#symptomChoices', mood: '#moodChoices', sleep: '#sleepSection', note: '#noteInput' };
    const target = $(targets[focus]); target?.scrollIntoView({behavior:'smooth',block:'center'});
    if (focus === 'flow') { $('#periodToggle').checked = true; $('#flowSection').classList.add('show'); }
  }, 100);
}

function inviteCodeFrom(value) { const text = String(value || '').trim(); try { return new URL(text).searchParams.get('invite') || text; } catch { return text; } }
async function acceptInvite(code) {
  if (!code) return showToast('请先填写邀请码');
  try { await api('/api/invites/accept', { method: 'POST', body: JSON.stringify({ code: inviteCodeFrom(code) }) }); history.replaceState({}, '', location.pathname); await loadSession(); navigate('today'); showToast('已加入共享空间'); }
  catch (error) { showToast(error.message); }
}
async function processInviteFromUrl() {
  const code = new URLSearchParams(location.search).get('invite'); if (!code) return; $('#inviteCodeInput').value = code; navigate('settings');
  if (confirm('收到一份 Lucky Lu 的共享邀请，现在加入吗？')) await acceptInvite(code);
}

$$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => { $$('[data-auth-tab]').forEach(item => item.classList.toggle('active', item === button)); $$('[data-auth-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.authPanel === button.dataset.authTab)); $('#authError').textContent = ''; }));
$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#authError').textContent = ''; const button = event.submitter; button.disabled = true; button.textContent = '正在登录…';
  try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#loginUsername').value, password: $('#loginPassword').value }) }); event.target.reset(); await loadSession(); }
  catch (error) { $('#authError').textContent = error.message; } finally { button.disabled = false; button.textContent = '进入 Lucky Lu'; }
});
$('#registerForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#authError').textContent = ''; const button = event.submitter; const hadInvite = new URLSearchParams(location.search).has('invite'); button.disabled = true; button.textContent = '正在创建…';
  try { await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ displayName: $('#registerName').value, username: $('#registerUsername').value, password: $('#registerPassword').value, signupCode: $('#registerSignupCode').value }) }); event.target.reset(); await loadSession(); if (!hadInvite) showToast('私密空间已创建'); }
  catch (error) { $('#authError').textContent = error.message; } finally { button.disabled = false; button.textContent = '创建我的私密空间'; }
});

$$('[data-nav]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.nav)));
$$('[data-open-log]').forEach(button => button.addEventListener('click', () => openLog()));
$$('[data-quick]').forEach(button => button.addEventListener('click', () => openLog(toKey(new Date()), button.dataset.quick)));
$('#settingsButton').addEventListener('click', () => navigate('settings')); $('#accountButton').addEventListener('click', () => navigate('settings'));
$('#prevMonth').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); renderCalendar(); });
$('#nextMonth').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); renderCalendar(); });
$('#periodToggle').addEventListener('change', event => $('#flowSection').classList.toggle('show', event.target.checked));
$$('[data-group="flow"] button').forEach(button => button.addEventListener('click', () => { selectedFlow = button.dataset.value; $$('[data-group="flow"] button').forEach(item => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', selected); }); }));
$$('[data-group="pain"] button').forEach(button => button.addEventListener('click', () => { selectedPain = Number(button.dataset.value); $$('[data-group="pain"] button').forEach(item => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', selected); }); }));
$$('#symptomChoices button').forEach(button => button.addEventListener('click', () => { button.classList.toggle('selected'); button.setAttribute('aria-pressed', button.classList.contains('selected')); }));
$$('#moodChoices button').forEach(button => button.addEventListener('click', () => { selectedMood = button.dataset.value; $$('#moodChoices button').forEach(item => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', selected); }); }));
$$('[data-group="sleep"] button').forEach(button => button.addEventListener('click', () => { selectedSleep = button.dataset.value; $$('[data-group="sleep"] button').forEach(item => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', selected); }); }));
$('#logDate').addEventListener('change', event => { const key = event.target.value; $('#logDialog').close(); openLog(key); });
$('#logForm').addEventListener('submit', async event => {
  event.preventDefault(); const key = $('#logDate').value; const period = $('#periodToggle').checked;
  state.logs[key] = { period, flow: period ? selectedFlow : '', painLevel: selectedPain, symptoms: $$('#symptomChoices button.selected').map(button => button.dataset.value), mood: selectedMood, sleep: selectedSleep, note: $('#noteInput').value.trim() };
  const log = state.logs[key]; if (!period && !log.symptoms.length && !selectedMood && selectedPain === null && !selectedSleep && !log.note) delete state.logs[key]; $('#logDialog').close(); await saveState('这一天，记下啦');
});
$('#deleteLogButton').addEventListener('click', async () => { const key=$('#logDate').value; if (state.logs[key] && confirm(`确定删除 ${key} 的记录吗？`)) { delete state.logs[key]; $('#logDialog').close(); await saveState('已删除当天记录'); } });
$('#profileForm').addEventListener('submit', async event => { event.preventDefault(); state.profile = { nickname: $('#nicknameInput').value.trim(), cycleLength: Math.min(60, Math.max(15, Number($('#cycleLengthInput').value) || 28)), periodLength: Math.min(14, Math.max(1, Number($('#periodLengthInput').value) || 5)), reminder: $('#reminderToggle').checked, reminderDays: Math.min(7, Math.max(1, Number($('#reminderDaysInput').value) || 3)) }; await saveState('设置已保存'); });
$('#exportButton').addEventListener('click', () => { const blob = new Blob([JSON.stringify({...state, exportedAt:new Date().toISOString()}, null, 2)], {type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`Lucky-Lu-备份-${toKey(new Date())}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('备份已导出'); });
$('#importInput').addEventListener('change', async event => { const file=event.target.files[0]; if(!file)return; try { const imported=JSON.parse(await file.text()); if(!imported.profile || !imported.logs) throw new Error(); if(confirm('导入会覆盖当前空间的数据，继续吗？')) { state={profile:{...defaultState.profile,...imported.profile},logs:imported.logs}; await saveState('备份已恢复'); } } catch { showToast('这个备份文件无法读取'); } event.target.value=''; });
$('#clearButton').addEventListener('click', async () => { if(activeSpace?.canEdit && confirm('确定清空当前空间的全部记录吗？此操作无法撤销。')) { state={profile:{...state.profile},logs:{}}; await saveState('当前空间记录已清空'); } });
$('#migrateButton').addEventListener('click', async () => {
  try { const old = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)); if (!old?.profile || !old?.logs) throw new Error(); if (!confirm('将旧版本机记录合并到当前云端空间吗？同一天的本机记录会覆盖云端记录。')) return; state = { profile: { ...state.profile, ...old.profile }, logs: { ...state.logs, ...old.logs } }; await saveState('旧版记录已迁移'); localStorage.removeItem(LEGACY_STORAGE_KEY); $('#migrateButton').hidden = true; }
  catch { showToast('没有找到可迁移的旧版记录'); }
});
$('#logoutButton').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { session=null; activeSpace=null; state=structuredClone(defaultState); showAuth(); } });
$('#spacePicker').addEventListener('change', async event => { try { await api(`/api/spaces/${event.target.value}/activate`, { method: 'POST', body: '{}' }); await loadSession(); showToast('已切换数据空间'); } catch(error) { showToast(error.message); } });
$('#createInviteButton').addEventListener('click', async () => {
  try { const result = await api('/api/invites', { method: 'POST', body: JSON.stringify({ role: $('#inviteRole').value }) }); const url = new URL(location.origin + location.pathname); url.searchParams.set('invite', result.code); $('#inviteLink').value = url.toString(); $('#inviteResult').hidden = false; showToast('一次性邀请已生成'); }
  catch(error) { showToast(error.message); }
});
$('#copyInviteButton').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#inviteLink').value); showToast('邀请链接已复制'); } catch { $('#inviteLink').select(); document.execCommand('copy'); showToast('邀请链接已复制'); } });
$('#acceptInviteButton').addEventListener('click', () => acceptInvite($('#inviteCodeInput').value));

(async function boot() { document.body.classList.add('auth-pending'); try { await loadSession(); } catch (error) { showAuth(error.status === 401 ? '' : error.message); } })();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

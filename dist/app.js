const STORAGE_KEY = 'mianmian-cycle-v1';
const defaultState = { profile: { nickname: '', cycleLength: 28, periodLength: 5, reminder: true }, logs: {} };
let state = loadState();
let currentView = 'today';
let calendarCursor = new Date();
let selectedFlow = '';
let selectedMood = '';
let toastTimer;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const pad = value => String(value).padStart(2, '0');
const toKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const fromKey = key => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (date, amount) => { const next = new Date(date); next.setDate(next.getDate() + amount); return next; };
const dayDiff = (a, b) => Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
const formatDate = date => `${date.getMonth() + 1}月${date.getDate()}日`;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && saved.profile && saved.logs ? saved : structuredClone(defaultState);
  } catch { return structuredClone(defaultState); }
}

function saveState(message = '已保存') {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderAll();
  showToast(message);
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function periodStarts() {
  const periodKeys = Object.keys(state.logs).filter(key => state.logs[key].period).sort();
  return periodKeys.filter((key, index) => index === 0 || dayDiff(fromKey(key), fromKey(periodKeys[index - 1])) > 1).map(fromKey);
}

function cycleLengths() {
  const starts = periodStarts();
  return starts.slice(1).map((date, i) => dayDiff(date, starts[i])).filter(length => length >= 15 && length <= 60);
}

function estimatedCycle() {
  const lengths = cycleLengths();
  if (!lengths.length) return state.profile.cycleLength;
  return Math.round(lengths.reduce((sum, length) => sum + length, 0) / lengths.length);
}

function latestStart() { return periodStarts().at(-1) || null; }
function predictedStart() { const latest = latestStart(); return latest ? addDays(latest, estimatedCycle()) : null; }

function renderAll() {
  renderToday();
  renderCalendar();
  renderInsights();
  renderSettings();
}

function renderToday() {
  const now = new Date();
  const hour = now.getHours();
  const nickname = state.profile.nickname.trim();
  $('#greeting').textContent = `${hour < 11 ? '早上好' : hour < 18 ? '下午好' : '晚上好'}${nickname ? `，${nickname}` : ''}`;
  $('#todayDate').textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · ${['周日','周一','周二','周三','周四','周五','周六'][now.getDay()]}`;
  const latest = latestStart();
  const prediction = predictedStart();
  if (latest) {
    const day = Math.max(1, dayDiff(now, latest) + 1);
    const length = estimatedCycle();
    const phase = day <= state.profile.periodLength ? '经期中' : day < length - 5 ? '周期进行中' : '经期将近';
    $('#cycleLabel').textContent = phase;
    $('#cycleDay').textContent = day;
    $('#cycleCaption').textContent = `周期第 ${day} 天 · 预计 ${length} 天`;
    $('#ringProgress').style.strokeDashoffset = 578 * (1 - Math.min(day, length) / length);
    const until = prediction ? dayDiff(prediction, now) : null;
    $('#heroTitle').innerHTML = until !== null && until >= 0 ? `离下次经期<br><em>大约 ${until} 天</em>` : `听听身体<br><em>今天想说什么</em>`;
    $('#heroSubtitle').textContent = day <= state.profile.periodLength ? '经期里，休息不是偷懒。记下感受，给身体多一点耐心。' : '预测只是参考。睡眠、压力和旅行，都可能让身体改变节奏。';
    $('#dailyInsight').textContent = until !== null && until <= 3 && until >= 0 && state.profile.reminder ? '经期可能快到了，可以提前准备用品，也给日程留一点余地。' : '规律不是标准答案，记录是为了更了解自己，而不是给身体打分。';
  } else {
    $('#cycleLabel').textContent = '等待记录'; $('#cycleDay').textContent = '—'; $('#cycleCaption').textContent = '你的节奏，由你定义'; $('#ringProgress').style.strokeDashoffset = 578;
  }
  const log = state.logs[toKey(now)] || {};
  $('#todayFlow').textContent = log.period ? (log.flow || '经期中') : '未记录';
  $('#todaySymptoms').textContent = log.symptoms?.length ? log.symptoms.slice(0, 2).join('、') : '感觉如何？';
  $('#todayMood').textContent = log.mood || '记下此刻';
  $('#todayNote').textContent = log.note || '留一句话';
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  $('#monthTitle').textContent = `${year}年 ${month + 1}月`;
  $('#settingCycle').textContent = state.profile.cycleLength;
  const grid = $('#calendarGrid'); grid.innerHTML = '';
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  const prediction = predictedStart();
  const fertileStart = prediction ? addDays(prediction, -19) : null;
  const fertileEnd = prediction ? addDays(prediction, -13) : null;
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i); const key = toKey(date); const log = state.logs[key];
    const button = document.createElement('button'); button.className = 'calendar-day'; button.textContent = date.getDate();
    if (date.getMonth() !== month) button.classList.add('muted');
    if (key === toKey(new Date())) button.classList.add('today');
    let dayStatus = '';
    if (log?.period) { button.classList.add('period'); dayStatus = '，经期'; }
    else if (prediction && date >= prediction && date < addDays(prediction, state.profile.periodLength)) { button.classList.add('predicted'); dayStatus = '，预测经期'; }
    else if (fertileStart && date >= fertileStart && date <= fertileEnd) { button.classList.add('fertile'); dayStatus = '，易孕期估算'; }
    if (log && (log.note || log.mood || log.symptoms?.length || log.flow)) { button.classList.add('has-log'); dayStatus += '，有记录'; }
    button.setAttribute('aria-label', `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日${dayStatus}`);
    button.addEventListener('click', () => openLog(key)); grid.appendChild(button);
  }
  $('#nextPeriodDate').textContent = prediction ? formatDate(prediction) : '等待记录';
  $('#nextPeriodHint').textContent = prediction ? `按近似 ${estimatedCycle()} 天周期估算，可能前后浮动` : '记录至少一次经期开始日后显示';
}

function renderInsights() {
  const lengths = cycleLengths();
  const avg = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : null;
  $('#avgCycle').textContent = avg || '—';
  if (lengths.length > 1) { const spread = Math.max(...lengths) - Math.min(...lengths); $('#cycleRegularity').textContent = spread <= 7 ? '近期波动较小' : `近期相差约 ${spread} 天`; }
  else $('#cycleRegularity').textContent = '需要 2 次经期记录';
  const starts = periodStarts();
  const periodDurations = starts.map(start => { let count = 0; for (let i = 0; i < 14 && state.logs[toKey(addDays(start, i))]?.period; i++) count++; return count; }).filter(Boolean);
  $('#avgPeriod').textContent = periodDurations.length ? Math.round(periodDurations.reduce((a,b)=>a+b,0)/periodDurations.length) : '—';
  $('#loggedDays').textContent = Object.keys(state.logs).length;
  const chart = $('#cycleChart'); chart.innerHTML = '';
  if (!lengths.length) chart.innerHTML = '<p class="empty-state">完成两次经期记录后，会在这里看到周期长度。</p>';
  else lengths.slice(-6).forEach((length, i) => { const item = document.createElement('div'); item.className = 'bar-item'; item.innerHTML = `<b>${length}</b><i style="--h:${Math.max(12, length / 45 * 100)}%"></i><span>周期 ${Math.max(1, starts.length - lengths.slice(-6).length + i)}</span>`; chart.appendChild(item); });
  const cutoff = addDays(new Date(), -29); const counts = {};
  Object.entries(state.logs).filter(([key]) => fromKey(key) >= cutoff).forEach(([,log]) => (log.symptoms || []).forEach(symptom => counts[symptom] = (counts[symptom] || 0) + 1));
  const stats = $('#symptomStats'); stats.innerHTML = ''; const ranked = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if (!ranked.length) stats.innerHTML = '<p class="empty-state">记录症状后，这里会出现趋势。</p>';
  else ranked.forEach(([name,count]) => { const row=document.createElement('div'); row.className='symptom-stat'; row.innerHTML=`<span>${name}</span><i style="--w:${count/ranked[0][1]*100}%"></i><b>${count}</b>`; stats.appendChild(row); });
}

function renderSettings() {
  $('#nicknameInput').value = state.profile.nickname || '';
  $('#cycleLengthInput').value = state.profile.cycleLength;
  $('#periodLengthInput').value = state.profile.periodLength;
  $('#reminderToggle').checked = state.profile.reminder;
}

function navigate(view) {
  currentView = view;
  $$('.view').forEach(section => section.classList.toggle('active', section.dataset.view === view));
  $$('.bottom-nav [data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'calendar') renderCalendar(); if (view === 'insights') renderInsights();
}

function openLog(key = toKey(new Date()), focus = '') {
  const log = state.logs[key] || {};
  $('#logDate').value = key; $('#periodToggle').checked = !!log.period; $('#flowSection').classList.toggle('show', !!log.period);
  selectedFlow = log.flow || ''; selectedMood = log.mood || '';
  $$('[data-group="flow"] button').forEach(button => { const selected = button.dataset.value === selectedFlow; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $$('#symptomChoices button').forEach(button => { const selected = (log.symptoms || []).includes(button.dataset.value); button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $$('#moodChoices button').forEach(button => { const selected = button.dataset.value === selectedMood; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', selected); });
  $('#noteInput').value = log.note || '';
  $('#deleteLogButton').style.visibility = state.logs[key] ? 'visible' : 'hidden';
  $('#logDialog').showModal();
  if (focus) setTimeout(() => { const target = focus === 'note' ? $('#noteInput') : $(`#${focus === 'flow' ? 'flowSection' : focus === 'symptoms' ? 'symptomChoices' : 'moodChoices'}`); target?.scrollIntoView({behavior:'smooth',block:'center'}); if (focus === 'flow') { $('#periodToggle').checked = true; $('#flowSection').classList.add('show'); } }, 100);
}

$$('[data-nav]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.nav)));
$$('[data-open-log]').forEach(button => button.addEventListener('click', () => openLog()));
$$('[data-quick]').forEach(button => button.addEventListener('click', () => openLog(toKey(new Date()), button.dataset.quick)));
$('#settingsButton').addEventListener('click', () => navigate('settings'));
$('#prevMonth').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1); renderCalendar(); });
$('#nextMonth').addEventListener('click', () => { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1); renderCalendar(); });
$('#periodToggle').addEventListener('change', event => $('#flowSection').classList.toggle('show', event.target.checked));
$$('[data-group="flow"] button').forEach(button => button.addEventListener('click', () => { selectedFlow = button.dataset.value; $$('[data-group="flow"] button').forEach(item => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', selected); }); }));
$$('#symptomChoices button').forEach(button => button.addEventListener('click', () => { button.classList.toggle('selected'); button.setAttribute('aria-pressed', button.classList.contains('selected')); }));
$$('#moodChoices button').forEach(button => button.addEventListener('click', () => { selectedMood = button.dataset.value; $$('#moodChoices button').forEach(item => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', selected); }); }));
$('#logDate').addEventListener('change', event => { const key = event.target.value; $('#logDialog').close(); openLog(key); });
$('#logForm').addEventListener('submit', event => {
  event.preventDefault();
  const key = $('#logDate').value; const period = $('#periodToggle').checked;
  state.logs[key] = { period, flow: period ? selectedFlow : '', symptoms: $$('#symptomChoices button.selected').map(button => button.dataset.value), mood: selectedMood, note: $('#noteInput').value.trim() };
  if (!period && !state.logs[key].symptoms.length && !selectedMood && !state.logs[key].note) delete state.logs[key];
  $('#logDialog').close(); saveState('这一天，记下啦');
});
$('#deleteLogButton').addEventListener('click', () => { const key=$('#logDate').value; if (state.logs[key] && confirm(`确定删除 ${key} 的记录吗？`)) { delete state.logs[key]; $('#logDialog').close(); saveState('已删除当天记录'); } });
$('#profileForm').addEventListener('submit', event => { event.preventDefault(); state.profile = { nickname: $('#nicknameInput').value.trim(), cycleLength: Math.min(60, Math.max(15, Number($('#cycleLengthInput').value) || 28)), periodLength: Math.min(14, Math.max(1, Number($('#periodLengthInput').value) || 5)), reminder: $('#reminderToggle').checked }; saveState('设置已保存'); });
$('#exportButton').addEventListener('click', () => { const blob = new Blob([JSON.stringify({...state, exportedAt:new Date().toISOString()}, null, 2)], {type:'application/json'}); const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`绵绵备份-${toKey(new Date())}.json`; link.click(); URL.revokeObjectURL(link.href); showToast('备份已导出'); });
$('#importInput').addEventListener('change', async event => { const file=event.target.files[0]; if(!file)return; try { const imported=JSON.parse(await file.text()); if(!imported.profile || !imported.logs) throw new Error(); if(confirm('导入会覆盖这台设备上现有的数据，继续吗？')) { state={profile:{...defaultState.profile,...imported.profile},logs:imported.logs}; saveState('备份已恢复'); } } catch { showToast('这个备份文件无法读取'); } event.target.value=''; });
$('#clearButton').addEventListener('click', () => { if(confirm('确定清除本机的全部记录吗？此操作无法撤销。')) { state=structuredClone(defaultState); localStorage.removeItem(STORAGE_KEY); renderAll(); showToast('本机数据已清除'); } });

renderAll();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));

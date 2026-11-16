// ---------- helpers ----------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
const rail = $('#rail');
const detail = $('#detail');
// The right sidebar only exists on the overview page.
function showRail(html) {
  rail.hidden = html == null;
  rail.innerHTML = html ?? '';
  document.body.classList.toggle('has-rail', html != null);
}
const DAY = 864e5;
const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#8b5cf6', '#84cc16'];
const PRIO = { 1: 'Top', 2: 'High', 3: 'Normal', 4: 'Someday' };
const TYPE = { project: 'Project', task: 'Task' };
const typeTag = p => p.type === 'task' ? '<span class="ttag">Task</span>' : '';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { alert(`Error: ${r.status}`); throw new Error(r.status); }
  return r.status === 204 ? null : r.json();
}

const pad = n => String(n).padStart(2, '0');
const toLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const nowLocal = () => toLocal(new Date());
const dayKey = d => toLocal(d).slice(0, 10);
const parseDay = k => new Date(k + 'T00:00');
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / DAY);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDay = (k, opts) => parseDay(k).toLocaleDateString(undefined, opts);

// Jalali (Persian calendar) companions for Gregorian day keys, e.g. "23 Aban 1405".
const JAL = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const jParts = k => Object.fromEntries(JAL.formatToParts(parseDay(k)).map(p => [p.type, p.value]));
const jDay = (k, { year = false, short = false } = {}) => {
  const p = jParts(k);
  return [p.day, short ? p.month.slice(0, 3) : p.month, year && p.year].filter(Boolean).join(' ');
};
// The Jalali month(s) a Gregorian month overlaps, e.g. "Aban–Azar 1405".
const jMonthSpan = k => {
  const d = parseDay(k), a = jParts(dayKey(new Date(d.getFullYear(), d.getMonth(), 1))),
    b = jParts(dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)));
  return a.year === b.year ? `${a.month}–${b.month} ${b.year}` : `${a.month} ${a.year} – ${b.month} ${b.year}`;
};

function ago(at) {
  if (!at) return 'no activity';
  const n = daysBetween(at.slice(0, 10), dayKey(new Date()));
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  if (n < 30) return `${n}d ago`;
  return `${fmtDay(at.slice(0, 10), { month: 'short', day: 'numeric' })} · ${jDay(at.slice(0, 10))}`;
}

// ---------- state & routing -------------------------------------------------
const state = { projects: [], entries: [], current: null, range: 90, focus: null, logDays: 10, todoSort: 'newest' };

// URL shape: "#/" or "#/done" picks the main page; an optional "/p/<id>" suffix
// opens that project in the left detail panel next to it.
async function route(full = true) {
  const m = location.hash.match(/^#\/(done)?\/?(?:p\/(\d+))?/);
  const page = m?.[1] ? 'done' : 'overview';
  const cur = m?.[2] ? +m[2] : null;
  state.projects = await api('GET', '/api/projects');
  if (full || state.dirty || page !== state.page) {
    state.page = page; state.dirty = false;
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === page));
    if (page === 'done') showDone(); else await showOverview();
  }
  const opened = cur !== state.current;
  state.current = cur;
  await showProject(opened);
  document.querySelectorAll('[data-pid]').forEach(el => el.classList.toggle('sel', +el.dataset.pid === cur));
  if (state.focus) { $(state.focus)?.focus(); state.focus = null; }
}
window.addEventListener('hashchange', () => route(false));

const baseHash = () => state.page === 'done' ? '#/done' : '#/';
// Empty the detail panel, letting its content fade out first.
function closeDetail() {
  const v = $('.dview', detail);
  if (!v) return;
  v.classList.add('leaving');
  setTimeout(() => { location.hash = baseHash(); }, 140);
}
// Esc: cancel an open edit, else leave the focused field, else close the panel.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !state.current || e.defaultPrevented || $('#dlg').open) return;
  if ($('.editing', detail) || $('#pedit')?.innerHTML.trim()) return route(false);
  const field = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (field) return field.blur();
  closeDetail();
});

// ---------- done page -------------------------------------------------------
// Finished projects and tasks live here instead of cluttering the overview.
function showDone() {
  showRail(null);
  const done = state.projects.filter(p => p.status === 'done');
  main.innerHTML = `
    <header class="head"><div>
      <h1>Done</h1>
      <p class="muted">${plural(done.filter(p => p.type !== 'task').length, 'project')} · ${plural(done.filter(p => p.type === 'task').length, 'task')}</p>
    </div></header>
    ${done.length ? `<div class="tasklist">${done.map(p => `
      <a class="taskrow" href="#/done/p/${p.id}" data-pid="${p.id}" style="--c:${p.color}">
        <span class="prio p${p.priority}">P${p.priority}</span>
        <span class="tdot"></span>
        <span class="tmain"><b dir="auto">${esc(p.name)}</b>${typeTag(p)}</span>
        <span class="tside small muted">${p.actions} action${p.actions === 1 ? '' : 's'} · last ${ago(p.last_at)}</span>
      </a>`).join('')}</div>` : '<p class="muted">Nothing finished yet.</p>'}`;
}

// ---------- overview --------------------------------------------------------
async function showOverview() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - state.range + 1);
  const [acts, todos] = await Promise.all([
    api('GET', `/api/timeline?from=${dayKey(start)}`),
    api('GET', '/api/todos'),
  ]);
  const active = state.projects.filter(p => p.status !== 'done');
  // One row per priority tier (P1 → P4). Within a row: open projects first, then
  // blocked, then paused; ties keep the API order (most recent activity first).
  // Projects get the big priority-tier cards; tasks get a compact list below.
  const STATUS_ORDER = { open: 0, blocked: 1, paused: 2 };
  const byPrio = (a, b) => a.priority - b.priority || STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  const projects = active.filter(p => p.type !== 'task');
  const tasks = active.filter(p => p.type === 'task').sort(byPrio); // stable: keeps API activity order
  const tiers = [1, 2, 3, 4].map(n => ({
    n,
    list: projects.filter(p => p.priority === n).sort(byPrio),
  })).filter(t => t.list.length);
  const card = p => `
        <a class="topcard st-${p.status}" href="#/p/${p.id}" data-pid="${p.id}" style="--c:${p.color}">
          <div class="row between"><b>${esc(p.name)}</b>${p.status === 'blocked' ? '<span class="blk small">blocked</span>' : p.status === 'paused' ? '<span class="muted small">paused</span>' : ''}</div>
          ${p.description ? `<div class="pdesc muted small" title="${esc(p.description)}">${esc(p.description)}</div>` : ''}
          ${p.blockers ? `<div class="next blk">⛔ ${esc(p.first_blocker)}${p.blockers > 1 ? ` <span class="muted small">+${p.blockers - 1} more</span>` : ''}</div>` : ''}
          <div class="next">${p.next_todo ? `→ ${esc(p.next_todo)}` : '<span class="muted">No todos planned</span>'}</div>
          <div class="muted small">${p.todos} todo · ${p.actions} done · last ${ago(p.last_at)}</div>
        </a>`;
  const taskRow = p => `
        <a class="taskrow st-${p.status}" href="#/p/${p.id}" data-pid="${p.id}" style="--c:${p.color}">
          <span class="prio p${p.priority}">P${p.priority}</span>
          <span class="tdot"></span>
          <span class="tmain">
            <b dir="auto">${esc(p.name)}</b>
            ${p.blockers ? `<span class="blk small">⛔ ${esc(p.first_blocker)}${p.blockers > 1 ? ` +${p.blockers - 1}` : ''}</span>`
              : p.next_todo ? `<span class="muted small" dir="auto">→ ${esc(p.next_todo)}</span>` : ''}
          </span>
          <span class="tside small">
            ${p.status !== 'open' ? `<span class="${p.status === 'blocked' ? 'blk' : 'muted'}">${p.status}</span>` : ''}
            <span class="muted">${p.todos ? `${p.todos} todo · ` : ''}${ago(p.last_at)}</span>
          </span>
        </a>`;

  const todayCount = acts.filter(a => a.at.startsWith(dayKey(new Date()))).length;
  const weekCount = acts.filter(a => new Date(a.at) > new Date(Date.now() - 7 * DAY)).length;

  showRail(todoRail(todos));
  main.innerHTML = `
    <header class="head">
      <div>
        <h1>Overview</h1>
        <p class="muted">${plural(active.filter(p => p.type !== 'task').length, 'active project')} · ${plural(active.filter(p => p.type === 'task').length, 'active task')} · ${todayCount} actions today · ${weekCount} this week</p>
      </div>
    </header>

    <section>
      <h2>Projects</h2>
      ${tiers.length ? tiers.map(t => `
        <div class="tier">
          <div class="tier-head"><span class="prio p${t.n}">P${t.n}</span><span class="muted small">${t.list.length} item${t.list.length > 1 ? 's' : ''}</span></div>
          <div class="cards-grid">${t.list.map(card).join('')}</div>
        </div>`).join('') : '<p class="muted">No active projects.</p>'}
    </section>

    <section>
      <h2>Tasks <span class="muted small">${tasks.length || ''}</span></h2>
      ${tasks.length ? `<div class="tasklist">${tasks.map(taskRow).join('')}</div>` : '<p class="muted">No active tasks.</p>'}
    </section>

    <section>
      <div class="row between">
        <h2>Daily log</h2>
        <div class="seg">${[30, 90, 365].map(r => `<button data-act="range" data-v="${r}" class="${r === state.range ? 'on' : ''}">${r === 365 ? '1y' : r + 'd'}</button>`).join('')}</div>
      </div>
      ${dailyLog(acts)}
    </section>`;
}

// Right rail on the overview: every open todo across active projects, plus every
// active task. A task is itself a todo; its own todos are nested under it.
function todoRail(todos) {
  const sort = state.todoSort;
  const tasks = state.projects.filter(p => p.type === 'task' && p.status !== 'done');
  const taskIds = new Set(tasks.map(t => t.id));
  const byCreated = (a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id;

  // Each item is either a project todo or a task group; both sort as one unit.
  const items = [
    ...todos.filter(t => !taskIds.has(t.project_id))
      .map(t => ({ name: t.project, created_at: t.created_at, id: t.id, html: () => todoRow(t, true) })),
    ...tasks.map(k => ({ name: k.name, created_at: k.created_at, id: k.id, html: () => taskGroup(k, todos.filter(t => t.project_id === k.id).sort(byCreated)) })),
  ];
  if (sort === 'project') items.sort((a, b) => a.name.localeCompare(b.name) || byCreated(a, b));
  else items.sort(sort === 'oldest' ? byCreated : (a, b) => byCreated(b, a));

  return `
    <div class="row between"><h2>Open todos <span class="muted small">${items.length || ''}</span></h2></div>
    <div class="seg">${[['newest', 'Newest'], ['oldest', 'Oldest'], ['project', 'Project']].map(([k, l]) =>
      `<button data-act="todo-sort" data-v="${k}" class="${k === sort ? 'on' : ''}">${l}</button>`).join('')}</div>
    <ul class="rail-list">
      ${items.map(i => i.html()).join('') || '<li class="muted">Nothing planned.</li>'}
    </ul>`;
}

function todoRow(t, withTag) {
  return `<li style="--c:${t.color}" class="${withTag ? '' : 'sub'}">
    <button class="check" data-act="complete" data-id="${t.id}" title="Mark done → becomes an action now"></button>
    <div class="grow">
      <span dir="auto" class="block">${esc(t.title)}</span>
      ${withTag ? `<div class="row rail-meta">
        <a class="tag" href="#/p/${t.project_id}">${esc(t.project)}</a>
        <span class="muted small" title="Created ${t.created_at.replace('T', ' ')} · ${jDay(t.created_at.slice(0, 10), { year: true })}">${ago(t.created_at)}</span>
      </div>` : ''}
    </div>
  </li>`;
}

function taskGroup(k, subs) {
  return `<li style="--c:${k.color}" class="task st-${k.status}">
    <button class="check diamond" data-act="complete-task" data-id="${k.id}" data-subs="${subs.length}" title="Mark task done"></button>
    <div class="grow">
      <a href="#/p/${k.id}" dir="auto" class="block tname">${esc(k.name)}</a>
      <div class="row rail-meta">
        <span class="ttag">Task</span>
        <span class="prio p${k.priority}">P${k.priority}</span>
        ${k.status === 'blocked' ? `<span class="blk small" title="${esc(k.first_blocker)}">⛔ blocked</span>` : k.status === 'paused' ? '<span class="muted small">paused</span>' : ''}
        <span class="muted small" title="Created ${k.created_at.replace('T', ' ')} · ${jDay(k.created_at.slice(0, 10), { year: true })}">${ago(k.created_at)}</span>
      </div>
    </div>
  </li>${subs.map(t => todoRow(t, false)).join('')}`;
}

// One card per day. Inside: a 24h strip showing when you worked, then the day's
// actions in chronological order, each tagged with its project.
function dailyLog(acts) {
  const byDay = new Map();
  acts.forEach(a => {            // acts come sorted oldest → newest
    const k = a.at.slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(a);
  });
  if (!byDay.size) return '<p class="muted">No actions in this range.</p>';

  const today = dayKey(new Date());
  const days = [...byDay.keys()].reverse();
  const proj = a => state.projects.find(x => x.id === a.project_id) || { name: a.project, color: a.color };
  const mins = a => +a.at.slice(11, 13) * 60 + +a.at.slice(14, 16);

  let html = '<div class="log">', prev = today;
  for (const k of days.slice(0, state.logDays)) {
    const gap = daysBetween(k, prev) - 1;
    if (gap > 0) html += `<div class="log-gap">${gap} quiet day${gap > 1 ? 's' : ''}</div>`;
    prev = k;
    const list = byDay.get(k);
    const projIds = [...new Set(list.map(a => a.project_id))];
    const rel = k === today ? 'Today' : daysBetween(k, today) === 1 ? 'Yesterday' : fmtDay(k, { weekday: 'long' });

    html += `<div class="log-day">
      <div class="log-date">
        <b>${parseDay(k).getDate()}</b>
        <span>${fmtDay(k, { month: 'short' })}</span>
        <span class="jal">${jDay(k)}</span>
        <small>${rel}</small>
        <small class="muted">${list.length} action${list.length > 1 ? 's' : ''} · ${projIds.length} project${projIds.length > 1 ? 's' : ''}</small>
      </div>
      <div class="log-body">
        <div class="clock">
          ${[0, 6, 12, 18, 24].map(h => `<span class="hr" style="left:${h / 24 * 100}%">${pad(h % 24)}:00</span>`).join('')}
          ${list.map(a => `<a class="mark" href="#/p/${a.project_id}" style="--c:${proj(a).color};left:${mins(a) / 1440 * 100}%" title="${a.at.slice(11, 16)} · ${esc(proj(a).name)}\n${esc(a.title)}"></a>`).join('')}
        </div>
        <ol class="flow">
          ${list.map((a, i) => {
            const p = proj(a), switched = i > 0 && list[i - 1].project_id !== a.project_id;
            return `<li style="--c:${p.color}" class="${switched ? 'switch' : ''}">
              <time>${a.at.slice(11, 16)}</time>
              <span class="node"></span>
              <div class="what">
                <a class="tag" href="#/p/${a.project_id}">${esc(p.name)}</a>
                <span>${esc(a.title)}</span>
                ${a.note ? `<small class="muted block">${esc(a.note)}</small>` : ''}
              </div>
            </li>`;
          }).join('')}
        </ol>
      </div>
    </div>`;
  }
  html += '</div>';
  if (days.length > state.logDays) {
    html += `<button class="btn wide" data-act="more-days">Show more days (${days.length - state.logDays} left in range)</button>`;
  }
  return html;
}

// ---------- project view ----------------------------------------------------
// Left panel: empty placeholder, or the selected project's full detail.
async function showProject(opened) {
  if (!state.current) {
    detail.innerHTML = `<div class="dempty">
      <div class="dempty-ring"></div>
      <b>No project selected</b>
      <p class="muted small">Pick a project or task to see its details here.</p>
    </div>`;
    return;
  }
  const p = state.projects.find(x => x.id === state.current);
  if (!p) { location.hash = baseHash(); return; }
  state.entries = await api('GET', `/api/projects/${p.id}/entries`);
  const todos = state.entries.filter(e => e.kind === 'todo').sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const actions = state.entries.filter(e => e.kind === 'action');
  const blockers = state.entries.filter(e => e.kind === 'blocker').sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);

  detail.innerHTML = `<div class="dview${opened ? ' entering' : ''}">
    <header class="dhead" style="--c:${p.color}">
      <div class="row between">
        <h1 dir="auto"><span class="bigdot"></span>${esc(p.name)}</h1>
        <button class="icon dclose" data-act="close" title="Close (Esc)">✕</button>
      </div>
      ${p.description ? `<p class="desc" dir="auto">${esc(p.description)}</p>` : ''}
      <div class="controls">
        <select data-pfield="status">${['open', 'blocked', 'paused', 'done'].map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select data-pfield="priority">${[1, 2, 3, 4].map(n => `<option value="${n}" ${n === p.priority ? 'selected' : ''}>P${n} · ${PRIO[n]}</option>`).join('')}</select>
        <button class="btn sm" data-act="edit-project">Edit</button>
      </div>
    </header>
    <div id="pedit"></div>

    <div class="cols" style="--c:${p.color}">
      <div class="left">
        <section class="panel">
          <h2>Log an action</h2>
          <form data-form="action" class="stack">
            <input name="title" id="action-input" placeholder="What did you do?" required>
            <textarea name="note" rows="2" placeholder="Details (optional)"></textarea>
            <div class="row">
              <input type="datetime-local" name="at" value="${nowLocal()}" required title="When — change it to log past work">
              <button class="btn primary">Log</button>
            </div>
          </form>
        </section>

        <section class="panel ${blockers.length ? 'blocked' : ''}">
          <h2>Blockers <span class="muted small">${blockers.length || ''}</span></h2>
          <form data-form="blocker" class="row">
            <input name="title" id="blocker-input" placeholder="What's in the way?" required>
            <button class="btn">Add</button>
          </form>
          <ul class="todos">
            ${blockers.map(b => `
              <li data-entry="${b.id}">
                <button class="check resolve" data-act="resolve" data-id="${b.id}" title="Resolve → logged as an action now"></button>
                <span class="grow">${esc(b.title)}<small class="muted block">since ${ago(b.at)}${b.note ? ` · ${esc(b.note)}` : ''}</small></span>
                <button class="icon" data-act="edit-entry" data-id="${b.id}" title="Edit">✎</button>
                <button class="icon" data-act="del-entry" data-id="${b.id}" title="Delete">✕</button>
              </li>`).join('')}
          </ul>
        </section>

        <section class="panel">
          <h2>Todo <span class="muted small">${todos.length || ''}</span></h2>
          <form data-form="todo" class="row">
            <input name="title" id="todo-input" placeholder="Plan something…" required>
            <button class="btn">Add</button>
          </form>
          <ul class="todos">
            ${todos.map(t => `
              <li data-entry="${t.id}">
                <button class="check" data-act="complete" data-id="${t.id}" title="Mark done → becomes an action now"></button>
                <span class="grow">${esc(t.title)}${t.note ? `<small class="muted block">${esc(t.note)}</small>` : ''}</span>
                <button class="icon" data-act="edit-entry" data-id="${t.id}" title="Edit">✎</button>
                <button class="icon" data-act="del-entry" data-id="${t.id}" title="Delete">✕</button>
              </li>`).join('')}
          </ul>
        </section>
      </div>

      <div class="right">
        ${river(actions, todos.length)}
      </div>
    </div>
  </div>`;
  if (opened) {
    detail.scrollTop = 0;
    // Stacked (phone) layout: the panel sits above the list, so bring it into view.
    if (matchMedia('(max-width: 900px)').matches) scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// The "river": a vertical thread through days. Quiet stretches show up as dashed
// gaps whose length grows with the number of idle days.
function river(actions, todoCount) {
  const byDay = new Map();
  actions.forEach(a => {
    const k = a.at.slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(a);
  });
  const today = dayKey(new Date());
  let html = `<div class="river">
    <div class="now"><span class="pulse"></span><b>Now</b>${todoCount ? `<span class="muted"> · ${todoCount} todo ahead</span>` : ''}</div>`;
  let prev = today, prevMonth = today.slice(0, 7);
  for (const [k, items] of byDay) {
    const gap = daysBetween(k, prev) - 1;
    if (gap > 0) {
      const h = Math.min(18 + Math.log2(gap + 1) * 16, 110);
      html += `<div class="gap" style="height:${h}px"><span>${gap} quiet day${gap > 1 ? 's' : ''}</span></div>`;
    }
    if (k.slice(0, 7) !== prevMonth) {
      html += `<div class="month">${fmtDay(k, { month: 'long', year: 'numeric' })} <span class="jal">· ${jMonthSpan(k)}</span></div>`;
      prevMonth = k.slice(0, 7);
    }
    const rel = k === today ? 'Today' : daysBetween(k, today) === 1 ? 'Yesterday' : fmtDay(k, { weekday: 'short' });
    html += `<div class="day" style="--n:${Math.min(items.length, 6)}">
      <div class="bubble" title="${fmtDay(k, { day: 'numeric', month: 'long', year: 'numeric' })} · ${jDay(k, { year: true })}"><b>${parseDay(k).getDate()}</b><small>${rel}</small><small class="jal">${jDay(k, { short: true })}</small></div>
      <div class="dcards">${items.map(card).join('')}</div>
    </div>`;
    prev = k;
  }
  if (!actions.length) html += `<p class="muted pad">No actions yet. Log one, or tick a todo.</p>`;
  else {
    const first = [...byDay.keys()].pop();
    html += `<div class="origin">Started ${fmtDay(first, { month: 'short', day: 'numeric', year: 'numeric' })} · ${jDay(first, { year: true })}</div>`;
  }
  return html + '</div>';
}

function card(e) {
  return `<article class="card" data-entry="${e.id}">
    <div class="row between">
      <time>${e.at.slice(11, 16)}</time>
      <span class="tools">
        <button class="icon" data-act="edit-entry" data-id="${e.id}" title="Edit">✎</button>
        <button class="icon" data-act="undo" data-id="${e.id}" title="Move back to todo">↩</button>
        <button class="icon" data-act="del-entry" data-id="${e.id}" title="Delete">✕</button>
      </span>
    </div>
    <div class="ctitle">${esc(e.title)}</div>
    ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
  </article>`;
}

function entryEditor(e) {
  return `<form data-form="entry-edit" data-id="${e.id}" class="stack edit">
    <input name="title" value="${esc(e.title)}" required>
    <textarea name="note" rows="2" placeholder="Details">${esc(e.note)}</textarea>
    <div class="row">
      <input type="datetime-local" name="at" value="${e.at}" required>
      <button class="btn primary">Save</button>
      <button type="button" class="btn" data-act="refresh">Cancel</button>
    </div>
  </form>`;
}

function projectEditor(p) {
  return `<form data-form="project-edit" class="panel stack">
    <div class="typepick">${Object.entries(TYPE).map(([k, l]) =>
      `<label><input type="radio" name="type" value="${k}" ${k === p.type ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <input name="name" value="${esc(p.name)}" required>
    <textarea name="description" rows="3" placeholder="Description">${esc(p.description)}</textarea>
    ${swatches(p.color)}<input type="hidden" name="color" value="${p.color}">
    <div class="row between">
      <button type="button" class="btn danger" data-act="del-project">Delete ${TYPE[p.type].toLowerCase()}</button>
      <span class="row"><button type="button" class="btn" data-act="refresh">Cancel</button><button class="btn primary">Save</button></span>
    </div>
  </form>`;
}

const swatches = sel => `<div class="swatches">${COLORS.map(c => `<button type="button" data-act="color" data-v="${c}" class="${c === sel ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>`;

// ---------- events ----------------------------------------------------------
const formData = f => Object.fromEntries(new FormData(f));
const entry = id => state.entries.find(e => e.id === +id);

document.addEventListener('submit', async ev => {
  const f = ev.target, kind = f.dataset.form;
  if (!kind) return;
  ev.preventDefault();
  const data = formData(f);
  if (kind === 'action') {
    await api('POST', `/api/projects/${state.current}/entries`, { ...data, kind: 'action' });
    state.focus = '#action-input';
  } else if (kind === 'todo') {
    await api('POST', `/api/projects/${state.current}/entries`, { title: data.title, kind: 'todo', at: nowLocal() });
    state.focus = '#todo-input';
  } else if (kind === 'blocker') {
    await api('POST', `/api/projects/${state.current}/entries`, { title: data.title, kind: 'blocker', at: nowLocal() });
    state.focus = '#blocker-input';
  } else if (kind === 'entry-edit') {
    await api('PATCH', `/api/entries/${f.dataset.id}`, data);
  } else if (kind === 'project-edit') {
    await api('PATCH', `/api/projects/${state.current}`, data);
  } else if (kind === 'new-project') {
    const p = await api('POST', '/api/projects', data);
    $('#dlg').close();
    f.reset();
    state.dirty = true;
    location.hash = `${state.page === 'done' ? '#/done' : '#'}/p/${p.id}`;
    return;
  }
  route();
});

document.addEventListener('change', async ev => {
  const field = ev.target.dataset.pfield;
  if (!field) return;
  await api('PATCH', `/api/projects/${state.current}`, { [field]: ev.target.value });
  route();
});

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const { act, id, v } = el.dataset;
  switch (act) {
    case 'new-project': {
      const f = $('#dlg form');
      const c = COLORS[state.projects.length % COLORS.length];
      $('[data-swatches]', f).innerHTML = swatches(c);
      f.color.value = c;
      f.type.value = v || 'project';
      $('h3', f).textContent = v === 'task' ? 'New task' : 'New project';
      $('#dlg').showModal();
      return;
    }
    case 'theme': {
      const dark = document.documentElement.dataset.theme !== 'dark';
      if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
      try { localStorage.theme = dark ? 'dark' : 'light'; } catch (e) {}
      themeLabel();
      return;
    }
    case 'close-dlg': $('#dlg').close(); return;
    case 'color': {
      const form = el.closest('form');
      form.color.value = v;
      form.querySelectorAll('.swatches button').forEach(b => b.classList.toggle('on', b === el));
      return;
    }
    case 'range': state.range = +v; return showOverview();
    case 'more-days': state.logDays += 14; return showOverview();
    case 'todo-sort': state.todoSort = v; return showOverview();
    case 'close': return closeDetail();
    case 'refresh': return route();
    case 'edit-project': {
      $('#pedit').innerHTML = projectEditor(state.projects.find(p => p.id === state.current));
      $('#pedit input').focus();
      return;
    }
    case 'del-project':
      if (!confirm(`Delete this ${state.projects.find(p => p.id === state.current)?.type || 'project'} and all its todos/actions?`)) return;
      await api('DELETE', `/api/projects/${state.current}`);
      state.dirty = true;
      location.hash = baseHash();
      return;
    case 'complete':
      await api('PATCH', `/api/entries/${id}`, { kind: 'action', at: nowLocal() });
      return route();
    case 'complete-task': {
      const k = state.projects.find(p => p.id === +id);
      if (+el.dataset.subs && !confirm(`"${k.name}" still has ${plural(+el.dataset.subs, 'open todo')}. Mark the task done anyway?`)) return;
      await api('POST', `/api/projects/${id}/entries`, { kind: 'action', title: `Done: ${k.name}`, at: nowLocal() });
      await api('PATCH', `/api/projects/${id}`, { status: 'done' });
      return route();
    }
    case 'resolve':
      await api('PATCH', `/api/entries/${id}`, { kind: 'action', title: `Unblocked: ${entry(id).title}`, at: nowLocal() });
      return route();
    case 'undo':
      await api('PATCH', `/api/entries/${id}`, { kind: 'todo' });
      return route();
    case 'del-entry':
      if (!confirm('Delete this item?')) return;
      await api('DELETE', `/api/entries/${id}`);
      return route();
    case 'edit-entry': {
      const box = document.querySelector(`[data-entry="${id}"]`);
      box.innerHTML = entryEditor(entry(id));
      box.classList.add('editing');
      $('input', box).focus();
      return;
    }
  }
});

function themeLabel() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const b = $('[data-act="theme"]');
  b.textContent = dark ? '☀' : '☾';
  b.title = dark ? 'Light mode' : 'Dark mode';
}
themeLabel();
route();

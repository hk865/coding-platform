function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function createBoard({ fetcher = globalThis.fetch, storage = globalThis.localStorage } = {}) {
  let state = { status: 'all', q: '', page: 1, pageSize: 3, items: [], total: 0 };
  try { const saved = JSON.parse(storage?.getItem('taskboard.filter') || '{}'); state.status = ['all','open','done'].includes(saved.status) ? saved.status : 'all'; state.q = typeof saved.q === 'string' ? saved.q : ''; } catch {}
  async function load() {
    const params = new URLSearchParams({ status: state.status, q: state.q, page: String(state.page), pageSize: String(state.pageSize) });
    const response = await fetcher('/api/tasks?' + params);
    if (!response.ok) throw new Error('Task request failed');
    state = { ...state, ...await response.json() };
    return state;
  }
  return {
    state: () => structuredClone(state),
    load,
    async setFilter({ status = state.status, q = state.q }) { state = { ...state, status, q, page: 1 }; storage?.setItem('taskboard.filter', JSON.stringify({ status, q })); return load(); },
    async setPage(page) { state.page = page; return load(); },
    render: () => '<ul>' + state.items.map(row => '<li data-id="' + escapeHtml(row.id) + '">' + escapeHtml(row.title) + '</li>').join('') + '</ul><p>' + state.total + ' tasks</p>'
  };
}
export function mount(root, options = {}) {
  const board = createBoard(options);
  root.innerHTML = '<label>Status <select id="status"><option value="all">All</option><option value="open">Open</option><option value="done">Done</option></select></label><label>Search <input id="query" type="search"></label><div id="items"></div><button id="next">Next</button>';
  const show = () => { root.querySelector('#items').innerHTML = board.render(); };
  root.querySelector('#status').addEventListener('change', async event => { await board.setFilter({ status: event.target.value }); show(); });
  root.querySelector('#status').value = board.state().status;
  root.querySelector('#query').value = board.state().q;
  root.querySelector('#query').addEventListener('input', async event => { await board.setFilter({ q: event.target.value }); show(); });
  root.querySelector('#next').addEventListener('click', async () => { await board.setPage(board.state().page + 1); show(); });
  return { board, ready: board.load().then(show) };
}

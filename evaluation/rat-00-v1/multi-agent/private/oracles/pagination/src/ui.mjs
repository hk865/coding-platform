function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function createBoard({ fetcher = globalThis.fetch, storage = globalThis.localStorage } = {}) {
  let state = { status: 'all', q: '', page: 1, pageSize: 3, items: [], total: 0 };
  async function load() {
    const params = new URLSearchParams({ status: state.status, page: String(state.page), pageSize: String(state.pageSize) });
    const response = await fetcher('/api/tasks?' + params);
    if (!response.ok) throw new Error('Task request failed');
    state = { ...state, ...await response.json() };
    return state;
  }
  return {
    state: () => structuredClone(state),
    load,
    async setFilter({ status = state.status, q = state.q }) { state = { ...state, status, q, page: 1 }; return load(); },
    async setPage(page) { state.page = page; return load(); },
    render: () => '<ul>' + state.items.map(row => '<li data-id="' + escapeHtml(row.id) + '">' + escapeHtml(row.title) + '</li>').join('') + '</ul><p>' + state.total + ' tasks</p>'
  };
}
export function mount(root, options = {}) {
  const board = createBoard(options);
  root.innerHTML = '<label>Status <select id="status"><option value="all">All</option><option value="open">Open</option><option value="done">Done</option></select></label><div id="items"></div><button id="next">Next</button>';
  const show = () => { root.querySelector('#items').innerHTML = board.render(); };
  root.querySelector('#status').addEventListener('change', async event => { await board.setFilter({ status: event.target.value }); show(); });
  root.querySelector('#next').addEventListener('click', async () => { await board.setPage(board.state().page + 1); show(); });
  return { board, ready: board.load().then(show) };
}

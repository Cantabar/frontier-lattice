const grid = document.getElementById('grid');
const search = document.getElementById('search');
const toast = document.getElementById('toast');

let items = [];
let toastTimeout = null;

async function init() {
  const res = await fetch('/items.json');
  items = await res.json();
  render(items);
  search.addEventListener('input', onSearch);
}

function onSearch() {
  const q = search.value.toLowerCase().trim();
  if (!q) {
    render(items);
    return;
  }
  const filtered = items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      String(item.typeId).includes(q)
  );
  render(filtered);
}

function render(list) {
  grid.innerHTML = '';
  if (list.length === 0) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#666;">No items found</p>';
    return;
  }
  for (const item of list) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <img src="/${item.icon}" alt="${item.name}" loading="lazy" />
      <span class="name">${item.name}</span>
      <span class="type-id">${item.typeId}</span>
    `;
    card.addEventListener('click', () => copyCommand(item));
    grid.appendChild(card);
  }
}

async function copyCommand(item) {
  const cmd = `/giveitem ${item.typeId} 100`;
  try {
    await navigator.clipboard.writeText(cmd);
    showToast(`Copied: ${cmd}`);
  } catch {
    // Fallback for non-HTTPS contexts
    const ta = document.createElement('textarea');
    ta.value = cmd;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(`Copied: ${cmd}`);
  }
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 1500);
}

init();

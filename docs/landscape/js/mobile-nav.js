// スマホ用の下部タブバー（幅900px以下でのみ表示。CSS側で制御）。
// 「企業」タブは、直前に見た企業（player.html の id、または edge.html の via）を端末内に
// 覚えておき、そこへ戻る。まだ企業を開いていなければ押せない状態で表示する。
// localStorage は使えない場合があるため、読み書きはすべて try/catch で囲む。

const KEY = "pl-last-entity";

function readStored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function writeStored(value) {
  try { localStorage.setItem(KEY, value); } catch { /* 使えなくても画面は動く */ }
}

const ICONS = {
  index: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  player: '<rect x="4" y="3" width="16" height="18" rx="1"/><rect x="8" y="7" width="2" height="2"/><rect x="14" y="7" width="2" height="2"/><rect x="8" y="12" width="2" height="2"/><rect x="14" y="12" width="2" height="2"/>',
  news: '<rect x="4" y="4" width="16" height="16" rx="1"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>',
};

function currentPage() {
  const last = location.pathname.split("/").pop();
  return last || "index.html";
}

function mount() {
  const page = currentPage();
  const params = new URLSearchParams(location.search);
  const contextId = page === "player.html" ? params.get("id") : page === "edge.html" ? params.get("via") : null;
  if (contextId) writeStored(contextId);
  const lastId = contextId || readStored();

  const activeKey = page === "news.html" ? "news" : page === "player.html" || page === "edge.html" ? "player" : "index";
  const tabs = [
    { key: "index", label: "全体図", href: "index.html" },
    { key: "player", label: "企業", href: lastId ? `player.html?id=${encodeURIComponent(lastId)}` : null },
    { key: "news", label: "ニュース", href: "news.html" },
  ];

  const nav = document.createElement("nav");
  nav.className = "pl-tabbar";
  nav.setAttribute("aria-label", "画面の切り替え");
  for (const t of tabs) {
    const item = document.createElement(t.href ? "a" : "span");
    item.className = "pl-tab" + (t.key === activeKey ? " is-active" : "") + (t.href ? "" : " is-disabled");
    if (t.href) item.setAttribute("href", t.href);
    else item.setAttribute("aria-disabled", "true");
    if (t.key === activeKey) item.setAttribute("aria-current", "page");
    item.innerHTML =
      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${ICONS[t.key]}</svg>` +
      `<span class="pl-tab-label"></span>`;
    item.querySelector(".pl-tab-label").textContent = t.label;
    nav.appendChild(item);
  }
  document.body.appendChild(nav);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
else mount();

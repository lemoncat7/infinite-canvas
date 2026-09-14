/** One disclosure contains all administrator-only account actions. */
export function createAdminActionsMenu(buttons: HTMLButtonElement[]) {
  const menu = document.createElement('details');
  menu.id = 'admin-actions'; menu.hidden = true;
  const summary = document.createElement('summary');
  summary.setAttribute('aria-label', '管理员');
  summary.innerHTML = '<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6z"/><path d="m8 12 3 3 5-6"/></svg></span><b>管理员</b><svg class="admin-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m9 5 7 7-7 7"/></svg>';
  const submenu = document.createElement('div'); submenu.className = 'admin-submenu';
  submenu.setAttribute('role', 'group'); submenu.setAttribute('aria-label', '管理员功能');
  submenu.append(...buttons); menu.append(summary, submenu);
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { event.preventDefault(); event.stopPropagation(); menu.open = false; summary.focus(); }
  });
  return menu;
}

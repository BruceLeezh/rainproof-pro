document.querySelectorAll('[data-hours]').forEach(button => button.addEventListener('click', () => {
  const hours = Number(button.dataset.hours);
  document.querySelectorAll('[data-hours]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  document.querySelectorAll('[data-first]').forEach(n => n.textContent = hours === 12 ? '30' : '50');
  document.querySelectorAll('[data-second]').forEach(n => n.textContent = hours === 12 ? '70' : '100');
  document.querySelectorAll('[data-window]').forEach(n => n.textContent = String(hours));
  const announcement = document.getElementById('rule-announcement');
  if (announcement) announcement.textContent = `已切换为 ${hours} 小时规则。两档阈值分别为 ${hours === 12 ? '30 和 70' : '50 和 100'} 毫米，模拟给付为 50 和 75 元。`;
}));
const menu = document.querySelector('.menu-toggle');
const links = document.querySelector('.nav-links');
function closeMenu() { if (menu && links) {menu.setAttribute('aria-expanded','false');links.removeAttribute('data-open');} }
if (menu && links) {
  menu.addEventListener('click', () => {const open = menu.getAttribute('aria-expanded') !== 'true';menu.setAttribute('aria-expanded', String(open));links.toggleAttribute('data-open', open);});
  links.addEventListener('click', event => {if(event.target.closest('a')) closeMenu();});
  document.addEventListener('keydown', event => {if(event.key === 'Escape') {closeMenu();if(links.contains(document.activeElement))menu.focus();}});
}

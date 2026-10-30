/* Shared navigation and progressive enhancements. No chain or wallet writes. */
(() => {
  'use strict';
  const toggle = document.querySelector('.rp-menu-toggle');
  const menu = document.getElementById('rp-menu');
  function closeMenu() {
    menu?.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
  }
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    menu?.classList.toggle('is-open', open);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle?.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && !event.target.closest('.rp-topbar')) closeMenu();
  });
  menu?.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('a')) closeMenu();
  });
  window.matchMedia('(min-width: 761px)').addEventListener('change', closeMenu);

  // A quote is a large number only when the RPC has returned a price.
  const quote = document.getElementById('quote');
  if (quote) {
    const updateQuoteStyle = () => quote.classList.toggle('rp-status-value', /失败|不可用|稍后|重试/.test(quote.textContent));
    new MutationObserver(updateQuoteStyle).observe(quote, { childList:true, subtree:true });
    quote.setAttribute('role', 'status');
    updateQuoteStyle();
  }

  const buttons = document.querySelectorAll('[data-window]');
  buttons.forEach(button => button.addEventListener('click', () => {
    const hours = Number(button.dataset.window);
    const first = hours === 12 ? 30 : 50;
    const second = hours === 12 ? 70 : 100;
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-rule-first]').forEach(el => { el.textContent = first; });
    document.querySelectorAll('[data-rule-second]').forEach(el => { el.textContent = second; });
    document.querySelectorAll('[data-rule-hours]').forEach(el => { el.textContent = hours; });
    const note = document.getElementById('rp-rule-announcement');
    if (note) note.textContent = `${hours} 小时保障：新增降雨达到 ${first} 毫米对应模拟给付 50 元，达到 ${second} 毫米对应模拟给付 75 元。`;
  }));
})();

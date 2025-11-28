// ==UserScript==
// @name         Bilibili 主题自动跟随
// @namespace    https://github.com/clen3zz/
// @version      2.6.1
// @description  让 B 站网页版主题自动跟随系统深浅模式切换。
// @author       clen3zz
// @match        https://www.bilibili.com/*
// @match        https://search.bilibili.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/clen3zz/bilibili-auto-dark/main/bilibili-theme-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/clen3zz/bilibili-auto-dark/main/bilibili-theme-sync.user.js
// ==/UserScript==

(function () {
  const HOVER_DELAY = 120;   // 悬停后等待渲染
  const MAX_RETRY   = 2;     // 打开并点击的尝试次数

  const mq = matchMedia('(prefers-color-scheme: dark)');
  let busy = false;

  syncToSystem();
  (mq.addEventListener ? mq.addEventListener('change', syncToSystem) : mq.addListener(syncToSystem));

  async function syncToSystem() {
    if (busy) return;
    const target = mq.matches ? 'dark' : 'light';

    // 若与系统同色，完全不触发任何 UI
    const guess = samplePageTheme();
    if (guess && guess === target) return;

    busy = true;
    try {
      await clickThemeViaMenu(target);
    } finally {
      busy = false;
    }
  }

  async function clickThemeViaMenu(target) {
    for (let i = 0; i < MAX_RETRY; i++) {
      if (await tryOnceWWW(target)) return true;
      if (await tryOnceGeneric(target)) return true;
    }
    return false;
  }

  // ===== 精确路径（www） =====
  async function tryOnceWWW(target) {
    try {
      const li = await waitFor(() => document.querySelector('li.v-popover-wrap.header-avatar-wrap'), 2500);
      if (!li) throw 0;

      await hover(li); await sleep(HOVER_DELAY);

      const panel = await waitFor(() => {
        const pop = li.querySelector('div.v-popover');
        return pop && isShown(pop) ? pop.querySelector('.v-popover-content.avatar-popover') : null;
      }, 800);
      if (!panel) throw 0;

      const themeSpan = Array.from(panel.querySelectorAll('.links-item .v-popover-wrap > a.single-link-item .link-title span'))
        .find(s => /^\s*主题\s*：/.test(s.textContent || ''));
      if (!themeSpan) throw 0;

      const line = (themeSpan.textContent || '').trim();
      const wantLight = target === 'light';
      if ((/浅色/.test(line) && wantLight) || (/深色|暗色|夜间/.test(line) && !wantLight)) return true;

      const themeWrap = themeSpan.closest('.v-popover-wrap') || themeSpan;
      await hover(themeWrap); await sleep(HOVER_DELAY);

      const submenu = await waitFor(() => {
        const el = document.querySelector('.v-popover.is-right .v-popover-content.sub-links-item');
        return el && isShown(el) ? el : null;
      }, 800);
      if (!submenu) throw 0;

      const rx = wantLight ? /(浅色|亮色|日间|Light)/i : /(深色|暗色|夜间|Dark)/i;
      const opt = Array.from(submenu.querySelectorAll('a.single-link-item.sub-link-item'))
        .find(a => rx.test((a.textContent || '').trim()));
      if (!opt) throw 0;

      await hover(opt); await sleep(20);
      click(opt);

      // 旧版简洁关闭：下一帧后做 leave + outside click + ESC
      await nextFrame();
      simpleClose(li);
      return true;
    } catch { return false; }
  }

  // ===== 通用路径（t 等） =====
  async function tryOnceGeneric(target) {
    try {
      const avatar = await waitFor(() => document.querySelector(
        '.header-avatar-wrap, .right-entry .header-avatar, .header-entry-mini .avatar, ' +
        '.nav-header .avatar, .side-header .avatar, .bili-dyn-header__avatar, #i_cecream .header-login-entry .avatar'
      ), 2000);
      if (!avatar) throw 0;

      await hover(avatar); await sleep(HOVER_DELAY);

      const menu = await waitFor(() => {
        const pops = Array.from(document.querySelectorAll('.v-popover')).filter(isShown);
        return pops[0] || null;
      }, 600);
      if (!menu) throw 0;

      const themeItem = findByText(menu, /^\s*主题\s*：/);
      if (!themeItem) throw 0;

      const text = (themeItem.textContent || '').trim();
      const wantLight = target === 'light';
      if ((/浅色/.test(text) && wantLight) || (/深色|暗色|夜间/.test(text) && !wantLight)) return true;

      const wrap = themeItem.closest('.v-popover-wrap') || themeItem;
      await hover(wrap); await sleep(HOVER_DELAY);

      const submenu = await waitFor(() => {
        const exact = document.querySelector('.v-popover.is-right .v-popover-content.sub-links-item');
        if (exact && isShown(exact)) return exact;
        const pops = Array.from(document.querySelectorAll('.v-popover')).filter(isShown);
        return pops.find(p => /深色|浅色|Dark|Light/.test(p.textContent || '')) || null;
      }, 800);
      if (!submenu) throw 0;

      const rx = wantLight ? /(浅色|亮色|日间|Light)/i : /(深色|暗色|夜间|Dark)/i;
      const opt = Array.from(submenu.querySelectorAll('a.single-link-item.sub-link-item, a, [role="menuitem"], [role="menuitemradio"]'))
        .filter(isShown)
        .find(a => rx.test((a.textContent || '').trim()));
      if (!opt) throw 0;

      await hover(opt); await sleep(20);
      click(opt);

      await nextFrame();
      simpleClose(avatar);
      return true;
    } catch { return false; }
  }

  // ===== 背景取样：已同色就不触发任何 UI =====
  function samplePageTheme() {
    const cands = [
      document.documentElement,
      document.body,
      document.querySelector('#i_cecream'),
      document.querySelector('#app'),
      document.querySelector('.bili-layout'),
      document.querySelector('.bili-header'),
      document.querySelector('.bili-dyn-home--container')
    ].filter(Boolean);

    for (const el of cands) {
      const col = effectiveBgColor(el);
      if (col) return isDark(col) ? 'dark' : 'light';
    }
    return null;
  }
  function effectiveBgColor(el) {
    const seen = new Set();
    let cur = el;
    for (let i = 0; i < 6 && cur && !seen.has(cur); i++) {
      seen.add(cur);
      const cs = getComputedStyle(cur);
      const bg = cs.backgroundColor;
      const img = cs.backgroundImage;
      if (bg && !/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(bg) && img === 'none') return bg;
      cur = cur.parentElement;
    }
    return null;
  }
  function isDark(rgbStr) {
    const m = rgbStr.match(/rgba?\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)/i);
    if (!m) return false;
    const r = +m[1]/255, g = +m[2]/255, b = +m[3]/255;
    const toLin = (v)=> v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
    const L = 0.2126*toLin(r) + 0.7152*toLin(g) + 0.0722*toLin(b);
    return L < 0.45;
  }

  // ===== 旧版简洁关闭：leave + outside click + ESC =====
  function simpleClose(avatarContainer) {
    try {
      // 1) 所有可见 popover 发离开
      const pops = Array.from(document.querySelectorAll('.v-popover')).filter(isShown);
      pops.forEach(p => {
        ['pointerleave','mouseleave','mouseout'].forEach(t =>
          p.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: 0, clientY: 0 }))
        );
      });

      // 2) 头像容器也发离开（hover 打开时生效）
      if (avatarContainer) {
        ['pointerleave','mouseleave','mouseout'].forEach(t =>
          avatarContainer.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: 0, clientY: 0 }))
        );
      }

      // 3) 在页面左上角 outside click 一下
      const r = document.documentElement.getBoundingClientRect();
      ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
        document.documentElement.dispatchEvent(new MouseEvent(t, {
          bubbles: true, cancelable: true, clientX: r.left + 1, clientY: r.top + 1
        }))
      );

      // 4) ESC 兜收
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', code: 'Escape', bubbles: true }));
    } catch {}
  }

  // ===== 小工具 =====
  function isShown(el){ if(!el) return false; const s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden'||+s.opacity===0) return false; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; }
  async function waitFor(fn, timeout=1000, interval=40){ const t0=Date.now(); while(Date.now()-t0<timeout){ const v=(typeof fn==='function')?fn():document.querySelector(fn); if(v) return v; await sleep(interval);} return null; }
  function findByText(root, rx){ const nodes=[...root.querySelectorAll('a,button,div,li,[role="menuitem"],[role="menuitemradio"]')].filter(isShown); return nodes.find(n=>rx.test((n.textContent||'').trim())); }
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const nextFrame = ()=> new Promise(r => requestAnimationFrame(()=>r()));
  async function hover(el){ const r=el.getBoundingClientRect(); const x=r.left + Math.min(10,r.width/2), y=r.top + Math.min(10,r.height/2); ['pointerover','mouseover','mouseenter','mousemove'].forEach(t=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,clientX:x,clientY:y}))); }
  function click(el){ const r=el.getBoundingClientRect(); const x=r.left + Math.min(10,r.width/2), y=r.top + Math.min(10,r.height/2); ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y}))); }
})();

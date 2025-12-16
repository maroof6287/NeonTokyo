// NeonTokyo UI helpers (vanilla). Kept separate for clarity + reuse.
export function $(sel, root=document){ return root.querySelector(sel); }
export function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

export function toast(msg, ms=2600){
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove("pop");
  void t.offsetWidth;
  t.classList.add("pop");
  window.clearTimeout(t.__to);
  t.__to = window.setTimeout(()=>{ t.hidden = true; }, ms);
}

export function haptic(){
  if (navigator.vibrate) navigator.vibrate(10);
}

export function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

import { sdk } from "https://esm.sh/@farcaster/miniapp-sdk";
import { Attribution } from "https://esm.sh/ox/erc8021";
import { $, $all, toast, haptic, clamp } from "./NeonTokyo-ui.js";

// Base Builder Code: find yours at base.dev → Settings → Builder Code
const BUILDER_CODE = "bc_3rs6zf0c";
const RECIPIENT = "0x04514c3d1a7074E6972190A5632875F4d14785F8";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_MAINNET = "0x2105";
const BASE_SEPOLIA = "0x14a34";

const mantras = ["HUD online. Distractions: null.", "Lock in. Compile your attention.", "One task. One timeline.", "Silence the noise; ship the build.", "Focus reactor: warming\u2026", "Cut the tabs. Keep the thread.", "Hands steady. Mind sharp.", "Glitch the urge. Stay in flow.", "Your next line matters.", "Run the loop: plan \u2192 execute \u2192 commit.", "Latency is the enemy. Reduce context switching.", "Deep work is a private server.", "Leave the feed. Enter the forge.", "Timer started. Reality narrowed.", "System stable. Keep going.", "Don\u2019t browse. Debug.", "Make it work, then make it shine.", "Just 25 minutes. Then breathe.", "Push through the middle dip.", "Keep the cursor moving.", "Protect the interval.", "Distraction detected\u2014rerouting.", "Stay in cockpit view.", "One more function. One more page.", "End the session with a clean checkpoint.", "Session complete. Save state."];
const STORE = "neontokyo_state_v1";

window.addEventListener("load", async () => {
  const isMini = await sdk.isInMiniApp();
  await sdk.actions.ready();

  $("#envPill").textContent = isMini ? "Mini App" : "Browser";
  document.documentElement.dataset.env = isMini ? "mini" : "web";

  const st = loadState();
  let focusM = st.focusM ?? 25;
  let breakM = st.breakM ?? 5;
  let mode = st.mode ?? "focus";
  let remaining = st.remaining ?? focusM*60;
  let running = false;
  let tick = null;
  let sessions = st.sessions ?? 0;

  let blocked = new Set(st.blocked ?? []);
  let hits = st.hits ?? 0;

  $("#focusMin").value = focusM ? String(focusM) : "";
  $("#breakMin").value = breakM ? String(breakM) : "";
  $("#sessionCount").textContent = String(sessions);
  $("#blockedHits").textContent = String(hits);
  $("#mantraBox").textContent = mantras[(Math.floor(Date.now()/86400000)) % mantras.length];

  syncPills();
  updateHUD();
  renderTime();

  $("#shuffleBtn").addEventListener("click", () => {
    $("#mantraBox").textContent = mantras[Math.floor(Math.random()*mantras.length)];
    haptic();
  });

  $("#focusMin").addEventListener("change", () => {
    const v = parseInt($("#focusMin").value || "25", 10);
    focusM = clamp(isNaN(v)?25:v, 1, 90);
    if (!running && mode === "focus") remaining = focusM*60;
    persist(); renderTime();
  });
  $("#breakMin").addEventListener("change", () => {
    const v = parseInt($("#breakMin").value || "5", 10);
    breakM = clamp(isNaN(v)?5:v, 1, 30);
    if (!running && mode === "break") remaining = breakM*60;
    persist(); renderTime();
  });

  $("#startBtn").addEventListener("click", () => {
    if (running) return;
    running = true;
    setPhase("RUNNING");
    $("#overlayState").textContent = "ON";
    startTick();
    toast("Focus HUD engaged.");
    haptic();
  });

  $("#pauseBtn").addEventListener("click", () => {
    if (!running) return;
    running = false;
    stopTick();
    setPhase("PAUSED");
    $("#overlayState").textContent = "OFF";
    persist();
    toast("Paused.");
    haptic();
  });

  $("#resetBtn").addEventListener("click", () => {
    running = false;
    stopTick();
    mode = "focus";
    remaining = focusM*60;
    setPhase("IDLE");
    $("#overlayState").textContent = "OFF";
    persist();
    renderTime();
    toast("Reset.");
    haptic();
  });

  $all(".pill", $("#pillRow")).forEach(p => {
    p.addEventListener("click", () => {
      const site = p.dataset.site;
      if (blocked.has(site)) blocked.delete(site); else blocked.add(site);
      syncPills(); updateHUD(); persist(); haptic();
    });
  });

  $("#tryOpenBtn").addEventListener("click", () => {
    const url = ($("#testUrl").value || "").trim();
    if (!url) { toast("Paste a URL to test."); return; }
    const host = hostOf(url);
    if (!host) { toast("That URL doesn't look right."); return; }

    if (running && isBlocked(host)) {
      hits += 1;
      $("#blockedHits").textContent = String(hits);
      persist();
      showOverlay("DISTRACTION BLOCKED");
      $("#mantraBox").textContent = mantras[Math.floor(Math.random()*mantras.length)];
      toast("Blocked. Back to cockpit.");
      return;
    }

    window.open(url, "_blank", "noopener");
    toast("Opening…");
  });

  const overlay = $("#overlay");
  overlay.addEventListener("click", () => overlay.classList.remove("on"));

  // Tip sheet
  const tipBackdrop = $("#tipBackdrop");
  const tipSheet = $("#tipSheet");
  const customAmt = $("#customAmt");
  const sendTipBtn = $("#sendTipBtn");

  let selectedAmt = null;
  let state = "idle"; // idle | preparing | confirm | sending | done

  function openTip() {
    tipBackdrop.hidden = false;
    tipSheet.hidden = false;
    tipBackdrop.classList.add("show");
    tipSheet.classList.add("show");
    setTimeout(()=>customAmt.focus(), 120);
  }
  function closeTip() {
    tipBackdrop.classList.remove("show");
    tipSheet.classList.remove("show");
    setTimeout(()=>{ tipBackdrop.hidden = true; tipSheet.hidden = true; }, 160);
  }

  $("#tipBtn").addEventListener("click", () => { openTip(); haptic(); });
  $("#closeTipBtn").addEventListener("click", closeTip);
  tipBackdrop.addEventListener("click", closeTip);

  $all(".chip", $("#presetGrid")).forEach(btn => {
    btn.addEventListener("click", () => {
      $all(".chip", $("#presetGrid")).forEach(b=>b.classList.remove("on"));
      btn.classList.add("on");
      selectedAmt = btn.dataset.amt;
      customAmt.value = "";
      haptic();
    });
  });

  customAmt.addEventListener("input", () => {
    if (customAmt.value.trim().length) {
      $all(".chip", $("#presetGrid")).forEach(b=>b.classList.remove("on"));
      selectedAmt = null;
    }
  });

  function setState(next) {
    state = next;
    if (state === "idle") sendTipBtn.textContent = "Send USDC";
    if (state === "preparing") sendTipBtn.textContent = "Preparing tip…";
    if (state === "confirm") sendTipBtn.textContent = "Confirm in wallet";
    if (state === "sending") sendTipBtn.textContent = "Sending…";
    if (state === "done") sendTipBtn.textContent = "Send again";
    sendTipBtn.disabled = (state !== "idle" && state !== "done");
  }
  setState("idle");

  sendTipBtn.addEventListener("click", async () => {
    if (state === "done") { setState("idle"); return; }

    const amtStr = (selectedAmt ?? customAmt.value).trim();
    const parsed = parseAmount6(amtStr);
    if (!parsed.ok) { toast(parsed.error); return; }

    if (RECIPIENT.startsWith("TODO") || BUILDER_CODE.startsWith("TODO")) {
      toast("Tip disabled until RECIPIENT + BUILDER_CODE are set in script.js.");
      return;
    }

    setState("preparing");
    await preflightPulse(); // 1–1.5s before wallet opens

    try {
      setState("confirm");
      await sendUSDC(parsed.units, RECIPIENT);
      setState("sending");
      await sleep(650);
      setState("done");
      toast("Tip sent (or queued). Thanks!");
    } catch (err) {
      toast(friendlyErr(err));
      setState("idle");
    }
  });

  // Timer
  function startTick() {
    stopTick();
    tick = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (mode === "focus") {
          sessions += 1;
          $("#sessionCount").textContent = String(sessions);
          mode = "break";
          remaining = breakM*60;
          showOverlay("BREAK MODE");
        } else {
          mode = "focus";
          remaining = focusM*60;
          showOverlay("FOCUS MODE");
        }
        $("#mantraBox").textContent = mantras[Math.floor(Math.random()*mantras.length)];
      }
      renderTime();
      persist();
    }, 1000);
  }

  function stopTick() {
    if (tick) clearInterval(tick);
    tick = null;
  }

  function renderTime() {
    $("#modeText").textContent = (mode === "focus") ? "Focus" : "Break";
    const m = Math.floor(remaining/60);
    const s = remaining % 60;
    $("#timeText").textContent = String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
  }

  function setPhase(p) { $("#phaseLabel").textContent = p; }

  function syncPills() {
    $all(".pill", $("#pillRow")).forEach(p => {
      const site = p.dataset.site;
      p.classList.toggle("on", blocked.has(site));
    });
  }

  function updateHUD() { $("#blockedCount").textContent = String(blocked.size); }

  function showOverlay(msg) {
    const el = $("#overlay");
    const m = $("#overlayMsg");
    m.textContent = msg;
    m.setAttribute("data-text", msg);
    el.classList.add("on");
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./,""); } catch { return ""; }
  }

  function isBlocked(host) {
    if (blocked.has(host)) return true;
    for (const b of blocked) {
      if (host === b) return true;
      if (host.endsWith("." + b)) return true;
    }
    return false;
  }

  function persist() {
    const data = { focusM, breakM, mode, remaining, sessions, blocked: Array.from(blocked), hits };
    localStorage.setItem(STORE, JSON.stringify(data));
  }
});

// storage + tip helpers
function loadState() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function sleep(ms) { return new Promise(r=>setTimeout(r, ms)); }

async function preflightPulse() {
  const sheet = document.querySelector("#tipSheet");
  sheet.classList.add("preflight");
  await sleep(1250);
  sheet.classList.remove("preflight");
}

function parseAmount6(s) {
  const str = (s || "").trim();
  if (!str) return { ok:false, error:"Enter an amount." };
  if (!/^\d+(?:\.\d{0,6})?$/.test(str)) return { ok:false, error:"Invalid amount format (max 6 decimals)." };
  const [whole, frac=""] = str.split(".");
  const fracPadded = (frac + "000000").slice(0,6);
  try {
    const units = (BigInt(whole) * 1000000n) + BigInt(fracPadded);
    if (units <= 0n) return { ok:false, error:"Amount must be > 0." };
    return { ok:true, units };
  } catch {
    return { ok:false, error:"Amount too large." };
  }
}

function pad32(hexNo0x) { return hexNo0x.padStart(64, "0"); }

function encodeERC20Transfer(to, amountUnits) {
  const selector = "a9059cbb";
  const addr = to.toLowerCase().replace(/^0x/, "");
  if (addr.length !== 40) throw new Error("Bad recipient address.");
  const amt = amountUnits.toString(16);
  return "0x" + selector + pad32(addr) + pad32(amt);
}

async function ensureBaseChain(ethereum) {
  const chainId = await ethereum.request({ method:"eth_chainId" });
  if (chainId === BASE_MAINNET || chainId === BASE_SEPOLIA) return chainId;

  try {
    await ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId: BASE_MAINNET }] });
    return BASE_MAINNET;
  } catch {
    throw new Error("Please switch to Base in your wallet to send USDC.");
  }
}

async function sendUSDC(amountUnits, recipient) {
  const ethereum = window.ethereum;
  if (!ethereum || !ethereum.request) throw new Error("No EVM wallet found in this environment.");

  const accounts = await ethereum.request({ method:"eth_requestAccounts" });
  const from = accounts?.[0];
  if (!from) throw new Error("No account available.");

  const chainId = await ensureBaseChain(ethereum);
  const data = encodeERC20Transfer(recipient, amountUnits);

  const dataSuffix = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

  const params = [{
    version: "2.0.0",
    from,
    chainId,
    atomicRequired: true,
    calls: [{ to: USDC_BASE, value: "0x0", data }],
    capabilities: { dataSuffix }
  }];

  try {
    return await ethereum.request({ method:"wallet_sendCalls", params });
  } catch (err) {
    if (String(err?.code) === "4001" || /rejected|denied/i.test(String(err?.message))) {
      throw new Error("No worries—tip canceled.");
    }
    throw err;
  }
}

function friendlyErr(err) {
  const m = String(err?.message || err || "");
  if (!m) return "Something went wrong.";
  return m.slice(0, 180);
}

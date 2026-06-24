const STORAGE_KEY = "chaeyoung-constellation-v12";
const BASE = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) ||
  (/localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./.test(location.hostname) ? "/" : "/hbdchaeyoung/");

function cacheBust() {
  return document.querySelector('meta[name="build"]')?.content || String(Date.now());
}

function assetUrl(path) {
  if (!path || /^https?:/i.test(path)) return path;
  const cleaned = path.startsWith("/") ? path.slice(1) : path;
  const url = `${BASE}${cleaned}`;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${cacheBust()}`;
}

const state = {
  data: null,
  photoMetadata: null,
  lang: "both",
  pathIndex: 0,
  viewed: new Set(),
  lines: [],
  finaleTriggered: false,
  morphing: false,
  transcripts: {},
  journeyScale: 1,
  journeyCruise: 0,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const intro = $("#intro");
const sky = $("#sky");
const skyCam = $("#sky-cam");
const memoryReveal = $("#memory-reveal");
const finale = $("#finale");
const starsLayer = $("#stars");
const linesLayer = $("#lines");
const hint = $("#hint");
const chapterRail = $("#chapter-rail");
const voiceAudio = $("#voice-audio");
const voiceStatus = $("#voice-status");
const voiceBar = $(".voice-bar");
const dustCanvas = $("#dust");
const photoCanvas = $("#photo-drift");
const photoDomHost = $("#photo-drift-dom");
const bgm = $("#bgm");
const nightAir = $("#night-air");
const starChime = $("#star-chime");

let starEls = {};
let helperEls = {};
let ambientEls = [];
let skyRect = null;
let hintTimer = null;
let currentStar = null;
let currentPendingDiscoveryId = null;
let bgmStarted = false;
let voiceFadeRaf = null;
let postSpeechTimer = null;
let voiceTargetVolume = 0.88;
let voiceLevel = 0;
let dustDiveBoost = 1;
let memoryDiveTimer = null;
let focusedStarId = null;
let memoryProfile = null;
const DIVE_MS = 1150;
let journeyScrollReady = false;
let journeyTouchY = 0;
let journeyTouchAccum = 0;
let journeyAdvanceLock = false;
let journeyAdvanceCooldown = 0;
const JOURNEY_SCROLL_THRESHOLD = 16;
const JOURNEY_TOUCH_THRESHOLD = 14;
const JOURNEY_COOLDOWN_MS = 800;
let suppressVoicePauseMix = false;
let modalTypeTimer = null;

const IS_MOBILE = window.matchMedia("(max-width: 680px), (hover: none) and (pointer: coarse)").matches;
const IS_LOW_POWER = IS_MOBILE || (navigator.hardwareConcurrency || 8) <= 4;
const VOICE_MOBILE_BOOST = 2.75;

// Master switch for the polished experience layer. Flip to false to fall back
// to the previous behaviour (busy sci-fi HUD, faster ambient drift, no
// keyboard/scroll chapter advance).
const ENABLE_POLISHED_CONSTELLATION = true;
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let prefersReducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener?.("change", (e) => {
  prefersReducedMotion = e.matches;
  document.body.classList.toggle("reduced-motion", prefersReducedMotion);
});

function applyExperienceFlags() {
  document.body.classList.toggle("polished", ENABLE_POLISHED_CONSTELLATION);
  document.body.classList.toggle("reduced-motion", prefersReducedMotion);
}

const audioReactive = {
  ctx: null,
  analyser: null,
  data: null,
  level: 0,
  sampleTick: 0,
};

let camRaf = null;
let camTick = 0;
let camLastTick = 0;
const cam = {
  flyZ: 0,
  pushZ: 0,
  originX: 50,
  originY: 50,
  phase: "idle",
  cruiseStart: 0,
  cruiseBaseZ: 0,
  diveStart: 0,
  diveDur: DIVE_MS,
  diveFrom: null,
  diveTo: null,
};

const assetCache = {
  images: new Map(),
  ready: false,
};
const voiceBlobCache = new Map();
const videoBlobCache = new Map();
let preloadPromise = null;
let appReadyPromise = null;

const BGM_NORMAL = 0.18;
const AMBIENT_NORMAL = 0.12;
const BGM_TRACKS = [
  "/assets/bgm.mp3",
  "/assets/bgm-2.mp3",
  "/assets/bgm-3.mp3",
  "/assets/bgm-4.mp3",
];

function dbToGain(db) {
  return 10 ** (db / 20);
}

function getMemoryProfile(star) {
  const intimate = star?.id === lastStarId();
  const bgmDuckDb = intimate ? 9 : 7;
  const ambientDuckDb = intimate ? 5 : 4;
  return {
    intimate,
    bgmMemory: BGM_NORMAL * dbToGain(-1.5),
    ambientMemory: AMBIENT_NORMAL * dbToGain(-0.5),
    bgmDucked: BGM_NORMAL * dbToGain(-(bgmDuckDb + (IS_MOBILE ? 5 : 0))),
    ambientDucked: AMBIENT_NORMAL * dbToGain(-(ambientDuckDb + (IS_MOBILE ? 6 : 0))),
    bedDuckMs: intimate ? 1200 : 1000,
    bedRestoreMs: intimate ? 3400 : 2600,
    memoryEnterMs: intimate ? 1100 : 900,
    memoryLeaveMs: intimate ? 3000 : 2400,
    voiceVolume: IS_MOBILE ? 1 : intimate ? 0.74 : 0.78,
    voiceFadeInMs: intimate ? 520 : 400,
    voiceFadeOutMs: intimate ? 1200 : 900,
    postSpeechHoldMs: intimate ? 5200 : 0,
  };
}

async function init() {
  appReadyPromise = createAppReadyPromise();
  preloadPromise = appReadyPromise;
  applyExperienceFlags();

  let introStarted = false;

  try {
    const [contentRes, transcriptRes, photoMetadataRes] = await Promise.all([
      fetch(`${BASE}content.json?v=${Date.now()}`),
      fetch(`${BASE}audio/transcripts.json?v=${Date.now()}`),
      fetch(`${BASE}data/photoMetadata.public.json?v=${Date.now()}`).catch(() => null),
    ]);
    if (!contentRes.ok) throw new Error("content.json failed");
    state.data = await contentRes.json();
    if (transcriptRes.ok) state.transcripts = await transcriptRes.json();
    if (photoMetadataRes?.ok) state.photoMetadata = await photoMetadataRes.json();
    resetProgress();

    const preview = applyPreviewMode();
    setupIntro(appReadyPromise);
    introStarted = true;
    setupMobile();
    setupLangToggle();
    setupModal();
    setupJourneyScroll();

    const driftImages = await preloadAllAssets();
    if (starChime) starChime.src = voiceSrc("/assets/star-chime.mp3");
    setupDust(driftImages);
    setupBgm();
    setupNightAir();
    renderStars();
    renderHelperStars();
    renderAmbientStars();
    updateHud();
    await warmupSky();

    if (preview === "finale") {
      showSky();
      await sleep(50);
      await triggerFinale(true);
      return;
    }

    if (preview === "sky" || state.pathIndex > 0 || state.viewed.size > 0) {
      showSky();
      restoreLines();
    }
  } catch (err) {
    console.error("init failed:", err);
    if (!introStarted && state.data) {
      setupIntro(appReadyPromise);
    }
  } finally {
    markAppReady();
  }
}

function applyPreviewMode() {
  const params = new URLSearchParams(location.search);
  const preview = params.get("preview");
  if (!preview) return false;

  if (preview === "finale") {
    state.pathIndex = state.data.path.length;
    state.data.path.forEach((id) => state.viewed.add(id));
    state.lines = getFinaleSegments().map(([from, to]) => ({ from, to, style: "finale" }));
    return "finale";
  }

  if (preview === "sky") {
    const step = Math.min(state.data.path.length, Math.max(0, parseInt(params.get("step") || "0", 10)));
    state.pathIndex = step;
    for (let i = 0; i < step; i++) state.viewed.add(state.data.path[i]);
    for (let i = 0; i < step; i++) {
      drawChapterStrokes(state.data.path[i], false);
    }
    return "sky";
  }

  return false;
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.pathIndex = saved.pathIndex ?? 0;
    state.viewed = new Set(saved.viewed ?? []);
    state.lines = saved.lines ?? [];
    state.finaleTriggered = saved.finaleTriggered ?? false;
  } catch {
    /* Ignore malformed local progress. */
  }
}

function resetProgress() {
  localStorage.removeItem(STORAGE_KEY);
  state.pathIndex = 0;
  state.viewed = new Set();
  state.lines = [];
  state.finaleTriggered = false;
  state.morphing = false;
}

function saveProgress() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      pathIndex: state.pathIndex,
      viewed: [...state.viewed],
      lines: state.lines,
      finaleTriggered: state.finaleTriggered,
    }),
  );
}

function createAppReadyPromise() {
  let resolveReady;
  const promise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  promise._resolve = resolveReady;
  return promise;
}

function markAppReady() {
  assetCache.ready = true;
  appReadyPromise?._resolve?.();
}

async function warmupSky() {
  if (dustCanvas._resize) dustCanvas._resize();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function withTimeout(promise, ms, label = "load") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

function setupIntro(readyPromise) {
  const { intro: introText, herName, ui } = state.data;
  const elEn = $(".intro-en");
  const elKo = $(".intro-ko");
  const elName = $(".intro-name");
  const btn = $("#intro-btn");
  const content = $(".intro-content");
  let typingDone = false;
  let loadDone = false;

  function tryShowBegin() {
    if (!typingDone) return;
    btn.classList.remove("hidden");
    if (loadDone) {
      btn.classList.remove("loading");
      btn.removeAttribute("aria-disabled");
    } else {
      btn.classList.add("loading");
      btn.setAttribute("aria-disabled", "true");
    }
  }

  readyPromise.finally(() => {
    loadDone = true;
    tryShowBegin();
  });

  elEn.textContent = "";
  elKo.textContent = "";
  elName.textContent = "";
  elName.style.opacity = "0";
  btn.classList.add("hidden");
  content.classList.add("typing");

  $(".btn-ko").textContent = ui.tapToBegin.ko;
  $(".btn-en").textContent = ui.tapToBegin.en;
  btn.addEventListener("click", beginExperience);
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); beginExperience(); }
  });

  typeText(elEn, introText.en, 65, () => {
    setTimeout(() => {
      typeText(elKo, introText.ko, 55, () => {
        content.classList.remove("typing");
        elName.style.opacity = "1";
        elName.textContent = `${herName.en} · ${herName.ko}`;
        content.classList.add("done");
        setTimeout(() => {
          typingDone = true;
          tryShowBegin();
        }, 250);
      });
    }, 420);
  });
}

function clearTypewriter() {
  if (modalTypeTimer) {
    clearInterval(modalTypeTimer);
    modalTypeTimer = null;
  }
  $$(".typing-active").forEach((el) => el.classList.remove("typing-active"));
}

function typeText(el, text, speed, done) {
  clearTypewriter();
  let i = 0;
  el.textContent = "";
  el.classList.add("typing-active");
  modalTypeTimer = setInterval(() => {
    el.textContent += text[i];
    i++;
    if (i >= text.length) {
      clearTypewriter();
      if (done) done();
    }
  }, speed);
}

let bgmTrackIndex = -1;

function pickNextBgmTrack() {
  if (BGM_TRACKS.length === 1) return BGM_TRACKS[0];
  let next = bgmTrackIndex;
  while (next === bgmTrackIndex) {
    next = Math.floor(Math.random() * BGM_TRACKS.length);
  }
  bgmTrackIndex = next;
  return BGM_TRACKS[next];
}

function loadBgmTrack(path) {
  bgm.src = voiceSrc(path);
  bgm.load();
}

function onBgmEnded() {
  const vol = bgm.volume;
  loadBgmTrack(pickNextBgmTrack());
  bgm.volume = vol;
  bgm.play().then(() => { bgmStarted = true; }).catch(() => {});
}

function setupBgm() {
  loadBgmTrack(pickNextBgmTrack());
  bgm.volume = BGM_NORMAL;
  bgm.loop = false;
  bgm.setAttribute("playsinline", "");
  bgm.muted = true;

  const onPlay = () => {
    bgmStarted = true;
    bgm.removeEventListener("play", onPlay);
  };
  bgm.addEventListener("play", onPlay);
  bgm.addEventListener("ended", onBgmEnded);
  bgm.play().catch(() => {});

  requestBgmUnlock();
}

function setupNightAir() {
  nightAir.src = voiceSrc("/assets/night-air.mp3");
  nightAir.volume = AMBIENT_NORMAL;
  nightAir.loop = true;
  nightAir.setAttribute("playsinline", "");
  nightAir.muted = true;
  nightAir.play().catch(() => {});
}

async function beginExperience() {
  if (sky.classList.contains("active")) return;
  const btn = $("#intro-btn");
  if (btn.getAttribute("aria-disabled") === "true") return;
  if (!assetCache.ready && appReadyPromise) await appReadyPromise;
  if (!assetCache.ready) return;
  unlockBgm();
  showSky();
}

function beginJourneyMode() {
  sky.classList.remove("sky-journey", "memory-dive", "journey-cruising");
  resetSkyCamera();
  updateStarStates();
  if (!state.viewed.size && !sky.classList.contains("finale-map")) {
    showHint(state.data.ui.startHint);
  } else if (expectedStarId() && !sky.classList.contains("finale-map")) {
    showHint(state.data.ui.scrollHint);
  }
}

function canAdvanceJourney() {
  if (!sky.classList.contains("active")) return false;
  if (sky.classList.contains("finale-map")) return false;
  if (sky.classList.contains("memory-revealed")) return false;
  if (state.morphing || journeyAdvanceLock) return false;
  if (performance.now() - journeyAdvanceCooldown < JOURNEY_COOLDOWN_MS) return false;
  return Boolean(expectedStarId());
}

function revealChapter(id) {
  onStarClick(id);
}

function advanceJourneyChapter() {
  if (!canAdvanceJourney()) return;
  const id = expectedStarId();
  if (!id) return;
  revealChapter(id);
}

function setupJourneyScroll() {
  if (journeyScrollReady) return;
  journeyScrollReady = true;

  let wheelTimer = null;

  const onWheel = (event) => {
    if (!canAdvanceJourney()) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = Math.abs(event.deltaY);
    if (delta < 3) return;
    journeyTouchAccum += delta;
    if (journeyTouchAccum >= JOURNEY_SCROLL_THRESHOLD) {
      journeyTouchAccum = 0;
      advanceJourneyChapter();
      return;
    }
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { journeyTouchAccum = 0; }, 350);
  };

  const onTouch = (event) => {
    if (!canAdvanceJourney()) return;
    if (!event.touches.length) return;
    const y = event.touches[0].clientY;
    if (journeyTouchY !== 0) {
      const delta = journeyTouchY - y;
      if (Math.abs(delta) > 2) {
        journeyTouchAccum += Math.abs(delta);
        if (journeyTouchAccum >= JOURNEY_TOUCH_THRESHOLD) {
          journeyTouchAccum = 0;
          journeyTouchY = y;
          advanceJourneyChapter();
          return;
        }
      }
    }
    journeyTouchY = y;
  };

  const endTouch = () => {
    journeyTouchY = 0;
    journeyTouchAccum = 0;
  };

  document.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("touchmove", onTouch, { passive: false });
  document.addEventListener("touchstart", () => { journeyTouchY = 0; journeyTouchAccum = 0; }, { passive: true });
  document.addEventListener("touchend", endTouch, { passive: true });
  document.addEventListener("touchcancel", endTouch, { passive: true });

  document.addEventListener("keydown", (event) => {
    if (!canAdvanceJourney()) return;
    // Don't hijack Space/Enter when a control (lang toggle, chapter dot) is focused.
    const ae = document.activeElement;
    const onControl = ae && (ae.tagName === "BUTTON" || ae.getAttribute?.("role") === "button");
    const advanceKey = event.key === "ArrowDown" || event.key === "PageDown" || event.key === "ArrowRight";
    const spaceKey = (event.key === " " || event.key === "Enter") && !onControl;
    if (advanceKey || spaceKey) {
      event.preventDefault();
      advanceJourneyChapter();
    }
  }, { passive: false });

  // Safety: auto-unlock if stuck for 10s
  setInterval(() => {
    if (journeyAdvanceLock && !sky.classList.contains("memory-revealed") && !state.morphing) {
      journeyAdvanceLock = false;
      journeyTouchAccum = 0;
    }
  }, 10000);
}

function setupMobile() {
  voiceAudio.setAttribute("playsinline", "");
  voiceAudio.setAttribute("webkit-playsinline", "");
  voiceAudio.preload = "auto";

  const relayout = () => {
    if (!sky.classList.contains("active")) return;
    skyRect = sky.getBoundingClientRect();
    if (dustCanvas._resize) dustCanvas._resize();
    positionStars(state.morphing || sky.classList.contains("finale-map"));
    positionHelperStars();
    redrawLines();
  };

  window.addEventListener("resize", relayout, { passive: true });
  window.addEventListener("orientationchange", () => setTimeout(relayout, 120), { passive: true });
  window.visualViewport?.addEventListener("resize", relayout, { passive: true });
  window.visualViewport?.addEventListener("scroll", relayout, { passive: true });
}

function unlockBgm() {
  ensureAudioReactive();
  bgm.muted = false;
  bgm.volume = BGM_NORMAL;
  nightAir.muted = false;
  nightAir.volume = AMBIENT_NORMAL;
  if (bgm.paused) {
    bgm.play().then(() => { bgmStarted = true; }).catch(() => {});
  }
  if (nightAir.paused) {
    nightAir.play().catch(() => {});
  }
}

function requestBgmUnlock() {
  const unlock = () => unlockBgm();
  document.addEventListener("touchstart", unlock, { once: true, passive: true });
  document.addEventListener("pointerdown", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
  $("#intro")?.addEventListener("click", unlock, { once: true });
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function setAudioVol(el, v) {
  const clamped = Math.max(0, Math.min(1, v));
  el.volume = clamped;
  if (el._audioGain && audioReactive.ctx) {
    el._audioGain.gain.setTargetAtTime(clamped, audioReactive.ctx.currentTime, 0.018);
  }
}

function setVoiceVol(v) {
  const clamped = Math.max(0, Math.min(1, v));
  voiceLevel = clamped;
  if (!IS_MOBILE) {
    setAudioVol(voiceAudio, clamped);
    return;
  }

  voiceAudio.volume = 1;
  if (voiceAudio._audioGain && audioReactive.ctx) {
    const boosted = clamped * VOICE_MOBILE_BOOST;
    voiceAudio._audioGain.gain.setTargetAtTime(boosted, audioReactive.ctx.currentTime, 0.018);
  }
}

function ensureAudioReactive() {
  if (audioReactive.ctx) {
    if (audioReactive.ctx.state === "suspended") audioReactive.ctx.resume().catch(() => {});
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  const ctx = new Ctx();
  const master = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = IS_MOBILE ? 128 : 256;
  analyser.smoothingTimeConstant = 0.84;
  master.connect(analyser);
  analyser.connect(ctx.destination);
  audioReactive.ctx = ctx;
  audioReactive.master = master;
  audioReactive.analyser = analyser;
  audioReactive.data = new Uint8Array(analyser.frequencyBinCount);

  const hook = (el) => {
    if (!el || el._audioHooked) return;
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = el.volume || 1;
    src.connect(gain);
    gain.connect(master);
    el._audioGain = gain;
    el._audioHooked = true;
  };

  hook(voiceAudio);
  hook(bgm);
  hook(nightAir);
  if (starChime) hook(starChime);
  if (IS_MOBILE && voiceAudio._audioGain) {
    voiceAudio._audioGain.gain.value = 0;
  }
}

function sampleAudioLevel() {
  if (!audioReactive.analyser) return 0;
  audioReactive.sampleTick += 1;
  if (audioReactive.sampleTick % (IS_MOBILE ? 3 : 2) !== 0) return audioReactive.level;

  audioReactive.analyser.getByteFrequencyData(audioReactive.data);
  let sum = 0;
  const end = Math.min(42, audioReactive.data.length);
  for (let i = 2; i < end; i += 1) sum += audioReactive.data[i];
  const raw = sum / ((end - 2) * 255);
  audioReactive.level += (raw - audioReactive.level) * (IS_MOBILE ? 0.22 : 0.16);
  return audioReactive.level;
}

const PARTICLE_BASE_SPEED = 0.00011;
const PARTICLE_AUDIO_GAIN = 0.22;
const PARTICLE_DIVE_GAIN = 2.4;

function getParticleFlyRate() {
  if (prefersReducedMotion) return 0;
  const dive = cam.phase === "dive" ? PARTICLE_DIVE_GAIN : 0;
  // Calmer ambient float when not actively diving through a memory — the field
  // should feel intentional rather than a constant stream of particles.
  const idleBase = ENABLE_POLISHED_CONSTELLATION && cam.phase === "idle" ? 1.35 : 2.1;
  return idleBase + audioReactive.level * PARTICLE_AUDIO_GAIN + dive;
}

function getDustFlyBoost() {
  return getParticleFlyRate();
}

function applyCameraTransform() {
  sky.style.setProperty("--audio-pulse", audioReactive.level.toFixed(3));
  sky.style.setProperty("--fly-z", String(cam.flyZ));
  sky.style.setProperty("--flight-scale", (1 + Math.min(0.62, cam.pushZ * 0.0027)).toFixed(3));
  state.journeyScale = 1 + cam.flyZ * 0.028;
  dustDiveBoost = getDustFlyBoost();
  const zMove = -cam.pushZ;
  skyCam.style.transform = `translate3d(0, 0, ${zMove.toFixed(2)}px)`;
  skyCam.style.transformOrigin = `${cam.originX}% ${cam.originY}%`;
}

function stopSkyCamera() {
  if (camRaf) cancelAnimationFrame(camRaf);
  camRaf = null;
  sky.classList.remove("journey-cruising");
}

function startSkyCamera() {
  if (camRaf) return;

  const tick = (now) => {
    camRaf = requestAnimationFrame(tick);
    if (cam.phase === "idle") return;

    const dt = camLastTick ? Math.min(48, now - camLastTick) : 16;
    camLastTick = now;
    sampleAudioLevel();
    camTick += 1;
    const starEvery = IS_MOBILE ? 2 : 1;

    if (cam.phase === "cruise") {
      if (!sky.classList.contains("sky-journey") || sky.classList.contains("memory-revealed")) {
        if (!sky.classList.contains("memory-revealed")) cam.phase = "idle";
        return;
      }

      const elapsed = now - cam.cruiseStart;
      const bumpMs = IS_MOBILE ? 1900 : 2300;
      const bump = 7 + state.pathIndex * 1.4;

      if (elapsed < bumpMs) {
        const t = easeOutCubic(elapsed / bumpMs);
        cam.flyZ = cam.cruiseBaseZ + bump * t;
        cam.pushZ = 40 + bump * 2.8 * t;
        state.journeyCruise = t;
      } else {
        const creep = (elapsed - bumpMs) / 1000;
        cam.flyZ = cam.cruiseBaseZ + bump + creep * (IS_MOBILE ? 1.1 : 1.45);
        cam.pushZ = 40 + bump * 2.8 + creep * (IS_MOBILE ? 18 : 24);
        state.journeyCruise = Math.min(1, 0.62 + creep * 0.09);
      }

      cam.originX = 50;
      cam.originY = 50;
      applyCameraTransform();
      if (camTick % starEvery === 0) positionStars(false);
      return;
    }

    if (cam.phase === "dive") {
      const elapsed = now - cam.diveStart;
      const t = easeOutCubic(Math.min(1, elapsed / cam.diveDur));
      const f = cam.diveFrom;
      const d = cam.diveTo;
      cam.flyZ = f.flyZ + (d.flyZ - f.flyZ) * t;
      cam.pushZ = f.pushZ + (d.pushZ - f.pushZ) * t;
      cam.originX = f.ox + (d.ox - f.ox) * t;
      cam.originY = f.oy + (d.oy - f.oy) * t;
      state.journeyCruise = f.cruise + (d.cruise - f.cruise) * t;
      applyCameraTransform();
      if (camTick % starEvery === 0) positionStars(false);
      if (t >= 1) cam.phase = "hold";
      return;
    }

    if (cam.phase === "hold") applyCameraTransform();
  };

  camRaf = requestAnimationFrame(tick);
}

function resetSkyCamera() {
  stopSkyCamera();
  cam.phase = "idle";
  cam.flyZ = 0;
  cam.pushZ = 0;
  cam.originX = 50;
  cam.originY = 50;
  camLastTick = 0;
  state.journeyScale = 1;
  state.journeyCruise = 0;
  skyCam.style.transform = "";
  skyCam.style.transformOrigin = "";
  sky.style.setProperty("--flight-scale", "1");
  sky.style.setProperty("--flight-origin-x", "50%");
  sky.style.setProperty("--flight-origin-y", "50%");
  dustDiveBoost = 1;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function starScreenPercent(id) {
  const star = getStar(id);
  if (!star) return { ox: 50, oy: 50 };
  const pos = journeyStarPos(star);
  return { ox: pos[0] * 100, oy: pos[1] * 100 };
}

function smoothVolume(el, target, durationMs, rafRef) {
  if (rafRef.current) cancelAnimationFrame(rafRef.current);
  if (!el || durationMs <= 0) {
    if (el) setAudioVol(el, target);
    return;
  }
  const startVol = el.volume;
  const delta = target - startVol;
  const t0 = performance.now();
  const tick = (now) => {
    const p = smoothstep(Math.min(1, (now - t0) / durationMs));
    setAudioVol(el, startVol + delta * p);
    if (p < 1) rafRef.current = requestAnimationFrame(tick);
    else rafRef.current = null;
  };
  rafRef.current = requestAnimationFrame(tick);
}

const bgmRaf = { current: null };
const nightAirRaf = { current: null };
const voiceRaf = { current: null };

function animateBgmVolume(target, durationMs = 400, { pauseAtZero = false } = {}) {
  if (bgm.paused && target <= 0) return;
  smoothVolume(bgm, target, durationMs, bgmRaf);
  if (pauseAtZero && target <= 0) {
    setTimeout(() => {
      if (bgm.volume <= 0.001) {
        bgm.pause();
        bgmStarted = false;
      }
    }, durationMs + 40);
  }
}

function animateNightAirVolume(target, durationMs = 400, { pauseAtZero = false } = {}) {
  if (nightAir.paused && target <= 0) return;
  smoothVolume(nightAir, target, durationMs, nightAirRaf);
  if (pauseAtZero && target <= 0) {
    setTimeout(() => {
      if (nightAir.volume <= 0.001) nightAir.pause();
    }, durationMs + 40);
  }
}

function fadeVoiceVolume(target, durationMs, done) {
  if (voiceFadeRaf) cancelAnimationFrame(voiceFadeRaf);
  const clamped = Math.max(0, Math.min(1, target));
  if (durationMs <= 0) {
    setVoiceVol(clamped);
    done?.();
    return;
  }
  const startVol = voiceLevel;
  const delta = clamped - startVol;
  const t0 = performance.now();
  const tick = (now) => {
    const p = smoothstep(Math.min(1, (now - t0) / durationMs));
    setVoiceVol(startVol + delta * p);
    if (p < 1) voiceFadeRaf = requestAnimationFrame(tick);
    else {
      voiceFadeRaf = null;
      done?.();
    }
  };
  voiceFadeRaf = requestAnimationFrame(tick);
}

function clearPostSpeechHold() {
  clearTimeout(postSpeechTimer);
  postSpeechTimer = null;
}

function enterMemoryBed(star) {
  if (state.finaleTriggered) return;
  memoryProfile = getMemoryProfile(star);
  unlockBgm();
  animateBgmVolume(memoryProfile.bgmMemory, memoryProfile.memoryEnterMs);
  animateNightAirVolume(memoryProfile.ambientMemory, memoryProfile.memoryEnterMs);
}

function duckBed(profile = memoryProfile) {
  if (state.finaleTriggered) return;
  const p = profile ?? getMemoryProfile(currentStar);
  memoryProfile = p;
  unlockBgm();
  animateBgmVolume(p.bgmDucked, p.bedDuckMs);
  animateNightAirVolume(p.ambientDucked, p.bedDuckMs);
}

function restoreBed(profile = memoryProfile, durationMs) {
  if (state.finaleTriggered) return;
  clearPostSpeechHold();
  const p = profile ?? getMemoryProfile(currentStar);
  const ms = durationMs ?? p.bedRestoreMs;
  if (bgm.paused) {
    bgm.play().then(() => { bgmStarted = true; }).catch(() => {});
  }
  if (nightAir.paused) {
    nightAir.play().catch(() => {});
  }
  animateBgmVolume(BGM_NORMAL, ms);
  animateNightAirVolume(AMBIENT_NORMAL, ms);
}

function leaveMemoryBed() {
  const p = memoryProfile ?? getMemoryProfile(currentStar);
  restoreBed(p, p.memoryLeaveMs);
}

function holdBedAfterSpeech(profile) {
  clearPostSpeechHold();
  animateBgmVolume(BGM_NORMAL * dbToGain(-2), 1200);
  animateNightAirVolume(AMBIENT_NORMAL * 0.85, 2000);
  postSpeechTimer = setTimeout(() => {
    restoreBed(profile, profile.bedRestoreMs);
  }, profile.postSpeechHoldMs);
}

function playStarChime() {
  if (!starChime) return;
  starChime.volume = 0.48;
  starChime.currentTime = 0;
  starChime.play().catch(() => {});
}

function fadeBgm(target = 0, durationMs = 1800) {
  animateBgmVolume(target, durationMs, { pauseAtZero: target <= 0 });
}

function fadeNightAir(target = 0, durationMs = 1800) {
  animateNightAirVolume(target, durationMs, { pauseAtZero: target <= 0 });
}

function handleVoiceFadeOut() {
  if (voiceAudio.paused || !voiceAudio.duration) return;
  const profile = memoryProfile ?? getMemoryProfile(currentStar);
  const tailSec = profile.voiceFadeOutMs / 1000;
  const remaining = voiceAudio.duration - voiceAudio.currentTime;
  if (remaining <= tailSec) {
    setVoiceVol(voiceTargetVolume * Math.max(0, remaining / tailSec));
  }
}

function finishVoicePlayback() {
  setVoicePlaying(false);
  voiceBar.style.width = "0%";
  const profile = memoryProfile ?? getMemoryProfile(currentStar);
  fadeVoiceVolume(0, profile.voiceFadeOutMs, () => {
    if (profile.postSpeechHoldMs > 0) {
      holdBedAfterSpeech(profile);
    } else {
      leaveMemoryBed();
    }
  });
  if (currentStar) showFullTranscript(currentStar);
}

function showSky() {
  intro.classList.remove("active");
  sky.classList.add("active");
  unlockBgm();
  if (dustCanvas._setActive) dustCanvas._setActive(true);
  requestAnimationFrame(() => {
    skyRect = sky.getBoundingClientRect();
    if (dustCanvas._resize) dustCanvas._resize();
    positionStars(state.morphing || sky.classList.contains("finale-map"));
    positionHelperStars();
    if (!sky.classList.contains("finale-map")) beginJourneyMode();
    else updateStarStates();
  });
}

function setupLangToggle() {
  $$(".lang-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".lang-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.lang = btn.dataset.lang;
      document.body.classList.remove("lang-en", "lang-ko");
      if (state.lang !== "both") document.body.classList.add(`lang-${state.lang}`);
      updateHud();
      updateStarStates();
    });
  });
}

function getTranscript(star) {
  if (!star?.voiceNote) return null;
  return state.transcripts[star.voiceNote] ?? null;
}

let gallerySyncIdx = -1;

const MEMORY_CARD_LAYOUTS = [
  [{ rot: -4, tx: 0, ty: 0, z: 1, delay: 0 }],
  [
    { rot: -8, tx: -16, ty: 6, z: 1, delay: 0 },
    { rot: 7, tx: 16, ty: -5, z: 2, delay: -1.4 },
  ],
  [
    { rot: -9, tx: -18, ty: 8, z: 1, delay: 0 },
    { rot: 3, tx: 2, ty: -8, z: 3, delay: -1.1 },
    { rot: 8, tx: 20, ty: 6, z: 2, delay: -2.2 },
  ],
  [
    { rot: -10, tx: -20, ty: 10, z: 1, delay: 0 },
    { rot: -3, tx: -6, ty: -10, z: 2, delay: -0.9 },
    { rot: 6, tx: 10, ty: 4, z: 3, delay: -1.8 },
    { rot: 11, tx: 22, ty: -6, z: 4, delay: -2.6 },
  ],
  [
    { rot: -11, tx: -22, ty: 12, z: 1, delay: 0 },
    { rot: -4, tx: -8, ty: -12, z: 2, delay: -0.8 },
    { rot: 2, tx: 4, ty: 2, z: 4, delay: -1.6 },
    { rot: 7, tx: 14, ty: -8, z: 3, delay: -2.3 },
    { rot: 10, tx: 24, ty: 8, z: 5, delay: -3.1 },
  ],
];

function memoryImagesFor(star) {
  const v = star?.visual;
  if (!v) return [];
  if (v.type === "photo" && v.src) return [v.src];
  if ((v.type === "memories" || v.type === "gallery") && v.images?.length) return v.images;
  return [];
}

function collectDriftPhotos() {
  const generated = state.photoMetadata?.visibleConstellation;
  if (generated?.length) {
    return generated.map((photo) => photo.src);
  }

  const urls = new Set(state.data.driftPhotos ?? []);
  for (const star of state.data.stars ?? []) {
    const v = star.visual;
    if (!v) continue;
    if (v.skyImage) urls.add(v.skyImage);
    if (v.type === "video" && v.poster) urls.add(v.poster);
    memoryImagesFor(star).forEach((src) => urls.add(src));
  }
  return [...urls];
}

function generatedPhotoEntries() {
  const generated = state.photoMetadata?.visibleConstellation;
  if (generated?.length) return generated;
  return collectDriftPhotos().map((src) => ({
    id: src,
    src,
    layer: "midground",
    chapterId: null,
    displayDate: null,
    displayTitle: "MEMORY",
    placement: null,
  }));
}

function collectAllAssets() {
  const images = new Set(collectDriftPhotos());
  const audio = new Set([
    "/assets/night-air.mp3",
    "/assets/star-chime.mp3",
    ...BGM_TRACKS,
  ]);
  const videos = new Set();

  for (const star of state.data.stars ?? []) {
    if (star.voiceNote) audio.add(star.voiceNote);
    memoryImagesFor(star).forEach((src) => images.add(src));
    const v = star.visual;
    if (!v) continue;
    if (v.type === "video" && v.src) videos.add(v.src);
    if (v.poster) images.add(v.poster);
    if (v.src && v.type !== "video") images.add(v.src);
  }

  return { images: [...images], audio: [...audio], videos: [...videos] };
}

function preloadImage(path) {
  const hit = assetCache.images.get(path);
  if (hit?.complete) return Promise.resolve(hit);

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      assetCache.images.set(path, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = assetUrl(path);
  });
}

function preloadAudioBlob(path) {
  if (voiceBlobCache.has(path)) return Promise.resolve(true);

  return fetch(assetUrl(path))
    .then((res) => {
      if (!res.ok) throw new Error("audio fetch failed");
      return res.blob();
    })
    .then((blob) => {
      voiceBlobCache.set(path, URL.createObjectURL(blob));
      return true;
    })
    .catch(() => false);
}

function preloadVideo(path) {
  if (videoBlobCache.has(path)) return Promise.resolve(true);

  return fetch(assetUrl(path))
    .then((res) => {
      if (!res.ok) throw new Error("video fetch failed");
      return res.blob();
    })
    .then((blob) => {
      videoBlobCache.set(path, URL.createObjectURL(blob));
      return true;
    })
    .catch(() => new Promise((resolve) => {
      const vid = document.createElement("video");
      const timer = setTimeout(() => resolve(false), 15000);
      vid.preload = "auto";
      vid.muted = true;
      vid.playsInline = true;
      vid.oncanplaythrough = () => {
        clearTimeout(timer);
        resolve(true);
      };
      vid.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      vid.src = assetUrl(path);
      vid.load();
    }));
}

function voiceSrc(path) {
  return voiceBlobCache.get(path) ?? assetUrl(path);
}

function videoSrc(path) {
  return videoBlobCache.get(path) ?? assetUrl(path);
}

function imageSrc(path) {
  const cached = assetCache.images.get(path);
  return cached?.src ?? assetUrl(path);
}

function driftImagesFromCache() {
  return generatedPhotoEntries()
    .map((meta) => ({ meta, img: assetCache.images.get(meta.src) }))
    .filter(({ img }) => img?.complete && img.naturalWidth > 0);
}

async function preloadAllAssets() {
  const { images, audio, videos } = collectAllAssets();
  const pathOrder = state.data.path ?? [];
  const priorityVoice = pathOrder
    .map((id) => state.data.stars.find((s) => s.id === id)?.voiceNote)
    .filter(Boolean);
  const otherAudio = audio.filter((p) => !priorityVoice.includes(p));
  const driftPhotos = collectDriftPhotos();
  const priorityImages = driftPhotos.slice(0, IS_MOBILE ? 12 : 18);

  await withTimeout(
    Promise.all([
      ...priorityImages.map((path) => preloadImage(path)),
      ...priorityVoice.map((path) => preloadAudioBlob(path)),
      ...otherAudio.slice(0, IS_MOBILE ? 2 : 4).map((path) => preloadAudioBlob(path)),
      ...videos.slice(0, 1).map((path) => preloadVideo(path)),
    ]),
    IS_MOBILE ? 20000 : 12000,
    "preload",
  ).catch((err) => {
    console.warn(err);
  });

  images
    .filter((path) => !priorityImages.includes(path))
    .slice(0, IS_MOBILE ? 8 : 8)
    .forEach((path) => preloadImage(path));
  otherAudio.slice(IS_MOBILE ? 2 : 4).forEach((path) => preloadAudioBlob(path));

  return driftImagesFromCache();
}

function renderFloatingMemories(visualEl, star) {
  const { ui } = state.data;
  const images = memoryImagesFor(star);
  if (!images.length) return;

  const wrap = document.createElement("div");
  wrap.className = "floating-memories";
  const layout = MEMORY_CARD_LAYOUTS[Math.min(images.length, MEMORY_CARD_LAYOUTS.length) - 1];

  images.forEach((src, i) => {
    const card = document.createElement("div");
    card.className = "memory-card";
    const pose = layout[i] ?? layout[layout.length - 1];
    card.style.setProperty("--rot", `${pose.rot}deg`);
    card.style.setProperty("--tx", `${pose.tx}%`);
    card.style.setProperty("--ty", `${pose.ty}%`);
    card.style.zIndex = String(pose.z);
    card.style.animationDelay = `${pose.delay}s`;

    const img = document.createElement("img");
    img.src = imageSrc(src);
    img.alt = star.title.en;
    img.loading = i === 0 ? "eager" : "lazy";
    img.onerror = () => { card.classList.add("missing"); };
    card.appendChild(img);
    wrap.appendChild(card);
  });

  wrap.addEventListener("error", () => {}, true);
  if (!wrap.querySelector("img")) {
    visualEl.innerHTML = `<div class="placeholder-frame"><span>Photo</span><span>${ui.placeholderImage.en}</span><span>${ui.placeholderImage.ko}</span></div>`;
    return;
  }

  visualEl.appendChild(wrap);
}

function resetSyncedGallery() {
  gallerySyncIdx = -1;
  const wrap = $(".modal-gallery-sync");
  if (!wrap) return;
  wrap.querySelectorAll("img").forEach((img) => img.classList.remove("active"));
}

function renderSyncedGallery(visualEl, star) {
  const images = star.visual.images ?? [];
  const wrap = document.createElement("div");
  wrap.className = "modal-gallery-sync";
  images.forEach((src, i) => {
    const img = document.createElement("img");
    img.src = imageSrc(src);
    img.alt = star.title.en;
    img.loading = i === 0 ? "eager" : "lazy";
    img.onerror = () => { img.style.display = "none"; };
    wrap.appendChild(img);
  });
  visualEl.appendChild(wrap);
  resetSyncedGallery();
}

function updateSyncedGallery(star, time) {
  if (star?.visual?.type !== "synced-gallery") return;
  const map = star.visual.segmentImages;
  if (!map || !Array.isArray(map)) return;
  const tr = getTranscript(star);
  if (!tr?.segments?.length) return;

  const segIdx = tr.segments.findIndex((s) => time >= s.start && time < s.end + 0.05);
  if (segIdx < 0) return;

  const imageIdx = map[segIdx];
  if (imageIdx === gallerySyncIdx) return;

  const wrap = $(".modal-gallery-sync");
  if (!wrap) return;

  wrap.querySelectorAll("img").forEach((img, i) => {
    img.classList.toggle("active", imageIdx != null && i === imageIdx);
  });
  gallerySyncIdx = imageIdx ?? -1;
}

function resetVoiceCaption() {
  const cap = $(".voice-caption");
  cap.textContent = "";
  cap.classList.add("hidden");
  cap.classList.remove("active");
  resetSyncedGallery();
}

function updateVoiceCaption() {
  const cap = $(".voice-caption");
  const tr = currentStar && getTranscript(currentStar);
  if (!tr?.segments?.length || voiceAudio.paused) return;

  const t = voiceAudio.currentTime;
  updateSyncedGallery(currentStar, t);

  const seg = tr.segments.find((s) => t >= s.start && t < s.end + 0.05);
  if (!seg) return;

  cap.classList.remove("hidden");
  if (cap.textContent !== seg.text) {
    cap.classList.remove("active");
    void cap.offsetWidth;
    cap.textContent = seg.text;
    cap.classList.add("active");
  }
}

function showFullTranscript(star) {
  const tr = getTranscript(star);
  if (!tr?.full) return;

  const inner = $(".modal-inner");
  inner.classList.remove("typing-modal");
  inner.classList.add("text-revealed");
  resetVoiceCaption();

  if (tr.language === "ko") {
    $(".modal-text-ko").textContent = tr.full;
    $(".modal-text-en").textContent = star.content?.en ?? "";
  } else {
    $(".modal-text-en").textContent = tr.full;
    $(".modal-text-ko").textContent = star.content?.ko ?? "";
  }
}

function stopJourneyCruise() {
  stopSkyCamera();
}

function startJourneyCruise() {
  stopSkyCamera();
  if (!sky.classList.contains("sky-journey") || sky.classList.contains("memory-revealed")) return;

  cam.phase = "cruise";
  cam.cruiseStart = performance.now();
  cam.cruiseBaseZ = cam.flyZ;
  cam.originX = 50;
  cam.originY = 50;
  camLastTick = 0;
  sky.classList.add("journey-cruising");
  startSkyCamera();
}

function journeyStarPos(star) {
  const base = star.narrativePos;
  if (!sky.classList.contains("sky-journey") || sky.classList.contains("finale-map")) {
    return base;
  }

  const expected = expectedStarId();
  if (star.id === expected && !sky.classList.contains("memory-revealed")) {
    const pull = 0.03 + state.journeyCruise * 0.1;
    return [
      base[0] + (0.5 - base[0]) * pull,
      base[1] + (0.5 - base[1]) * pull,
    ];
  }

  return base;
}

function lastStarId() {
  return state.data.path[state.data.path.length - 1];
}

function getStar(id) {
  return state.data.stars.find((s) => s.id === id);
}

function getFinaleSegments() {
  return state.data.finaleSegments ?? state.data.path.slice(1).map((id, i) => [state.data.path[i], id]);
}

function renderStars() {
  starsLayer.innerHTML = "";
  starEls = {};

  state.data.stars.forEach((star, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `star-btn ${star.visualStyle}`;
    btn.dataset.id = star.id;
    btn.setAttribute("aria-label", `${index + 1}. ${star.title.en}`);
    btn.style.setProperty("--star-depth", `${(index % 5) * 12}px`);

    const finderRing = document.createElement("span");
    finderRing.className = "finder-ring";
    btn.appendChild(finderRing);

    const chapterIdx = state.data.path.indexOf(star.id);
    const number = document.createElement("span");
    number.className = "star-number";
    number.textContent = chapterIdx >= 0 ? String(chapterIdx + 1).padStart(2, "0") : "--";
    btn.appendChild(number);

    const label = document.createElement("span");
    label.className = "star-label";
    label.textContent = state.lang === "ko" ? star.title.ko : star.title.en;
    btn.appendChild(label);

    btn.addEventListener("pointerdown", (event) => {
      if (event.button && event.button !== 0) return;
      event.preventDefault();
      onStarClick(star.id);
    });
    btn.addEventListener("click", () => onStarClick(star.id));
    starsLayer.appendChild(btn);
    starEls[star.id] = btn;
  });

  positionStars(false);
  renderChapterRail();
}

function renderChapterRail() {
  if (!chapterRail) return;
  chapterRail.innerHTML = "";
  state.data.path.forEach((id, index) => {
    const star = getStar(id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chapter-dot";
    btn.dataset.id = id;
    btn.setAttribute("aria-label", `Chapter ${index + 1}: ${star.title.en}`);

    const number = document.createElement("span");
    number.className = "chapter-dot-number";
    number.textContent = String(index + 1);
    btn.appendChild(number);

    const label = document.createElement("span");
    label.className = "chapter-dot-label";
    label.textContent = star.title.en;
    btn.appendChild(label);

    btn.addEventListener("pointerdown", (event) => {
      if (event.button && event.button !== 0) return;
      event.preventDefault();
      onStarClick(id);
    });
    btn.addEventListener("click", () => onStarClick(id));
    chapterRail.appendChild(btn);
  });
  updateChapterRail();
}

function updateChapterRail() {
  if (!chapterRail) return;
  const expected = expectedStarId();
  chapterRail.querySelectorAll(".chapter-dot").forEach((btn) => {
    const id = btn.dataset.id;
    const viewed = state.viewed.has(id);
    const active = id === expected && !state.morphing;
    const enabled = sky.classList.contains("finale-map") ? viewed : viewed || active;
    btn.classList.toggle("viewed", viewed);
    btn.classList.toggle("next", active);
    btn.disabled = !enabled;
    btn.setAttribute("aria-disabled", String(!enabled));
  });
}

function renderHelperStars() {
  helperEls = {};
  (state.data.helperStars ?? []).forEach((helper) => {
    const dot = document.createElement("span");
    dot.className = "helper-star";
    dot.dataset.id = helper.id;
    starsLayer.appendChild(dot);
    helperEls[helper.id] = dot;
  });
  positionHelperStars();
}

function renderAmbientStars() {
  ambientEls.forEach(({ el }) => el.remove());
  ambientEls = [];
  (state.data.ambientStars ?? []).forEach((pos, i) => {
    const dot = document.createElement("span");
    dot.className = "ambient-star";
    dot.setAttribute("aria-hidden", "true");
    dot.style.setProperty("--twinkle-delay", `${(i % 8) * 0.4}s`);
    starsLayer.appendChild(dot);
    ambientEls.push({ el: dot, pos });
  });
  positionAmbientStars();
}

function positionAmbientStars() {
  ambientEls.forEach(({ el, pos }) => {
    const p = layoutPos(pos, "finale");
    el.style.left = `${p[0] * 100}%`;
    el.style.top = `${p[1] * 100}%`;
  });
}

function layoutPos(pos, kind = "narrative") {
  if (!pos) return pos;
  const anchorX = 0.5;
  const anchorY = 0.46;

  if (kind === "narrative") {
    const spread = 1.24;
    return [
      anchorX + (pos[0] - anchorX) * spread,
      anchorY + (pos[1] - anchorY) * spread,
    ];
  }

  // Finale positions are pre-laid for 채영 — avoid over-shrinking into a knot
  const scale = 0.94;
  return [
    anchorX + (pos[0] - anchorX) * scale,
    anchorY + (pos[1] - anchorY) * scale,
  ];
}

function positionStars(useFinale) {
  skyRect = sky.getBoundingClientRect();
  state.data.stars.forEach((star) => {
    const el = starEls[star.id];
    if (!el) return;
    const raw = useFinale ? star.finalePos : journeyStarPos(star);
    const pos = layoutPos(raw, useFinale ? "finale" : "narrative");
    el.style.left = `${pos[0] * 100}%`;
    el.style.top = `${pos[1] * 100}%`;
  });
  redrawLines();
}

function positionHelperStars() {
  (state.data.helperStars ?? []).forEach((helper) => {
    const el = helperEls[helper.id];
    if (!el) return;
    const pos = layoutPos(helper.pos, "finale");
    el.style.left = `${pos[0] * 100}%`;
    el.style.top = `${pos[1] * 100}%`;
  });
  positionAmbientStars();
}

function updateHud() {
  const n = Math.min(state.pathIndex, state.data.path.length);
  const { progress } = state.data.ui;
  $(".progress-text").innerHTML = `${progress.en.replace("{n}", n)}<br>${progress.ko.replace("{n}", n)}`;
}

function expectedStarId() {
  return state.data.path.find((id) => !state.viewed.has(id));
}

function updateStarStates() {
  const expected = expectedStarId();
  const finale = sky.classList.contains("finale-map");

  Object.entries(starEls).forEach(([id, el]) => {
    el.classList.remove("next", "wrong", "locked", "journey-current", "finale-tappable");
    const viewed = state.viewed.has(id);
    const active = id === expected && !state.morphing;
    el.classList.toggle("viewed", viewed);
    const star = getStar(id);
    const label = el.querySelector(".star-label");
    if (label) label.textContent = state.lang === "ko" ? star.title.ko : star.title.en;

    if (finale) {
      el.classList.toggle("finale-tappable", viewed);
      el.disabled = !viewed;
      el.setAttribute("aria-disabled", String(!viewed));
      return;
    }

    el.classList.toggle("next", active);
    el.classList.toggle("journey-current", active);
    el.classList.toggle("locked", !viewed && !active);
    el.disabled = !viewed && !active;
    el.setAttribute("aria-disabled", String(el.disabled));
    if (id === lastStarId()) {
      el.classList.toggle("unlocked", state.pathIndex >= state.data.path.length - 1 || viewed);
    }

  });

  if (finale) {
    showHint(state.data.ui.finaleTapHint);
  } else if (expected === lastStarId() && state.pathIndex === state.data.path.length - 1) {
    showHint(state.data.ui.starFinalUnlock);
  } else {
    hideHint();
  }

  updateHud();
  updateChapterRail();
}

function showHint(textObj) {
  hint.classList.remove("hidden");
  hint.innerHTML = `${textObj.en}<br><span>${textObj.ko}</span>`;
  hint.style.animation = "none";
  void hint.offsetHeight;
  hint.style.animation = "";
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideHint, 9000);
}

function hideHint() {
  hint.classList.add("hidden");
}

function onStarClick(id) {
  if (state.morphing || sky.classList.contains("memory-revealed")) return;
  const star = getStar(id);
  if (!star) return;

  if (sky.classList.contains("finale-map")) {
    if (!state.viewed.has(id)) return;
    unlockBgm();
    playStarChime();
    openModal(star, true);
    return;
  }

  const firstDiscovery = !state.viewed.has(id);
  const expected = expectedStarId();
  if (firstDiscovery && id !== expected) {
    const el = starEls[id];
    el?.classList.add("wrong");
    setTimeout(() => el?.classList.remove("wrong"), 450);
    showHint(state.data.ui.wrongOrder);
    return;
  }

  unlockBgm();
  playStarChime();
  hideHint();
  if (firstDiscovery) currentPendingDiscoveryId = id;
  openModal(star, true);
}

function activateStrokeNode(id) {
  helperEls[id]?.classList.add("active");
  starEls[id]?.classList.add("in-constellation");
}

function drawChapterStrokes(starId, animated = true) {
  const strokes = state.data.chapterStrokes?.[starId];
  if (!strokes?.length) return;

  strokes.forEach(([from, to]) => {
    const key = `${from}-${to}`;
    const rev = `${to}-${from}`;
    if (state.lines.some((line) => `${line.from}-${line.to}` === key || `${line.from}-${line.to}` === rev)) {
      return;
    }
    state.lines.push({ from, to, style: "trail" });
    activateStrokeNode(from);
    activateStrokeNode(to);
    if (animated) animateLine(from, to, "trail");
  });
}

function drawLine(fromId, toId, style = "trail") {
  if (!state.lines.some((line) => line.from === fromId && line.to === toId)) {
    state.lines.push({ from: fromId, to: toId, style });
    saveProgress();
  }
  animateLine(fromId, toId, style);
}

function getPoint(id) {
  const star = getStar(id);
  if (star) return getStarCenter(id);

  const helper = (state.data.helperStars ?? []).find((h) => h.id === id);
  if (!helper || !skyRect) return { x: 0, y: 0 };
  const pos = layoutPos(helper.pos, "finale");
  return {
    x: pos[0] * skyRect.width,
    y: pos[1] * skyRect.height,
  };
}

function getStarCenter(id) {
  const el = starEls[id] ?? helperEls[id];
  if (!el || !skyRect) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return {
    x: r.left + r.width / 2 - skyRect.left,
    y: r.top + r.height / 2 - skyRect.top,
  };
}

function makeLine(from, to, style = "normal") {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", from.x);
  line.setAttribute("y1", from.y);
  line.setAttribute("x2", to.x);
  line.setAttribute("y2", to.y);
  line.setAttribute("stroke-linecap", "round");
  line.classList.add("constellation-line", style);
  return line;
}

function animateLine(fromId, toId, style = "trail") {
  const from = getPoint(fromId);
  const to = getPoint(toId);
  const line = makeLine(from, from, style);
  linesLayer.appendChild(line);

  const duration = style === "guide" ? 900 : 680;
  const start = performance.now();

  function frame(now) {
    const progress = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    line.setAttribute("x2", from.x + (to.x - from.x) * ease);
    line.setAttribute("y2", from.y + (to.y - from.y) * ease);
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function redrawLines() {
  linesLayer.innerHTML = "";
  state.lines.forEach(({ from, to, style }) => {
    linesLayer.appendChild(makeLine(getPoint(from), getPoint(to), style));
  });

  if (sky.classList.contains("finale-map") && state.data.showFinaleGuides) drawGuideLines(false);
}

function restoreLines() {
  state.lines.forEach(({ from, to }) => {
    activateStrokeNode(from);
    activateStrokeNode(to);
  });
  redrawLines();
}

function setupModal() {
  $(".modal-close").addEventListener("click", closeModal);
  $(".modal-done").addEventListener("click", closeModal);
  memoryReveal.addEventListener("click", (e) => {
    if (e.target === memoryReveal || e.target.classList.contains("memory-vignette")) closeModal();
  });

  setVoiceVol(0);

  voiceAudio.addEventListener("play", () => {
    setVoicePlaying(true);
    duckBed();
  });
  voiceAudio.addEventListener("pause", () => {
    setVoicePlaying(false);
    if (suppressVoicePauseMix || voiceAudio.ended) return;
    leaveMemoryBed();
  });
  voiceAudio.addEventListener("timeupdate", () => {
    if (voiceAudio.duration) {
      voiceBar.style.width = `${(voiceAudio.currentTime / voiceAudio.duration) * 100}%`;
    }
    handleVoiceFadeOut();
    updateVoiceCaption();
  });

  voiceAudio.addEventListener("ended", () => {
    finishVoicePlayback();
  });

  voiceAudio.addEventListener("error", () => {
    $(".voice-missing").classList.remove("hidden");
    voiceStatus.classList.add("missing");
  });

  voiceStatus.addEventListener("click", () => {
    if (!voiceAudio.paused && !voiceAudio.ended) return;
    playVoice();
  });
}

function prepareMemoryContent(star) {
  const { ui } = state.data;

  $(".modal-date").textContent = star.date || "";
  $(".modal-title-en").textContent = "";
  $(".modal-title-ko").textContent = "";
  $(".voice-label-en").textContent = "Voice note";
  $(".voice-label-ko").textContent = "음성 메시지";
  $(".voice-missing").classList.add("hidden");
  $(".modal-inner").classList.remove("text-revealed", "modal-featured");
  if (star.featured) $(".modal-inner").classList.add("modal-featured");
  voiceStatus.classList.remove("missing");
  setVoicePlaying(false);
  voiceBar.style.width = "0%";
  resetVoiceCaption();

  voiceAudio.pause();
  voiceAudio.currentTime = 0;
  voiceAudio.src = voiceSrc(star.voiceNote);
  voiceAudio.load();

  const missingEl = $(".voice-missing");
  const fileName = star.voiceNote.split("/").pop();
  missingEl.textContent = `${ui.voicePlaceholder.en.replace("{file}", fileName)} · ${ui.voicePlaceholder.ko.replace("{file}", fileName)}`;

  renderModalVisual(star);
  renderModalText(star, star.visual?.type === "video");
}

function beginMemoryDive(star, onRevealed) {
  ensureAudioReactive();
  stopSkyCamera();

  const { ox, oy } = starScreenPercent(star.id);
  const targetFlyZ = prefersReducedMotion ? 0 : IS_MOBILE ? 18 : 22;
  const targetPushZ = prefersReducedMotion ? 0 : IS_MOBILE ? 230 : 280;
  const diveMs = prefersReducedMotion ? 220 : DIVE_MS;
  sky.style.setProperty("--flight-origin-x", `${ox}%`);
  sky.style.setProperty("--flight-origin-y", `${oy}%`);

  cam.diveFrom = {
    flyZ: 0,
    pushZ: 0,
    ox,
    oy,
    cruise: 0,
  };
  cam.diveTo = { flyZ: targetFlyZ, pushZ: targetPushZ, ox, oy, cruise: prefersReducedMotion ? 0 : 0.18 };
  cam.phase = "dive";
  cam.diveStart = performance.now();
  cam.diveDur = diveMs;

  focusedStarId = star.id;
  state.morphing = true;
  starEls[star.id]?.classList.add("memory-focus");
  document.body.classList.add("modal-open");
  sky.classList.add("sky-journey");
  startSkyCamera();

  clearTimeout(memoryDiveTimer);
  requestAnimationFrame(() => {
    sky.classList.add("memory-dive");
  });

  memoryDiveTimer = setTimeout(() => {
    sky.classList.add("memory-revealed");
    memoryReveal.setAttribute("aria-hidden", "false");
    onRevealed?.();
  }, diveMs);
}

function endMemoryDive(onDone) {
  sky.classList.remove("memory-revealed");
  memoryReveal.setAttribute("aria-hidden", "true");

  clearTimeout(memoryDiveTimer);
  if (focusedStarId) starEls[focusedStarId]?.classList.remove("memory-focus");
  focusedStarId = null;
  state.morphing = false;
  document.body.classList.remove("modal-open");
  sky.classList.remove("memory-dive", "sky-journey", "journey-cruising");
  resetSkyCamera();
  updateStarStates();
  onDone?.();
}

function openModal(star, autoplay = false) {
  if (sky.classList.contains("memory-revealed")) return;
  currentStar = star;
  clearPostSpeechHold();
  enterMemoryBed(star);
  prepareMemoryContent(star);
  if (autoplay) playVoice();
  beginMemoryDive(star, () => {
    if (autoplay && voiceAudio.paused && !voiceAudio.error) playVoice();
  });

  const inner = $(".modal-inner");
  inner.classList.add("modal-pulse");
  setTimeout(() => inner.classList.remove("modal-pulse"), 600);

}

function renderModalVisual(star) {
  const { ui } = state.data;
  const visualEl = $(".modal-visual");
  visualEl.innerHTML = "";
  visualEl.classList.remove("no-frame");
  if (!star.visual) return;

  if (star.visual.type === "photo" || star.visual.type === "memories" || star.visual.type === "gallery") {
    renderFloatingMemories(visualEl, star);
    return;
  }

  if (star.visual.type === "synced-gallery") {
    renderSyncedGallery(visualEl, star);
    return;
  }

  if (star.visual.type === "video") {
    visualEl.classList.add("no-frame");
    const vid = document.createElement("video");
    vid.src = videoSrc(star.visual.src);
    if (star.visual.poster) {
      vid.poster = imageSrc(star.visual.poster);
    }
    vid.preload = "auto";
    vid.controls = true;
    vid.muted = true;
    vid.autoplay = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    vid.setAttribute("x5-video-player-type", "h5");
    vid.setAttribute("x5-video-orientation", "portrait");
    vid.onerror = () => {
      visualEl.innerHTML = `<div class="placeholder-frame"><span>Video</span><span>${ui.placeholderImage.en}</span><span>${ui.placeholderImage.ko}</span></div>`;
    };
    visualEl.appendChild(vid);
    vid.play().catch(() => {});
  }
}

function renderModalText(star, isVideo = false) {
  clearTypewriter();

  const titleEl = $(".modal-title-en");
  const bodyEnEl = $(".modal-text-en");
  const visualEl = $(".modal-visual");
  const inner = $(".modal-inner");
  const transcript = getTranscript(star);
  const useTranscript = Boolean(transcript?.segments?.length);

  inner.classList.add("typing-modal");
  inner.classList.remove("text-revealed", "has-transcript");
  if (useTranscript) inner.classList.add("has-transcript");
  titleEl.textContent = "";
  bodyEnEl.textContent = "";
  $(".modal-text-ko").textContent = "";
  resetVoiceCaption();

  /* reset visual opacity in case previous modal left it */
  if (visualEl) { visualEl.style.opacity = ""; visualEl.style.transition = ""; }

  const titleText = star.title.en;
  const headlineText = star.headline?.en ?? "";
  const headlineKoText = star.headline?.ko ?? "";
  const bodyText = star.content?.en ?? "";
  const bodyKoText = star.content?.ko ?? "";

  if (!titleText && !headlineText && !bodyText && !bodyKoText && !useTranscript) { return; }

  function finishTyping() {
    clearTypewriter();
    inner.classList.remove("typing-modal");
    if (!useTranscript) {
      inner.classList.add("text-revealed");
      titleEl.textContent = titleText;
      $(".modal-title-ko").textContent = star.title.ko;
      bodyEnEl.textContent = [headlineText, bodyText].filter(Boolean).join("\n\n");
      $(".modal-text-ko").textContent = [headlineKoText, bodyKoText].filter(Boolean).join("\n\n");
    } else {
      titleEl.textContent = titleText;
      $(".modal-title-ko").textContent = star.title.ko;
      if (headlineText) bodyEnEl.textContent = headlineText;
      if (headlineKoText) $(".modal-text-ko").textContent = headlineKoText;
    }
  }

  function typeBody() {
    if (useTranscript) {
      finishTyping();
      return;
    }
    const enFull = [headlineText, bodyText].filter(Boolean).join("\n\n");
    const koFull = [headlineKoText, bodyKoText].filter(Boolean).join("\n\n");
    if (enFull) {
      typeText(bodyEnEl, enFull, 40, () => {
        typeText($(".modal-text-ko"), koFull, 35, finishTyping);
      });
    } else if (koFull) {
      typeText($(".modal-text-ko"), koFull, 35, finishTyping);
    } else {
      finishTyping();
    }
  }

  function afterTitle() {
    $(".modal-title-ko").textContent = star.title.ko;
    if (isVideo && visualEl) {
      setTimeout(() => {
        visualEl.style.opacity = "1";
        setTimeout(typeBody, 500);
      }, 300);
    } else {
      setTimeout(typeBody, 300);
    }
  }

  if (isVideo && visualEl) {
    visualEl.style.opacity = "0";
    visualEl.style.transition = "opacity 0.55s ease";
  }

  if (titleText) {
    typeText(titleEl, titleText, 60, afterTitle);
  } else {
    afterTitle();
  }
}

function setVoicePlaying(isPlaying) {
  voiceStatus.classList.toggle("playing", isPlaying);
  $(".voice-label-en").textContent = isPlaying ? "Listening..." : "Voice note";
  $(".voice-label-ko").textContent = isPlaying ? "듣는 중..." : "음성 메시지";
}

function playVoice() {
  if (!voiceAudio.src) {
    $(".voice-missing").classList.remove("hidden");
    return;
  }

  $(".voice-missing").classList.add("hidden");
  voiceStatus.classList.remove("missing");

  const profile = memoryProfile ?? getMemoryProfile(currentStar);
  memoryProfile = profile;
  voiceTargetVolume = profile.voiceVolume;
  setVoiceVol(0);
  unlockBgm();

  if (voiceAudio.error) {
    $(".voice-missing").classList.remove("hidden");
    voiceStatus.classList.add("missing");
    return;
  }

  try {
    voiceAudio.currentTime = 0;
  } catch {
    /* Some mobile browsers only allow seeking after metadata is ready. */
  }

  duckBed(profile);
  setVoiceVol(0);
  voiceAudio.play().then(() => {
    fadeVoiceVolume(voiceTargetVolume, profile.voiceFadeInMs);
    setVoicePlaying(true);
  }).catch(() => {
    setVoicePlaying(false);
    $(".voice-label-en").textContent = "Tap to play voice";
    $(".voice-label-ko").textContent = "음성을 들으려면 터치";
  });
}

function closeModal() {
  clearPostSpeechHold();
  const profile = memoryProfile ?? getMemoryProfile(currentStar);
  const pendingId = currentPendingDiscoveryId;
  currentPendingDiscoveryId = null;
  suppressVoicePauseMix = true;
  voiceAudio.pause();
  fadeVoiceVolume(0, Math.min(500, profile.voiceFadeOutMs), () => {
    leaveMemoryBed();
    suppressVoicePauseMix = false;
  });
  clearTypewriter();

  currentStar = null;

  endMemoryDive(() => {
    journeyAdvanceLock = false;
    let completedId = null;
    if (pendingId && !state.viewed.has(pendingId)) {
      completedId = pendingId;
      state.viewed.add(pendingId);
      state.pathIndex = state.viewed.size;
      drawChapterStrokes(pendingId);
      saveProgress();
      updateStarStates();
    }

    const shouldReveal =
      completedId === lastStarId() &&
      state.viewed.size === state.data.path.length;

    if (shouldReveal) {
      triggerFinale();
      return;
    }
    if (!sky.classList.contains("finale-map") && expectedStarId()) {
      showHint(state.data.ui.scrollHint);
    }
  });
}

async function triggerFinale(skipAnimation = false) {
  if (state.finaleTriggered && !skipAnimation) return;
  state.finaleTriggered = true;
  state.morphing = true;
  saveProgress();

  hideHint();
  unlockBgm();
  animateBgmVolume(BGM_NORMAL * 0.82, skipAnimation ? 0 : 1600);
  animateNightAirVolume(AMBIENT_NORMAL * 0.9, skipAnimation ? 0 : 1800);

  stopJourneyCruise();
  sky.classList.remove("memory-revealed");
  sky.classList.remove("memory-dive", "sky-journey");
  resetSkyCamera();

  const shapeEl = $(".finale-shape");
  shapeEl.classList.remove("name-revealed");
  finale.classList.remove("active");

  sky.classList.add("morphing");
  await sleep(skipAnimation ? 0 : 450);

  positionStars(true);
  positionHelperStars();
  await sleep(skipAnimation ? 0 : 1900);

  state.lines = getFinaleSegments().map(([from, to]) => ({ from, to, style: "finale" }));
  sky.classList.add("finale-map");
  redrawLines();
  await sleep(skipAnimation ? 0 : 650);

  const { message, shape, shapeLatin } = state.data.finale;
  shapeEl.textContent = shape;
  shapeEl.setAttribute("aria-label", shapeLatin ? `${shape} · ${shapeLatin}` : shape);
  $(".finale-text-en").textContent = message.en;
  $(".finale-text-ko").textContent = message.ko;
  finale.classList.add("active");
  sky.classList.remove("morphing");
  sky.classList.add("finale-zoomed");
  state.morphing = false;
  saveProgress();

  await sleep(skipAnimation ? 0 : 400);
  shapeEl.classList.add("name-revealed");
  updateStarStates();
}

async function drawGuideLines(animated) {
  const segments = state.data.guideSegments ?? [];
  const existing = [...linesLayer.querySelectorAll(".guide")];
  existing.forEach((line) => line.remove());

  if (!animated) {
    segments.forEach(([fromId, toId]) => {
      linesLayer.appendChild(makeLine(getPoint(fromId), getPoint(toId), "guide"));
    });
    return;
  }

  for (const [fromId, toId] of segments) {
    animateLine(fromId, toId, "guide");
    await sleep(65);
  }
}

function setupDust(driftImages = []) {
  const ctx = dustCanvas.getContext("2d", { alpha: true, desynchronized: !IS_MOBILE });
  const photoCtx = photoCanvas?.getContext("2d", { alpha: true, desynchronized: !IS_MOBILE });
  const lowPower = IS_LOW_POWER;
  const useDomPhotos = !!photoDomHost;
  const useCanvasPhotos = !useDomPhotos && !!photoCtx;
  const usePhotos = driftImages.length > 0 && (useDomPhotos || useCanvasPhotos);
  const starCount = lowPower ? (IS_MOBILE ? 680 : 1100) : IS_MOBILE ? 920 : 1500;
  const maxPhotoSources = IS_MOBILE ? 12 : 18;
  const memoryCount = usePhotos ? Math.min(driftImages.length, maxPhotoSources) : 0;
  let memorySources = [];
  const pointer = { x: 0, y: 0 };
  let dustActive = false;
  let sortTick = 0;
  let photoSortTick = 0;
  let pointerQueued = false;
  let drawTick = 0;
  let lastFrameMs = 0;
  const sortEvery = lowPower ? 16 : 10;
  const skipGlow = lowPower;
  const starDpr = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 1.25);
  const photoDpr = IS_MOBILE ? 1 : Math.min(window.devicePixelRatio || 1, 1.15);
  const domNodes = [];

  function refreshMemorySources() {
    memorySources = driftImages
      .filter(({ img }) => img?.complete && img.naturalWidth > 0)
      .slice(0, maxPhotoSources);
    return memorySources.length > 0;
  }

  refreshMemorySources();
  driftImages.forEach(({ img }) => {
    if (!img || img.complete) return;
    img.addEventListener("load", refreshMemorySources, { once: true });
  });

  if (useDomPhotos) {
    photoCanvas.style.display = "none";
    for (let i = 0; i < memoryCount; i += 1) {
      const el = document.createElement("div");
      el.className = "photo-drift-item";
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.loading = "lazy";
      img.draggable = false;
      const label = document.createElement("span");
      label.className = "photo-drift-label";
      el.append(img, label);
      el.style.opacity = "0";
      photoDomHost.appendChild(el);
      domNodes.push(el);
    }
  }

  function makeSpaceStar() {
    const roll = Math.random();
    const warm = roll > 0.9;
    const purple = !warm && roll > 0.72;
    const blue = !warm && !purple && roll > 0.42;
    const radius = Math.pow(Math.random(), 0.62) * 1.15;
    const arm = Math.random() * Math.PI * 2;
    const spiral = arm + radius * 3.1;
    const diskX = Math.cos(spiral) * radius * 0.92;
    const diskY = Math.sin(spiral) * radius * 0.58;
    const hue = warm
      ? "255, 214, 168"
      : purple
        ? "176, 132, 255"
        : blue
          ? "148, 188, 255"
          : "236, 242, 255";
    return {
      kind: "star",
      x: diskX + (Math.random() - 0.5) * 0.08,
      y: diskY + (Math.random() - 0.5) * 0.06,
      z: Math.random() * 0.94 + 0.06,
      hue,
      mag: Math.random(),
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 0.0011 + 0.00014,
      twinkleDepth: Math.random() * 0.28 + 0.04,
    };
  }

  function journeyFlying() {
    return cam.phase !== "idle" && !sky.classList.contains("memory-revealed");
  }

  function memoryDriftSpeed() {
    return PARTICLE_BASE_SPEED * getParticleFlyRate();
  }

  function starDriftSpeed() {
    return PARTICLE_BASE_SPEED * 0.94 * getParticleFlyRate();
  }

  function respawnMemory(mem, depth = "far") {
    const fresh = makeMemoryParticle(mem.imgIndex, mem.source);
    Object.assign(mem, fresh);
    if (depth === "near-mid") mem.z = 0.2 + Math.random() * 0.22;
    else if (depth === "mid") mem.z = 0.38 + Math.random() * 0.36;
    else if (depth === "lane") mem.z = 0.58 + Math.random() * 0.24;
    else mem.z = 0.8 + Math.random() * 0.18;
  }

  function replenishMemories() {
    if (!journeyFlying()) return;

    let inBand = 0;
    for (let i = 0; i < memories.length; i += 1) {
      const z = memories[i].z;
      if (z > 0.16 && z < 0.82) inBand += 1;
    }

    const target = IS_MOBILE ? Math.min(20, memoryCount) : Math.min(36, memoryCount);
    if (inBand >= target) return;

    for (let i = 0; i < memories.length && inBand < target; i += 1) {
      const z = memories[i].z;
      if (z <= 0.14 || z >= 0.84) {
        const roll = Math.random();
        respawnMemory(memories[i], roll > 0.55 ? "mid" : roll > 0.2 ? "lane" : "near-mid");
        inBand += 1;
      }
    }
  }

  function activeChapterId() {
    return currentStar?.id ?? expectedStarId();
  }

  function memorySizeAlpha(z, layer, related) {
    const t = 1 - z;
    const mobileBoost = IS_MOBILE ? 1.05 : 1;
    const layerScale = layer === "foreground" ? 1.28 : layer === "midground" ? 0.92 : 0.58;
    const layerAlpha = layer === "foreground" ? 0.94 : layer === "midground" ? 0.58 : 0.24;
    const h = (24 + t * 40 + t * t * 44) * mobileBoost * layerScale * (related ? 1.12 : 1);
    const alpha = Math.min(0.98, layerAlpha * (0.72 + t * 0.28) * (related ? 1.22 : 0.86));
    const blur = layer === "background" ? 0.9 : layer === "midground" ? 0.35 : 0;
    const saturate = layer === "foreground" || related ? 1 : layer === "midground" ? 0.82 : 0.62;
    return { h, alpha, t, blur, saturate };
  }

  function makeMemoryParticle(index = 0, source = memorySources[index % Math.max(1, memorySources.length)]) {
    if (!memorySources.length) refreshMemorySources();
    const meta = source?.meta ?? {};
    const placement = meta.placement ?? {};
    const particle = {
      kind: "memory",
      source,
      x: placement.x ?? (Math.random() * 1.02 - 0.51),
      y: placement.y ?? (Math.random() * 0.8 - 0.4),
      z: placement.z ?? (Math.random() * 0.38 + 0.34),
      imgIndex: memorySources.length ? index % memorySources.length : 0,
      layer: meta.layer ?? "midground",
      chapterId: meta.chapterId ?? null,
      rot: placement.rotation ?? (Math.random() * 0.42 - 0.21),
      rotSpeed: (Math.random() - 0.5) * 0.00005,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: Math.random() * 0.006 + 0.002,
    };
    if (journeyFlying() && Math.random() > 0.28) {
      particle.z = 0.34 + Math.random() * 0.48;
    }
    return particle;
  }

  const stars = Array.from({ length: starCount }, makeSpaceStar);
  const memories = Array.from({ length: memoryCount }, (_, i) => makeMemoryParticle(i));

  function resize() {
    const w = sky.clientWidth;
    const h = sky.clientHeight;
    dustCanvas.width = Math.max(1, Math.floor(w * starDpr));
    dustCanvas.height = Math.max(1, Math.floor(h * starDpr));
    dustCanvas.style.width = `${w}px`;
    dustCanvas.style.height = `${h}px`;
    ctx.setTransform(starDpr, 0, 0, starDpr, 0, 0);

    if (photoCanvas && photoCtx) {
      photoCanvas.width = Math.max(1, Math.floor(w * photoDpr));
      photoCanvas.height = Math.max(1, Math.floor(h * photoDpr));
      photoCanvas.style.width = `${w}px`;
      photoCanvas.style.height = `${h}px`;
      photoCtx.setTransform(photoDpr, 0, 0, photoDpr, 0, 0);
    }
  }

  function advanceStar(star, width, height, freezeDrift, dt) {
    const audioPush = 1 + audioReactive.level * (freezeDrift ? 0.35 : 0.18);
    if (!freezeDrift) {
      star.z -= starDriftSpeed() * dt * audioPush;
      star.twinkle += (0.004 + star.twinkleSpeed * 8) * audioPush;
      if (star.z <= 0.04) Object.assign(star, makeSpaceStar(), { z: 1 });
    }

    const depth = 1 / star.z;
    const x = width / 2 + star.x * width * 0.42 * depth + pointer.x * depth * 7;
    const y = height / 2 + star.y * height * 0.42 * depth + pointer.y * depth * 5;

    if (x < -30 || x > width + 30 || y < -30 || y > height + 30) {
      if (!freezeDrift) Object.assign(star, makeSpaceStar(), { z: 1 });
      return null;
    }

    const pulse = 1 - star.twinkleDepth / 2 + Math.sin(star.twinkle + performance.now() * star.twinkleSpeed) * (star.twinkleDepth + audioReactive.level * 0.12);
    const radius = Math.max(0.22, Math.min(1.65, (0.22 + (1 - star.z) * 0.95 + star.mag * 0.45) * pulse));
    const alpha = Math.min(0.78, 0.08 + (1 - star.z) * 0.42 + star.mag * 0.18);
    return { x, y, radius, alpha, hue: star.hue, glow: radius > 1.35 && star.z < 0.68 };
  }

  function advanceMemory(mem, width, height, freezeDrift, dt) {
    const audioPush = 1 + audioReactive.level * 0.18;
    const zStep = memoryDriftSpeed() * dt * audioPush;
    if (!freezeDrift) {
      mem.z -= zStep;
      mem.wobble += mem.wobbleSpeed * audioPush;
      mem.rot += mem.rotSpeed;
      if (mem.z <= 0.03) {
        if (journeyFlying()) {
          const roll = Math.random();
          respawnMemory(mem, roll > 0.5 ? "mid" : roll > 0.2 ? "lane" : "near-mid");
        } else {
          respawnMemory(mem, "far");
        }
      }
    }

    const depth = 1 / mem.z;
    const x =
      width / 2 +
      mem.x * width * 0.34 * depth +
      pointer.x * depth * (mem.layer === "foreground" ? 9 : 4) +
      Math.sin(mem.wobble) * 3 * depth;
    const y =
      height / 2 +
      mem.y * height * 0.34 * depth +
      pointer.y * depth * (mem.layer === "foreground" ? 6 : 3) +
      Math.cos(mem.wobble * 0.85) * 2 * depth;

    const related = Boolean(mem.chapterId && mem.chapterId === activeChapterId());
    const { h: baseH, alpha: baseAlpha, blur, saturate } = memorySizeAlpha(mem.z, mem.layer, related);
    const h = baseH * (1 + audioReactive.level * 0.08);
    if (h < 4) return null;

    const margin = Math.max(100, h * 0.55);
    if (x < -margin || x > width + margin || y < -margin || y > height + margin) {
      if (!freezeDrift) respawnMemory(mem, journeyFlying() ? "mid" : "far");
      return null;
    }

    return {
      x,
      y,
      w: h * 0.86,
      h,
      alpha: baseAlpha,
      blur,
      saturate,
      layer: mem.layer,
      related,
      meta: mem.source?.meta ?? null,
      rot: mem.rot + Math.sin(mem.wobble) * 0.05,
      img: memorySources.length ? memorySources[mem.imgIndex % memorySources.length]?.img : null,
    };
  }

  function syncDomPhoto(node, mem, p) {
    if (!p?.img) {
      node.style.opacity = "0";
      return;
    }

    const imgEl = node.querySelector("img");
    const labelEl = node.querySelector(".photo-drift-label");
    const src = p.img.currentSrc || p.img.src;
    if (node.dataset.src !== src) {
      node.dataset.src = src;
      imgEl.src = src;
      imgEl.alt = p.meta?.displayTitle ? `${p.meta.displayTitle} memory` : "Memory photo";
      const lines = [p.meta?.displayDate, p.meta?.displayTitle].filter(Boolean);
      labelEl.textContent = lines.join("\n");
      node.title = lines.join(" - ");
    }

    const aspect = p.img.naturalWidth / p.img.naturalHeight || 0.78;
    let drawH = p.h;
    let drawW = drawH * aspect;
    const maxW = p.img.naturalWidth;
    const maxH = p.img.naturalHeight;
    if (drawW > maxW) {
      drawW = maxW;
      drawH = drawW / aspect;
    }
    if (drawH > maxH) {
      drawH = maxH;
      drawW = drawH * aspect;
    }

    node.className = `photo-drift-item ${p.layer}${p.related ? " active" : ""}`;
    node.style.width = `${drawW}px`;
    node.style.height = `${drawH}px`;
    node.style.opacity = String(p.alpha);
    node.style.filter = `blur(${p.blur}px) saturate(${p.saturate})`;
    node.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%) rotate(${p.rot}rad)`;
  }

  function draw(now) {
    requestAnimationFrame(draw);
    if (!dustActive || document.hidden) return;
    const minFrameMs = lowPower ? 33 : 24;
    if (lastFrameMs && now - lastFrameMs < minFrameMs) return;

    const dt = lastFrameMs ? Math.min(2.4, (now - lastFrameMs) / 16.667) : 1;
    lastFrameMs = now;
    drawTick += 1;
    const width = sky.clientWidth;
    const height = sky.clientHeight;
    if (!width || !height) return;

    const freezeDrift = sky.classList.contains("memory-revealed") || prefersReducedMotion;

    if (!freezeDrift) {
      sortTick += 1;
      if (sortTick % sortEvery === 0) {
        stars.sort((a, b) => b.z - a.z);
      }
      if (memorySources.length) {
        photoSortTick += 1;
        if (photoSortTick % sortEvery === 0) {
          memories.sort((a, b) => b.z - a.z);
        }
      }
    }

    if (cam.phase !== "idle" && drawTick % (lowPower ? 2 : 1) === 0) sampleAudioLevel();
    if (journeyFlying() && memorySources.length && drawTick % (lowPower ? 4 : 2) === 0) {
      replenishMemories();
    }
    if (!memorySources.length && drawTick % 30 === 0) refreshMemorySources();

    ctx.setTransform(starDpr, 0, 0, starDpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < stars.length; i += 1) {
      const p = advanceStar(stars[i], width, height, freezeDrift, dt);
      if (!p) continue;

      if (p.glow && !skipGlow && p.radius > 0.75) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 4);
        glow.addColorStop(0, `rgba(${p.hue}, ${p.alpha * 0.7})`);
        glow.addColorStop(1, `rgba(${p.hue}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = `rgba(${p.hue}, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const showPhotoDrift =
      memorySources.length &&
      !sky.classList.contains("memory-revealed") &&
      !sky.classList.contains("finale-map");

    if (showPhotoDrift && useDomPhotos) {
      for (let i = 0; i < memories.length; i += 1) {
        const p = advanceMemory(memories[i], width, height, freezeDrift, dt);
        syncDomPhoto(domNodes[i], memories[i], p);
      }
    } else if (showPhotoDrift && useCanvasPhotos) {
      photoCtx.setTransform(photoDpr, 0, 0, photoDpr, 0, 0);
      photoCtx.clearRect(0, 0, width, height);
      photoCtx.globalCompositeOperation = "source-over";

      for (let i = 0; i < memories.length; i += 1) {
        const p = advanceMemory(memories[i], width, height, freezeDrift, dt);
        if (!p?.img) continue;

        const img = p.img;
        const aspect = img.naturalWidth / img.naturalHeight || 0.78;
        let drawH = p.h;
        let drawW = drawH * aspect;
        const maxW = img.naturalWidth;
        const maxH = img.naturalHeight;
        if (drawW > maxW) {
          drawW = maxW;
          drawH = drawW / aspect;
        }
        if (drawH > maxH) {
          drawH = maxH;
          drawW = drawH * aspect;
        }

        photoCtx.save();
        photoCtx.globalAlpha = p.alpha;
        photoCtx.translate(p.x, p.y);
        photoCtx.rotate(p.rot);
        photoCtx.fillStyle = "rgba(238, 244, 251, 0.78)";
        photoCtx.fillRect(-drawW / 2 - 4, -drawH / 2 - 4, drawW + 8, drawH + 8);
        photoCtx.fillStyle = "rgba(2, 6, 13, 0.42)";
        photoCtx.fillRect(-drawW / 2 - 1, -drawH / 2 - 1, drawW + 2, drawH + 2);
        photoCtx.imageSmoothingEnabled = drawW < maxW * 0.92;
        if (photoCtx.imageSmoothingEnabled) photoCtx.imageSmoothingQuality = "high";
        photoCtx.drawImage(img, -drawW / 2 - 2, -drawH / 2 - 2, drawW + 4, drawH + 4);
        photoCtx.restore();
      }
      photoCtx.globalAlpha = 1;
    } else if (useDomPhotos) {
      domNodes.forEach((node) => {
        node.style.opacity = "0";
      });
    } else if (photoCtx && drawTick % 10 === 0) {
      photoCtx.clearRect(0, 0, width, height);
    }
  }

  function updatePointer(clientX, clientY) {
    const rect = sky.getBoundingClientRect();
    pointer.x = (clientX - rect.left) / rect.width - 0.5;
    pointer.y = (clientY - rect.top) / rect.height - 0.5;
  }

  sky.addEventListener(
    "pointermove",
    (event) => {
      if (pointerQueued) return;
      pointerQueued = true;
      requestAnimationFrame(() => {
        updatePointer(event.clientX, event.clientY);
        pointerQueued = false;
      });
    },
    { passive: true },
  );
  sky.addEventListener("pointerleave", () => {
    pointer.x = 0;
    pointer.y = 0;
  });

  dustCanvas._resize = resize;
  dustCanvas._setActive = (active) => {
    dustActive = active;
  };
  resize();
  requestAnimationFrame(draw);
  window.addEventListener("resize", () => {
    resize();
    skyRect = sky.getBoundingClientRect();
    positionStars(state.morphing || sky.classList.contains("finale-map"));
    positionHelperStars();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

$("#finale-replay").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

function closeFinaleMessage() {
  finale.classList.remove("active");
  $(".finale-shape").classList.remove("name-revealed");
}

$("#finale-close").addEventListener("click", closeFinaleMessage);
$("#finale-close-secondary").addEventListener("click", closeFinaleMessage);

init();

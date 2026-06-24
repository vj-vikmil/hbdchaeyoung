const STORAGE_KEY = "chaeyoung-constellation-v5";

const state = {
  data: null,
  lang: "both",
  pathIndex: 0,
  viewed: new Set(),
  lines: [],
  finaleTriggered: false,
  morphing: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const intro = $("#intro");
const sky = $("#sky");
const finale = $("#finale");
const starsLayer = $("#stars");
const linesLayer = $("#lines");
const modal = $("#modal");
const hint = $("#hint");
const voiceAudio = $("#voice-audio");
const voiceStatus = $("#voice-status");
const voiceBar = $(".voice-bar");
const dustCanvas = $("#dust");

let starEls = {};
let helperEls = {};
let skyRect = null;
let hintTimer = null;
let currentStar = null;

async function init() {
  const res = await fetch("/content.json");
  state.data = await res.json();
  resetProgress();

  const preview = applyPreviewMode();
  setupIntro();
  setupLangToggle();
  setupModal();
  setupDust();
  renderStars();
  renderHelperStars();
  updateHud();

  if (preview === "finale") {
    showSky();
    await sleep(50);
    await triggerFinale(true);
    return;
  }

  if (preview === "sky" || state.pathIndex > 0 || state.viewed.size > 0) {
    showSky();
    restoreLines();
    updateStarStates();
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
    for (let i = 1; i < step; i++) {
      state.lines.push({ from: state.data.path[i - 1], to: state.data.path[i], style: "trail" });
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

function setupIntro() {
  const { intro: introText, herName, ui } = state.data;
  $(".intro-ko").textContent = introText.ko;
  $(".intro-en").textContent = introText.en;
  $(".intro-name").textContent = `${herName.en} · ${herName.ko}`;
  $(".btn-ko").textContent = ui.tapToBegin.ko;
  $(".btn-en").textContent = ui.tapToBegin.en;
  $("#intro-btn").addEventListener("click", showSky);
}

function showSky() {
  intro.classList.remove("active");
  sky.classList.add("active");
  requestAnimationFrame(() => {
    skyRect = sky.getBoundingClientRect();
    positionStars(false);
    positionHelperStars();
    updateStarStates();
  });
}

function setupLangToggle() {
  $$(".lang-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".lang-toggle button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.lang = btn.dataset.lang;
      document.body.className = state.lang === "both" ? "" : `lang-${state.lang}`;
      updateHud();
      updateStarStates();
    });
  });
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

    const number = document.createElement("span");
    number.className = "star-number";
    number.textContent = String(index + 1).padStart(2, "0");
    btn.appendChild(number);

    const label = document.createElement("span");
    label.className = "star-label";
    label.textContent = state.lang === "ko" ? star.title.ko : star.title.en;
    btn.appendChild(label);

    btn.addEventListener("click", () => onStarClick(star.id));
    starsLayer.appendChild(btn);
    starEls[star.id] = btn;
  });

  positionStars(false);
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

/*
 * Constellation coordinate system:
 * - All star positions in content.json are normalized [x, y] values from 0 to 1.
 * - narrativePos is the wandering story layout used while memories unlock.
 * - finalePos is the letter layout. The twelve clickable stars become the main
 *   strokes of "채영"; helperStars and guideSegments add faint non-clickable
 *   strokes so the Hangul remains readable on narrow screens.
 */
function positionStars(useFinale) {
  skyRect = sky.getBoundingClientRect();
  state.data.stars.forEach((star) => {
    const el = starEls[star.id];
    if (!el) return;
    const pos = useFinale ? star.finalePos : star.narrativePos;
    el.style.left = `${pos[0] * 100}%`;
    el.style.top = `${pos[1] * 100}%`;
  });
  redrawLines();
}

function positionHelperStars() {
  (state.data.helperStars ?? []).forEach((helper) => {
    const el = helperEls[helper.id];
    if (!el) return;
    el.style.left = `${helper.pos[0] * 100}%`;
    el.style.top = `${helper.pos[1] * 100}%`;
  });
}

function updateHud() {
  const n = Math.min(state.pathIndex, state.data.path.length);
  const { progress } = state.data.ui;
  $(".progress-text").innerHTML = `${progress.en.replace("{n}", n)}<br>${progress.ko.replace("{n}", n)}`;
}

function expectedStarId() {
  return state.data.path[state.pathIndex];
}

function updateStarStates() {
  const expected = expectedStarId();
  Object.entries(starEls).forEach(([id, el]) => {
    el.classList.remove("next", "wrong");
    el.classList.toggle("viewed", state.viewed.has(id));

    if (id === expected && !state.morphing) el.classList.add("next");
    if (id === "s12") el.classList.toggle("unlocked", state.pathIndex >= 11 || state.viewed.has(id));

    const star = getStar(id);
    const label = el.querySelector(".star-label");
    if (label) label.textContent = state.lang === "ko" ? star.title.ko : star.title.en;
  });

  if (expected === "s1" && state.pathIndex === 0) {
    showHint(state.data.ui.startHint);
  } else if (expected === "s12" && state.pathIndex === 11) {
    showHint(state.data.ui.star12Unlock);
  } else {
    hideHint();
  }

  updateHud();
}

function showHint(textObj) {
  hint.classList.remove("hidden");
  hint.innerHTML = `${textObj.en}<br><span>${textObj.ko}</span>`;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideHint, 4200);
}

function hideHint() {
  hint.classList.add("hidden");
}

function onStarClick(id) {
  if (state.morphing) return;

  const expected = expectedStarId();
  if (id !== expected && !state.viewed.has(id)) {
    starEls[id]?.classList.add("wrong");
    setTimeout(() => starEls[id]?.classList.remove("wrong"), 400);
    showHint(state.data.ui.wrongOrder);
    return;
  }

  const star = getStar(id);
  const firstDiscovery = !state.viewed.has(id);

  if (firstDiscovery) {
    const previousId = state.data.path[state.pathIndex - 1];
    state.viewed.add(id);
    state.pathIndex++;
    if (previousId) drawLine(previousId, id);
    saveProgress();
    updateStarStates();
  }

  openModal(star, true);

  if (firstDiscovery && state.pathIndex === state.data.path.length) {
    saveProgress();
  }
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
  return {
    x: helper.pos[0] * skyRect.width,
    y: helper.pos[1] * skyRect.height,
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
  redrawLines();
}

function setupModal() {
  $(".modal-close").addEventListener("click", closeModal);
  $(".modal-done").addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  voiceAudio.addEventListener("play", () => {
    setVoicePlaying(true);
    revealMemoryText();
  });
  voiceAudio.addEventListener("pause", () => setVoicePlaying(false));
  voiceAudio.addEventListener("timeupdate", () => {
    if (voiceAudio.duration) {
      voiceBar.style.width = `${(voiceAudio.currentTime / voiceAudio.duration) * 100}%`;
    }
  });

  voiceAudio.addEventListener("ended", () => {
    setVoicePlaying(false);
    voiceBar.style.width = "0%";
  });

  voiceAudio.addEventListener("error", () => {
    $(".voice-missing").classList.remove("hidden");
    voiceStatus.classList.add("missing");
  });
}

function openModal(star, autoplay = false) {
  currentStar = star;
  const { ui } = state.data;

  $(".modal-date").textContent = star.date || "";
  $(".modal-title-en").textContent = star.title.en;
  $(".modal-title-ko").textContent = star.title.ko;
  $(".voice-label-en").textContent = "Voice note will play automatically";
  $(".voice-label-ko").textContent = "음성 메시지가 자동으로 재생돼";
  $(".voice-missing").classList.add("hidden");
  $(".modal-inner").classList.remove("text-revealed");
  voiceStatus.classList.remove("missing");
  setVoicePlaying(false);
  voiceBar.style.width = "0%";

  voiceAudio.pause();
  voiceAudio.currentTime = 0;
  voiceAudio.src = star.voiceNote;
  voiceAudio.load();

  const missingEl = $(".voice-missing");
  const fileName = star.voiceNote.split("/").pop();
  missingEl.textContent = `${ui.voicePlaceholder.en.replace("{file}", fileName)} · ${ui.voicePlaceholder.ko.replace("{file}", fileName)}`;

  renderModalVisual(star);
  renderModalText(star);
  modal.showModal();

  if (autoplay) playVoice();
}

function revealMemoryText() {
  $(".modal-inner").classList.add("text-revealed");
}

function renderModalVisual(star) {
  const { ui } = state.data;
  const visualEl = $(".modal-visual");
  visualEl.innerHTML = "";
  if (!star.visual) return;

  if (star.visual.type === "photo") {
    const img = document.createElement("img");
    img.src = star.visual.src;
    img.alt = star.title.en;
    img.onerror = () => {
      visualEl.innerHTML = `<div class="placeholder-frame"><span>Photo</span><span>${ui.placeholderImage.en}</span><span>${ui.placeholderImage.ko}</span></div>`;
    };
    visualEl.appendChild(img);
  }

  if (star.visual.type === "video") {
    const vid = document.createElement("video");
    vid.src = star.visual.src;
    if (star.visual.poster) vid.poster = star.visual.poster;
    vid.controls = true;
    vid.muted = true;
    vid.autoplay = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.onerror = () => {
      visualEl.innerHTML = `<div class="placeholder-frame"><span>Video</span><span>${ui.placeholderImage.en}</span><span>${ui.placeholderImage.ko}</span></div>`;
    };
    visualEl.appendChild(vid);
  }
}

function renderModalText(star) {
  const headlineEl = $(".modal-headline");
  if (star.headline) {
    headlineEl.style.display = "block";
    headlineEl.innerHTML =
      state.lang === "ko"
        ? star.headline.ko.replace(/\n/g, "<br>")
        : state.lang === "en"
          ? star.headline.en.replace(/\n/g, "<br>")
          : `${star.headline.en.replace(/\n/g, "<br>")}<br><span>${star.headline.ko.replace(/\n/g, "<br>")}</span>`;
  } else {
    headlineEl.style.display = "none";
  }

  $(".modal-text-en").textContent = star.content?.en ?? "";
  $(".modal-text-ko").textContent = star.content?.ko ?? "";
}

function setVoicePlaying(isPlaying) {
  voiceStatus.classList.toggle("playing", isPlaying);
  $(".voice-label-en").textContent = isPlaying ? "Playing your voice note" : "Voice note will play automatically";
  $(".voice-label-ko").textContent = isPlaying ? "음성 메시지 재생 중" : "음성 메시지가 자동으로 재생돼";
}

function playVoice() {
  if (voiceAudio.error || !voiceAudio.src) {
    $(".voice-missing").classList.remove("hidden");
    return;
  }

  voiceAudio.currentTime = 0;
  voiceAudio.play().catch(() => {
    $(".voice-missing").classList.remove("hidden");
    voiceStatus.classList.add("missing");
    setVoicePlaying(false);
    revealMemoryText();
  });
}

function closeModal() {
  voiceAudio.pause();
  modal.close();

  const shouldReveal = currentStar?.id === "s12" && state.viewed.size === state.data.path.length;
  currentStar = null;
  if (shouldReveal) triggerFinale();
}

async function triggerFinale(skipAnimation = false) {
  if (state.finaleTriggered && !skipAnimation) return;
  state.finaleTriggered = true;
  state.morphing = true;
  saveProgress();

  hideHint();
  sky.classList.add("morphing");
  await sleep(skipAnimation ? 0 : 450);

  positionStars(true);
  await sleep(skipAnimation ? 0 : 1900);

  state.lines = getFinaleSegments().map(([from, to]) => ({ from, to, style: "finale" }));
  sky.classList.add("finale-map");
  redrawLines();
  await sleep(skipAnimation ? 0 : 650);

  const { message, shape } = state.data.finale;
  $(".finale-shape").textContent = shape;
  $(".finale-text-en").textContent = message.en;
  $(".finale-text-ko").textContent = message.ko;
  finale.classList.add("active");
  sky.classList.remove("morphing");
  sky.classList.add("finale-zoomed");
  state.morphing = false;
  saveProgress();
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

function setupDust() {
  const ctx = dustCanvas.getContext("2d");
  const stars = Array.from({ length: 1100 }, () => makeSpaceStar());
  const pointer = { x: 0, y: 0 };

  function makeSpaceStar() {
    const warm = Math.random() > 0.86;
    const blue = !warm && Math.random() > 0.72;
    return {
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      z: Math.random() * 0.95 + 0.05,
      hue: warm ? "255, 219, 176" : blue ? "196, 215, 255" : "242, 246, 255",
      mag: Math.random(),
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: Math.random() * 0.0009 + 0.00018,
      twinkleDepth: Math.random() * 0.34 + 0.06,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dustCanvas.width = Math.max(1, Math.floor(sky.clientWidth * dpr));
    dustCanvas.height = Math.max(1, Math.floor(sky.clientHeight * dpr));
    dustCanvas.style.width = `${sky.clientWidth}px`;
    dustCanvas.style.height = `${sky.clientHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawStar(star, now, width, height) {
    star.z -= 0.00008;
    star.twinkle += 0.004 + star.twinkleSpeed * 8;
    if (star.z <= 0.04) Object.assign(star, makeSpaceStar(), { z: 1 });

    const depth = 1 / star.z;
    const x = width / 2 + star.x * width * 0.42 * depth + pointer.x * depth * 7;
    const y = height / 2 + star.y * height * 0.42 * depth + pointer.y * depth * 5;

    if (x < -30 || x > width + 30 || y < -30 || y > height + 30) {
      Object.assign(star, makeSpaceStar(), { z: 1 });
      return;
    }

    const pulse = 1 - star.twinkleDepth / 2 + Math.sin(star.twinkle + now * star.twinkleSpeed) * star.twinkleDepth;
    const radius = Math.max(0.35, Math.min(1.9, (0.35 + (1 - star.z) * 1.3 + star.mag * 0.7) * pulse));
    const alpha = Math.min(0.88, 0.12 + (1 - star.z) * 0.5 + star.mag * 0.25);

    if (radius > 1.25) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 5);
      glow.addColorStop(0, `rgba(${star.hue}, ${alpha * 0.75})`);
      glow.addColorStop(0.35, `rgba(${star.hue}, ${alpha * 0.16})`);
      glow.addColorStop(1, `rgba(${star.hue}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = `rgba(${star.hue}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw(now = 0) {
    const width = sky.clientWidth;
    const height = sky.clientHeight;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    stars.forEach((star) => drawStar(star, now, width, height));
    ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(draw);
  }

  function updatePointer(clientX, clientY) {
    const rect = sky.getBoundingClientRect();
    pointer.x = (clientX - rect.left) / rect.width - 0.5;
    pointer.y = (clientY - rect.top) / rect.height - 0.5;
  }

  sky.addEventListener("pointermove", (event) => updatePointer(event.clientX, event.clientY));
  sky.addEventListener("pointerleave", () => {
    pointer.x = 0;
    pointer.y = 0;
  });

  resize();
  draw();
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
}

$("#finale-close").addEventListener("click", closeFinaleMessage);
$("#finale-close-secondary").addEventListener("click", closeFinaleMessage);

init();





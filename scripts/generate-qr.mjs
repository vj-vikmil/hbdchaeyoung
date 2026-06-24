/**
 * Generate styled QR codes via qrbtf parametric engine (simple-qrbtf).
 * https://github.com/latentcat/qrbtf
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import SimpleQr from "simple-qrbtf";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "assets");

const URL = "https://vikmil.com/hbdchaeyoung/";
const CARD_TITLE = "네가 좋은 이유";
const CARD_SUB = "진짜 너를 알게 돼서 정말 다행이야";

/** @type {keyof typeof SimpleQr} */
const STYLE = "line";

const STYLE_OPTS = {
  line: {
    posType: "round",
    lineColor: "#080c16",
    lineWidth: 55,
    posColor: "#080c16",
    otherColor: "#080c16",
  },
  base: {
    type: "round",
    posType: "round",
    size: 100,
    posColor: "#080c16",
    otherColor: "#080c16",
  },
  circle: {
    posColor: "#080c16",
    otherColor: "#080c16",
  },
  randRect: {
    posColor: "#080c16",
    otherColor: "#080c16",
  },
};

const QR_SIZE = 1080;
const PAD_X = 64;
const PAD_TOP = 72;
const PAD_BOTTOM = 56;
const FOOTER_H = 88;

function renderQrSvg() {
  const fn = SimpleQr[STYLE];
  if (!fn) {
    throw new Error(`Unknown qrbtf style: ${STYLE}`);
  }
  return fn({
    content: URL,
    level: "H",
    ...STYLE_OPTS[STYLE],
  });
}

async function renderQrPng() {
  const svg = renderQrSvg();
  return sharp(Buffer.from(svg))
    .resize(QR_SIZE, QR_SIZE, { kernel: "nearest" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function makeCard(qrPng) {
  const cardW = QR_SIZE + PAD_X * 2;
  const cardH = QR_SIZE + PAD_TOP + PAD_BOTTOM + FOOTER_H;
  const qrY = PAD_TOP;

  const headerSvg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="${cardW / 2}" y="52" text-anchor="middle"
    font-family="Malgun Gothic, MalgunGothic, sans-serif" font-size="34" font-weight="700"
    fill="#1e2430">${escapeXml(CARD_TITLE)}</text>
  <text x="${cardW / 2}" y="86" text-anchor="middle"
    font-family="Malgun Gothic, MalgunGothic, sans-serif" font-size="15"
    fill="#a89162">${escapeXml(CARD_SUB)}</text>
  <text x="${cardW / 2}" y="${qrY + QR_SIZE + 44}" text-anchor="middle"
    font-family="Georgia, serif" font-size="13" fill="#787878">vikmil.com/hbdchaeyoung</text>
</svg>`);

  return sharp({
    create: {
      width: cardW,
      height: cardH,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: headerSvg, top: 0, left: 0 },
      { input: qrPng, top: qrY, left: PAD_X },
    ])
    .png()
    .toBuffer();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const qrPng = await renderQrPng();
  const cardPng = await makeCard(qrPng);

  const qrPath = path.join(OUT_DIR, "happy-birthday-qr.png");
  const cardPath = path.join(OUT_DIR, "happy-birthday-qr-card.png");

  await sharp(qrPng).toFile(qrPath);
  await sharp(cardPng).toFile(cardPath);

  const chaeDir = "D:/CURSOR/chae";
  if (fs.existsSync(chaeDir)) {
    await sharp(qrPng).toFile(path.join(chaeDir, "happy-birthday-qr.png"));
    await sharp(cardPng).toFile(path.join(chaeDir, "happy-birthday-qr-card.png"));
  }

  console.log(`URL: ${URL}`);
  console.log(`Style: qrbtf/${STYLE}`);
  console.log(`Saved: ${qrPath}`);
  console.log(`Saved: ${cardPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

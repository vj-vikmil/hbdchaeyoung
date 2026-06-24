import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const SRC_DATA_DIR = path.join(ROOT, "src", "data");
const PUBLIC_DATA_DIR = path.join(PUBLIC_DIR, "data");
const CONTENT_PATH = path.join(PUBLIC_DIR, "content.json");
const RAW_OUT = path.join(SRC_DATA_DIR, "photoMetadata.json");
const REPORT_OUT = path.join(SRC_DATA_DIR, "photoMetadataReport.json");
const PUBLIC_OUT = path.join(PUBLIC_DATA_DIR, "photoMetadata.public.json");

const SUPPORTED = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);
const CHAPTER_ORDER = ["s1", "s2", "s3", "s5", "s4"];
const CHAPTER_TITLES = {
  s1: "The Night We Met",
  s2: "The Message",
  s3: "The One That Almost Never Happened",
  s5: "Korea",
  s4: "Why I Like You",
};
const CHAPTER_EVENTS = {
  s1: [{ month: 6, day: 7 }],
  s2: [{ month: 7, day: 11 }],
  s3: [{ month: 7, day: 14 }, { month: 7, day: 23 }],
};
const CLUSTERS = {
  s1: { x: -0.28, y: 0.14 },
  s2: { x: -0.12, y: -0.18 },
  s3: { x: 0.08, y: -0.17 },
  s5: { x: 0.28, y: 0.03 },
  s4: { x: 0.02, y: 0.22 },
  undated: { x: -0.34, y: -0.02 },
};

function webPath(filePath) {
  const rel = path.relative(PUBLIC_DIR, filePath).replaceAll(path.sep, "/");
  if (!rel.startsWith("..")) return `/${rel}`;
  return path.relative(ROOT, filePath).replaceAll(path.sep, "/");
}

function stableId(src) {
  const base = src
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const hash = crypto.createHash("sha1").update(src).digest("hex").slice(0, 8);
  return `${base || "photo"}-${hash}`;
}

function hashBuffer(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function normalizedFilename(name) {
  const base = path.basename(name, path.extname(name)).toLowerCase();
  if (/^album-\d+-\d+$/.test(base)) return base.replace(/-\d+$/, "");
  return base
    .toLowerCase()
    .replace(/\s*\(\d+\)$/g, "")
    .replace(/[-_\s]+(?:copy|duplicate)$/g, "")
    .replace(/-[0-9a-f]{8,}$/g, "");
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      files.push(...await walk(full));
    } else if (SUPPORTED.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function readUInt(buf, offset, bytes, little) {
  if (bytes === 1) return buf.readUInt8(offset);
  if (bytes === 2) return little ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
  if (bytes === 4) return little ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  return 0;
}

function readInt(buf, offset, bytes, little) {
  if (bytes === 1) return buf.readInt8(offset);
  if (bytes === 2) return little ? buf.readInt16LE(offset) : buf.readInt16BE(offset);
  if (bytes === 4) return little ? buf.readInt32LE(offset) : buf.readInt32BE(offset);
  return 0;
}

function typeSize(type) {
  return { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] ?? 1;
}

function exifValue(buf, tiffStart, entryOffset, little) {
  const type = readUInt(buf, entryOffset + 2, 2, little);
  const count = readUInt(buf, entryOffset + 4, 4, little);
  const size = typeSize(type) * count;
  const valueOffset = size <= 4 ? entryOffset + 8 : tiffStart + readUInt(buf, entryOffset + 8, 4, little);
  if (valueOffset < 0 || valueOffset >= buf.length) return null;

  if (type === 2) {
    return buf.toString("ascii", valueOffset, Math.min(valueOffset + count, buf.length)).replace(/\0+$/g, "").trim();
  }
  if (type === 3) {
    const values = Array.from({ length: count }, (_, i) => readUInt(buf, valueOffset + i * 2, 2, little));
    return count === 1 ? values[0] : values;
  }
  if (type === 4) {
    const values = Array.from({ length: count }, (_, i) => readUInt(buf, valueOffset + i * 4, 4, little));
    return count === 1 ? values[0] : values;
  }
  if (type === 5 || type === 10) {
    const signed = type === 10;
    const values = Array.from({ length: count }, (_, i) => {
      const n = signed ? readInt(buf, valueOffset + i * 8, 4, little) : readUInt(buf, valueOffset + i * 8, 4, little);
      const d = signed ? readInt(buf, valueOffset + i * 8 + 4, 4, little) : readUInt(buf, valueOffset + i * 8 + 4, 4, little);
      return d ? n / d : 0;
    });
    return count === 1 ? values[0] : values;
  }
  return null;
}

function readIfd(buf, tiffStart, offset, little) {
  const map = new Map();
  const ifdOffset = tiffStart + offset;
  if (ifdOffset < 0 || ifdOffset + 2 > buf.length) return map;
  const count = readUInt(buf, ifdOffset, 2, little);
  for (let i = 0; i < count; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > buf.length) break;
    const tag = readUInt(buf, entry, 2, little);
    map.set(tag, exifValue(buf, tiffStart, entry, little));
  }
  return map;
}

function parseExif(exif) {
  if (!exif?.length) return {};
  const header = exif.slice(0, 6).toString("ascii");
  const tiffStart = header === "Exif\0\0" ? 6 : 0;
  const order = exif.slice(tiffStart, tiffStart + 2).toString("ascii");
  const little = order === "II";
  if (!little && order !== "MM") return {};
  const firstIfdOffset = readUInt(exif, tiffStart + 4, 4, little);
  const ifd0 = readIfd(exif, tiffStart, firstIfdOffset, little);
  const exifIfd = ifd0.get(0x8769) ? readIfd(exif, tiffStart, ifd0.get(0x8769), little) : new Map();
  const gpsIfd = ifd0.get(0x8825) ? readIfd(exif, tiffStart, ifd0.get(0x8825), little) : new Map();

  const gps = {};
  const lat = gpsIfd.get(0x0002);
  const lon = gpsIfd.get(0x0004);
  const latRef = gpsIfd.get(0x0001);
  const lonRef = gpsIfd.get(0x0003);
  if (Array.isArray(lat) && Array.isArray(lon)) {
    const latVal = lat[0] + lat[1] / 60 + lat[2] / 3600;
    const lonVal = lon[0] + lon[1] / 60 + lon[2] / 3600;
    gps.latitude = latRef === "S" ? -latVal : latVal;
    gps.longitude = lonRef === "W" ? -lonVal : lonVal;
  }

  return {
    dateTimeOriginal: exifIfd.get(0x9003) ?? null,
    createDate: exifIfd.get(0x9004) ?? null,
    modifyDate: ifd0.get(0x0132) ?? null,
    camera: [ifd0.get(0x010f), ifd0.get(0x0110)].filter(Boolean).join(" ").trim() || null,
    orientationTag: ifd0.get(0x0112) ?? null,
    gps,
  };
}

function parseExifDate(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss = "00"] = match;
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

function parseFilenameDate(filename) {
  const base = filename.toLowerCase();
  const patterns = [
    /(?:^|[^\d])((?:19|20)\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)(?:[^\d]|$)/,
    /(?:^|[^\d])([0-3]\d)[-_.]([01]\d)[-_.]((?:19|20)\d{2})(?:[^\d]|$)/,
  ];
  for (const pattern of patterns) {
    const m = base.match(pattern);
    if (!m) continue;
    const y = m[1].length === 4 ? m[1] : m[3];
    const mo = m[1].length === 4 ? m[2] : m[2];
    const d = m[1].length === 4 ? m[3] : m[1];
    const month = Number(mo);
    const day = Number(d);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`;
    }
  }
  return null;
}

function dateParts(iso) {
  if (!iso) return { year: null, month: null, day: null, timestamp: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { year: null, month: null, day: null, timestamp: null };
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    timestamp: d.getTime(),
  };
}

function dateLabel(photo, chapterId) {
  if (!photo.year || !photo.month || !photo.day || photo.confidence < 0.55) return null;
  if (chapterId === "s5") {
    return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(photo.timestamp)).toUpperCase();
  }
  return `${String(photo.day).padStart(2, "0")}.${String(photo.month).padStart(2, "0")}`;
}

function isKoreaGps(location) {
  const { latitude, longitude } = location ?? {};
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= 33 && latitude <= 39.5 && longitude >= 124 && longitude <= 132;
}

function buildManualMapping(content) {
  const map = new Map();
  for (const star of content.stars ?? []) {
    const add = (src) => {
      if (src) map.set(src, { chapterId: star.id, source: "manual" });
    };
    const visual = star.visual ?? {};
    add(visual.src);
    add(visual.poster);
    add(visual.skyImage);
    for (const src of visual.images ?? []) add(src);
  }
  return map;
}

function assignChapter(photo, manual) {
  const srcManual = manual.get(photo.src);
  if (srcManual) return { chapterId: srcManual.chapterId, chapterSource: "manual", chapterConfidence: 1 };

  const name = photo.filename.toLowerCase();
  if (name.includes("korea") || isKoreaGps(photo.location)) {
    return { chapterId: "s5", chapterSource: isKoreaGps(photo.location) ? "gps-region" : "filename", chapterConfidence: 0.88 };
  }
  if (name.includes("message")) return { chapterId: "s2", chapterSource: "filename", chapterConfidence: 0.74 };
  if (name.includes("cancel") || name.includes("meeting") || name.includes("first")) {
    return { chapterId: "s3", chapterSource: "filename", chapterConfidence: 0.72 };
  }
  if (name.includes("flyer")) return { chapterId: "s1", chapterSource: "filename", chapterConfidence: 0.72 };

  if (photo.month && photo.day && photo.confidence >= 0.55) {
    let best = null;
    for (const [chapterId, events] of Object.entries(CHAPTER_EVENTS)) {
      for (const event of events) {
        const delta = Math.abs((photo.month - event.month) * 31 + (photo.day - event.day));
        if (!best || delta < best.delta) best = { chapterId, delta };
      }
    }
    if (best && best.delta <= 5) {
      return { chapterId: best.chapterId, chapterSource: "date-nearby", chapterConfidence: best.delta === 0 ? 0.86 : 0.62 };
    }
  }

  return { chapterId: null, chapterSource: "unassigned", chapterConfidence: 0 };
}

function layerFor(photo) {
  if (photo.chapterSource === "manual") return "foreground";
  if (photo.chapterId && photo.confidence >= 0.55) return "midground";
  return "background";
}

function seeded(src, salt = "") {
  const n = crypto.createHash("sha1").update(`${src}:${salt}`).digest().readUInt32BE(0);
  return n / 0xffffffff;
}

function placementFor(photo, indexInChapter) {
  const cluster = CLUSTERS[photo.chapterId] ?? CLUSTERS.undated;
  const angle = seeded(photo.id, "angle") * Math.PI * 2 + indexInChapter * 0.78;
  const ring = 0.055 + (indexInChapter % 4) * 0.035 + seeded(photo.id, "ring") * 0.025;
  const layerZ = photo.layer === "foreground" ? 0.34 : photo.layer === "midground" ? 0.52 : 0.76;
  let x = cluster.x + Math.cos(angle) * ring;
  let y = cluster.y + Math.sin(angle) * ring * 0.75;
  if (Math.abs(x) < 0.08 && Math.abs(y) < 0.1) {
    x += x < 0 ? -0.11 : 0.11;
  }
  return {
    x: Number(Math.max(-0.48, Math.min(0.48, x)).toFixed(4)),
    y: Number(Math.max(-0.36, Math.min(0.36, y)).toFixed(4)),
    z: Number(Math.max(0.24, Math.min(0.88, layerZ + (seeded(photo.id, "z") - 0.5) * 0.08)).toFixed(4)),
    rotation: Number(((seeded(photo.id, "rot") - 0.5) * 0.22).toFixed(4)),
  };
}

function isEligibleForConstellation(photo) {
  if (!photo.src.startsWith("/assets/")) return false;
  const name = photo.filename.toLowerCase();
  if (name.includes("qr") || name.includes("favicon") || name.includes("hero")) return false;
  if (name.startsWith("album-")) return true;
  if (name.includes("screenshot")) return true;
  if (/^ch\d+/.test(name)) return true;
  return photo.chapterSource === "manual";
}

class UnionFind {
  constructor(items) {
    this.parent = new Map(items.map((item) => [item, item]));
  }
  find(x) {
    const p = this.parent.get(x);
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

async function photoEntry(filePath, content, manual) {
  const src = webPath(filePath);
  const filename = path.basename(filePath);
  const stat = await fs.stat(filePath);
  const buf = await fs.readFile(filePath);
  let meta = {};
  try {
    meta = await sharp(buf, { limitInputPixels: false }).metadata();
  } catch {
    meta = {};
  }
  const exif = parseExif(meta.exif);
  const exifDate =
    parseExifDate(exif.dateTimeOriginal) ??
    parseExifDate(exif.createDate) ??
    parseExifDate(exif.modifyDate);
  const filenameDate = parseFilenameDate(filename);
  const metadataSource = exifDate
    ? (parseExifDate(exif.dateTimeOriginal) ? "exif:DateTimeOriginal" : parseExifDate(exif.createDate) ? "exif:CreateDate" : "exif:ModifyDate")
    : filenameDate
      ? "filename"
      : "filesystem";
  const usableIso = exifDate ?? filenameDate;
  const parts = dateParts(usableIso);
  const orientation = (meta.width ?? 0) >= (meta.height ?? 0) ? "landscape" : "portrait";
  const location = {
    latitude: exif.gps?.latitude ?? null,
    longitude: exif.gps?.longitude ?? null,
  };
  const confidence = exifDate ? 1 : filenameDate ? 0.62 : 0.2;
  const photo = {
    id: stableId(src),
    src,
    filename,
    filePath: path.relative(ROOT, filePath).replaceAll(path.sep, "/"),
    dateOriginal: usableIso,
    timestamp: parts.timestamp,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    fsModified: stat.mtime.toISOString(),
    fsCreated: stat.birthtime.toISOString(),
    location,
    locationName: isKoreaGps(location) ? "Korea" : null,
    camera: exif.camera ?? null,
    width: meta.width ?? null,
    height: meta.height ?? null,
    orientation,
    exifOrientation: exif.orientationTag ?? meta.orientation ?? null,
    metadataSource,
    chapterId: null,
    chapterTitle: null,
    chapterSource: null,
    chapterConfidence: 0,
    confidence,
    duplicateGroup: null,
    isPrimary: true,
    hash: hashBuffer(buf),
    partialHash: hashBuffer(Buffer.concat([buf.subarray(0, 65536), buf.subarray(Math.max(0, buf.length - 65536))])),
    byteLength: buf.length,
    eligibleForConstellation: false,
  };
  Object.assign(photo, assignChapter(photo, manual));
  photo.chapterTitle = photo.chapterId ? CHAPTER_TITLES[photo.chapterId] : null;
  photo.layer = layerFor(photo);
  photo.displayDate = dateLabel(photo, photo.chapterId);
  photo.displayTitle = photo.chapterTitle?.toUpperCase() ?? "MEMORY";
  photo.eligibleForConstellation = isEligibleForConstellation(photo);
  return photo;
}

function applyDuplicates(photos) {
  const uf = new UnionFind(photos.map((p) => p.id));
  const buckets = new Map();
  const addBucket = (key, id) => {
    if (!key) return;
    const first = buckets.get(key);
    if (first) uf.union(first, id);
    else buckets.set(key, id);
  };

  for (const photo of photos) {
    addBucket(`hash:${photo.hash}`, photo.id);
    addBucket(`name:${normalizedFilename(photo.filename)}`, photo.id);
    if (photo.width && photo.height) addBucket(`dim-partial:${photo.width}x${photo.height}:${photo.partialHash}`, photo.id);
  }

  const groups = new Map();
  for (const photo of photos) {
    const root = uf.find(photo.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(photo);
  }

  let groupIndex = 1;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const groupId = `group-${String(groupIndex).padStart(2, "0")}`;
    groupIndex += 1;
    const primary = [...group].sort((a, b) => {
      if (a.chapterSource === "manual" && b.chapterSource !== "manual") return -1;
      if (b.chapterSource === "manual" && a.chapterSource !== "manual") return 1;
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      return a.byteLength - b.byteLength;
    })[0];
    for (const photo of group) {
      photo.duplicateGroup = groupId;
      photo.isPrimary = photo.id === primary.id;
    }
  }
}

function selectVisible(photos) {
  const primary = photos.filter((p) => p.eligibleForConstellation && p.isPrimary);
  const sortPhoto = (a, b) => {
    const ca = CHAPTER_ORDER.indexOf(a.chapterId);
    const cb = CHAPTER_ORDER.indexOf(b.chapterId);
    const oa = ca === -1 ? 99 : ca;
    const ob = cb === -1 ? 99 : cb;
    if (oa !== ob) return oa - ob;
    return (a.timestamp ?? Number.MAX_SAFE_INTEGER) - (b.timestamp ?? Number.MAX_SAFE_INTEGER) || a.filename.localeCompare(b.filename);
  };
  const foreground = primary.filter((p) => p.layer === "foreground").sort(sortPhoto).slice(0, 12);
  const midground = primary.filter((p) => p.layer === "midground").sort(sortPhoto).slice(0, 10);
  const background = primary.filter((p) => p.layer === "background").sort(sortPhoto).slice(0, 5);
  const seen = new Set();
  return [...foreground, ...midground, ...background].filter((photo) => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  });
}

function sanitized(photo) {
  const {
    hash,
    partialHash,
    filePath,
    byteLength,
    fsCreated,
    fsModified,
    ...safe
  } = photo;
  return {
    ...safe,
    location: { latitude: null, longitude: null },
  };
}

async function main() {
  const content = JSON.parse(await fs.readFile(CONTENT_PATH, "utf8"));
  const manual = buildManualMapping(content);
  const candidates = [
    ...await walk(path.join(ROOT, "public")),
    ...await walk(path.join(ROOT, "src", "assets")).catch(() => []),
  ];
  const uniqueFiles = [...new Set(candidates.map((file) => path.resolve(file)))];
  const photos = [];
  for (const filePath of uniqueFiles) {
    photos.push(await photoEntry(filePath, content, manual));
  }

  applyDuplicates(photos);
  const visible = selectVisible(photos);
  const indexByChapter = new Map();
  for (const photo of visible) {
    const key = photo.chapterId ?? "undated";
    const index = indexByChapter.get(key) ?? 0;
    indexByChapter.set(key, index + 1);
    photo.visibleInConstellation = true;
    photo.placement = placementFor(photo, index);
  }
  for (const photo of photos) {
    if (!photo.visibleInConstellation) photo.visibleInConstellation = false;
    if (!photo.placement) photo.placement = placementFor(photo, 0);
  }

  const chapterMapping = {};
  for (const chapterId of [...CHAPTER_ORDER, "unassigned"]) {
    chapterMapping[chapterId] = photos
      .filter((p) => (p.chapterId ?? "unassigned") === chapterId)
      .sort((a, b) => (a.timestamp ?? Number.MAX_SAFE_INTEGER) - (b.timestamp ?? Number.MAX_SAFE_INTEGER))
      .map((p) => p.src);
  }

  const raw = {
    generatedAt: new Date().toISOString(),
    source: "scripts/generate-photo-metadata.mjs",
    stats: {
      totalPhotos: photos.length,
      visibleConstellation: visible.length,
      duplicateGroups: new Set(photos.map((p) => p.duplicateGroup).filter(Boolean)).size,
      unassigned: photos.filter((p) => !p.chapterId).length,
      withoutUsefulDate: photos.filter((p) => p.confidence <= 0.2).length,
    },
    chapterMapping,
    photos,
    visibleConstellation: visible.map((p) => p.id),
  };
  const pub = {
    ...raw,
    photos: photos.map(sanitized),
    visibleConstellation: visible.map((p) => sanitized(p)),
  };
  const duplicateReport = {};
  for (const photo of photos.filter((p) => p.duplicateGroup)) {
    duplicateReport[photo.duplicateGroup] ??= [];
    duplicateReport[photo.duplicateGroup].push({ src: photo.src, isPrimary: photo.isPrimary });
  }
  const report = {
    generatedAt: raw.generatedAt,
    stats: raw.stats,
    unassigned: photos
      .filter((p) => !p.chapterId)
      .map((p) => ({ src: p.src, metadataSource: p.metadataSource, confidence: p.confidence, displayDate: p.displayDate })),
    withoutUsefulDate: photos
      .filter((p) => p.confidence <= 0.2)
      .map((p) => ({ src: p.src, metadataSource: p.metadataSource, chapterId: p.chapterId })),
    duplicates: duplicateReport,
  };

  await fs.mkdir(SRC_DATA_DIR, { recursive: true });
  await fs.mkdir(PUBLIC_DATA_DIR, { recursive: true });
  await fs.writeFile(RAW_OUT, `${JSON.stringify(raw, null, 2)}\n`);
  await fs.writeFile(REPORT_OUT, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(PUBLIC_OUT, `${JSON.stringify(pub, null, 2)}\n`);

  console.log(`Wrote ${path.relative(ROOT, RAW_OUT)} (${photos.length} photos)`);
  console.log(`Wrote ${path.relative(ROOT, REPORT_OUT)} (audit report)`);
  console.log(`Wrote ${path.relative(ROOT, PUBLIC_OUT)} (${visible.length} visible primary photos)`);
  console.log(`Duplicate groups: ${raw.stats.duplicateGroups}`);
  console.log(`Unassigned: ${raw.stats.unassigned}`);
  console.log(`Without useful metadata date: ${raw.stats.withoutUsefulDate}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

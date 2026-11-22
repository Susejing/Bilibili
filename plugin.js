// Kino plugin: Bilibili v1.6.1 — Susejing
const API = "https://api.bilibili.com";
const WEB = "https://www.bilibili.com";
const INTL_API = "https://api.bilibili.tv/intl/gateway/web";
const INTL_WEB = "https://www.bilibili.tv";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const INTL_UA = "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function log(...a) { try { kino.log(...a); } catch {}
}
function t(es, en) { return String(kino.lang || "es").toLowerCase().startsWith("es") ? es : en; }
function mode() { return String(kino.config.get("region") || "").trim().toLowerCase() === "china" ? "china" : "intl"; }
function sessdata() { let s = String(kino.config.get("sessdata") || "").trim(); if (s.toLowerCase().startsWith("sessdata=")) s = s.slice(9).trim(); return s; }
function dedeuserid() { return String(kino.config.get("dedeuserid") || "").trim(); }
function biliJct() { return String(kino.config.get("bili_jct") || "").trim(); }
function cleanTitle(title) { return String(title || "").replace(/<[^>]+>/g, "").trim(); }
function posterUrl(pic) {
  if (!pic) return undefined;
  if (pic.startsWith("//")) return "https:" + pic;
  if (pic.startsWith("http")) return pic;
  if (pic.startsWith("pic.bstarstatic.com/")) return "https://" + pic;
  return undefined;
}
export function theme() { return { primary: "#FB7299", background: "#0E0E0E" }; }

function readCache(key) {
  try {
    const raw = kino.storage.get(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.items) || !obj.ts) return null;
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
    return obj.items;
  } catch { return null; }
}
function writeCache(key, items, cap) {
  try {
    const slim = (items || []).slice(0, cap || 60).map((it) => ({
      id: it.id, ref: it.ref, title: it.title, kind: it.kind || "series",
      poster: it.poster, overview: it.overview ? String(it.overview).slice(0, 300) : undefined,
    }));
    kino.storage.set(key, JSON.stringify({ ts: Date.now(), items: slim }));
  } catch {}
}

const mixinKeyEncTab = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
function getMixinKey(orig) { let temp = ""; for (let i = 0; i < 64; i++) temp += orig[mixinKeyEncTab[i]]; return temp.slice(0, 32); }
async function getWbiKeys() {
  const cached = readCache("cache:wbi_keys");
  if (cached && cached.length >= 2) return { img_key: cached[0], sub_key: cached[1] };
  try {
    const navRes = await kino.fetch(API + "/x/web-interface/nav", { headers: { "User-Agent": UA, Referer: WEB + "/" } });
    if (navRes.ok) {
      const navData = navRes.json();
      const wbi_img = navData.data?.wbi_img;
      if (wbi_img) {
        const img_key = wbi_img.img_url.split("/").pop().split(".")[0];
        const sub_key = wbi_img.sub_url.split("/").pop().split(".")[0];
        writeCache("cache:wbi_keys", [img_key, sub_key], 2);
        return { img_key, sub_key };
      }
    }
  } catch (e) {}
  return null;
}
async function md5(str) {
  if (!crypto || !crypto.subtle) throw new Error("no crypto");
  const buf = await crypto.subtle.digest("MD5", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function signWbi(url) {
  try {
    const keys = await getWbiKeys();
    if (!keys) return url;
    const mixin_key = getMixinKey(keys.img_key + keys.sub_key);
    const wts = Math.round(Date.now() / 1000);
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);
    params.set("wts", wts);
    const sorted = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const query = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v).replace(/[!'()*]/g, ""))}`).join("&");
    params.set("w_rid", await md5(query + mixin_key));
    return urlObj.origin + urlObj.pathname + "?" + params.toString();
  } catch (e) { return url; }
}

let buvidCache = null;
async function ensureBuvid() {
  if (buvidCache) return buvidCache;
  try { const saved = kino.storage.get("buvid"); if (saved && saved.b3) { buvidCache = saved; return buvidCache; } } catch {}
  try {
    const r = await kino.fetch(API + "/x/frontend/finger/spi", { headers: { "User-Agent": UA, Referer: WEB + "/", Origin: WEB }, timeoutMs: 12000 });
    if (r.ok) {
      const data = r.json();
      if (data && data.code === 0 && data.data) {
        buvidCache = { b3: data.data.b_3 || data.data.buvid3 || "", b4: data.data.b_4 || data.data.buvid4 || "" };
        try { kino.storage.set("buvid", buvidCache); } catch {}
        return buvidCache;
      }
    }
  } catch (e) {}
  const rand = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const n = (Math.random() * 16) | 0; return (c === "x" ? n : (n & 0x3) | 0x8).toString(16); });
  buvidCache = { b3: rand() + "infoc", b4: rand() };
  try { kino.storage.set("buvid", buvidCache); } catch {}
  return buvidCache;
}
function cookieHeader() {
  const parts = [];
  const sd = sessdata(), du = dedeuserid(), jct = biliJct();
  if (sd) parts.push("SESSDATA=" + sd);
  if (du) parts.push("DedeUserID=" + du);
  if (jct) parts.push("bili_jct=" + jct);
  if (buvidCache) { if (buvidCache.b3) parts.push("buvid3=" + buvidCache.b3); if (buvidCache.b4) parts.push("buvid4=" + buvidCache.b4); }
  return parts.length ? parts.join("; ") : undefined;
}
function baseHeaders(extra) {
  const h = { "User-Agent": UA, Referer: WEB + "/", Origin: WEB };
  const ck = cookieHeader(); if (ck) h.Cookie = ck;
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}
async function getJson(url, retry = true) {
  await ensureBuvid();
  const signedUrl = await signWbi(url);
  const r = await kino.fetch(signedUrl, { headers: baseHeaders(), cookies: true, timeoutMs: 20000 });
  if (!r.ok) {
    if (r.status === 412) {
      if (retry) { await new Promise((res) => setTimeout(res, 2000)); return getJson(url, false); }
      throw kino.error("auth_required", "HTTP 412", { userMessage: t("Bilibili bloqueó (412). Vincula cuenta o VPN.", "Bilibili blocked (412). Link account or VPN.") });
    }
    throw kino.error("unavailable", "HTTP " + r.status, { userMessage: t("Bilibili no respondió.", "Bilibili did not respond.") });
  }
  const text = r.text();
  if (text.trim().startsWith("<")) throw kino.error("unavailable", "blocked", { userMessage: t("Bilibili bloqueó la petición.", "Bilibili blocked the request.") });
  let data; try { data = JSON.parse(text); } catch { throw kino.error("unavailable", "bad json", { userMessage: t("Respuesta inválida.", "Invalid response.") }); }
  if (data.code !== 0 && data.code !== undefined) {
    const msg = data.message || String(data.code), code = data.code;
    if (code === -412 || code === 412) {
      if (retry) { await new Promise((res) => setTimeout(res, 2000)); return getJson(url, false); }
      throw kino.error("auth_required", msg, { userMessage: t("Bloqueo 412. Vincula cuenta o VPN.", "412 block. Link account or VPN.") });
    }
    if (code === -101 || code === -111 || code === -400) throw kino.error("auth_required", msg, { userMessage: t("Sesión inválida. Vuelve a vincular.", "Invalid session. Re-link.") });
    if (code === -403 || code === 403) throw kino.error("geo_blocked", msg, { userMessage: t("No disponible en tu región.", "Not available in your region.") });
    throw kino.error("unavailable", msg, { userMessage: "Bilibili: " + msg });
  }
  return data;
}
function toVideoItem(v) {
  return {
    id: String(v.bvid || v.aid), ref: v.bvid || ("av" + v.aid), title: cleanTitle(v.title),
    kind: "movie", poster: posterUrl(v.pic), year: v.pubdate ? String(new Date(v.pubdate * 1000).getFullYear()) : undefined,
    overview: cleanTitle(v.description || v.desc || "").slice(0, 300),
  };
}

export async function action(key) {
  if (key === "link_account") {
    if (!kino.visualBrowser?.available) return { message: t("Navegador no disponible.", "Browser not available.") };
    const r = await kino.visualBrowser.open({
      url: "https://passport.bilibili.com/login", title: t("Iniciar sesión en Bilibili", "Login to Bilibili"),
      userAgent: "browser", doneWhen: { urlMatches: "*www.bilibili.com*" },
      collect: { cookies: ["SESSDATA", "DedeUserID", "bili_jct"], storeAs: { setting: "auto", format: "header" } }, timeoutMs: 600000,
    });
    if (r.status === "done" && r.stored) return { message: t("¡Sesión vinculada!", "Session linked!") };
    if (r.status === "closed") return { message: t("Cancelado.", "Cancelled.") };
    return { message: t("No se pudo vincular.", "Could not link.") };
  }
  if (key === "verify_account") {
    if (!sessdata()) return { message: t("Primero vincula tu cuenta.", "Link your account first.") };
    try {
      const data = await getJson(API + "/x/web-interface/nav");
      if (data.data && data.data.isLogin) {
        const u = data.data;
        return { message: t(`✅ ${u.uname} (UID ${u.mid})`, `✅ ${u.uname} (UID ${u.mid})`) };
      }
      return { message: t("❌ Sesión inválida.", "❌ Invalid session.") };
    } catch (e) { return { message: t("Error: ", "Error: ") + e.message }; }
  }
}

async function fetchHistory() {
  if (!sessdata()) return [];
  try {
    const data = await getJson(API + "/x/web-interface/history/cursor?ps=20&type=all");
    return ((data.data && data.data.list) || []).map((v) => {
      const bvid = v.history ? v.history.bvid : v.bvid;
      return { id: bvid || v.aid, ref: bvid || ("av" + v.aid), title: cleanTitle(v.title), kind: "movie", poster: posterUrl(v.cover) };
    }).filter((i) => i.ref);
  } catch (e) { return []; }
}
async function fetchFavorites() {
  if (!sessdata()) return [];
  try {
    const foldersData = await getJson(API + "/x/v3/fav/folder/created/list-all");
    const folders = (foldersData.data && foldersData.data.list) || [];
    if (!folders.length) return [];
    const itemsData = await getJson(API + "/x/v3/fav/resource/list?media_id=" + folders[0].id + "&ps=20&pn=1&platform=web");
    return ((itemsData.data && itemsData.data.medias) || []).map((v) => ({
      id: v.bvid || v.id, ref: v.bvid || ("av" + v.id), title: cleanTitle(v.title), kind: "movie", poster: posterUrl(v.cover),
    })).filter((i) => i.ref);
  } catch (e) { return []; }
}
async function fetchRecommended() {
  if (!sessdata()) return [];
  try {
    const data = await getJson(API + "/x/web-interface/wbi/index/top/feed/rcmd?ps=20&fresh_type=4");
    return ((data.data && data.data.item) || []).map((v) => ({
      id: v.bvid || v.id, ref: v.bvid || ("av" + v.id), title: cleanTitle(v.title), kind: "movie", poster: posterUrl(v.pic),
    })).filter((i) => i.ref);
  } catch (e) { return []; }
}
async function cnSearch(q) {
  const all = [], seen = new Set();
  for (let page = 1; page <= 3; page++) {
    try {
      const data = await getJson(API + "/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(q) + "&page=" + page);
      const list = data.data?.result || [];
      for (const v of list) {
        const item = toVideoItem(v);
        item.title = item.title.replace(/<\/?em[^>]*>/g, "");
        if (item.ref && !seen.has(item.ref)) { seen.add(item.ref); all.push(item); }
      }
      if (list.length < 20) break;
    } catch (e) { break; }
  }
  return all;
}

function streamFromPlay(d, realBvid) {
  const headers = baseHeaders({ Referer: WEB + "/video/" + realBvid });
  if (d.durl && d.durl[0] && d.durl[0].url) return { url: d.durl[0].url, headers, mime: "video/mp4" };
  if (d.dash && d.dash.video && d.dash.video.length) {
    const v = d.dash.video.find((x) => x.codecid === 7) || d.dash.video[0];
    const u = v.baseUrl || v.base_url;
    if (u) return { url: u, headers };
  }
  return null;
}
async function cnSubtitles(bvid, cid) {
  try {
    const data = await getJson(API + "/x/player/v2?bvid=" + bvid + "&cid=" + cid);
    const out = [];
    for (const sub of (data.data?.subtitle?.subtitles || [])) {
      if (sub.subtitle_url && sub.lan) {
        let u = sub.subtitle_url; if (u.startsWith("//")) u = "https:" + u;
        out.push({ lang: sub.lan, url: u, format: "json" });
      }
    }
    return out;
  } catch (e) { return []; }
}
async function cnResolve(ref) {
  await ensureBuvid();
  let bvid = String(ref).startsWith("BV") ? String(ref) : null;
  let aid = String(ref).startsWith("av") ? String(ref).slice(2) : null;
  if (!bvid && !aid) bvid = String(ref);
  let viewUrl = API + "/x/web-interface/view?" + (bvid ? "bvid=" + encodeURIComponent(bvid) : "aid=" + encodeURIComponent(aid));
  const view = await getJson(viewUrl);
  const vd = view.data;
  if (!vd) throw kino.error("not_found", "no data", { userMessage: t("Video no encontrado.", "Video not found.") });
  const attempts = [
    API + "/x/player/wbi/playurl?bvid=" + encodeURIComponent(vd.bvid) + "&cid=" + vd.cid + "&qn=64&fnval=1&platform=html5&high_quality=1",
    API + "/x/player/wbi/playurl?bvid=" + encodeURIComponent(vd.bvid) + "&cid=" + vd.cid + "&qn=32&fnval=1&platform=html5",
    API + "/x/player/wbi/playurl?avid=" + vd.aid + "&cid=" + vd.cid + "&qn=32&fnval=0",
  ];
  let lastErr = null;
  for (const playUrl of attempts) {
    try {
      const play = await getJson(playUrl);
      const stream = streamFromPlay(play.data, vd.bvid);
      if (stream) {
        try { const subs = await cnSubtitles(vd.bvid, vd.cid); if (subs.length) stream.subtitles = subs; } catch (e) {}
        return stream;
      }
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  throw kino.error("unavailable", "no stream", { userMessage: t("No se pudo reproducir.", "Could not play.") });
}

function intlHeaders(extra) {
  const h = { "User-Agent": INTL_UA, Referer: INTL_WEB + "/", Origin: INTL_WEB };
  if (extra) Object.assign(h, extra);
  return h;
}
async function intlJson(url) {
  const r = await kino.fetch(url, { headers: intlHeaders(), timeoutMs: 20000 });
  if (!r.ok) throw kino.error("unavailable", "HTTP " + r.status, { userMessage: t("Bilibili Intl HTTP ", "Bilibili Intl HTTP ") + r.status });
  let data; try { data = JSON.parse(r.text()); } catch { throw kino.error("unavailable", "bad json", { userMessage: t("Error.", "Error.") }); }
  const c = data && data.code;
  if (c && c !== 0) {
    if (c === 10004001) throw kino.error("geo_blocked", "10004001", { userMessage: t("Sin licencia.", "No license.") });
    if ([10004004, 10004005, 10023006].includes(c)) throw kino.error("auth_required", String(c), { userMessage: t("Requiere cuenta.", "Requires account.") });
    throw kino.error("unavailable", String(c), { userMessage: "Bilibili: " + String(data.message || c) });
  }
  return data && data.data !== undefined ? data.data : data;
}
async function intlSearch(q, cursor) {
  const page = cursor ? Number(cursor) || 1 : 1;
  const data = await intlJson(INTL_API + "/v2/search?s_locale=en_US&platform=web&keyword=" + encodeURIComponent(q) + "&page=" + page);
  const items = [];
  for (const it of (data && (data.items || data.result || data.list)) || []) {
    const title = cleanTitle(it.title || it.name);
    if (!title) continue;
    if (it.season_id) items.push({ id: "s:" + it.season_id, ref: "s:" + it.season_id, title, kind: "series", poster: posterUrl(it.cover || it.horizontal_cover) });
    else if (it.aid || it.bvid) items.push({ id: String(it.bvid || it.aid), ref: it.bvid || ("av" + it.aid), title, kind: "movie", poster: posterUrl(it.cover || it.pic) });
  }
  return { items, cursor: items.length >= 20 ? String(page + 1) : undefined };
}
function qLabel(q) { if (q >= 80) return "1080p"; if (q >= 64) return "720p"; if (q >= 32) return "480p"; return "360p"; }
async function intlSubtitles(epId) {
  const data = await intlJson(INTL_API + "/v2/subtitle?platform=web&s_locale=en_US&episode_id=" + encodeURIComponent(epId));
  const list = data && (data.subtitles || data.video_subtitle || data.subtitle) || [];
  return list.filter((sub) => sub.url && /\.srt(\?|$)/i.test(sub.url)).map((sub) => ({ lang: cleanTitle(sub.lang_key || "en").slice(0, 20) || "en", url: sub.url, format: "srt" }));
}
async function intlResolve(kind, id) {
  const param = kind === "e" ? "ep_id" : "aid";
  const data = await intlJson(INTL_API + "/playurl?s_locale=en_US&platform=web&" + param + "=" + encodeURIComponent(id));
  const p = data && data.playurl;
  if (!p) throw kino.error("not_found", "no playurl", { userMessage: t("No encontrado.", "Not found.") });
  const vids = (p.video || []).map((x) => x.video_resource || x).filter((v) => v.url).sort((a, b) => b.quality - a.quality);
  const auds = (p.audio_resource || []).filter((a) => a.url).sort((a, b) => b.bandwidth - a.bandwidth);
  if (!vids.length) throw kino.error("unavailable", "no urls", { userMessage: t("Sin enlaces.", "No links.") });
  const headers = { "User-Agent": INTL_UA, Referer: INTL_WEB + "/" };
  const stream = { url: vids[0].url, mime: "video/mp4", headers, label: qLabel(vids[0].quality) };
  if (p.duration) stream.durationMs = p.duration;
  if (auds.length) stream.audioTracks = [{ lang: "zh", url: auds[0].url, label: "Original" }];
  if (vids.length > 1) stream.alternatives = vids.slice(1, 8).map((v) => ({ url: v.url, mime: "video/mp4", headers, label: qLabel(v.quality) }));
  if (kind === "e") { try { const subs = await intlSubtitles(id); if (subs.length) stream.subtitles = subs; } catch (e) {} }
  return stream;
}

export async function segments(ref) {
  try {
    const id = String(ref).includes(":") ? String(ref).split(":")[1] : String(ref);
    const data = await getJson(API + "/x/player/v2?bvid=" + id);
    const points = data.data?.view_points || [];
    const intro = points.find((p) => p.type === 1), outro = points.find((p) => p.type === 2);
    return { intro: intro ? [intro.from, intro.to] : null, outro: outro ? [outro.from, outro.to] : null };
  } catch (e) { return { intro: null, outro: null }; }
}
export async function playlists() {
  return [
    { id: "trending", name: t("Tendencias", "Trending"), ref: "browse:popular" },
    { id: "anime", name: t("Anime", "Anime"), ref: "browse:anime" },
  ];
}
export async function download(ref) {
  const stream = await resolve(ref);
  return { url: stream.url, filename: "bilibili_" + String(ref).replace(/:/g, "_") + ".mp4", headers: stream.headers };
}
export async function subtitles(ref) {
  const s = String(ref || "");
  try {
    if (s.startsWith("e:")) return await intlSubtitles(s.slice(2));
    let bvid = s.startsWith("BV") ? s : null, aid = s.startsWith("av") ? s.slice(2) : null;
    if (!bvid && !aid && !s.includes(":")) bvid = s;
    if (!bvid && !aid) return [];
    await ensureBuvid();
    const view = await getJson(API + "/x/web-interface/view?" + (bvid ? "bvid=" + encodeURIComponent(bvid) : "aid=" + encodeURIComponent(aid)));
    const vd = view && view.data;
    if (!vd || !vd.cid) return [];
    return await cnSubtitles(vd.bvid || bvid, vd.cid);
  } catch (e) { return []; }
}
export async function categories() {
  return [
    { id: "anime", name: t("Anime", "Anime") },
    { id: "movies", name: t("Películas", "Movies") },
    { id: "series", name: t("Series", "Series") },
  ];
}
export async function scopedSearch(query, scope) {
  const q = (query.q || "").trim();
  if (!q) return [];
  if (mode() === "china") return cnSearch(q);
  const res = await intlSearch(q, null);
  return Array.isArray(res) ? res : res.items || [];
}
export async function search(query) {
  const q = (query.q || "").trim();
  if (!q) return [];
  if (mode() === "china") return cnSearch(q);
  return intlSearch(q, query.cursor);
}
export async function home() {
  if (mode() === "china") {
    const rows = [];
    try { const h = await fetchHistory(); if (h.length) rows.push({ title: t("Continuar viendo", "Continue watching"), items: h.slice(0, 20) }); } catch (e) {}
    try { const f = await fetchFavorites(); if (f.length) rows.push({ title: t("Favoritos", "Favorites"), items: f.slice(0, 20) }); } catch (e) {}
    try { const r = await fetchRecommended(); if (r.length) rows.push({ title: t("Recomendados", "Recommended"), items: r.slice(0, 20) }); } catch (e) {}
    try {
      const data = await getJson(API + "/x/web-interface/popular?ps=20&pn=1");
      const items = ((data.data && data.data.list) || []).map(toVideoItem).filter((i) => i.ref);
      if (items.length) rows.push({ title: t("Tendencias", "Trending"), items });
    } catch (e) {}
    return rows;
  }
  const rows = [];
  try {
    const data = await intlJson(INTL_API + "/v2/ogv/home?s_locale=en_US&platform=web");
    for (const mod of (data && data.modules) || []) {
      const title = cleanTitle(mod.title || mod.name || "");
      const items = [];
      for (const it of (mod.items || mod.cards || []).slice(0, 20)) {
        const name = cleanTitle(it.title || it.name || "");
        if (it.season_id) items.push({ id: "s:" + it.season_id, ref: "s:" + it.season_id, title: name, kind: "series", poster: posterUrl(it.cover || it.horizontal_cover) });
        else if (it.aid || it.bvid) items.push({ id: String(it.bvid || it.aid), ref: it.bvid || ("av" + it.aid), title: name, kind: "movie", poster: posterUrl(it.cover || it.pic) });
      }
      if (title && items.length) rows.push({ title, items });
      if (rows.length >= 10) break;
    }
  } catch (e) { log("intl home", e && e.message); }
  if (!rows.length) {
    for (const q of ["One Piece", "Naruto", "Demon Slayer", "Jujutsu Kaisen", "Solo Leveling", "Anime"]) {
      try {
        const res = await intlSearch(q, null);
        const items = (Array.isArray(res) ? res : (res && res.items) || []).slice(0, 15);
        if (items.length) rows.push({ title: q, items });
      } catch (e) {}
    }
  }
  return rows;
}
export async function browse(ref, cursor) {
  const s = String(ref || "");
  if (s === "browse:popular" || s === "popular") {
    if (mode() === "china") {
      const pn = Number(cursor) || 1;
      const data = await getJson(API + "/x/web-interface/popular?ps=20&pn=" + pn);
      const list = (data.data && data.data.list) || [];
      return { items: list.map(toVideoItem), cursor: list.length >= 20 ? String(pn + 1) : undefined };
    }
    const res = await intlSearch("anime", cursor);
    return { items: Array.isArray(res) ? res : res.items || [], cursor: res.cursor };
  }
  if (s === "browse:anime" || s === "anime") {
    const res = await intlSearch("anime", cursor);
    return { items: Array.isArray(res) ? res : res.items || [], cursor: res.cursor };
  }
  return { items: [] };
}
export async function episodes(ref) {
  const s = String(ref || "");
  if (!s.startsWith("s:")) return { episodes: [] };
  const seasonId = s.slice(2);
  const info = await intlJson(INTL_API + "/v2/ogv/play/season_info?season_id=" + encodeURIComponent(seasonId) + "&platform=web");
  const season = (info && info.season) || {};
  const epsData = await intlJson(INTL_API + "/v2/ogv/play/episodes?season_id=" + encodeURIComponent(seasonId) + "&platform=web");
  const episodes = [];
  let n = 0;
  (epsData.sections || []).forEach((sec, si) => {
    (sec.episodes || []).forEach((ep) => {
      if (!ep || !ep.episode_id) return;
      n++;
      episodes.push({ season: si + 1, number: n, ref: "e:" + ep.episode_id, title: cleanTitle(ep.long_title_display || ep.title_display) || t("Capítulo ", "Episode ") + n, still: posterUrl(ep.cover) });
    });
  });
  if (!episodes.length) throw kino.error("not_found", "empty", { userMessage: "Error." });
  return { series: { title: cleanTitle(season.title), poster: posterUrl(season.cover), backdrop: posterUrl(season.horizontal_cover), overview: cleanTitle(season.description || "").slice(0, 2000), genres: (season.styles || []).slice(0, 5).map((g) => cleanTitle(g && g.title)).filter(Boolean) }, episodes };
}
export async function prepare(ref) {
  try {
    if (mode() === "china" || !String(ref || "").includes(":")) {
      await ensureBuvid();
      if (sessdata()) { try { await getJson(API + "/x/web-interface/nav"); } catch (e) {} }
    }
  } catch (e) {}
}
export async function resolve(ref) {
  const s = String(ref || "");
  if (s.startsWith("e:")) return intlResolve("e", s.slice(2));
  if (s.startsWith("v:")) return intlResolve("v", s.slice(2));
  return cnResolve(s);
}
export async function track(ref, actionName) {
  if (String(kino.config.get("trakt_sync") || "true") === "false") return;
}

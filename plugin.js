// Bilibili — plugin para Kino v0.8.2
// - Añadidas filas personalizadas (Historial, Favoritos, Recomendados) si hay SESSDATA.

const API = "https://api.bilibili.com";
const WEB = "https://www.bilibili.com";

const INTL_API = "https://api.bilibili.tv/intl/gateway/web";
const INTL_WEB = "https://www.bilibili.tv";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const INTL_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function log(...args) {
  try {
    kino.log(...args);
  } catch {}
}

function mode() {
  const m = String(kino.config.get("region") || "").trim().toLowerCase();
  return m === "china" ? "china" : "intl";
}

function sessdata() {
  let s = String(kino.config.get("sessdata") || "").trim();
  if (s.toLowerCase().startsWith("sessdata=")) s = s.slice(9).trim();
  return s;
}

function cleanTitle(t) {
  return String(t || "").replace(/<[^>]+>/g, "").trim();
}

function posterUrl(pic) {
  if (!pic) return undefined;
  if (pic.startsWith("//")) return "https:" + pic;
  if (pic.startsWith("http")) return pic;
  if (pic.startsWith("pic.bstarstatic.com/")) return "https://" + pic;
  return undefined;
}

// ---------------------------------------------------------------------------
// Memoria
// ---------------------------------------------------------------------------

function readCache(key) {
  try {
    const raw = kino.storage.get(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.items) || !obj.ts) return null;
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
    return obj.items;
  } catch {
    return null;
  }
}

function writeCache(key, items, cap) {
  try {
    const slim = (items || []).slice(0, cap || 60).map((it) => ({
      id: it.id, ref: it.ref, title: it.title, kind: it.kind || "series",
      poster: it.poster, genres: it.genres, badges: it.badges,
      overview: it.overview ? String(it.overview).slice(0, 300) : undefined,
    }));
    kino.storage.set(key, JSON.stringify({ ts: Date.now(), items: slim }));
  } catch {}
}

// ---------------------------------------------------------------------------
// Autenticación y Buvid
// ---------------------------------------------------------------------------

let buvidCache = null;

async function ensureBuvid() {
  if (buvidCache) return buvidCache;
  try {
    const saved = kino.storage.get("buvid");
    if (saved && saved.b3) {
      buvidCache = saved;
      return buvidCache;
    }
  } catch {}

  try {
    const r = await kino.fetch(API + "/x/frontend/finger/spi", {
      headers: { "User-Agent": UA, Referer: WEB + "/", Origin: WEB },
      timeoutMs: 12000,
    });
    if (r.ok) {
      const data = r.json();
      if (data && data.code === 0 && data.data) {
        buvidCache = {
          b3: data.data.b_3 || data.data.buvid3 || "",
          b4: data.data.b_4 || data.data.buvid4 || "",
        };
        try { kino.storage.set("buvid", buvidCache); } catch {}
        return buvidCache;
      }
    }
  } catch (e) { log("buvid", e && e.message); }

  const rand = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = (Math.random() * 16) | 0;
    const v = c === "x" ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
  buvidCache = { b3: rand() + "infoc", b4: rand() };
  try { kino.storage.set("buvid", buvidCache); } catch {}
  return buvidCache;
}

function cookieHeader() {
  const parts = [];
  const sd = sessdata();
  if (sd) parts.push("SESSDATA=" + sd);
  if (buvidCache) {
    if (buvidCache.b3) parts.push("buvid3=" + buvidCache.b3);
    if (buvidCache.b4) parts.push("buvid4=" + buvidCache.b4);
  }
  return parts.length ? parts.join("; ") : undefined;
}

function baseHeaders(extra) {
  const h = { "User-Agent": UA, Referer: WEB + "/", Origin: WEB };
  const ck = cookieHeader();
  if (ck) h.Cookie = ck;
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}

async function getJson(url) {
  await ensureBuvid();
  const r = await kino.fetch(url, { headers: baseHeaders(), cookies: true, timeoutMs: 20000 });
  if (!r.ok) {
    if (r.status === 412) throw kino.error("unavailable", "HTTP 412", { userMessage: "Bilibili bloqueó la reproducción (412)." });
    throw kino.error("unavailable", "HTTP " + r.status, { userMessage: "Bilibili no respondió." });
  }
  const text = r.text();
  if (text.trim().startsWith("<")) throw kino.error("unavailable", "blocked", { userMessage: "Bilibili bloqueó la petición." });
  let data;
  try { data = JSON.parse(text); } catch { throw kino.error("unavailable", "bad json", { userMessage: "Respuesta inválida." }); }
  if (data.code !== 0 && data.code !== undefined) {
    const msg = data.message || String(data.code);
    if (data.code === -412 || data.code === 412) throw kino.error("unavailable", msg, { userMessage: "Bilibili bloqueó el stream (412)." });
    throw kino.error("unavailable", msg, { userMessage: "Bilibili: " + msg });
  }
  return data;
}

// ---------------------------------------------------------------------------
// Funciones de Cuenta (Historial, Favoritos, Recomendados)
// ---------------------------------------------------------------------------

async function fetchHistory() {
  if (!sessdata()) return [];
  try {
    const data = await getJson(API + "/x/web-interface/history/cursor?ps=20&type=all");
    const list = (data.data && data.data.list) || [];
    return list.map(v => {
      // Para el historial, el bvid viene dentro del objeto history
      const bvid = v.history ? v.history.bvid : v.bvid;
      return {
        id: bvid || v.aid,
        ref: bvid || ("av" + v.aid),
        title: cleanTitle(v.title),
        kind: "movie",
        poster: posterUrl(v.cover),
        overview: `Visto recientemente · ${cleanTitle(v.long_title)}`,
        progress: v.progress ? (v.progress / (v.duration || 1)) : 0
      };
    }).filter(i => i.ref);
  } catch (e) {
    log("Historial falló:", e.message);
    return [];
  }
}

async function fetchFavorites() {
  if (!sessdata()) return [];
  try {
    const foldersData = await getJson(API + "/x/v3/fav/folder/created/list-all");
    const folders = (foldersData.data && foldersData.data.list) || [];
    if (!folders.length) return [];
    
    // Tomamos la primera carpeta de favoritos por defecto
    const mediaId = folders[0].id;
    const itemsData = await getJson(API + "/x/v3/fav/resource/list?media_id=" + mediaId + "&ps=20&pn=1&platform=web");
    const medias = (itemsData.data && itemsData.data.medias) || [];
    
    return medias.map(v => ({
      id: v.bvid || v.id,
      ref: v.bvid || ("av" + v.id),
      title: cleanTitle(v.title),
      kind: "movie",
      poster: posterUrl(v.cover),
      overview: `De tu colección: ${folders[0].title}`
    })).filter(i => i.ref);
  } catch (e) {
    log("Favoritos falló:", e.message);
    return [];
  }
}

async function fetchRecommended() {
  if (!sessdata()) return [];
  try {
    // Intentamos el feed recomendado (sin firma WBI, a veces funciona solo con SESSDATA)
    const data = await getJson(API + "/x/web-interface/wbi/index/top/feed/rcmd?ps=20&fresh_type=4");
    const items = (data.data && data.data.item) || [];
    return items.map(v => ({
      id: v.bvid || v.id,
      ref: v.bvid || ("av" + v.id),
      title: cleanTitle(v.title),
      kind: "movie",
      poster: posterUrl(v.pic),
      overview: v.owner ? `Por ${cleanTitle(v.owner.name)}` : ""
    })).filter(i => i.ref);
  } catch (e) {
    log("Recomendados falló (posible WBI):", e.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Búsqueda y Home
// ---------------------------------------------------------------------------

function toVideoItem(v) {
  return {
    id: String(v.bvid || v.aid),
    ref: v.bvid || ("av" + v.aid),
    title: cleanTitle(v.title),
    kind: "movie",
    poster: posterUrl(v.pic),
    year: v.pubdate ? String(new Date(v.pubdate * 1000).getFullYear()) : undefined,
    overview: cleanTitle(v.description || v.desc || "").slice(0, 300),
  };
}

async function cnSearch(q) {
  const url = API + "/x/web-interface/search/all/v2?keyword=" + encodeURIComponent(q) + "&page=1";
  const data = await getJson(url);
  const blocks = (data.data && data.data.result) || [];
  let out = [];
  const seen = new Set();

  for (const block of blocks) {
    if (block.result_type !== "video") continue;
    const list = Array.isArray(block.data) ? block.data : [];
    for (const v of list) {
      const item = toVideoItem(v);
      if (!item.ref || seen.has(item.ref)) continue;
      let durSecs = 0;
      if (v.duration) {
        const parts = v.duration.split(':').map(Number);
        if (parts.length === 2) durSecs = parts[0] * 60 + parts[1];
        else if (parts.length === 3) durSecs = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      item._dur = durSecs;
      seen.add(item.ref);
      out.push(item);
    }
  }
  out.sort((a, b) => b._dur - a._dur);
  return out.map(i => { delete i._dur; return i; });
}

async function cnHome() {
  const rows = [];
  
  // Si hay sesión iniciada, cargamos las filas personalizadas primero
  if (sessdata()) {
    const [history, favorites, recommended] = await Promise.all([
      fetchHistory(),
      fetchFavorites(),
      fetchRecommended()
    ]);

    if (history.length > 0) rows.push({ id: "continue", title: "⏱️ Continuar viendo", items: history });
    if (favorites.length > 0) rows.push({ id: "favs", title: "❤️ Mis Favoritos", items: favorites });
    if (recommended.length > 0) rows.push({ id: "rec", title: "✨ Recomendado para ti", items: recommended });
  }

  // Luego cargamos las filas generales de rankings
  const urls = [
    { id: "popular", title: "Populares en Bilibili", url: API + "/x/web-interface/ranking/v2?rid=0&type=all" },
    { id: "anime", title: "Anime en Tendencia", url: API + "/x/web-interface/ranking/v2?rid=1&type=all" },
    { id: "series", title: "Series y Bangumi", url: API + "/x/web-interface/ranking/v2?rid=13&type=all" },
    { id: "cinema", title: "Cine y Películas", url: API + "/x/web-interface/ranking/v2?rid=23&type=all" }
  ];

  const promises = urls.map(async (u) => {
    try {
      const data = await getJson(u.url);
      const list = (data.data && data.data.list) || [];
      if (list.length > 0) {
        return { id: u.id, title: u.title, items: list.slice(0, 20).map(toVideoItem) };
      }
    } catch (e) { log("Error cargando fila " + u.title + ": " + e.message); }
    return null;
  });

  const generalRows = await Promise.all(promises);
  return rows.concat(generalRows.filter(r => r !== null));
}

// ---------------------------------------------------------------------------
// Resolución y Subtítulos
// ---------------------------------------------------------------------------

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
    const url = API + "/x/player/v2?bvid=" + bvid + "&cid=" + cid;
    const data = await getJson(url);
    const subs = data.data?.subtitle?.subtitles || [];
    const out = [];
    for (const sub of subs) {
      if (sub.subtitle_url && sub.lan) {
        let u = sub.subtitle_url;
        if (u.startsWith("//")) u = "https:" + u;
        out.push({ lang: sub.lan, url: u, format: "json" });
      }
    }
    return out;
  } catch (e) { return []; }
}

async function cnResolve(ref) {
  await ensureBuvid();
  const s = String(ref);
  let bvid = s.startsWith("BV") ? s : null;
  let aid = s.startsWith("av") ? s.slice(2) : null;
  if (!bvid && !aid) bvid = s;

  let viewUrl = API + "/x/web-interface/view?";
  if (bvid) viewUrl += "bvid=" + encodeURIComponent(bvid);
  else viewUrl += "aid=" + encodeURIComponent(aid);

  const view = await getJson(viewUrl);
  const vd = view.data;
  if (!vd) throw kino.error("not_found", "no data", { userMessage: "Video no encontrado" });

  const cid = vd.cid;
  const realBvid = vd.bvid;

  const attempts = [
    API + "/x/player/playurl?bvid=" + encodeURIComponent(realBvid) + "&cid=" + cid + "&qn=64&fnval=1&platform=html5&high_quality=1",
    API + "/x/player/playurl?bvid=" + encodeURIComponent(realBvid) + "&cid=" + cid + "&qn=32&fnval=1&platform=html5",
    API + "/x/player/playurl?avid=" + vd.aid + "&cid=" + cid + "&qn=32&fnval=0",
  ];

  let lastErr = null;
  for (const playUrl of attempts) {
    try {
      const play = await getJson(playUrl);
      const stream = streamFromPlay(play.data, realBvid);
      if (stream) {
        try {
          const subs = await cnSubtitles(realBvid, cid);
          if (subs.length) stream.subtitles = subs;
        } catch (subErr) {}
        return stream;
      }
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  throw kino.error("unavailable", "no stream", { userMessage: "No se pudo reproducir." });
}

// ---------------------------------------------------------------------------
// Acción de Vincular Cuenta
// ---------------------------------------------------------------------------

export async function action(key) {
  if (key !== "link_account") return;
  if (!kino.visualBrowser?.available) return { message: "El navegador visual no está disponible. Pega la cookie SESSDATA a mano." };

  const r = await kino.visualBrowser.open({
    url: "https://passport.bilibili.com/login",
    title: "Iniciar sesión en Bilibili",
    userAgent: "browser",
    doneWhen: { urlMatches: "*www.bilibili.com*" },
    collect: { cookies: ["SESSDATA"], storeAs: { setting: "sessdata", format: "header" } },
    timeoutMs: 600000,
  });

  if (r.status === "done" && r.stored) return { message: "¡Cuenta vinculada! La cookie se guardó correctamente." };
  if (r.status === "closed") return { message: "Inicio de sesión cancelado." };
  return { message: "No se pudo vincular. Inténtalo de nuevo." };
}

// ---------------------------------------------------------------------------
// Modo Internacional (Intacto)
// ---------------------------------------------------------------------------

let intlBuvidCache = null;

function intlBuvid() {
  if (intlBuvidCache) return intlBuvidCache;
  let saved = null;
  try { saved = kino.storage.get("intlBuvid"); } catch {}
  if (saved && saved.b3) { intlBuvidCache = saved; return intlBuvidCache; }
  const hex = "0123456789abcdef";
  const p = [];
  for (let i = 0; i < 32; i++) p.push(hex[(Math.random() * 16) | 0]);
  const uuid = p.slice(0, 8).join("") + "-" + p.slice(8, 12).join("") + "-" + p.slice(12, 16).join("") + "-" + p.slice(16, 20).join("") + "-" + p.slice(20, 32).join("");
  intlBuvidCache = { b3: uuid + "infoc", b4: uuid };
  try { kino.storage.set("intlBuvid", intlBuvidCache); } catch {}
  return intlBuvidCache;
}

function intlHeaders(extra) {
  const b = intlBuvid();
  const h = {
    "User-Agent": INTL_UA, Referer: INTL_WEB + "/", Origin: INTL_WEB,
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: "buvid3=" + b.b3 + "; buvid4=" + b.b4 + "; bstar-web-lang=en",
  };
  if (extra) for (const k in extra) h[k] = extra[k];
  return h;
}

async function intlJson(url) {
  const r = await kino.fetch(url, { headers: intlHeaders(), timeoutMs: 20000 });
  if (!r.ok) throw kino.error("unavailable", "HTTP " + r.status, { userMessage: "Bilibili internacional respondió HTTP " + r.status });
  let data;
  try { data = JSON.parse(r.text()); } catch { throw kino.error("unavailable", "bad json", { userMessage: "Respuesta inválida." }); }
  if (data.code !== 0) {
    const c = data.code;
    if (c === 10004001) throw kino.error("geo_blocked", "10004001", { userMessage: "Sin licencia para tu región." });
    if (c === 10004004 || c === 10004005 || c === 10023006) throw kino.error("auth_required", String(c), { userMessage: "Necesita cuenta o suscripción." });
    throw kino.error("unavailable", String(c), { userMessage: "Bilibili: " + String(data.message || c) });
  }
  return data.data;
}

async function intlSearch(q, cursor) {
  const pn = cursor ? Math.max(1, parseInt(cursor, 10) || 1) : 1;
  const data = await intlJson(INTL_API + "/v2/search_v2?keyword=" + encodeURIComponent(q) + "&platform=tv&s_locale=en_US&pn=" + pn + "&ps=20");
  const modules = (data && data.modules) || [];
  let out = [];
  const seen = new Set();

  for (const mod of modules) {
    const type = mod.type;
    if (!Array.isArray(mod.items)) continue;
    for (const it of mod.items) {
      if (type === "ogv" && it && it.season_id) {
        const id = "bts" + it.season_id;
        if (seen.has(id)) continue;
        seen.add(id);
        const badges = [];
        const st = cleanTitle(it.season_type).slice(0, 20);
        if (st) badges.push(st);
        const full = cleanTitle(it.index_show).slice(0, 20);
        if (full) badges.push(full);
        out.push({
          id, ref: "s:" + it.season_id, title: cleanTitle(it.title), kind: "series",
          poster: posterUrl(it.cover), overview: cleanTitle(it.description || "").slice(0, 300),
          genres: (Array.isArray(it.styles) ? it.styles : []).slice(0, 5).map((g) => cleanTitle(g && g.title).slice(0, 30)).filter(Boolean),
          badges: badges.slice(0, 3), _priority: 1
        });
      } else if (type === "ugc" && it && it.aid) {
        const id = "btv" + it.aid;
        if (seen.has(id)) continue;
        seen.add(id);
        const badges = [];
        const dur = cleanTitle(it.duration).slice(0, 20);
        if (dur) badges.push(dur);
        out.push({
          id, ref: "v:" + it.aid, title: cleanTitle(it.title), kind: "movie",
          poster: posterUrl(it.cover), badges: badges.slice(0, 3), _priority: 2
        });
      }
    }
  }
  out.sort((a, b) => a._priority - b._priority);
  out = out.map(i => { delete i._priority; return i; });
  if (out.length && pn < 5) return { items: out, next: String(pn + 1) };
  return out;
}

// ---------------------------------------------------------------------------
// Catálogo Internacional
// ---------------------------------------------------------------------------

function decodeJsonText(s) { try { return JSON.parse('"' + s + '"'); } catch { return s; } }

function parseAnimeHtml(html) {
  const out = [];
  const seen = new Set();
  const decoded = String(html).replace(/\\"/g, '"').replace(/&quot;/g, '"').replace(/&#34;/g, '"');
  const re = /"season_id"\s*:\s*"?(\d{1,12})"?/g;
  let m;
  while ((m = re.exec(decoded)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    const from = Math.max(0, m.index - 300);
    const win = decoded.slice(from, m.index + 300);
    let best = null, bestDist = 1e9;
    const reT = /"title"\s*:\s*"((?:[^"\\]|\\.){1,200})"/g;
    let tm;
    while ((tm = reT.exec(win)) !== null) {
      const dist = Math.abs(from + tm.index - m.index);
      if (dist < bestDist) { bestDist = dist; best = tm[1]; }
    }
    if (!best) continue;
    const title = cleanTitle(decodeJsonText(best));
    if (!title) continue;
    let poster, bestP = 1e9;
    const reP = /((?:https?:)?\/\/)?(pic\.bstarstatic\.com\/[^"\\ ]{10,400})/g;
    let pm2;
    while ((pm2 = reP.exec(win)) !== null) {
      const dist = Math.abs(from + pm2.index - m.index);
      if (dist < bestP) { bestP = dist; poster = posterUrl(pm2[1] ? pm2[1] + pm2[2] : "https://" + pm2[2]); }
    }
    seen.add(id);
    out.push({ id: "bts" + id, ref: "s:" + id, title, kind: "series", poster });
    if (out.length >= 80) break;
  }
  const reA = /<a[^>]+href="\/(?:[a-z]{2}\/)?play\/(\d{1,12})(?:\/\d{1,12})?[?"][^>]*>/g;
  while ((m = reA.exec(html)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    const win = html.slice(m.index, Math.min(html.length, m.index + 700));
    const am = win.match(/alt="([^"]{1,200})"/) || win.match(/title="([^"]{1,200})"/);
    if (!am) continue;
    const title = cleanTitle(am[1]);
    if (!title) continue;
    const cm = win.match(/((?:https?:)?\/\/)?(pic\.bstarstatic\.com\/[^"\\ ]{10,400})/);
    const poster = cm ? posterUrl(cm[1] ? cm[1] + cm[2] : "https://" + cm[2]) : undefined;
    seen.add(id);
    out.push({ id: "bts" + id, ref: "s:" + id, title, kind: "series", poster });
    if (out.length >= 80) break;
  }
  return out;
}

function itemsViaSelect(html) {
  const out = [], seen = new Set();
  let matches;
  try { matches = kino.html.select(html, "a[href*='/play/']"); } catch { return out; }
  if (!matches || !matches.length) return out;
  for (const el of matches) {
    const href = (el.attrs && el.attrs.href) || "";
    const pm = href.match(/\/(?:[a-z]{2}\/)?play\/(\d{1,12})(?:\/\d{1,12})?/);
    if (!pm) continue;
    const id = pm[1];
    if (seen.has(id)) continue;
    let title = cleanTitle((el.attrs && el.attrs.title) || "");
    if (!title) {
      const alt = (el.html || "").match(/alt="([^"]{1,200})"/);
      title = cleanTitle(alt ? alt[1] : el.text);
    }
    if (!title || title.length < 2) continue;
    const cm = (el.html || "").match(/((?:https?:)?\/\/)?(pic\.bstarstatic\.com\/[^"\\ )]{10,400})/);
    const poster = cm ? posterUrl(cm[1] ? cm[1] + cm[2] : "https://" + cm[2]) : undefined;
    seen.add(id);
    out.push({ id: "bts" + id, ref: "s:" + id, title, kind: "series", poster });
    if (out.length >= 80) break;
  }
  return out;
}

function itemsFromRenderedHtml(html) {
  const byRef = new Map();
  for (const it of itemsViaSelect(html)) if (it.ref && !byRef.has(it.ref)) byRef.set(it.ref, it);
  for (const it of parseAnimeHtml(html)) if (it.ref && !byRef.has(it.ref)) byRef.set(it.ref, it);
  return Array.from(byRef.values());
}

async function fetchPageViaBrowser(url, timeoutMs) {
  const ms = timeoutMs || 12000;
  const label = url.replace(INTL_WEB, "");
  const t0 = Date.now();
  let page = null;
  try { page = await kino.browser.page(url, { waitFor: "/play/", timeoutMs: ms }); } catch (e) { page = null; }
  if ((!page || !page.html) && Date.now() - t0 < 6000) {
    try { page = await kino.browser.page(url, { waitFor: "/play/", timeoutMs: ms }); } catch (e) { page = null; }
  }
  if (!page || !page.html) return [];
  return itemsFromRenderedHtml(page.html);
}

async function fetchAnimePageItems() {
  try {
    const r = await kino.fetch(INTL_WEB + "/en/anime", { headers: intlHeaders({ Referer: INTL_WEB + "/en/", "User-Agent": UA }), timeoutMs: 12000 });
    if (!r.ok) return [];
    return parseAnimeHtml(r.text());
  } catch (e) { return []; }
}

async function catalogSection(url, cacheKey, allowBrowser) {
  const cached = readCache(cacheKey);
  if (cached && cached.length) return { items: cached, loaded: false };
  if (!allowBrowser) return { items: [], loaded: false };
  let items = await fetchPageViaBrowser(url, url.indexOf("/popular") >= 0 ? 9000 : 12000);
  if (!items.length && url.indexOf("/anime") >= 0) items = await fetchAnimePageItems();
  if (items.length >= 4) { writeCache(cacheKey, items); return { items, loaded: true }; }
  return { items, loaded: true };
}

const HOME_KEYWORDS = [
  "LINK CLICK", "Healer Girl", "Love All Play", "RPG Real Estate", "Estab-Life", "Girls Band Cry", "BanG Dream", "Battle Through the Heavens", "Soul Land", "Throne of Seal", "The King's Avatar", "Heaven Official Blessing", "To Your Eternity", "The Faraway Paladin", "Shangri-La Frontier", "Summer Time Rendering", "Scissor Seven", "White Cat Legend",
  "Qi Refining for 3000 Years", "Carp Reborn", "A World Worth Protecting", "Rakshasa Street", "Spirits In Chinese Brushes", "The Invincible", "God Troubles Me", "Cinderella Chef", "The Eternal Strife", "The Story of Fengzhi Senla", "Master of the Star Spring",
];

async function destacadasAll() {
  const out = [], seen = new Set();
  const responses = await Promise.all(HOME_KEYWORDS.map((kw) => intlSearch(kw, null).catch(() => null)));
  for (const res of responses) {
    if (!res) continue;
    const items = Array.isArray(res) ? res : res.items || [];
    let added = 0;
    for (const it of items) {
      if (added >= 4) break;
      if (it && it.kind === "series" && it.ref && !seen.has(it.ref)) { seen.add(it.ref); out.push(it); added++; }
    }
  }
  return out;
}

async function destacadasCached(allowNet) {
  const cached = readCache("cache:destacadas2");
  if (cached && cached.length) return cached;
  if (!allowNet) return [];
  const items = await destacadasAll();
  if (items.length) writeCache("cache:destacadas2", items, 120);
  return items;
}

async function enrichItems(items, max) {
  const out = items.slice(), targets = [];
  for (const it of out) {
    if (targets.length >= (max || 30)) break;
    if (it && it.ref && it.ref.startsWith("s:") && !(it.genres && it.genres.length)) targets.push(it);
  }
  if (!targets.length) return out;
  await Promise.all(targets.map(async (it) => {
    try {
      const info = await intlJson(INTL_API + "/v2/ogv/play/season_info?season_id=" + encodeURIComponent(it.ref.slice(2)) + "&platform=web");
      const season = (info && info.season) || {};
      const genres = (Array.isArray(season.styles) ? season.styles : []).slice(0, 5).map((g) => cleanTitle(g && g.title).slice(0, 30)).filter(Boolean);
      if (genres.length) { it.genres = genres; if (!it.badges || !it.badges.length) it.badges = genres.slice(0, 3); }
      const desc = cleanTitle(season.description || "").slice(0, 300);
      if (desc && !it.overview) it.overview = desc;
    } catch {}
  }));
  return out;
}

function mergeItems() {
  const byRef = new Map();
  for (const group of arguments) {
    for (const it of group || []) if (it && it.ref && !byRef.has(it.ref)) byRef.set(it.ref, it);
  }
  return Array.from(byRef.values());
}

const GENRE_ES = { Action: "Acción", Adventure: "Aventura", Comedy: "Comedia", Romance: "Romance", Fantasy: "Fantasía", Mystery: "Misterio", Suspense: "Suspense", Drama: "Drama", "Sci-Fi": "Ciencia ficción", "Slice of Life": "Vida cotidiana", Sports: "Deportes", School: "Escolar", Historical: "Histórico", "Martial Arts": "Artes marciales", Horror: "Terror", Isekai: "Isekai", Harem: "Harem", "Chinese Style": "Estilo chino", "Hot-blooded": "De sangre caliente", "Boys Love": "Boys love", "Girls Love": "Girls love" };
const GENRE_SKIP = { Anime: 1, Movies: 1, TV: 1, Film: 1, "TV Shows": 1 };

function genreSections(pool) {
  const byGenre = new Map();
  for (const it of pool || []) {
    for (const g of (it && it.genres) || []) {
      const key = String(g || "").slice(0, 30);
      if (!key || GENRE_SKIP[key]) continue;
      if (!byGenre.has(key)) byGenre.set(key, []);
      byGenre.get(key).push(it);
    }
  }
  const sections = [];
  for (const g of byGenre.keys()) {
    const items = byGenre.get(g);
    if (items.length >= 4) sections.push({ genre: g, items });
  }
  sections.sort((a, b) => b.items.length - a.items.length);
  return sections;
}

async function intlHome() {
  const rows = [], t0 = Date.now();
  const anime = await catalogSection(INTL_WEB + "/en/anime", "cache:anime", true);
  if (anime.items.length >= 4) rows.push({ id: "bts-anime", title: "Anime en Bilibili internacional", items: anime.items.slice(0, 20), ref: "browse:anime", genre: "anime" });

  let popularAllow = !anime.loaded;
  if (anime.loaded && !anime.items.length && Date.now() - t0 < 16000) popularAllow = true;
  const popular = await catalogSection(INTL_WEB + "/en/popular", "cache:popular", popularAllow);
  if (popular.items.length >= 4) rows.push({ id: "bts-popular", title: "Tendencias de Bilibili", items: popular.items.slice(0, 20), ref: "browse:popular" });

  const destacadas = await destacadasCached(true);
  const pool = mergeItems(anime.items, popular.items, destacadas);
  for (const g of genreSections(pool).slice(0, 4)) {
    rows.push({ id: "bts-genre-" + g.genre.replace(/[^a-z0-9]+/gi, "-").slice(0, 20), title: GENRE_ES[g.genre] || g.genre, items: g.items.slice(0, 20), ref: "browse:g:" + encodeURIComponent(g.genre) });
  }
  if (destacadas.length) rows.push({ id: "bts-destacadas", title: "Series destacadas", items: destacadas.slice(0, 20), ref: "browse:catalog" });
  if (rows.length) return rows;
  throw kino.error("unavailable", "home vacío", { userMessage: "No se pudo cargar el catálogo." });
}

function qLabel(q) {
  const map = { 120: "4K", 116: "1080P HDR", 112: "1080P+", 80: "1080p", 74: "720P60", 64: "720p", 32: "480p", 16: "360p", 15: "240p", 6: "240p" };
  return map[q] || String(q || "") + "p";
}

async function intlSubtitles(epId) {
  const data = await intlJson(INTL_API + "/v2/subtitle?platform=web&s_locale=en_US&episode_id=" + encodeURIComponent(epId));
  const list = data && (data.subtitles || data.video_subtitle || data.subtitle) || [];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const sub of list) {
    if (!sub || typeof sub !== "object") continue;
    const url = sub.url || (sub.srt && sub.srt.url) || (sub.ass && sub.ass.url);
    if (!url || !/^https:\/\//.test(url)) continue;
    if (!/\.srt(\?|$)/i.test(url)) continue;
    out.push({ lang: cleanTitle(sub.lang_key || "en").slice(0, 20) || "en", url, format: "srt" });
    if (out.length >= 30) break;
  }
  return out;
}

async function intlResolve(kind, id) {
  const param = kind === "e" ? "ep_id" : "aid";
  const data = await intlJson(INTL_API + "/playurl?s_locale=en_US&platform=web&" + param + "=" + encodeURIComponent(id));
  const p = data && data.playurl;
  if (!p) throw kino.error("not_found", "no playurl", { userMessage: "No se encontró el video." });

  const vids = (Array.isArray(p.video) ? p.video : []).map((x) => (x && x.video_resource) || x || {}).filter((v) => v && v.url && /^https:\/\//.test(v.url)).sort((a, b) => (b.quality || 0) - (a.quality || 0));
  if (!vids.length) throw kino.error("unavailable", "no free urls", { userMessage: "No hay enlaces libres." });

  const auds = (Array.isArray(p.audio_resource) ? p.audio_resource : []).filter((a) => a && a.url && /^https:\/\//.test(a.url)).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
  const headers = { "User-Agent": INTL_UA, Referer: INTL_WEB + "/" };
  const stream = { url: vids[0].url, mime: "video/mp4", headers, label: qLabel(vids[0].quality) };
  if (p.duration) stream.durationMs = p.duration;
  if (auds.length) stream.audioTracks = [{ lang: "zh", url: auds[0].url, label: "Original" }];
  if (vids.length > 1) stream.alternatives = vids.slice(1, 8).map((v) => ({ url: v.url, mime: "video/mp4", headers, label: qLabel(v.quality) }));

  if (kind === "e") {
    try { const subs = await intlSubtitles(id); if (subs.length) stream.subtitles = subs; } catch (e) {}
  }
  return stream;
}

// ---------------------------------------------------------------------------
// Exportaciones
// ---------------------------------------------------------------------------

export async function search(query) {
  const q = (query.q || "").trim();
  if (!q) return [];
  if (mode() === "china") return cnSearch(q);
  return intlSearch(q, query.cursor);
}

export async function home() {
  if (mode() === "china") return cnHome();
  return intlHome();
}

export async function browse(ref, cursor) {
  if (cursor) return { items: [], next: null };
  const r = String(ref);
  if (r === "browse:anime") {
    let items;
    const anime = await catalogSection(INTL_WEB + "/en/anime", "cache:anime", true);
    items = anime.items;
    if (!items.length) items = await destacadasCached(true);
    const enriched = await enrichItems(items, 25);
    if (anime.items.length) writeCache("cache:anime", anime.items, 60);
    return { items: enriched.slice(0, 100), next: null };
  }
  if (r === "browse:popular") {
    const popular = await catalogSection(INTL_WEB + "/en/popular", "cache:popular", true);
    if (!popular.items.length) throw kino.error("unavailable", "tendencias vacías", { userMessage: "Tendencias no pudo cargar." });
    const enrichedPop = await enrichItems(popular.items, 25);
    writeCache("cache:popular", popular.items, 60);
    return { items: enrichedPop.slice(0, 100), next: null };
  }
  if (r.startsWith("browse:g:")) {
    const genre = decodeURIComponent(r.slice(9));
    const pool = await destacadasCached(true);
    const sec = genreSections(pool).find((s) => s.genre === genre);
    const items = sec ? sec.items : [];
    if (!items.length) throw kino.error("unavailable", "genero vacio", { userMessage: "Esta sección aún no tiene series." });
    const enriched = await enrichItems(items, 25);
    writeCache("cache:destacadas2", pool, 120);
    return { items: enriched.slice(0, 100), next: null };
  }
  if (r === "browse:catalog") {
    const anime = await catalogSection(INTL_WEB + "/en/anime", "cache:anime", false);
    const popular = await catalogSection(INTL_WEB + "/en/popular", "cache:popular", !anime.loaded);
    const destacadas = await destacadasCached(true);
    const all = mergeItems(anime.items, popular.items, destacadas);
    if (!all.length) throw kino.error("unavailable", "catálogo vacío", { userMessage: "El catálogo aún se está cargando." });
    const enriched = await enrichItems(all, 25);
    writeCache("cache:destacadas2", all, 120);
    return { items: enriched.slice(0, 100), next: null };
  }
  return { items: [], next: null };
}

export async function episodes(ref) {
  const s = String(ref || "");
  if (!s.startsWith("s:")) return { episodes: [] };
  const seasonId = s.slice(2);

  const info = await intlJson(INTL_API + "/v2/ogv/play/season_info?season_id=" + encodeURIComponent(seasonId) + "&platform=web");
  const season = (info && info.season) || {};
  const epsData = await intlJson(INTL_API + "/v2/ogv/play/episodes?season_id=" + encodeURIComponent(seasonId) + "&platform=web");
  const sections = (epsData && epsData.sections) || [];

  const episodes = [];
  let autoNum = 0;
  (Array.isArray(sections) ? sections : []).forEach((sec, si) => {
    const list = Array.isArray(sec && sec.episodes) ? sec.episodes : [];
    for (const ep of list) {
      if (!ep || !ep.episode_id) continue;
      autoNum++;
      const em = String(ep.title_display || ep.short_title_display || "").match(/E(\d{1,4})/);
      let num = em ? parseInt(em[1], 10) : autoNum;
      if (!(num >= 1)) num = autoNum;
      let title = cleanTitle(ep.long_title_display || ep.title_display) || "Capítulo " + num;
      const limitText = cleanTitle(ep.limit_text).slice(0, 12);
      if (ep.limit && limitText) title += " · " + limitText;
      episodes.push({ season: si + 1, number: num, ref: "e:" + ep.episode_id, title, still: posterUrl(ep.cover) });
    }
  });

  if (!episodes.length) throw kino.error("not_found", "sin episodios", { userMessage: "No se encontraron episodios." });
  return {
    series: {
      title: cleanTitle(season.title), poster: posterUrl(season.cover), backdrop: posterUrl(season.horizontal_cover),
      overview: cleanTitle(season.description || "").slice(0, 2000),
      genres: (Array.isArray(season.styles) ? season.styles : []).slice(0, 5).map((g) => cleanTitle(g && g.title).slice(0, 30)).filter(Boolean),
    },
    episodes,
  };
}

export async function resolve(ref) {
  const s = String(ref || "");
  if (s.startsWith("e:")) return intlResolve("e", s.slice(2));
  if (s.startsWith("v:")) return intlResolve("v", s.slice(2));
  return cnResolve(s);
      }

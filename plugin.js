// Bilibili — plugin de Bilibili para Kino · github.com/Susejing/kino-plugin-bilibili
// Copyright (C) 2026 Susejing
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// Kino plugin: Bilibili v1.5.1
// Integración completa con login real, firmas WBI (con fallback) y progreso.

const API = "https://api.bilibili.com";
const WEB = "https://www.bilibili.com";

const INTL_API = "https://api.bilibili.tv/intl/gateway/web";
const INTL_WEB = "https://www.bilibili.tv";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const INTL_UA =
  "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Utilidades Generales
// ---------------------------------------------------------------------------

function log(...args) {
  try {
    kino.log(...args);
  } catch {}
}

function t(es, en) {
  const lang = String(kino.lang || "es").toLowerCase();
  return lang.startsWith("es") ? es : en;
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

function dedeuserid() {
  return String(kino.config.get("dedeuserid") || "").trim();
}

function biliJct() {
  return String(kino.config.get("bili_jct") || "").trim();
}

function cleanTitle(title) {
  return String(title || "").replace(/<[^>]+>/g, "").trim();
}

function posterUrl(pic) {
  if (!pic) return undefined;
  if (pic.startsWith("//")) return "https:" + pic;
  if (pic.startsWith("http")) return pic;
  if (pic.startsWith("pic.bstarstatic.com/")) return "https://" + pic;
  return undefined;
}

function decodeJsonText(s) {
  try {
    return JSON.parse('"' + s + '"');
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// Tema Visual
// ---------------------------------------------------------------------------

export function theme() {
  return { primary: "#FB7299", background: "#0E0E0E" };
}

// ---------------------------------------------------------------------------
// Memoria (Caché)
// ---------------------------------------------------------------------------

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
      poster: it.poster, genres: it.genres, badges: it.badges,
      overview: it.overview ? String(it.overview).slice(0, 300) : undefined,
    }));
    kino.storage.set(key, JSON.stringify({ ts: Date.now(), items: slim }));
  } catch {}
}

function failKeyOf(url) { return url.indexOf("/popular") >= 0 ? "cache:popularFail" : "cache:animeFail"; }
function failRecent(key) {
  try {
    const raw = kino.storage.get(key);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    return !!(obj && obj.ts && Date.now() - obj.ts < 5 * 60 * 1000);
  } catch { return false; }
}
function setFailMarker(key) { try { kino.storage.set(key, JSON.stringify({ ts: Date.now() })); } catch {} }

// ---------------------------------------------------------------------------
// WBI Signature Generator (con Fallback seguro)
// ---------------------------------------------------------------------------

const mixinKeyEncTab = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

function getMixinKey(orig) {
  let temp = "";
  for (let i = 0; i < 64; i++) temp += orig[mixinKeyEncTab[i]];
  return temp.slice(0, 32);
}

async function getWbiKeys() {
  const cached = readCache("cache:wbi_keys");
  if (cached && cached.length >= 2) return { img_key: cached[0], sub_key: cached[1] };
  try {
    const navRes = await kino.fetch(API + "/x/web-interface/nav", { headers: { "User-Agent": UA, Referer: WEB + "/" } });
    if (navRes.ok) {
      const navData = navRes.json();
      const wbi_img = navData.data?.wbi_img;
      if (wbi_img) {
        const img_key = wbi_img.img_url.split('/').pop().split('.')[0];
        const sub_key = wbi_img.sub_url.split('/').pop().split('.')[0];
        writeCache("cache:wbi_keys", [img_key, sub_key], 2);
        return { img_key, sub_key };
      }
    }
  } catch (e) { log("Error obteniendo WBI keys:", e.message); }
  return null;
}

async function md5(str) {
  // Si crypto.subtle no existe en este entorno de Kino, lanzamos error para que el fallback actúe
  if (!crypto || !crypto.subtle) throw new Error("crypto.subtle no soportado");
  const msgBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("MD5", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
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
    
    const sortedParams = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const query = sortedParams.map(([key, value]) => {
      const cleanValue = String(value).replace(/[!'()*]/g, "");
      return `${encodeURIComponent(key)}=${encodeURIComponent(cleanValue)}`;
    }).join("&");

    const w_rid = await md5(query + mixin_key);
    params.set("w_rid", w_rid);
    return urlObj.origin + urlObj.pathname + "?" + params.toString();
  } catch (e) {
    log("Firma WBI falló, usando URL original (fallback):", e.message);
    return url; // Fallback: si falla el MD5, devolvemos la URL tal cual
  }
}

// ---------------------------------------------------------------------------
// Modo China - Autenticación y Cabeceras
// ---------------------------------------------------------------------------

let buvidCache = null;

async function ensureBuvid() {
  if (buvidCache) return buvidCache;
  try {
    const saved = kino.storage.get("buvid");
    if (saved && saved.b3) { buvidCache = saved; return buvidCache; }
  } catch {}
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
  } catch (e) { log("buvid", e && e.message); }
  const rand = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = (Math.random() * 16) | 0; const v = c === "x" ? n : (n & 0x3) | 0x8; return v.toString(16);
  });
  buvidCache = { b3: rand() + "infoc", b4: rand() };
  try { kino.storage.set("buvid", buvidCache); } catch {}
  return buvidCache;
}

function cookieHeader() {
  const parts = [];
  const sd = sessdata();
  const du = dedeuserid();
  const jct = biliJct();
  
  if (sd) parts.push("SESSDATA=" + sd);
  if (du) parts.push("DedeUserID=" + du);
  if (jct) parts.push("bili_jct=" + jct);
  
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
  if (extra) { for (const k in extra) h[k] = extra[k]; }
  return h;
}

async function getJson(url, retry = true) {
  await ensureBuvid();
  // Intentamos firmar, si falla devolverá la url normal
  const signedUrl = await signWbi(url); 
  
  const r = await kino.fetch(signedUrl, { headers: baseHeaders(), cookies: true, timeoutMs: 20000 });

  if (!r.ok) {
    if (r.status === 412) {
      if (retry) {
        await new Promise(res => setTimeout(res, 2000));
        return getJson(url, false);
      }
      throw kino.error("unavailable", "HTTP 412", { userMessage: t("Bilibili bloqueó la petición (412). Verifica tu cuenta o usa VPN.", "Bilibili blocked the request (412). Verify your account or use VPN.") });
    }
    throw kino.error("unavailable", "HTTP " + r.status, { userMessage: t("Bilibili no respondió.", "Bilibili did not respond.") });
  }

  const text = r.text();
  if (text.trim().startsWith("<")) throw kino.error("unavailable", "blocked", { userMessage: t("Bilibili bloqueó la petición.", "Bilibili blocked the request.") });

  let data;
  try { data = JSON.parse(text); } catch { throw kino.error("unavailable", "bad json", { userMessage: t("Respuesta inválida de Bilibili.", "Invalid Bilibili response.") }); }

  if (data.code !== 0 && data.code !== undefined) {
    const msg = data.message || String(data.code);
    if (data.code === -412 || data.code === 412) {
      if (retry) {
         await new Promise(res => setTimeout(res, 2000));
         return getJson(url, false);
      }
      throw kino.error("unavailable", msg, { userMessage: t("Bilibili bloqueó el stream (412).", "Bilibili blocked the stream (412).") });
    }
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

// ---------------------------------------------------------------------------
// Acción: Vincular Cuenta y Verificar Cuenta
// ---------------------------------------------------------------------------

export async function action(key) {
  if (key === "link_account") {
    if (!kino.visualBrowser?.available) return { message: t("Navegador no disponible.", "Browser not available.") };

    const r = await kino.visualBrowser.open({
      url: "https://passport.bilibili.com/login",
      title: t("Iniciar sesión en Bilibili", "Login to Bilibili"),
      userAgent: "browser",
      doneWhen: { urlMatches: "*www.bilibili.com*" },
      collect: {
        cookies: ["SESSDATA", "DedeUserID", "bili_jct"],
        storeAs: { setting: "auto", format: "header" },
      },
      timeoutMs: 600000,
    });

    if (r.status === "done" && r.stored) {
      return { message: t("¡Sesión completa vinculada! (SESSDATA, DedeUserID, bili_jct)", "Full session linked! (SESSDATA, DedeUserID, bili_jct)") };
    } else if (r.status === "closed") {
      return { message: t("Inicio de sesión cancelado.", "Login cancelled.") };
    } else {
      return { message: t("No se pudo vincular la cuenta. Inténtalo de nuevo.", "Could not link account. Try again.") };
    }
  }

  if (key === "verify_account") {
    if (!sessdata()) return { message: t("Primero debes vincular tu cuenta.", "You must link your account first.") };
    
    try {
      const data = await getJson(API + "/x/web-interface/nav");
      if (data.data && data.data.isLogin) {
        const user = data.data;
        return { 
          message: t(
            `✅ Sesión activa:\n👤 Usuario: ${user.uname}\n🆔 UID: ${user.mid}\n⭐ Nivel: ${user.level_info.current_level}`, 
            `✅ Active session:\n👤 User: ${user.uname}\n🆔 UID: ${user.mid}\n⭐ Level: ${user.level_info.current_level}`
          ) 
        };
      } else {
        return { message: t("❌ La sesión no es válida o la cookie expiró. Vuelve a vincular.", "❌ Session is invalid or cookie expired. Re-link.") };
      }
    } catch (e) {
      return { message: t("❌ Error al verificar: ", "❌ Error verifying: ") + e.message };
    }
  }

  if (key === "qr_login") {
    if (!kino.visualBrowser?.available) return { message: t("Navegador no disponible.", "Browser not available.") };
    const r = await kino.visualBrowser.open({
      url: "https://passport.bilibili.com/login",
      title: t("Escanea el QR desde tu móvil", "Scan QR from your mobile"),
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      doneWhen: { urlMatches: "*www.bilibili.com*" },
      collect: {
        cookies: ["SESSDATA", "DedeUserID", "bili_jct"],
        storeAs: { setting: "auto", format: "header" },
      },
      timeoutMs: 600000,
    });
    if (r.status === "done" && r.stored) return { message: t("¡Cuenta vinculada con éxito!", "Account linked successfully!") };
    if (r.status === "closed") return { message: t("Inicio de sesión cancelado.", "Login cancelled.") };
    return { message: t("Error al vincular. Inténtalo de nuevo.", "Link error. Try again.") };
  }
}

// ---------------------------------------------------------------------------
// Contenido de Usuario (Historial, Favoritos, Recomendados)
// ---------------------------------------------------------------------------

async function fetchHistory() {
  if (!sessdata()) return [];
  try {
    const data = await getJson(API + "/x/web-interface/history/cursor?ps=20&type=all");
    const list = (data.data && data.data.list) || [];
    return list.map((v) => {
      const bvid = v.history ? v.history.bvid : v.bvid;
      return {
        id: bvid || v.aid, ref: bvid || ("av" + v.aid), title: cleanTitle(v.title),
        kind: "movie", poster: posterUrl(v.cover), overview: t("Visto recientemente · ", "Watched recently · ") + cleanTitle(v.long_title),
      };
    }).filter((i) => i.ref);
  } catch (e) { return []; }
}

async function fetchFavorites() {
  if (!sessdata()) return [];
  try {
    const foldersData = await getJson(API + "/x/v3/fav/folder/created/list-all");
    const folders = (foldersData.data && foldersData.data.list) || [];
    if (!folders.length) return [];
    const mediaId = folders[0].id;
    const itemsData = await getJson(API + "/x/v3/fav/resource/list?media_id=" + mediaId + "&ps=20&pn=1&platform=web");
    const medias = (itemsData.data && itemsData.data.medias) || [];
    return medias.map((v) => ({
      id: v.bvid || v.id, ref: v.bvid || ("av" + v.id), title: cleanTitle(v.title),
      kind: "movie", poster: posterUrl(v.cover), overview: t("De tu colección: ", "From collection: ") + folders[0].title,
    })).filter((i) => i.ref);
  } catch (e) { return []; }
}

async function fetchRecommended() {
  if (!sessdata()) return [];
  try {
    const data = await getJson(API + "/x/web-interface/wbi/index/top/feed/rcmd?ps=20&fresh_type=4");
    const items = (data.data && data.data.item) || [];
    return items.map((v) => ({
      id: v.bvid || v.id, ref: v.bvid || ("av" + v.id), title: cleanTitle(v.title),
      kind: "movie", poster: posterUrl(v.pic), overview: v.owner ? t("Por ", "By ") + cleanTitle(v.owner.name) : "",
    })).filter((i) => i.ref);
  } catch (e) { return []; }
}

// ---------------------------------------------------------------------------
// Búsqueda China
// ---------------------------------------------------------------------------

async function cnSearch(q) {
  let allItems = [];
  const seen = new Set();
  for (let page = 1; page <= 4; page++) {
    const url = API + "/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(q) + "&page=" + page;
    try {
      const data = await getJson(url);
      const list = data.data?.result || [];
      for (const v of list) {
        const item = toVideoItem(v);
        item.title = item.title.replace(/<\/?em[^>]*>/g, "");
        if (item.ref && !seen.has(item.ref)) { seen.add(item.ref); allItems.push(item); }
      }
      if (list.length < 20) break;
    } catch (e) { break; }
  }
  return allItems;
}

export async function scopedSearch(query, scope) {
  const q = (query.q || "").trim();
  if (!q) return [];
  if (mode() === "china") return cnSearch(q);
  const res = await intlSearch(q, null);
  const items = Array.isArray(res) ? res : res.items || [];
  return scope === "series" ? items.filter((i) => i.kind === "series") : items;
}

async function cnKeywordRow(keyword, title) {
  try {
    const url = API + "/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(keyword);
    const data = await getJson(url);
    const list = data.data?.result || [];
    if (!list.length) return null;
    return { id: "search_" + keyword, title: title, items: list.slice(0, 20).map(toVideoItem), ref: "browse:keyword:" + encodeURIComponent(keyword) };
  } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Inicio (Home) China
// ---------------------------------------------------------------------------

async function cnHome() {
  const rows = [];
  if (sessdata()) {
    const [history, favorites, recommended] = await Promise.all([fetchHistory(), fetchFavorites(), fetchRecommended()]);
    if (history.length > 0) rows.push({ id: "continue", title: t("⏱️ Continuar viendo", "⏱️ Continue watching"), items: history });
    if (favorites.length > 0) rows.push({ id: "favs", title: t("❤️ Mis Favoritos", "❤️ My Favorites"), items: favorites });
    if (recommended.length > 0) rows.push({ id: "rec", title: t("✨ Recomendado para ti", "✨ Recommended for you"), items: recommended });
  }

  const urls = [
    { id: "popular", title: t("🔥 Populares", "🔥 Popular"), url: API + "/x/web-interface/ranking/v2?rid=0&type=all" },
    { id: "anime", title: t("🌸 Anime (Bangumi)", "🌸 Anime (Bangumi)"), url: API + "/x/web-interface/ranking/v2?rid=13&type=all" },
    { id: "cinema", title: t("🎬 Cine y Películas", "🎬 Cinema & Movies"), url: API + "/x/web-interface/ranking/v2?rid=23&type=all" },
    { id: "doramas", title: t("📺 Doramas y Series", "📺 Doramas & TV Series"), url: API + "/x/web-interface/ranking/v2?rid=11&type=all" },
    { id: "amv", title: t("🎵 AMV y MAD", "🎵 AMV & MAD"), url: API + "/x/web-interface/ranking/v2?rid=1&type=all" },
    { id: "games", title: t("🎮 Juegos y Galgames", "🎮 Games & Galgames"), url: API + "/x/web-interface/ranking/v2?rid=4&type=all" }
  ];

  const promises = urls.map(async (u) => {
    try {
      const data = await getJson(u.url);
      if (data.data?.list?.length) return { id: u.id, title: u.title, items: data.data.list.slice(0, 20).map(toVideoItem), ref: "browse:rid:" + u.id };
    } catch (e) {}
    return null;
  });

  const donghuaPromise = cnKeywordRow("国创", t("🐉 Donghua (Animación China)", "🐉 Donghua (Chinese Animation)"));
  const generalRows = await Promise.all(promises);
  rows.push(...generalRows.filter((r) => r !== null));
  const donghua = await donghuaPromise;
  if (donghua) rows.push(donghua);
  return rows;
}

// ---------------------------------------------------------------------------
// Resolución y Sincronización de Progreso
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
    const data = await getJson(API + "/x/player/v2?bvid=" + bvid + "&cid=" + cid);
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
  if (!vd) throw kino.error("not_found", "no data", { userMessage: t("Video no encontrado.", "Video not found.") });

  const cid = vd.cid;
  const realBvid = vd.bvid;

  const attempts = [
    API + "/x/player/wbi/playurl?bvid=" + encodeURIComponent(realBvid) + "&cid=" + cid + "&qn=64&fnval=1&platform=html5&high_quality=1",
    API + "/x/player/wbi/playurl?bvid=" + encodeURIComponent(realBvid) + "&cid=" + cid + "&qn=32&fnval=1&platform=html5",
    API + "/x/player/wbi/playurl?avid=" + vd.aid + "&cid=" + cid + "&qn=32&fnval=0",
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
  throw kino.error("unavailable", "no stream", { userMessage: t("No se pudo reproducir.", "Could not play.") });
}

// Sincronizar progreso de reproducción con la cuenta (Heartbeat)
export async function track(ref, action) {
  if (!sessdata() || !biliJct()) return; // Requiere sesión completa
  if (String(kino.config.get("trakt_sync") || "true") === "false") return;
  
  const s = String(ref);
  const id = s.includes(":") ? s.split(":")[1] : s;
  const isEp = s.startsWith("e:");
  
  if (!isEp && action === "progress") {
    try {
      const view = await getJson(API + "/x/web-interface/view?bvid=" + id);
      const cid = view.data.cid;
      const progress = 10;
      
      const body = new URLSearchParams({
        bvid: id,
        cid: cid,
        progress: progress,
        csrf: biliJct()
      });
      
      await kino.fetch(API + "/x/v2/history/report", {
        method: "POST",
        headers: baseHeaders({ "Content-Type": "application/x-www-form-urlencoded" }),
        body: body.toString()
      });
      log("Progreso sincronizado con Bilibili");
    } catch (e) {
      log("Error sync progress:", e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Modo Internacional (bilibili.tv)
// ---------------------------------------------------------------------------

let intlBuvidCache = null;
function intlBuvid() {
  if (intlBuvidCache) return intlBuvidCache;
  let saved = null; try { saved = kino.storage.get("intlBuvid"); } catch {}
  if (saved && saved.b3) { intlBuvidCache = saved; return intlBuvidCache; }
  const hex = "0123456789abcdef"; const p = [];
  for (let i = 0; i < 32; i++) p.push(hex[(Math.random() * 16) | 0]);
  const uuid = p.slice(0, 8).join("") + "-" + p.slice(8, 12).join("") + "-" + p.slice(12, 16).join("") + "-" + p.slice(16, 20).join("") + "-" + p.slice(20, 32).join("");
  intlBuvidCache = { b3: uuid + "infoc", b4: uuid };
  try { kino.storage.set("intlBuvid", intlBuvidCache); } catch {}
  return intlBuvidCache;
}

function intlHeaders(extra) {
  const b = intlBuvid();
  const h = { "User-Agent": INTL_UA, Referer: INTL_WEB + "/", Origin: INTL_WEB, "Accept-Language": "en-US,en;q=0.9", Cookie: "buvid3=" + b.b3 + "; buvid4=" + b.b4 + "; bstar-web-lang=en" };
  if (extra) { for (const k in extra) h[k] = extra[k]; }
  return h;
}

async function intlJson(url) {
  const r = await kino.fetch(url, { headers: intlHeaders(), timeoutMs: 20000 });
  if (!r.ok) throw kino.error("unavailable", "HTTP " + r.status, { userMessage: t("Bilibili Intl HTTP ", "Bilibili Intl HTTP ") + r.status });
  let data;
  try { data = JSON.parse(r.text()); } catch { throw kino.error("unavailable", "bad json", { userMessage: t("Error.", "Error.") }); }
  if (data.code !== 0) {
    const c = data.code;
    if (c === 10004001) throw kino.error("geo_blocked", "10004001", { userMessage: t("Sin licencia.", "No license.") });
    if ([10004004, 10004005, 10023006].includes(c)) throw kino.error("auth_required", String(c), { userMessage: t("Requiere cuenta.", "Requires account.") });
    throw kino.error("unavailable", String(c), { userMessage: "Bilibili: " + String(data.message || c) });
  }
  return data.data;
}

async function intlSearch(q, cursor) {
  const pn = cursor ? Math.max(1, parseInt(cursor, 10) || 1) : 1;
  const data = await intlJson(INTL_API + "/v2/search_v2?keyword=" + encodeURIComponent(q) + "&platform=tv&s_locale=en_US&pn=" + pn + "&ps=20");
  let out = []; const seen = new Set();
  for (const mod of (data.modules || [])) {
    for (const it of (mod.items || [])) {
      if (mod.type === "ogv" && it.season_id) {
        const id = "bts" + it.season_id; if (seen.has(id)) continue; seen.add(id);
        out.push({ id, ref: "s:" + it.season_id, title: cleanTitle(it.title), kind: "series", poster: posterUrl(it.cover), _priority: 1 });
      } else if (mod.type === "ugc" && it.aid) {
        const id = "btv" + it.aid; if (seen.has(id)) continue; seen.add(id);
        out.push({ id, ref: "v:" + it.aid, title: cleanTitle(it.title), kind: "movie", poster: posterUrl(it.cover), _priority: 2 });
      }
    }
  }
  out.sort((a, b) => a._priority - b._priority);
  out = out.map(i => { delete i._priority; return i; });
  return (out.length && pn < 5) ? { items: out, next: String(pn + 1) } : out;
}

// Parser de Catálogo (Internacional)
function parseAnimeHtml(html) {
  const out = []; const seen = new Set();
  const decoded = String(html).replace(/\\"/g, '"').replace(/&quot;/g, '"').replace(/&#34;/g, '"');
  const re = /"season_id"\s*:\s*"?(\d{1,12})"?/g; let m;
  while ((m = re.exec(decoded)) !== null) {
    const id = m[1]; if (seen.has(id)) continue;
    const from = Math.max(0, m.index - 300); const win = decoded.slice(from, m.index + 300);
    let best = null, bestDist = 1e9;
    const reT = /"title"\s*:\s*"((?:[^"\\]|\\.){1,200})"/g; let tm;
    while ((tm = reT.exec(win)) !== null) {
      const dist = Math.abs(from + tm.index - m.index);
      if (dist < bestDist) { bestDist = dist; best = tm[1]; }
    }
    if (!best) continue;
    const title = cleanTitle(decodeJsonText(best)); if (!title) continue;
    let poster, bestP = 1e9;
    const reP = /((?:https?:)?\/\/)?(pic\.bstarstatic\.com\/[^"\\ ]{10,400})/g; let pm2;
    while ((pm2 = reP.exec(win)) !== null) {
      const dist = Math.abs(from + pm2.index - m.index);
      if (dist < bestP) { bestP = dist; poster = posterUrl(pm2[1] ? pm2[1] + pm2[2] : "https://" + pm2[2]); }
    }
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
    const id = pm[1]; if (seen.has(id)) continue;
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
  let page = null;
  try { page = await kino.browser.page(url, { waitFor: "/play/", timeoutMs: timeoutMs || 12000 }); } catch (e) {}
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
  if (cached?.length) return { items: cached, loaded: false };
  if (!allowBrowser || failRecent(failKeyOf(url))) return { items: [], loaded: false };
  let items = await fetchPageViaBrowser(url, url.indexOf("/popular") >= 0 ? 9000 : 12000);
  if (!items.length && url.indexOf("/anime") >= 0) items = await fetchAnimePageItems();
  if (items.length >= 4) { writeCache(cacheKey, items); return { items, loaded: true }; }
  setFailMarker(failKeyOf(url));
  return { items, loaded: true };
}

const HOME_KEYWORDS = [
  "LINK CLICK", "Healer Girl", "Love All Play", "RPG Real Estate", "Estab-Life", "Girls Band Cry", "BanG Dream", "Battle Through the Heavens", "Soul Land", "Throne of Seal", "The King's Avatar", "Heaven Official Blessing", "To Your Eternity", "The Faraway Paladin", "Shangri-La Frontier", "Summer Time Rendering", "Scissor Seven", "White Cat Legend",
  "Qi Refining for 3000 Years", "Carp Reborn", "A World Worth Protecting", "Rakshasa Street", "Spirits In Chinese Brushes", "The Invincible", "God Troubles Me", "Cinderella Chef", "The Eternal Strife", "The Story of Fengzhi Senla", "Master of the Star Spring",
];

async function destacadasAll() {
  const out = [], seen = new Set();
  const responses = await Promise.all(HOME_KEYWORDS.map(kw => intlSearch(kw, null).catch(() => null)));
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
  if (cached?.length) return cached;
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
function genreLabelES(g) { return GENRE_ES[g] || g; }
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
  return Array.from(byGenre.keys()).map(g => ({ genre: g, items: byGenre.get(g) }))
    .filter(s => s.items.length >= 4).sort((a, b) => b.items.length - a.items.length);
}

async function intlHome() {
  const rows = [], t0 = Date.now();
  const anime = await catalogSection(INTL_WEB + "/en/anime", "cache:anime", true);
  if (anime.items.length >= 4) rows.push({ id: "bts-anime", title: t("Anime", "Anime"), items: anime.items.slice(0, 20), ref: "browse:anime", genre: "anime" });
  
  let popAllow = !anime.loaded;
  if (anime.loaded && !anime.items.length && Date.now() - t0 < 16000) popAllow = true;
  const popular = await catalogSection(INTL_WEB + "/en/popular", "cache:popular", popAllow);
  if (popular.items.length >= 4) rows.push({ id: "bts-popular", title: t("Tendencias", "Trending"), items: popular.items.slice(0, 20), ref: "browse:popular" });
  
  const dest = await destacadasCached(true);
  const pool = mergeItems(anime.items, popular.items, dest);
  for (const g of genreSections(pool).slice(0, 4)) {
    rows.push({ id: "bts-genre-" + g.genre.replace(/[^a-z0-9]+/gi, "-").slice(0, 20), title: genreLabelES(g.genre), items: g.items.slice(0, 20), ref: "browse:g:" + encodeURIComponent(g.genre) });
  }
  if (dest.length) rows.push({ id: "bts-destacadas", title: t("Destacadas", "Featured"), items: dest.slice(0, 20), ref: "browse:catalog" });

  const intlKeywords = [
    { id: "doramas", title: t("📺 Doramas", "📺 Doramas"), keyword: "dorama" },
    { id: "donghua", title: t("🐉 Donghua", "🐉 Donghua"), keyword: "donghua" },
    { id: "amv", title: t("🎵 AMV", "🎵 AMV"), keyword: "amv" }
  ];
  const kwPromises = intlKeywords.map(async (k) => {
    try {
      const res = await intlSearch(k.keyword, null);
      const items = Array.isArray(res) ? res : res.items || [];
      if (items.length > 0) return { id: k.id, title: k.title, items: items.slice(0, 20), ref: "browse:keyword:" + encodeURIComponent(k.keyword) };
    } catch (e) {}
    return null;
  });
  const kwRows = await Promise.all(kwPromises);
  rows.push(...kwRows.filter(r => r !== null));

  if (rows.length) return rows;
  throw kino.error("unavailable", "empty", { userMessage: t("Sin catálogo.", "No catalog.") });
}

function qLabel(q) {
  const map = { 120: "4K", 116: "1080P HDR", 112: "1080P+", 80: "1080p", 74: "720P60", 64: "720p", 32: "480p", 16: "360p", 15: "240p", 6: "240p" };
  return map[q] || String(q || "") + "p";
}

async function intlSubtitles(epId) {
  const data = await intlJson(INTL_API + "/v2/subtitle?platform=web&s_locale=en_US&episode_id=" + encodeURIComponent(epId));
  const list = data && (data.subtitles || data.video_subtitle || data.subtitle) || [];
  return list.filter(sub => sub.url && /\.srt(\?|$)/i.test(sub.url)).map(sub => ({ lang: cleanTitle(sub.lang_key || "en").slice(0, 20) || "en", url: sub.url, format: "srt" }));
}

async function intlResolve(kind, id) {
  const param = kind === "e" ? "ep_id" : "aid";
  const data = await intlJson(INTL_API + "/playurl?s_locale=en_US&platform=web&" + param + "=" + encodeURIComponent(id));
  const p = data && data.playurl;
  if (!p) throw kino.error("not_found", "no playurl", { userMessage: t("No encontrado.", "Not found.") });
  const vids = (p.video || []).map(x => x.video_resource || x).filter(v => v.url).sort((a, b) => b.quality - a.quality);
  const auds = (p.audio_resource || []).filter(a => a.url).sort((a, b) => b.bandwidth - a.bandwidth);
  if (!vids.length) throw kino.error("unavailable", "no urls", { userMessage: t("Sin enlaces.", "No links.") });
  const headers = { "User-Agent": INTL_UA, Referer: INTL_WEB + "/" };
  const stream = { url: vids[0].url, mime: "video/mp4", headers, label: qLabel(vids[0].quality) };
  if (p.duration) stream.durationMs = p.duration;
  if (auds.length) stream.audioTracks = [{ lang: "zh", url: auds[0].url, label: "Original" }];
  if (vids.length > 1) stream.alternatives = vids.slice(1, 8).map(v => ({ url: v.url, mime: "video/mp4", headers, label: qLabel(v.quality) }));
  if (kind === "e") { try { const subs = await intlSubtitles(id); if (subs.length) stream.subtitles = subs; } catch (e) {} }
  return stream;
}

// ---------------------------------------------------------------------------
// Funciones de Kino v23
// ---------------------------------------------------------------------------
export async function segments(ref) {
  const id = String(ref).includes(":") ? String(ref).split(":")[1] : String(ref);
  try {
    const data = await getJson(API + "/x/player/v2?bvid=" + id);
    const points = data.data?.view_points || [];
    const intro = points.find(p => p.type === 1);
    const outro = points.find(p => p.type === 2);
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
  return { url: stream.url, filename: `bilibili_${String(ref).replace(/:/g, "_")}.mp4`, headers: stream.headers };
}

export async function subtitles(ref) { return []; }

export async function categories() {
  return [
    { id: "anime", name: t("Anime", "Anime") },
    { id: "movies", name: t("Películas", "Movies") },
    { id: "series", name: t("Series", "Series") },
  ];
}

// ---------------------------------------------------------------------------
// Exportaciones Base
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
  const r = String(ref);
  const page = cursor ? parseInt(cursor) : 1;

  if (mode() === "china") {
    if (r.startsWith("browse:rid:")) {
      const rid = r.split(":")[2];
      const res = await getJson(API + "/x/web-interface/ranking/v2?rid=" + rid + "&type=all");
      return { items: (res.data?.list || []).map(toVideoItem), next: null };
    }
    if (r.startsWith("browse:keyword:")) {
      const keyword = decodeURIComponent(r.slice(15));
      const res = await getJson(API + "/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(keyword) + "&page=" + page);
      const list = res.data?.result || [];
      const next = (res.data?.numPages && page < res.data?.numPages) ? String(page + 1) : null;
      return { items: list.map(toVideoItem), next };
    }
  } else {
    if (r.startsWith("browse:keyword:")) {
      const keyword = decodeURIComponent(r.slice(15));
      const res = await intlSearch(keyword, cursor || "1");
      return { items: Array.isArray(res) ? res : res.items || [], next: res.next || null };
    }
  }

  if (cursor) return { items: [], next: null };
  
  if (r === "browse:anime") {
    const anime = await catalogSection(INTL_WEB + "/en/anime", "cache:anime", true);
    let items = anime.items;
    if (!items.length) items = await destacadasCached(true);
    const enriched = await enrichItems(items, 25);
    if (anime.items.length) writeCache("cache:anime", anime.items, 60);
    return { items: enriched.slice(0, 100), next: null };
  }
  
  if (r === "browse:popular") {
    const popular = await catalogSection(INTL_WEB + "/en/popular", "cache:popular", true);
    if (!popular.items.length) throw kino.error("unavailable", "empty", { userMessage: "Error." });
    const enrichedPop = await enrichItems(popular.items, 25);
    writeCache("cache:popular", popular.items, 60);
    return { items: enrichedPop.slice(0, 100), next: null };
  }
  
  if (r.startsWith("browse:g:")) {
    const genre = decodeURIComponent(r.slice(9));
    const pool = await destacadasCached(true);
    const sec = genreSections(pool).find(s => s.genre === genre);
    const items = sec ? sec.items : [];
    if (!items.length) throw kino.error("unavailable", "empty", { userMessage: "Error." });
    return { items: (await enrichItems(items, 25)).slice(0, 100), next: null };
  }
  
  if (r === "browse:catalog") {
    const anime = await catalogSection(INTL_WEB + "/en/anime", "cache:anime", false);
    const popular = await catalogSection(INTL_WEB + "/en/popular", "cache:popular", !anime.loaded);
    const dest = await destacadasCached(true);
    const all = mergeItems(anime.items, popular.items, dest);
    if (!all.length) throw kino.error("unavailable", "empty", { userMessage: "Error." });
    return { items: (await enrichItems(all, 25)).slice(0, 100), next: null };
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
  const episodes = [];
  let autoNum = 0;
  (epsData.sections || []).forEach((sec, si) => {
    (sec.episodes || []).forEach(ep => {
      if (!ep || !ep.episode_id) return;
      autoNum++;
      episodes.push({ season: si + 1, number: autoNum, ref: "e:" + ep.episode_id, title: cleanTitle(ep.long_title_display || ep.title_display) || t("Capítulo ", "Episode ") + autoNum, still: posterUrl(ep.cover) });
    });
  });
  if (!episodes.length) throw kino.error("not_found", "empty", { userMessage: "Error." });
  return { series: { title: cleanTitle(season.title), poster: posterUrl(season.cover), backdrop: posterUrl(season.horizontal_cover), overview: cleanTitle(season.description || "").slice(0, 2000), genres: (season.styles || []).slice(0, 5).map(g => cleanTitle(g && g.title)).filter(Boolean) }, episodes };
}

export async function resolve(ref) {
  const s = String(ref || "");
  if (s.startsWith("e:")) return intlResolve("e", s.slice(2));
  if (s.startsWith("v:")) return intlResolve("v", s.slice(2));
  return cnResolve(s);
}

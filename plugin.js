// Bilibili v1.5.2-restore — catálogo mínimo estable
const API = "https://api.bilibili.com";
const WEB = "https://www.bilibili.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function t(es, en) {
  return String(kino.lang || "es").toLowerCase().startsWith("es") ? es : en;
}
function cleanTitle(title) {
  return String(title || "").replace(/<[^>]+>/g, "").trim();
}
function posterUrl(pic) {
  if (!pic) return undefined;
  if (pic.startsWith("//")) return "https:" + pic;
  if (pic.startsWith("http")) return pic;
  return undefined;
}
export function theme() {
  return { primary: "#FB7299", background: "#0E0E0E" };
}
function headers() {
  return { "User-Agent": UA, Referer: WEB + "/", Origin: WEB };
}
function toItem(v) {
  return {
    id: String(v.bvid || v.aid),
    ref: v.bvid || ("av" + v.aid),
    title: cleanTitle(v.title),
    kind: "movie",
    poster: posterUrl(v.pic),
  };
}
async function getPopular() {
  const r = await kino.fetch(API + "/x/web-interface/popular?ps=20&pn=1", {
    headers: headers(),
    timeoutMs: 20000,
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const data = JSON.parse(r.text());
  if (data.code !== 0) throw new Error(String(data.message || data.code));
  return ((data.data && data.data.list) || []).map(toItem).filter((i) => i.ref);
}
async function getRanking() {
  const r = await kino.fetch(API + "/x/web-interface/ranking/v2?rid=0&type=all", {
    headers: headers(),
    timeoutMs: 20000,
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const data = JSON.parse(r.text());
  if (data.code !== 0) throw new Error(String(data.message || data.code));
  return ((data.data && data.data.list) || []).map(toItem).filter((i) => i.ref);
}
async function searchType(q, page) {
  const r = await kino.fetch(
    API + "/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(q) + "&page=" + (page || 1),
    { headers: headers(), timeoutMs: 20000 }
  );
  if (!r.ok) return [];
  const data = JSON.parse(r.text());
  if (data.code !== 0) return [];
  return ((data.data && data.data.result) || []).map(toItem).filter((i) => i.ref);
}
export async function home() {
  const rows = [];
  try {
    const items = await getPopular();
    if (items.length) rows.push({ title: t("Tendencias", "Trending"), items });
  } catch (e) {
    try {
      const items = await getRanking();
      if (items.length) rows.push({ title: t("Tendencias", "Trending"), items });
    } catch (e2) {}
  }
  if (!rows.length) {
    for (const q of ["动画", "番剧", "anime", "音乐"]) {
      try {
        const items = (await searchType(q, 1)).slice(0, 15);
        if (items.length) rows.push({ title: q, items });
      } catch (e) {}
      if (rows.length >= 2) break;
    }
  }
  if (!rows.length) {
    throw kino.error("unavailable", "empty", {
      userMessage: t(
        "No se pudo cargar el catálogo de Bilibili. Revisa la red o usa VPN.",
        "Could not load Bilibili catalog. Check network or use VPN."
      ),
    });
  }
  return rows;
}
export async function search(query) {
  const q = ((query && query.q) || "").trim();
  if (!q) return [];
  return searchType(q, 1);
}
export async function browse(ref, cursor) {
  const s = String(ref || "");
  if (s === "browse:popular" || s === "popular") {
    try {
      const items = await getPopular();
      return { items };
    } catch (e) {
      const items = await getRanking();
      return { items };
    }
  }
  if (s === "browse:anime" || s === "anime") {
    return { items: await searchType("番剧", 1) };
  }
  return { items: [] };
}
export async function playlists() {
  return [
    { id: "trending", name: t("Tendencias", "Trending"), ref: "browse:popular" },
    { id: "anime", name: t("Anime", "Anime"), ref: "browse:anime" },
  ];
}
export async function categories() {
  return [
    { id: "anime", name: t("Anime", "Anime") },
    { id: "movies", name: t("Películas", "Movies") },
    { id: "series", name: t("Series", "Series") },
  ];
}
export async function resolve(ref) {
  const id = String(ref || "");
  let bvid = id.startsWith("BV") ? id : null;
  let aid = id.startsWith("av") ? id.slice(2) : null;
  if (!bvid && !aid) bvid = id;
  const viewUrl =
    API +
    "/x/web-interface/view?" +
    (bvid ? "bvid=" + encodeURIComponent(bvid) : "aid=" + encodeURIComponent(aid));
  const vr = await kino.fetch(viewUrl, { headers: headers(), timeoutMs: 20000 });
  if (!vr.ok) throw kino.error("unavailable", "view", { userMessage: t("No se pudo abrir.", "Could not open.") });
  const view = JSON.parse(vr.text());
  if (view.code !== 0 || !view.data) throw kino.error("not_found", "no data", { userMessage: t("No encontrado.", "Not found.") });
  const vd = view.data;
  const playUrl =
    API +
    "/x/player/playurl?bvid=" +
    encodeURIComponent(vd.bvid) +
    "&cid=" +
    vd.cid +
    "&qn=64&fnval=1&platform=html5";
  const pr = await kino.fetch(playUrl, { headers: headers(), timeoutMs: 20000 });
  if (!pr.ok) throw kino.error("unavailable", "play", { userMessage: t("Sin stream.", "No stream.") });
  const play = JSON.parse(pr.text());
  const d = play.data || {};
  const h = { "User-Agent": UA, Referer: WEB + "/video/" + vd.bvid };
  if (d.durl && d.durl[0] && d.durl[0].url) {
    return { url: d.durl[0].url, headers: h, mime: "video/mp4" };
  }
  if (d.dash && d.dash.video && d.dash.video.length) {
    const v = d.dash.video[0];
    const u = v.baseUrl || v.base_url;
    if (u) return { url: u, headers: h };
  }
  throw kino.error("unavailable", "no url", { userMessage: t("Sin enlace de vídeo.", "No video link.") });
}
export async function prepare() {}
export async function action() { return { message: t("Usa la versión completa para vincular cuenta.", "Use full version to link account.") }; }
export async function subtitles() { return []; }
export async function episodes() { return { episodes: [] }; }
export async function download(ref) {
  const s = await resolve(ref);
  return { url: s.url, filename: "bilibili.mp4", headers: s.headers };
}
export async function track() {}
export async function segments() { return { intro: null, outro: null }; }
export async function scopedSearch(query) { return search(query); }

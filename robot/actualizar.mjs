// Robot de Gaona en la ONU al Día — Vibras Positivas HM
// Corre en GitHub Actions cada 30 minutos (Node 20, sin dependencias).
// Trae noticias reales de Bing News y Google News, y videos de YouTube (Naciones Unidas),
// los junta con las que ya había, quita repetidas y deja las más nuevas de primero.
import { readFile, writeFile } from 'node:fs/promises';

const ARCHIVO = new URL('../noticias.json', import.meta.url);
const MAX_NOTICIAS = 80;
const MAX_VIDEOS = 12;

const BUSQUEDAS = [
  '"Mauricio Gaona" ONU',
  '"Gaona" embajador Naciones Unidas',
  '"Gaona" Consejo de Seguridad Colombia',
  'Misión de Verificación ONU Colombia',
  'ColombiaONU embajador',
  'Colombia Consejo de Seguridad ONU'
];

// Canales de YouTube de Naciones Unidas (si alguno falla, se ignora)
const CANALES_YT = [
  'UC5O114-PQNYkurlTg6hekZw' // United Nations
];
const FILTRO_VIDEO = /colombia|gaona/i;

const UA = { 'User-Agent': 'Mozilla/5.0 (VibrasPositivasHM robot; +https://vibraspositivashm.com)' };

function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}
const limpiarHtml = (s = '') => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i')); return m ? m[1] : ''; };
const attr = (xml, t, a) => { const m = xml.match(new RegExp(`<${t}[^>]*\\s${a}="([^"]+)"`, 'i')); return m ? decode(m[1]) : ''; };

async function traer(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

function aIso(fecha) {
  const d = new Date(fecha);
  return isNaN(d) ? null : d.toISOString();
}

function urlReal(link) {
  // Bing envuelve el enlace: ...apiclick.aspx?...&url=https%3a%2f%2f...
  try {
    const u = new URL(link);
    const real = u.searchParams.get('url');
    if (real) return real;
  } catch {}
  return link;
}

async function deBing(q) {
  const xml = await traer(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=es&cc=CO`);
  return xml.split('<item>').slice(1).map(it => ({
    titulo: limpiarHtml(tag(it, 'title')),
    url: urlReal(decode(tag(it, 'link'))),
    medio: limpiarHtml(tag(it, 'News:Source')) || '',
    fecha: aIso(decode(tag(it, 'pubDate'))),
    resumen: limpiarHtml(tag(it, 'description')).slice(0, 260),
    imagen: (img => img ? img + '&w=640&h=360&c=7' : '')(decode(tag(it, 'News:Image')))
  }));
}

async function deGoogle(q) {
  const xml = await traer(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:30d')}&hl=es-419&gl=CO&ceid=CO:es-419`);
  return xml.split('<item>').slice(1).map(it => {
    const medio = limpiarHtml(tag(it, 'source'));
    let titulo = limpiarHtml(tag(it, 'title'));
    if (medio && titulo.endsWith(' - ' + medio)) titulo = titulo.slice(0, -(medio.length + 3));
    return {
      titulo,
      url: decode(tag(it, 'link')),
      medio,
      fecha: aIso(decode(tag(it, 'pubDate'))),
      resumen: '',
      imagen: ''
    };
  });
}

async function videosYT(canal) {
  const xml = await traer(`https://www.youtube.com/feeds/videos.xml?channel_id=${canal}`);
  return xml.split('<entry>').slice(1).map(e => ({
    id: decode(tag(e, 'yt:videoId')),
    titulo: limpiarHtml(tag(e, 'title')),
    fecha: aIso(decode(tag(e, 'published'))),
    canal: limpiarHtml(tag(tag(e, 'author'), 'name')),
    descripcion: limpiarHtml(tag(e, 'media:description')).slice(0, 300)
  })).filter(v => v.id && FILTRO_VIDEO.test(v.titulo + ' ' + v.descripcion));
}

const clave = n => n.titulo.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').slice(0, 70);
const relevante = n => /gaona|onu|naciones unidas|consejo de seguridad|misi[oó]n de verificaci[oó]n/i.test(n.titulo + ' ' + n.resumen);

async function main() {
  let base = { noticias: [], videos: [] };
  try { base = JSON.parse(await readFile(ARCHIVO, 'utf8')); } catch {}

  const tareas = [];
  for (const q of BUSQUEDAS) { tareas.push(deBing(q)); tareas.push(deGoogle(q)); }
  const res = await Promise.allSettled(tareas);
  res.filter(r => r.status === 'rejected').forEach(r => console.warn('Fuente falló:', r.reason?.message));
  const nuevas = res.filter(r => r.status === 'fulfilled').flatMap(r => r.value)
    .filter(n => n.titulo && n.url && n.fecha && relevante(n));

  // Juntar: las nuevas mandan, pero si la vieja tenía imagen o resumen, se conservan
  const mapa = new Map();
  for (const n of [...(base.noticias || []), ...nuevas]) {
    const k = clave(n);
    const prev = mapa.get(k);
    mapa.set(k, prev ? { ...prev, ...n, imagen: n.imagen || prev.imagen, resumen: n.resumen || prev.resumen, medio: n.medio || prev.medio, fecha: prev.fecha < n.fecha ? prev.fecha : n.fecha } : n);
  }
  const ahora = Date.now();
  const noticias = [...mapa.values()]
    .filter(n => new Date(n.fecha).getTime() <= ahora + 3600e3)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, MAX_NOTICIAS);

  const vres = await Promise.allSettled(CANALES_YT.map(videosYT));
  vres.filter(r => r.status === 'rejected').forEach(r => console.warn('YouTube falló:', r.reason?.message));
  const vmapa = new Map((base.videos || []).map(v => [v.id, v]));
  vres.filter(r => r.status === 'fulfilled').flatMap(r => r.value).forEach(v => vmapa.set(v.id, v));
  const videos = [...vmapa.values()].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, MAX_VIDEOS);

  const salida = { actualizado: new Date().toISOString(), fuente: 'robot', noticias, videos };
  await writeFile(ARCHIVO, JSON.stringify(salida, null, 2) + '\n');
  console.log(`Listo: ${noticias.length} noticias (${nuevas.length} traídas ahora), ${videos.length} videos.`);
}

main().catch(e => { console.error(e); process.exit(1); });

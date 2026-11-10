/* AUTOS CÓRDOBA — aplicación del sitio
   Conexión con Supabase (la clave publicable es pública por diseño;
   la seguridad la dan las políticas RLS de la base). */
"use strict";

const SUPABASE_URL = "https://bmtonhtenishatbrmcnd.supabase.co";
const SUPABASE_KEY = "sb_publishable_G39YSlYBCk_-xCWLs8lh3A_ToF588Mf";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = "vehicle-photos";
const PAGE = 24;
const MAX_PHOTOS = 15;
const CITIES = ["Córdoba Capital", "Villa Carlos Paz", "Villa Allende", "La Calera", "Río Ceballos", "Unquillo", "Mendiolaza", "Saldán", "Malagueño", "Alta Gracia", "Jesús María", "Río Segundo", "Villa María", "Río Cuarto", "San Francisco", "Cosquín", "La Falda", "Otra localidad"];
const FUEL = { nafta: "Nafta", diesel: "Diésel", gnc: "GNC", hibrido: "Híbrido", electrico: "Eléctrico" };
const TRANS = { manual: "Manual", automatica: "Automática" };
const STATUS = { pending: "En revisión", approved: "Publicado", rejected: "Rechazado", sold: "Vendido", suspended: "Suspendida" };
const ROLES = { owner: "Propietario", admin: "Administrador", dealer: "Concesionaria", individual: "Particular" };
const CARD_FIELDS = "id,brand,model,version,year,price,mileage,city,seller_type,fuel,transmission,photos,featured,status,created_at,dealership:dealerships(name)";

const state = {
  user: null, profile: null, isStaff: false, isOwner: false,
  memberships: [], ready: false,
  filters: { q: "", seller: "", city: "", maxPrice: "", minYear: "", fuel: "", transmission: "", sort: "recent" },
};

/* ---------- Utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const money = n => n ? "$ " + Number(n).toLocaleString("es-AR") : "Consultar precio";
const km = n => n == null ? "" : Number(n).toLocaleString("es-AR") + " km";
const fdate = d => d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "";
const photoUrl = p => db.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
const title = v => `${v.brand} ${v.model}`;
const app = () => $("#app");
const opts = (obj, sel, empty) => (empty != null ? `<option value="">${esc(empty)}</option>` : "") + Object.entries(obj).map(([k, l]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(l)}</option>`).join("");
const cityOpts = (sel, empty) => (empty != null ? `<option value="">${esc(empty)}</option>` : "") + CITIES.map(c => `<option${c === sel ? " selected" : ""}>${esc(c)}</option>`).join("");
const pill = s => `<span class="pill ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
const go = h => { if (location.hash === h) route(); else location.hash = h; };

function toast(msg, ms = 2800) {
  const t = $("#toast"); t.textContent = msg; t.style.display = "block";
  clearTimeout(toast._t); toast._t = setTimeout(() => t.style.display = "none", ms);
}
function errMsg(e) {
  const m = e?.message || String(e);
  if (/JWT|session/i.test(m)) return "Tu sesión venció. Volvé a ingresar.";
  if (/row-level security|permission denied/i.test(m)) return "No tenés permiso para hacer esto.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Revisá internet e intentá de nuevo.";
  return m;
}
async function busy(btn, fn) {
  const txt = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "Un momento…"; }
  try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.textContent = txt; } }
}
/* Convierte un teléfono argentino a formato internacional para WhatsApp */
function waNumber(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  // quitar el "15" de celulares escritos como 351 15 1234567
  const m = d.match(/^(\d{2,4})15(\d{6,8})$/);
  if (m && (m[1].length + m[2].length) === 10) d = m[1] + m[2];
  return "549" + d;
}
function waLink(phone, text) {
  const n = waNumber(phone); if (!n) return "";
  return `https://wa.me/${n}?text=${encodeURIComponent(text || "")}`;
}
function vehicleUrl(id) { return `${location.origin}${location.pathname}#/auto/${id}`; }
function setMeta(t, d) {
  document.title = t ? `${t} | AUTOS CÓRDOBA` : "AUTOS CÓRDOBA | Compra y venta de autos en Córdoba";
  if (d) $('meta[name="description"]').setAttribute("content", d);
}

/* ---------- Sesión ---------- */
async function loadSession(session) {
  state.user = session?.user || null;
  state.profile = null; state.isStaff = false; state.isOwner = false; state.memberships = [];
  if (state.user) {
    const [{ data: prof }, { data: mem }] = await Promise.all([
      db.from("profiles").select("id,full_name,role,email").eq("id", state.user.id).maybeSingle(),
      db.from("dealership_members").select("member_role,dealership_id,dealership:dealerships(id,name,status)").eq("user_id", state.user.id),
    ]);
    state.profile = prof || null;
    state.isStaff = ["owner", "admin"].includes(prof?.role);
    state.isOwner = prof?.role === "owner";
    state.memberships = (mem || []).map(m => ({ role: m.member_role, id: m.dealership_id, name: m.dealership?.name || "Concesionaria", status: m.dealership?.status || "suspended" }));
  }
  renderNav();
}
const activeDealerships = () => state.memberships.filter(m => m.status === "approved");

function renderNav() {
  const h = location.hash || "#/";
  const link = (href, label, cls = "") => `<a href="${href}" class="${cls}${h.startsWith(href) && href !== "#/" || h === href ? " active" : ""}">${label}</a>`;
  let html = link("#/", "Inicio") + link("#/comprar", "Comprar");
  if (state.user) {
    html += link("#/publicar", "Publicar", "cta") + link("#/mi-cuenta", "Mi cuenta");
    if (state.isStaff) html += link("#/admin", "Administración");
  } else {
    html += link("#/publicar", "Vender mi auto", "cta") + link("#/ingresar", "Ingresar");
  }
  $("#navlinks").innerHTML = html;
}

function requireLogin(next) {
  if (state.user) return true;
  sessionStorage.setItem("afterLogin", next || location.hash);
  toast("Ingresá o creá tu cuenta para continuar.");
  go("#/ingresar");
  return false;
}

/* ---------- Router ---------- */
const routes = [
  [/^#?\/?$/, renderHome],
  [/^#\/comprar$/, renderCatalog],
  [/^#\/auto\/([0-9a-f-]{36})$/, renderVehicle],
  [/^#\/publicar$/, () => renderForm(null)],
  [/^#\/editar\/([0-9a-f-]{36})$/, renderForm],
  [/^#\/mi-cuenta$/, renderAccount],
  [/^#\/admin$/, renderAdmin],
  [/^#\/ingresar$/, renderAuth],
  [/^#\/nueva-clave$/, renderNewPassword],
  [/^#\/legales$/, renderLegal],
];
async function route() {
  if (!state.ready) return;
  const h = location.hash || "#/";
  if (/access_token|error_description|[?&]code=/.test(h + location.search)) {
    // el link del email ya fue procesado por Supabase al cargar
    if (/error_description/.test(h)) toast("El link expiró o ya fue usado. Pedí uno nuevo.", 5000);
    history.replaceState(null, "", location.pathname + "#/");
    return route();
  }
  renderNav();
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      window.scrollTo(0, 0);
      try { await fn(m[1]); } catch (e) { console.error(e); app().innerHTML = `<div class="empty">Ocurrió un error: ${esc(errMsg(e))}</div>`; }
      return;
    }
  }
  go("#/");
}
window.addEventListener("hashchange", route);

/* ---------- Tarjetas ---------- */
function carCard(v) {
  const img = v.photos?.[0] ? `<img src="${esc(photoUrl(v.photos[0]))}" alt="${esc(title(v))}" loading="lazy">` : "🚗";
  const seller = v.seller_type === "dealer" ? (v.dealership?.name || "Concesionaria") : "Particular";
  return `<a class="car" href="#/auto/${v.id}">
   <div class="carimg">${img}<span class="tag">${esc(seller)}</span>${v.featured ? '<span class="tag star">★ Destacado</span>' : ""}</div>
   <div class="carbody"><h3>${esc(title(v))}</h3><div class="version">${esc(v.version || "")}&nbsp;</div>
    <div class="price">${money(v.price)}</div>
    <div class="specs"><span>${esc(v.year || "")}</span><span>${km(v.mileage)}</span><span>${esc(FUEL[v.fuel] || "")}</span><span>${esc(v.city || "")}</span></div>
   </div></a>`;
}

/* ---------- Inicio ---------- */
async function renderHome() {
  setMeta();
  const f = state.filters;
  app().innerHTML = `
  <section class="hero">
   <div class="eyebrow">El portal automotor de Córdoba</div>
   <h1>Tu próximo auto<br>está acá.</h1>
   <p>Encontrá oportunidades, compará vehículos y contactá directo con particulares y concesionarias de Córdoba y alrededores.</p>
   <form class="searchbox" id="homeSearch">
    <input class="q" name="q" placeholder="Marca o modelo (ej. Gol, Hilux)" value="${esc(f.q)}" enterkeyhint="search">
    <select name="seller">${opts({ dealer: "Concesionaria", individual: "Particular" }, f.seller, "Todos los vendedores")}</select>
    <select name="city">${cityOpts(f.city, "Todas las zonas")}</select>
    <button class="btn" type="submit">Buscar autos</button>
   </form>
  </section>
  <div class="sectionhead"><div><div class="eyebrow">Recién publicados</div><h2>Vehículos para descubrir</h2></div><a class="btn light" href="#/comprar">Ver todos</a></div>
  <div id="featured" class="grid"><div class="loading">Cargando vehículos…</div></div>
  <div class="panel" style="display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap">
   <div><h3 style="margin:0">¿Querés vender tu auto?</h3><p class="muted" style="margin:4px 0 0">Publicá gratis con fotos en pocos minutos. Te contactan directo por WhatsApp.</p></div>
   <a class="btn" href="#/publicar">Publicar mi auto</a>
  </div>
  <div class="panel" style="display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap">
   <div><h3 style="margin:0">¿Tenés una concesionaria?</h3><p class="muted" style="margin:4px 0 0">Creá la cuenta de tu agencia y publicá todo tu inventario.</p></div>
   <a class="btn dark" href="#/mi-cuenta">Registrar mi agencia</a>
  </div>`;
  $("#homeSearch").addEventListener("submit", e => {
    e.preventDefault();
    const d = new FormData(e.target);
    Object.assign(state.filters, { q: d.get("q").trim(), seller: d.get("seller"), city: d.get("city") });
    go("#/comprar");
  });
  const { data, error } = await db.from("vehicles").select(CARD_FIELDS).eq("status", "approved")
    .order("featured", { ascending: false }).order("created_at", { ascending: false }).limit(6);
  const box = $("#featured"); if (!box) return;
  if (error) { box.innerHTML = `<div class="empty">No se pudieron cargar los vehículos.</div>`; return; }
  box.innerHTML = (data || []).map(carCard).join("") || '<div class="empty">Todavía no hay vehículos publicados. ¡Sé el primero en publicar!</div>';
}

/* ---------- Catálogo ---------- */
function buildQuery(f) {
  let q = db.from("vehicles").select(CARD_FIELDS, { count: "exact" }).eq("status", "approved");
  const terms = (f.q || "").split(/\s+/).map(t => t.replace(/[%,()"'\\:*.]/g, "")).filter(Boolean).slice(0, 4);
  for (const t of terms) q = q.or(`brand.ilike.%${t}%,model.ilike.%${t}%,version.ilike.%${t}%`);
  if (f.seller) q = q.eq("seller_type", f.seller);
  if (f.city) q = q.eq("city", f.city);
  if (f.maxPrice) q = q.lte("price", Number(f.maxPrice));
  if (f.minYear) q = q.gte("year", Number(f.minYear));
  if (f.fuel) q = q.eq("fuel", f.fuel);
  if (f.transmission) q = q.eq("transmission", f.transmission);
  q = q.order("featured", { ascending: false });
  if (f.sort === "price_asc") q = q.order("price", { ascending: true, nullsFirst: false });
  else if (f.sort === "price_desc") q = q.order("price", { ascending: false, nullsFirst: false });
  else if (f.sort === "year_desc") q = q.order("year", { ascending: false, nullsFirst: false });
  else if (f.sort === "km_asc") q = q.order("mileage", { ascending: true, nullsFirst: false });
  return q.order("created_at", { ascending: false });
}
async function renderCatalog() {
  setMeta("Autos en venta en Córdoba", "Autos usados y 0 km en venta en Córdoba. Filtrá por marca, modelo, precio, año y localidad.");
  const f = state.filters;
  app().innerHTML = `
  <div class="sectionhead"><div><div class="eyebrow">Encontrá tu vehículo</div><h1>Autos en venta</h1></div><span id="resultCount" class="muted"></span></div>
  <form class="panel" id="filters" style="margin-top:0">
   <div class="filters">
    <input class="q" name="q" placeholder="Marca, modelo o versión" value="${esc(f.q)}" enterkeyhint="search">
    <select name="seller">${opts({ dealer: "Concesionaria", individual: "Particular" }, f.seller, "Todos los vendedores")}</select>
    <select name="city">${cityOpts(f.city, "Todas las localidades")}</select>
    <input name="maxPrice" type="number" inputmode="numeric" placeholder="Precio máximo $" value="${esc(f.maxPrice)}">
    <input name="minYear" type="number" inputmode="numeric" placeholder="Desde el año" value="${esc(f.minYear)}">
    <select name="fuel">${opts(FUEL, f.fuel, "Combustible")}</select>
    <select name="transmission">${opts(TRANS, f.transmission, "Caja")}</select>
    <select name="sort">${opts({ recent: "Más recientes", price_asc: "Menor precio", price_desc: "Mayor precio", year_desc: "Más nuevos", km_asc: "Menos kilómetros" }, f.sort)}</select>
   </div>
   <div class="actions"><button class="btn" type="submit">Aplicar filtros</button><button class="btn ghost" type="button" id="clearF">Limpiar</button></div>
  </form>
  <div id="catalogGrid" class="grid" style="margin-top:18px"><div class="loading">Buscando…</div></div>
  <div class="actions" style="justify-content:center"><button class="btn light hidden" id="more">Ver más vehículos</button></div>`;
  let offset = 0;
  const load = async (append) => {
    const { data, error, count } = await buildQuery(state.filters).range(offset, offset + PAGE - 1);
    const grid = $("#catalogGrid"); if (!grid) return;
    if (error) { grid.innerHTML = `<div class="empty">No se pudieron cargar los vehículos: ${esc(errMsg(error))}</div>`; return; }
    const html = (data || []).map(carCard).join("");
    grid.innerHTML = append ? grid.innerHTML + html : (html || '<div class="empty">No encontramos vehículos con esos filtros.</div>');
    offset += (data || []).length;
    $("#resultCount").textContent = `${count ?? offset} vehículo${count === 1 ? "" : "s"}`;
    $("#more").classList.toggle("hidden", offset >= (count || 0));
  };
  $("#filters").addEventListener("submit", e => {
    e.preventDefault();
    const d = new FormData(e.target);
    for (const k of Object.keys(state.filters)) state.filters[k] = String(d.get(k) ?? "").trim();
    offset = 0; $("#catalogGrid").innerHTML = '<div class="loading">Buscando…</div>'; load(false);
  });
  $("#clearF").addEventListener("click", () => {
    state.filters = { q: "", seller: "", city: "", maxPrice: "", minYear: "", fuel: "", transmission: "", sort: "recent" };
    renderCatalog();
  });
  $("#more").addEventListener("click", e => busy(e.target, () => load(true)));
  await load(false);
}

/* ---------- Ficha del vehículo ---------- */
async function renderVehicle(id) {
  app().innerHTML = '<div class="loading">Cargando vehículo…</div>';
  const { data: v, error } = await db.from("vehicles").select("*,dealership:dealerships(name,phone,city)").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!v) { app().innerHTML = `<div class="empty" style="margin-top:20px">Esta publicación no existe o ya no está disponible.<br><br><a class="btn" href="#/comprar">Ver otros autos</a></div>`; return; }
  setMeta(`${title(v)} ${v.year || ""}`, `${title(v)} ${v.version || ""} ${v.year || ""} en ${v.city || "Córdoba"}. ${money(v.price)}. Contactá al vendedor en Autos Córdoba.`);
  const photos = v.photos || [];
  const slides = photos.length ? photos.map((p, i) => `<img src="${esc(photoUrl(p))}" alt="${esc(title(v))} foto ${i + 1}" ${i ? 'loading="lazy"' : ""}>`).join("") : '<div class="noimg">🚗</div>';
  const thumbs = photos.length > 1 ? `<div class="thumbs">${photos.map((p, i) => `<button type="button" data-i="${i}" class="${i ? "" : "on"}"><img src="${esc(photoUrl(p))}" alt="" loading="lazy"></button>`).join("")}</div>` : "";
  const isMine = state.user && (v.seller_id === state.user.id || state.memberships.some(m => m.id === v.dealership_id && m.role === "manager"));
  const sellerName = v.seller_type === "dealer" ? (v.dealership?.name || "Concesionaria") : "Vendedor particular";
  const wa = v.status === "approved" ? waLink(v.contact_phone, `Hola! Vi tu ${title(v)} ${v.year || ""} en Autos Córdoba y me interesa. ${vehicleUrl(v.id)}`) : "";
  const specs = [["Año", v.year], ["Kilómetros", km(v.mileage)], ["Combustible", FUEL[v.fuel]], ["Caja", TRANS[v.transmission]], ["Localidad", v.city], ["Publicado", fdate(v.created_at)]]
    .filter(s => s[1]).map(([k, val]) => `<div><span>${k}</span>${esc(val)}</div>`).join("");
  app().innerHTML = `
  <div class="actions" style="margin:0 0 14px"><a class="btn ghost small" href="#/comprar">← Volver al listado</a></div>
  ${v.status !== "approved" ? `<div class="notice" style="margin:0 0 14px">Estado de esta publicación: <b>${esc(STATUS[v.status])}</b>. ${v.status === "pending" ? "La está revisando el equipo; todavía no es visible para el público." : v.status === "sold" ? "Ya no aparece en el catálogo." : v.status === "rejected" ? "No fue aprobada. Podés editarla y volver a enviarla." : ""}</div>` : ""}
  <div class="detail">
   <div>
    <div class="gallery"><div style="position:relative"><div class="slides" id="slides">${slides}</div>${photos.length > 1 ? `<span class="counter" id="counter">1 / ${photos.length}</span>` : ""}</div>${thumbs}</div>
    <div class="panel">
     <h3>Características</h3>
     <div class="spec-table">${specs}</div>
     ${v.description ? `<h3 style="margin-top:20px">Descripción</h3><p class="desc">${esc(v.description)}</p>` : ""}
    </div>
   </div>
   <aside class="sticky">
    <div class="panel" style="margin-top:0">
     <span class="pill">${esc(sellerName)}</span>${v.featured ? ' <span class="pill" style="background:#fff3c4;color:#7a5600">★ Destacado</span>' : ""}
     <h1 style="margin:10px 0 2px;font-size:26px;line-height:1.15">${esc(title(v))}</h1>
     <div class="muted">${esc(v.version || "")}</div>
     <div class="price" style="font-size:30px">${money(v.price)}</div>
     <div class="specs" style="font-size:13px"><span>${esc(v.year || "")}</span><span>${km(v.mileage)}</span><span>${esc(v.city || "")}</span></div>
     <div class="actions">
      ${wa ? `<a class="btn wa block" href="${esc(wa)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ""}
      <button class="btn light" id="share" type="button">Compartir</button>
      ${isMine ? `<a class="btn dark" href="#/editar/${v.id}">Editar publicación</a>` : ""}
     </div>
    </div>
    ${v.status === "approved" ? `
    <form class="panel" id="inquiry">
     <h3>Consultar al vendedor</h3>
     <div class="field"><label>Tu nombre</label><input name="buyer_name" required minlength="2" maxlength="100" autocomplete="name"></div>
     <div class="field" style="margin-top:10px"><label>Tu teléfono</label><input name="buyer_phone" required minlength="6" maxlength="30" type="tel" autocomplete="tel" placeholder="351 1234567"></div>
     <div class="field" style="margin-top:10px"><label>Mensaje</label><textarea name="message" rows="3" maxlength="1000">Hola, me interesa el ${esc(title(v))}. ¿Sigue disponible?</textarea></div>
     <button class="btn block" style="margin-top:12px" type="submit">Enviar consulta</button>
     <p class="muted small" style="margin:8px 0 0">El vendedor recibe tus datos para contactarte.</p>
    </form>` : ""}
   </aside>
  </div>`;
  // galería
  const sl = $("#slides");
  const sync = () => {
    const i = Math.round(sl.scrollLeft / sl.clientWidth);
    $$(".thumbs button").forEach((b, j) => b.classList.toggle("on", j === i));
    const c = $("#counter"); if (c) c.textContent = `${i + 1} / ${photos.length}`;
  };
  sl.addEventListener("scroll", () => { cancelAnimationFrame(sync._r); sync._r = requestAnimationFrame(sync); }, { passive: true });
  $$(".thumbs button").forEach(b => b.addEventListener("click", () => sl.scrollTo({ left: sl.clientWidth * Number(b.dataset.i), behavior: "smooth" })));
  $("#share").addEventListener("click", async () => {
    const url = vehicleUrl(v.id), text = `${title(v)} ${v.year || ""} — ${money(v.price)}`;
    if (navigator.share) { try { await navigator.share({ title: text, text, url }); } catch (_) { } }
    else { try { await navigator.clipboard.writeText(url); toast("Link copiado."); } catch (_) { prompt("Copiá este link:", url); } }
  });
  const form = $("#inquiry");
  if (form) form.addEventListener("submit", async e => {
    e.preventDefault();
    const d = new FormData(form), btn = $("button[type=submit]", form);
    await busy(btn, async () => {
      const { error } = await db.from("inquiries").insert({ vehicle_id: v.id, buyer_name: d.get("buyer_name").trim(), buyer_phone: d.get("buyer_phone").trim(), message: d.get("message").trim() || null });
      if (error) { toast("No se pudo enviar: " + errMsg(error)); return; }
      form.innerHTML = '<div class="notice ok" style="margin:0">¡Consulta enviada! El vendedor se va a comunicar con vos.</div>';
    });
  });
}

/* ---------- Fotos ---------- */
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("No se pudo leer la imagen")); };
    img.src = url;
  });
}
/* Reduce la foto a máx. 1600 px en JPEG: carga rápida y ahorra datos móviles */
async function compressImage(file) {
  try {
    const img = await loadImage(file);
    const max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
    if (blob) return { blob, ext: "jpg", type: "image/jpeg" };
  } catch (_) { }
  if (file.size > 8 * 1024 * 1024) throw new Error("La foto es muy pesada (máx. 8 MB).");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  return { blob: file, ext, type: file.type || "image/jpeg" };
}
async function uploadPhoto(file, folder) {
  const { blob, ext, type } = await compressImage(file);
  const path = `${state.user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, blob, { contentType: type, cacheControl: "31536000", upsert: false });
  if (error) throw error;
  return path;
}
async function removePhotos(paths) {
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
}

/* ---------- Publicar / editar ---------- */
async function renderForm(id) {
  if (!requireLogin(id ? `#/editar/${id}` : "#/publicar")) return;
  let v = null;
  if (id) {
    app().innerHTML = '<div class="loading">Cargando…</div>';
    const { data, error } = await db.from("vehicles").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    v = data;
    const canEdit = v && (v.seller_id === state.user.id || state.isStaff || state.memberships.some(m => m.id === v.dealership_id && m.role === "manager"));
    if (!canEdit) { app().innerHTML = '<div class="empty">No encontramos esa publicación o no podés editarla.</div>'; return; }
  }
  setMeta(id ? "Editar publicación" : "Publicar mi auto");
  const folder = id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
  const original = [...(v?.photos || [])];
  let photos = [...original];
  const uploadedNow = [];
  const dealers = activeDealerships();
  const asOpts = `<option value="individual">Particular (a mi nombre)</option>` + dealers.map(d => `<option value="${d.id}"${v?.dealership_id === d.id ? " selected" : ""}>Concesionaria: ${esc(d.name)}</option>`).join("");
  const val = k => esc(v?.[k] ?? "");
  app().innerHTML = `
  <div class="sectionhead"><div><div class="eyebrow">${id ? "Editar" : "Sumá tu vehículo"}</div><h1>${id ? "Editar publicación" : "Publicar un auto"}</h1>
   <p class="muted" style="margin:4px 0 0">${id && v.status === "approved" ? "Al guardar cambios, la publicación vuelve a revisión por unas horas." : "Tu publicación se revisa antes de aparecer en el catálogo."}</p></div></div>
  <form class="panel" id="carForm" style="margin-top:0" novalidate>
   <h3>Fotos</h3>
   <label class="uploader" for="photoInput">📷 Agregar fotos <span class="muted small" style="font-weight:400">(hasta ${MAX_PHOTOS}, desde la galería o la cámara)</span></label>
   <input id="photoInput" type="file" accept="image/*" multiple class="hidden">
   <div class="photos" id="photos"></div>
   <p class="muted small" style="margin:8px 0 0">La primera foto es la portada. Tocá ★ en otra para usarla de portada.</p>
   <h3 style="margin-top:24px">Datos del vehículo</h3>
   <div class="formgrid">
    ${!id && dealers.length ? `<div class="field full"><label>Publicar como</label><select name="as">${asOpts}</select></div>` : ""}
    <div class="field"><label>Marca *</label><input name="brand" required maxlength="60" placeholder="Ej. Volkswagen" value="${val("brand")}" autocapitalize="words"></div>
    <div class="field"><label>Modelo *</label><input name="model" required maxlength="80" placeholder="Ej. Amarok" value="${val("model")}" autocapitalize="words"></div>
    <div class="field"><label>Versión</label><input name="version" maxlength="80" placeholder="Ej. 2.0 TDI Highline 4x4" value="${val("version")}"></div>
    <div class="field"><label>Año *</label><input name="year" required type="number" inputmode="numeric" min="1950" max="2030" placeholder="2020" value="${val("year")}"></div>
    <div class="field"><label>Precio en pesos *</label><input name="price" required type="number" inputmode="numeric" min="1" placeholder="25000000" value="${val("price")}"></div>
    <div class="field"><label>Kilómetros</label><input name="mileage" type="number" inputmode="numeric" min="0" placeholder="80000" value="${val("mileage")}"></div>
    <div class="field"><label>Combustible</label><select name="fuel">${opts(FUEL, v?.fuel, "Elegí…")}</select></div>
    <div class="field"><label>Caja</label><select name="transmission">${opts(TRANS, v?.transmission, "Elegí…")}</select></div>
    <div class="field"><label>Localidad *</label><select name="city" required>${cityOpts(v?.city || "Córdoba Capital")}</select></div>
    <div class="field"><label>WhatsApp de contacto</label><input name="contact_phone" type="tel" maxlength="30" placeholder="351 1234567" value="${val("contact_phone")}" autocomplete="tel"><div class="hint">Se muestra un botón de WhatsApp en tu publicación.</div></div>
    <div class="field full"><label>Descripción</label><textarea name="description" rows="5" maxlength="3000" placeholder="Estado, service, detalles, si acepta permuta, etc.">${val("description")}</textarea></div>
   </div>
   <div class="actions"><button class="btn" type="submit" id="saveBtn">${id ? "Guardar cambios" : "Enviar publicación"}</button><a class="btn ghost" href="${id ? "#/mi-cuenta" : "#/"}">Cancelar</a></div>
  </form>`;
  const drawPhotos = () => {
    $("#photos").innerHTML = photos.map((p, i) => `<div class="photo"><img src="${esc(photoUrl(p))}" alt="">
      <button type="button" class="x" data-del="${i}" aria-label="Quitar foto">×</button>
      ${i === 0 ? '<span class="cover">PORTADA</span>' : `<button type="button" class="mk" data-cover="${i}">★ Portada</button>`}</div>`).join("") + (drawPhotos.pending ? `<div class="photo up">Subiendo ${drawPhotos.pending}…</div>` : "");
  };
  drawPhotos.pending = 0;
  drawPhotos();
  $("#photos").addEventListener("click", e => {
    const del = e.target.dataset.del, cov = e.target.dataset.cover;
    if (del != null) { photos.splice(Number(del), 1); drawPhotos(); }
    if (cov != null) { const [p] = photos.splice(Number(cov), 1); photos.unshift(p); drawPhotos(); }
  });
  $("#photoInput").addEventListener("change", async e => {
    const files = [...e.target.files].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = "";
    if (!files.length) { toast(`Máximo ${MAX_PHOTOS} fotos.`); return; }
    drawPhotos.pending += files.length; drawPhotos();
    for (const f of files) {
      try { const p = await uploadPhoto(f, folder); photos.push(p); uploadedNow.push(p); }
      catch (err) { toast("Una foto no se pudo subir: " + errMsg(err)); }
      drawPhotos.pending--; drawPhotos();
    }
  });
  $("#carForm").addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (drawPhotos.pending) { toast("Esperá a que terminen de subir las fotos."); return; }
    if (!photos.length && !confirm("No agregaste fotos. Las publicaciones con fotos se venden mucho más rápido. ¿Publicar igual?")) return;
    const d = new FormData(form);
    const s = k => String(d.get(k) ?? "").trim();
    const n = k => s(k) ? Number(s(k)) : null;
    const row = {
      brand: s("brand"), model: s("model"), version: s("version") || null, year: n("year"), price: n("price"),
      mileage: n("mileage"), fuel: s("fuel") || null, transmission: s("transmission") || null, city: s("city"),
      contact_phone: s("contact_phone") || null, description: s("description") || null, photos,
    };
    if (row.contact_phone && row.contact_phone.replace(/\D/g, "").length < 8) { toast("Revisá el número de WhatsApp."); return; }
    await busy($("#saveBtn"), async () => {
      let error;
      if (id) {
        row.status = state.isStaff ? v.status : (v.status === "sold" ? "sold" : "pending");
        ({ error } = await db.from("vehicles").update(row).eq("id", id));
      } else {
        const as = s("as") || "individual";
        Object.assign(row, { seller_id: state.user.id, status: "pending", seller_type: as === "individual" ? "individual" : "dealer", dealership_id: as === "individual" ? null : as });
        ({ error } = await db.from("vehicles").insert(row));
      }
      if (error) { toast("No se pudo guardar: " + errMsg(error), 4500); return; }
      await removePhotos([...original, ...uploadedNow].filter(p => !photos.includes(p)));
      toast(id ? "Cambios guardados." : "¡Publicación enviada! Te avisamos acá cuando esté aprobada.", 4000);
      uploadedNow.length = 0;
      go("#/mi-cuenta");
    });
  });
  // si sale sin guardar, borrar fotos subidas en esta sesión
  const cleanup = () => { if (uploadedNow.length) removePhotos(uploadedNow.filter(p => !original.includes(p))); window.removeEventListener("hashchange", cleanup); };
  window.addEventListener("hashchange", cleanup);
}

/* ---------- Mi cuenta ---------- */
function vehicleRow(v, actions) {
  const img = v.photos?.[0] ? `<img src="${esc(photoUrl(v.photos[0]))}" alt="" loading="lazy">` : "🚗";
  return `<div class="row"><a class="thumb" href="#/auto/${v.id}">${img}</a>
   <div class="info"><b>${esc(title(v))} ${esc(v.year || "")}</b><span class="muted small">${money(v.price)} · ${esc(v.city || "")}</span><br>${pill(v.status)}${v.featured ? ' <span class="pill">★ Destacado</span>' : ""}${v.extra || ""}</div>
   <div class="btns">${actions}</div></div>`;
}
async function renderAccount() {
  if (!requireLogin("#/mi-cuenta")) return;
  setMeta("Mi cuenta");
  app().innerHTML = '<div class="loading">Cargando tu cuenta…</div>';
  const uid = state.user.id;
  const dealerIds = state.memberships.map(m => m.id);
  let vq = db.from("vehicles").select("id,brand,model,year,price,city,status,photos,featured,seller_id,dealership_id,created_at").order("created_at", { ascending: false });
  vq = dealerIds.length ? vq.or(`seller_id.eq.${uid},dealership_id.in.(${dealerIds.join(",")})`) : vq.eq("seller_id", uid);
  const [{ data: vehicles, error: ve }, { data: reqs }] = await Promise.all([
    vq, db.from("agency_requests").select("id,dealership_name,status,created_at").eq("requested_by", uid).order("created_at", { ascending: false }),
  ]);
  if (ve) throw ve;
  const mine = vehicles || [];
  let inquiries = [];
  if (mine.length) {
    const { data } = await db.from("inquiries").select("id,buyer_name,buyer_phone,message,created_at,vehicle_id").in("vehicle_id", mine.map(v => v.id).slice(0, 300)).order("created_at", { ascending: false }).limit(100);
    inquiries = data || [];
  }
  const byId = Object.fromEntries(mine.map(v => [v.id, v]));
  const count = s => mine.filter(v => v.status === s).length;
  const actions = v => {
    const canManage = v.seller_id === uid || state.memberships.some(m => m.id === v.dealership_id && m.role === "manager");
    if (!canManage) return `<a class="btn ghost small" href="#/auto/${v.id}">Ver</a>`;
    return `<a class="btn ghost small" href="#/auto/${v.id}">Ver</a><a class="btn light small" href="#/editar/${v.id}">Editar</a>` +
      (v.status === "sold" ? `<button class="btn ghost small" data-act="relist" data-id="${v.id}">Volver a publicar</button>` : `<button class="btn ok small" data-act="sold" data-id="${v.id}">Vendido</button>`) +
      `<button class="btn danger small" data-act="delete" data-id="${v.id}">Eliminar</button>`;
  };
  const mem = state.memberships;
  app().innerHTML = `
  <div class="sectionhead"><div><div class="eyebrow">Mi cuenta</div><h1>Hola${state.profile?.full_name ? ", " + esc(state.profile.full_name.split(" ")[0]) : ""}</h1><p class="muted" style="margin:4px 0 0">${esc(state.user.email)} · ${esc(ROLES[state.profile?.role] || "Particular")}</p></div>
   <div class="actions" style="margin:0"><a class="btn" href="#/publicar">+ Publicar vehículo</a><button class="btn ghost" id="logout">Cerrar sesión</button></div></div>
  <div class="stats">
   <div class="stat"><span class="muted">Publicados</span><b>${count("approved")}</b></div>
   <div class="stat"><span class="muted">En revisión</span><b>${count("pending")}</b></div>
   <div class="stat"><span class="muted">Consultas</span><b>${inquiries.length}</b></div>
   <div class="stat"><span class="muted">Vendidos</span><b>${count("sold")}</b></div>
  </div>
  <div class="panel"><h3>Mis vehículos</h3><div class="list" id="myList">${mine.map(v => vehicleRow(v, actions(v))).join("") || '<div class="empty">Todavía no publicaste vehículos. <br><br><a class="btn" href="#/publicar">Publicar el primero</a></div>'}</div></div>
  <div class="panel"><h3>Consultas recibidas</h3><div class="list">${inquiries.map(q => {
    const v = byId[q.vehicle_id] || {};
    const wa = waLink(q.buyer_phone, `Hola ${q.buyer_name}! Te escribo por tu consulta del ${title(v)} en Autos Córdoba.`);
    return `<div class="row"><div class="info"><b>${esc(q.buyer_name)} · ${esc(q.buyer_phone)}</b><span class="muted small">${esc(title(v))} · ${fdate(q.created_at)}</span>${q.message ? `<div class="small" style="margin-top:4px">${esc(q.message)}</div>` : ""}</div>
     <div class="btns">${wa ? `<a class="btn wa small" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}<a class="btn ghost small" href="tel:${esc(q.buyer_phone.replace(/[^\d+]/g, ""))}">Llamar</a></div></div>`;
  }).join("") || '<div class="empty">Cuando alguien consulte por tus autos, lo vas a ver acá.</div>'}</div></div>
  <div class="panel"><h3>Concesionaria</h3>
   ${mem.length ? `<div class="list">${mem.map(m => `<div class="row"><div class="info"><b>${esc(m.name)}</b><span class="muted small">Tu rol: ${m.role === "manager" ? "Encargado" : "Vendedor"}</span><br>${pill(m.status === "approved" ? "approved" : "suspended")}</div></div>`).join("")}</div>
     <p class="muted small">Al publicar, elegí “Publicar como: Concesionaria” para cargar al inventario de la agencia.</p>` : ""}
   ${(reqs || []).length ? `<div class="list" style="margin-top:10px">${reqs.map(r => `<div class="row"><div class="info"><b>Solicitud: ${esc(r.dealership_name)}</b><span class="muted small">${fdate(r.created_at)}</span><br>${pill(r.status)}</div></div>`).join("")}</div>` : ""}
   ${!mem.length && !(reqs || []).some(r => r.status === "pending") ? `
   <p class="muted">¿Tenés una agencia? Pedí tu cuenta de concesionaria. La revisamos y te habilitamos para publicar todo el inventario.</p>
   <form id="agencyForm" class="formgrid">
    <div class="field"><label>Nombre de la concesionaria *</label><input name="dealership_name" required maxlength="100"></div>
    <div class="field"><label>Localidad *</label><select name="city" required>${cityOpts("Córdoba Capital")}</select></div>
    <div class="field"><label>Teléfono *</label><input name="phone" required type="tel" maxlength="30"></div>
    <div class="field"><label>CUIT</label><input name="cuit" inputmode="numeric" maxlength="13" placeholder="30-12345678-9"></div>
    <div class="field full"><button class="btn" type="submit">Enviar solicitud</button></div>
   </form>` : ""}
  </div>`;
  $("#logout").addEventListener("click", async () => { await db.auth.signOut(); toast("Sesión cerrada."); go("#/"); });
  $("#myList").addEventListener("click", async e => {
    const { act, id } = e.target.dataset; if (!act) return;
    const v = byId[id];
    if (act === "delete") {
      if (!confirm(`¿Eliminar definitivamente el ${title(v)}? Se borran también sus fotos y consultas. No se puede deshacer.`)) return;
      await busy(e.target, async () => {
        const { data: full } = await db.from("vehicles").select("photos").eq("id", id).maybeSingle();
        const { error } = await db.from("vehicles").delete().eq("id", id);
        if (error) { toast("No se pudo eliminar: " + errMsg(error)); return; }
        await removePhotos(full?.photos || []);
        toast("Publicación eliminada."); renderAccount();
      });
    } else {
      const status = act === "sold" ? "sold" : "pending";
      if (act === "sold" && !confirm(`¿Marcar el ${title(v)} como vendido? Deja de aparecer en el catálogo.`)) return;
      await busy(e.target, async () => {
        const { error } = await db.from("vehicles").update({ status }).eq("id", id);
        if (error) { toast("No se pudo actualizar: " + errMsg(error)); return; }
        toast(act === "sold" ? "¡Felicitaciones por la venta!" : "Enviada a revisión para volver a publicarse."); renderAccount();
      });
    }
  });
  const af = $("#agencyForm");
  if (af) af.addEventListener("submit", async e => {
    e.preventDefault();
    if (!af.checkValidity()) { af.reportValidity(); return; }
    const d = new FormData(af);
    await busy($("button", af), async () => {
      const { error } = await db.from("agency_requests").insert({ requested_by: uid, dealership_name: d.get("dealership_name").trim(), city: d.get("city"), phone: d.get("phone").trim(), cuit: d.get("cuit").trim() || null, status: "pending" });
      if (error) { toast("No se pudo enviar: " + errMsg(error)); return; }
      toast("Solicitud enviada. Te avisamos cuando esté aprobada."); renderAccount();
    });
  });
}

/* ---------- Administración ---------- */
let adminTab = "pubs", adminPubFilter = "pending";
async function renderAdmin() {
  if (!requireLogin("#/admin")) return;
  if (!state.isStaff) { app().innerHTML = '<div class="empty">No tenés permisos para acceder a administración.</div>'; return; }
  setMeta("Administración");
  const { data: st, error } = await db.rpc("admin_stats");
  if (error) throw error;
  const tabs = { pubs: `Publicaciones${st.vehicles_pending ? ` (${st.vehicles_pending})` : ""}`, agencies: `Concesionarias${st.agency_requests_pending ? ` (${st.agency_requests_pending})` : ""}`, users: "Usuarios", inq: "Consultas" };
  app().innerHTML = `
  <div class="sectionhead"><div><div class="eyebrow">${state.isOwner ? "Propietario" : "Administrador"}</div><h1>Administración</h1></div></div>
  <div class="stats">
   <div class="stat"><span class="muted">Publicados</span><b>${st.vehicles_approved}</b></div>
   <div class="stat"><span class="muted">Por revisar</span><b>${st.vehicles_pending}</b></div>
   <div class="stat"><span class="muted">Usuarios</span><b>${st.users}</b></div>
   <div class="stat"><span class="muted">Concesionarias</span><b>${st.dealerships}</b></div>
   <div class="stat"><span class="muted">Vendidos</span><b>${st.vehicles_sold}</b></div>
   <div class="stat"><span class="muted">Consultas (30 días)</span><b>${st.inquiries_30d}</b></div>
   <div class="stat"><span class="muted">Consultas totales</span><b>${st.inquiries}</b></div>
   <div class="stat"><span class="muted">Solicitudes agencia</span><b>${st.agency_requests_pending}</b></div>
  </div>
  <div class="tabs" id="tabs">${Object.entries(tabs).map(([k, l]) => `<button data-tab="${k}" class="${k === adminTab ? "on" : ""}">${l}</button>`).join("")}</div>
  <div id="adminBody"><div class="loading">Cargando…</div></div>`;
  $("#tabs").addEventListener("click", e => { if (e.target.dataset.tab) { adminTab = e.target.dataset.tab; renderAdmin(); } });
  const body = $("#adminBody");
  if (adminTab === "pubs") await adminPubs(body);
  else if (adminTab === "agencies") await adminAgencies(body);
  else if (adminTab === "users") await adminUsers(body);
  else await adminInquiries(body);
}
async function adminPubs(body) {
  let q = db.from("vehicles").select("id,brand,model,year,price,city,status,photos,featured,seller_type,created_at,seller:profiles(email),dealership:dealerships(name)").order("created_at", { ascending: false }).limit(200);
  if (adminPubFilter) q = q.eq("status", adminPubFilter);
  const { data, error } = await q; if (error) throw error;
  const list = data || [];
  body.innerHTML = `<div class="panel">
   <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><h3 style="margin:0">Publicaciones</h3>
    <select id="pubFilter" style="max-width:220px">${opts({ pending: "Por revisar", approved: "Publicadas", rejected: "Rechazadas", sold: "Vendidas" }, adminPubFilter, "Todas")}</select></div>
   <div class="list" id="pubList" style="margin-top:14px">${list.map(v => {
    v.extra = `<br><span class="muted small">${esc(v.seller_type === "dealer" ? v.dealership?.name || "Concesionaria" : "Particular")} · ${esc(v.seller?.email || "")} · ${fdate(v.created_at)}</span>`;
    return vehicleRow(v, `<a class="btn ghost small" href="#/auto/${v.id}">Ver</a>` +
      (v.status !== "approved" ? `<button class="btn ok small" data-act="approved" data-id="${v.id}">Aprobar</button>` : "") +
      (v.status === "pending" || v.status === "approved" ? `<button class="btn danger small" data-act="rejected" data-id="${v.id}">Rechazar</button>` : "") +
      (v.status === "approved" ? `<button class="btn light small" data-act="feature" data-id="${v.id}">${v.featured ? "Quitar destacado" : "★ Destacar"}</button>` : "") +
      `<button class="btn danger small" data-act="delete" data-id="${v.id}">Eliminar</button>`);
  }).join("") || '<div class="empty">No hay publicaciones en esta lista.</div>'}</div></div>`;
  $("#pubFilter").addEventListener("change", e => { adminPubFilter = e.target.value; renderAdmin(); });
  const byId = Object.fromEntries(list.map(v => [v.id, v]));
  $("#pubList").addEventListener("click", async e => {
    const { act, id } = e.target.dataset; if (!act) return;
    const v = byId[id];
    await busy(e.target, async () => {
      let error;
      if (act === "delete") {
        if (!confirm(`¿Eliminar definitivamente ${title(v)}? Se borran fotos y consultas. No se puede deshacer.`)) return;
        ({ error } = await db.from("vehicles").delete().eq("id", id));
        if (!error) await removePhotos(v.photos || []);
      } else if (act === "feature") {
        ({ error } = await db.from("vehicles").update({ featured: !v.featured }).eq("id", id));
      } else {
        ({ error } = await db.from("vehicles").update({ status: act }).eq("id", id));
      }
      if (error) { toast("Error: " + errMsg(error)); return; }
      toast("Listo."); renderAdmin();
    });
  });
}
async function adminAgencies(body) {
  const [{ data: reqs, error: e1 }, { data: deals, error: e2 }, { data: members }] = await Promise.all([
    db.from("agency_requests").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("dealerships").select("*").order("created_at", { ascending: false }),
    db.from("dealership_members").select("dealership_id,member_role,user:profiles(email,full_name)"),
  ]);
  if (e1) throw e1; if (e2) throw e2;
  const ids = [...new Set((reqs || []).map(r => r.requested_by))];
  const { data: profs } = ids.length ? await db.from("profiles").select("id,email,full_name").in("id", ids) : { data: [] };
  const who = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const pend = (reqs || []).filter(r => r.status === "pending");
  body.innerHTML = `
  <div class="panel"><h3>Solicitudes pendientes</h3><div class="list" id="reqList">${pend.map(r => `<div class="row"><div class="info"><b>${esc(r.dealership_name)}</b>
    <span class="muted small">${esc(r.city)} · Tel. ${esc(r.phone)}${r.cuit ? " · CUIT " + esc(r.cuit) : ""}</span><br><span class="muted small">Pedida por ${esc(who[r.requested_by]?.full_name || "")} ${esc(who[r.requested_by]?.email || "")} · ${fdate(r.created_at)}</span></div>
    <div class="btns"><button class="btn ok small" data-req="approved" data-id="${r.id}">Aprobar y crear agencia</button><button class="btn danger small" data-req="rejected" data-id="${r.id}">Rechazar</button></div></div>`).join("") || '<div class="empty">No hay solicitudes pendientes.</div>'}</div></div>
  <div class="panel"><h3>Concesionarias</h3><div class="list" id="dealList">${(deals || []).map(d => {
    const ms = (members || []).filter(m => m.dealership_id === d.id);
    return `<div class="row"><div class="info"><b>${esc(d.name)}</b><span class="muted small">${esc(d.city || "")}${d.phone ? " · " + esc(d.phone) : ""}</span><br>${pill(d.status)}
     <div class="muted small" style="margin-top:4px">${ms.map(m => `${esc(m.user?.email || "")} (${m.member_role === "manager" ? "encargado" : "vendedor"})`).join(" · ") || "Sin usuarios vinculados"}</div></div>
     <div class="btns">${d.status === "approved" ? `<button class="btn danger small" data-deal="suspended" data-id="${d.id}">Suspender</button>` : `<button class="btn ok small" data-deal="approved" data-id="${d.id}">Activar</button>`}
      ${d.status === "approved" ? `<button class="btn light small" data-add="${d.id}">+ Vincular usuario</button>` : ""}</div></div>`;
  }).join("") || '<div class="empty">Todavía no hay concesionarias.</div>'}</div></div>`;
  $("#reqList").addEventListener("click", async e => {
    const { req, id } = e.target.dataset; if (!req) return;
    await busy(e.target, async () => {
      const { error } = await db.rpc("set_agency_request_status", { target_request_id: id, new_status: req });
      if (error) { toast("Error: " + errMsg(error)); return; }
      toast(req === "approved" ? "Concesionaria creada y usuario vinculado." : "Solicitud rechazada."); renderAdmin();
    });
  });
  $("#dealList").addEventListener("click", async e => {
    const { deal, add, id } = e.target.dataset;
    if (deal) await busy(e.target, async () => {
      if (deal === "suspended" && !confirm("¿Suspender esta concesionaria? Sus autos dejan de verse en el catálogo.")) return;
      const { error } = await db.rpc("set_dealership_status", { target_dealership_id: id, new_status: deal });
      if (error) { toast("Error: " + errMsg(error)); return; }
      toast("Estado actualizado."); renderAdmin();
    });
    if (add) {
      const email = (prompt("Email del usuario a vincular (tiene que tener cuenta creada):") || "").trim().toLowerCase();
      if (!email) return;
      const manager = confirm("¿Será ENCARGADO de la agencia? (Aceptar = encargado, puede editar todo el inventario. Cancelar = vendedor)");
      const { data: p } = await db.from("profiles").select("id").ilike("email", email).maybeSingle();
      if (!p) { toast("No existe un usuario con ese email."); return; }
      const { error } = await db.rpc("add_dealership_member", { target_dealership_id: add, target_user_id: p.id, new_member_role: manager ? "manager" : "seller" });
      if (error) { toast("Error: " + errMsg(error)); return; }
      toast("Usuario vinculado."); renderAdmin();
    }
  });
}
async function adminUsers(body) {
  const { data, error } = await db.from("profiles").select("id,email,full_name,role,created_at").order("created_at", { ascending: false }).limit(500);
  if (error) throw error;
  const draw = filter => (data || []).filter(u => !filter || `${u.email} ${u.full_name}`.toLowerCase().includes(filter)).map(u => `
   <div class="row"><div class="info"><b>${esc(u.full_name || "(sin nombre)")}</b><span class="muted small">${esc(u.email || "")} · desde ${fdate(u.created_at)}</span></div>
    <div class="btns">${state.isOwner && u.role !== "owner" ? `<select data-user="${u.id}" style="width:auto">${opts({ individual: "Particular", dealer: "Concesionaria", admin: "Administrador" }, u.role)}</select>` : `<span class="pill">${esc(ROLES[u.role] || u.role)}</span>`}</div></div>`).join("") || '<div class="empty">Sin resultados.</div>';
  body.innerHTML = `<div class="panel"><h3>Usuarios</h3>
   ${state.isOwner ? '<p class="muted small">Como propietario podés nombrar administradores. Los administradores pueden aprobar publicaciones y agencias, pero no cambiar roles.</p>' : ""}
   <input id="userSearch" placeholder="Buscar por nombre o email"><div class="list" id="userList" style="margin-top:12px">${draw("")}</div></div>`;
  $("#userSearch").addEventListener("input", e => $("#userList").innerHTML = draw(e.target.value.toLowerCase().trim()));
  $("#userList").addEventListener("change", async e => {
    const id = e.target.dataset.user; if (!id) return;
    const role = e.target.value;
    if (!confirm(`¿Cambiar el rol a "${ROLES[role]}"?`)) { renderAdmin(); return; }
    const { error } = await db.rpc("set_user_role", { target_user_id: id, new_role: role });
    if (error) { toast("Error: " + errMsg(error)); renderAdmin(); return; }
    toast("Rol actualizado.");
  });
}
async function adminInquiries(body) {
  const { data, error } = await db.from("inquiries").select("id,buyer_name,buyer_phone,message,created_at,vehicle:vehicles(id,brand,model,year)").order("created_at", { ascending: false }).limit(150);
  if (error) throw error;
  body.innerHTML = `<div class="panel"><h3>Últimas consultas</h3><div class="list">${(data || []).map(q => `<div class="row"><div class="info"><b>${esc(q.buyer_name)} · ${esc(q.buyer_phone)}</b>
   <span class="muted small">${q.vehicle ? `<a href="#/auto/${q.vehicle.id}">${esc(title(q.vehicle))} ${esc(q.vehicle.year || "")}</a>` : "Vehículo eliminado"} · ${fdate(q.created_at)}</span>${q.message ? `<div class="small" style="margin-top:4px">${esc(q.message)}</div>` : ""}</div></div>`).join("") || '<div class="empty">Todavía no hay consultas.</div>'}</div></div>`;
}

/* ---------- Ingreso / registro ---------- */
function renderAuth() {
  setMeta("Ingresar");
  if (state.user) {
    const next = sessionStorage.getItem("afterLogin"); sessionStorage.removeItem("afterLogin");
    go(next && next !== "#/ingresar" ? next : "#/mi-cuenta"); return;
  }
  let mode = "login";
  app().innerHTML = `
  <div class="sectionhead"><div><div class="eyebrow">Tu cuenta</div><h1 id="authTitle">Ingresar</h1><p class="muted" style="margin:4px 0 0">Para publicar vehículos y ver tus consultas.</p></div></div>
  <form class="panel" id="authForm" style="max-width:520px;margin-top:0">
   <div class="field hidden" id="nameField"><label>Nombre y apellido</label><input id="authName" autocomplete="name" maxlength="100"></div>
   <div class="field" style="margin-top:12px"><label>Email</label><input id="authEmail" type="email" required autocomplete="email" autocapitalize="off"></div>
   <div class="field" style="margin-top:12px" id="passField"><label>Contraseña</label><input id="authPassword" type="password" required minlength="8" autocomplete="current-password"><div class="hint hidden" id="passHint">Mínimo 8 caracteres.</div></div>
   <div class="actions"><button class="btn" type="submit" id="authSubmit">Ingresar</button><button class="btn ghost" type="button" id="toggle">Crear cuenta nueva</button></div>
   <p style="margin:14px 0 0"><a href="#" id="forgot" class="small">Olvidé mi contraseña</a></p>
   <p id="authMsg" class="notice info hidden"></p>
  </form>`;
  const setMode = m => {
    mode = m;
    $("#authTitle").textContent = { login: "Ingresar", signup: "Crear cuenta", reset: "Recuperar contraseña" }[m];
    $("#authSubmit").textContent = { login: "Ingresar", signup: "Crear mi cuenta", reset: "Enviarme el link" }[m];
    $("#toggle").textContent = m === "login" ? "Crear cuenta nueva" : "Ya tengo cuenta";
    $("#nameField").classList.toggle("hidden", m !== "signup");
    $("#authName").required = m === "signup";
    $("#passField").classList.toggle("hidden", m === "reset");
    $("#authPassword").required = m !== "reset";
    $("#authPassword").autocomplete = m === "signup" ? "new-password" : "current-password";
    $("#passHint").classList.toggle("hidden", m !== "signup");
    $("#forgot").classList.toggle("hidden", m !== "login");
  };
  $("#toggle").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
  $("#forgot").addEventListener("click", e => { e.preventDefault(); setMode("reset"); });
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target; if (!f.checkValidity()) { f.reportValidity(); return; }
    const email = $("#authEmail").value.trim(), password = $("#authPassword").value;
    const msg = t => { const m = $("#authMsg"); m.textContent = t; m.classList.remove("hidden"); };
    const redirect = location.origin + location.pathname;
    await busy($("#authSubmit"), async () => {
      if (mode === "reset") {
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: redirect });
        msg(error ? errMsg(error) : "Si el email está registrado, te enviamos un link para crear una contraseña nueva.");
        return;
      }
      const r = mode === "signup"
        ? await db.auth.signUp({ email, password, options: { data: { full_name: $("#authName").value.trim() }, emailRedirectTo: redirect } })
        : await db.auth.signInWithPassword({ email, password });
      if (r.error) {
        const m = r.error.message;
        msg(/Invalid login/i.test(m) ? "Email o contraseña incorrectos." : /already registered/i.test(m) ? "Ese email ya tiene cuenta. Ingresá o recuperá tu contraseña." : /Email not confirmed/i.test(m) ? "Todavía no confirmaste tu email. Revisá tu correo (y la carpeta de spam)." : errMsg(r.error));
        return;
      }
      if (mode === "signup" && !r.data.session) { msg("¡Cuenta creada! Te enviamos un email para confirmarla. Abrí el link y después ingresá acá."); return; }
      await loadSession(r.data.session);
      toast("¡Bienvenido/a!");
      const next = sessionStorage.getItem("afterLogin"); sessionStorage.removeItem("afterLogin");
      go(next && next !== "#/ingresar" ? next : "#/mi-cuenta");
    });
  });
}
function renderNewPassword() {
  setMeta("Nueva contraseña");
  if (!state.user) { go("#/ingresar"); return; }
  app().innerHTML = `
  <div class="sectionhead"><div><div class="eyebrow">Tu cuenta</div><h1>Crear contraseña nueva</h1></div></div>
  <form class="panel" id="npForm" style="max-width:520px;margin-top:0">
   <div class="field"><label>Contraseña nueva</label><input id="np" type="password" required minlength="8" autocomplete="new-password"><div class="hint">Mínimo 8 caracteres.</div></div>
   <div class="actions"><button class="btn" type="submit">Guardar contraseña</button></div>
  </form>`;
  $("#npForm").addEventListener("submit", async e => {
    e.preventDefault(); if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
    await busy($("button", e.target), async () => {
      const { error } = await db.auth.updateUser({ password: $("#np").value });
      if (error) { toast(errMsg(error)); return; }
      toast("Contraseña actualizada."); go("#/mi-cuenta");
    });
  });
}

/* ---------- Legales ---------- */
function renderLegal() {
  setMeta("Términos y privacidad");
  app().innerHTML = `<div class="panel legal" style="max-width:820px;margin:0 auto">
  <div class="eyebrow">Legales</div><h1 style="margin-top:6px">Términos y condiciones</h1>
  <p class="muted small">Última actualización: noviembre de 2026.</p>
  <p>AUTOS CÓRDOBA es una plataforma de clasificados que pone en contacto a personas y concesionarias que venden vehículos con personas interesadas en comprarlos. AUTOS CÓRDOBA no es parte de las operaciones de compraventa, no es propietaria de los vehículos publicados y no interviene en pagos, entregas ni transferencias.</p>
  <h2>Publicaciones</h2>
  <ul>
   <li>Quien publica declara ser titular del vehículo o estar autorizado para venderlo, y que la información y fotos son reales y actuales.</li>
   <li>Las publicaciones se revisan antes de mostrarse. Podemos rechazar, editar su visibilidad o eliminar publicaciones que sean engañosas, duplicadas, ilegales o que no correspondan a vehículos.</li>
   <li>Está prohibido publicar datos de terceros sin autorización, contenido ofensivo o enlaces a otros sitios.</li>
  </ul>
  <h2>Compradores</h2>
  <ul>
   <li>Recomendamos ver el vehículo en persona, verificar la documentación (título, cédula, informe de dominio del Registro Automotor) y no realizar pagos ni señas sin haber visto el vehículo.</li>
   <li>AUTOS CÓRDOBA no garantiza el estado de los vehículos ni la veracidad de la información cargada por los vendedores.</li>
  </ul>
  <h2>Cuentas</h2>
  <p>Cada usuario es responsable de mantener segura su contraseña. Podemos suspender cuentas que incumplan estos términos.</p>
  <h1 style="margin-top:36px">Política de privacidad</h1>
  <ul>
   <li><b>Qué datos guardamos:</b> email, nombre, publicaciones y fotos que cargás, y los datos que un comprador envía en una consulta (nombre, teléfono y mensaje).</li>
   <li><b>Para qué:</b> para que funcione la plataforma, para que el vendedor pueda responder consultas y para prevenir fraudes.</li>
   <li><b>Qué es público:</b> los datos del vehículo, las fotos y, si lo cargás, el número de WhatsApp de contacto de la publicación. Tu email no se muestra.</li>
   <li><b>Tus derechos:</b> podés pedir acceso, corrección o eliminación de tus datos (Ley 25.326 de Protección de Datos Personales). La Agencia de Acceso a la Información Pública es el órgano de control.</li>
   <li>No vendemos tus datos a terceros.</li>
  </ul>
  </div>`;
}

/* ---------- Inicio de la app ---------- */
$("#year").textContent = new Date().getFullYear();
db.auth.onAuthStateChange((event, session) => {
  setTimeout(async () => {
    const prev = state.user?.id;
    await loadSession(session);
    if (event === "PASSWORD_RECOVERY") { state.ready = true; go("#/nueva-clave"); return; }
    if (!state.ready) { state.ready = true; route(); return; }
    if (prev !== state.user?.id && event !== "INITIAL_SESSION") route();
  }, 0);
});

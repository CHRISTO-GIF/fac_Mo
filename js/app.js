/* ================= FactoPro — logique locale (hors ligne) ================= */
(function () {
  "use strict";

  // ---------- Stockage ----------
  const KEYS = {
    company: "factopro_company",
    docs: "factopro_documents",
    counters: "factopro_counters",
    clients: "factopro_clients",
    articles: "factopro_articles",
  };

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  // ---------- État courant ----------
  let company = store.get(KEYS.company, {
    name: "",
    phone: "",
    email: "",
    address: "",
    taxId: "",
    currency: "XOF",
    logo: "", // dataURL
  });

  let documents = store.get(KEYS.docs, []); // liste des documents enregistrés
  let counters = store.get(KEYS.counters, { facture: 0, proforma: 0, devis: 0 });
  let clients = store.get(KEYS.clients, []);   // carnet de clients {id,name,phone,address}
  let articles = store.get(KEYS.articles, []); // catalogue d'articles {id,desc,price}

  // Onglet actif du carnet
  let catalogTab = "clients";

  // Brouillon en cours d'édition
  let draft = null;

  // Filtre actif sur l'accueil
  let currentFilter = "tous";

  const TYPE_LABELS = { facture: "Facture", proforma: "Proforma", devis: "Devis" };
  const TYPE_PREFIX = { facture: "FAC", proforma: "PRO", devis: "DEV" };
  const STATUS_LABELS = { impaye: "Impayé", partiel: "Partiel", paye: "Payé" };

  // Devises disponibles : { libellé, symbole, décimales, position du symbole }
  const CURRENCIES = {
    XOF: { label: "Franc CFA (FCFA)", symbol: "FCFA", decimals: 0, pos: "after" },
    EUR: { label: "Euro (€)", symbol: "€", decimals: 2, pos: "after" },
    USD: { label: "Dollar US ($)", symbol: "$", decimals: 2, pos: "before" },
    MAD: { label: "Dirham marocain (MAD)", symbol: "MAD", decimals: 2, pos: "after" },
    NGN: { label: "Naira (₦)", symbol: "₦", decimals: 2, pos: "before" },
    GHS: { label: "Cedi (₵)", symbol: "₵", decimals: 2, pos: "before" },
  };
  const DEFAULT_CURRENCY = "XOF";

  // ---------- Utilitaires ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function fmtMoney(n) {
    const cur = CURRENCIES[company.currency] || CURRENCIES[DEFAULT_CURRENCY];
    const num = (Number(n) || 0)
      .toLocaleString("fr-FR", { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals });
    return cur.pos === "before" ? cur.symbol + " " + num : num + " " + cur.symbol;
  }

  function fmtDate(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  // ================= CARNET : clients & articles =================
  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  // Remplit les listes d'autocomplétion à partir du carnet
  function populateDatalists() {
    const cd = $("#clients-datalist");
    const ad = $("#articles-datalist");
    if (cd) cd.innerHTML = clients.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join("");
    if (ad) ad.innerHTML = articles.map((a) => `<option value="${escapeHtml(a.desc)}"></option>`).join("");
  }

  // Auto-remplissage client (téléphone/adresse) si le nom correspond à un client connu
  function autofillClient(name) {
    const c = clients.find((x) => norm(x.name) === norm(name));
    if (!c) return;
    if (!$("#client-phone").value) { $("#client-phone").value = c.phone || ""; draft.client.phone = c.phone || ""; }
    if (!$("#client-address").value) { $("#client-address").value = c.address || ""; draft.client.address = c.address || ""; }
  }

  // Auto-remplissage prix d'un article si la désignation correspond à un article connu
  function articlePriceFor(desc) {
    const a = articles.find((x) => norm(x.desc) === norm(desc));
    return a ? a.price : null;
  }

  // Mémorise un client / article s'il est nouveau (appelé à l'enregistrement)
  function rememberClient(client) {
    if (!client.name) return;
    const existing = clients.find((c) => norm(c.name) === norm(client.name));
    if (existing) {
      // met à jour tél/adresse si renseignés
      if (client.phone) existing.phone = client.phone;
      if (client.address) existing.address = client.address;
    } else {
      clients.push({ id: uid(), name: client.name, phone: client.phone || "", address: client.address || "" });
    }
    store.set(KEYS.clients, clients);
  }

  function rememberArticles(items) {
    let changed = false;
    for (const it of items) {
      const desc = (it.desc || "").trim();
      const price = Number(it.price) || 0;
      if (!desc) continue;
      const existing = articles.find((a) => norm(a.desc) === norm(desc));
      if (existing) {
        if (price > 0) { existing.price = price; changed = true; }
      } else {
        articles.push({ id: uid(), desc, price });
        changed = true;
      }
    }
    if (changed) store.set(KEYS.articles, articles);
  }

  // ---------- Écran Carnet ----------
  function openCatalog() {
    catalogTab = "clients";
    renderCatalog();
    showScreen("screen-catalog");
  }

  function renderCatalog() {
    // onglets
    $$("#catalog-tabs .seg").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === catalogTab));
    $("#catalog-clients").hidden = catalogTab !== "clients";
    $("#catalog-articles").hidden = catalogTab !== "articles";

    // clients
    const cl = $("#clients-list");
    cl.innerHTML = "";
    $("#clients-empty").hidden = clients.length > 0;
    [...clients].sort((a, b) => a.name.localeCompare(b.name, "fr")).forEach((c) => {
      const li = document.createElement("li");
      li.className = "catalog-item";
      const sub = [c.phone, c.address].filter(Boolean).join(" · ");
      li.innerHTML = `
        <div class="cat-main">
          <div class="cat-title">${escapeHtml(c.name)}</div>
          ${sub ? `<div class="cat-sub">${escapeHtml(sub)}</div>` : ""}
        </div>
        <button class="cat-del" data-del-client="${c.id}" aria-label="Supprimer">🗑</button>`;
      cl.appendChild(li);
    });

    // articles
    const al = $("#articles-list");
    al.innerHTML = "";
    $("#articles-empty").hidden = articles.length > 0;
    [...articles].sort((a, b) => a.desc.localeCompare(b.desc, "fr")).forEach((a) => {
      const li = document.createElement("li");
      li.className = "catalog-item";
      li.innerHTML = `
        <div class="cat-main">
          <div class="cat-title">${escapeHtml(a.desc)}</div>
        </div>
        <div class="cat-price">${fmtMoney(a.price)}</div>
        <button class="cat-del" data-del-article="${a.id}" aria-label="Supprimer">🗑</button>`;
      al.appendChild(li);
    });

    // suppression
    cl.querySelectorAll("[data-del-client]").forEach((btn) =>
      btn.addEventListener("click", () => {
        clients = clients.filter((c) => c.id !== btn.dataset.delClient);
        store.set(KEYS.clients, clients);
        populateDatalists();
        renderCatalog();
      })
    );
    al.querySelectorAll("[data-del-article]").forEach((btn) =>
      btn.addEventListener("click", () => {
        articles = articles.filter((a) => a.id !== btn.dataset.delArticle);
        store.set(KEYS.articles, articles);
        populateDatalists();
        renderCatalog();
      })
    );
  }

  // ---------- Navigation entre écrans ----------
  function showScreen(id) {
    $$(".screen").forEach((s) => s.classList.remove("is-active"));
    $("#" + id).classList.add("is-active");
    document.querySelector(".content").scrollTop = 0;
    const active = $("#" + id + " .content");
    if (active) active.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  // ================= ÉCRAN ACCUEIL =================
  function renderHome() {
    // marque / logo
    const logoImg = $("#home-logo");
    const fallback = $("#home-logo-fallback");
    if (company.logo) {
      logoImg.src = company.logo;
      logoImg.hidden = false;
      fallback.hidden = true;
    } else {
      logoImg.hidden = true;
      fallback.hidden = false;
      fallback.textContent = (company.name || "F").trim().charAt(0).toUpperCase();
    }
    $("#home-company-name").textContent = company.name || "Configurez votre entreprise";

    // tableau de bord + filtres
    renderStats();
    renderFilters();

    // liste documents (récents en premier), filtrée
    const list = $("#doc-list");
    const empty = $("#doc-empty");
    list.innerHTML = "";

    if (documents.length === 0) {
      empty.hidden = false;
      $("#doc-count").textContent = 0;
      return;
    }
    empty.hidden = true;

    const sorted = [...documents].sort((a, b) => new Date(b.date) - new Date(a.date));
    const visible = sorted.filter((doc) => {
      if (currentFilter === "tous") return true;
      // les filtres de statut ne concernent que les factures
      return doc.type === "facture" && (doc.status || "impaye") === currentFilter;
    });
    $("#doc-count").textContent = visible.length;

    if (visible.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-state";
      li.style.padding = "24px 12px";
      li.innerHTML = "<p>Aucune facture dans ce filtre.</p>";
      list.appendChild(li);
      return;
    }

    for (const doc of visible) {
      const isFacture = doc.type === "facture";
      const st = doc.status || "impaye";
      const statusChip = isFacture
        ? `<span class="status-chip ${st}">${STATUS_LABELS[st]}</span>`
        : "";
      const li = document.createElement("li");
      li.className = "doc-item";
      li.dataset.id = doc.id;
      li.innerHTML = `
        <div class="doc-badge ${doc.type}">${TYPE_LABELS[doc.type]}</div>
        <div class="doc-main">
          <div class="doc-client">${escapeHtml(doc.client.name || "Sans nom")}</div>
          <div class="doc-meta">${escapeHtml(doc.number)} · ${fmtDate(doc.date)}</div>
          ${statusChip}
        </div>
        <div class="doc-amount">${fmtMoney(computeTotals(doc).ttc)}</div>
      `;
      li.addEventListener("click", () => openDocument(doc.id));
      list.appendChild(li);
    }
  }

  // Tableau de bord : totaux calculés sur les factures
  function renderStats() {
    const factures = documents.filter((d) => d.type === "facture");
    const statsEl = $("#stats");
    if (factures.length === 0) {
      statsEl.hidden = true;
      return;
    }
    let billed = 0, paid = 0;
    for (const f of factures) {
      const ttc = computeTotals(f).ttc;
      billed += ttc;
      paid += Math.min(Number(f.paidAmount) || 0, ttc);
    }
    const due = Math.max(0, billed - paid);
    $("#stat-billed").textContent = fmtMoney(billed);
    $("#stat-paid").textContent = fmtMoney(paid);
    $("#stat-due").textContent = fmtMoney(due);
    statsEl.hidden = false;
  }

  // Affiche les filtres seulement s'il y a au moins une facture
  function renderFilters() {
    const hasFacture = documents.some((d) => d.type === "facture");
    $("#filters").hidden = !hasFacture;
    $$("#filters .chip").forEach((c) =>
      c.classList.toggle("is-active", c.dataset.filter === currentFilter)
    );
  }

  // ================= CALCULS =================
  function computeTotals(doc) {
    const ht = (doc.items || []).reduce(
      (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0),
      0
    );
    const tax = doc.taxEnabled ? ht * ((Number(doc.taxRate) || 0) / 100) : 0;
    return { ht, tax, ttc: ht + tax };
  }

  // ================= ÉCRAN ÉDITION =================
  function newDraft() {
    draft = {
      id: null,
      type: "facture",
      number: null,
      date: new Date().toISOString(),
      client: { name: "", phone: "", address: "" },
      items: [{ desc: "", qty: 1, price: 0 }],
      taxEnabled: false,
      taxRate: 19.25,
      status: "impaye",
      paidAmount: 0,
    };
  }

  // Solde restant dû (factures)
  function balanceOf(doc) {
    return Math.max(0, computeTotals(doc).ttc - (Number(doc.paidAmount) || 0));
  }

  function openEdit(existing) {
    if (existing) {
      draft = JSON.parse(JSON.stringify(existing));
    } else {
      newDraft();
    }
    // « existant » = déjà enregistré (possède un id). Une copie (id null) est traitée comme un nouveau document.
    const isEditing = !!(existing && existing.id);
    $("#edit-title").textContent = isEditing ? "Modifier le document" : "Nouveau document";
    $("#doc-actions").hidden = !isEditing;
    populateDatalists();

    // type
    $$("#doc-type .seg").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.type === draft.type)
    );
    // client
    $("#client-name").value = draft.client.name || "";
    $("#client-phone").value = draft.client.phone || "";
    $("#client-address").value = draft.client.address || "";
    // taxe
    $("#tax-enabled").checked = !!draft.taxEnabled;
    $("#tax-rate").value = draft.taxRate;
    $("#tax-rate-field").hidden = !draft.taxEnabled;

    // statut de paiement
    if (!draft.status) draft.status = "impaye";
    $$("#pay-status .seg").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.status === draft.status)
    );
    $("#paid-amount").value = draft.paidAmount || 0;

    renderItems();
    updateEditTotals();
    updatePaymentUI();
    showScreen("screen-edit");
  }

  // Affiche la carte paiement (factures seulement) et le champ « montant payé »
  function updatePaymentUI() {
    const isFacture = draft.type === "facture";
    $("#payment-card").hidden = !isFacture;
    const showAmount = isFacture && draft.status === "partiel";
    $("#paid-amount-field").hidden = !showAmount;
    if (showAmount) {
      const ttc = computeTotals(draft).ttc;
      const reste = Math.max(0, ttc - (Number(draft.paidAmount) || 0));
      $("#balance-hint").textContent = "Reste à payer : " + fmtMoney(reste);
    }
  }

  function renderItems() {
    const wrap = $("#items-list");
    wrap.innerHTML = "";
    draft.items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "item-row";
      row.innerHTML = `
        <div class="field item-desc">
          <label class="field-label">Désignation</label>
          <input type="text" list="articles-datalist" autocomplete="off" data-idx="${idx}" data-k="desc" placeholder="Ex. Sac de ciment" value="${escapeHtml(item.desc)}" />
        </div>
        <div class="item-grid">
          <div class="field">
            <label class="field-label">Quantité</label>
            <input type="number" inputmode="decimal" data-idx="${idx}" data-k="qty" value="${item.qty}" min="0" step="any" />
          </div>
          <div class="field">
            <label class="field-label">Prix unitaire</label>
            <input type="number" inputmode="decimal" data-idx="${idx}" data-k="price" value="${item.price}" min="0" step="any" />
          </div>
          <button class="item-del" data-del="${idx}" aria-label="Supprimer">🗑</button>
        </div>
        <div class="item-line-total">Total : ${fmtMoney((Number(item.qty)||0)*(Number(item.price)||0))}</div>
      `;
      wrap.appendChild(row);
    });

    // écouteurs
    wrap.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const i = +e.target.dataset.idx;
        const k = e.target.dataset.k;
        draft.items[i][k] = e.target.value;
        // maj total ligne + totaux
        const lineTotal = e.target.closest(".item-row").querySelector(".item-line-total");
        const it = draft.items[i];
        lineTotal.textContent = "Total : " + fmtMoney((Number(it.qty)||0)*(Number(it.price)||0));
        updateEditTotals();
      });
    });
    // auto-remplissage du prix quand on choisit un article connu
    wrap.querySelectorAll('input[data-k="desc"]').forEach((inp) => {
      inp.addEventListener("change", (e) => {
        const i = +e.target.dataset.idx;
        const price = articlePriceFor(e.target.value);
        const cur = Number(draft.items[i].price) || 0;
        if (price != null && cur === 0) {
          draft.items[i].price = price;
          const row = e.target.closest(".item-row");
          const priceInput = row.querySelector('input[data-k="price"]');
          if (priceInput) priceInput.value = price;
          const it = draft.items[i];
          row.querySelector(".item-line-total").textContent =
            "Total : " + fmtMoney((Number(it.qty)||0)*(Number(it.price)||0));
          updateEditTotals();
        }
      });
    });
    wrap.querySelectorAll(".item-del").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const i = +e.currentTarget.dataset.del;
        draft.items.splice(i, 1);
        if (draft.items.length === 0) draft.items.push({ desc: "", qty: 1, price: 0 });
        renderItems();
        updateEditTotals();
      });
    });
  }

  function updateEditTotals() {
    const t = computeTotals(draft);
    $("#edit-total-ht").textContent = fmtMoney(t.ht);
    $("#edit-total-tax").textContent = fmtMoney(t.tax);
    $("#edit-total-ttc").textContent = fmtMoney(t.ttc);
    $("#edit-tax-row").hidden = !draft.taxEnabled;
    // le solde restant dépend du TTC : on rafraîchit l'indice de paiement
    if (draft.type === "facture" && draft.status === "partiel") updatePaymentUI();
  }

  function syncClientFromInputs() {
    draft.client.name = $("#client-name").value.trim();
    draft.client.phone = $("#client-phone").value.trim();
    draft.client.address = $("#client-address").value.trim();
    draft.taxEnabled = $("#tax-enabled").checked;
    draft.taxRate = Number($("#tax-rate").value) || 0;
    if (draft.type === "facture" && draft.status === "partiel") {
      draft.paidAmount = Number($("#paid-amount").value) || 0;
    }
  }

  // Normalise le statut/paiement au moment de l'enregistrement
  function normalizePayment() {
    if (draft.type !== "facture") {
      draft.status = "impaye";
      draft.paidAmount = 0;
      return;
    }
    const ttc = computeTotals(draft).ttc;
    if (draft.status === "paye") {
      draft.paidAmount = ttc;
    } else if (draft.status === "impaye") {
      draft.paidAmount = 0;
    } else {
      // partiel : borne entre 0 et le TTC
      let p = Number(draft.paidAmount) || 0;
      p = Math.max(0, Math.min(p, ttc));
      draft.paidAmount = p;
      if (p >= ttc && ttc > 0) draft.status = "paye";
      else if (p <= 0) draft.status = "impaye";
    }
  }

  // ================= ÉCRAN APERÇU =================
  function renderPreview() {
    const t = computeTotals(draft);
    const number = draft.number || previewNumber(draft.type);
    const co = company;

    const logoHtml = co.logo
      ? `<img class="inv-logo" src="${co.logo}" alt="logo" />`
      : "";

    const coLines = [
      co.phone && `Tél : ${escapeHtml(co.phone)}`,
      co.email && escapeHtml(co.email),
      co.address && escapeHtml(co.address),
      co.taxId && `N° : ${escapeHtml(co.taxId)}`,
    ].filter(Boolean).join("<br />");

    const rows = draft.items
      .filter((it) => it.desc || it.qty || it.price)
      .map((it) => {
        const lt = (Number(it.qty) || 0) * (Number(it.price) || 0);
        return `<tr>
          <td>${escapeHtml(it.desc || "-")}</td>
          <td class="num">${(Number(it.qty) || 0).toLocaleString("fr-FR")}</td>
          <td class="num">${fmtMoney(it.price)}</td>
          <td class="num">${fmtMoney(lt)}</td>
        </tr>`;
      })
      .join("");

    const clientLines = [
      draft.client.phone && `Tél : ${escapeHtml(draft.client.phone)}`,
      draft.client.address && escapeHtml(draft.client.address),
    ].filter(Boolean).join("<br />");

    // Paiement (factures uniquement) : montant payé effectif + reste
    const showPay = draft.type === "facture";
    let effPaid = 0;
    if (showPay) {
      if (draft.status === "paye") effPaid = t.ttc;
      else if (draft.status === "partiel") effPaid = Math.max(0, Math.min(Number(draft.paidAmount) || 0, t.ttc));
    }
    const reste = Math.max(0, t.ttc - effPaid);
    const stampHtml = showPay
      ? `<div class="inv-stamp ${draft.status}">${STATUS_LABELS[draft.status]}</div>`
      : "";
    const payRows = showPay && draft.status !== "impaye"
      ? `<div class="row-between"><span>Payé</span><span>${fmtMoney(effPaid)}</span></div>` +
        (reste > 0 ? `<div class="row-between"><span>Reste à payer</span><span>${fmtMoney(reste)}</span></div>` : "")
      : "";

    $("#invoice-paper").innerHTML = `
      <div class="inv-head">
        <div>
          ${logoHtml}
          <div class="inv-co-name">${escapeHtml(co.name || "Votre entreprise")}</div>
          <div class="inv-co-lines">${coLines}</div>
        </div>
        <div>
          <div class="inv-doc-type">${TYPE_LABELS[draft.type]}</div>
          <div class="inv-doc-meta">N° ${escapeHtml(number)}<br />${fmtDate(draft.date)}</div>
          ${stampHtml}
        </div>
      </div>

      <div class="inv-parties">
        <div class="inv-block">
          <div class="inv-block-label">Facturé à</div>
          <strong>${escapeHtml(draft.client.name || "Client")}</strong>
          <div class="inv-co-lines">${clientLines}</div>
        </div>
      </div>

      <table class="inv-table">
        <thead>
          <tr>
            <th>Désignation</th>
            <th class="num">Qté</th>
            <th class="num">P.U.</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="4">Aucun article</td></tr>`}</tbody>
      </table>

      <div class="inv-totals">
        <div class="row-between"><span>Total HT</span><span>${fmtMoney(t.ht)}</span></div>
        ${draft.taxEnabled ? `<div class="row-between"><span>TVA (${draft.taxRate}%)</span><span>${fmtMoney(t.tax)}</span></div>` : ""}
        <div class="row-between grand"><span>Total TTC</span><span>${fmtMoney(t.ttc)}</span></div>
        ${payRows}
      </div>

      <div class="inv-foot">
        ${draft.type === "devis" ? "Devis valable 30 jours. " : ""}Merci de votre confiance — ${escapeHtml(co.name || "FactoPro")}
      </div>
    `;
    showScreen("screen-preview");
  }

  // Numéro d'aperçu (sans consommer le compteur)
  function previewNumber(type) {
    const year = new Date().getFullYear();
    const next = (counters[type] || 0) + 1;
    return `${TYPE_PREFIX[type]}-${year}-${String(next).padStart(3, "0")}`;
  }

  // ================= ENREGISTREMENT =================
  function saveDraft() {
    syncClientFromInputs();
    normalizePayment();
    if (!draft.client.name) {
      toast("Ajoutez au moins le nom du client.");
      showScreen("screen-edit");
      $("#client-name").focus();
      return;
    }
    if (!draft.number) {
      // nouveau : attribuer un numéro et incrémenter le compteur
      counters[draft.type] = (counters[draft.type] || 0) + 1;
      draft.number = `${TYPE_PREFIX[draft.type]}-${new Date().getFullYear()}-${String(counters[draft.type]).padStart(3, "0")}`;
      store.set(KEYS.counters, counters);
    }
    if (draft.id) {
      const i = documents.findIndex((d) => d.id === draft.id);
      if (i >= 0) documents[i] = JSON.parse(JSON.stringify(draft));
    } else {
      draft.id = uid();
      documents.push(JSON.parse(JSON.stringify(draft)));
    }
    store.set(KEYS.docs, documents);
    // mémorise le client et les articles dans le carnet
    rememberClient(draft.client);
    rememberArticles(draft.items);
    toast("Document enregistré ✓");
    renderHome();
    showScreen("screen-home");
  }

  function openDocument(id) {
    const doc = documents.find((d) => d.id === id);
    if (doc) openEdit(doc);
  }

  // Duplique le document en cours : nouvelle copie non enregistrée (numéro/date/paiement réinitialisés)
  function duplicateDoc() {
    syncClientFromInputs();
    const copy = JSON.parse(JSON.stringify(draft));
    copy.id = null;
    copy.number = null;
    copy.date = new Date().toISOString();
    copy.status = "impaye";
    copy.paidAmount = 0;
    openEdit(copy); // id null => traité comme un nouveau document
    toast("Copie prête — enregistrez pour créer le document.");
  }

  // Supprime définitivement le document en cours
  function deleteDoc() {
    if (!draft.id) return;
    const ok = window.confirm("Supprimer définitivement ce document ?\nCette action est irréversible.");
    if (!ok) return;
    documents = documents.filter((d) => d.id !== draft.id);
    store.set(KEYS.docs, documents);
    toast("Document supprimé");
    renderHome();
    showScreen("screen-home");
  }

  // ================= IMPRESSION / PDF =================
  function printDoc() {
    if (!draft.number) draft.number = previewNumber(draft.type);
    // L'impression native permet « Enregistrer au format PDF »
    window.print();
  }

  // ================= PARTAGE (Web Share API) =================
  // Résumé texte du document (pour WhatsApp / email / presse-papier)
  function buildShareText() {
    const t = computeTotals(draft);
    const lines = [
      `${TYPE_LABELS[draft.type].toUpperCase()} N° ${draft.number}`,
      company.name || "",
      `Client : ${draft.client.name || "-"}`,
      `Date : ${fmtDate(draft.date)}`,
      `Total : ${fmtMoney(t.ttc)}`,
    ];
    if (draft.type === "facture" && draft.status !== "impaye") {
      const paid = draft.status === "paye" ? t.ttc : Math.min(Number(draft.paidAmount) || 0, t.ttc);
      const reste = Math.max(0, t.ttc - paid);
      lines.push(`Statut : ${STATUS_LABELS[draft.status]}`);
      if (reste > 0) lines.push(`Reste à payer : ${fmtMoney(reste)}`);
    }
    return lines.filter(Boolean).join("\n");
  }

  // Rend l'aperçu en image PNG (via html2canvas, embarqué → hors ligne)
  function buildInvoiceImageFile() {
    return new Promise((resolve, reject) => {
      if (typeof html2canvas !== "function") return reject(new Error("html2canvas absent"));
      const node = $("#invoice-paper");
      html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false })
        .then((canvas) => {
          canvas.toBlob((blob) => {
            if (!blob) return reject(new Error("toBlob null"));
            resolve(new File([blob], `${draft.number || "document"}.png`, { type: "image/png" }));
          }, "image/png");
        })
        .catch(reject);
    });
  }

  async function shareDoc() {
    if (!draft.number) draft.number = previewNumber(draft.type);
    const text = buildShareText();

    // 1) Partage de la facture en image (pièce jointe) — WhatsApp, email…
    let file = null;
    try { file = await buildInvoiceImageFile(); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: draft.number, text });
        return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    // 2) Partage du résumé texte
    if (navigator.share) {
      try {
        await navigator.share({ title: draft.number, text });
        return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    // 3) Repli : copie dans le presse-papier
    try {
      await navigator.clipboard.writeText(text);
      toast("Résumé copié — collez-le dans WhatsApp.");
      return;
    } catch (e) {}
    toast("Partage non disponible. Utilisez 🖨 pour le PDF.");
  }

  // ================= RÉGLAGES ENTREPRISE =================
  function fillCurrencySelect() {
    const sel = $("#co-currency");
    if (!sel) return;
    sel.innerHTML = Object.keys(CURRENCIES)
      .map((code) => `<option value="${code}">${escapeHtml(CURRENCIES[code].label)}</option>`)
      .join("");
    sel.value = company.currency || DEFAULT_CURRENCY;
  }

  function openSettings() {
    $("#co-name").value = company.name || "";
    fillCurrencySelect();
    $("#co-phone").value = company.phone || "";
    $("#co-email").value = company.email || "";
    $("#co-address").value = company.address || "";
    $("#co-taxid").value = company.taxId || "";
    const img = $("#settings-logo-img");
    const ph = $("#settings-logo-placeholder");
    if (company.logo) {
      img.src = company.logo; img.hidden = false; ph.hidden = true;
    } else {
      img.hidden = true; ph.hidden = false;
    }
    showScreen("screen-settings");
  }

  function saveSettings() {
    company.name = $("#co-name").value.trim();
    company.phone = $("#co-phone").value.trim();
    company.email = $("#co-email").value.trim();
    company.address = $("#co-address").value.trim();
    company.taxId = $("#co-taxid").value.trim();
    company.currency = $("#co-currency").value || DEFAULT_CURRENCY;
    store.set(KEYS.company, company);
    toast("Entreprise enregistrée ✓");
    renderHome();
    showScreen("screen-home");
  }

  // ================= SAUVEGARDE / RESTAURATION =================
  function exportData() {
    const payload = {
      app: "FactoPro",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: { company, documents, counters, clients, articles },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const day = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `factopro-sauvegarde-${day}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Sauvegarde exportée ✓");
  }

  function importData(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let d;
      try {
        const parsed = JSON.parse(e.target.result);
        d = parsed && parsed.data ? parsed.data : parsed; // tolère un JSON de données brut
      } catch (err) {
        toast("Fichier de sauvegarde invalide.");
        return;
      }
      if (!d || typeof d !== "object" || !Array.isArray(d.documents)) {
        toast("Fichier de sauvegarde non reconnu.");
        return;
      }
      const ok = window.confirm(
        "Importer cette sauvegarde ?\nElle remplacera toutes vos données actuelles (documents, clients, articles, entreprise)."
      );
      if (!ok) return;

      company = d.company && typeof d.company === "object" ? d.company : company;
      documents = Array.isArray(d.documents) ? d.documents : [];
      counters = d.counters && typeof d.counters === "object" ? d.counters : { facture: 0, proforma: 0, devis: 0 };
      clients = Array.isArray(d.clients) ? d.clients : [];
      articles = Array.isArray(d.articles) ? d.articles : [];

      store.set(KEYS.company, company);
      store.set(KEYS.docs, documents);
      store.set(KEYS.counters, counters);
      store.set(KEYS.clients, clients);
      store.set(KEYS.articles, articles);

      toast("Sauvegarde importée ✓");
      renderHome();
      showScreen("screen-home");
    };
    reader.readAsText(file);
  }

  function handleLogoFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast("Logo trop lourd (max 2 Mo).");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      company.logo = e.target.result;
      const img = $("#settings-logo-img");
      const ph = $("#settings-logo-placeholder");
      img.src = company.logo; img.hidden = false; ph.hidden = true;
    };
    reader.readAsDataURL(file);
  }

  // ================= ÉVÉNEMENTS =================
  function bindEvents() {
    // Accueil
    $("#btn-new-doc").addEventListener("click", () => {
      if (!company.name) {
        toast("Configurez d'abord votre entreprise.");
        openSettings();
        return;
      }
      openEdit(null);
    });
    $("#btn-settings").addEventListener("click", openSettings);
    $("#btn-settings-2").addEventListener("click", openSettings);
    $("#btn-catalog").addEventListener("click", openCatalog);
    // filtres de l'accueil
    $$("#filters .chip").forEach((c) =>
      c.addEventListener("click", () => {
        currentFilter = c.dataset.filter;
        renderHome();
      })
    );

    // Carnet
    $("#btn-catalog-back").addEventListener("click", () => { showScreen("screen-home"); });
    $$("#catalog-tabs .seg").forEach((b) =>
      b.addEventListener("click", () => { catalogTab = b.dataset.tab; renderCatalog(); })
    );

    // Édition
    $("#btn-edit-back").addEventListener("click", () => { renderHome(); showScreen("screen-home"); });
    // auto-remplissage tél/adresse quand on choisit un client connu
    $("#client-name").addEventListener("change", (e) => {
      draft.client.name = e.target.value.trim();
      autofillClient(e.target.value);
    });
    $$("#doc-type .seg").forEach((b) =>
      b.addEventListener("click", () => {
        draft.type = b.dataset.type;
        $$("#doc-type .seg").forEach((x) => x.classList.toggle("is-active", x === b));
        updatePaymentUI();
      })
    );
    // statut de paiement
    $$("#pay-status .seg").forEach((b) =>
      b.addEventListener("click", () => {
        draft.status = b.dataset.status;
        $$("#pay-status .seg").forEach((x) => x.classList.toggle("is-active", x === b));
        updatePaymentUI();
      })
    );
    $("#paid-amount").addEventListener("input", (e) => {
      draft.paidAmount = Number(e.target.value) || 0;
      updatePaymentUI();
    });
    $("#btn-add-item").addEventListener("click", () => {
      draft.items.push({ desc: "", qty: 1, price: 0 });
      renderItems();
      updateEditTotals();
    });
    $("#tax-enabled").addEventListener("change", (e) => {
      draft.taxEnabled = e.target.checked;
      $("#tax-rate-field").hidden = !e.target.checked;
      updateEditTotals();
    });
    $("#tax-rate").addEventListener("input", (e) => {
      draft.taxRate = Number(e.target.value) || 0;
      updateEditTotals();
    });
    $("#btn-preview").addEventListener("click", () => {
      syncClientFromInputs();
      renderPreview();
    });
    $("#btn-duplicate").addEventListener("click", duplicateDoc);
    $("#btn-delete").addEventListener("click", deleteDoc);

    // Aperçu
    $("#btn-preview-back").addEventListener("click", () => showScreen("screen-edit"));
    $("#btn-save").addEventListener("click", saveDraft);
    $("#btn-print").addEventListener("click", printDoc);
    $("#btn-share").addEventListener("click", shareDoc);

    // Réglages
    $("#btn-settings-back").addEventListener("click", () => { renderHome(); showScreen("screen-home"); });
    $("#btn-save-settings").addEventListener("click", saveSettings);
    $("#btn-export").addEventListener("click", exportData);
    $("#import-input").addEventListener("change", (e) => {
      importData(e.target.files[0]);
      e.target.value = ""; // permet de réimporter le même fichier
    });
    $("#logo-input").addEventListener("change", (e) => handleLogoFile(e.target.files[0]));
    $("#btn-remove-logo").addEventListener("click", () => {
      company.logo = "";
      $("#settings-logo-img").hidden = true;
      $("#settings-logo-placeholder").hidden = false;
    });
  }

  // ================= INIT =================
  function init() {
    bindEvents();
    renderHome();
    showScreen("screen-home");

    // Service worker (mode hors ligne)
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

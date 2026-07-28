/* ================= FactoPro — logique locale (hors ligne) ================= */
(function () {
  "use strict";

  // ---------- Stockage ----------
  const KEYS = {
    company: "factopro_company",
    docs: "factopro_documents",
    counters: "factopro_counters",
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
    logo: "", // dataURL
  });

  let documents = store.get(KEYS.docs, []); // liste des documents enregistrés
  let counters = store.get(KEYS.counters, { facture: 0, proforma: 0, devis: 0 });

  // Brouillon en cours d'édition
  let draft = null;

  const TYPE_LABELS = { facture: "Facture", proforma: "Proforma", devis: "Devis" };
  const TYPE_PREFIX = { facture: "FAC", proforma: "PRO", devis: "DEV" };

  // ---------- Utilitaires ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function fmtMoney(n) {
    const v = Math.round(Number(n) || 0);
    return v.toLocaleString("fr-FR").replace(/ | /g, " ") + " FCFA";
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

    // liste documents (récents en premier)
    const list = $("#doc-list");
    const empty = $("#doc-empty");
    $("#doc-count").textContent = documents.length;
    list.innerHTML = "";

    if (documents.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const sorted = [...documents].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (const doc of sorted) {
      const li = document.createElement("li");
      li.className = "doc-item";
      li.dataset.id = doc.id;
      li.innerHTML = `
        <div class="doc-badge ${doc.type}">${TYPE_LABELS[doc.type]}</div>
        <div class="doc-main">
          <div class="doc-client">${escapeHtml(doc.client.name || "Sans nom")}</div>
          <div class="doc-meta">${escapeHtml(doc.number)} · ${fmtDate(doc.date)}</div>
        </div>
        <div class="doc-amount">${fmtMoney(computeTotals(doc).ttc)}</div>
      `;
      li.addEventListener("click", () => openDocument(doc.id));
      list.appendChild(li);
    }
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
    };
  }

  function openEdit(existing) {
    if (existing) {
      draft = JSON.parse(JSON.stringify(existing));
    } else {
      newDraft();
    }
    $("#edit-title").textContent = existing ? "Modifier le document" : "Nouveau document";

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

    renderItems();
    updateEditTotals();
    showScreen("screen-edit");
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
          <input type="text" data-idx="${idx}" data-k="desc" placeholder="Ex. Sac de ciment" value="${escapeHtml(item.desc)}" />
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
        draft.items[i][k] = k === "desc" ? e.target.value : e.target.value;
        // maj total ligne + totaux
        const lineTotal = e.target.closest(".item-row").querySelector(".item-line-total");
        const it = draft.items[i];
        lineTotal.textContent = "Total : " + fmtMoney((Number(it.qty)||0)*(Number(it.price)||0));
        updateEditTotals();
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
  }

  function syncClientFromInputs() {
    draft.client.name = $("#client-name").value.trim();
    draft.client.phone = $("#client-phone").value.trim();
    draft.client.address = $("#client-address").value.trim();
    draft.taxEnabled = $("#tax-enabled").checked;
    draft.taxRate = Number($("#tax-rate").value) || 0;
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
    toast("Document enregistré ✓");
    renderHome();
    showScreen("screen-home");
  }

  function openDocument(id) {
    const doc = documents.find((d) => d.id === id);
    if (doc) openEdit(doc);
  }

  // ================= PARTAGE / PDF =================
  function shareDoc() {
    // S'assure que le document est numéroté pour un partage cohérent
    if (!draft.number) draft.number = previewNumber(draft.type);
    // L'impression native permet « Enregistrer au format PDF » puis partage
    window.print();
  }

  // ================= RÉGLAGES ENTREPRISE =================
  function openSettings() {
    $("#co-name").value = company.name || "";
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
    store.set(KEYS.company, company);
    toast("Entreprise enregistrée ✓");
    renderHome();
    showScreen("screen-home");
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

    // Édition
    $("#btn-edit-back").addEventListener("click", () => { renderHome(); showScreen("screen-home"); });
    $$("#doc-type .seg").forEach((b) =>
      b.addEventListener("click", () => {
        draft.type = b.dataset.type;
        $$("#doc-type .seg").forEach((x) => x.classList.toggle("is-active", x === b));
      })
    );
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

    // Aperçu
    $("#btn-preview-back").addEventListener("click", () => showScreen("screen-edit"));
    $("#btn-save").addEventListener("click", saveDraft);
    $("#btn-share").addEventListener("click", shareDoc);

    // Réglages
    $("#btn-settings-back").addEventListener("click", () => { renderHome(); showScreen("screen-home"); });
    $("#btn-save-settings").addEventListener("click", saveSettings);
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

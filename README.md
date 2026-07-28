# FactoPro 🧾

Application mobile (PWA) de génération de **factures**, **proformas** et **devis** en **FCFA**, pensée pour être **simple** et **100% hors ligne**.

> Nom : *Facto* (facture) + *Pro* (proforma / professionnel) — couvre les trois types de documents.

## ✨ Fonctionnalités (v1 — MVP)

- **3 types de documents** au choix : Facture · Proforma · Devis (via un simple sélecteur)
- **Logo + infos entreprise** saisis une seule fois, puis réutilisés automatiquement
- **Carnet de clients & catalogue d'articles** : autocomplétion à la saisie (le tél/adresse du client et le prix de l'article se remplissent tout seuls), mémorisation automatique, écran de gestion (consulter / supprimer)
- **Carnet d'articles** ligne par ligne (désignation, quantité, prix unitaire) avec totaux en direct
- **TVA optionnelle** (par défaut 19,25 %), activable d'un geste
- **Modifier / dupliquer / supprimer** un document (dupliquer une facture récurrente, corriger, supprimer un brouillon)
- **Numérotation automatique** par type : `FAC-2026-001`, `PRO-2026-001`, `DEV-2026-001`
- **Suivi de paiement** des factures : 🔴 Impayé · 🟠 Partiel · 🟢 Payé (avec montant payé et reste dû)
- **Tableau de bord** : total facturé, encaissé et reste à encaisser (calculés sur les factures)
- **Filtres** sur l'accueil (Toutes / Impayées / Partielles / Payées) + pastille de statut par facture
- **Aperçu professionnel** avec tampon de statut, puis **export PDF** via l'impression native du téléphone (🖨)
- **Partage en un tap** (Web Share API) : envoie un résumé du document sur WhatsApp / email / SMS (repli sur copie dans le presse-papier)
- **Sauvegarde & restauration** : export de toutes les données dans un fichier de secours (`.json`) et réimport (utile pour changer de téléphone ou éviter toute perte)
- **Stockage local** (localStorage) : aucun compte, aucune connexion internet requise
- **Installable** sur l'écran d'accueil (Android/iPhone) et **utilisable hors ligne** (service worker)

## 🚀 Lancer en local

Servez le dossier avec n'importe quel serveur statique, puis ouvrez `index.html` :

```bash
python3 -m http.server 8080
# puis ouvrir http://127.0.0.1:8080/index.html
```

> ⚠️ La PWA doit être servie en **HTTP(S)** (pas en `file://`) pour que le service worker et l'installation fonctionnent.

## 📱 Installer sur téléphone

1. Ouvrez l'URL dans Chrome (Android) ou Safari (iPhone).
2. Menu → **« Ajouter à l'écran d'accueil »**.
3. L'app s'ouvre en plein écran et fonctionne ensuite sans internet.

## 🗂️ Structure

```
index.html          Les 3 écrans (Accueil · Édition · Aperçu) + Réglages
css/style.css       Design mobile-first + styles d'impression PDF
js/app.js           Logique : stockage local, calculs, navigation, PDF
manifest.json       Métadonnées PWA (nom, icônes, couleurs)
sw.js               Service worker (cache hors ligne)
icons/              Icônes de l'app (SVG + PNG 192/512 + maskable)
```

## 🔒 Données

Toutes les données (entreprise, logo, documents) restent **sur l'appareil** de l'utilisateur, dans le stockage local du navigateur. Rien n'est envoyé sur un serveur.

## 🛣️ Pistes suivantes (idées)

- Choix de la **devise** et de plusieurs **modèles** de facture
- Partage de la **facture en image / PDF** en pièce jointe (nécessite une bibliothèque de rendu embarquée)

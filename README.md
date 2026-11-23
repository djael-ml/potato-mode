# Potato Mode v3.1

Une extension cross-browser (**Chrome / Brave / Edge** et **Firefox** MV3 à 100 % de parité) conçue pour **s'adapter automatiquement en temps réel à la charge de votre PC**, **brider réellement la RAM utilisée** par les onglets inactifs et **bloquer les ressources lourdes avant même leur téléchargement**.

---

## Fonctionnalités clés

- **Mode Adaptatif Automatique (Temps réel)** : change automatiquement de profil (*Léger ↔ Équilibré ↔ Éco ↔ Patate Max*) selon l'évolution réelle de votre PC (RAM libre, charge CPU, nombre d'onglets chargés, batterie, réseau), avec anti-oscillation (cooldown 2 min) et bascule immédiate en cas de RAM critique (< 12 %).
- **Scan matériel à la demande (« Scanner mon PC »)** : micro-benchmark CPU + diagnostic matériel complet avec rapport transparent.
- **Limiteur de RAM réel (`tabs.discard` + `alarms`)** : met automatiquement en veille les onglets inactifs selon un délai et un plafond d'onglets chargés en RAM, tout en protégeant les onglets actifs, épinglés, audio, whitelistés et les formulaires en cours de saisie + bouton *« Libérer la RAM maintenant »*.
- **Score dynamique 100 % réel** : calculé exclusivement à partir de mesures effectives (FPS réel, Long Tasks > 50 ms, nœuds DOM, ressources, RAM libre / onglets chargés). Zéro donnée factice.
- **Blocage réseau natif MV3 (`declarativeNetRequest`)** : bloque WebFonts, GIFs, images ou flux médias **avant téléchargement** (0 octet transféré), synchronisé avec votre liste blanche.
- **Icône dynamique en 5 états** *(16, 32, 48, 96, 128 px + SVG, vraie transparence RGBA)* :
  - **Actif** (orange vif) · **Désactivé** (gris terne) · **Site exclu** (bleu + pause) · **Patate Max** (or + éclair) · **Page système protégée** (alerte corail).
- **Optimisations modernes & sûres** :
  - Animations en mode **Safe** (`0.001ms`, `iteration-count: 1`) compatibles SPA (React, Framer Motion, Perplexity…).
  - Neutralisation GPU (`backdrop-filter`, `mix-blend-mode`, `will-change`).
  - Anti-bannières cookies chirurgical (CMP reconnus uniquement), Dark Mode à surfaces opaques, Mode Lecture réversible, injection dès `document_start` sur `<html>`.
- **Interface minimaliste Glassmorphiste (Dark / Light adaptatif)** : typographie système native (zéro requête externe), 100 % conforme CSP MV3, bouton 1-clic pour exclure le site courant, raccourcis clavier (`Alt+Shift+P` / `Alt+Shift+W`), export/import JSON.

---

## Structure du projet

```text
potato-mode/
├── src/                    # Code source unique (Chrome + Firefox)
│   ├── background/         # Service Worker (Chrome) / Event Page (Firefox)
│   ├── content/            # Injection document_start, télémétrie & CSS
│   ├── icons/              # 30 assets générés (5 états × 5 tailles + SVGs)
│   ├── manifests/          # Manifests MV3 Chrome & Firefox
│   ├── popup/              # Interface Apple Glassmorphism adaptative
│   └── shared/             # API cross-browser, scanner PC, score réel, politique RAM
├── scripts/                # Pipeline Node.js sans dépendance externe
│   ├── generate-icons.mjs  # Génère les 5 déclinaisons d'icônes (16→128px + SVG)
│   ├── build.mjs           # Assemble releases/unpacked/{chrome,firefox}
│   ├── pack.mjs            # Génère .zip, .xpi, .crx et SHA256SUMS.txt
│   └── release.mjs         # Lance build + pack en une seule commande
├── releases/               # Prêt à l'emploi (Chrome & Firefox)
│   ├── unpacked/           # Extensions décompressées (mode développeur / debug)
│   ├── zip/                # Archives .zip POSIX prêtes pour Chrome Web Store & AMO
│   ├── packed/             # Packages .crx (Chrome CRX3) & .xpi (Firefox)
│   └── SHA256SUMS.txt      # Empreintes SHA-256 des archives
├── tests/                  # Suite de tests automatisés (node:test)
├── package.json            # Raccourcis npm (zéro dépendance)
└── PRIVACY.md              # Politique de confidentialité 100 % locale
```

---

## Téléchargement (GitHub Releases)

Toutes les versions **Chrome** et **Firefox** (archives `.zip` pour décompression / stores et packages `.crx` / `.xpi` + `SHA256SUMS.txt`) sont publiées automatiquement dans les **[GitHub Releases](https://github.com/djael-ml/potato-mode/releases)** :

| Navigateur | Archive ZIP (Unpacked / Store) | Package (Packed) |
| :--- | :--- | :--- |
| **Chrome / Brave / Edge** | `potato-mode-chrome-v3.1.1.zip` | `potato-mode-chrome-v3.1.1.crx` |
| **Firefox** | `potato-mode-firefox-v3.1.1.zip` | `potato-mode-firefox-v3.1.1.xpi` |

### Installation rapide

#### Chrome / Brave / Edge
1. Téléchargez `potato-mode-chrome-v3.1.1.zip` depuis les [Releases](https://github.com/djael-ml/potato-mode/releases) et décompressez-le *(ou lancez `node scripts/release.mjs` en local pour générer `releases/unpacked/chrome/`)*.
2. Ouvrez `chrome://extensions`, activez le **Mode développeur**, puis cliquez sur **Charger l'extension non empaquetée**.

#### Firefox
1. Téléchargez `potato-mode-firefox-v3.1.1.zip` (ou `.xpi`) depuis les [Releases](https://github.com/djael-ml/potato-mode/releases).
2. Ouvrez `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire…** → sélectionnez `manifest.json` (ou installez directement le `.xpi` sur Firefox Developer Edition / Nightly).

---

## Build, Packaging & Tests en local (1 commande)

Nécessite uniquement **Node.js ≥ 18** (aucun `npm install` requis) :

```bash
# Tout générer d'un coup dans releases/ (unpacked + zip + crx + xpi + SHA256SUMS)
node scripts/release.mjs

# Lancer la suite complète de tests et vérifications MV3
node --test tests/*.test.mjs
```

Commandes `npm` équivalentes :
- `npm run icons` — Régénère les 30 icônes (`src/icons/`)
- `npm run build` — Assemble `releases/unpacked/chrome` et `releases/unpacked/firefox`
- `npm run pack` — Génère `releases/zip/*`, `releases/packed/*` et `releases/SHA256SUMS.txt`
- `npm run release` — Exécute `build` + `pack`
- `npm test` — Lance les 29 tests automatisés

> Chaque push d'un tag `v*` (ex. `git tag v3.0.0 && git push origin v3.0.0`) déclenche automatiquement `.github/workflows/release.yml`, lance les tests et publie les packages Chrome & Firefox dans [GitHub Releases](https://github.com/djael-ml/potato-mode/releases).

---

## Confidentialité

Potato Mode fonctionne **100 % en local** : aucune donnée collectée, aucun tracker, aucune requête réseau externe. Détails complets dans [PRIVACY.md](./PRIVACY.md).

---
[djael-ml](https://github.com/djael-ml)

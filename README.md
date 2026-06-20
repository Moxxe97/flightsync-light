# FlightSync Light

Carnet de vol macOS pour pilotes de ligne francophones — gratuit, local-first, open source.

---

## Ce que l'app fait

- **Tableau de bord** — heures totales, proportion canadienne (ARC), jours hors-Canada pour l'année fiscale en cours
- **Calendrier & panneau de jour** — vue mensuelle ; cliquer un jour ouvre le panneau de classification, boarding passes et notes ; export ICS
- **Sauvegarde** — sauvegarde de secours optionnelle vers votre propre Google Drive **et/ou** un dossier local de votre choix (voir ci-dessous)
- **Données** — import OFP PDF, gestion des vols et des laissez-passer d'embarquement
- **Archives** — accès en lecture seule aux années antérieures archivées localement ; backup Drive par année
- **Historique** — journal des opérations de sauvegarde

Toutes les données sont stockées **localement sur votre Mac** (localStorage + IndexedDB). Aucun serveur, aucune télémétrie, aucune inscription requise.

---

## Gratuit & vie privée

- **Aucune donnée n'est collectée.** FlightSync Light n'a pas de serveur, pas de compte, pas de télémétrie.
- Les vols, résidences et plans de vol vivent dans `~/Library/WebKit/com.flightsynclight.app/` sur votre Mac.
- La connexion Google est **entièrement optionnelle** — l'app fonctionne à 100 % sans compte.
- Si vous activez la sauvegarde Drive, vos fichiers vont dans **votre propre** Google Drive (`FlightSync Light/`). L'app utilise la portée `drive.file` : elle ne peut voir que les fichiers qu'elle a elle-même créés.

---

## Installation

### Télécharger

Rendez-vous dans l'onglet **Releases** de ce dépôt et téléchargez le fichier `.zip` de la dernière version. Décompressez-le et faites glisser `FlightSync Light.app` dans votre dossier **Applications**.

### Premier lancement — Gatekeeper

L'application n'est pas signée par Apple (coût et processus administratif disproportionné pour un outil gratuit). macOS bloquera le premier lancement. Voici comment l'autoriser :

1. Double-cliquez sur `FlightSync Light.app` → macOS affiche *« Impossible d'ouvrir… »*.
2. Ouvrez **Réglages Système → Confidentialité et sécurité**.
3. Faites défiler jusqu'à la section **Sécurité** — vous verrez le message *« FlightSync Light a été bloquée… »*.
4. Cliquez sur **Ouvrir quand même**.
5. Confirmez dans la boîte de dialogue qui s'affiche.

Ce processus n'est requis qu'une seule fois. macOS se souvient de votre choix.

> **Pourquoi non signé ?** La signature Apple coûte 99 USD/an et exige une inscription au programme développeur. Pour un outil gratuit et open source distribué directement, ce surcoût n'est pas justifié. Le code source est disponible ici pour audit.

---

## Connexion Google (optionnelle)

La connexion Google déverrouille la sauvegarde Drive :

| Fonctionnalité | Portée requise |
|---|---|
| Sauvegarde de secours dans votre Drive | `drive.file` |

L'écran de consentement Google ne demande que des portées non-sensibles (`openid email profile drive.file`). Aucune portée Agenda n'est requise — la classification des jours est entièrement manuelle depuis le panneau de jour.

**Ce que l'app ne fait pas :**

- Elle ne lit **aucun** autre fichier Drive que ceux qu'elle a créés (`drive.file` limite l'accès aux seuls fichiers créés par l'app).
- Elle ne lit ni ne modifie votre calendrier Google — aucune portée Agenda n'est demandée.
- Le jeton de rafraîchissement est stocké dans le **Trousseau macOS** ; le jeton d'accès reste en mémoire.
- Votre profil (email, nom) est mémorisé dans localStorage pour affichage — il n'est envoyé nulle part.

**Révoquer l'accès :** [myaccount.google.com/permissions](https://myaccount.google.com/permissions)

---

## Signaler un problème

Ouvrez une [Issue GitHub](../../issues) dans ce dépôt. Merci de décrire la version macOS, les étapes pour reproduire, et si possible joindre la console (Menu → Affichage → Outils de développement).

---

## Compiler depuis les sources

Prérequis : **Rust** (via [rustup](https://rustup.rs)), **Node.js ≥ 20**, **pnpm 9**.

```bash
pnpm install
pnpm tauri:build
```

L'exécutable signable se trouve dans `apps/desktop/src-tauri/target/release/bundle/macos/`.

Pour le développement :

```bash
pnpm dev          # Vite HMR + Tauri en mode dev
pnpm test         # Vitest (tous les workspaces)
pnpm build:desktop  # Vite build uniquement
```

---
layout: default
title: Politique de confidentialité — FlightSync Light
---

# Politique de confidentialité

**FlightSync Light** — version macOS  
Dernière mise à jour : 2026-06-12

---

## En bref

FlightSync Light ne collecte aucune donnée personnelle. Il n'y a pas de serveur, pas de compte utilisateur, pas de télémétrie, pas d'analyse d'utilisation. Tout ce que vous faites dans l'application reste sur votre Mac.

---

## Données stockées localement

Toutes vos données — vols, résidences, paramètres, plans de vol (OFP) et laissez-passer d'embarquement — sont stockées **uniquement sur votre Mac** dans deux emplacements :

- **localStorage** du navigateur WebKit intégré : données de vol, résidence et paramètres.
- **IndexedDB** (WebKit) à `~/Library/WebKit/com.flightsynclight.app/` : fichiers PDF des OFP et boarding passes.

Aucune de ces données n'est transmise à l'auteur de l'application ni à des tiers.

---

## Connexion Google (optionnelle)

La connexion à un compte Google est entièrement optionnelle. Si vous choisissez de vous connecter, voici exactement ce qui se passe :

### Portée `drive.file` — Sauvegarde Google Drive

Cette portée permet à l'application de créer et de modifier **uniquement les fichiers qu'elle a elle-même créés** dans votre Google Drive. Elle ne peut pas lire, modifier ni supprimer aucun autre fichier de votre Drive.

L'application crée un dossier `FlightSync Light/` dans votre Drive et y dépose :
- `flightsync-light-backup.json` — une copie de vos vols et résidences (sauvegarde de secours)
- Des copies PDF de vos OFP et boarding passes

Ces fichiers restent dans **votre propre Google Drive**. Ils ne sont accessibles ni à l'auteur de l'application ni à des tiers.

Aucune portée Google Agenda n'est demandée. La classification des jours (résidence, travail, congé) est entièrement manuelle, via le panneau de jour intégré.

---

## Dossier de sauvegarde local (optionnel)

Indépendamment de Google Drive, vous pouvez choisir un dossier local sur votre Mac comme destination de sauvegarde supplémentaire. L'application écrit dans ce dossier **uniquement**. Aucune donnée n'est lue depuis l'extérieur de ce dossier sans votre action explicite (restauration). Le chemin du dossier est spécifique à votre machine et n'est jamais inclus dans les exports ni les sauvegardes Drive.

### Jetons d'authentification

- Le **jeton de rafraîchissement** est stocké dans le **Trousseau macOS** (Keychain). Il n'est jamais transmis à l'auteur ni à des tiers.
- Le **jeton d'accès** est conservé en mémoire uniquement, le temps de la session.
- Votre **profil public** (adresse e-mail, nom affiché) est mémorisé dans le stockage local de l'application afin que l'interface sache qui est connecté, sans nécessiter un appel réseau à chaque lancement. Il n'est pas transmis.

---

## Ce que nous ne faisons pas

- Nous ne collectons pas de données d'utilisation.
- Nous n'utilisons pas de cookies de traçage.
- Nous n'envoyons pas de rapports d'erreur ou de crash (pas de Sentry, pas de télémétrie).
- Nous ne vendons, partageons ni ne transmettrons jamais vos données à des tiers.
- Nous n'avons pas accès à vos données. Aucun serveur ne les reçoit.

---

## Révoquer l'accès Google

Vous pouvez révoquer l'accès de FlightSync Light à votre compte Google à tout moment depuis :

[myaccount.google.com/permissions](https://myaccount.google.com/permissions)

Vous pouvez également vous déconnecter depuis l'onglet **Backup** de l'application. La déconnexion révoque le jeton de rafraîchissement côté Google et le supprime du Trousseau macOS.

---

## Contact

Pour toute question relative à la confidentialité, ouvrez une [Issue GitHub](../../issues) dans ce dépôt.

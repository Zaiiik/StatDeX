# LEVELING-APP

PWA de suivi d'entraînement, de progression SBD et de rangs. La version applicative actuelle est `22.1.5`.

Le dépôt canonique est [Zaiiik/StatDeX](https://github.com/Zaiiik/StatDeX). L'application publique reste volontairement livrée sans étape de compilation : `index.html` contient le runtime principal et `admin/` contient l'interface d'administration.

## Structure

- `index.html` : application publique et parcours d'accueil.
- `service-worker.js` : cache hors ligne de l'application publique.
- `admin/` : application, manifeste et service worker d'administration.
- `assets/` : emblèmes de rang et visuels d'abonnement.
- `scripts/audit.mjs` : contrôle statique avant intégration ou déploiement.

## Vérification locale

Node.js suffit ; aucune dépendance n'est à installer.

```powershell
node scripts/audit.mjs
```

Dans un environnement où npm est disponible, la même vérification peut être lancée avec `npm run audit`.

L'audit valide les fichiers indispensables, les manifestes JSON, la syntaxe des scripts intégrés, les références d'assets, l'alignement des versions et plusieurs budgets de non-régression. Un avertissement n'empêche pas l'intégration ; une erreur renvoie un code de sortie non nul.

## Versionnement

`APP_VERSION` dans `index.html` est la version de référence. Avant une livraison, garder alignés le titre public, le cache du service worker et `ADMIN_CURRENT_APP_VERSION`.

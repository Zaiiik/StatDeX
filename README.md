# LEVELING-APP

PWA de suivi d'entraînement, de progression SBD et de rangs. La version applicative actuelle est `22.2.0`.

Le dépôt canonique est [Zaiiik/StatDeX](https://github.com/Zaiiik/StatDeX). La PWA publique reste utilisable directement depuis `index.html`. La version Android utilise Capacitor 8 et compile seulement son pont natif AdMob.

## Structure

- `index.html` : application publique et parcours d'accueil.
- `service-worker.js` : cache hors ligne de l'application publique.
- `admin/` : application, manifeste et service worker d'administration.
- `assets/` : emblèmes de rang et visuels d'abonnement.
- `src/native-ads.js` : pont Android natif AdMob/UMP.
- `android/` : projet Android Capacitor.
- `capacitor.config.json` : configuration de l'application Android.
- `scripts/audit.mjs` : contrôle statique avant intégration ou déploiement.

## Vérification locale

Pour l'audit statique historique, Node.js suffit :

```powershell
node scripts/audit.mjs
```

Après installation des dépendances (`pnpm install` ou `npm install`), l'ensemble des contrôles se lance avec :

```powershell
npm test
```

L'audit valide les fichiers indispensables, les manifestes JSON, la syntaxe des scripts intégrés, les références d'assets, l'alignement des versions et plusieurs budgets de non-régression. Un avertissement n'empêche pas l'intégration ; une erreur renvoie un code de sortie non nul.

## Android et publicités

La configuration utilise Capacitor `8.5.2` et `@capacitor-community/admob` `8.1.0`. Les annonces sont désactivées dans la PWA et ne peuvent s'afficher que dans l'application Android native.

Prérequis Android : Android Studio récent, JDK 21 et Android SDK 36.

Build de développement, obligatoirement avec les identifiants de test officiels Google :

```powershell
npm run android:sync:test
cd android
.\gradlew assembleDebug
```

Build de production, à lancer explicitement :

```powershell
npm run android:sync:production
cd android
.\gradlew bundleRelease
```

Après un build de production, toujours relancer `npm run android:sync:test` avant de reprendre les tests locaux. Le build de test vérifie qu'aucun Ad Unit ID de production n'est présent dans le bundle WebView.

Le consentement Google UMP est demandé avant tout chargement publicitaire. Le bouton de confidentialité dans Réglages ouvre le formulaire UMP natif lorsqu'il est requis. Les interstitiels sont limités à une coupure naturelle toutes les 5 minutes et sont bloqués pendant une séance POWER, un chronomètre, une saisie de série ou la période de sécurité suivant une interaction d'entraînement.

Une publicité récompensée vaut exactement 10 Cristaux, au maximum trois fois par jour et par utilisateur. Le client ne modifie jamais le solde localement : il appelle la fonction Supabase idempotente `claim_rewarded_ad_v1` avec l’identifiant du claim et les métadonnées AdMob, puis recharge le solde autoritaire avec `get_my_access_v2141`. Cette fonction crédite directement `user_crystal_wallets`, le portefeuille déjà utilisé par `get_my_access_v2141`; aucun second solde n’est créé.

## Boutique Cristaux

Le bouton Cristaux ouvre la Boutique et recharge le solde, les Pass et les thèmes depuis Supabase. Les Pass réutilisent `crystal_access_offers` et l'achat idempotent `redeem_crystal_access_v2`. Les thèmes proposés sont centralisés dans `crystal_theme_catalog`; leur propriété est persistée dans `user_owned_themes` et attribuée uniquement par `purchase_crystal_theme_v1`. Les prix, le solde et l'unicité de l'achat sont vérifiés dans une transaction serveur.

Les migrations correspondantes sont :

- `supabase/migrations/20260927000100_crystal_shop_v1.sql`
- `supabase/migrations/20260927000200_crystal_shop_v1_hardening.sql`

## Versionnement

`APP_VERSION` dans `index.html` est la version de référence. Avant une livraison, garder alignés le titre public, le cache du service worker et `ADMIN_CURRENT_APP_VERSION`.

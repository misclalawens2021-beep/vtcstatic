# Noctis VTC — interface HTML/CSS/JavaScript + API PHP/MySQL

Cette version sépare l'interface du site (`index.html`, `assets/css/app.css`, `assets/js/app.js`) des opérations qui nécessitent un serveur (`api/`) et de la base de données (`sql/database.sql`). HTML/CSS/JS ne peuvent pas se connecter directement et de façon sûre à MySQL : le petit backend PHP est conservé pour enregistrer les réservations et les avis.

## Installation avec XAMPP
1. Copiez le dossier `noctis-converti` dans `C:\xampp\htdocs\`.
2. Ouvrez XAMPP et démarrez **Apache** et **MySQL**.
3. Dans `http://localhost/phpmyadmin`, importez `sql/database.sql` (onglet **Importer**).
4. Vérifiez `api/db.php` : valeurs par défaut XAMPP (`localhost`, base `vtc_reservation`, utilisateur `root`, mot de passe vide). Si votre MySQL utilise un autre mot de passe/port, adaptez la connexion.
5. Ouvrez `http://localhost/noctis-converti/` — ne double-cliquez pas sur `index.html`, car les routes PHP ont besoin d'Apache.

## Base de données
Le SQL crée la base `vtc_reservation` et les tables `users`, `reservations`, `avis`. Le schéma d'origine est conservé. Cette version de démonstration utilise les tables `reservations` et `avis`; l'authentification complète de l'ancien site n'est pas encore portée dans cette interface HTML.

## Fonctions de la maquette
- Interface responsive, thème sombre et or.
- Recherche d'adresses via le géocodeur IGN Géoplateforme, carte Leaflet/OpenStreetMap et estimation routière OSRM.
- Envoi des demandes vers `api/reservations.php` et sauvegarde dans MySQL.
- Lecture et publication d'avis via `api/avis.php`.
- Validation côté serveur des champs et recalcul du prix côté serveur avant insertion.

## À savoir avant un usage réel
- Le calcul de prix est une estimation pédagogique (distance approximée côté serveur par la formule géographique), pas une offre commerciale définitive.
- Les services de cartographie utilisés sont externes et soumis à leurs conditions et limites d'utilisation.
- Avant mise en production, ajoutez une protection CSRF, une limitation de fréquence, une politique de confidentialité, une validation plus stricte des coordonnées et un système d'authentification/gestion des réservations. N'exposez jamais MySQL au navigateur.

## Améliorations de cette version
- Navigation complétée avec sections Services et FAQ.
- Illustration vectorielle de berline à la place du symbole décoratif.
- Bouton de bascule thème sombre / clair avec préférence conservée dans le navigateur.
- Meilleurs états visuels pour les messages de formulaire, focus clavier et réduction des animations.
- Correction de la comparaison de dates locales et invalidation de l’estimation si le trajet ou ses paramètres changent.

## Authentification ajoutée
- `auth.html` : interface de connexion et de création de compte.
- `assets/css/auth.css` et `assets/js/auth.js` : styles et interactions de la page.
- `api/auth.php` : API PHP utilisant PDO, requêtes préparées, `password_hash` / `password_verify`, sessions PHP, régénération de l'identifiant de session et jeton CSRF.
- La table `users` déjà prévue dans `sql/database.sql` est utilisée. Si elle existe déjà, ne réimportez pas le SQL uniquement pour l'authentification.
- Accès local : `http://localhost/noctis-vtc-auth/auth.html` (adaptez le nom du dossier à celui copié dans `htdocs`).

Cette version démarre une session après la connexion, mais la page d'accueil ne dispose pas encore d'un tableau de bord privé ni de l'affichage des réservations liées au compte. Pour un déploiement public, prévoir notamment limitation des tentatives, procédure de réinitialisation du mot de passe, politique de confidentialité et vérification complète de la configuration HTTPS.

Après toute modification de `sql/database.sql`, exécutez le fichier complet dans **Supabase Studio → SQL Editor** pour mettre à jour le schéma, les déclencheurs et les politiques RLS du projet distant. Le script archive une ancienne table `profiles` dont l’identifiant n’est pas un UUID et conserve les anciens identifiants entiers de réservations/avis dans `legacy_user_id` avant d’ajouter les références UUID Supabase Auth.

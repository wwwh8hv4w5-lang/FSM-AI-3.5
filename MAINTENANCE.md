# Plan de maintenance — FSM AI

Audit du 24 octobre 2026 sur `index.html` (application d'une seule page, environ 7 400 lignes) et `README.md`. Vérification : lecture du code, contrôle de syntaxe du script, chargement de la page dans Chrome headless (console, navigation des feuilles, persistance de l'épingle, assainissement Markdown, extraction PDF).

Aucun secret (clé API, jeton) n'est écrit en dur dans le dépôt. `FSM_IMAGE_KEYS` (Pexels, Unsplash) est vide. Rien à retirer ni à faire tourner pour l'instant. Ne jamais commiter ces clés : le fichier est public.

Les correctifs de cette passe sont limités aux défauts réels et aux risques de sécurité clairs. Le comportement et le dessin de l'application ne sont pas refondus.

## Corrigé dans cette passe

| Priorité | Sujet | Fichier |
|---|---|---|
| Critique | pdf.js 3.11.174 peut exécuter du JavaScript à l'ouverture d'un PDF malveillant (CVE-2024-4367). `isEvalSupported: false` coupe ce chemin. Le script et le worker sont épinglés par empreinte SRI ; le worker est chargé en blob après contrôle. | `index.html` (`loadPdfJs`, `pdfText`) |
| Élevée | DOMPurify 3.1.6 est en retard (plusieurs contournements d'assainissement corrigés depuis, jusqu'à la 3.4.17). Passage à 3.4.17 avec SRI. | `index.html` (script du `<head>` logique, fin de page) |
| Élevée | marked 12.0.2 et l'ancien DOMPurify étaient chargés sans attribut `integrity`. Un CDN compromis aurait pu remplacer l'assainisseur. Empreintes SHA-384 ajoutées, `crossorigin="anonymous"`. | `index.html` |
| Élevée | Épingler une discussion ne tenait pas : `saveConv` réécrivait l'index sans le champ `pinned`. L'épingle disparaissait au message suivant, ou tout de suite si la discussion était déjà en mémoire. Le champ est recopié. `saveAll` attend aussi la fin de `saveConv`. | `index.html` (`saveConv`, `convAction`) |
| Élevée | `window.postMessage` acceptait un message `{fsmPv}` venu de n'importe quelle fenêtre. Seuls les iframes d'aperçu de la page sont encore écoutés. Le texte d'erreur reste échappé. | `index.html` (écouteur `message`) |
| Élevée | L'aperçu PDF (`window.open`) laissait `window.opener` vers l'application, donc vers les clés stockées dans la page. `opener` est coupé. Si le bloqueur de popups refuse la fenêtre, le repli actuel (ouvrir dans l'onglet) est inchangé. | `index.html` (`openAtt`) |
| Élevée | `nextRunOf` (veilles hebdomadaires) pouvait boucler sans fin si le jour ou la date était invalide, et figer l'onglet à chaque minute. La boucle est bornée à 21 jours. | `index.html` (`nextRunOf`) |
| Moyenne | Échap ne fermait pas la boîte de dialogue (`#askSheet`) : la promesse restait en attente. Échap annule. Une seconde boîte ouverte par-dessus résout la précédente par « annuler », au lieu de la laisser pendue. Le champ éventuel prend le focus. | `index.html` (`ask`, `closeAsk`) |
| Faible | Ancien rendu de la liste des discussions, laissé après un `return` (code mort). Retiré. | `index.html` (`renderConvs`) |

## Critique

Aucun point critique ouvert après cette passe. Le seul point critique identifié (pdf.js) est traité ci-dessus. La mise à jour majeure vers pdf.js 4+ ou 6 (modules ES, plus de build UMD sur cdnjs) reste souhaitable plus tard, avec un essai d'extraction sur de vrais PDF : la 3.11 n'est plus corrigée en amont, `isEvalSupported: false` est le contournement officiel du CVE-2024-4367.

## Élevé

1. **Clés et jetons dans le navigateur** — `index.html` (`LS`, clés `relais.key`, `relais.xaikey`, `fsm.conn`, `fsm.gtok`, `fsm.mgmtkey`). La clé FSM AI, la clé xAI, le jeton GitHub et le jeton Google vivent dans `localStorage` ou `sessionStorage`. C'est le fonctionnement prévu (pas de serveur), mais n'importe quel script qui s'exécute dans la page peut les lire. À faire : garder l'assainissement à jour (fait pour DOMPurify), ne pas élargir le bac à sable des aperçus (`allow-same-origin` ouvrirait les clés), et éviter d'ajouter des scripts tiers sans SRI. Pas de rotation à lancer tant qu'aucune clé n'a été publiée dans le dépôt.

2. **Scripts tiers encore sans empreinte** — `index.html`.
   - `https://accounts.google.com/gsi/client` (`loadGis`) : le fichier bouge, une empreinte fixe casserait la connexion Google. À laisser dynamique, ou à n'activer qu'au moment où l'utilisateur connecte Google.
   - Pyodide `https://cdn.jsdelivr.net/pyodide/v0.26.4/full/` (`PYODIDE_URL`) : des dizaines de fichiers, worker de même origine que la page. Le code Python vient du modèle. À faire : figer une version testée (déjà le cas pour le numéro) et, si possible, héberger ces fichiers avec le site plutôt que de les retélécharger à chaque premier calcul.

3. **Formules Excel** — `index.html` (`buildXlsx`). Une cellule qui commence par `=` est écrite comme formule. Un tableau produit par le modèle peut donc contenir `HYPERLINK`, `WEBSERVICE` ou une formule DDE, exécutée quand la personne ouvre le fichier dans Excel. À faire : n'accepter que des formules arithmétiques et de feuilles simples, et enregistrer le reste comme texte. Ne pas le faire sans rejouer les tableaux que l'application produit déjà (sommes, `SI`, etc.).

4. **pdf.js 3.11, dette restante** — voir Critique. Le worker et la bibliothèque sont maintenant contrôlés par empreinte, et l'évaluation des polices est coupée. Le passage à une version encore maintenue (6.x, au-delà de CVE-2026-16633) demande un chargement en module ES et un essai sur des PDF réels.

## Moyen

1. **Fichier unique** — tout le CSS, le HTML et environ 6 000 lignes de JavaScript sont dans `index.html`. Chaque correctif est risqué, il n'y a pas de test automatique, et le navigateur doit analyser ~670 Ko avant d'afficher. À faire, sans changer l'écran : extraire CSS, puis les blocs déjà commentés (rendu, vocal, BOT, routeur, fichiers Office) en scripts classiques servis à côté, avec SRI si un CDN reste en jeu. Garder une page qui s'ouvre encore en un fichier sur GitHub Pages tant que c'est le mode de publication.

2. **Pas de politique de sécurité du contenu** — pas de CSP. Une balise `<meta>` ne peut pas fixer `frame-ancestors` (en-tête HTTP seulement). À faire côté hébergement (GitHub Pages ou le domaine FSM) : `Content-Security-Policy` avec `frame-ancestors 'none'`, `object-src 'none'`, et une liste explicite des origines (`openrouter.ai`, `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `accounts.google.com`, API images). `script-src` devra autoriser les scripts en ligne tant que le JS n'est pas sorti du HTML.

3. **Images et liens `http://`** — `safeSrc`, `safeHref`, `isImgUrl` dans `index.html` acceptent `http:`. Sur une page `https`, le navigateur bloque souvent ces images ; un réseau hostile peut aussi les modifier. À faire : n'afficher que `https:`, `blob:` et les `data:` image déjà filtrés (SVG déjà refusé). Vérifier Wikipédia, Commons, Openverse, le Met, qui répondent déjà en `https`.

4. **Identifiants en double** — `rnIn` est réutilisé pour « Renommer » et « Nouveau dossier » (`convAction`). Un seul dialogue est ouvert à la fois, donc ça marche, mais le HTML est invalide et un futur dialogue superposé lirait le mauvais champ. À faire : lire la valeur dans le dialogue courant (`#askBody input`) et supprimer l'`id`.

5. **Bac à sable des aperçus** — `makeFrame` : `sandbox="allow-scripts allow-pointer-lock allow-modals"` sans `allow-same-origin`. C'est le bon réglage (les jeux et pages HTML tournent sans lire `localStorage`). Ne pas ajouter `allow-same-origin` ni `allow-popups` ni `allow-top-navigation`. Le message d'erreur vers le parent utilise `postMessage(..., "*")` : l'écouteur vérifie maintenant la source. On peut encore remplacer `"*"` par l'origine du parent le jour où les aperçus auront une origine non nulle.

6. **Sauvegarde JSON** — `exportBackup` / `cleanBackup`. L'import est filtré (identifiants, URL, `data:`). Les clés ne partent dans le fichier que si la case est cochée. À faire : rappeler dans l'interface que le fichier contient les conversations en clair, et refuser les fichiers au-dessus d'une taille raisonnable avant `JSON.parse` (un fichier énorme fige l'onglet).

7. **Index limité à 200 discussions** — `saveConv` coupe `S.index` à 200 entrées. Les conversations plus anciennes restent dans IndexedDB (`relais`) mais disparaissent du menu. À faire : ne pas compter les discussions épinglées dans ce plafond, ou afficher une entrée « plus anciennes ».

8. **Veilles FSM BOT** — `checkWatches` ne tourne que si l'onglet est ouvert. C'est documenté dans l'outil, pas un défaut silencieux. Un jour invalide ne fige plus la page ; la veille peut quand même sauter un créneau. À faire : normaliser `day` (entier 0–6) à la création et à l'import.

9. **Dépendances d'images et de modèles** — appels directs depuis le navigateur vers OpenRouter, xAI, Wikipédia, Fandom, Commons, Openverse, musées, Pexels, Unsplash, GitHub, Google. Pas de clé serveur à protéger ici. Les échecs réseau sont en général attrapés. À faire : un délai commun et un message unique quand une banque d'images ne répond pas, plutôt que des `fetch` sans `catch` dans `fandomImg` / `openverseImg` (une réponse non JSON lève une exception déjà absorbée plus haut, à confirmer au prochain passage).

## Faible

1. **README** — `README.md` décrit l'abonnement, le contact et le fait que tout tient dans `index.html`. Il ne dit pas comment ouvrir le fichier en local, ni que les clés restent dans le navigateur. À compléter en quelques lignes, sans dupliquer l'aide déjà dans l'écran Réglages.

2. **Doublons de catalogue** — `BRANDS` et `VARIANTS`, plusieurs expressions régulières de routage (`IMG_GEN_RE`, `PEDIT_RE`, `autoRoute`, `universalRoute`, `mediaFix`) se recouvrent. Les modifier change le choix de modèle. À ne toucher qu'avec des phrases d'essai écrites (salut, « dessine », « refais la photo », « continue la vidéo », code, veille).

3. **Accessibilité** — beaucoup de boutons ont un `aria-label`. La boîte `#askSheet` n'enferme pas le focus (Échap fonctionne maintenant, et le champ du dialogue prend le focus). Le contraste du thème sombre est généralement bon. Chrome signale, sans erreur JavaScript, que les champs mot de passe (`#apiKey`, `#xaiKey`, clés Pexels, Unsplash, gestion, GitHub) ne sont pas dans un `<form>` : les gestionnaires de mots de passe les voient mal. À faire : un `<form autocomplete="off">` qui ne recharge pas la page (`submit` annulé), puis piéger le focus dans les feuilles ouvertes et annoncer les toasts (`aria-live`).

4. **PWA** — balises `apple-mobile-web-app-*` et icônes en base64 (très lourdes dans le HTML), pas de `manifest.webmanifest` ni de service worker. Les icônes en data-URI gonflent chaque téléchargement. À faire : fichiers `icon-192.png` / `icon-512.png` à côté de la page, et un manifeste, seulement si l'installation sur l'écran d'accueil est voulue.

5. **Pas de tests** — aucun fichier de test. Le plus utile, sans framework : un petit script qui charge la page, envoie quelques Markdown à `mdHtml`, vérifie l'absence de `<script>`, et vérifie que `saveConv` garde `pinned`. À lancer dans le même Chrome que la revue.

6. **Commentaires et noms internes** — préfixe historique `relais.*` dans `localStorage` et base IndexedDB `relais`. Le renommer couperait les conversations déjà enregistrées sur les téléphones. Si un jour on migre : lire les anciennes clés, écrire les nouvelles, ne supprimer les anciennes qu'après coup.

7. **`http://` dans le XML Office** — `index.html` (génération docx/xlsx). Ce sont des espaces de noms OOXML (`http://schemas.openxmlformats.org/...`), pas des ressources chargées. Ne pas les passer en `https`.

## Ordre conseillé pour la suite

1. Laisser passer cette passe (bugs et bibliothèques) et la vérifier sur téléphone : épingle, renommage, Échap, PDF joint, aperçu HTML.
2. Héberger pdf.js, marked et DOMPurify avec le site, ou noter dans le dépôt la commande qui recalcule les empreintes quand on les met à jour.
3. Découper `index.html` en fichiers sans changer l'écran, puis ajouter trois ou quatre scénarios de rendu et de routage.
4. Traiter les formules Excel et le blocage des URL `http://` pour les images.
5. En-têtes CSP chez l'hébergeur.

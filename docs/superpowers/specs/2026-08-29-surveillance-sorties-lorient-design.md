# Surveillance des concerts et spectacles de Lorient Agglomération

## Objectif

Détecter automatiquement les nouveaux concerts, festivals, pièces de théâtre, spectacles d'humour, de danse, de cirque et spectacles familiaux proposés dans Lorient Agglomération, puis prévenir Simon sur un canal ntfy dédié dès qu'une réservation en ligne devient accessible.

Le service doit fonctionner sans serveur payant, sans compte sur les billetteries et sans intervention régulière. Il ne réserve et n'achète aucune place.

## Périmètre géographique et culturel

La surveillance couvre toutes les communes de Lorient Agglomération, et non la seule ville de Lorient.

Sont inclus :

- concerts et festivals ;
- théâtre, humour, danse, cirque et formes hybrides ;
- spectacles familiaux et jeunesse ;
- événements gratuits lorsqu'une réservation de place est nécessaire ;
- événements futurs disposant d'un lien de réservation utilisable.

Sont exclus :

- plateformes de revente ;
- séances ordinaires de cinéma ;
- salons professionnels et événements sans spectacle ;
- simples annonces sans réservation accessible ;
- achats, réservations ou connexions automatiques à un compte utilisateur.

## Sources de la première version

La couverture est hybride : un agenda territorial donne de la largeur, tandis que les pages et billetteries officielles des salles permettent de détecter les ouvertures de vente plus directement.

Sources territoriales :

- Lorient Bretagne Sud Tourisme, agenda spectacles ;
- Lorient Bretagne Sud Événements, pour le Palais des Congrès et le Parc des Expositions ;
- billetterie du Festival Interceltique de Lorient pendant sa période d'ouverture.

Salles et programmateurs prioritaires :

- Théâtre de Lorient ;
- Hydrophone ;
- Quai 9 à Lanester ;
- Océanis à Plœmeur ;
- L'Estran à Guidel ;
- TRIO…S à Hennebont et Inzinzac-Lochrist ;
- Les Arcs à Quéven ;
- Le Strapontin à Pont-Scorff ;
- Théâtre à la Coque à Hennebont ;
- Le City à Lorient.

Une source n'est activée que si son extracteur peut distinguer de façon fiable un événement futur et un lien de réservation. Une source trop ambiguë reste visible dans l'inventaire mais ne doit pas produire d'alertes approximatives.

## Architecture

Le projet indépendant `sorties-lorient-alertes` est hébergé dans un dépôt GitHub public. GitHub Actions exécute le contrôle toutes les quinze minutes. Un workflow mensuel ajoute un heartbeat sur la branche principale afin d'éviter la désactivation des tâches planifiées après une longue période sans activité du dépôt public.

L'application utilise Node.js sans dépendance si les formats rencontrés le permettent. Elle est organisée en unités isolées :

1. un adaptateur par famille de source lit une page et retourne des événements normalisés ;
2. le normaliseur produit un titre, une date, un lieu, une commune, une URL de réservation et l'URL source ;
3. le moteur de déduplication rapproche les occurrences venant de plusieurs sites ;
4. le moteur d'état identifie les événements jamais signalés et conserve la santé de chaque source ;
5. le composeur prépare les notifications individuelles ou récapitulatives ;
6. le client ntfy publie les messages sans exposer le sujet secret.

Chaque composant dispose d'une interface simple et peut être testé avec des pages enregistrées, sans accès réseau réel.

## Modèle d'événement et déduplication

Un événement normalisé contient au minimum :

- `title` : titre nettoyé ;
- `startsAt` : date et heure ISO lorsque l'heure est connue ;
- `venue` : nom canonique de la salle ou du lieu ;
- `city` : commune ;
- `bookingUrl` : lien permettant de commencer la réservation ;
- `sourceUrl` : page où l'information a été observée ;
- `sourceId` : identifiant stable de l'adaptateur.

L'identité canonique est calculée à partir du titre normalisé, de la date locale et du lieu. L'URL seule ne sert pas d'identité, car un même spectacle peut apparaître sur l'agenda touristique, le site de la salle et une billetterie distincte.

En cas de rapprochement :

- le lien de billetterie officielle le plus direct est privilégié ;
- les données les plus précises complètent l'occurrence ;
- une incertitude sur le lieu ou la date conserve deux événements plutôt que de fusionner à tort.

## Déclenchement et premier démarrage

Un événement devient notifiable lorsqu'il est futur, appartient au périmètre et possède un lien de réservation accessible.

Au premier contrôle, tous les événements déjà disponibles sont enregistrés comme référence sans notification. Cette initialisation doit réussir pour chaque source indépendamment : une source en panne ne doit pas être considérée comme vide ni initialisée silencieusement.

Lors des contrôles suivants :

- un ou deux nouveaux événements produisent une notification chacun ;
- trois nouveautés ou plus détectées pendant le même contrôle produisent une notification récapitulative ;
- un événement déjà signalé ne produit pas de nouvelle alerte lorsque son URL ou son descriptif change ;
- un échec de publication ntfy laisse l'événement à retenter.

## Notifications ntfy

Un nouveau nom de sujet ntfy aléatoire et suffisamment long est généré pour ce projet, puis Simon s'y abonne dans l'application. Il est enregistré uniquement dans le secret GitHub `NTFY_TOPIC`. Le dépôt, l'état et les journaux ne doivent jamais contenir sa valeur.

Une notification individuelle contient :

- le titre de l'événement ;
- la date et l'heure connues ;
- le lieu et la commune ;
- un lien direct vers la réservation ;
- une priorité normale ou haute, sans urgence maximale.

Une notification récapitulative contient la liste des nouveautés avec leurs dates, lieux et liens. Le message respecte la limite ntfy de 4 096 octets. Si la liste dépasse cette limite, elle est tronquée proprement et renvoie vers la page de programmation de la source principale.

Le format Markdown ntfy est activé pour rendre les liens lisibles. Le clic général ouvre la source la plus pertinente ; les liens intégrés permettent d'ouvrir chaque billetterie depuis le détail de la notification.

## État persistant

Une branche GitHub `state` contient un fichier JSON versionné avec :

- la version du schéma ;
- la date d'initialisation générale ;
- les identifiants canoniques déjà signalés ;
- les données minimales permettant d'expliquer un rapprochement ;
- pour chaque source, la dernière réussite, le nombre d'échecs consécutifs et l'état d'initialisation ;
- les alertes techniques déjà émises.

Le fichier est validé strictement avant toute lecture du réseau ou notification. Un état absent peut être initialisé ; un état présent mais mal formé provoque un échec explicite et ne remet jamais la référence à zéro.

Les écritures sont sérialisées par la concurrence GitHub Actions. Les notifications réussies sont persistées même si une autre notification du même lot échoue. Une interruption entre l'envoi et la persistance peut exceptionnellement provoquer un doublon ; cette limite de livraison au moins une fois est documentée.

## Tolérance aux pannes

Chaque source est interrogée avec un délai maximal et traitée indépendamment. L'échec d'une source n'empêche ni la lecture des autres ni l'envoi de leurs nouvelles alertes.

Une source en échec pendant au moins quatre contrôles consécutifs, soit environ une heure, génère une seule alerte technique sur le même canal ntfy. Une notification de rétablissement est envoyée lors de la première lecture correcte suivante. Les erreurs suivantes ne sont jamais interprétées comme une disparition d'événements.

Une signature de page officielle est vérifiée avant l'extraction. Si une page de connexion, une protection anti-robot ou un contenu inattendu remplace la programmation, l'adaptateur échoue explicitement au lieu de retourner une liste vide.

Les appels réseau et les workflows possèdent des délais maximaux. Les actions GitHub tierces sont épinglées à des révisions immuables et les secrets ne sont fournis qu'à l'étape de notification.

## Commandes et exploitation

Le programme expose trois modes :

- `inspect` : lit les sources et affiche les événements normalisés sans état ni secret ;
- `check` : compare au fichier d'état, notifie et persiste les changements ;
- `test-notification` : vérifie uniquement le trajet GitHub vers ntfy.

Le README documente l'ajout ou la désactivation d'une source, le remplacement du sujet ntfy, l'inspection manuelle, la réinitialisation volontaire et la consultation des exécutions GitHub.

## Vérification et critères d'acceptation

La livraison est acceptée lorsque :

1. chaque adaptateur actif possède des fixtures et des tests d'extraction ;
2. les tests couvrent la déduplication inter-sources, l'initialisation silencieuse, le groupement, l'échec partiel, les délais réseau et la validation d'état ;
3. aucune valeur ressemblant au sujet ntfy réel n'apparaît dans les fichiers ou journaux ;
4. le mode `inspect` lit réellement les sources activées et explique les sources ignorées ou en échec ;
5. un premier `check` GitHub initialise la référence sans alerte culturelle ;
6. `test-notification` produit une notification de contrôle reçue sur le nouveau canal ;
7. un second `check` sans changement produit zéro notification et zéro modification d'état ;
8. le heartbeat mensuel fonctionne sur le dépôt public ;
9. le dépôt local est propre, synchronisé et documenté.

## Hors périmètre

La première version ne construit pas d'application mobile, de tableau de bord, de calendrier personnel, de recommandation selon les goûts, de comparaison de prix, d'achat automatique ni de surveillance des plateformes de revente. Ces évolutions ne seront envisagées qu'après validation de la fiabilité de la détection de base.

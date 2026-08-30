# Alertes sorties Lorient

Ce projet assure aujourd'hui une **couverture partielle de six salles officiellement vérifiées** dans Lorient Agglomération. Il ne surveille pas encore toute l'agglomération : les agendas territoriaux et les autres sources inventoriées restent désactivés tant que leur extraction fiable n'est pas démontrée. Il signale sur un sujet [ntfy](https://ntfy.sh/) les nouvelles réservations accessibles, sans compte billetterie et sans automatiser aucune réservation.

Le dépôt contient le moteur et les adaptateurs. GitHub Actions lance le contrôle toutes les quinze minutes ; l'état durable vit sur une branche `state` séparée.

## Couverture active et périmètre visé

Le périmètre culturel visé comprend les concerts, festivals, pièces de théâtre, spectacles d'humour, danse, cirque, propositions hybrides et spectacles familiaux possédant une URL de réservation HTTPS. Une manifestation gratuite est incluse si elle demande une réservation. La couverture active reste toutefois limitée aux six salles ci-dessous ; elle ne constitue pas une couverture exhaustive de Lorient Agglomération.

Sources actives contrôlées toutes les 15 minutes :

- L'Estran à Guidel, Océanis à Ploemeur, Le Strapontin à Pont-Scorff, Quai 9 à Lanester, Les Arcs à Quéven et Théâtre à la Coque à Hennebont, via leurs billetteries officielles Mapado.

L'audit live du 30 août 2026 a laissé dans l'inventaire, mais désactivé, Lorient Bretagne Sud Tourisme, Lorient Bretagne Sud Événements, Théâtre de Lorient, Hydrophone, TRIO…S et le Festival Interceltique. Leurs pages ne permettaient pas de démontrer ensemble la signature et l'extraction d'une réservation officielle ; le motif exact reste visible dans `inspect`. Les preuves HTTP et la décision source par source sont consignées dans [`docs/source-audit.md`](docs/source-audit.md).

Le City n'a pas de source directe stable identifiée. Sa voie prévue reste l'agenda territorial, mais cette couverture n'est pas active tant que les sources territoriales ci-dessus demeurent désactivées.

Le workflow se réveille toutes les 15 minutes, puis le collecteur ne relit que les sources arrivées à échéance. Une source désactivée dans [`src/sources.mjs`](src/sources.mjs) est ignorée avec sa raison explicite.

Le système exclut la revente, le cinéma ordinaire, les salons professionnels, les événements non culturels et les pages sans réservation accessible. Il ne se connecte à aucun compte, ne choisit pas de place, n'achète rien et ne surveille aucune plateforme de revente.

## Règles d'alerte

- La première lecture réussie de chaque source constitue une **baseline silencieuse** : les événements déjà présents sont mémorisés, sans notification.
- Une ou deux nouveautés canoniques donnent une notification par événement. À partir de trois nouveautés dans le même contrôle, un digest unique est envoyé.
- Les doublons entre plusieurs sources sont fusionnés de façon conservatrice, avec préférence pour la réservation officielle directe.
- Une source en échec n'empêche pas les autres d'être contrôlées. Quatre échecs consécutifs ouvrent un incident technique et produisent une seule alerte ; la première réussite suivante produit une alerte de rétablissement.
- Un échec de publication reste dans l'outbox pour être retenté. Les notifications déjà acquittées sont persistées même si une autre notification du lot échoue.

La livraison est **au moins une fois**. Si ntfy accepte une notification mais que le job s'interrompt avant la persistance de son acquittement sur la branche `state`, cette notification peut être renvoyée au contrôle suivant. Cette courte fenêtre de doublon évite de perdre silencieusement une alerte.

## Commandes locales

Prérequis : Node.js 22.

```bash
npm ci
npm test
```

Contrat live opt-in des seules sources actives, sans état ni notification :

```bash
LIVE_TESTS=1 node --test test/live-contract.test.mjs
```

Inspection des sources, sans état et sans notification :

```bash
node scripts/run-monitor.mjs inspect
```

Contrôle avec lecture et mise à jour d'un fichier d'état :

```bash
printf 'Sujet ntfy local : '
IFS= read -r -s NTFY_TOPIC
printf '\n'
NTFY_TOPIC="$NTFY_TOPIC" node scripts/run-monitor.mjs check --state .monitor-state/state.json
unset NTFY_TOPIC
```

Cette commande locale sans `--require-existing-state` autorise explicitement la création d'un état neuf et sa baseline silencieuse. Le workflow de production ajoute `--require-existing-state` : si `.monitor-state/state.json` manque, le contrôle échoue avant toute lecture réseau, notification ou écriture.

Test isolé du trajet vers ntfy :

```bash
printf 'Sujet ntfy local : '
IFS= read -r -s NTFY_TOPIC
printf '\n'
NTFY_TOPIC="$NTFY_TOPIC" node scripts/run-monitor.mjs test-notification
unset NTFY_TOPIC
```

`read -s` évite d'inscrire la valeur dans la ligne de commande et dans l'historique du shell. Cette variable locale est temporaire : le secret GitHub `NTFY_TOPIC` reste la source canonique pour l'exploitation. Ne pas copier sa valeur dans un fichier `.env`, un script ou une commande littérale.

Dans GitHub, le workflow `Monitor Lorient events` accepte manuellement les modes `check`, `inspect` et `test-notification`. Le mode planifié est toujours `check`.

## État et branche `state`

Le workflow récupère la branche `state` dans `.monitor-state/`, puis passe `.monitor-state/state.json` au moniteur. Le schéma strict courant est la version 2 :

```json
{
  "version": 2,
  "initializedAt": null,
  "updatedAt": null,
  "seen": {},
  "sources": {},
  "candidates": {},
  "outbox": {
    "events": {},
    "health": {}
  }
}
```

- `seen` conserve les événements de baseline ou déjà acquittés ;
- `sources` conserve les dernières lectures et les cycles d'incident ;
- `candidates` met en cache pendant six heures les détails issus des agendas territoriaux ;
- `outbox.events` et `outbox.health` conservent ce qui doit encore être publié ou acquitté.

Pour amorcer la branche, lancer le script depuis un checkout propre de `main` :

```bash
node scripts/bootstrap-state.mjs
```

Le préflight exécute exactement `git ls-remote --exit-code --heads origin refs/heads/state` **avant** de créer un worktree ou une branche locale. Un code `0` signifie que `origin/state` existe : le script s'arrête en erreur sans commit ni push. Un code `2` autorise l'amorçage ; tout autre code est une erreur d'accès au distant et arrête également l'opération.

Après ce contrôle, le script crée un worktree temporaire sur `main` et une branche locale orpheline au nom unique. Immédiatement après `git switch --orphan`, il vide explicitement l'index avec `git read-tree --empty`, puis nettoie les fichiers hérités avec `git clean -fdx`, commande bornée à ce seul worktree éphémère. Il écrit ensuite le `state.json` produit par `emptyState()`, vérifie que le commit racine ne contient que ce fichier, pousse `state`, relit `FETCH_HEAD:state.json` depuis le distant et le passe à `validateState()`. Une fonction de nettoyage commune s'exécute après succès comme après échec : retrait forcé du seul worktree temporaire connu, suppression de sa branche locale si elle a été créée et suppression de son répertoire temporaire. Un nettoyage incomplet fait échouer explicitement le script.

Le premier `check` distant doit servir uniquement à établir les baselines. Vérifier son journal et le diff de `state.json` avant de considérer la surveillance active.

### Récupération

Un état JSON illisible ou incohérent arrête le moniteur avant tout appel réseau : il n'est jamais remplacé silencieusement. Un fichier absent crée au contraire un état vide et une nouvelle baseline ; sur une branche déjà exploitée, cette absence doit donc être traitée comme un incident avant de relancer. Dans ce cas :

1. désactiver `monitor.yml` depuis **Actions → Monitor Lorient events → … → Disable workflow**, ou avec `gh workflow disable monitor.yml --repo PROPRIETAIRE/sorties-lorient-alertes` ;
2. attendre la fin du run actif et vérifier qu'aucun run n'est encore `in_progress` ou `queued` ;
3. récupérer la branche `state` et sauvegarder l'octet exact de `state.json` ;
4. identifier le dernier commit valide dans `git log state -- state.json`, le restaurer par une opération Git traçable, de préférence `git revert`, puis pousser `state` ;
5. relire `origin/state:state.json` et le passer à `validateState()` comme dans la procédure d'amorçage ;
6. exécuter `inspect`, puis un seul `check` supervisé sur un checkout dédié de `state`, avec le sujet saisi par `read -s` ; examiner le code retour et le diff, puis committer/pousser seulement l'état contrôlé ;
7. supprimer ce checkout temporaire et réactiver enfin le workflow depuis l'interface, ou avec `gh workflow enable monitor.yml --repo PROPRIETAIRE/sorties-lorient-alertes`.

Ne pas supprimer `seen`, les outbox ou toute la branche pour « débloquer » un run : cela recréerait une baseline ou des alertes incohérentes. En cas de reset volontaire, conserver l'ancien état et assumer explicitement qu'un nouveau premier passage sera silencieux.

## Ajouter, désactiver ou réparer une source

La source de vérité est [`src/sources.mjs`](src/sources.mjs). Pour ajouter une source :

1. ajouter un identifiant unique, les URL HTTPS officielles, l'adaptateur, la ville/salle et `pollEveryMinutes` ;
2. ajouter ou adapter une fixture minimale sans donnée personnelle ;
3. tester la signature de page, les filtres culturels et l'URL de réservation ;
4. lancer `npm test`, puis `inspect` ;
5. laisser la première réussite de cette source établir sa baseline silencieuse.

Pour désactiver temporairement une source, conserver son entrée, passer `enabled` à `false` et renseigner `disabledReason`. Cela préserve son identité et son historique ; ne pas retirer son état à la main.

Les URL du **FIL** et d'**Hydrophone** contiennent actuellement une année de programmation. À chaque changement de saison, vérifier leurs pages officielles, mettre à jour les URL dans `src/sources.mjs`, renouveler les fixtures/signatures concernées et exécuter l'inspection avant réactivation. Ne pas deviner l'URL de l'année suivante.

## Exploitation GitHub

Le workflow `monitor.yml` :

- tourne aux minutes 7, 22, 37 et 52 ;
- utilise Node.js 22 et s'arrête après 10 minutes ;
- exécute `npm ci` et tous les tests avant de récupérer l'état ;
- sérialise les runs afin que deux écritures ne se chevauchent pas, sans annuler les runs en attente ; `queue: max` conserve jusqu'à 100 runs pending au lieu de remplacer le run déjà en file ;
- persiste `state.json` même après certains échecs de source ou de notification, mais uniquement si le checkout `state` a réussi et si le fichier a changé.

GitHub Actions ne garantit pas un démarrage à la minute exacte : un cron peut être retardé, voire différé lors d'une forte charge. Les cadences 15/60 minutes sont donc des fréquences demandées, pas un délai d'alerte garanti.

Le workflow `heartbeat.yml` écrit une date UTC dans `monitor-heartbeat.txt` sur `main`, le premier jour de chaque mois à 03:17 UTC. Il maintient l'activité planifiée d'un dépôt public mais ne remplace pas la surveillance des échecs de workflow.

## Sécurité ntfy et permissions

Un sujet sur le service public `ntfy.sh` n'est pas un compte privé : toute personne qui devine ou apprend son nom peut potentiellement publier ou s'abonner. Utiliser un nom aléatoire long (24 à 64 caractères), dédié à ce projet, et ne jamais le mettre dans le code, l'état, les tests, les captures ou les journaux.

La valeur est stockée uniquement dans le secret GitHub `NTFY_TOPIC` et injectée uniquement dans l'étape `Run monitor`. Pour la créer ou la remplacer :

```bash
gh secret set NTFY_TOPIC --repo PROPRIETAIRE/sorties-lorient-alertes
```

Après rotation, mettre à jour l'abonnement du téléphone puis lancer manuellement `test-notification`. Les workflows ne demandent que la permission GitHub `contents: write`, nécessaire aux branches `state` et `main`. Le checkout du code applicatif ne conserve pas les identifiants Git ; seul le checkout destiné à être poussé les utilise.

Toutes les actions tierces sont épinglées sur un SHA complet et immuable. Les requêtes réseau ont un timeout de 15 secondes, et ni le sujet ntfy ni une donnée personnelle ne doivent apparaître dans les fixtures ou les commits.

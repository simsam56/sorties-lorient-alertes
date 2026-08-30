# Rapport — correctif final avant publication

## Statut

Le correctif applicatif est livré dans `bc63248` (`fix: harden monitor before publication`). Aucun déploiement, push, secret, run GitHub ou envoi ntfy réel n'a été effectué.

Le positionnement public suit le ruling final : la surveillance active est partielle et porte sur six salles officiellement vérifiées. Elle n'est pas présentée comme une couverture de toute Lorient Agglomération ; `docs/source-audit.md` reste la source de preuve.

## Changements livrés

### État de production fail-closed

- `check` accepte `--require-existing-state`.
- Avec ce flag, un `ENOENT` est propagé avant la date d'exécution, la création du client réseau, toute collecte, tout appel ntfy et toute écriture.
- `monitor.yml` passe ce flag au moniteur après le checkout de la branche `state`.
- Le contrôle local documenté reste volontairement sans flag et conserve l'initialisation explicite d'un état neuf avec baseline silencieuse.

### Identité persistante des lieux

- Les alias de lieu sont centralisés dans `src/model.mjs` via `canonicalVenueId`.
- `canonicalEventId` et la déduplication consomment cette même fonction sans cycle d'import.
- `Salle Keragan` et `Océanis` ont la même identité ; `Grand Théâtre` et `Grand Théâtre de Lorient` rejoignent `Théâtre de Lorient`.
- Un scénario inter-runs prouve qu'un événement acquitté sous `Océanis`, puis observé seul sous `Salle Keragan`, ne recrée ni `newEvent` ni entrée d'outbox.

### Mapado fail-close

- Chaque entrée `dated_events` valide `availabilityStatus`, `isOnSale`, `title` et `slug` avant filtrage.
- Une vente candidate exige un planning objet non vide et au moins une date française exploitable.
- Les slugs vides, traversants ou porteurs de query/fragment sont refusés avant construction de l'URL.
- Les erreurs indiquent la source, l'index `dated_events` et le champ fautif.
- Les produits non datés restent ignorés, même incomplets.

### Contrat HTTP partagé

- La production et le contrat live utilisent le même `fetchSourceText` et les mêmes en-têtes : `Accept: text/html,application/xhtml+xml` et `User-Agent: sorties-lorient-alertes-live-audit/1.0`.
- Le test CLI observe ces en-têtes sur les requêtes réelles du chemin de collecte simulé.

### Positionnement public

- L'ouverture du README dit explicitement « couverture partielle de six salles officiellement vérifiées ».
- Elle précise que les agendas territoriaux et autres sources restent désactivés et que la couverture n'est pas exhaustive.
- Le lien vers l'audit source et les motifs détaillés sont conservés.

## TDD — preuves RED/GREEN

### 1. État requis et workflow

RED :

```text
$ node --test --test-name-pattern='check requis refuse|checkout de l’état arrive' test/cli.test.mjs test/workflow.test.mjs
check requis : FAIL — le processus sortait avec code 0

$ node --test test/workflow.test.mjs
FAIL — la commande n'incluait pas --require-existing-state
```

GREEN :

```text
$ node --test --test-name-pattern='check requis refuse' test/cli.test.mjs
tests 1; pass 1; fail 0

$ node --test test/workflow.test.mjs
tests 8; pass 7; fail 0; skipped 1 (actionlint absent)
```

### 2. Alias persistants

RED :

```text
$ node --test test/model.test.mjs
tests 4; pass 2; fail 2
identité produite : grand-theatre au lieu de theatre-de-lorient

$ node --test --test-name-pattern='alias du lieu' test/state.test.mjs
tests 1; pass 0; fail 1
la seconde lecture Salle Keragan recréait un newEvent
```

GREEN :

```text
$ node --test test/model.test.mjs test/dedupe.test.mjs
tests 11; pass 11; fail 0

$ node --test --test-name-pattern='alias du lieu' test/state.test.mjs
tests 1; pass 1; fail 0
```

### 3. Validation Mapado

RED :

```text
$ node --test test/mapado.test.mjs
tests 12; pass 8; fail 4
échecs attendus : champs absents, mauvais types, slug ambigu, planning/date inexploitable
```

GREEN :

```text
$ node --test test/mapado.test.mjs
tests 12; pass 12; fail 0
```

### 4. En-têtes HTTP de production

RED :

```text
$ node --test --test-name-pattern='inspect contrôle' test/cli.test.mjs
tests 1; pass 0; fail 1
en-têtes observés : undefined
```

GREEN :

```text
$ node --test --test-name-pattern='inspect contrôle' test/cli.test.mjs
tests 1; pass 1; fail 0

$ node --test test/network.test.mjs test/live-contract.test.mjs
tests 7; pass 6; fail 0; skipped 1 (live opt-in)
```

Le README est un document humain : conformément à la discipline de tests, aucun test de recherche textuelle n'a été ajouté.

## Vérifications finales

```text
$ node --test test/cli.test.mjs test/workflow.test.mjs test/model.test.mjs test/dedupe.test.mjs test/state.test.mjs test/mapado.test.mjs test/network.test.mjs test/live-contract.test.mjs
tests 71; pass 69; fail 0; skipped 2

$ npm test
tests 124; pass 122; fail 0; skipped 2

$ LIVE_TESTS=1 node --test test/live-contract.test.mjs
tests 2; pass 2; fail 0

$ node scripts/run-monitor.mjs inspect
6 sources OK; 6 sources IGNORÉ avec motif; 81 événements canoniques; code 0

$ for file in src/*.mjs src/adapters/*.mjs scripts/*.mjs test/*.mjs; do node --check "$file"; done
aucune sortie; code 0

$ git diff --check
aucune sortie; code 0
```

Une recherche du diff n'a trouvé ni sujet ntfy concret ni secret littéral.

## Auto-relecture

L'auto-relecture a été faite sans sous-agent, conformément à la consigne explicite.

- Le chemin `--require-existing-state` échoue sur la lecture du fichier avant `networkFetch()` ; le test subprocess constate zéro requête source, zéro requête ntfy, zéro fichier d'état et zéro temporaire.
- Le workflow est analysé comme YAML et sa commande effective impose le flag ; le checkout d'état reste antérieur à l'exécution.
- La centralisation des alias ne modifie pas les libellés affichés : elle agit seulement sur les clés d'identité et le rapprochement.
- Les validations Mapado s'appliquent seulement aux `dated_events`; l'absence de date est exigée uniquement pour une vente réellement candidate (`isOnSale: true`, `availabilityStatus: onSale`).
- Le client HTTP partagé conserve le timeout injecté par le collecteur et ne touche pas au client ntfy.
- `git show --check bc63248` ne relève aucune erreur d'espace.

## Réserves

- `actionlint` n'est pas installé dans l'environnement ; son test reste le skip attendu. Le parsing YAML sémantique et les tests d'effets Git sont verts.
- Les preuves live sont un instantané du 30 août 2026. Une dérive future d'une page Mapado doit désormais échouer explicitement au lieu de produire un faux vide.
- La publication reste à faire avec l'autorisation externe prévue par la tâche 12 : dépôt public, branche `state`, secret GitHub, runs et notification ntfy ne sont pas couverts par ce correctif local.

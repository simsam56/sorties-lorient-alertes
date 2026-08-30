## En cours

- [Codex] 2026-08-29 23:35 — je touche : implementation complete dans la branche codex/implement-events

## Decisions
- 2026-08-29 — Projet GitHub Actions séparé du FCL ; nouveau canal ntfy et contrôle toutes les 15 minutes.
- 2026-08-29 — Couverture hybride : agenda territorial et billetteries officielles des principales salles, avec déduplication.
- 2026-08-30 — État strict porté en v2 avec outbox événements/santé, car les notifications doivent survivre à la disparition d'une source et aux échecs ntfy sans reset implicite.
- 2026-08-30 — Identité santé fixée à kind/sourceId/checkedAt, afin que plusieurs cycles non acquittés restent distincts et causalement ordonnés.

## Etat
- 2026-08-29 — [Codex] Conception validée en conversation ; spécification écrite en cours.
- 2026-08-29 — [Codex] Spécification complète rédigée et auto-relue ; attente de la validation de Simon avant le plan d'implémentation.
- 2026-08-29 — [Codex] Spécification validée ; plan test-first en 12 tâches rédigé et inventaire technique des sources vérifié.
- 2026-08-29 — [Codex] Fondation Event et inventaire des 12 sources livrés dans cb06589 ; 9 tests passent.
- 2026-08-29 23:49 — [Codex] Tâche 2 livrée : adaptateur officiel Mapado, signatures incohérentes refusées, commit 2d1d742 ; 14 tests passent.
- 2026-08-29 23:52 — [Codex] Correctif T2 livré : entrées Mapado nulles refusées avec contexte source, commit f120483 ; 16 tests passent.
- 2026-08-29 23:56 — [Codex] Tâche 3 livrée : découverte territoriale, résolution HTTPS et exclusions culturelles, commit 1e16c68 ; 22 tests passent.
- 2026-08-29 23:59 — [Codex] Correctif T3 livré : ancres, revente TicketSwap, inclusion culturelle et domaine Tourism durcis, commit 949c94e ; 28 tests passent.
- 2026-08-30 00:07 — [Codex] Tâche 4 livrée : quatre adaptateurs directs stricts, signatures et réservations officielles contrôlées, commit c30c204 ; 36 tests passent.
- 2026-08-30 00:15 — [Codex] Correctif revue T4 livré : produits Théâtre exclus, repli lieu/ville, signatures et année FIL durcis, commit 63a3bde ; 42 tests passent.
- 2026-08-30 — [Codex] Tâche 5 livrée : collecteur autonome, cadences, timeout, cache candidat 6 h et isolation par source ; commit 128a6e6, 47 tests passent.
- 2026-08-30 — [Codex] Correctif T5 livré : limite de cinq détails partagée entre sources territoriales, timeout injectable vérifié, cache nul/malformé/frontière 6 h couvert ; commit 757c77c, 52 tests passent.
- 2026-08-30 — [Codex] T6 déduplication inter-sources : fusion déterministe et conservatrice, préférences de billetterie et 56 tests verts ; commit bd884d8.
- 2026-08-30 — [Codex] Correctif T6 round 1 : tie-breaker total, horaires divergents protégés et préfixes organisateurs conservateurs ; commit 3f0efe7, 59 tests passent.
- 2026-08-30 — [Codex] T7 état strict/incidents livré : baseline par source, ack partiel, cache candidat durable et cycle incident/récupération ; commit b9c2b37, 67 tests passent.
- 2026-08-30 — [Codex] Correctif T7 round 1 : replays source monotones/idempotents et cache candidat newest-wins ; commit d538e9f, 72 tests passent.
- 2026-08-30 — [Codex] Correctif T7 round 2 : fingerprint complet succès/échec après validation et conflit de contenu à timestamp égal ; commit 2b595db, 77 tests passent.
- 2026-08-30 — [Codex] Correctif T7 round 3 : sourceId/sourceUrl primaires intégrés au fingerprint succès ; commit de3609f, 78 tests passent.
- 2026-08-30 — [Codex] T8 livrée : notifications individuelles/digest Unicode borné, santé et publication ntfy sécurisée ; commit a93d854, 88 tests passent.
- 2026-08-30 — [Codex] Correctif T8 round 1 : budget UTF-8 sûr pour URLs Unicode hors plafond, Markdown omis proprement si nécessaire ; commit 82bcd4f, 90 tests passent.
- 2026-08-30 — [Codex] T9 CLI retry-safe livrée : validation pré-réseau, baseline par source, ack partiel, état/candidats/santé atomiques et notification de contrôle ; commit 18e043f, 96 tests passent.
- 2026-08-30 — [Codex] Correctif T9 round 1 livré : outbox événement/santé durable avant envoi, ack retry-safe et temporaires atomiques PID+UUID ; commit 50698d5, 101 tests passent.
- 2026-08-30 — [Codex] Correctif T9 round 2 livré : transitions santé multi-cycles distinctes, validation des IDs historiques et ack indépendant ; commit 40978e0, 103 tests passent.
- 2026-08-30 01:xx — [Codex] T10 livrée : monitor 15 min/manual, état sérialisé sur `state`, heartbeat mensuel `main`, secret ntfy borné à l'étape d'exécution, tests YAML sémantiques + effets Git et README opérationnel ; commits 1cef5cc/d96c644, 110 réussites sur 111 tests (actionlint absent donc 1 skip).
- 2026-08-30 02:xx — [Codex] Correctif revue T10 livré : `queue: max` strict, bootstrap `state` exécuté sans suppression récursive, récupération disable/attente/validation/check/enable et secret local silencieux ; commit 8f88fc1, 110 réussites sur 111 tests (actionlint absent donc 1 skip).
- 2026-08-30 02:xx — [Codex] Correctif revue T10 round 2 livré : bootstrap `state` fail-closed avant worktree, cleanup succès/échec testé avec remotes Git réels et aucun push/commit au préflight ; commits 7f35aaa/d80bf0a, 113 réussites sur 114 tests (actionlint absent donc 1 skip).
- 2026-08-30 02:xx — [Codex] Correctif revue T10 round 3 livré : index/worktree orphelin explicitement vidés avant `state.json`, succès prouvé jusqu'au tree distant et rejet prouvé par sentinelle serveur ; commit bbeec15, 113 réussites sur 114 tests (actionlint absent donc 1 skip).
- 2026-08-30 02:07 — [Codex/T11] Audit live livré : 6 Mapado actives, 6 sources désactivées avec preuve et motif, contrat live opt-in ; commit 04e1882, 114 réussites sur 116 tests (2 skips attendus).
- 2026-08-30 02:26 — [Codex] Correctif final pre-publication livre : etat production requis, identite lieu persistante, Mapado fail-close, HTTP partage et couverture partielle explicite ; commit bc63248, 122 reussites sur 124 tests, live 2/2, inspect 6 actives/6 desactivees/81 canoniques.
- 2026-08-30 02:37 — [Codex] Final fix round 2 livre : slug Mapado ASCII canonique avec URL exacte et dates francaises validees par calendrier UTC ; commit d80f94e, 125 reussites sur 127 tests, live 2/2, inspect stable a 81 canoniques.

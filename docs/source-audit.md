# Audit live des sources

Audit en lecture seule réalisé le **30 août 2026 de 00:02:53 à 00:03:14 UTC** (02:02:53 à 02:03:14 à Paris).

Chaque URL source a reçu une requête `GET` avec un délai maximal de 15 secondes et le User-Agent explicite `sorties-lorient-alertes-source-audit/1.0`. Pour chaque source ayant produit au moins un événement, un seul lien de réservation extrait a ensuite été relu avec les mêmes limites. Aucun état n'a été écrit et aucune notification n'a été envoyée.

Les colonnes `Joignable`, `Signature`, `Événements`, `Réservables`, `Active` et `Motif` correspondent au contrat d'audit `{ id, reachable, signatureValid, eventCount, reservableCount, activated, reason }`. La date HTTP est celle renvoyée par le serveur ; `—` signifie qu'aucune réponse HTTP n'a été obtenue.

| Source (`id`) | URL contrôlée | HTTP source (date UTC) | Signature | Événements / réservables | Preuve d'accès réservation | Active | Motif |
|---|---|---:|---:|---:|---|---:|---|
| L'Estran (`mapado-estran`) | <https://lestran-guidel.mapado.com/> | 200 — 00:02:53 | oui | 25 / 25 | [échantillon officiel](https://lestran-guidel.mapado.com/event/779649-presentation-de-saison-concert-harold-lopez-nussa) : HTTP 200 à 00:02:53 | oui | Signature Mapado et extraction valides ; l'échantillon officiel est accessible. |
| Océanis (`mapado-oceanis`) | <https://billetterieoceanis.mapado.com/> | 200 — 00:02:54 | oui | 12 / 12 | [échantillon officiel](https://billetterieoceanis.mapado.com/event/735130-ouverture-de-saison-26-27-en-attendant-la-vague) : HTTP 200 à 00:02:55 | oui | Signature Mapado et extraction valides ; l'échantillon officiel est accessible. |
| Le Strapontin (`mapado-strapontin`) | <https://lestrapontin.mapado.com/> | 200 — 00:02:55 | oui | 16 / 16 | [échantillon officiel](https://lestrapontin.mapado.com/event/801853-presentation-de-saison-pour-les-familles) : HTTP 200 à 00:02:56 | oui | Signature Mapado et extraction valides ; l'échantillon officiel est accessible. |
| Quai 9 (`mapado-quai9`) | <https://billetterie-quai9.mapado.com/> | 200 — 00:02:57 | oui | 0 / 0 | sans objet : aucune vente datée disponible dans la collection officielle | oui | La signature Mapado et sa collection sont valides ; le résultat vide est explicite et sûr. |
| Les Arcs (`mapado-arcs`) | <https://queven-lesarcs.mapado.com/> | 200 — 00:02:57 | oui | 10 / 10 | [échantillon officiel](https://queven-lesarcs.mapado.com/event/733856-lilly-wood-and-the-prick-1re-partie) : HTTP 200 à 00:02:58 | oui | Signature Mapado et extraction valides ; l'échantillon officiel est accessible. |
| Théâtre à la Coque (`mapado-coque`) | <https://theatrealacoque-cnma.mapado.com/> | 200 — 00:02:59 | oui | 19 / 19 | [échantillon officiel](https://theatrealacoque-cnma.mapado.com/event/814373-ouverture-de-saison) : HTTP 200 à 00:02:59 | oui | Signature Mapado et extraction valides ; l'échantillon officiel est accessible. |
| Lorient Bretagne Sud Tourisme (`tourism`) | <https://www.lorientbretagnesudtourisme.fr/fr/immanquables/lorient/agenda/spectacle/> | 200 — 00:03:00 | non | 0 / 0 | non testable | non | La page répond, mais la signature Tourisme attendue et les réservations officielles ne sont plus extractibles de façon sûre. |
| Lorient Bretagne Sud Événements (`lorient-events`) | <https://lorient-evenements.bzh/agenda/> | 200 — 00:03:00 | non | 0 / 0 | non testable | non | La page répond, mais la signature agenda attendue et les réservations officielles ne sont plus extractibles de façon sûre. |
| Théâtre de Lorient (`theatre-lorient`) | <https://theatredelorient.fr/saison/> | 200 — 00:03:02 | non | 0 / 0 | non testable | non | La page répond, mais aucune carte ne satisfait à la fois la signature de saison et le lien de billetterie officiel attendu. |
| Hydrophone (`hydrophone`) | <https://www.hydrophone.fr/-La-programmation-2026-.html> | 200 — 00:03:03 | non | 0 / 0 | non testable | non | La page répond, mais aucune carte ne satisfait à la fois la signature de programmation et le lien de billetterie officiel attendu. |
| TRIO…S (`trios`) | <https://www.vostickets.net/billet?id=TRIO> | — | non | 0 / 0 | non testable | non | Connexion TCP refusée sur le port 443 (`curl` code 7, HTTP 000) ; signature et réservation invérifiables. |
| Festival Interceltique de Lorient (`fil`) | <https://www.festival-interceltique.bzh/billetterie-2026/> | 200 — 00:03:14 | oui | 0 / 0 | non testable | non | La signature officielle est reconnue, mais aucun événement ni lien de réservation live ne permet de prouver l'extraction avant activation. |

## Décision d'activation

Seules les six billetteries Mapado sont actives à l'issue de cet audit. Les autres entrées restent dans `SOURCES` avec `enabled: false` et un `disabledReason` concret. Une page HTTP 200 ne suffit pas : la signature attendue et, lorsqu'une vente existe, le lien de réservation officiel doivent être démontrés ensemble.

Le City ne reçoit pas d'adaptateur direct : aucune billetterie officielle indépendante et stable n'a été identifiée. Sa voie de couverture prévue reste l'agenda territorial. Comme les deux sources territoriales sont désactivées après cet audit, **Le City n'est pas couvert activement à cette date** ; il ne faut pas présenter cette couverture comme opérationnelle avant réactivation prouvée d'un agenda territorial.

## Réaudit prioritaire du 30 août 2026 à 14:29 (Europe/Paris)

À la demande de Simon, Hydrophone et Lorient Bretagne Sud Événements ont été réaudités sur leurs données live puis activés après contrat réel réussi.

- **Hydrophone** : la billetterie officielle expose un jeton public éphémère dans sa page d'accueil et une API `/api/v2/sessions`. Le collecteur récupère ce jeton à chaque passage sans le persister, puis retient uniquement les événements futurs à Hydrophone, publiés `on_sale`, disponibles, non fermés, non annulés et hors pass. Le contrôle live extrait 10 ventes sûres ; une session annulée encore publiée (`CIEL`) est explicitement rejetée.
- **Lorient Bretagne Sud Événements** : les cartes officielles de l'agenda portent un titre, un `time[datetime]` et l'un des trois lieux connus. Le mapping vérifié est Palais des Congrès → Lorient, Parc des Expositions → Lanester et Espace événementiel K2 → Lorient. Sur chaque fiche, seule la section `Tarifs et réservation` peut fournir la billetterie ; les liens de la colonne « Autres événements à venir » sont ignorés. Le contrôle live extrait 13 spectacles réservables ; les salons et autres manifestations non culturelles explicitement nommés dans le titre restent exclus.

Après ce réaudit, huit sources sont actives et l'inspection sans état produit 104 événements canoniques. Lorient Bretagne Sud Tourisme, Théâtre de Lorient, TRIO…S et le Festival Interceltique restent désactivés.

## Vérification reproductible

La suite normale vérifie le gate de configuration sans réseau et ignore le contrat live. Le contrat live est explicitement opt-in :

```bash
npm test
LIVE_TESTS=1 node --test test/live-contract.test.mjs
node scripts/run-monitor.mjs inspect
```

Le test live appelle directement le collecteur pour chaque source active. Il ne charge aucun état, n'appelle pas ntfy et échoue si une signature active ou un événement normalisé devient invalide.

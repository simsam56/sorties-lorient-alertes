export const SOURCES = Object.freeze([
  { id: "mapado-estran", name: "L'Estran", url: "https://lestran-guidel.mapado.com/", homeUrl: "https://lestran.net/", adapter: "mapado", pollEveryMinutes: 15, city: "Guidel", venue: "L'Estran", enabled: true, disabledReason: null },
  { id: "mapado-oceanis", name: "Océanis", url: "https://billetterieoceanis.mapado.com/", homeUrl: "https://www.ploemeur.com/vivre/oceanis-salle-de-spectacle/", adapter: "mapado", pollEveryMinutes: 15, city: "Ploemeur", venue: "Océanis", enabled: true, disabledReason: null },
  { id: "mapado-strapontin", name: "Le Strapontin", url: "https://lestrapontin.mapado.com/", homeUrl: "https://lestrapontin.fr/", adapter: "mapado", pollEveryMinutes: 15, city: "Pont-Scorff", venue: "Le Strapontin", enabled: true, disabledReason: null },
  { id: "mapado-quai9", name: "Quai 9", url: "https://billetterie-quai9.mapado.com/", homeUrl: "https://quai9.bzh/", adapter: "mapado", pollEveryMinutes: 15, city: "Lanester", venue: "Quai 9", enabled: true, disabledReason: null },
  { id: "mapado-arcs", name: "Les Arcs", url: "https://queven-lesarcs.mapado.com/", homeUrl: "https://www.queven.com/", adapter: "mapado", pollEveryMinutes: 15, city: "Quéven", venue: "Les Arcs", enabled: true, disabledReason: null },
  { id: "mapado-coque", name: "Théâtre à la Coque", url: "https://theatrealacoque-cnma.mapado.com/", homeUrl: "https://www.theatrealacoque.fr/", adapter: "mapado", pollEveryMinutes: 15, city: "Hennebont", venue: "Théâtre à la Coque", enabled: true, disabledReason: null },
  { id: "tourism", name: "Lorient Bretagne Sud Tourisme", url: "https://www.lorientbretagnesudtourisme.fr/fr/immanquables/lorient/agenda/spectacle/", homeUrl: "https://www.lorientbretagnesudtourisme.fr/fr/agenda/", adapter: "tourism", pollEveryMinutes: 60, city: null, venue: null, enabled: false, disabledReason: "Page HTTP 200 le 30/08/2026, mais signature Tourisme et réservations officielles non extractibles." },
  { id: "lorient-events", name: "Lorient Bretagne Sud Événements", url: "https://lorient-evenements.bzh/agenda/", homeUrl: "https://lorient-evenements.bzh/agenda/", adapter: "lorient-events", pollEveryMinutes: 60, city: null, venue: null, enabled: true, disabledReason: null },
  { id: "theatre-lorient", name: "Théâtre de Lorient", url: "https://theatredelorient.fr/saison/", homeUrl: "https://theatredelorient.fr/", adapter: "theatre-lorient", pollEveryMinutes: 15, city: "Lorient", venue: "Théâtre de Lorient", enabled: false, disabledReason: "Page HTTP 200 le 30/08/2026, mais signature saison et réservations officielles non extractibles." },
  { id: "hydrophone", name: "Hydrophone", url: "https://billetterie.hydrophone.fr/", homeUrl: "https://www.hydrophone.fr/", adapter: "hydrophone", pollEveryMinutes: 15, city: "Lorient", venue: "Hydrophone", enabled: true, disabledReason: null },
  { id: "trios", name: "TRIO…S", url: "https://www.vostickets.net/billet?id=TRIO", homeUrl: "https://trio-s.fr/", adapter: "trios", pollEveryMinutes: 15, city: null, venue: "TRIO…S", enabled: false, disabledReason: "Connexion HTTPS Vostickets refusée le 30/08/2026 ; signature et réservation invérifiables." },
  { id: "fil", name: "Festival Interceltique de Lorient", url: "https://www.festival-interceltique.bzh/billetterie-2026/", homeUrl: "https://www.festival-interceltique.bzh/", adapter: "fil", pollEveryMinutes: 60, city: "Lorient", venue: "Festival Interceltique", enabled: false, disabledReason: "Signature officielle reconnue le 30/08/2026, mais aucun événement ni lien de réservation extrait." },
]);

export function getSource(id) {
  const source = SOURCES.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Source inconnue: ${id}`);
  return source;
}

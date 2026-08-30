import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTourismCandidates } from "../src/adapters/tourism.mjs";
import { parseLorientEventsCandidates } from "../src/adapters/lorient-events.mjs";
import { findReservationUrl, resolveReservation } from "../src/adapters/reservation-links.mjs";

const tourism = {
  id: "tourism",
  name: "Lorient Bretagne Sud Tourisme",
  url: "https://www.lorientbretagnesudtourisme.fr/fr/agenda/",
};
const lorientEvents = {
  id: "lorient-events",
  name: "Lorient Bretagne Sud Événements",
  url: "https://lorient-evenements.bzh/agenda/",
};

async function fixture(name) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function tourismCard(href) {
  return `<article class="list-item"><div class="content">
    <h2><a class="dsio-detail-button" href="${href}">Fête des lumières</a></h2>
    <p class="place">Grand Théâtre, Lorient</p>
    <p class="date"><strong>Samedi 12 décembre 2026</strong></p>
  </div></article>`;
}

test("découvre et déduplique les candidats Tourisme sans confondre détail et réservation", async () => {
  const candidates = parseTourismCandidates(await fixture("tourism-list.html"), tourism);

  assert.deepEqual(candidates, [{
    title: "Fête des lumières",
    startsOn: "2026-12-12",
    venue: "Grand Théâtre",
    city: "Lorient",
    detailUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/fete-des-lumieres/",
    sourceId: "tourism",
  }]);
  assert.ok(candidates.every((candidate) => !("bookingUrl" in candidate)));
});

test("découvre seulement les fiches agenda Lorient Événements et ignore feed", async () => {
  assert.deepEqual(parseLorientEventsCandidates(await fixture("lorient-events-list.html"), lorientEvents), [{
    title: "Le grand soir",
    startsOn: "2026-10-09",
    venue: "Palais des Congrès",
    city: "Lorient",
    detailUrl: "https://lorient-evenements.bzh/agenda/le-grand-soir/",
    sourceId: "lorient-events",
  }]);
});

test("mappe strictement les trois lieux officiels de l'agenda vers leur commune", () => {
  const card = (slug, title, venue, date) => `<li><a href="/agenda/${slug}/"><figure class="evenement-card"><figcaption>
    <h2 class="evenement-card__title">${title}</h2>
    <p class="evenement-card__location">${venue}</p>
    <p class="evenement-card__date"><time datetime="${date}">${date}</time></p>
  </figcaption></figure></a></li>`;
  const html = `<ul class="archive-evenement__list">
    ${card("palais", "Au palais", "Palais des Congrès", "2026-10-10")}
    ${card("parc", "Au parc", "Parc des Expositions", "2026-10-11")}
    ${card("k2", "Au K2", "Espace événementiel K2", "2026-10-12")}
  </ul>`;

  assert.deepEqual(parseLorientEventsCandidates(html, lorientEvents).map(({ venue, city, startsOn }) => ({ venue, city, startsOn })), [
    { venue: "Palais des Congrès", city: "Lorient", startsOn: "2026-10-10" },
    { venue: "Parc des Expositions", city: "Lanester", startsOn: "2026-10-11" },
    { venue: "Espace événementiel K2", city: "Lorient", startsOn: "2026-10-12" },
  ]);
});

test("refuse un lieu inconnu plutôt que d'inventer sa commune", () => {
  const html = `<ul class="archive-evenement__list"><li><a href="/agenda/inconnu/"><figure class="evenement-card">
    <h2 class="evenement-card__title">Événement</h2>
    <p class="evenement-card__location">Lieu inconnu</p>
    <p class="evenement-card__date"><time datetime="2026-10-10">10 octobre 2026</time></p>
  </figure></a></li></ul>`;

  assert.throws(() => parseLorientEventsCandidates(html, lorientEvents), /signature Lorient Événements invalide/);
});

test("refuse explicitement les signatures territoriales inattendues", () => {
  assert.throws(
    () => parseTourismCandidates("<main>Maintenance</main>", tourism),
    /Lorient Bretagne Sud Tourisme: signature Tourisme absente/,
  );
  assert.throws(
    () => parseLorientEventsCandidates("<main>Maintenance</main>", lorientEvents),
    /Lorient Bretagne Sud Événements: signature Lorient Événements absente/,
  );
});

test("ne résout pas un détail sans réservation HTTPS fiable", () => {
  const candidate = {
    title: "Spectacle sans réservation",
    startsOn: "2026-10-10",
    venue: "Le City",
    city: "Lorient",
    detailUrl: "https://agenda.example.test/spectacle-sans-reservation",
    sourceId: "tourism",
  };
  const html = '<a href="mailto:billetterie@example.test">Nous contacter</a><a href="tel:+33200000000">Téléphone</a>';

  assert.equal(findReservationUrl(html, candidate.detailUrl), null);
  assert.equal(resolveReservation(html, candidate), null);
});

test("ignore une ancre de réservation sur la fiche elle-même", () => {
  const detailUrl = "https://agenda.example.test/spectacle";

  assert.equal(findReservationUrl('<a href="#billetterie">Réserver</a>', detailUrl), null);
});

test("écarte TicketSwap, plateforme de revente", () => {
  const detailUrl = "https://agenda.example.test/spectacle";

  assert.equal(
    findReservationUrl('<a href="https://www.ticketswap.com/event/spectacle/123">Réserver</a>', detailUrl),
    null,
  );
});

test("contextualise un href de réservation malformé", () => {
  assert.throws(
    () => findReservationUrl('<a href="https://[invalide">Réserver</a>', "https://agenda.example.test/spectacle"),
    /Lien de réservation invalide/,
  );
});

test("écarte une foire professionnelle même avec une billetterie", async () => {
  const candidate = {
    title: "Salon des métiers 2026",
    startsOn: "2026-10-09",
    venue: "Palais des Congrès",
    city: "Lorient",
    detailUrl: "https://lorient-evenements.bzh/agenda/salon-des-metiers/",
    sourceId: "lorient-events",
  };

  const html = `<main class="single-evenement__content"><div>
    <div class="content-style"><p>Salon professionnel des métiers.</p></div>
    <section class="single-evenement__tarifs"><a href="https://tickets.example.test/salon-pro">Billetterie</a></section>
  </div></main>`;
  assert.equal(resolveReservation(html, candidate), null);
});

test("un mot culturel faible dans la description ne réhabilite pas un salon", () => {
  const candidate = {
    title: "Salon des familles",
    startsOn: "2026-10-09",
    venue: "Palais des Congrès",
    city: "Lorient",
    detailUrl: "https://lorient-evenements.bzh/agenda/salon-des-familles/",
    sourceId: "lorient-events",
  };
  const html = `<main class="single-evenement__content"><div>
    <div class="content-style"><p>Une sortie en famille.</p></div>
    <section class="single-evenement__tarifs"><a href="https://tickets.example.test/salon-familles">Billetterie</a></section>
  </div></main>`;

  assert.equal(resolveReservation(html, candidate), null);
});

test("ignore les catégories culturelles situées hors de la fiche Lorient", () => {
  const candidate = {
    title: "Atelier poterie",
    startsOn: "2026-10-09",
    venue: "Palais des Congrès",
    city: "Lorient",
    detailUrl: "https://lorient-evenements.bzh/agenda/atelier-poterie/",
    sourceId: "lorient-events",
  };
  const html = `<main class="single-evenement__content"><div>
    <div class="content-style"><p>Initiation à la terre.</p></div>
    <section class="single-evenement__tarifs"><a href="https://tickets.example.test/atelier">Billetterie</a></section>
  </div></main><aside class="category">Festival</aside>`;

  assert.equal(resolveReservation(html, candidate), null);
});

test("conserve un festival dont la description cite le Palais des Congrès", () => {
  const candidate = {
    title: "Festival Insolent",
    startsOn: "2026-10-09",
    venue: "Palais des Congrès",
    city: "Lorient",
    detailUrl: "https://lorient-evenements.bzh/agenda/festival-insolent/",
    sourceId: "lorient-events",
  };
  const html = `<main class="single-evenement__content"><div>
    <div class="content-style"><p>Festival organisé près du Palais des Congrès.</p></div>
    <section class="single-evenement__tarifs"><a href="https://tickets.example.test/festival-insolent">Billetterie</a></section>
  </div></main>`;

  assert.deepEqual(resolveReservation(html, candidate), {
    title: "Festival Insolent",
    startsOn: "2026-10-09",
    startsAt: null,
    venue: "Palais des Congrès",
    city: "Lorient",
    bookingUrl: "https://tickets.example.test/festival-insolent",
    sourceUrl: "https://lorient-evenements.bzh/agenda/festival-insolent/",
    sourceId: "lorient-events",
  });
});

test("résout une fiche culturelle Lorient uniquement depuis sa section tarifs", async () => {
  const candidate = parseLorientEventsCandidates(await fixture("lorient-events-list.html"), lorientEvents)[0];

  assert.deepEqual(resolveReservation(await fixture("lorient-events-detail.html"), candidate), {
    title: "Le grand soir",
    startsOn: "2026-10-09",
    startsAt: null,
    venue: "Palais des Congrès",
    city: "Lorient",
    bookingUrl: "https://tickets.example.test/le-grand-soir",
    sourceUrl: "https://lorient-evenements.bzh/agenda/le-grand-soir/",
    sourceId: "lorient-events",
  });
});

test("ne reprend jamais la billetterie d'un autre événement dans la colonne latérale", () => {
  const candidate = {
    title: "Réservations à venir",
    startsOn: "2026-10-10",
    venue: "Palais des Congrès",
    city: "Lorient",
    detailUrl: "https://lorient-evenements.bzh/agenda/reservations-a-venir/",
    sourceId: "lorient-events",
  };
  const html = `<main class="single-evenement__content"><div><div class="content-style"><p>Spectacle à venir.</p></div></div></main>
    <aside class="single-evenement__more"><a href="https://tickets.example.test/autre">Billetterie autre spectacle</a></aside>`;

  assert.equal(resolveReservation(html, candidate), null);
});

test("écarte une activité générique sans catégorie culturelle explicite", () => {
  const candidate = {
    title: "Atelier poterie",
    startsOn: "2026-10-09",
    venue: "Maison des associations",
    city: "Lorient",
    detailUrl: "https://agenda.example.test/atelier-poterie",
    sourceId: "tourism",
  };

  assert.equal(
    resolveReservation('<a href="https://billetterie.example.test/atelier-poterie">Réserver</a>', candidate),
    null,
  );
});

test("refuse une fiche Tourisme hors domaine officiel", () => {
  assert.throws(
    () => parseTourismCandidates(tourismCard("https://evil.example.test/fr/fiche/fete-des-lumieres/"), tourism),
    /Lorient Bretagne Sud Tourisme: signature Tourisme invalide/,
  );
});

test("contextualise un href Tourisme malformé", () => {
  assert.throws(
    () => parseTourismCandidates(tourismCard("https://[invalide"), tourism),
    /Lorient Bretagne Sud Tourisme: signature Tourisme invalide/,
  );
});

test("transforme un spectacle familial réservé en Event strict", async () => {
  const candidate = parseTourismCandidates(await fixture("tourism-list.html"), tourism)[0];

  assert.deepEqual(resolveReservation(await fixture("tourism-detail.html"), candidate), {
    title: "Fête des lumières",
    startsOn: "2026-12-12",
    startsAt: null,
    venue: "Grand Théâtre",
    city: "Lorient",
    bookingUrl: "https://billetterie.example.test/fete-des-lumieres",
    sourceUrl: "https://www.lorientbretagnesudtourisme.fr/fr/fiche/fete-des-lumieres/",
    sourceId: "tourism",
  });
});

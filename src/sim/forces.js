// Profils de force adverse.
//
// On ne combat pas une milice villageoise comme une armée régulière. Le profil
// choisi à la mise en place agit sur trois plans :
//
//   - le MATÉRIEL : optique, portée utile, létalité, blindage, transmissions,
//     et surtout la vision nocturne, qui décide à elle seule d'un combat de nuit ;
//   - l'INSTRUCTION : précision, moral, cohésion sous le feu ;
//   - la MANŒUVRE : une force dissymétrique embusque et se dérobe, elle ne tient
//     pas de ligne et n'a pas toujours de commandement d'ensemble.
//
// Les multiplicateurs s'appliquent sur le catalogue commun : chaque élément
// adverse reçoit sa propre fiche technique, dérivée du type de base.

export const FORCES = {
  villageois: {
    key: 'villageois',
    label: 'Milice villageoise',
    difficulty: 1,
    summary: 'Villageois armés. Fusils de chasse et armes de guerre récupérées, ' +
             'aucune optique, aucune vision nocturne, pas de commandement d’ensemble. ' +
             'Nombreux, ils embusquent et se dérobent.',

    count: 1.6,                 // nombreux, mais faibles
    optics: 0.50,
    nightVision: 0,             // aucune : la nuit leur est hostile
    weaponRange: 0.55,
    lethality: 0.50,
    armor: 0.30,
    comms: 0.30,

    accuracy: 0.55,
    morale: 0.70,
    cohesion: 0.55,             // ils encaissent mal le feu

    doctrine: 'guerilla',
    hq: false,                  // aucun PC : pas de manœuvre coordonnée
    fortify: 0.10,
    openRange: 0.35,            // n'ouvrent le feu qu'à très courte distance
    breakAfter: 70,             // ne s'attardent jamais dans un accrochage

    roster: {
      garrison: ['infantry', 'infantry', 'anti tank', 'infantry'],
      patrol:   ['infantry', 'infantry motorized'],
      outpost:  ['infantry', 'infantry'],
      reserve:  ['infantry'],
    },
  },

  insurges: {
    key: 'insurges',
    label: 'Insurgés aguerris',
    difficulty: 2,
    summary: 'Combattants entraînés au feu. Armement de guerre, roquettes, mortiers ' +
             'improvisés, quelques postes radio et de rares appareils de vision nocturne. ' +
             'Guérilla organisée, embuscades préparées.',

    count: 1.35,
    optics: 0.70,
    nightVision: 0.15,
    weaponRange: 0.72,
    lethality: 0.70,
    armor: 0.40,
    comms: 0.50,

    accuracy: 0.72,
    morale: 0.82,
    cohesion: 0.70,

    doctrine: 'guerilla',
    hq: true,
    fortify: 0.25,
    openRange: 0.50,
    breakAfter: 110,

    roster: {
      garrison: ['infantry', 'anti tank', 'sniper', 'infantry', 'mortar'],
      patrol:   ['infantry', 'infantry motorized', 'reco'],
      outpost:  ['infantry', 'anti tank'],
      reserve:  ['infantry', 'infantry motorized'],
    },
  },

  paramilitaire: {
    key: 'paramilitaire',
    label: 'Forces paramilitaires',
    difficulty: 3,
    summary: 'Unités encadrées, matériel hétérogène mais sérieux : blindés légers, ' +
             'mortiers, vision nocturne partielle. Tactique hybride — elles tiennent ' +
             'le terrain quand elles le peuvent, se dérobent quand il le faut.',

    count: 1.15,
    optics: 0.88,
    nightVision: 0.45,
    weaponRange: 0.88,
    lethality: 0.85,
    armor: 0.65,
    comms: 0.72,

    accuracy: 0.86,
    morale: 0.90,
    cohesion: 0.85,

    doctrine: 'hybride',
    hq: true,
    fortify: 0.40,
    openRange: 0.72,
    breakAfter: 190,

    roster: {
      garrison: ['infantry', 'anti tank', 'sniper', 'mortar', 'infantry', 'engineer'],
      patrol:   ['reco', 'infantry motorized', 'infantry'],
      outpost:  ['infantry', 'anti tank', 'radio'],
      reserve:  ['infantry', 'mechanized armor'],
    },
  },

  reguliere: {
    key: 'reguliere',
    label: 'Armée régulière',
    difficulty: 4,
    summary: 'Force conventionnelle complète : optiques, vision nocturne, blindés, ' +
             'appui mortier, transmissions fiables, poste de commandement articulé. ' +
             'Défense en profondeur et contre-attaques coordonnées.',

    count: 1.0,
    optics: 1.0,
    nightVision: 0.90,
    weaponRange: 1.0,
    lethality: 1.0,
    armor: 1.0,
    comms: 1.0,

    accuracy: 1.0,
    morale: 1.0,
    cohesion: 1.0,

    doctrine: 'conventionnelle',
    hq: true,
    fortify: 0.55,
    openRange: 1.0,
    breakAfter: 0,              // ils tiennent : pas de désengagement automatique

    roster: {
      garrison: ['infantry', 'infantry', 'anti tank', 'sniper', 'mortar', 'engineer'],
      patrol:   ['reco', 'infantry motorized', 'mechanized armor'],
      outpost:  ['infantry', 'anti tank', 'radio'],
      reserve:  ['mechanized armor', 'infantry'],
    },
  },

  elite: {
    key: 'elite',
    label: 'Unité d’élite',
    difficulty: 5,
    summary: 'Le haut du panier : thermique, optiques de précision, blindage renforcé, ' +
             'transmissions redondantes. Moins nombreux, mais durs au feu, agressifs ' +
             'et parfaitement coordonnés. La nuit ne les gêne pas.',

    count: 0.85,
    optics: 1.28,
    nightVision: 1.0,
    weaponRange: 1.12,
    lethality: 1.20,
    armor: 1.15,
    comms: 1.20,

    accuracy: 1.20,
    morale: 1.10,
    cohesion: 1.25,

    doctrine: 'conventionnelle',
    hq: true,
    fortify: 0.70,
    openRange: 1.0,
    breakAfter: 0,

    roster: {
      garrison: ['sf', 'infantry', 'anti tank', 'sniper', 'mortar', 'sf'],
      patrol:   ['sf', 'reco', 'mechanized armor'],
      outpost:  ['sf', 'anti tank', 'radio'],
      reserve:  ['mechanized armor', 'sf'],
    },
  },
};

export const FORCE_KEYS = Object.keys(FORCES);
export function forceProfile(key) { return FORCES[key] || FORCES.reguliere; }

/**
 * Donne à un élément sa fiche technique propre, dérivée du type de base.
 * On ne touche jamais au catalogue commun : chaque unité reçoit une copie.
 */
export function applyProfile(unit, p) {
  const base = unit.spec;
  const w = { ...base.weapon };
  w.range = Math.max(60, Math.round(w.range * p.weaponRange));
  w.apers = (w.apers || 0) * p.lethality;
  w.aarmor = (w.aarmor || 0) * p.lethality;
  if (w.aair) w.aair *= p.lethality;
  if (w.airRange) w.airRange = Math.round(w.airRange * p.weaponRange);

  unit.spec = {
    ...base,
    weapon: w,
    optics: (base.optics || 1) * p.optics,
    comms: (base.comms || 1) * p.comms,
    signature: base.signature,
    armor: base.armor != null ? Math.min(0.92, base.armor * p.armor) : base.armor,
  };

  unit.profile = p.key;
  unit.doctrine = p.doctrine;
  unit.nightVision = p.nightVision;
  unit.training = p.accuracy;
  unit.cohesion = p.cohesion;
  unit.openRange = p.openRange;
  unit.breakAfter = p.breakAfter;
  unit.morale = Math.min(1, p.morale);
  return unit;
}

// Ce que le renseignement de niveau supérieur annonce au chef de section.
export function briefing(p, world) {
  const night = world.lightLevel < 0.45;
  let s = 'Adversaire attendu : ' + p.label.toLowerCase() + ' (niveau ' + p.difficulty + '/5). ' +
          p.summary;
  if (!p.nightVision) {
    s += night
      ? ' Ils sont dépourvus de vision nocturne : par cette obscurité, l’avantage est franchement de notre côté.'
      : ' Ils sont dépourvus de vision nocturne — une action de nuit leur serait très défavorable.';
  } else if (p.nightVision < 0.5) {
    s += ' Vision nocturne rare dans leurs rangs : la nuit reste à notre avantage.';
  } else if (p.nightVision >= 0.9) {
    s += ' Ils voient de nuit aussi bien que nous : n’attendez aucun avantage de l’obscurité.';
  }
  if (p.doctrine === 'guerilla') {
    s += ' Attendez-vous à des embuscades à courte distance depuis le couvert, ' +
         'suivies de décrochages : ils refuseront le combat décisif.';
  }
  if (!p.hq) s += ' Aucun commandement d’ensemble identifié : ils combattent par petits groupes autonomes.';
  return s;
}

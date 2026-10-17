// Catalogue des ordres. Le joueur donne une mission, jamais un mouvement direct :
// c'est l'IA de l'unité qui décide de l'itinéraire, des postures et du feu.

export const ORDERS = {
  MOUVEMENT: {
    label: 'Se porter sur', short: 'MOUV', key: 'M', needs: 'route', color: '#8fd0ff',
    icon: 'waypoint point', posture: 'normal',
    hint: 'Rejoindre un point par le meilleur itinéraire. Clic pour chaque point de passage, clic droit pour valider.',
  },
  ATTAQUER: {
    label: 'Attaquer', short: 'ATT', key: 'A', needs: 'route', color: '#ff6b5e',
    icon: 'destroy target point', posture: 'tactical',
    hint: 'Progresser vers l’objectif, fixer puis réduire toute résistance rencontrée.',
  },
  DEFENDRE: {
    label: 'Défendre', short: 'DEF', key: 'D', needs: 'zone', color: '#5eb7ff',
    icon: 'firing point', posture: 'tactical', radius: 120,
    hint: 'Tenir la zone : recherche d’un point d’appui, mise en batterie, interdiction des approches.',
  },
  GARDER: {
    label: 'Garder', short: 'GARD', key: 'G', needs: 'zone', color: '#7fe0c0',
    icon: 'checkpoint point', posture: 'tactical', radius: 150,
    hint: 'Surveiller et contrôler la zone, intercepter les intrusions sans s’en éloigner.',
  },
  PATROUILLER: {
    label: 'Patrouiller', short: 'PATR', key: 'P', needs: 'route', color: '#ffd45e',
    icon: 'waypoint point', posture: 'tactical', loop: true,
    hint: 'Boucler un itinéraire de patrouille en rendant compte de tout contact.',
  },
  RECHERCHE: {
    label: 'Recherche et destruction', short: 'R&D', key: 'R', needs: 'zone', color: '#ff9d5e',
    icon: 'survey control point', posture: 'tactical', radius: 250,
    hint: 'Ratisser la zone, fouiller le bâti, détruire tout élément ennemi trouvé.',
  },
  FORTIFIER: {
    label: 'Fortifier', short: 'FORT', key: 'F', needs: 'zone', color: '#c0a878',
    icon: 'structure bunker', posture: 'tactical', radius: 60,
    hint: 'Organiser le terrain : creusement, masques, champs de tir. Immobilise l’unité.',
  },
  RENFORCER: {
    label: 'Renforcer', short: 'RENF', key: 'E', needs: 'unit', color: '#b0ff7f',
    icon: 'rendezvous point', posture: 'normal',
    hint: 'Rejoindre un élément ami et se placer sous son dispositif.',
  },
  SOUTENIR: {
    label: 'Soutenir', short: 'SOUT', key: 'S', needs: 'unit', color: '#d59dff',
    icon: 'coordination point', posture: 'tactical',
    hint: 'Appuyer par le feu un élément ami : se poster à portée et traiter ses contacts.',
  },
  REARMER: {
    label: 'Réarmer', short: 'REAR', key: 'W', needs: 'auto', color: '#9fe07f',
    icon: 'rearm point', posture: 'normal',
    hint: 'Rejoindre le point de ravitaillement le plus proche et compléter les dotations.',
  },
  SOIGNER: {
    label: 'Soigner', short: 'SOIN', key: 'H', needs: 'auto', color: '#ff9fc0',
    icon: 'casualty collect point', posture: 'normal',
    hint: 'Équipe sanitaire : rejoindre les blessés et les traiter. Autre unité : évacuer vers le point de regroupement.',
  },
  PASSE: {
    label: 'Passe de tir', short: 'PASSE', key: 'T', needs: 'route', color: '#ff7a4a',
    icon: 'destroy target point', posture: 'normal', air: true,
    hint: 'Aéronefs : traiter un objectif par passes successives. Premier clic l’objectif, ' +
          'second clic le point d’où vous voulez que l’appareil arrive (axe de pénétration).',
  },
  EMBARQUER: {
    label: 'Embarquer', short: 'EMB', key: 'B', needs: 'unit', color: '#ffffff',
    icon: 'passage point', posture: 'normal',
    hint: 'Monter à bord d’un véhicule ami disposant de places libres.',
  },
  DEBARQUER: {
    label: 'Débarquer', short: 'DEB', key: 'N', needs: 'auto', color: '#ffffff',
    icon: 'start point', posture: 'normal',
    hint: 'Mettre pied à terre sur place.',
  },
};

export const ORDER_KEYS = Object.keys(ORDERS);

export function makeOrder(type, opts = {}) {
  const spec = ORDERS[type];
  return {
    type,
    waypoints: opts.waypoints || [],
    wpIndex: 0,
    target: opts.target || null,          // {x,y}
    targetUnit: opts.targetUnit || null,  // id
    radius: opts.radius || spec.radius || 0,
    armament: opts.armament || 'both',     // canon, missile, ou les deux
    passes: opts.passes || 3,
    passDone: 0,
    posture: opts.posture || spec.posture || 'normal',
    roe: opts.roe || null,
    loop: opts.loop != null ? opts.loop : !!spec.loop,
    phase: 'init',
    since: 0,
    memo: {},
    done: false,
  };
}

// Résumé lisible affiché dans le panneau et sur la carte.
export function describeOrder(order, world) {
  if (!order) return 'Sans ordre';
  const spec = ORDERS[order.type];
  let s = spec.label;
  if (order.targetUnit != null) {
    const u = world && world.byId.get(order.targetUnit);
    if (u) s += ' ' + u.callsign;
  } else if (order.waypoints.length > 1) {
    s += ' — ' + order.waypoints.length + ' points';
  }
  const phase = PHASE_FR[order.phase];
  return phase ? s + ' (' + phase + ')' : s;
}

export const PHASE_FR = {
  init: 'mise en route',
  move: 'en mouvement',
  approach: 'approche',
  bound: 'bond',
  fix: 'au contact',
  assault: 'assaut',
  consolidate: 'consolidation',
  hold: 'en position',
  dig: 'organisation du terrain',
  search: 'ratissage',
  clear: 'fouille de bâtiment',
  overwatch: 'surveillance',
  ingress: 'ralliement du point initial',
  finale: 'en finale',
  egress: 'dégagement',
  support: 'en appui',
  resupply: 'ravitaillement',
  treat: 'soins',
  mount: 'embarquement',
  dismount: 'débarquement',
  wait: 'en attente',
  done: 'exécuté',
};

# PC TACTIQUE

Simulation de commandement, à la première personne. Vous êtes le chef de section, debout dans
votre tente, et vous vous y déplacez librement : deux tables dressées le long du fond, l'écran
de situation au centre, le râtelier des postes radio sur la droite. Aucune ouverture vers
l'extérieur — tout ce qui se passe dehors n'arrive que par la radio.

Vous ne pilotez aucun soldat directement : vous donnez des **missions**, et l'IA de chaque
élément se débrouille sur le terrain — itinéraire, posture, points d'appui, feu.

La carte est le monde réel : routes, bâtiments, forêts, cours d'eau et relief sont téléchargés
depuis OpenStreetMap et les tuiles d'élévation pour la zone que vous choisissez.

## Lancer le jeu

Double-cliquez sur **`Lancer le jeu.bat`**. Un serveur local démarre et le navigateur s'ouvre
sur `http://localhost:8123`.

Le jeu doit être servi par un serveur (les modules JavaScript et le chargement des icônes
échouent en `file://`). Si le `.bat` ne marche pas, dans un terminal ouvert sur ce dossier :

```bash
python -m http.server 8123
```

Une connexion internet est nécessaire : fond de carte, données OSM et relief.

## Mise en place

Cherchez un lieu, ou cliquez sur la carte pour placer le centre de la zone d'opération.
Réglez le côté de la zone (**1,5 à 20 km**), le **profil de la force adverse**, les
conditions (météo et heure locales réelles, ou vos propres réglages), les moyens aériens,
le nombre d'éléments ennemis et de groupes de civils, puis **Déployer la section**.

La résolution du terrain s'adapte à l'étendue : 10 m jusqu'à 6 km de côté, 15 m jusqu'à
12 km, 20 m au-delà. Une grille de 20 km tient ainsi dans 1 million de cellules et tourne
à plus de 500 fois le temps réel.

| Côté | Résolution | Chargement observé |
|---|---|---|
| 2–3 km | 10 m | quelques secondes |
| 8 km | 15 m | ~15 s |
| 12 km | 15 m | ~20 s |
| 20 km | 20 m | ~20 s (zone rurale), plusieurs minutes en plein tissu urbain |

Sur 20 km, l'infanterie met des heures à traverser la zone : les véhicules et surtout les
hélicoptères de manœuvre deviennent indispensables. C'est le principe des grandes opérations.

### Choisir l'implantation de son PC

Case **Implantation du PC → choisir moi-même l'emplacement**, à la mise en place.

Une fois le terrain chargé, la carte s'ouvre sur la zone entière avec l'objectif marqué,
**avant tout déploiement**. Vous cliquez où installer votre poste de commandement ; l'aperçu
vous dit en direct si l'emplacement tient :

- vert, « PC ZULU ici », avec la distance à l'objectif quand c'est bon ;
- rouge et le motif du refus sinon — *dans un bâtiment*, *dans l'eau*, *trop près du bord de
  la zone*, ou *trop près de l'objectif*. Le minimum est le quart du côté de la zone, avec un
  plancher de 600 m, matérialisé par un cercle autour de l'objectif.

Clic droit ou `Échap` reprend l'implantation proposée d'office.

Le reste du dispositif se construit **ensuite**, autour de votre choix : la section, la FARP,
et surtout les zones d'apparition adverses, qui s'écartent de votre PC où que vous l'ayez posé.
L'emplacement retenu est ajusté de quelques dizaines de mètres si nécessaire pour tomber sur un
terrain praticable.

## Sous la tente

Vous êtes debout sous la toile et vous vous y déplacez comme dans n'importe quel jeu à la
première personne. Il n'y a **aucune ouverture vers l'extérieur** : tout ce qui se passe
dehors n'entre que par la radio, et seulement si le poste correspondant est allumé.

| | |
|---|---|
| **Cliquez dans la tente** | La souris passe sous votre main et pilote le regard. **Échap** la relâche. |
| **ZQSD** ou **WASD** | Marcher. Les flèches marchent aussi, **Maj** presse le pas. |
| **Souris** | Regarder autour de soi. |
| **E** ou **clic** | S'installer au poste visé par le réticule. |
| **Échap** | Se relever du poste. |

Vous ne traversez ni les tables ni la toile, et vous longez un obstacle plutôt que de vous y
arrêter. Le pas se balance légèrement — vous marchez, vous ne glissez pas.

Deux postes vous attendent, dressés le long du fond :

| | |
|---|---|
| **Table de situation**, au centre | L'écran où vit la carte : ordre de bataille, ordres, journal, combat. |
| **Table des transmissions**, à droite | Six postes radio, un par réseau, et la main courante. |

Approchez-vous, visez, appuyez sur **E** : vous vous installez au poste et la souris vous est
rendue. À la carte, l'interface occupe alors toute la vue — c'est exactement l'interface
habituelle, rien n'a été retiré, et elle tombe **au pixel près** : elle n'est ni redessinée
ni remise à l'échelle, c'est la distance de travail qui la fait coïncider. **Échap** ou le
bouton **◀ Tente** vous relève. Si un ordre est en cours de saisie, Échap l'annule d'abord :
on ne quitte pas l'écran par mégarde au milieu d'une mission de tir.

De loin, l'écran n'est pas cliquable — c'est un objet de la pièce, et le viser suffit à s'en
approcher. La simulation, elle, ne s'arrête jamais : pendant que vous traversez la tente pour
aller couper un poste, la section manœuvre.

### Votre corps

Vous avez un corps, en tenue **NWU en AOR2** : treillis au motif numérique, gilet
porte-plaques, gants, rangers, casque. En première personne il est privé de tête — vous la
verriez de l'intérieur — mais vous voyez vos jambes en baissant les yeux, et vos bras
balancer quand vous marchez.

C'est un vrai squelette articulé : quatorze os, chacun tournant sur son point d'attache, et
les volumes accrochés dessus. Faire pivoter l'épaule emmène le bras, qui emmène
l'avant-bras. La marche en découle au lieu d'être dessinée :

| | bassin | hanches | genoux | épaule |
|---|---|---|---|---|
| **arrêt** | 92 cm | 0° | 0° | 0° |
| **marche** | 89 cm | −22° / +22° | 29° / 0° | +17° |
| **demi-cycle plus tard** | 90 cm | +17° / −17° | 0° / 10° | −13° |
| **assis** | 52 cm | −84° | +86° | −22° |

Les hanches vont en opposition, le genou ne plie que du côté qui se lève, l'épaule contrarie
la hanche, et le bassin monte et descend au rythme du pas. S'installer à un poste fait
descendre le bassin de 92 à 52 cm, cuisses à l'horizontale et avant-bras sur la table.

Le motif AOR2 n'est pas une image : il est **fabriqué au chargement**, en SVG, comme un vrai
camouflage numérique — quatre valeurs, des taches de quelques carrés jetées sur un fond, aux
bords dentelés. Le tirage est reproductible, donc tous les corps portent la même tenue.

> Le module [`avatar.js`](src/render/avatar.js) ne connaît ni la caméra ni le jeu : on lui
> donne une position, un cap et une allure, et il se tient. C'est ce qui le rendra utilisable
> tel quel pour un deuxième joueur — `new Avatar()`, `place()`, `anime()`, rien de plus.

### Tout reste net, de près comme de loin

Un panneau posé en 3D est rendu à la taille où il est écrit, puis agrandi par la perspective
quand on s'en approche : écrit petit, il se brouille dès qu'on y met le nez. La règle tenue
ici est donc simple — **chaque panneau est écrit à la définition qu'il aura au plus près
qu'on puisse l'approcher**, puis réduit d'autant pour tenir sa place dans la pièce. Il n'est
alors jamais agrandi au-delà de sa propre définition.

| Panneau | Écrit à | Au plus près |
|---|---|---|
| Râtelier des postes | 1 980 px | 0,74× |
| Tableau de dotation | 2 280 px | 0,95× |
| Carte murale IGN | 1 680 px (48 tuiles) | 0,92× |
| Écran de situation | taille de la fenêtre | 1,00× — et pixel pour pixel une fois installé |

Cette règle ne suffit pourtant pas pour ce qui se lit vraiment : le moteur rend un panneau à
l'échelle où il est **écrit dans la pièce** — quelques centimètres — puis la perspective
l'agrandit d'un facteur dix quand on s'en approche. Aucune définition de mise en page n'y
change quoi que ce soit. **Les panneaux qu'on consulte sortent donc du volume** : viser la
carte murale ou le tableau et appuyer sur **E** les pose à plat devant l'œil, où ils ne sont
que réduits, jamais grossis — 0,34× à 0,70× selon le panneau. **Échap** les repose.

La distance de travail de l'écran découle de sa largeur : le moniteur mesure 104 cm précisément
pour que cette distance tombe en deçà de ce qu'on peut atteindre en marchant. Aucune position
de la tente ne peut donc l'agrandir.

> La pièce est construite en CSS 3D, pas en WebGL, et ce choix commande tout le reste : les
> parois, les tables et les écrans sont de vrais éléments du document. L'écran de situation
> n'est donc pas une image de la carte, c'est la carte ; les postes radio ne sont pas des
> dessins de postes, ce sont les commandes.

### Le parti pris graphique

La tente est traitée comme **une planche de bande dessinée**, pas comme une image de synthèse.

- **Des aplats, pas des dégradés.** Chaque surface tient en deux ou trois valeurs à bords
  francs — la lumière tombe d'un coup, comme au pinceau.
- **Un cerne à l'encre** sur chaque face. Le trait est fixé en centimètres, pas en pixels :
  il s'épaissit donc naturellement quand on s'approche, comme un trait dessiné. Il est aussi
  proportionné à ce qu'il cerne — un cerne fixe dévorait un pied de table large de quatre
  centimètres et donnait à tout le mobilier l'air d'être monté de travers.
- **Des hachures** dans les creux et sous les objets, une trame de points sur le sol, et le
  **grain du papier** posé sur toute la vue en fondu multiplié. Le cerne s'efface dès qu'on
  s'installe à un poste : on regarde alors un écran, plus une case.
- **Trois familles de teintes** seulement — la toile, le bois, le métal — plus l'or de la
  baladeuse. Un jeu de couleurs restreint tient la planche.

### Le décor

Un poste de commandement n'est pas une pièce vide. Sont posés là, et vous les contournez :
caisses de matériel empilées et marquées au pochoir, bidons de carburant, paquetages, merlon
de sacs de sable contre la toile, sièges de campagne écartés des tables, coffret d'alimentation
et ses câbles plaqués au sol, descente d'antenne le long de la paroi, casque et gobelet sur la
table de situation, thermos et boîte de piles sur celle des transmissions, goussets de
charpente entre les mâts et les rampants — et, punaisés à la toile, un tableau de service, une
affiche, et la carte murale. Ce sont les seules images du dehors qui entrent ici.

### La carte au mur

La feuille punaisée à gauche n'est pas un décor : c'est le **Plan IGN de votre zone
d'opération**, chargé pour les coordonnées que vous avez choisies au déploiement, avec
**l'objectif cerné au crayon gras**. Le niveau de zoom est réglé pour montrer un peu plus que
le terrain joué — au mur, on veut justement voir ce qu'il y a autour.

Les tuiles viennent de la Géoplateforme de l'IGN, sans clé d'accès. Le SCAN 25 en demande une,
d'où le Plan IGN v2. **Hors de France métropolitaine et de la Corse, l'IGN ne couvre pas** :
la carte murale bascule alors sur le fond OpenStreetMap, plutôt que d'accrocher une feuille
blanche au mur, et le cartouche l'indique.

### Les postes radio

Deux familles, réparties selon ce que chaque réseau demande :

| Poste | Type | Réseaux | Bande |
|---|---|---|---|
| **AN/PRC-117G** | poste de sac, combiné déporté | commandement, 3D | 30 – 2 000 MHz |
| **AN/PRC-152A** | portatif de combat, antenne fouet | manœuvre, appui, logistique, renseignement | 30 – 512 MHz |

Le poste de sac tient le commandement et la 3D : longue distance et bande large. Les quatre
portatifs tiennent les réseaux de contact.

Chacun est dessiné d'après le matériel : le **117G** est un coffret couché — écran au centre
sous la marque, GPS et USB/KDU à gauche, rotacteur OFF/CT/PT/LD/Z à droite, HB et LB ANT,
AUDIO et SATCOM, clavier à cinq colonnes, poignées de portage sur les flancs. Le **152A** est
un portatif debout — antenne fouet, grille de haut-parleur, bandeau *WIDEBAND NETWORKING*,
écran, clavier, et la batterie qui déborde en pied avec son étiquette.

Sur chaque poste :

- **L'interrupteur** coupe ou rallume l'écoute.
- **Le bouton rotatif** règle le volume — molette, glisser vers le haut, ou les flèches
  quand il a le focus. Il commande le bip de prise de ligne *et* la voix de l'homme qui parle.
- **L'écran** affiche la fréquence, le réseau, et le dernier message entendu.

### Le poste s'allume quand on y parle

Au repos, écran et clavier sont **éteints** : verts sombres, à peine lisibles — c'est l'état
d'un poste en veille. Dès que quelqu'un prend la parole sur le réseau, le **rétroéclairage
s'allume** : la dalle passe au vert clair avec le texte en négatif, les légendes des touches
virent au vert vif avec leur halo, et le poste se cerne de la couleur de son réseau.

Il reste allumé **le temps que dure le message** — la durée est tirée de la longueur du texte,
pas d'un délai fixe. D'un coup d'œil sur la table, on sait donc quel réseau est en train de
parler, même en travaillant à la carte. Un poste coupé, lui, ne s'allume jamais.

Et **couper un poste éteint son écran, pas le poste** : la dalle devient noire et n'affiche
plus rien, mais le boîtier reste ce qu'il est sur la table. Ce qui était sérigraphié dessus —
réseau et fréquence — se lit toujours, et un repère rouge compte le trafic manqué : **▲ 3**.
Sans quoi couper une radio la ferait disparaître de l'attention en même temps que de l'écoute.

### Le tableau de dotation

Punaisé à la toile au-dessus de la table des transmissions, il répond à la seule question
qu'on se pose devant six postes : **qui est sur quoi**.

| IND. | RÔLE | RÉS. | FRÉQUENCE |
|---|---|---|---|
| ALPHA | PC 5 pax | CDT | 31.250 |
| BRAVO | infanterie 8 pax | MAN | 44.775 |
| ECHO | reconnaissance 4 pax | RECO | 61.925 |
| NOVEMBER | hélicoptère d’attaque | AIR | 122.750 |

Chaque réseau y porte sa couleur, celle de son poste et de ses traces sur la carte. Le tableau
**se refait tout seul** quand l'ordre de bataille change : un élément détruit en disparaît, et
l'interligne se resserre pour que la section tienne entière sur la feuille, moyens aériens
compris. Rien à cliquer : on s'en approche et on lit.

### Un poste coupé perd son trafic

C'est le point important, et c'est un vrai choix de chef : **couper un poste ne baisse pas
le son, il vous retire l'information**. Le message est passé, personne ne l'a pris.

- Rien n'est joué : ni bip, ni voix.
- Le compteur du poste monte, et la main courante affiche le total perdu.
- Le journal du PC en garde la trace — l'heure et le réseau — mais **jamais le contenu** :
  *« — trafic non reçu, poste coupé — »*.
- Rallumer le poste remet le compteur à zéro. Ce qui est passé est passé.

Baisser le volume, en revanche, ne perd rien : le message arrive, il s'entend seulement moins.

La **main courante** posée à côté du râtelier récapitule les derniers passages effectivement
entendus, tous réseaux confondus, avec l'heure et le réseau d'origine.

## Ce que vous commandez

Une section renforcée : groupe de commandement (ALPHA), trois groupes de combat
(BRAVO, CHARLIE, DELTA), une équipe de reconnaissance (ECHO), une équipe antichar (FOXTROT),
une pièce de mortier (GOLF), une équipe sanitaire (HOTEL), deux VTT (KILO 1 et 2),
un blindé (LIMA) et un véhicule relais radio (MIKE).

L'infanterie apparaît en **groupes**, les véhicules en **unités individuelles**.

### La composante aérienne

Sur le **réseau 3D** (122,750 MHz), séparé des réseaux terrestres :

| Indicatif | Appareil | Emploi |
|---|---|---|
| NOVEMBER | Hélicoptère d'attaque | Antichar et appui feu, stationnaire de tir à ~2,5 km, 2 h 30 d'autonomie |
| OSCAR | Hélicoptère de manœuvre | 14 places, se pose pour embarquer et débarquer, 3 h d'autonomie |
| PAPA | Avion d'appui | Orbite l'objectif à 750 km/h, frappe lourde, 1 h 30 d'autonomie |
| QUEBEC | Avion de reconnaissance | Observation à 950 m sol, voit par-dessus tout le relief, 6 h d'autonomie |

**Les voilures fixes exigent une vraie piste.** Le jeu lit les données aéronautiques
d'OpenStreetMap (`aeroway`) et relève les aérodromes, pistes et hélistations de la zone.
PAPA n'est mis en ligne que s'il existe une piste d'au moins 800 m, QUEBEC à partir de
600 m. Sans terrain suffisant, ils ne sont tout simplement pas proposés, et le briefing
initial vous dit pourquoi. Les voilures tournantes, elles, opèrent depuis une plateforme
sommaire (**FARP ROMEO**) montée près du PC : elles sont toujours disponibles.

Les pistes, taxiways et aires de trafic détectés sont rastérisés en surface dure : vos
véhicules peuvent y rouler.

### Ce qui vole se comporte comme tel

- Vol direct : ni relief ni bâti ne contraignent une trajectoire aérienne.
- Un aéronef **ne se plaque pas au sol et ne cherche pas de couvert**. Sous le feu, soit il
  tient sa mission, soit il rompt le contact et rentre se faire remettre en œuvre.
- Le carburant est décompté : sous 16 %, l'appareil **rompt la mission de lui-même** et
  rentre à sa base. Il repart quand il est ravitaillé.
- Un hélicoptère de manœuvre **se pose** pour embarquer comme pour débarquer, et il choisit
  une aire praticable — jamais dans l'eau, le bâti ou le sous-bois.
- Le ciel n'est pas un sanctuaire : les équipes antichar servent aussi le missile sol-air
  très courte portée (3,5 km), les blindés tirent en l'air à 2 km, et l'infanterie peut
  toucher au petit calibre. La vitesse et l'altitude restent la meilleure protection.

> **Note sur les symboles.** Votre collection d'icônes ne contient aucun symbole aérien : ils
> sont donc dessinés à la volée au standard APP-6, cadre ouvert vers le bas — arche pour un
> ami, pointe pour un hostile, trèfle pour un inconnu, carré pour un neutre — avec un glyphe
> rotor ou voilure fixe et une lettre de fonction. Si vous déposez plus tard de vraies images
> nommées `attack helicopter.png`, `attack helicopter hostile.png`, etc. dans `icones/` puis
> relancez `node tools/build-icons.mjs`, elles prendront automatiquement le dessus.

## Donner un ordre

1. Sélectionnez un élément (clic sur la carte, ou dans l'ordre de bataille à gauche).
   `Ctrl`/`Maj` + clic pour une sélection multiple, `Ctrl+A` pour tout sélectionner.
2. Cliquez sur une mission dans le panneau de droite, ou tapez sa lettre.
3. Désignez l'objectif sur la carte selon la mission :
   - **itinéraire** : clic gauche pour chaque point de passage, clic droit ou `Entrée` pour valider
   - **zone** : clic gauche pour le centre, molette pour le rayon
   - **élément** : clic gauche sur l'unité amie concernée

`Échap` annule la saisie. Clic droit sans mission en cours = se porter sur ce point.
`Suppr` annule l'ordre en cours.

### Les missions

| Touche | Mission | Comportement |
|---|---|---|
| `M` | Se porter sur | Rejoindre par le meilleur itinéraire |
| `A` | Attaquer | Progresser, fixer au contact, réduire par bonds, consolider sur l'objectif |
| `D` | Défendre | Chercher un point d'appui dans la zone, s'organiser, interdire les approches |
| `G` | Garder | Surveiller la zone, intercepter les intrusions sans s'en éloigner |
| `P` | Patrouiller | Boucler un itinéraire, halte au contact et compte rendu |
| `R` | Recherche et destruction | Ratisser la zone, fouiller le bâti, détruire ce qui est trouvé |
| `F` | Fortifier | Organiser le terrain sur place — immobilise l'élément |
| `E` | Renforcer | Rejoindre un élément ami, partager les munitions, raffermir |
| `S` | Soutenir | Se poster à portée d'appui et traiter les contacts de l'élément soutenu |
| `W` | Réarmer | Rejoindre le point de ravitaillement le plus proche et compléter les dotations |
| `H` | Soigner | Équipe sanitaire : traiter les blessés. Autre élément : évacuer vers l'arrière |
| `T` | Passe de tir | **Aéronefs seulement** : traiter un objectif par passes successives sur un axe imposé |
| `B` | Embarquer | Monter dans un véhicule ami s'il reste des places |
| `N` | Débarquer | Mettre pied à terre |

On règle aussi l'**allure** (course, normal, tactique, furtif, au sol), les **règles
d'engagement** (feu à volonté, riposte seule, feu interdit) et le **réseau radio** de chaque élément.

`Espace` met en pause, `1` `2` `3` `4` règlent la vitesse ×1 à ×8.

### La grille de coordonnées

Case **Grille** en haut à droite. Carroyage kilométrique calé sur le repère local, avec les
amorces à deux chiffres en bord de vue, comme sur une carte d'état-major. Les subdivisions
de 100 m apparaissent une fois zoomé au-delà de 1,2 m par pixel. Les références lues sous le
curseur, en bas à gauche, suivent le même carroyage.

### Lisibilité de la carte

Le niveau de détail des étiquettes suit le zoom : de loin seul l'indicatif s'affiche,
de près s'y ajoutent la fréquence, le réseau, l'état et les jauges. Les étiquettes qui
se chevaucheraient sont décalées automatiquement. **L'élément sélectionné garde toujours
sa fiche complète**, quelle que soit l'échelle — c'est le moyen de lire le détail sans
avoir à zoomer.

## Le comportement au feu

Vos hommes n'exécutent pas la mission les yeux fermés. Une couche réflexe s'intercale
entre l'ordre reçu et son exécution : elle peut simplement moduler la conduite (allure,
interdiction d'avancer) ou suspendre complètement la mission.

| État | Ce qui se passe |
|---|---|
| **ALERTE** | Contact dans le secteur : l'élément poursuit sa mission mais passe à l'allure tactique. |
| **GAGNE LE COUVERT** | Pris sous le feu à découvert : bond court vers le meilleur couvert immédiat. |
| **FIXÉ** | Fixé par le feu : **la progression s'arrête**, l'élément riposte sur place, face à la menace. |
| **CLOUÉ** | Sous un feu écrasant : plaqué au sol, riposte symbolique, aucun mouvement possible. |
| **REPLI** | Position intenable : décrochage délibéré vers un point défilé, sous protection de son propre feu. |
| **DÉROUTE** | Le moral a lâché : l'élément fuit vers l'arrière, hors de tout contrôle, feu interdit. |
| **RECONSTITUTION** | À l'abri : remise en ordre, moral qui remonte, blessés légers pris en compte. |

L'état apparaît sous l'icône, dans la fiche de l'élément et **en orange dans l'ordre de
bataille** dès qu'il sort de l'ordinaire.

### Ce qui déclenche un repli

La décision mûrit sur la durée de l'accrochage, pas sur un coup de feu isolé : plus de
munitions, trop de pertes, personnel à bout, ou rapport de force local défavorable. Le
rapport de force tient compte des amis à portée, donc un élément soutenu tient bien plus
longtemps qu'un élément isolé.

La **ténacité** dépend de la mission : un groupe en *Défendre* ou *Fortifier* s'accroche
presque deux fois plus qu'un groupe en *Se porter sur*, et un élément retranché
(organisation du terrain élevée, ou dans un bâtiment) ne lâche presque jamais.

### Le rendu de mission

Un élément reconditionné mais toujours laminé ne repart pas se faire étriller : il **rend
sa mission au PC** et tient sa position en attendant vos instructions —
*« Reconditionné mais hors d'état de poursuivre (il me reste 3 hommes sur 8). Je rends la
mission et tiens ma position, demande instructions. »*

À vous de le réarmer, de le faire soigner, de le renforcer, ou de lui donner une mission
à sa mesure.

## Le son

Bouton **Son** et volume en haut à droite. Tout est synthétisé : aucun fichier à charger.
Le navigateur n'autorise le son qu'après un premier clic dans la page.

- **Bip de prise de parole** en tête de chaque message radio. La tonalité change selon le
  réseau — on reconnaît le net à l'oreille sans lire le journal. Une liaison dégradée
  s'entend : le souffle de squelch s'allonge.
- **Départs de coup**, distincts selon l'arme : coup isolé, rafale, canon de blindé,
  départ de mortier. Le volume et le timbre suivent la distance au centre de la vue —
  un tir lointain n'est qu'un claquement sourd — avec panoramique stéréo. On entend le
  combat là où on regarde.
- **Roulement des moteurs** des véhicules proches, dont le régime suit leur vitesse.

### Les voix de vos hommes

Case **Voix** dans la barre du haut. La synthèse vocale du navigateur lit les comptes rendus
à la procédure :

> *« Zoulou de Bravo, contact identifié : infanterie, 8 personnels, azimut trois zéro zéro,
> 80 mètres. Terminé. »*

- **On s'identifie.** L'appel s'ouvre sur le destinataire, « de », puis l'émetteur —
  « Zoulou de Bravo », Zoulou étant le PC. L'indicatif seul suffit : ni nature ni effectif
  ne sont répétés à chaque transmission. Un message vital s'annonce « message urgent », et
  la transmission se ferme sur « Terminé », ou « À vous » quand une réponse est attendue.
- **Ce sont des voix d'homme.** Le moteur du navigateur n'indique pas le sexe d'une voix : on
  écarte les prénoms féminins connus des synthèses installées (Hortense, Julie, Amélie…) et
  on retient les masculins (Paul, Thomas, Nicolas…). Faute de voix masculine, ce qui reste
  est descendu d'une octave environ.
- **Chaque indicatif a son timbre.** Hauteur et débit sont échelonnés en paliers nets —
  neuf hauteurs dans le registre grave, cinq débits — et l'empreinte du nom ne sert que de
  point de départ : si la case est prise, on passe à la suivante. Aucun élément ne parle
  donc exactement comme un autre, et l'attribution reste stable toute la partie : on
  reconnaît BRAVO à l'oreille sans lire le journal.

  > La plupart des postes Windows n'ont qu'une seule voix d'homme française (Paul). La
  > distinction vient alors du timbre et du rythme, pas de locuteurs différents. Installer
  > d'autres voix françaises dans *Paramètres › Heure et langue › Voix* les fait prendre en
  > compte automatiquement, sans rien changer au jeu.
- **Le texte est mis en forme pour être dit**, pas lu : « 8 pax, az 300, 80 m » devient
  « 8 personnels, azimut trois zéro zéro, 80 mètres » — les gisements s'épellent chiffre par
  chiffre, comme sur un vrai réseau. Le PC parle en clair, et vos propres ordres ne sont
  pas relus à voix haute.
- **La liaison s'entend.** Un souffle de porteuse monte pendant le message, d'autant plus fort
  que la liaison est mauvaise, et la voix baisse et s'accélère. La mention technique
  « [liaison dégradée] » du journal écrit devient une dégradation sonore.
- **Le réseau ne déborde pas.** File de trois messages au plus, un compte rendu important
  chasse un moindre. À ×2 les routines se taisent, à ×4 et au-delà seuls les comptes rendus
  vitaux — pertes, prises à partie, ruptures de mission — sont lus.

Si le navigateur n'a pas de synthèse vocale, la case est simplement désactivée.


## Lire le combat

Trois choses répondent à la question « qui tire sur qui, et où en sont les pertes ».

### Sur la carte

- **Traits de feu** : halo large et cœur clair, épaisseur selon l'arme, bleu pour vous,
  rouge pour l'adverse. Un trait n'est tracé **que si le tireur vous est connu** : quand un
  élément encaisse d'un ennemi non repéré, seul l'impact apparaît — c'est exactement
  l'information dont dispose le chef.
- **Missiles** : on les voit voler. Position interpolée, fumée derrière, point lumineux en
  tête — à la différence du tir tendu, qui n'est qu'un éclair.
- **Impacts** : cercle qui s'ouvre au but, plus large pour le gros calibre.
- **Hommes tombés** : une croix rouge (tué) ou orange (blessé) reste 45 secondes à
  l'endroit exact. C'est le repère qui montre où la section prend.
- **Réticule** : l'élément sélectionné a sa cible entourée d'un réticule, avec la liaison
  tireur → but.

### Dans le journal radio

Le combat s'entend avant de se voir :

```
LIMA    | J'ouvre le feu sur infanterie, azimut 217, 860 m.
QUEBEC  | 1 homme touché. Bilan : 0 tué, 1 blessé, il reste 2 sur 2.
BRAVO   | Nous sommes pris à partie, azimut approximatif 143, origine non identifiée.
CHARLIE | Position intenable (trop de pertes), je décroche et me reconstitue.
```

Les comptes rendus vitaux — pertes, prise à partie, rupture de mission, munitions —
passent **toujours**, même quand la radio est chargée. Les routines, elles, sont espacées.

### Dans l'onglet ⚔ Combat

En bas à gauche, un tableau de situation rafraîchi en continu :

- **Bilan** : effectif ami, tués, blessés, éléments perdus, et **pertes ennemies
  constatées** — le nombre d'hommes que vos éléments ont *vu* tomber, pas un décompte
  omniscient. Vous ne savez que ce qui vous a été rapporté.
- **Engagements en cours** : par élément, son état, ce qu'il engage (`▶`) ou s'il est sous
  le feu (`◀`), la distance, l'effectif restant avec ses pertes, les coups tirés, et sa
  barre de suppression.
- **Situation ennemie connue** : chaque contact, son volume estimé, quel élément le traite,
  la fraîcheur de l'information et qui l'a rapporté.

La fiche de chaque élément liste aussi ses **tirs effectués** : arme, cible, volume, ancienneté.

## Les missions de tir aériennes

`T` — réservé aux aéronefs. Deux clics :

1. **l'objectif** ;
2. **le point d'où vous voulez que l'appareil arrive** — c'est lui qui fixe l'axe de
   pénétration.

Choisissez l'armement dans le panneau de droite : **Canon**, **Missiles**, ou **Les deux**.
Chaque système a sa portée, sa cadence, sa létalité et sa consommation propres — le canon
crache vite et près, le missile frappe loin et fort mais compte ses coups.

L'appareil rallie alors un **point initial** placé sur l'axe demandé, se présente en finale,
traite l'objectif, dégage en écharpe, et recommence. Trois passes par défaut, ou jusqu'à
épuisement de l'armement.

```
NOVEMBER | Mission de tir acceptée : 3 passe(s) au missile, axe de pénétration 45.
NOVEMBER | En finale sur l'objectif, axe 45.
NOVEMBER | Passe 1 effectuée, je dégage.
NOVEMBER | Mission de tir terminée, 3 passe(s) effectuée(s). Je dégage.
```

L'axe est tracé sur la carte : une flèche entrant sur l'objectif, avec son gisement.
Si l'objectif est trop près d'un bord, la pénétration est raccourcie pour rester dans la zone.

## Le vol

Un aéronef ne se téléporte pas vers son but.

- **Inertie** : accélération et décélération limitées. Un hélicoptère met une vingtaine de
  secondes pour passer de l'arrêt à 240 km/h, et autant pour revenir au stationnaire.
- **Virage à taux limité**, d'autant plus large que la vitesse est élevée : environ 3°/s
  pour un avion d'appui à 620 km/h. Il ne fait pas demi-tour sur place.
- **Vitesse de décrochage** : une voilure fixe ne descend jamais sous 223 km/h — d'où les
  orbites plutôt que le stationnaire.
- **Hauteur comptée au-dessus du sol** : l'allure fixe le profil. En *Tactique*, un
  hélicoptère suit le relief à 35 m et se masque derrière une crête ; en *Course*, il monte
  à 140 m et va plus vite mais se voit de loin. Un avion passe de 320 m à 1100 m selon l'allure.
- **Poser progressif** : l'appareil réduit, descend, puis se pose. Il choisit une aire
  praticable — jamais dans l'eau, le bâti ou le sous-bois.

### Retour à la base

Deux déclencheurs, tous deux automatiques :

- **Munitions** sous 20 % : l'appareil n'a plus de quoi traiter un objectif, il rentre tant
  qu'il peut encore se défendre.
- **Bingo carburant** : le seuil n'est pas un pourcentage fixe mais le carburant nécessaire
  pour rentrer, majoré de 25 %, plus quatre minutes de réserve. **Un appareil loin de sa base
  rentre donc bien plus tôt qu'un appareil qui l'a en vue.** Le seuil courant est affiché
  dans sa fiche.

En cas de panne sèche malgré tout, l'appareil se pose en campagne au lieu de voler
indéfiniment. Une fois à la base il se remet en œuvre — coque, carburant, munitions — puis
se déclare disponible et **attend vos ordres** : il ne repart pas de lui-même sur une mission
dont il vient d'être retiré.

## Le renseignement

**Rien n'apparaît sur votre carte tant qu'un de vos éléments ne vous l'a pas transmis.**
Un contact passe par trois états :

- **ENTENDU** — un bruit, un azimut approximatif, une position à ±150 m. Icône « point de contact ».
- **VU** — silhouette repérée sans identification. Icône OTAN *inconnu* (jaune), position à ±50 m.
- **IDENTIFIÉ** — nature et volume déterminés. Icône OTAN *hostile* (rouge), position fiable.

La détection dépend de la distance, de la ligne de vue (relief, végétation, bâti), du couvert
et de la posture de la cible, de son mouvement, de ses départs de coup, de l'optique de
l'observateur, de l'heure et de la météo.

Un contact vieillit : le cercle d'incertitude grossit, l'information se dégrade, puis disparaît.

### La radio

Chaque élément a un indicatif et une fréquence, affichés sous son icône avec son état général.
La liaison dépend de la distance, du relief et du poste. Hors de portée, les comptes rendus sont
**mis en attente** et arrivent en retard quand la liaison revient — le badge `✖ RAD` signale la
rupture. Le véhicule relais radio (MIKE) étend la couverture ; placez-le sur un point haut.

## Le terrain

Le sol simulé est une grille de 10 m dérivée des données OSM et du relief réel.

- Les **bâtiments bloquent** tout le monde. Une unité peut y **entrer** pour se défendre
  (mission Défendre ou Fortifier) dans la limite de la capacité du bâtiment ; le badge `⌂` l'indique.
- Les **véhicules à roues** paient très cher le tout-terrain et suivent donc les routes d'eux-mêmes.
  Les **chenillés** coupent à travers champs. L'eau est infranchissable pour les véhicules.
- Le **couvert** (forêt, broussaille, bâti) dissimule et protège. Le **relief** masque les vues.
- La **pente**, la nature du sol, la **charge portée** et l'allure font monter la **fatigue**,
  qui réduit la vitesse et la précision. Une unité à l'arrêt récupère.

Trois calques permettent de voir ce que la simulation utilise vraiment, en haut à droite :
*Terrain simulé*, *Relief*, *Courbes*. *Liaisons* affiche l'état radio, *Portées* le rayon d'action
de l'élément sélectionné.

## Choisir son adversaire

Cinq profils, du plus faible au plus redoutable. Le choix se fait à la mise en place et
change **le matériel, l'instruction et la manière de combattre**.

| Niveau | Force | Ce qui change |
|---|---|---|
| 1 | **Milice villageoise** | Portée 250 m, aucune optique, **aucune vision nocturne**, aucun commandement. Nombreux (×1,6), embusquent à 90 m et se dérobent |
| 2 | **Insurgés aguerris** | Portée 320 m, roquettes, mortiers improvisés, quelques radios et rares appareils nocturnes. Guérilla organisée |
| 3 | **Forces paramilitaires** | Blindés légers, vision nocturne partielle, tactique hybride : ils tiennent quand ils peuvent, se dérobent sinon |
| 4 | **Armée régulière** | Le référentiel : optiques, vision nocturne, blindés, mortiers, PC articulé, défense en profondeur |
| 5 | **Unité d'élite** | Thermique, blindage renforcé, moins nombreux (×0,85) mais durs au feu et parfaitement coordonnés |

### La nuit, une arme

La vision nocturne n'est pas un détail cosmétique. Elle décide de ce que chacun voit :

| Adversaire | Notre vue de nuit | La leur | Avantage |
|---|---|---|---|
| Milice villageoise | 0,88 | 0,22 | **×4,0** |
| Insurgés | 0,88 | 0,32 | ×2,8 |
| Paramilitaires | 0,88 | 0,52 | ×1,7 |
| Armée régulière | 0,88 | 0,82 | ×1,1 |
| Unité d'élite | 0,88 | 0,88 | **aucun** |

*(1,0 = plein jour. Nos jumelles rattrapent 85 % de l'obscurité.)*

Contre une milice, attaquer de nuit est décisif. Contre une unité d'élite, l'obscurité ne
vous apporte rien — et le briefing initial vous le dit avant le départ.

### La guérilla n'est pas une armée en plus petit

Les profils dissymétriques (niveaux 1 et 2) combattent autrement :

- Ils **se terrent dans le couvert** plutôt que de tenir une ligne, et se dispersent bien
  plus largement autour de l'objectif.
- Ils **retiennent leur feu** : la milice n'ouvre qu'à 35 % de sa portée, soit 90 m. Testé
  en duel à 250 m en terrain découvert : nous tirons sans discontinuer et la clouons,
  **elle ne riposte pas une seule fois** — elle est hors de sa portée d'ouverture.
- Ils **rompent le contact** au bout d'un temps donné, qu'ils gagnent ou qu'ils perdent :
  70 secondes pour une milice, 110 pour des insurgés. Ils refusent le combat décisif.
- La milice **n'a aucun poste de commandement** : pas de manœuvre d'ensemble, pas de
  réserve, pas de contre-attaque coordonnée. Chaque groupe agit pour son compte.

Leur cohésion est faible : ils encaissent mal le feu et se laissent clouer deux fois plus
vite qu'une troupe instruite.

## Le climat use les hommes

La température n'est pas décorative : elle décide du rythme que votre section peut tenir.

| Température | Fatigue après 45 min de marche | Épuisée (75 %) en |
|---|---|---|
| −15 °C | 52 % | 65 min |
| 0 °C | 38 % | 88 min |
| **18 °C** | **36 %** | **93 min** |
| 30 °C | 49 % | 69 min |
| 38 °C | 69 % | 49 min |
| 45 °C | 82 % | **41 min** |

*(marche normale, 32 kg par homme, terrain plat)*

Sous 45 °C une section est à bout en 41 minutes contre 93 par temps tempéré — et surtout
**le repos ne répare plus** : trente minutes de halte ramènent la fatigue de 60 % à 10 % par
temps frais, mais seulement à 48 % sous forte chaleur. Au-delà de 40 °C, l'immobilité
elle-même commence à user.

La pluie ajoute 12 % d'effort, la neige 35 %, un vent fort jusqu'à 20 %. Le grand froid pèse
aussi, moitié moins que la chaleur extrême.

Le bandeau affiche la contrainte en clair dès qu'elle compte : *« forte chaleur 41 °C —
effort ×2,1 »*. En manuel, un curseur de température va de −25 à 48 °C et annonce l'effet
avant le départ ; en conditions réelles, la valeur vient du relevé.

## L'horloge sur zone

En haut à gauche, l'heure et **la date locales du lieu de l'opération**, qui avancent avec
la partie et passent minuit correctement — 23:58 le vendredi 21 devient 00:02 le samedi 22.
Le fuseau est affiché quand vous suivez le temps réel.

## Conditions réelles sur zone

Deux cases à la mise en place, cochées par défaut, décochables pour rester en manuel.

- **Météo locale en direct** — relevé Open-Meteo au moment du déploiement : ciel, pluie,
  neige, brouillard, température, vent, visibilité. Le bandeau affiche par exemple
  *« Pluie (22 °C, vent 8 km/h, visibilité 1.4 km) »*.
- **Heure locale réelle du lieu** — l'horloge démarre à l'heure qu'il est vraiment sur
  zone, fuseau compris. Une opération à Kaboul commence à l'heure de Kaboul, pas à la vôtre.

La visibilité météorologique n'est pas reprise telle quelle : elle mesure la portée d'un
gros repère, pas la distance à laquelle on distingue un homme. La condition fixe le plafond
tactique, et une visibilité réellement mauvaise peut encore l'abaisser — jamais le relever.

Si le service est injoignable, le chargement le dit et les réglages manuels sont conservés.

## L'ennemi

Le dispositif adverse n'est pas massé sur l'objectif. Il est réparti en trois rôles :

- **Garnison** (~40 %) : le noyau dur autour de l'objectif, retranché et articulé.
- **Patrouilles** (~35 %) : elles circulent en boucle entre les agglomérations, les
  carrefours et les terrains d'aviation de la zone. Un contact remonté dans leur chaîne
  envoie la patrouille disponible la plus proche ratisser le secteur, sans dégarnir
  l'objectif.
- **Postes et points de contrôle** (~25 %) : ils tiennent les points de passage.

Chacun reprend sa routine après un accrochage : la patrouille repart sur son itinéraire,
le poste se remet en place.

### Le chef adverse

Un **poste de commandement adverse** (`R-PC`), placé en arrière de l'objectif, coordonne
tout cela. Il n'est pas omniscient : **il ne connaît que ce que ses éléments lui ont rendu
compte**, par radio, avec le retard et l'imprécision que cela suppose.

- Un élément hors de portée radio est un **secteur aveugle** pour lui.
- Un élément détruit avant d'avoir parlé **emporte son information**.
- Sa situation **vieillit** : au bout de deux minutes un contact vu redevient un simple
  bruit, au bout de cinq il est oublié.

Sur cette situation imparfaite, il décide par cycles de 25 à 45 secondes :

| Décision | Déclencheur |
|---|---|
| **Éclairer** un contact douteux | Un bruit non identifié : il envoie la patrouille disponible la plus proche voir |
| **Densifier l'axe menacé** | Il prélève sur les secteurs calmes — jamais plus d'un tiers, jamais sur un secteur lui-même menacé |
| **Engager la réserve** | Seulement sur un effort **confirmé** d'au moins 12 hommes. Elle ne se donne qu'une fois |
| **Contre-attaquer** | Là où il se croit supérieur de 80 %, sur du confirmé uniquement |
| **Replier** un élément entamé | Sous 45 % d'effectif, il le ramène sur l'objectif |

Sa posture suit la situation : `vigilance` → `alerte` → `engagement` → `crise`. Elle
**redescend** quand l'information vieillit sans être rafraîchie — vous verrez son
estimation du volume adverse fluctuer, parce qu'il perd de vue ce qu'il ne surveille plus.

Ses ordres mettent eux aussi du temps à partir et à être exécutés, et il ne retaske jamais
un élément fixé ou cloué : il sait que l'ordre serait sans objet.

> **Réduire `R-PC` désarticule la défense.** Sans lui, plus aucune manœuvre d'ensemble :
> plus de réserve engagée, plus de renforcement d'axe, plus de contre-attaque coordonnée.
> Chaque élément retombe sur sa seule initiative et tient son bout de terrain. C'est
> l'objectif le plus rentable de la zone — encore faut-il le trouver.

Pour inspecter ce qu'il croit savoir depuis la console :

```js
GAME.world.opforCommander.summary()
```

Le volume est proportionné à l'étendue de la zone — l'écran de mise en place vous propose
un effectif cohérent quand vous déplacez le curseur de taille.

**Zones d'apparition protégées** : aucun ennemi n'apparaît à proximité du PC, de la FARP,
ni des terrains où vos avions sont stationnés. Leurs patrouilles peuvent en revanche s'en
approcher ensuite — à vous de couvrir vos arrières.

## Les civils

Des groupes de civils circulent et fuient les coups de feu. Ils n'apparaissent que si vos hommes
les voient, en icône OTAN *neutre*, et ne sont jamais pris pour cible par l'IA — mais ils peuvent
être touchés.

## Organisation du code

```
index.html            écran de mise en place + interface de jeu
style.css
data/icons.json       index des icônes OTAN, généré par tools/build-icons.mjs
icones/               vos 95 symboles OTAN (16 types × 4 affiliations, 24 points tactiques)

src/core/     util.js      RNG déterministe, maths, azimuts, bus d'événements
              geo.js       repère métrique local, conversions lat/lon et tuiles

src/world/    terrain.js   grille 10 m : nature du sol, couvert, altitude, bâtiments
              osm.js       requête Overpass et rastérisation des données réelles
              elevation.js relief depuis les tuiles d'élévation Terrarium
              weather.js   météo et heure locales réelles de la zone
              los.js       ligne de vue : masque de relief et obstruction cumulée

src/sim/      catalog.js   types d'unités, armements, postures, règles d'engagement
              unit.js      modèle d'unité : hommes, charge, fatigue, radio, état
              pathfind.js  A* sur la grille fine, coûts par mode de déplacement
              sensors.js   acquisition visuelle et sonore, identification, liaison radio
              intel.js     situation au PC, vieillissement des contacts, journal radio
              combat.js    résolution du feu, suppression, pertes, moral
              orders.js    catalogue des missions
              ai.js        exécution des missions, contournement d'obstacles, postures
              flight.js    mécanique de vol : inertie, virage, hauteur sol, bingo
              commander.js chef adverse : sa situation, ses décisions, ses ordres
              forces.js    profils de force : matériel, instruction, doctrine
              effects.js   mémoire courte des tirs, impacts et hommes tombés
              tactics.js   comportements réflexes : couvert, fixation, repli, déroute
              radios.js    râtelier de la tente : postes, écoute, volume, trafic perdu
              world.js     horloge, boucle, IA adverse, civils, génération du scénario

src/render/   solide.js    primitives 3D : matrices de face, boîtes, montants
              avatar.js    le corps : squelette articulé, marche, assise, tenue AOR2
              symbols.js   chargement et sélection des icônes OTAN
              audio.js     bips radio, départs de coup et moteurs, synthétisés
              voice.js     voix radio : timbre par indicatif, procédure et souffle
              airSymbols.js symboles OTAN aériens dessinés à la volée
              mapView.js   carte Leaflet et calques dérivés du terrain
              unitLayer.js rendu tactique sur canevas

src/ui/       app.js       ordre de bataille, panneau d'ordres, journal radio
              tent.js      la tente en 3D : pièce, déplacement, postes radio, écran
src/main.js                choix de la zone, chargement, boucle de jeu
```

Pour régénérer `data/icons.json` après avoir ajouté des icônes :

```bash
node tools/build-icons.mjs
```

## Console

L'objet `window.GAME` expose `world`, `view`, `layer`, `ui`, `rack` et `tent` pour inspecter
ou piloter la simulation depuis la console du navigateur. Par exemple :

```js
GAME.rack.setPower('P3', false);   // couper le réseau manœuvre
GAME.rack.setVolume('P1', 0.2);    // commandement à 20 %
GAME.tent.occuper('carte');        // s'installer à la table de situation
GAME.tent.occuper('radio');        // prendre les transmissions
GAME.tent.quitter();               // se relever
GAME.tent.cam                      // position et orientation du chef
```

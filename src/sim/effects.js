// Événements visuels du combat : traits de feu, impacts, hommes tombés.
//
// La simulation avance par pas de 0,25 s ; sans mémoire, un départ de coup ne
// serait visible qu'une image sur quatre et le combat resterait illisible. On
// conserve donc une courte trace horodatée de ce qui vient de se passer, que le
// rendu fait décliner.

const MAX = 260;

export class Effects {
  constructor(world) {
    this.world = world;
    this.list = [];
  }

  push(e) {
    e.t = this.world.time;
    this.list.push(e);
    if (this.list.length > MAX) this.list.splice(0, this.list.length - MAX);
  }

  // Trait de feu d'un tireur vers sa cible.
  shot(shooter, target, kind) {
    this.push({
      type: 'shot', kind,
      x: shooter.x, y: shooter.y, x2: target.x, y2: target.y,
      side: shooter.side, id: shooter.id, ttl: kind === 'indirect' ? 3 : 1.2,
    });
  }

  // Missile : contrairement au tir tendu, on le voit voler. L'affichage
  // interpole sa position et traîne une fumée derrière lui.
  missile(shooter, target, flight) {
    this.push({
      type: 'missile',
      x: shooter.x, y: shooter.y, x2: target.x, y2: target.y,
      side: shooter.side, id: shooter.id, flight, ttl: flight + 0.6,
    });
  }

  // Gerbe d'impact au but.
  impact(x, y, heavy) {
    this.push({ type: 'impact', x, y, ttl: heavy ? 2.5 : 1.2, heavy });
  }

  // Homme touché : la marque reste longtemps, c'est le repère du chef.
  casualty(unit, killed) {
    this.push({
      type: 'casualty', x: unit.x, y: unit.y, side: unit.side,
      killed, ttl: 45, callsign: unit.callsign,
    });
  }

  update() {
    const now = this.world.time;
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (now - e.t < e.ttl) this.list[w++] = e;
    }
    this.list.length = w;
  }

  // Ce qui doit être dessiné, du plus ancien au plus récent.
  active() { return this.list; }
}

export type Obstacle = { x: number; z: number; w?: number; d?: number; r?: number; circle?: boolean };
export type Point = { x: number; z: number };
export const BODY_RADIUS = .24;

/** Deliberately independent of WebGL: the model and movement share these bounds. */
export function canOccupy(x: number, z: number, obstacles: Obstacle[], radius = BODY_RADIUS): boolean {
  const distance = Math.hypot(x, z);
  const inHouse = distance < 9.35 - radius;
  const inTerrace = z > 8.5 && z < 12.5 - radius && Math.abs(x) < 7.9 - radius && distance < 12.65 - radius;
  if (!inHouse && !inTerrace) return false;
  // Glazing may only be crossed through the open entrance.
  if (distance > 9.05 - radius && distance < 9.5 + radius && z > 0 && Math.abs(x) > .99 - radius) return false;
  for (const o of obstacles) {
    if (o.circle) { if (Math.hypot(x-o.x,z-o.z) < (o.r ?? 0)+radius) return false; }
    else if (Math.abs(x-o.x) < (o.w ?? 0)/2+radius && Math.abs(z-o.z) < (o.d ?? 0)/2+radius) return false;
  }
  return true;
}

export function slideMove(from: Point, dx: number, dz: number, obstacles: Obstacle[]): Point {
  let {x,z}=from;
  // Substeps prevent tunnelling during slow frames, diagonal motion and VR movement.
  const steps=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.09));
  for(let i=0;i<steps;i++){
    if(canOccupy(x+dx/steps,z,obstacles))x+=dx/steps;
    if(canOccupy(x,z+dz/steps,obstacles))z+=dz/steps;
  }
  return {x,z};
}

/** A* across the actual door openings; room changes do not fly through walls. */
export function findRoute(start: Point, end: Point, obstacles: Obstacle[]): Point[] {
  const cell=.32, count=83, offset=13.12;
  const index=(p:Point)=>({x:Math.round((p.x+offset)/cell),z:Math.round((p.z+offset)/cell)});
  const world=(x:number,z:number)=>({x:x*cell-offset,z:z*cell-offset});
  const key=(x:number,z:number)=>z*count+x;
  const s=index(start),e=index(end),goal=key(e.x,e.z),begin=key(s.x,s.z);
  const open=new Set([begin]),parent=new Map<number,number>(),g=new Map([[begin,0]]),f=new Map([[begin,Math.hypot(e.x-s.x,e.z-s.z)]]);
  const allowed=(x:number,z:number)=>x>=0&&z>=0&&x<count&&z<count&&canOccupy(world(x,z).x,world(x,z).z,obstacles);
  if(!allowed(e.x,e.z))return [];
  for(let iteration=0;open.size&&iteration<7000;iteration++){
    let current=-1,best=Infinity;for(const n of open){const score=f.get(n)??Infinity;if(score<best){best=score;current=n;}}
    if(current===goal){const route:Point[]=[end];let n=current;while(n!==begin){route.unshift(world(n%count,Math.floor(n/count)));n=parent.get(n)!;}route.unshift(start);return route;}
    open.delete(current);const x=current%count,z=Math.floor(current/count);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
      const nx=x+dx,nz=z+dz;if(!allowed(nx,nz)||!allowed(x+dx,z)||!allowed(x,z+dz))continue;
      const n=key(nx,nz),cost=(g.get(current)??Infinity)+Math.hypot(dx,dz);
      if(cost>=(g.get(n)??Infinity))continue;
      parent.set(n,current);g.set(n,cost);f.set(n,cost+Math.hypot(e.x-nx,e.z-nz));open.add(n);
    }
  }
  return [];
}

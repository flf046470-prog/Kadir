import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ModeMarkerView } from '@kc/core';
import { ModeMarkers } from './ModeMarkers.js';

const hill: ModeMarkerView = { kind: 'hill', x: 4, y: 1, z: -3, radius: 5 };
const redGoal: ModeMarkerView = { kind: 'goal', x: 0, y: 0, z: -17, radius: 2.6, team: 'red', yaw: 0 };
const blueGoal: ModeMarkerView = { kind: 'goal', x: 0, y: 0, z: 17, radius: 2.6, team: 'blue', yaw: Math.PI };
const pitch: ModeMarkerView = { kind: 'pitch', x: 0, y: 0, z: 0, radius: 0, yaw: 0, halfLength: 17, halfWidth: 12 };

function ringColour(markers: ModeMarkers, index: number): number {
  const group = markers.group.children[index] as THREE.Group;
  const ring = group.children[0] as THREE.Mesh;
  return (ring.material as THREE.MeshBasicMaterial).color.getHex();
}

describe('mode markers', () => {
  it('draws the hill where the mode puts it, at its radius', () => {
    const markers = new ModeMarkers();
    markers.update([hill]);
    expect(markers.visibleCount).toBe(1);
    const group = markers.group.children[0] as THREE.Group;
    expect(group.position.toArray()).toEqual([4, 1, -3]);
    expect((group.children[0] as THREE.Mesh).scale.x).toBe(5);
  });

  it('draws both goals in their team colours, and swaps to the safe palette on request', () => {
    const markers = new ModeMarkers();
    markers.update([redGoal, blueGoal, pitch]);
    expect(markers.visibleCount).toBe(3);
    const red = ringColour(markers, 0);
    const blue = ringColour(markers, 1);
    expect(red).not.toBe(blue);
    markers.update([redGoal, blueGoal, pitch], true);
    expect(ringColour(markers, 0)).not.toBe(red);
    expect(ringColour(markers, 1)).not.toBe(blue);
  });

  it('stands a corner flag at each corner of the pitch, coloured by the goal at that end', () => {
    const markers = new ModeMarkers();
    markers.update([pitch]);
    const group = markers.group.children[0] as THREE.Group;
    const posts = group.children.slice(1) as THREE.Mesh[];
    expect(posts).toHaveLength(4);
    const corners = posts.map((p) => [p.position.x, p.position.z]).sort();
    expect(corners).toEqual([
      [-12, -17],
      [-12, 17],
      [12, -17],
      [12, 17],
    ]);
    const flagColour = (post: THREE.Mesh): number => ((post.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();
    const redEnd = posts.filter((p) => p.position.z < 0).map(flagColour);
    const blueEnd = posts.filter((p) => p.position.z > 0).map(flagColour);
    expect(new Set(redEnd).size).toBe(1);
    expect(new Set(blueEnd).size).toBe(1);
    expect(redEnd[0]).not.toBe(blueEnd[0]);
  });

  it('hides what the mode stopped publishing, and replaces a slot whose kind changed', () => {
    const markers = new ModeMarkers();
    markers.update([redGoal, blueGoal, pitch]);
    markers.update([hill]);
    expect(markers.visibleCount).toBe(1);
    markers.update(undefined);
    expect(markers.visibleCount).toBe(0);
    markers.dispose();
    expect(markers.group.parent).toBeNull();
  });
});

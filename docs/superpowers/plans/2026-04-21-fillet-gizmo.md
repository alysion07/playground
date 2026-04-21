# Fillet Studio — Viewport Transform Gizmo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fillet Studio 뷰포트에서 선택된 PrimNode를 Three.js TransformControls로 직접 이동/회전(translate + rotate)할 수 있게 만들고, 드래그 중에는 raw primitive proxy만 표시하다 드래그 종료 시 기존 debounced 파이프라인을 트리거해 풀 메시를 재생성한다.

**Architecture:** `src/render/transformGizmo.ts`(신규) — proxy geometry + TransformControls 래퍼. `Viewport.tsx`(수정) — gizmo attach/detach + 드래그 중 meshRoot visible 토글 + 키보드 단축키. `store.ts`(수정) — `gizmoMode` state 추가. core/pipeline 무수정.

**Tech Stack:** TypeScript, React 18, zustand, Three.js (`three/examples/jsm/controls/{OrbitControls, TransformControls}`), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-21-fillet-gizmo-design.md`

**Working directory:** `/c/Users/ALYSION/claude_workbench/playground/.worktrees/erosion-sculptor/fillet-studio/fillet-studio` (worktree root는 `.worktrees/erosion-sculptor/fillet-studio/`, 앱 디렉터리는 그 안의 `fillet-studio/`)

---

## File Structure

| 파일 | 책임 | 상태 |
|------|------|------|
| `src/render/transformGizmo.ts` | proxy geometry 빌드 + TransformControls 래핑 + 드래그 라이프사이클 콜백 | 신규 |
| `src/render/Viewport.tsx` | gizmo 라이프사이클, meshRoot visible 토글, 키보드 단축키 | 수정 |
| `src/state/store.ts` | `gizmoMode` 상태 + `setGizmoMode` setter | 수정 |
| `tests/gizmoProxy.test.ts` | `buildProxyGeometry` bbox 단위 테스트 | 신규 |
| `tests/gizmoCommit.test.ts` | Euler ↔ Quaternion round-trip | 신규 |
| `tests/store.test.ts` | `setGizmoMode`가 tree/mesh를 변경하지 않음 | 신규 |

각 파일은 단일 책임. `transformGizmo.ts`는 React/zustand에 의존하지 않음(`Viewport`가 콜백으로 다리 놓음) → 테스트 시 Three.js만 mocking하면 됨.

---

## Task 1: `gizmoMode` state 추가 (store)

**Files:**
- Modify: `src/state/store.ts`
- Create: `tests/store.test.ts`

- [ ] **Step 1: failing test 작성**

`tests/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/state/store';

describe('store gizmoMode', () => {
  beforeEach(() => {
    useStore.setState({ gizmoMode: 'translate' });
  });

  it('defaults to translate', () => {
    expect(useStore.getState().gizmoMode).toBe('translate');
  });

  it('setGizmoMode updates state without touching tree/mesh', () => {
    const before = useStore.getState();
    useStore.getState().setGizmoMode('rotate');
    const after = useStore.getState();
    expect(after.gizmoMode).toBe('rotate');
    expect(after.tree).toBe(before.tree);
    expect(after.mesh).toBe(before.mesh);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — `gizmoMode`가 state에 없고 `setGizmoMode`도 없음 → TS 컴파일 에러 또는 런타임 undefined.

- [ ] **Step 3: store에 필드 + setter 추가**

`src/state/store.ts` `StoreState` 타입에 다음 두 줄 추가 (기존 `wireframe: boolean;` 다음 줄):
```ts
  gizmoMode: 'translate' | 'rotate';
```
그리고 `setWireframe` 시그니처 다음 줄에:
```ts
  setGizmoMode: (m: 'translate' | 'rotate') => void;
```

`create<StoreState>` 초기값 객체에서 `wireframe: false,` 다음 줄에:
```ts
  gizmoMode: 'translate',
```

`setWireframe: (v) => set({ wireframe: v }),` 다음 줄에:
```ts
  setGizmoMode: (m) => set({ gizmoMode: m }),
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 전체 회귀 테스트**

Run: `npx vitest run`
Expected: 모든 기존 27개 + 새 2개 = 29개 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/state/store.ts tests/store.test.ts
git commit -m "feat(fillet-gizmo): add gizmoMode state to store"
```

---

## Task 2: `buildProxyGeometry` — primitive별 Three.js geometry 생성

**Files:**
- Create: `src/render/transformGizmo.ts` (이 task에서는 helper만)
- Create: `tests/gizmoProxy.test.ts`

이 task는 데이터 변환만. TransformControls 통합은 Task 4.

- [ ] **Step 1: failing test 작성**

`tests/gizmoProxy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildProxyGeometry } from '../src/render/transformGizmo';
import { makePrim } from '../src/core/csg';

function bbox(geom: any): { min: [number, number, number]; max: [number, number, number] } {
  geom.computeBoundingBox();
  const b = geom.boundingBox!;
  return {
    min: [b.min.x, b.min.y, b.min.z],
    max: [b.max.x, b.max.y, b.max.z],
  };
}

describe('buildProxyGeometry', () => {
  it('sphere bbox is ±r', () => {
    const prim = makePrim('sphere', [0.4]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(min[0]).toBeCloseTo(-0.4, 2);
    expect(max[0]).toBeCloseTo(0.4, 2);
    expect(min[1]).toBeCloseTo(-0.4, 2);
    expect(max[2]).toBeCloseTo(0.4, 2);
  });

  it('box bbox is ±hx, ±hy, ±hz', () => {
    const prim = makePrim('box', [0.5, 0.3, 0.2]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(max[0]).toBeCloseTo(0.5, 5);
    expect(max[1]).toBeCloseTo(0.3, 5);
    expect(max[2]).toBeCloseTo(0.2, 5);
    expect(min[0]).toBeCloseTo(-0.5, 5);
  });

  it('torus bbox is ±(R+tubeR) in xz, ±tubeR in y', () => {
    const prim = makePrim('torus', [0.6, 0.1]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(max[0]).toBeCloseTo(0.7, 1);
    expect(max[2]).toBeCloseTo(0.7, 1);
    expect(Math.abs(max[1])).toBeLessThanOrEqual(0.11);
  });

  it('roundBox bbox is ±hx (radius approximated as 0)', () => {
    const prim = makePrim('roundBox', [0.4, 0.4, 0.4, 0.05]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(max[0]).toBeCloseTo(0.4, 5);
    expect(min[0]).toBeCloseTo(-0.4, 5);
  });

  it('capsule bbox spans endpoints expanded by r (axis-aligned case)', () => {
    // a=(0,-0.3,0), b=(0,0.3,0), r=0.15 → bbox y: [-0.45, 0.45], xz: [-0.15, 0.15]
    const prim = makePrim('capsule', [0, -0.3, 0, 0, 0.3, 0, 0.15]);
    const g = buildProxyGeometry(prim);
    const { min, max } = bbox(g);
    expect(max[1]).toBeCloseTo(0.45, 1);
    expect(min[1]).toBeCloseTo(-0.45, 1);
    expect(max[0]).toBeCloseTo(0.15, 1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/gizmoProxy.test.ts`
Expected: FAIL — `transformGizmo.ts`가 아직 없음.

- [ ] **Step 3: `transformGizmo.ts` 생성 — `buildProxyGeometry`만**

`src/render/transformGizmo.ts`:
```ts
import * as THREE from 'three';
import type { PrimNode, PrimType } from '../state/types';

// Builds a Three.js BufferGeometry that approximates the primitive's surface
// in its LOCAL frame (i.e. before prim.translate/prim.rotate).
// Caller wraps in a Mesh and applies prim.translate/rotate at the Object3D
// level so the gizmo can edit those world transforms directly.
//
// For capsule the SDF takes two arbitrary endpoints; we build a Y-aligned
// CapsuleGeometry of length |b-a| and bake the (midpoint translation +
// Y → (b-a) rotation) directly into the geometry vertices via applyMatrix4
// so the outer Mesh's transform stays purely (translate, rotate).
export function buildProxyGeometry(prim: PrimNode): THREE.BufferGeometry {
  const p = prim.params;
  switch (prim.type) {
    case 'sphere': {
      const r = p[0];
      return new THREE.SphereGeometry(r, 32, 16);
    }
    case 'box': {
      const [hx, hy, hz] = [p[0], p[1], p[2]];
      return new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz);
    }
    case 'torus': {
      const [R, tubeR] = [p[0], p[1]];
      // TorusGeometry default lies in xy-plane; sdfPrim.ts puts the major
      // circle in xz, tube along y. Rotate -90° about X to match.
      const g = new THREE.TorusGeometry(R, tubeR, 16, 48);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case 'capsule': {
      const [ax, ay, az, bx, by, bz, r] = [p[0], p[1], p[2], p[3], p[4], p[5], p[6]];
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const L = Math.hypot(dx, dy, dz);
      const g = new THREE.CapsuleGeometry(r, L, 8, 16);
      // CapsuleGeometry is centered at origin and aligned to Y axis.
      // Build a quaternion that rotates Y → (b-a)/L, then translate to midpoint.
      const dir = new THREE.Vector3(dx, dy, dz);
      if (dir.lengthSq() > 1e-12) dir.normalize();
      else dir.set(0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      return g;
    }
    case 'roundBox': {
      const [hx, hy, hz] = [p[0], p[1], p[2]];
      // Radius is intentionally ignored; the proxy is a rough placement aid.
      return new THREE.BoxGeometry(2 * hx, 2 * hy, 2 * hz);
    }
    default: {
      const _exhaustive: never = prim.type;
      throw new Error(`Unknown primitive type: ${_exhaustive}`);
    }
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/gizmoProxy.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 회귀 테스트**

Run: `npx vitest run`
Expected: 29 + 5 = 34 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/render/transformGizmo.ts tests/gizmoProxy.test.ts
git commit -m "feat(fillet-gizmo): proxy geometry per primitive type"
```

---

## Task 3: Euler ↔ Quaternion round-trip 검증

**Files:**
- Create: `tests/gizmoCommit.test.ts`

이 task는 외부 코드를 안 만들고, **Three.js의 Euler↔Quaternion 변환이 우리 컨벤션(XYZ 순서)에서 round-trip 보존됨을** 회귀선으로 고정한다. 드래그 끝에서 quaternion → Euler 추출이 신뢰 가능하다는 안전선.

- [ ] **Step 1: 테스트 작성**

`tests/gizmoCommit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

describe('Euler XYZ ↔ Quaternion round-trip (drag commit safety)', () => {
  const cases: Array<[number, number, number]> = [
    [0, 0, 0],
    [0.1, 0, 0],
    [0, 0.5, 0],
    [0, 0, -0.7],
    [0.3, -0.4, 0.2],
    [-1.0, 0.6, -0.3],
  ];

  for (const r of cases) {
    it(`round-trip preserves [${r.join(',')}]`, () => {
      const e1 = new THREE.Euler(r[0], r[1], r[2], 'XYZ');
      const q = new THREE.Quaternion().setFromEuler(e1);
      const e2 = new THREE.Euler().setFromQuaternion(q, 'XYZ');
      expect(e2.x).toBeCloseTo(r[0], 5);
      expect(e2.y).toBeCloseTo(r[1], 5);
      expect(e2.z).toBeCloseTo(r[2], 5);
    });
  }
});
```

- [ ] **Step 2: 테스트 통과 확인**

Run: `npx vitest run tests/gizmoCommit.test.ts`
Expected: PASS (6 tests).
(이 task는 RED 단계 없음 — Three.js 동작 검증용 회귀선이므로 처음부터 GREEN.)

- [ ] **Step 3: 회귀 테스트**

Run: `npx vitest run`
Expected: 34 + 6 = 40 통과.

- [ ] **Step 4: 커밋**

```bash
git add tests/gizmoCommit.test.ts
git commit -m "test(fillet-gizmo): pin Euler XYZ <-> Quaternion round-trip"
```

---

## Task 4: `createTransformGizmo` factory — TransformControls 래핑

**Files:**
- Modify: `src/render/transformGizmo.ts` (Task 2 파일에 추가)

테스트는 jsdom에서 TransformControls가 안 돌아 자동화 어렵다. 이 task는 **Task 5 통합 시점에 수동 체크리스트로 검증**. 코드 자체는 Three.js 공식 패턴 직역.

- [ ] **Step 1: 타입 + 함수 시그니처 추가**

`src/render/transformGizmo.ts` 파일 상단(import 아래)에 추가:
```ts
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Vec3 } from '../state/types';

export type GizmoMode = 'translate' | 'rotate';

export type GizmoHandles = {
  attachTo: (prim: PrimNode | null) => void;
  setMode: (mode: GizmoMode) => void;
  dispose: () => void;
};

export type GizmoArgs = {
  scene: THREE.Scene;
  camera: THREE.Camera;
  domElement: HTMLElement;
  orbit: OrbitControls;
  onCommit: (t: Vec3, r: Vec3) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};
```

- [ ] **Step 2: factory 함수 구현 추가**

같은 파일 끝에 추가:
```ts
export function createTransformGizmo(args: GizmoArgs): GizmoHandles {
  const { scene, camera, domElement, orbit, onCommit, onDragStart, onDragEnd } = args;

  // The proxy mesh holds prim.translate as position and prim.rotate as
  // rotation (XYZ Euler). The gizmo edits these directly during drag; on
  // mouseUp we read them back and forward to the store via onCommit.
  const proxyMaterial = new THREE.MeshBasicMaterial({
    color: 0x7dd3fc,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  const proxyRoot = new THREE.Group();
  proxyRoot.name = 'gizmo-proxy-root';
  scene.add(proxyRoot);

  let proxy: THREE.Mesh | null = null;
  let attachedPrimId: string | null = null;

  const controls = new TransformControls(camera, domElement);
  controls.setSpace('world');
  controls.setMode('translate');
  scene.add(controls);

  const onDraggingChanged = (e: { value: boolean }) => {
    orbit.enabled = !e.value;
    if (e.value) onDragStart();
    else onDragEnd();
  };
  controls.addEventListener('dragging-changed', onDraggingChanged as any);

  const onMouseUp = () => {
    if (!proxy) return;
    const t: Vec3 = [proxy.position.x, proxy.position.y, proxy.position.z];
    const e = new THREE.Euler().setFromQuaternion(proxy.quaternion, 'XYZ');
    const r: Vec3 = [e.x, e.y, e.z];
    if (
      Number.isFinite(t[0]) && Number.isFinite(t[1]) && Number.isFinite(t[2]) &&
      Number.isFinite(r[0]) && Number.isFinite(r[1]) && Number.isFinite(r[2])
    ) {
      onCommit(t, r);
    }
  };
  controls.addEventListener('mouseUp', onMouseUp as any);

  function clearProxy() {
    if (!proxy) return;
    controls.detach();
    proxyRoot.remove(proxy);
    proxy.geometry.dispose();
    proxy = null;
    attachedPrimId = null;
  }

  function attachTo(prim: PrimNode | null) {
    // Mid-drag re-attach is unsafe — wait for the user to release.
    if ((controls as any).dragging === true) return;
    if (!prim) {
      clearProxy();
      return;
    }
    if (proxy && attachedPrimId === prim.id) {
      // Same prim re-selected (e.g., slider edit) — just sync transforms.
      proxy.position.fromArray(prim.translate);
      proxy.rotation.set(prim.rotate[0], prim.rotate[1], prim.rotate[2], 'XYZ');
      return;
    }
    clearProxy();
    const geom = buildProxyGeometry(prim);
    const m = new THREE.Mesh(geom, proxyMaterial);
    m.position.fromArray(prim.translate);
    m.rotation.set(prim.rotate[0], prim.rotate[1], prim.rotate[2], 'XYZ');
    proxyRoot.add(m);
    proxy = m;
    attachedPrimId = prim.id;
    controls.attach(m);
  }

  function setMode(mode: GizmoMode) {
    controls.setMode(mode);
  }

  function dispose() {
    controls.removeEventListener('dragging-changed', onDraggingChanged as any);
    controls.removeEventListener('mouseUp', onMouseUp as any);
    clearProxy();
    controls.detach();
    scene.remove(controls);
    (controls as any).dispose?.();
    scene.remove(proxyRoot);
    proxyMaterial.dispose();
  }

  return { attachTo, setMode, dispose };
}
```

- [ ] **Step 3: TypeScript 컴파일 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 회귀 테스트**

Run: `npx vitest run`
Expected: 40 통과 (변화 없음 — gizmo 통합은 다음 task).

- [ ] **Step 5: 커밋**

```bash
git add src/render/transformGizmo.ts
git commit -m "feat(fillet-gizmo): TransformControls factory wrapping proxy mesh"
```

---

## Task 5: Viewport 통합 — gizmo 마운트 + meshRoot visible 토글

**Files:**
- Modify: `src/render/Viewport.tsx`

- [ ] **Step 1: Viewport props 확장**

`src/render/Viewport.tsx` 상단의 `ViewportProps` 타입을 다음으로 교체:
```ts
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CsgNode, MeshData, PrimNode, Vec3 } from '../state/types';
import { createScene } from './scene';
import { meshFromField } from './meshFromField';
import { createTransformGizmo, type GizmoHandles, type GizmoMode } from './transformGizmo';

export type ViewportProps = {
  mesh: MeshData | null;
  wireframe?: boolean;
  tree: CsgNode;
  selectedId: string | null;
  gizmoMode: GizmoMode;
  setGizmoMode: (m: GizmoMode) => void;
  onCommitTransform: (id: string, translate: Vec3, rotate: Vec3) => void;
  setSelected: (id: string | null) => void;
};
```

- [ ] **Step 2: handlesRef 타입 확장**

같은 파일에서 `handlesRef = useRef<{...}>` 객체에 `gizmo: GizmoHandles;` 필드 추가. 다른 필드들 그대로.

- [ ] **Step 3: helper 함수 추가 (파일 하단)**

```ts
function findPrim(root: CsgNode, id: string | null): PrimNode | null {
  if (!id) return null;
  if (root.kind === 'prim') return root.id === id ? root : null;
  for (const c of root.children) {
    const hit = findPrim(c, id);
    if (hit) return hit;
  }
  return null;
}
```

- [ ] **Step 4: mount useEffect 안에서 gizmo 생성 + 키보드 리스너**

`useEffect(() => { ... }, [])` 안에서 OrbitControls 생성 직후, `wireMat` 정의 직전에 추가:
```ts
    host.tabIndex = 0;

    const gizmo = createTransformGizmo({
      scene,
      camera,
      domElement: renderer.domElement,
      orbit: controls,
      onCommit: (t, r) => {
        const id = currentSelectedId.current;
        if (id) propsRef.current.onCommitTransform(id, t, r);
      },
      onDragStart: () => { meshRoot.visible = false; },
      onDragEnd: () => { meshRoot.visible = true; },
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') propsRef.current.setGizmoMode('translate');
      else if (e.key === 'e' || e.key === 'E') propsRef.current.setGizmoMode('rotate');
      else if (e.key === 'Escape') propsRef.current.setSelected(null);
    };
    host.addEventListener('keydown', onKey);
```

같은 useEffect의 cleanup 안에 (renderer.dispose 직전):
```ts
      host.removeEventListener('keydown', onKey);
      gizmo.dispose();
```

같은 useEffect의 `handlesRef.current = { ... }` 객체에 `gizmo` 추가.

- [ ] **Step 5: props ref + selected ref 추가**

mount useEffect 위에:
```ts
  const propsRef = useRef({
    onCommitTransform: (_id: string, _t: Vec3, _r: Vec3) => {},
    setGizmoMode: (_m: GizmoMode) => {},
    setSelected: (_id: string | null) => {},
  });
  const currentSelectedId = useRef<string | null>(null);

  // Keep refs in sync so the long-lived event handlers always see the latest
  // store callbacks without rebinding listeners on every render.
  propsRef.current.onCommitTransform = onCommitTransform;
  propsRef.current.setGizmoMode = setGizmoMode;
  propsRef.current.setSelected = setSelected;
  currentSelectedId.current = selectedId;
```

(props 구조분해 추가: 컴포넌트 시그니처를 `export function Viewport({ mesh, wireframe = false, tree, selectedId, gizmoMode, setGizmoMode, onCommitTransform, setSelected }: ViewportProps) {`로 교체.)

- [ ] **Step 6: gizmo attach/setMode useEffect**

기존 `useEffect(() => { ... }, [mesh, wireframe])` 다음에 추가:
```ts
  useEffect(() => {
    const h = handlesRef.current;
    if (!h) return;
    h.gizmo.attachTo(findPrim(tree, selectedId));
  }, [selectedId, tree]);

  useEffect(() => {
    const h = handlesRef.current;
    if (!h) return;
    h.gizmo.setMode(gizmoMode);
  }, [gizmoMode]);
```

- [ ] **Step 7: App.tsx에서 props 전달**

`src/App.tsx`의 imports에 `Vec3` 타입 추가:
```ts
import type { Vec3 } from './state/types';
```

`useStore` 셀렉터 추가:
```ts
  const selectedId = useStore((s) => s.selectedId);
  const gizmoMode = useStore((s) => s.gizmoMode);
  const setGizmoMode = useStore((s) => s.setGizmoMode);
  const setSelected = useStore((s) => s.setSelected);
  const setTranslate = useStore((s) => s.setTranslate);
  const setRotate = useStore((s) => s.setRotate);
```

`<Viewport>` 호출을 다음으로 교체:
```tsx
        <Viewport
          mesh={mesh}
          wireframe={wireframe}
          tree={tree}
          selectedId={selectedId}
          gizmoMode={gizmoMode}
          setGizmoMode={setGizmoMode}
          setSelected={setSelected}
          onCommitTransform={(id, t, r) => {
            setTranslate(id, t);
            setRotate(id, r);
          }}
        />
```

- [ ] **Step 8: TypeScript 컴파일**

Run: `npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 9: 회귀 테스트**

Run: `npx vitest run`
Expected: 40 통과.

- [ ] **Step 10: 수동 dev 서버 검증**

Run: `npm run dev` (백그라운드 OK)
브라우저에서 `http://localhost:5173/` 접속 후 다음 체크리스트 수행 — 모든 항목 통과해야 다음 step으로:

- [ ] 기본 box+sphere 메시가 표시됨
- [ ] 좌측 트리에서 첫 번째 box(또는 sphere) 클릭 → 뷰포트 가운데에 화살표 3개(translate gizmo) 등장
- [ ] X(빨강) 화살표 드래그 → 그 즉시 메시가 사라지고 반투명 sky-blue 박스만 보이며 x축으로만 이동
- [ ] 마우스 떼기 → 0.2~0.5s 후 새 위치로 메시 재생성, gizmo 그대로 유지
- [ ] 드래그 중 카메라 회전 시도 → OrbitControls 비활성(반응 없음) 확인
- [ ] 키보드 `E` → rotate gizmo(원호 3개)로 전환
- [ ] Y(녹색) 원호 드래그 → 회전, 동일하게 메시 사라졌다 복귀
- [ ] 키보드 `W` → translate로 복귀
- [ ] 키보드 `Esc` → 선택 해제, gizmo 사라짐
- [ ] OpNode("Smooth Union") 클릭 → gizmo 안 보임(prim 아니므로 attach 안 됨)
- [ ] 사이드패널의 Vec3Editor `translate` 값이 드래그 결과와 일치

위 모두 통과한 경우에만 다음 step.

- [ ] **Step 11: 커밋**

```bash
git add src/render/Viewport.tsx src/App.tsx
git commit -m "feat(fillet-gizmo): wire TransformControls into Viewport with W/E/Esc shortcuts"
```

---

## Task 6: 문서 업데이트 + 최종 회귀

**Files:**
- Modify: `docs/fillet-studio-plan.md`
- Modify: `README.md` (해당 토이의 — `fillet-studio/README.md`)

- [ ] **Step 1: plan 문서에 phase 추가**

`docs/fillet-studio-plan.md`의 Phases 표 마지막 줄(`8 | 갤러리 등록 ...`) 다음에 추가:
```
| 9 | viewport TransformControls 기즈모 (translate/rotate, W/E/Esc, raw-prim proxy) | ✅ |
```

같은 문서의 Tests 섹션(`총 26개 통과` 근처)을 다음과 같이 갱신:
```
총 **40개** 통과:
... (기존 항목 유지) ...
- `gizmoProxy` (5) — primitive별 proxy geometry bbox
- `gizmoCommit` (6) — Euler XYZ ↔ Quaternion round-trip
- `store` (2) — gizmoMode 상태 격리
```
(실제 숫자는 직전 vitest 출력으로 검증.)

- [ ] **Step 2: README에 Controls 섹션 추가**

`fillet-studio/README.md`의 `## Run` 섹션 직전에 다음 섹션 삽입:
```markdown
## Controls

- 좌측 트리에서 primitive 선택 → 뷰포트 가운데에 transform gizmo 등장
- 화살표 드래그: 이동 (X/Y/Z 축 잠금)
- 원호 드래그: 회전
- 키보드: `W` = translate, `E` = rotate, `Esc` = 선택 해제
- 드래그 중에는 반투명 proxy만 표시되고 마우스를 떼면 메시가 다시 계산됨

```
또한 11번째 줄(`Vitest (26 tests ...)`)을 다음으로 교체:
```
- Vitest (40 tests across `csg`, `sdfCpu`, `curvatureFlow`, `marchingCubes`, `stl`, `gizmoProxy`, `gizmoCommit`, `store`)
```
같은 파일 마지막 줄(`tests/` — vitest, 26 통과)을 다음으로 교체:
```
- `tests/` — vitest, 40 통과
```

- [ ] **Step 3: 최종 type check + 테스트**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 에러 없음 + 40+ 통과.

- [ ] **Step 4: 커밋**

```bash
git add docs/fillet-studio-plan.md README.md
git commit -m "docs(fillet-gizmo): document gizmo phase and updated test count"
```

---

## Self-Review 체크리스트 (writer가 직접)

**Spec coverage:**
- [x] PrimNode만 대상 → Task 5에서 `findPrim` 사용 (OpNode 시 null → attach 안 함) ✓
- [x] translate + rotate → Task 4 `setMode('translate'|'rotate')` ✓
- [x] W/E/Esc → Task 5 Step 4 keyboard listener ✓
- [x] 드래그 중 meshRoot 숨김 → Task 5 Step 4 `meshRoot.visible = false` ✓
- [x] 드래그 끝 풀 recompute → onCommit → setTranslate+setRotate → store change → 기존 debounced effect ✓
- [x] proxy geometry per type → Task 2 ✓
- [x] capsule 처리 → Task 2 (matrix4로 endpoints 베이크) ✓
- [x] OrbitControls 충돌 → Task 4 `dragging-changed` 리스너 ✓
- [x] Euler 변환 신뢰성 → Task 3 round-trip 테스트 ✓
- [x] gizmoMode 상태 → Task 1 ✓
- [x] core/pipeline 무수정 → 표 명시 ✓

**Placeholder scan:** "TBD"/"TODO"/"적절히"/"...등" 등 모호 표현 없음 ✓.

**Type consistency:**
- `GizmoHandles`, `GizmoMode`, `GizmoArgs` Task 4에서 정의, Task 5에서 import ✓
- `buildProxyGeometry(prim: PrimNode)` Task 2 시그니처, Task 4에서 호출 ✓
- `setGizmoMode(m)` 시그니처 Task 1과 store/Viewport/App에서 일치 ✓
- `onCommitTransform(id, t, r)` Viewport prop, App에서 setTranslate+setRotate로 분기 ✓
- `findPrim` Task 5 helper, Task 5 effect에서 호출 ✓

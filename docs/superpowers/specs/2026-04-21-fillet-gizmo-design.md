# Fillet Studio — Viewport Transform Gizmo (Design Spec)

Date: 2026-04-21
Status: Design — awaiting user approval → implementation plan

## Goal

Fillet Studio 뷰포트에서 선택된 CSG primitive을 3D 직접 조작으로 이동/회전할 수 있게 한다.
현재는 사이드패널의 `Vec3Editor` 슬라이더만 가능 → 조작 편의 개선.

## Scope

- **대상 노드**: `PrimNode`만. `OpNode`(smoothUnion 등)는 제외.
  - `OpNode` 선택 시 기즈모는 숨김.
  - `OpNode`에 transform 추가는 별개 설계 주제로 분리.
- **조작 축**: translate (3축) + rotate (3축). scale 제외
  (params의 hx/hy/hz/r 등과 이중 의미가 되어 혼란).
- **모드 전환**: `W` = translate, `E` = rotate, `Esc` = 선택 해제.

## Non-Goals

- OpNode 변환(서브트리 전체 이동/회전)
- Snap-to-grid
- Gimbal lock 해결 (XYZ Euler 유지 — 기존 Vec3Editor와 동일 규약)
- 멀티 선택
- Undo/Redo

## Design Principles

- **코어 손대지 않음**: `core/`·`pipeline/`의 순수 함수 보존. 파이프라인 재계산 경로는 기존 debounced useEffect 그대로 재사용.
- **단방향 동기화**: store → proxy(읽기), proxy → store(드래그 끝 1회 쓰기).
- **정확함과 반응성 분리**: 드래그 중엔 의도적으로 거친 프록시만 표시(Fillet Studio의 "정확함" identity에 부합). 릴리즈에서만 풀 파이프라인.

## Architecture

```
┌─────────────────────────────────────────┐
│            Viewport.tsx                 │
│  ┌─────────────┐   ┌────────────────┐   │
│  │OrbitControls│   │TransformGizmo  │   │
│  │             │◄──┤ (new module)   │   │
│  └─────────────┘   └────────────────┘   │
│         │                  │            │
│         ▼                  ▼            │
│  ┌────────────────────────────────┐     │
│  │  THREE.Scene                   │     │
│  │  ├─ meshRoot (final MC mesh)   │     │
│  │  └─ proxyRoot (selected prim)  │     │
│  └────────────────────────────────┘     │
└─────────────────────────────────────────┘
            │ reads:  selectedId, tree, gizmoMode
            │ writes: prim.translate/rotate on drag end
            ▼
         zustand store
```

### 변경 요약

| 경로 | 변경 |
|------|------|
| `src/core/` | **변경 없음** |
| `src/pipeline/` | **변경 없음** |
| `src/render/transformGizmo.ts` | **신규** |
| `src/render/Viewport.tsx` | 수정 — 기즈모 attach/detach, 드래그 중 meshRoot visible 토글 |
| `src/state/store.ts` | 수정 — `gizmoMode` 상태 + `setGizmoMode` 추가 |
| `src/ui/CsgTreePanel.tsx` | 변경 없음 (Vec3Editor는 존치 — 정밀 수치 입력용) |
| `tests/gizmoProxy.test.ts` | 신규 — 프록시 bbox 검증 |
| `tests/gizmoCommit.test.ts` | 신규 — Euler round-trip |

## Components

### `src/render/transformGizmo.ts` (신규)

공개 API:

```ts
export type GizmoHandles = {
  attachTo: (prim: PrimNode | null) => void;
  setMode: (mode: 'translate' | 'rotate') => void;
  dispose: () => void;
};

export function createTransformGizmo(args: {
  scene: THREE.Scene;
  camera: THREE.Camera;
  domElement: HTMLElement;
  orbit: OrbitControls;
  onCommit: (t: Vec3, r: Vec3) => void;
  onDragStart: () => void;    // Viewport가 meshRoot 숨김
  onDragEnd: () => void;      // Viewport가 meshRoot 복귀
}): GizmoHandles;
```

내부 구조:

- `proxyRoot: THREE.Group` — scene에 attach.
- `proxyMesh: THREE.Mesh | null` — 선택된 prim 1개에 대응.
- `controls: TransformControls` — proxy에 attach.
- Material: `MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.25, depthWrite: false })`.
- `dragging-changed` 이벤트 → orbit 토글 + onDragStart/onDragEnd 호출.
- `mouseUp` 이벤트 → proxy transform 읽어 onCommit 호출.

### Proxy geometry 매핑

| PrimType | geometry | 비고 |
|----------|----------|------|
| sphere | `SphereGeometry(r, 32, 16)` | params[0] = r |
| box | `BoxGeometry(2·hx, 2·hy, 2·hz)` | params = [hx, hy, hz] |
| torus | `TorusGeometry(R, tubeR, 16, 48)` | params = [R, tubeR] |
| capsule | `CapsuleGeometry(r, L, 8, 16)` where `L = |b - a|`, 그 후 proxy 내부 `Mesh`를 `a+b/2`에 놓고 `Y축`이 `(b-a)` 방향을 향하도록 local quaternion 적용 | params = [ax, ay, az, bx, by, bz, r]; 내부 로컬 변환은 prim.rotate와 **별개** (gizmo rotate는 계속 prim.rotate를 편집) |
| roundBox | `BoxGeometry(2·hx, 2·hy, 2·hz)` | params = [hx, hy, hz, r]; 반경 무시(근사) |

정확한 params 인덱스는 `src/core/sdfPrim.ts`의 `PRIM_SCHEMAS`에서 조회.

### `src/render/Viewport.tsx` (수정)

- `createTransformGizmo` 호출, `handlesRef`에 저장.
- `useEffect([selectedId, tree])` → `gizmo.attachTo(findPrim(tree, selectedId))`
- `useEffect([gizmoMode])` → `gizmo.setMode(mode)`
- `onDragStart`: `meshRoot.visible = false`
- `onDragEnd`: `meshRoot.visible = true`
- `onCommit(t, r)`: `store.setTranslate(id, t)` + `store.setRotate(id, r)` (store 직접 호출 대신 prop으로 전달)
- 키보드 리스너: `W` / `E` / `Esc` — `host.tabIndex = 0`로 포커스 가능하게.

### `src/state/store.ts` (수정 — 최소)

```ts
gizmoMode: 'translate' | 'rotate';          // 기본 'translate'
setGizmoMode: (m: 'translate' | 'rotate') => void;
```

기존 `setTranslate` / `setRotate` 재사용. 드래그 끝 commit은 2회 set이지만 기존 180ms debounced useEffect가 coalesce.

## Data Flow

### 선택 변경
```
clickOnTreeNode
  → store.setSelected(id)
  → Viewport effect
      → gizmo.attachTo(prim)
          ├─ 이전 proxyMesh dispose
          ├─ buildProxyGeometry(prim.type, prim.params)
          ├─ proxyMesh.position.fromArray(prim.translate)
          ├─ proxyMesh.rotation.set(...prim.rotate, 'XYZ')
          └─ controls.attach(proxyMesh)
```

### 드래그 시퀀스
```
mouseDown on gizmo
  → dragging-changed=true
      ├─ orbit.enabled = false
      ├─ onDragStart: meshRoot.visible = false
      └─ (proxyMesh만 보임)

mouseMove
  → TransformControls이 proxyMesh.position/quaternion 직접 변경
  → store 접근 없음 (재계산 방지)

mouseUp
  → t = proxyMesh.position.toArray()
  → r = new THREE.Euler().setFromQuaternion(proxyMesh.quaternion, 'XYZ').toArray()
  → onCommit(t, r) → store.setTranslate + setRotate
  → App의 debounced useEffect (180ms) → run() → 새 메시
  → dragging-changed=false
      ├─ orbit.enabled = true
      └─ onDragEnd: meshRoot.visible = true
```

## Error Handling

| 상황 | 처리 |
|------|------|
| `TransformControls` import 실패 | top-level throw → mount 실패로 즉시 감지. runtime try/catch 불필요 |
| `selectedId`에 해당 노드 없음 | `findPrim` null → `attachTo(null)` → `controls.detach()` |
| 미지원 primitive 타입 확장 시 | `buildProxyGeometry` switch에서 exhaustive `never` 체크 — TS가 컴파일 에러 |
| OrbitControls와 이벤트 경합 | `dragging-changed`로 orbit 토글 (Three 공식 패턴) |
| commit 시 부동소수 NaN | `Number.isFinite` 6개 체크 실패 시 no-op |
| 드래그 중 prim 삭제 (useEffect 재진입) | `controls.dragging === true`이면 `attachTo` no-op; 드래그 끝나면 새 선택 반영 |

## Performance

- **드래그 프레임**: proxy matrix 업데이트 + render만. React 리렌더 없음 → 60fps 유지.
- **commit 비용**: zustand set 2회 → 180ms debounced → 풀 파이프라인 1회 (기존과 동일).
- **proxy 재생성**: 선택 변경마다 geometry dispose & new — 수백 μs, 무시 가능.
- **메모리**: proxyMesh 1개 + geometry 1개만 유지.

## Testing

### 자동화 (Vitest)
- `tests/gizmoProxy.test.ts` — `buildProxyGeometry(type, params)` 반환 geometry의 bbox가 예상값과 일치:
  - sphere: `±r`
  - box: `±hx, ±hy, ±hz`
  - torus: `±(R+tubeR)` xz, `±tubeR` y
  - capsule: endpoints `a`, `b` + radius `r` → bbox = `min(a,b) - r` ~ `max(a,b) + r`
  - roundBox: `±hx, ±hy, ±hz`
- `tests/gizmoCommit.test.ts` — Euler round-trip:
  - 임의의 rotate `[rx, ry, rz]`(Gimbal lock 회피 범위) → `THREE.Euler` → `Quaternion` → `Euler` → `[rx', ry', rz']` 가 원본과 1e-5 이내 일치.
- `tests/store.test.ts` — `setGizmoMode` 호출이 tree/mesh를 건드리지 않음.

### 수동 체크리스트
- [ ] primitive 선택 시 기즈모 표시
- [ ] W/E/Esc 키 동작
- [ ] 드래그 시작 순간 최종 메시 사라지고 반투명 프록시만 노출
- [ ] 축 잠금 (X축 드래그 시 x만 변함)
- [ ] 드래그 중 OrbitControls 비활성
- [ ] 드래그 끝 0.2~0.5s 후 새 위치로 리빌드
- [ ] OpNode 선택 시 기즈모 숨김
- [ ] 사이드패널 Vec3Editor 값이 드래그 결과와 동기화
- [ ] 선택 해제 시 기즈모 사라짐

### 회귀 방지
- 기존 27개 테스트 전부 통과 유지 (`core/`·`pipeline/` 무변경).
- 신규 테스트 추가 후 총 30개 이상.

## Out of Scope (Future)

- OpNode transform (서브트리 이동/회전)
- Snap-to-grid / snap-to-axis
- World vs local space 토글
- Undo/Redo
- 멀티 선택
- 기즈모 스타일 커스터마이즈

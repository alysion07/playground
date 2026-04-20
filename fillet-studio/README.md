# Fillet Studio

CSG로 부품을 조립하고 **평균곡률 흐름 PDE**로 날카로운 엣지를 정확한 반지름 R로 라운딩한 뒤,
marching cubes로 메시를 추출하고 **GLB/STL**로 내보내는 CAD-스타일 토이.

## Stack

- React 18 + zustand + TypeScript
- Three.js WebGLRenderer (+ OrbitControls, GLTFExporter)
- 전 파이프라인 CPU 계산 (브라우저 메인 스레드, 중간 단계는 `setTimeout(0)`으로 양보)
- Vitest (26 tests across `csg`, `sdfCpu`, `curvatureFlow`, `marchingCubes`, `stl`)

## Pipeline

```
CSG tree  ─►  sample ψ (N³ SDF volume)
          ─►  curvature flow  ∂ψ/∂t = α·κ·|∇ψ|,   R-cap halts at |κ| < 1/R
          ─►  marching cubes  (watertight, indexed)
          ─►  Three.BufferGeometry → viewport / GLB / STL
```

### 핵심 수식

- 구의 수축 (해석해 검증): `R(t)² = R₀² − 2αt`
- 필렛 정지 시각: `t* = R² / (2α)`
- CFL: `dt = 0.9 · h² / (3α)` (3D explicit heat)
- R-cap: 각 복셀에서 `|κ| < 1/R`이면 업데이트 스킵 → 목표 반지름에서 freeze

## Run

```bash
npm i
npm run dev      # http://localhost:5175
npm run test
npm run build
```

## Layout

- `src/core/` — 순수 함수 (types, csg 트리, 프리미티브 SDF, 컴파일러, 샘플링, 곡률 흐름, marching cubes)
- `src/pipeline/` — end-to-end `computeFillet` 오케스트레이션
- `src/render/` — Three.js scene, MC → BufferGeometry, React Viewport
- `src/state/` — zustand store (tree / params / status / mesh)
- `src/ui/` — CsgTreePanel, FilletControls, ExportPanel
- `src/export/` — GLB (GLTFExporter), STL (binary)
- `tests/` — vitest, 26 통과

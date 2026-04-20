# Erosion Sculptor

WebGPU 기반 CSG 침식 조각가. Week 1: SDF 프리뷰만.

## Stack

- Vite + TypeScript
- Three.js `three/webgpu` + WGSL
- Zustand vanilla store
- tweakpane (CSG 트리 에디터)

## Run

```
npm i
npm run dev      # http://localhost:5174 (WebGPU 필요)
npm run build
npm run test
```

## 폴더

- `src/core/` — SDF 프리미티브, CSG 자료구조, WGSL 코드 생성
- `src/render/` — WebGPU 파이프라인 + 셰이더
- `src/state/` — zustand store
- `src/ui/` — tweakpane 패널, fps 오버레이
- `src/app/` — bootstrap + RAF 루프

## 로드맵

`../docs/erosion-sculptor-plan.md`

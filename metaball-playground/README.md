# metaball-playground

SDF 기반 메타볼 블롭 플레이그라운드. 4주 미니 제품의 첫 번째 토이.

## Status
**Week 1 — Foundation**
풀스크린 SDF 셰이더로 하드코딩된 구 3개가 smooth-min으로 합쳐지는 상태까지.

## Run
```bash
npm i
npm run dev      # Vite dev server
npm run build    # type-check + prod bundle
npm run lint
npm run test
```

## Stack
- Vite + TypeScript
- Three.js WebGPURenderer (fallback: WebGL2)
- WGSL fragment shader + full-screen triangle
- Tailwind for UI

See `../docs/metaball-playground-plan.md` for the full plan.

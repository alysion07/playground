# slime-tower

3D 아이소메트릭 슬라임 쌓기 토이. 메타볼 파이프라인 위에 **SDF 레이마칭 + 3D Verlet**을 얹어 만든 두 번째 플레이그라운드.

## Status
**Week 1 — Iso Raymarch Spine**
3D 공간에 슬라임 낙하·smooth-union merge·유리 톤 렌더·그리드 바닥까지.

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
- Three.js WebGLRenderer (GLSL fragment raymarch)
- 고정 orthographic isometric 카메라 (yaw 45° / pitch 30°)
- Tailwind for UI, tweakpane for dev controls

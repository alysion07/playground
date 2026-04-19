# slime-tower

3D 아이소메트릭 슬라임 쌓기 토이. 메타볼 파이프라인 위에 **SDF 레이마칭 + 3D Verlet**을 얹어 만든 두 번째 플레이그라운드.

## Status
SDF 레이마칭 + 3D Verlet 위에 zen / tower 모드, 동색 머지, topple 감지, palette·shape·color 모드, 충격 펄스 + 스트랜드, share URL까지 들어간 상태. 차기 작업 가능 후보는 vessel 모드, seed/preset UI, MAX_SLIMES 도달 피드백.

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

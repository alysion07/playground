# Playground (Toy Collection)

인터랙티브 웹 토이 모노레포. 첫 번째 토이는 **Metaball Playground** — SDF 기반 블롭 플레이그라운드.
목표: 3–4주 안에 공유 가능한 미니 제품.

## Repo Layout
- `metaball-playground/` — 첫 토이 (Week 1부터 스캐폴딩)
- `docs/` — 플랜, 설계 메모
- `packages/` (v2 이후) — 공용 유틸

## Active Toy: Metaball Playground

### Stack
- Vite + TypeScript
- Three.js WebGPURenderer (fallback: WebGL2)
- WGSL fragment shader + full-screen triangle
- Zustand (state + URL sync)
- Tailwind for UI, tweakpane during dev

### Run (metaball-playground/)
- `npm i`
- `npm run dev` — Vite dev server (HMR 포함)
- `npm run build` — 프로덕션 번들
- `npm run test` — Vitest
- `npm run e2e` — Playwright 스모크

### Code Conventions
- 모든 렌더 관련 파일: `src/render/`
- 시뮬레이션 순수 함수: `src/sim/` (부수효과 없음, 테스트 용이)
- 상태: `src/state/store.ts` 하나의 Zustand store, slice로 나눔
- 셰이더는 `.wgsl` 파일로 분리, `?raw` 임포트
- public API는 barrel export 금지(직접 경로 임포트)

### Non-Goals (v1)
- 회원/DB/서버 — v1은 전부 클라이언트
- 3D 블롭 — v2
- 커뮤니티 갤러리 — v2

### Work Plan
주차별 계획: `docs/metaball-playground-plan.md`
우선순위: Week 1 Foundation → Week 2 Interaction → Week 3 Polish → Week 4 Ship.

### Definition of Done (MVP)
- 모바일 60fps @ 16 blobs
- 스크린샷·GIF·URL 공유
- 프리셋 5개
- Lighthouse Mobile 90+

### Before You Commit
1. `npm run lint && npm run test`
2. 새 셰이더 추가 시 WebGPU/WebGL2 양쪽 경로 확인
3. 상태 스키마 바꾸면 `url-sync.ts` 버전 올리기

# Playground (Toy Collection)

인터랙티브 웹 토이 모노레포. 첫 번째 토이는 **Metaball Playground** — SDF 기반 블롭 플레이그라운드.
목표: 3–4주 안에 공유 가능한 미니 제품.

## 학습 세션 — 가장 먼저 읽을 것

사용자가 **학습 세션**임을 암시하면 (`LEARNING.md` 언급, `Stage 0/1/2/3/4` 프롬프트, `[모의 면접 모드]`, `[이해도 점검]`, "학습하자 / 공부하려고 / 튜토리얼 / 이 토이 설명해줘" 등) — **워크벤치 루트의 `../LEARNING.md`를 먼저 열어 세션 프로토콜로 삼는다.**

`../LEARNING.md`는 이 파일의 기본 행동을 **오버라이드**한다:
- 명시적 승인 전까지 **read-only**. 파일 수정 금지.
- 코드 덤프 금지 — 파일·줄만 지목, 사용자가 직접 읽도록 유도.
- 한 번에 한 Stage만. 앞서나가지 않음.
- `[모의 면접 모드]` 중에는 Claude가 면접관 — 한 번에 질문 1개, 모범답안 제시 금지.

워크벤치 루트 전체 구조는 `../CLAUDE.md` 참고.

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

## Active Toy: Erosion Sculptor (Week 1)

CSG로 쌓은 SDF 덩어리를 향후 Level Set PDE로 침식시키는 WebGPU 인터랙티브 아트.
Week 1 범위: 모노레포 통합 + CSG 트리 + 정적 SDF 레이마칭 프리뷰. PDE는 Week 2부터.

### Stack
- Vite + TypeScript
- **WebGPU 전용** (WebGL 폴백 없음 — 미지원 브라우저는 안내 화면)
- Three.js `three/webgpu` import path + WGSL 셰이더
- Zustand (vanilla store)
- tweakpane (CSG 트리 에디터), Tailwind (애플리케이션 셸)

### Run (erosion-sculptor/)
- `npm i`
- `npm run dev` — Vite dev server (`http://localhost:5174`)
- `npm run build` — `tsc --noEmit && vite build`
- `npm run test` — Vitest

### Conventions
- `.wgsl`은 `?raw`로 import
- SDF 트리 → WGSL 문자열 생성은 `src/core/sdfGen.ts`
- 상태 변경 시 `material.rebuild(sdfGen(tree))`로 셰이더 리빌드

### Roadmap
주차별 상세: `docs/erosion-sculptor-plan.md`
- Week 1 (현재): scaffold + CSG 프리뷰
- Week 2: ψ 볼륨 + 곡률 흐름 PDE
- Week 3: 바람 이방성 + marching cubes
- Week 4: GLB/WebM 내보내기 + URL 공유
